/**
 * Trace Verifier - Validates trace integrity and hierarchy
 *
 * Use this to verify traces are properly structured with correct
 * parent-child relationships, span correlation, and agent attribution.
 */

import { Span, Agent, RunDetails, SpanStatus } from './types.js';

export interface TraceNode {
  span: Span;
  children: TraceNode[];
  agent?: Agent;
}

export interface TraceTree {
  runId: string;
  agents: Map<string, Agent>;
  roots: TraceNode[];  // Top-level spans (no parent)
  orphans: Span[];     // Spans with missing parent references
}

export interface TraceValidation {
  valid: boolean;
  issues: string[];
  warnings: string[];
  stats: TraceStats;
}

export interface TraceStats {
  totalSpans: number;
  completedSpans: number;
  runningSpans: number;
  errorSpans: number;
  agentCount: number;
  subagentCount: number;
  maxDepth: number;
  spansByTool: Record<string, number>;
  spansByAgent: Record<string, number>;
  avgDurationMs: number | null;
  totalDurationMs: number;
}

export interface ExpectedTrace {
  tools: string[];           // Expected tool names in order
  toolCounts?: Record<string, number>;  // Expected count per tool type
  minSpans?: number;
  maxSpans?: number;
  agentCount?: number;
  subagentTypes?: string[];
  noErrors?: boolean;
  allCompleted?: boolean;
}

/**
 * Build a hierarchical tree from flat span list
 */
export function buildTraceTree(details: RunDetails, spans: Span[]): TraceTree {
  const agents = new Map<string, Agent>();
  for (const agent of details.agents) {
    agents.set(agent.agentId, agent);
  }

  // Build lookup for parent-child relationships
  const spanById = new Map<string, Span>();
  for (const span of spans) {
    spanById.set(span.spanId, span);
  }

  // Group spans by parent
  const childrenByParent = new Map<string, Span[]>();
  const roots: Span[] = [];
  const orphans: Span[] = [];

  for (const span of spans) {
    if (span.parentSpanId) {
      const parent = spanById.get(span.parentSpanId);
      if (parent) {
        const children = childrenByParent.get(span.parentSpanId) || [];
        children.push(span);
        childrenByParent.set(span.parentSpanId, children);
      } else {
        // Has parentSpanId but parent doesn't exist - orphan
        orphans.push(span);
      }
    } else {
      // No parent - root span
      roots.push(span);
    }
  }

  // Build tree recursively
  const buildNode = (span: Span): TraceNode => {
    const children = childrenByParent.get(span.spanId) || [];
    return {
      span,
      children: children.map(buildNode),
      agent: agents.get(span.agentId),
    };
  };

  return {
    runId: details.runId,
    agents,
    roots: roots.map(buildNode),
    orphans,
  };
}

/**
 * Calculate statistics for a trace
 */
export function calculateTraceStats(details: RunDetails, spans: Span[]): TraceStats {
  const spansByTool: Record<string, number> = {};
  const spansByAgent: Record<string, number> = {};
  let completedSpans = 0;
  let runningSpans = 0;
  let errorSpans = 0;
  let totalDuration = 0;
  let durationCount = 0;

  for (const span of spans) {
    // Count by tool
    spansByTool[span.toolName] = (spansByTool[span.toolName] || 0) + 1;

    // Count by agent
    spansByAgent[span.agentId] = (spansByAgent[span.agentId] || 0) + 1;

    // Count by status
    if (span.status === 'ok') {
      completedSpans++;
    } else if (span.status === 'running') {
      runningSpans++;
    } else {
      errorSpans++;
    }

    // Track duration
    if (span.durationMs !== undefined) {
      totalDuration += span.durationMs;
      durationCount++;
    }
  }

  // Calculate max depth
  const tree = buildTraceTree(details, spans);
  const getMaxDepth = (nodes: TraceNode[], depth: number): number => {
    if (nodes.length === 0) return depth;
    return Math.max(...nodes.map(n => getMaxDepth(n.children, depth + 1)));
  };
  const maxDepth = getMaxDepth(tree.roots, 0);

  // Count subagents
  const subagentCount = details.agents.filter(a => a.parentAgentId).length;

  return {
    totalSpans: spans.length,
    completedSpans,
    runningSpans,
    errorSpans,
    agentCount: details.agents.length,
    subagentCount,
    maxDepth,
    spansByTool,
    spansByAgent,
    avgDurationMs: durationCount > 0 ? totalDuration / durationCount : null,
    totalDurationMs: totalDuration,
  };
}

/**
 * Validate a trace against expected structure
 */
export function validateTrace(
  details: RunDetails,
  spans: Span[],
  expected?: ExpectedTrace
): TraceValidation {
  const issues: string[] = [];
  const warnings: string[] = [];
  const stats = calculateTraceStats(details, spans);

  // Check for running spans in completed run
  if (details.status !== 'running' && stats.runningSpans > 0) {
    issues.push(`Run is ${details.status} but has ${stats.runningSpans} running spans`);
  }

  // Check for orphan spans (parentSpanId references non-existent span)
  const tree = buildTraceTree(details, spans);
  if (tree.orphans.length > 0) {
    issues.push(`Found ${tree.orphans.length} orphan spans with missing parent references`);
  }

  // Check span agent attribution
  for (const span of spans) {
    const agent = details.agents.find(a => a.agentId === span.agentId);
    if (!agent) {
      issues.push(`Span ${span.spanId} attributed to unknown agent ${span.agentId}`);
    }
  }

  // Check Task spans have associated subagents
  const taskSpans = spans.filter(s => s.toolName === 'Task');
  for (const taskSpan of taskSpans) {
    // A Task span should have spawned a subagent
    const hasSubagent = details.agents.some(a => a.parentAgentId === taskSpan.agentId);
    if (!hasSubagent && taskSpan.status === 'ok') {
      warnings.push(`Task span ${taskSpan.spanId} completed but no subagent found`);
    }
  }

  // Check for spans with missing endedAt but status != running
  for (const span of spans) {
    if (span.status !== 'running' && span.endedAt === undefined) {
      issues.push(`Span ${span.spanId} has status ${span.status} but no endedAt`);
    }
  }

  // Check against expected structure if provided
  if (expected) {
    // Check tool order
    if (expected.tools) {
      const actualTools = spans.map(s => s.toolName);
      for (let i = 0; i < expected.tools.length; i++) {
        if (actualTools[i] !== expected.tools[i]) {
          issues.push(`Expected tool[${i}] to be ${expected.tools[i]}, got ${actualTools[i] || 'none'}`);
        }
      }
    }

    // Check tool counts
    if (expected.toolCounts) {
      for (const [tool, expectedCount] of Object.entries(expected.toolCounts)) {
        const actualCount = stats.spansByTool[tool] || 0;
        if (actualCount !== expectedCount) {
          issues.push(`Expected ${expectedCount} ${tool} spans, got ${actualCount}`);
        }
      }
    }

    // Check span count bounds
    if (expected.minSpans !== undefined && stats.totalSpans < expected.minSpans) {
      issues.push(`Expected at least ${expected.minSpans} spans, got ${stats.totalSpans}`);
    }
    if (expected.maxSpans !== undefined && stats.totalSpans > expected.maxSpans) {
      issues.push(`Expected at most ${expected.maxSpans} spans, got ${stats.totalSpans}`);
    }

    // Check agent count
    if (expected.agentCount !== undefined && stats.agentCount !== expected.agentCount) {
      issues.push(`Expected ${expected.agentCount} agents, got ${stats.agentCount}`);
    }

    // Check subagent types
    if (expected.subagentTypes) {
      const actualTypes = details.agents
        .filter(a => a.parentAgentId)
        .map(a => a.agentType)
        .filter(Boolean) as string[];
      for (const expectedType of expected.subagentTypes) {
        if (!actualTypes.includes(expectedType)) {
          issues.push(`Expected subagent type ${expectedType} not found`);
        }
      }
    }

    // Check no errors
    if (expected.noErrors && stats.errorSpans > 0) {
      issues.push(`Expected no errors but found ${stats.errorSpans} error spans`);
    }

    // Check all completed
    if (expected.allCompleted && stats.runningSpans > 0) {
      issues.push(`Expected all spans completed but found ${stats.runningSpans} running`);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    warnings,
    stats,
  };
}

/**
 * Format trace tree as ASCII art for visual inspection
 */
export function formatTraceTree(tree: TraceTree): string {
  const lines: string[] = [];
  lines.push(`Trace: ${tree.runId}`);
  lines.push(`Agents: ${tree.agents.size}`);
  lines.push('');

  const formatDuration = (ms?: number) => {
    if (ms === undefined) return '?';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const formatStatus = (status: SpanStatus) => {
    switch (status) {
      case 'ok': return '✓';
      case 'error': return '✗';
      case 'running': return '⏳';
      case 'timeout': return '⏱';
      case 'permission_denied': return '🚫';
      case 'aborted': return '⊘';
      default: return '?';
    }
  };

  const printNode = (node: TraceNode, prefix: string, isLast: boolean) => {
    const connector = isLast ? '└── ' : '├── ';
    const statusIcon = formatStatus(node.span.status);
    const duration = formatDuration(node.span.durationMs);
    const agentName = node.agent?.displayName || node.span.agentId.slice(0, 8);

    lines.push(`${prefix}${connector}${statusIcon} ${node.span.toolName} (${duration}) [${agentName}]`);

    const newPrefix = prefix + (isLast ? '    ' : '│   ');
    for (let i = 0; i < node.children.length; i++) {
      printNode(node.children[i], newPrefix, i === node.children.length - 1);
    }
  };

  if (tree.roots.length === 0) {
    lines.push('(no spans)');
  } else {
    for (let i = 0; i < tree.roots.length; i++) {
      printNode(tree.roots[i], '', i === tree.roots.length - 1);
    }
  }

  if (tree.orphans.length > 0) {
    lines.push('');
    lines.push(`Orphans (${tree.orphans.length}):`);
    for (const orphan of tree.orphans) {
      lines.push(`  - ${orphan.toolName} (parent: ${orphan.parentSpanId})`);
    }
  }

  return lines.join('\n');
}

/**
 * Generate a trace summary report
 */
export function generateTraceReport(
  details: RunDetails,
  spans: Span[],
  expected?: ExpectedTrace
): string {
  const validation = validateTrace(details, spans, expected);
  const tree = buildTraceTree(details, spans);

  const lines: string[] = [];
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push(`TRACE VERIFICATION REPORT`);
  lines.push(`Run ID: ${details.runId}`);
  lines.push(`Status: ${details.status}`);
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('');

  // Stats
  lines.push('STATISTICS:');
  lines.push(`  Total Spans:     ${validation.stats.totalSpans}`);
  lines.push(`  Completed:       ${validation.stats.completedSpans}`);
  lines.push(`  Running:         ${validation.stats.runningSpans}`);
  lines.push(`  Errors:          ${validation.stats.errorSpans}`);
  lines.push(`  Agents:          ${validation.stats.agentCount}`);
  lines.push(`  Subagents:       ${validation.stats.subagentCount}`);
  lines.push(`  Max Depth:       ${validation.stats.maxDepth}`);
  lines.push(`  Avg Duration:    ${validation.stats.avgDurationMs?.toFixed(0) || 'N/A'}ms`);
  lines.push('');

  // Spans by tool
  lines.push('SPANS BY TOOL:');
  for (const [tool, count] of Object.entries(validation.stats.spansByTool).sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${tool.padEnd(20)} ${count}`);
  }
  lines.push('');

  // Agents
  lines.push('AGENTS:');
  for (const agent of details.agents) {
    const isSubagent = agent.parentAgentId ? ' (subagent)' : '';
    const ended = agent.endedAt ? '✓' : '⏳';
    lines.push(`  ${ended} ${agent.displayName}${isSubagent}`);
    lines.push(`    ID: ${agent.agentId.slice(0, 16)}...`);
    if (agent.agentType) lines.push(`    Type: ${agent.agentType}`);
  }
  lines.push('');

  // Trace tree
  lines.push('TRACE TREE:');
  lines.push(formatTraceTree(tree));
  lines.push('');

  // Validation results
  lines.push('VALIDATION:');
  if (validation.valid) {
    lines.push('  ✓ All checks passed');
  } else {
    lines.push('  ✗ Validation failed');
    for (const issue of validation.issues) {
      lines.push(`    - ${issue}`);
    }
  }
  if (validation.warnings.length > 0) {
    lines.push('');
    lines.push('WARNINGS:');
    for (const warning of validation.warnings) {
      lines.push(`  ⚠ ${warning}`);
    }
  }
  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════════');

  return lines.join('\n');
}
