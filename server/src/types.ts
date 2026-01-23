/**
 * Agent Observability Types
 * 
 * Normalized telemetry model for real-time agent tracing.
 * Supports Cursor and Claude Code hooks.
 */

// ============================================================================
// Core Data Model
// ============================================================================

/** Source of telemetry events */
export type AgentSource = 'cursor' | 'claude' | 'demo' | 'unknown';

/** Span execution status */
export type SpanStatus = 'running' | 'ok' | 'error' | 'timeout' | 'permission_denied' | 'aborted';

/** Run completion status */
export type RunStatus = 'running' | 'completed' | 'aborted' | 'error';

/**
 * A Run represents a single agent session (conversation).
 * Maps to Cursor's conversation_id or Claude's session_id.
 */
export interface Run {
  runId: string;
  startedAt: number;
  endedAt?: number;
  status: RunStatus;
  source: AgentSource;
  projectRoot?: string;
  transcriptPath?: string;  // Path to the conversation transcript file
  initialPrompt?: string;
  initialPromptAt?: number;
  agents: Map<string, Agent>;
}

/**
 * An Agent within a run.
 * A run can have multiple agents (main + subagents via Task tool).
 */
export interface Agent {
  agentId: string;
  runId: string;
  displayName: string;
  agentType?: string;  // e.g., 'generalPurpose', 'explore', 'shell'
  model?: string;
  parentAgentId?: string;  // For subagents spawned via Task
  transcriptPath?: string;  // Path to subagent's transcript file
  startedAt: number;
  endedAt?: number;
}

/**
 * A Span represents a single tool execution.
 * Tracks start/end, status, and relevant metadata.
 */
export interface Span {
  spanId: string;
  runId: string;
  agentId: string;
  parentSpanId?: string;  // For Task nesting - links to the Task span that spawned this
  
  toolName: string;
  hookEventName?: string;  // e.g., 'preToolUse', 'postToolUse'
  turnId?: string;  // Cursor's generation_id
  
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  status: SpanStatus;
  
  inputPreview?: string;  // Sanitized preview of tool input
  outputPreview?: string;  // Sanitized preview of tool output (optional)
  errorMessage?: string;  // Error details if status is error/timeout/etc
  
  files?: string[];  // Relative file paths involved
  attachmentsUsed?: AttachmentInfo[];  // Rules/files from Cursor hook attachments
}

/** Attachment info from Cursor hooks (rules, files) */
export interface AttachmentInfo {
  type: 'file' | 'rule';
  filePath: string;
}

// ============================================================================
// Ingest Event Types (from hooks)
// ============================================================================

/** Event kinds that hooks can emit */
export type TelemetryEventKind = 
  | 'sessionStart'
  | 'sessionEnd'
  | 'toolStart'
  | 'toolEnd'
  | 'toolFailure'
  | 'subagentStart'
  | 'subagentStop'
  | 'stop'
  | 'thinkingStart'
  | 'thinkingEnd'
  | 'contextCompact'
  | 'agentResponse'
  | 'beforeSubmitPrompt'
  // Shell execution hooks
  | 'shellStart'
  | 'shellEnd'
  // MCP execution hook
  | 'mcpEnd'
  // File edit hooks
  | 'fileEditEnd'
  // Tab file hooks
  | 'tabReadStart'
  | 'tabEditEnd';

/**
 * Raw telemetry event from hooks.
 * The hook script wraps the raw Cursor/Claude JSON with an eventKind.
 */
export interface TelemetryEvent {
  eventKind: TelemetryEventKind;
  timestamp: number;
  
  // Identifiers (at least one required)
  runId?: string;  // conversation_id (Cursor) or session_id (Claude)
  agentId?: string;  // For subagents
  spanId?: string;  // tool_use_id when available
  
  // Tool info
  toolName?: string;
  toolInput?: unknown;  // Raw tool input (will be sanitized)
  toolOutput?: unknown;  // Raw tool output (will be sanitized)
  prompt?: string;
  
  // Metadata
  hookEventName?: string;
  turnId?: string;  // generation_id
  model?: string;
  agentType?: string;  // subagent_type for Task
  source?: AgentSource;
  
  // Duration (from afterShellExecution, afterMCPExecution, etc)
  duration?: number;
  durationMs?: number;
  
  // Error info
  errorMessage?: string;
  failureType?: 'error' | 'timeout' | 'permission_denied';
  
  // Session/run info
  status?: string;  // For stop events: completed/aborted/error
  projectRoot?: string;
  workspaceRoots?: string[];
  transcriptPath?: string;  // Path to conversation transcript
  agentTranscriptPath?: string;  // Path to subagent transcript
  
  // Attachments (from beforeReadFile, beforeSubmitPrompt)
  attachments?: Array<{ type: 'file' | 'rule'; filePath: string }>;
  
  // Parent references
  parentSpanId?: string;
  parentAgentId?: string;
  
  // Thinking (from afterAgentThought)
  thinkingText?: string;
  thinkingDurationMs?: number;
  
  // Agent response (from afterAgentResponse)
  responseText?: string;
  
  // Context compaction (from preCompact)
  contextUsagePercent?: number;
  contextTokens?: number;
  messagesToCompact?: number;
  
  // Raw payload for debugging (not persisted)
  _raw?: unknown;
}

// ============================================================================
// API Response Types
// ============================================================================

/** Run summary for /api/runs endpoint */
export interface RunSummary {
  runId: string;
  startedAt: number;
  endedAt?: number;
  status: RunStatus;
  source: AgentSource;
  agentCount: number;
  spanCount: number;
  errorCount: number;
  durationMs?: number;
  initialPrompt?: string;
  initialPromptAt?: number;
}

/** Full run details for /api/runs/:runId */
export interface RunDetails extends RunSummary {
  projectRoot?: string;
  transcriptPath?: string;
  agents: Agent[];
}

/** Span list response for /api/runs/:runId/spans */
export interface SpanListResponse {
  runId: string;
  spans: Span[];
  agents: Agent[];
  hasMore: boolean;
}

// ============================================================================
// WebSocket Message Types
// ============================================================================

export type WsMessageType = 'trace' | 'runUpdate' | 'connected';

export interface WsMessage {
  type: WsMessageType;
  data: unknown;
}

/** Trace update broadcast to clients */
export interface TraceUpdate {
  type: 'spanStart' | 'spanEnd' | 'spanUpdate' | 'agentStart' | 'agentEnd' | 'runStart' | 'runEnd' | 'runUpdate';
  runId: string;
  span?: Span;
  agent?: Agent;
  run?: RunSummary;
}
