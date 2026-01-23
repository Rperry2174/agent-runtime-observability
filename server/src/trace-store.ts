/**
 * TraceStore - In-memory + JSONL persistence for agent telemetry
 * 
 * Handles:
 * - Span correlation (preToolUse ↔ postToolUse/postToolUseFailure)
 * - Active span tracking per agent
 * - JSONL persistence for replay
 * - Query support for API endpoints
 */

import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  Run,
  RunStatus,
  RunSummary,
  RunDetails,
  Agent,
  Span,
  SpanStatus,
  SpanListResponse,
  TelemetryEvent,
  TraceUpdate,
  AgentSource,
} from './types.js';

// Max runs to keep in memory
const MAX_RUNS_IN_MEMORY = 50;
// Max age for runs in memory (1 hour)
const MAX_RUN_AGE_MS = 60 * 60 * 1000;

export class TraceStore {
  private runs: Map<string, Run> = new Map();
  private spans: Map<string, Span[]> = new Map(); // runId -> spans
  private activeSpans: Map<string, Map<string, Span>> = new Map(); // runId -> (spanId -> span)
  private pendingSpans: Map<string, Span> = new Map(); // spanId -> span (waiting for end event)
  
  private tracesDir: string;
  private onUpdate: ((update: TraceUpdate) => void) | null = null;

  constructor(projectRoot: string) {
    this.tracesDir = path.join(projectRoot, '.codemap', 'traces');
    this.ensureTracesDir();
    this.loadRecentRuns();
    
    // Periodic cleanup
    setInterval(() => this.cleanup(), 60000);
  }

  private ensureTracesDir(): void {
    if (!fs.existsSync(this.tracesDir)) {
      fs.mkdirSync(this.tracesDir, { recursive: true });
    }
  }

  private loadRecentRuns(): void {
    try {
      if (!fs.existsSync(this.tracesDir)) return;
      
      const files = fs.readdirSync(this.tracesDir)
        .filter(f => f.endsWith('.jsonl'))
        .sort()
        .slice(-MAX_RUNS_IN_MEMORY);
      
      for (const file of files) {
        const runId = file.replace('.jsonl', '');
        this.loadRunFromFile(runId);
      }
      
      console.log(`[TraceStore] Loaded ${this.runs.size} recent runs from disk`);
    } catch (err) {
      console.error('[TraceStore] Failed to load recent runs:', err);
    }
  }

  private loadRunFromFile(runId: string): void {
    const filePath = path.join(this.tracesDir, `${runId}.jsonl`);
    if (!fs.existsSync(filePath)) return;
    
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(l => l);
      
      let run: Run | null = null;
      const runSpans: Span[] = [];
      
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          
          if (entry.type === 'run') {
            run = {
              ...entry.data,
              agents: new Map(Object.entries(entry.data.agents || {})),
            };
          } else if (entry.type === 'span') {
            runSpans.push(entry.data);
          } else if (entry.type === 'agent') {
            if (run) {
              run.agents.set(entry.data.agentId, entry.data);
            }
          }
        } catch {
          // Skip malformed lines
        }
      }
      
      if (run) {
        this.runs.set(runId, run);
        this.spans.set(runId, runSpans);
      }
    } catch (err) {
      console.error(`[TraceStore] Failed to load run ${runId}:`, err);
    }
  }

  private appendToFile(runId: string, type: string, data: unknown): void {
    const filePath = path.join(this.tracesDir, `${runId}.jsonl`);
    const line = JSON.stringify({ type, data, ts: Date.now() }) + '\n';
    
    try {
      fs.appendFileSync(filePath, line);
    } catch (err) {
      console.error(`[TraceStore] Failed to append to ${runId}:`, err);
    }
  }

  /** Set callback for real-time updates */
  setUpdateCallback(callback: (update: TraceUpdate) => void): void {
    this.onUpdate = callback;
  }

  private broadcast(update: TraceUpdate): void {
    if (this.onUpdate) {
      this.onUpdate(update);
    }
  }

  // ============================================================================
  // Event Processing
  // ============================================================================

  /** Process incoming telemetry event */
  processEvent(event: TelemetryEvent): void {
    const now = Date.now();
    const runId = event.runId || 'unknown';
    
    switch (event.eventKind) {
      case 'sessionStart':
        this.handleSessionStart(event, now);
        break;
      case 'sessionEnd':
      case 'stop':
        this.handleSessionEnd(event, now);
        break;
      case 'toolStart':
        this.handleToolStart(event, now);
        break;
      case 'toolEnd':
        this.handleToolEnd(event, now);
        break;
      case 'toolFailure':
        this.handleToolFailure(event, now);
        break;
      case 'subagentStart':
        this.handleSubagentStart(event, now);
        break;
      case 'subagentStop':
        this.handleSubagentStop(event, now);
        break;
      case 'thinkingStart':
        this.handleThinkingStart(event, now);
        break;
      case 'thinkingEnd':
        this.handleThinkingEnd(event, now);
        break;
      case 'contextCompact':
        this.handleContextCompact(event, now);
        break;
      case 'agentResponse':
        this.handleAgentResponse(event, now);
        break;
    }
  }

  private handleSessionStart(event: TelemetryEvent, now: number): void {
    const runId = event.runId || uuidv4();
    
    if (this.runs.has(runId)) {
      // Run already exists - if this is a new agentId, add the agent
      const run = this.runs.get(runId)!;
      if (event.projectRoot) run.projectRoot = event.projectRoot;
      
      // Check if this is a new agent joining the run
      const agentId = event.agentId || runId;
      if (!run.agents.has(agentId) && event.agentId) {
        const customName = event.toolInput && typeof event.toolInput === 'object' 
          ? (event.toolInput as Record<string, unknown>).displayName as string | undefined
          : undefined;
        
        const newAgent: Agent = {
          agentId,
          runId,
          displayName: customName || this.getAgentDisplayName(event.source, run.agents.size + 1, event.agentType),
          agentType: event.agentType,
          model: event.model,
          startedAt: event.timestamp || now,
        };
        
        run.agents.set(agentId, newAgent);
        this.appendToFile(runId, 'agent', newAgent);
        this.broadcast({ type: 'agentStart', runId, agent: newAgent });
        console.log(`[TraceStore] Agent joined run: ${newAgent.displayName}`);
      }
      return;
    }
    
    const run: Run = {
      runId,
      startedAt: event.timestamp || now,
      status: 'running',
      source: event.source || 'unknown',
      projectRoot: event.projectRoot || event.workspaceRoots?.[0],
      agents: new Map(),
    };
    
    // Check for custom displayName in toolInput (for demo)
    const customName = event.toolInput && typeof event.toolInput === 'object' 
      ? (event.toolInput as Record<string, unknown>).displayName as string | undefined
      : undefined;
    
    // Create main agent
    const mainAgent: Agent = {
      agentId: runId, // Main agent uses runId as agentId
      runId,
      displayName: customName || this.getAgentDisplayName(event.source, 1),
      agentType: event.agentType,
      model: event.model,
      startedAt: event.timestamp || now,
    };
    
    run.agents.set(mainAgent.agentId, mainAgent);
    
    this.runs.set(runId, run);
    this.spans.set(runId, []);
    this.activeSpans.set(runId, new Map());
    
    // Persist
    this.appendToFile(runId, 'run', this.serializeRun(run));
    this.appendToFile(runId, 'agent', mainAgent);
    
    // Broadcast
    this.broadcast({
      type: 'runStart',
      runId,
      run: this.getRunSummary(runId)!,
    });
    
    this.broadcast({
      type: 'agentStart',
      runId,
      agent: mainAgent,
    });
    
    console.log(`[TraceStore] Run started: ${runId} (${event.source})`);
  }

  private handleSessionEnd(event: TelemetryEvent, now: number): void {
    const runId = event.runId;
    if (!runId) return;
    
    const run = this.runs.get(runId);
    if (!run) return;
    
    run.endedAt = event.timestamp || now;
    run.status = this.mapRunStatus(event.status);
    
    // End all agents
    for (const agent of run.agents.values()) {
      if (!agent.endedAt) {
        agent.endedAt = run.endedAt;
      }
    }
    
    // End all active spans
    const activeMap = this.activeSpans.get(runId);
    if (activeMap) {
      for (const span of activeMap.values()) {
        span.endedAt = run.endedAt;
        span.status = run.status === 'error' ? 'aborted' : 'ok';
        span.durationMs = span.endedAt - span.startedAt;
      }
      activeMap.clear();
    }
    
    // Persist final state
    this.appendToFile(runId, 'run', this.serializeRun(run));
    
    // Broadcast
    this.broadcast({
      type: 'runEnd',
      runId,
      run: this.getRunSummary(runId)!,
    });
    
    console.log(`[TraceStore] Run ended: ${runId} (${run.status})`);
  }

  private handleToolStart(event: TelemetryEvent, now: number): void {
    const runId = event.runId;
    if (!runId) return;
    
    // Ensure run exists
    if (!this.runs.has(runId)) {
      this.handleSessionStart({ ...event, eventKind: 'sessionStart' }, now);
    }
    
    const run = this.runs.get(runId)!;
    const agentId = event.agentId || runId;
    
    // Ensure agent exists
    if (!run.agents.has(agentId)) {
      const agent: Agent = {
        agentId,
        runId,
        displayName: this.getAgentDisplayName(event.source, run.agents.size + 1),
        agentType: event.agentType,
        model: event.model,
        startedAt: now,
      };
      run.agents.set(agentId, agent);
      this.appendToFile(runId, 'agent', agent);
      this.broadcast({ type: 'agentStart', runId, agent });
    }
    
    const spanId = event.spanId || uuidv4();
    
    const span: Span = {
      spanId,
      runId,
      agentId,
      parentSpanId: event.parentSpanId,
      toolName: event.toolName || 'Unknown',
      hookEventName: event.hookEventName,
      turnId: event.turnId,
      startedAt: event.timestamp || now,
      status: 'running',
      inputPreview: this.sanitizePreview(event.toolInput),
      files: this.extractFilePaths(event.toolInput),
      attachmentsUsed: event.attachments,
    };
    
    // Track active span
    const runSpans = this.spans.get(runId) || [];
    runSpans.push(span);
    this.spans.set(runId, runSpans);
    
    const activeMap = this.activeSpans.get(runId) || new Map();
    activeMap.set(spanId, span);
    this.activeSpans.set(runId, activeMap);
    
    // Also track by spanId for correlation
    this.pendingSpans.set(spanId, span);
    
    // Persist
    this.appendToFile(runId, 'span', span);
    
    // Broadcast
    this.broadcast({ type: 'spanStart', runId, span });
    
    console.log(`[TraceStore] Span started: ${span.toolName} (${spanId.slice(0, 8)})`);
  }

  private handleToolEnd(event: TelemetryEvent, now: number): void {
    const spanId = event.spanId;
    const runId = event.runId;
    
    // Find the span to complete
    let span: Span | undefined;
    
    if (spanId && this.pendingSpans.has(spanId)) {
      span = this.pendingSpans.get(spanId);
      this.pendingSpans.delete(spanId);
    } else if (runId) {
      // Fallback: find most recent running span for this tool
      const activeMap = this.activeSpans.get(runId);
      if (activeMap) {
        for (const [id, s] of activeMap) {
          if (s.status === 'running' && (!event.toolName || s.toolName === event.toolName)) {
            span = s;
            this.pendingSpans.delete(id);
            break;
          }
        }
      }
    }
    
    if (!span) {
      console.log(`[TraceStore] No pending span found for toolEnd: ${spanId || event.toolName}`);
      return;
    }
    
    span.endedAt = event.timestamp || now;
    span.status = 'ok';
    span.durationMs = event.duration || event.durationMs || (span.endedAt - span.startedAt);
    
    if (event.toolOutput) {
      span.outputPreview = this.sanitizePreview(event.toolOutput);
    }
    
    // Remove from active
    const activeMap = this.activeSpans.get(span.runId);
    if (activeMap) {
      activeMap.delete(span.spanId);
    }
    
    // Persist update
    this.appendToFile(span.runId, 'span', span);
    
    // Broadcast
    this.broadcast({ type: 'spanEnd', runId: span.runId, span });
    
    console.log(`[TraceStore] Span ended: ${span.toolName} (${span.durationMs}ms)`);
  }

  private handleToolFailure(event: TelemetryEvent, now: number): void {
    const spanId = event.spanId;
    const runId = event.runId;
    
    let span: Span | undefined;
    
    if (spanId && this.pendingSpans.has(spanId)) {
      span = this.pendingSpans.get(spanId);
      this.pendingSpans.delete(spanId);
    } else if (runId) {
      const activeMap = this.activeSpans.get(runId);
      if (activeMap) {
        for (const [id, s] of activeMap) {
          if (s.status === 'running' && (!event.toolName || s.toolName === event.toolName)) {
            span = s;
            this.pendingSpans.delete(id);
            break;
          }
        }
      }
    }
    
    if (!span) {
      console.log(`[TraceStore] No pending span found for toolFailure: ${spanId || event.toolName}`);
      return;
    }
    
    span.endedAt = event.timestamp || now;
    span.status = this.mapFailureType(event.failureType);
    span.durationMs = event.duration || event.durationMs || (span.endedAt - span.startedAt);
    span.errorMessage = event.errorMessage;
    
    const activeMap = this.activeSpans.get(span.runId);
    if (activeMap) {
      activeMap.delete(span.spanId);
    }
    
    this.appendToFile(span.runId, 'span', span);
    this.broadcast({ type: 'spanEnd', runId: span.runId, span });
    
    console.log(`[TraceStore] Span failed: ${span.toolName} (${span.status})`);
  }

  private handleSubagentStart(event: TelemetryEvent, now: number): void {
    const runId = event.runId;
    if (!runId) return;
    
    const run = this.runs.get(runId);
    if (!run) return;
    
    const agentId = event.agentId || uuidv4();
    
    // Check for custom displayName in toolInput (for demo)
    const customName = event.toolInput && typeof event.toolInput === 'object' 
      ? (event.toolInput as Record<string, unknown>).displayName as string | undefined
      : undefined;
    
    const agent: Agent = {
      agentId,
      runId,
      displayName: customName || this.getAgentDisplayName(event.source, run.agents.size + 1, event.agentType),
      agentType: event.agentType,
      model: event.model,
      parentAgentId: event.parentAgentId || runId,
      startedAt: event.timestamp || now,
    };
    
    run.agents.set(agentId, agent);
    
    this.appendToFile(runId, 'agent', agent);
    this.broadcast({ type: 'agentStart', runId, agent });
    
    console.log(`[TraceStore] Subagent started: ${agent.displayName}`);
  }

  private handleSubagentStop(event: TelemetryEvent, now: number): void {
    const runId = event.runId;
    const agentId = event.agentId;
    if (!runId || !agentId) return;
    
    const run = this.runs.get(runId);
    if (!run) return;
    
    const agent = run.agents.get(agentId);
    if (!agent) return;
    
    agent.endedAt = event.timestamp || now;
    
    this.appendToFile(runId, 'agent', agent);
    this.broadcast({ type: 'agentEnd', runId, agent });
    
    console.log(`[TraceStore] Subagent ended: ${agent.displayName}`);
  }

  private handleThinkingStart(event: TelemetryEvent, now: number): void {
    // Treat thinking as a special span
    const thinkingEvent: TelemetryEvent = {
      ...event,
      eventKind: 'toolStart',
      toolName: 'Thinking',
      hookEventName: 'afterAgentThought',
    };
    this.handleToolStart(thinkingEvent, now);
  }

  private handleThinkingEnd(event: TelemetryEvent, now: number): void {
    const runId = event.runId;
    const agentId = event.agentId || runId;
    if (!runId) return;
    
    // Find the thinking span for this agent
    const activeMap = this.activeSpans.get(runId);
    if (!activeMap) return;
    
    for (const [spanId, span] of activeMap) {
      if (span.toolName === 'Thinking' && span.agentId === agentId && span.status === 'running') {
        span.endedAt = event.timestamp || now;
        span.status = 'ok';
        span.durationMs = event.thinkingDurationMs || (span.endedAt - span.startedAt);
        span.outputPreview = event.thinkingText?.slice(0, 200) + (event.thinkingText && event.thinkingText.length > 200 ? '...' : '');
        
        activeMap.delete(spanId);
        this.pendingSpans.delete(spanId);
        
        this.appendToFile(runId, 'span', span);
        this.broadcast({ type: 'spanEnd', runId, span });
        
        console.log(`[TraceStore] Thinking ended: ${span.durationMs}ms`);
        break;
      }
    }
  }

  private handleContextCompact(event: TelemetryEvent, now: number): void {
    const runId = event.runId;
    const agentId = event.agentId || runId;
    if (!runId) return;
    
    // Ensure run exists
    if (!this.runs.has(runId)) return;
    
    const spanId = event.spanId || uuidv4();
    
    // Create a span for context compaction
    const span: Span = {
      spanId,
      runId,
      agentId,
      toolName: 'ContextCompact',
      hookEventName: 'preCompact',
      startedAt: event.timestamp || now,
      endedAt: event.timestamp || now,
      durationMs: 0,
      status: 'ok',
      inputPreview: `${event.contextUsagePercent}% usage, ${event.contextTokens} tokens, compacting ${event.messagesToCompact} messages`,
    };
    
    const runSpans = this.spans.get(runId) || [];
    runSpans.push(span);
    this.spans.set(runId, runSpans);
    
    this.appendToFile(runId, 'span', span);
    this.broadcast({ type: 'spanStart', runId, span });
    this.broadcast({ type: 'spanEnd', runId, span });
    
    console.log(`[TraceStore] Context compaction: ${event.contextUsagePercent}%`);
  }

  private handleAgentResponse(event: TelemetryEvent, now: number): void {
    // AgentResponse is informational - we don't create a span for it
    // But we could log it or track it in another way
    console.log(`[TraceStore] Agent response received`);
  }

  // ============================================================================
  // Query Methods
  // ============================================================================

  /** Get list of recent runs */
  getRecentRuns(limit: number = 20): RunSummary[] {
    const summaries: RunSummary[] = [];
    
    for (const runId of this.runs.keys()) {
      const summary = this.getRunSummary(runId);
      if (summary) {
        summaries.push(summary);
      }
    }
    
    return summaries
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit);
  }

  /** Get run summary by ID */
  getRunSummary(runId: string): RunSummary | null {
    const run = this.runs.get(runId);
    if (!run) return null;
    
    const runSpans = this.spans.get(runId) || [];
    const errorCount = runSpans.filter(s => 
      s.status === 'error' || s.status === 'timeout' || s.status === 'permission_denied'
    ).length;
    
    return {
      runId: run.runId,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      status: run.status,
      source: run.source,
      agentCount: run.agents.size,
      spanCount: runSpans.length,
      errorCount,
      durationMs: run.endedAt ? run.endedAt - run.startedAt : undefined,
    };
  }

  /** Get full run details by ID */
  getRunDetails(runId: string): RunDetails | null {
    const summary = this.getRunSummary(runId);
    if (!summary) return null;
    
    const run = this.runs.get(runId)!;
    
    return {
      ...summary,
      projectRoot: run.projectRoot,
      agents: Array.from(run.agents.values()),
    };
  }

  /** Get spans for a run */
  getSpans(runId: string, since?: number): SpanListResponse | null {
    const run = this.runs.get(runId);
    if (!run) return null;
    
    let runSpans = this.spans.get(runId) || [];
    
    if (since) {
      runSpans = runSpans.filter(s => s.startedAt >= since);
    }
    
    return {
      runId,
      spans: runSpans,
      agents: Array.from(run.agents.values()),
      hasMore: false,
    };
  }

  /** Get a specific run (for internal use) */
  getRun(runId: string): Run | undefined {
    return this.runs.get(runId);
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private getAgentDisplayName(source: AgentSource | undefined, num: number, agentType?: string): string {
    const sourceName = source === 'cursor' ? 'Cursor' :
                       source === 'claude' ? 'Claude' :
                       source === 'demo' ? 'Demo' : 'Agent';
    
    if (agentType) {
      const typeName = agentType.charAt(0).toUpperCase() + agentType.slice(1);
      return `${sourceName} ${typeName} ${num}`;
    }
    
    return `${sourceName} ${num}`;
  }

  private mapRunStatus(status?: string): RunStatus {
    switch (status) {
      case 'completed': return 'completed';
      case 'aborted': return 'aborted';
      case 'error': return 'error';
      default: return 'completed';
    }
  }

  private mapFailureType(failureType?: string): SpanStatus {
    switch (failureType) {
      case 'timeout': return 'timeout';
      case 'permission_denied': return 'permission_denied';
      default: return 'error';
    }
  }

  private sanitizePreview(input: unknown, maxLength: number = 200): string | undefined {
    if (!input) return undefined;
    
    let str: string;
    if (typeof input === 'string') {
      str = input;
    } else {
      try {
        str = JSON.stringify(input);
      } catch {
        return undefined;
      }
    }
    
    // Remove potential secrets (conservative patterns)
    str = str.replace(/(?:api[_-]?key|token|secret|password|auth)['":\s]*['":]?\s*['"]?[\w\-_.]{8,}['"]?/gi, '[REDACTED]');
    str = str.replace(/Bearer\s+[\w\-_.]+/gi, 'Bearer [REDACTED]');
    str = str.replace(/sk-[a-zA-Z0-9]{20,}/g, 'sk-[REDACTED]');
    
    // Truncate
    if (str.length > maxLength) {
      str = str.slice(0, maxLength) + '...';
    }
    
    return str;
  }

  private extractFilePaths(input: unknown): string[] | undefined {
    if (!input || typeof input !== 'object') return undefined;
    
    const paths: string[] = [];
    const obj = input as Record<string, unknown>;
    
    // Common field names for file paths
    const fileFields = ['file_path', 'filePath', 'path', 'file', 'target'];
    
    for (const field of fileFields) {
      if (typeof obj[field] === 'string') {
        paths.push(obj[field] as string);
      }
    }
    
    return paths.length > 0 ? paths : undefined;
  }

  private serializeRun(run: Run): object {
    return {
      ...run,
      agents: Object.fromEntries(run.agents),
    };
  }

  private cleanup(): void {
    const now = Date.now();
    let removed = 0;
    
    for (const [runId, run] of this.runs) {
      // Remove old completed runs from memory (they're still on disk)
      if (run.status !== 'running' && now - run.startedAt > MAX_RUN_AGE_MS) {
        this.runs.delete(runId);
        this.spans.delete(runId);
        this.activeSpans.delete(runId);
        removed++;
      }
    }
    
    // Also cleanup stale pending spans
    for (const [spanId, span] of this.pendingSpans) {
      if (now - span.startedAt > MAX_RUN_AGE_MS) {
        this.pendingSpans.delete(spanId);
      }
    }
    
    if (removed > 0) {
      console.log(`[TraceStore] Cleaned up ${removed} old runs from memory`);
    }
  }
}
