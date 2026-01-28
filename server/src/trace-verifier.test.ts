/**
 * Tests for Trace Verifier - Hierarchy and Structure Validation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TraceStore } from './trace-store.js';
import {
  buildTraceTree,
  calculateTraceStats,
  validateTrace,
  formatTraceTree,
  generateTraceReport,
  ExpectedTrace,
} from './trace-verifier.js';
import { TelemetryEvent, Span, RunDetails } from './types.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Trace Verifier', () => {
  let store: TraceStore;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-verifier-'));
    store = new TraceStore(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const createSession = (runId: string) => {
    store.processEvent({
      eventKind: 'sessionStart',
      timestamp: Date.now(),
      runId,
      source: 'cursor',
    });
  };

  describe('buildTraceTree', () => {
    it('should build flat tree for spans without parent relationships', () => {
      const runId = 'tree-test-1';
      const t0 = Date.now();
      createSession(runId);

      // Three independent spans
      for (let i = 0; i < 3; i++) {
        store.processEvent({
          eventKind: 'toolStart',
          timestamp: t0 + i * 100,
          runId,
          spanId: `span-${i}`,
          toolName: ['Read', 'Grep', 'Write'][i],
        });

        store.processEvent({
          eventKind: 'toolEnd',
          timestamp: t0 + i * 100 + 50,
          runId,
          spanId: `span-${i}`,
          duration: 50,
        });
      }

      const details = store.getRunDetails(runId)!;
      const spans = store.getSpans(runId)!.spans;
      const tree = buildTraceTree(details, spans);

      expect(tree.roots).toHaveLength(3);
      expect(tree.orphans).toHaveLength(0);
      expect(tree.roots.every(r => r.children.length === 0)).toBe(true);
    });

    it('should build nested tree for Task -> Subagent spans', () => {
      const runId = 'tree-test-2';
      const t0 = Date.now();
      createSession(runId);

      // Parent spawns Task
      store.processEvent({
        eventKind: 'toolStart',
        timestamp: t0,
        runId,
        spanId: 'task-span',
        toolName: 'Task',
      });

      // Subagent starts and does work
      store.processEvent({
        eventKind: 'subagentStart',
        timestamp: t0 + 50,
        runId,
        agentId: 'subagent-1',
        agentType: 'explore',
        parentSpanId: 'task-span',
      });

      // Subagent's Read span (with parent reference)
      store.processEvent({
        eventKind: 'toolStart',
        timestamp: t0 + 100,
        runId,
        spanId: 'read-span',
        toolName: 'Read',
        agentId: 'subagent-1',
        parentSpanId: 'task-span',
      });

      store.processEvent({
        eventKind: 'toolEnd',
        timestamp: t0 + 150,
        runId,
        spanId: 'read-span',
        duration: 50,
      });

      // Subagent ends
      store.processEvent({
        eventKind: 'subagentStop',
        timestamp: t0 + 200,
        runId,
        agentId: 'subagent-1',
      });

      const details = store.getRunDetails(runId)!;
      const spans = store.getSpans(runId)!.spans;
      const tree = buildTraceTree(details, spans);

      // Should have 1 root (Task) with 1 child (Read)
      expect(tree.roots).toHaveLength(1);
      expect(tree.roots[0].span.toolName).toBe('Task');
      expect(tree.roots[0].children).toHaveLength(1);
      expect(tree.roots[0].children[0].span.toolName).toBe('Read');
    });

    it('should detect orphan spans with missing parent', () => {
      const runId = 'tree-test-3';
      const t0 = Date.now();
      createSession(runId);

      // Span with non-existent parent
      store.processEvent({
        eventKind: 'toolStart',
        timestamp: t0,
        runId,
        spanId: 'orphan-span',
        toolName: 'Read',
        parentSpanId: 'non-existent-parent',
      });

      store.processEvent({
        eventKind: 'toolEnd',
        timestamp: t0 + 50,
        runId,
        spanId: 'orphan-span',
        duration: 50,
      });

      const details = store.getRunDetails(runId)!;
      const spans = store.getSpans(runId)!.spans;
      const tree = buildTraceTree(details, spans);

      expect(tree.roots).toHaveLength(0);
      expect(tree.orphans).toHaveLength(1);
      expect(tree.orphans[0].spanId).toBe('orphan-span');
    });

    it('should handle deep nesting (3+ levels)', () => {
      const runId = 'tree-test-4';
      const t0 = Date.now();
      createSession(runId);

      // Level 0: Task
      store.processEvent({
        eventKind: 'toolStart',
        timestamp: t0,
        runId,
        spanId: 'level-0',
        toolName: 'Task',
      });

      // Level 1: Read under Task
      store.processEvent({
        eventKind: 'toolStart',
        timestamp: t0 + 100,
        runId,
        spanId: 'level-1',
        toolName: 'Read',
        parentSpanId: 'level-0',
      });

      // Level 2: Grep under Read (hypothetical nested scenario)
      store.processEvent({
        eventKind: 'toolStart',
        timestamp: t0 + 200,
        runId,
        spanId: 'level-2',
        toolName: 'Grep',
        parentSpanId: 'level-1',
      });

      // Complete all
      for (const spanId of ['level-2', 'level-1', 'level-0']) {
        store.processEvent({
          eventKind: 'toolEnd',
          timestamp: t0 + 300,
          runId,
          spanId,
          duration: 50,
        });
      }

      const details = store.getRunDetails(runId)!;
      const spans = store.getSpans(runId)!.spans;
      const tree = buildTraceTree(details, spans);

      expect(tree.roots).toHaveLength(1);
      expect(tree.roots[0].span.toolName).toBe('Task');
      expect(tree.roots[0].children).toHaveLength(1);
      expect(tree.roots[0].children[0].span.toolName).toBe('Read');
      expect(tree.roots[0].children[0].children).toHaveLength(1);
      expect(tree.roots[0].children[0].children[0].span.toolName).toBe('Grep');
    });
  });

  describe('calculateTraceStats', () => {
    it('should calculate correct statistics', () => {
      const runId = 'stats-test-1';
      const t0 = Date.now();
      createSession(runId);

      // Mix of tools and statuses
      const tools = ['Read', 'Read', 'Grep', 'Write', 'Shell'];
      for (let i = 0; i < tools.length; i++) {
        store.processEvent({
          eventKind: 'toolStart',
          timestamp: t0 + i * 100,
          runId,
          spanId: `span-${i}`,
          toolName: tools[i],
        });

        // Make one fail
        if (i === 3) {
          store.processEvent({
            eventKind: 'toolFailure',
            timestamp: t0 + i * 100 + 50,
            runId,
            spanId: `span-${i}`,
            failureType: 'error',
            duration: 50,
          });
        } else {
          store.processEvent({
            eventKind: 'toolEnd',
            timestamp: t0 + i * 100 + 50 + i * 10,
            runId,
            spanId: `span-${i}`,
            duration: 50 + i * 10,
          });
        }
      }

      const details = store.getRunDetails(runId)!;
      const spans = store.getSpans(runId)!.spans;
      const stats = calculateTraceStats(details, spans);

      expect(stats.totalSpans).toBe(5);
      expect(stats.completedSpans).toBe(4);
      expect(stats.errorSpans).toBe(1);
      expect(stats.spansByTool['Read']).toBe(2);
      expect(stats.spansByTool['Grep']).toBe(1);
      expect(stats.spansByTool['Write']).toBe(1);
      expect(stats.spansByTool['Shell']).toBe(1);
    });

    it('should count subagents correctly', () => {
      const runId = 'stats-test-2';
      const t0 = Date.now();
      createSession(runId);

      // Create 2 subagents
      for (let i = 0; i < 2; i++) {
        store.processEvent({
          eventKind: 'subagentStart',
          timestamp: t0 + i * 500,
          runId,
          agentId: `subagent-${i}`,
          agentType: ['explore', 'generalPurpose'][i],
        });
      }

      const details = store.getRunDetails(runId)!;
      const spans = store.getSpans(runId)!.spans;
      const stats = calculateTraceStats(details, spans);

      expect(stats.agentCount).toBe(3); // Main + 2 subagents
      expect(stats.subagentCount).toBe(2);
    });
  });

  describe('validateTrace', () => {
    it('should pass validation for well-formed trace', () => {
      const runId = 'validate-test-1';
      const t0 = Date.now();
      createSession(runId);

      store.processEvent({
        eventKind: 'toolStart',
        timestamp: t0,
        runId,
        spanId: 'span-1',
        toolName: 'Read',
      });

      store.processEvent({
        eventKind: 'toolEnd',
        timestamp: t0 + 50,
        runId,
        spanId: 'span-1',
        duration: 50,
      });

      store.processEvent({
        eventKind: 'sessionEnd',
        timestamp: t0 + 100,
        runId,
        status: 'completed',
      });

      const details = store.getRunDetails(runId)!;
      const spans = store.getSpans(runId)!.spans;
      const validation = validateTrace(details, spans);

      expect(validation.valid).toBe(true);
      expect(validation.issues).toHaveLength(0);
    });

    it('should fail validation for running spans in completed session', () => {
      const runId = 'validate-test-2';
      const t0 = Date.now();
      createSession(runId);

      // Start span but don't end it
      store.processEvent({
        eventKind: 'toolStart',
        timestamp: t0,
        runId,
        spanId: 'hanging-span',
        toolName: 'Read',
      });

      // Manually set run as completed without force-closing spans
      const run = store.getRun(runId)!;
      run.status = 'completed';
      run.endedAt = t0 + 100;

      const details = store.getRunDetails(runId)!;
      const spans = store.getSpans(runId)!.spans;
      const validation = validateTrace(details, spans);

      expect(validation.valid).toBe(false);
      expect(validation.issues.some(i => i.includes('running spans'))).toBe(true);
    });

    it('should validate against expected structure', () => {
      const runId = 'validate-test-3';
      const t0 = Date.now();
      createSession(runId);

      // Create 3 Read spans
      for (let i = 0; i < 3; i++) {
        store.processEvent({
          eventKind: 'toolStart',
          timestamp: t0 + i * 100,
          runId,
          spanId: `read-${i}`,
          toolName: 'Read',
        });

        store.processEvent({
          eventKind: 'toolEnd',
          timestamp: t0 + i * 100 + 50,
          runId,
          spanId: `read-${i}`,
          duration: 50,
        });
      }

      store.processEvent({
        eventKind: 'sessionEnd',
        timestamp: t0 + 500,
        runId,
        status: 'completed',
      });

      const details = store.getRunDetails(runId)!;
      const spans = store.getSpans(runId)!.spans;

      // Correct expectation
      const expected1: ExpectedTrace = {
        toolCounts: { Read: 3 },
        minSpans: 3,
        maxSpans: 3,
        noErrors: true,
      };
      const validation1 = validateTrace(details, spans, expected1);
      expect(validation1.valid).toBe(true);

      // Wrong expectation
      const expected2: ExpectedTrace = {
        toolCounts: { Read: 5 },
      };
      const validation2 = validateTrace(details, spans, expected2);
      expect(validation2.valid).toBe(false);
      expect(validation2.issues.some(i => i.includes('Expected 5 Read spans'))).toBe(true);
    });
  });

  describe('formatTraceTree', () => {
    it('should produce readable ASCII output', () => {
      const runId = 'format-test-1';
      const t0 = Date.now();
      createSession(runId);

      store.processEvent({
        eventKind: 'toolStart',
        timestamp: t0,
        runId,
        spanId: 'span-1',
        toolName: 'Read',
      });

      store.processEvent({
        eventKind: 'toolEnd',
        timestamp: t0 + 100,
        runId,
        spanId: 'span-1',
        duration: 100,
      });

      const details = store.getRunDetails(runId)!;
      const spans = store.getSpans(runId)!.spans;
      const tree = buildTraceTree(details, spans);
      const output = formatTraceTree(tree);

      expect(output).toContain('Trace:');
      expect(output).toContain('Agents:');
      expect(output).toContain('Read');
      expect(output).toContain('100ms');
    });
  });

  describe('generateTraceReport', () => {
    it('should produce comprehensive report', () => {
      const runId = 'report-test-1';
      const t0 = Date.now();
      createSession(runId);

      // Create a session with multiple spans
      store.processEvent({
        eventKind: 'beforeSubmitPrompt',
        timestamp: t0,
        runId,
        prompt: 'Test prompt',
      });

      for (let i = 0; i < 3; i++) {
        store.processEvent({
          eventKind: 'toolStart',
          timestamp: t0 + i * 100,
          runId,
          spanId: `span-${i}`,
          toolName: ['Read', 'Grep', 'Write'][i],
        });

        store.processEvent({
          eventKind: 'toolEnd',
          timestamp: t0 + i * 100 + 50,
          runId,
          spanId: `span-${i}`,
          duration: 50,
        });
      }

      store.processEvent({
        eventKind: 'sessionEnd',
        timestamp: t0 + 500,
        runId,
        status: 'completed',
      });

      const details = store.getRunDetails(runId)!;
      const spans = store.getSpans(runId)!.spans;
      const report = generateTraceReport(details, spans);

      expect(report).toContain('TRACE VERIFICATION REPORT');
      expect(report).toContain('STATISTICS:');
      expect(report).toContain('SPANS BY TOOL:');
      expect(report).toContain('AGENTS:');
      expect(report).toContain('TRACE TREE:');
      expect(report).toContain('VALIDATION:');
      expect(report).toContain('All checks passed');
    });
  });

  describe('Parent-Child Relationship Tests', () => {
    it('should correctly track Task -> Subagent -> Tool hierarchy', () => {
      const runId = 'hierarchy-test-1';
      const t0 = Date.now();
      createSession(runId);

      // Main agent issues Task
      store.processEvent({
        eventKind: 'toolStart',
        timestamp: t0,
        runId,
        spanId: 'task-1',
        toolName: 'Task',
        toolInput: { prompt: 'Search for auth code' },
      });

      // Subagent starts
      store.processEvent({
        eventKind: 'subagentStart',
        timestamp: t0 + 50,
        runId,
        agentId: 'explore-subagent',
        agentType: 'explore',
        parentSpanId: 'task-1',
      });

      // Subagent does multiple operations
      const subagentTools = ['Read', 'Grep', 'Read'];
      for (let i = 0; i < subagentTools.length; i++) {
        store.processEvent({
          eventKind: 'toolStart',
          timestamp: t0 + 100 + i * 100,
          runId,
          spanId: `sub-span-${i}`,
          toolName: subagentTools[i],
          agentId: 'explore-subagent',
          parentSpanId: 'task-1',
        });

        store.processEvent({
          eventKind: 'toolEnd',
          timestamp: t0 + 150 + i * 100,
          runId,
          spanId: `sub-span-${i}`,
          duration: 50,
        });
      }

      // Subagent ends
      store.processEvent({
        eventKind: 'subagentStop',
        timestamp: t0 + 500,
        runId,
        agentId: 'explore-subagent',
      });

      const details = store.getRunDetails(runId)!;
      const spans = store.getSpans(runId)!.spans;
      const tree = buildTraceTree(details, spans);

      // Task should be root with 3 children
      expect(tree.roots).toHaveLength(1);
      expect(tree.roots[0].span.toolName).toBe('Task');
      expect(tree.roots[0].children).toHaveLength(3);

      // Verify children belong to subagent
      for (const child of tree.roots[0].children) {
        expect(child.span.agentId).toBe('explore-subagent');
      }

      // Validate agent hierarchy
      expect(details.agents).toHaveLength(2);
      const subagent = details.agents.find(a => a.agentId === 'explore-subagent');
      expect(subagent?.parentAgentId).toBe(runId);
    });

    it('should handle parallel subagents correctly', () => {
      const runId = 'parallel-test-1';
      const t0 = Date.now();
      createSession(runId);

      // Two Tasks spawned (nearly) simultaneously
      store.processEvent({
        eventKind: 'toolStart',
        timestamp: t0,
        runId,
        spanId: 'task-a',
        toolName: 'Task',
      });

      store.processEvent({
        eventKind: 'toolStart',
        timestamp: t0 + 10,
        runId,
        spanId: 'task-b',
        toolName: 'Task',
      });

      // Subagent A starts
      store.processEvent({
        eventKind: 'subagentStart',
        timestamp: t0 + 50,
        runId,
        agentId: 'subagent-a',
        parentSpanId: 'task-a',
      });

      // Subagent B starts
      store.processEvent({
        eventKind: 'subagentStart',
        timestamp: t0 + 60,
        runId,
        agentId: 'subagent-b',
        parentSpanId: 'task-b',
      });

      // Each does work
      store.processEvent({
        eventKind: 'toolStart',
        timestamp: t0 + 100,
        runId,
        spanId: 'work-a',
        toolName: 'Read',
        agentId: 'subagent-a',
        parentSpanId: 'task-a',
      });

      store.processEvent({
        eventKind: 'toolStart',
        timestamp: t0 + 110,
        runId,
        spanId: 'work-b',
        toolName: 'Grep',
        agentId: 'subagent-b',
        parentSpanId: 'task-b',
      });

      // Complete all
      for (const spanId of ['work-a', 'work-b']) {
        store.processEvent({
          eventKind: 'toolEnd',
          timestamp: t0 + 200,
          runId,
          spanId,
          duration: 100,
        });
      }

      for (const agentId of ['subagent-a', 'subagent-b']) {
        store.processEvent({
          eventKind: 'subagentStop',
          timestamp: t0 + 300,
          runId,
          agentId,
        });
      }

      const details = store.getRunDetails(runId)!;
      const spans = store.getSpans(runId)!.spans;
      const tree = buildTraceTree(details, spans);

      // Should have 2 root Tasks
      expect(tree.roots).toHaveLength(2);

      // Each Task should have 1 child
      const taskA = tree.roots.find(r => r.span.spanId === 'task-a');
      const taskB = tree.roots.find(r => r.span.spanId === 'task-b');

      expect(taskA?.children).toHaveLength(1);
      expect(taskB?.children).toHaveLength(1);

      // Work is correctly attributed
      expect(taskA?.children[0].span.toolName).toBe('Read');
      expect(taskB?.children[0].span.toolName).toBe('Grep');
    });

    it('should handle nested subagents (subagent spawning subagent)', () => {
      const runId = 'nested-subagent-test';
      const t0 = Date.now();
      createSession(runId);

      // Main -> Task1 -> Subagent1 -> Task2 -> Subagent2
      store.processEvent({
        eventKind: 'toolStart',
        timestamp: t0,
        runId,
        spanId: 'task-1',
        toolName: 'Task',
      });

      store.processEvent({
        eventKind: 'subagentStart',
        timestamp: t0 + 50,
        runId,
        agentId: 'subagent-1',
        parentSpanId: 'task-1',
      });

      // Subagent1 spawns Task2
      store.processEvent({
        eventKind: 'toolStart',
        timestamp: t0 + 100,
        runId,
        spanId: 'task-2',
        toolName: 'Task',
        agentId: 'subagent-1',
        parentSpanId: 'task-1',
      });

      store.processEvent({
        eventKind: 'subagentStart',
        timestamp: t0 + 150,
        runId,
        agentId: 'subagent-2',
        parentSpanId: 'task-2',
        parentAgentId: 'subagent-1',
      });

      // Subagent2 does work
      store.processEvent({
        eventKind: 'toolStart',
        timestamp: t0 + 200,
        runId,
        spanId: 'leaf-work',
        toolName: 'Read',
        agentId: 'subagent-2',
        parentSpanId: 'task-2',
      });

      store.processEvent({
        eventKind: 'toolEnd',
        timestamp: t0 + 250,
        runId,
        spanId: 'leaf-work',
        duration: 50,
      });

      // Unwind
      store.processEvent({
        eventKind: 'subagentStop',
        timestamp: t0 + 300,
        runId,
        agentId: 'subagent-2',
      });

      store.processEvent({
        eventKind: 'subagentStop',
        timestamp: t0 + 400,
        runId,
        agentId: 'subagent-1',
      });

      const details = store.getRunDetails(runId)!;
      const spans = store.getSpans(runId)!.spans;
      const tree = buildTraceTree(details, spans);
      const stats = calculateTraceStats(details, spans);

      // Verify depth
      expect(stats.maxDepth).toBeGreaterThanOrEqual(2);

      // Verify agent hierarchy
      const subagent1 = details.agents.find(a => a.agentId === 'subagent-1');
      const subagent2 = details.agents.find(a => a.agentId === 'subagent-2');

      expect(subagent1?.parentAgentId).toBe(runId);
      expect(subagent2?.parentAgentId).toBe('subagent-1');
    });
  });
});
