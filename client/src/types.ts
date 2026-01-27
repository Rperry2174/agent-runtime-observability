/**
 * Client Types for Agent Observability
 * 
 * Mirrors server types for the dashboard UI.
 */

// ============================================================================
// Core Data Model
// ============================================================================

export type AgentSource = 'cursor' | 'demo' | 'unknown';
export type SpanStatus = 'running' | 'ok' | 'error' | 'timeout' | 'permission_denied' | 'aborted';
export type RunStatus = 'running' | 'completed' | 'aborted' | 'error';

export interface Agent {
  agentId: string;
  runId: string;
  displayName: string;
  agentType?: string;
  model?: string;
  parentAgentId?: string;
  transcriptPath?: string;
  startedAt: number;
  endedAt?: number;
}

export interface Span {
  spanId: string;
  runId: string;
  agentId: string;
  parentSpanId?: string;
  
  toolName: string;
  hookEventName?: string;
  turnId?: string;
  
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  status: SpanStatus;
  
  inputPreview?: string;
  outputPreview?: string;
  errorMessage?: string;
  
  files?: string[];
  attachmentsUsed?: AttachmentInfo[];
}

export interface AttachmentInfo {
  type: 'file' | 'rule';
  filePath: string;
}

// ============================================================================
// API Response Types
// ============================================================================

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

export interface RunDetails extends RunSummary {
  projectRoot?: string;
  transcriptPath?: string;
  agents: Agent[];
}

export interface SpanListResponse {
  runId: string;
  spans: Span[];
  agents: Agent[];
  hasMore: boolean;
}

// ============================================================================
// WebSocket Message Types
// ============================================================================

export interface TraceUpdate {
  type: 'spanStart' | 'spanEnd' | 'spanUpdate' | 'agentStart' | 'agentEnd' | 'runStart' | 'runEnd' | 'runUpdate';
  runId: string;
  span?: Span;
  agent?: Agent;
  run?: RunSummary;
}

export interface WsMessage {
  type: 'trace' | 'runUpdate' | 'connected';
  data: unknown;
}

// ============================================================================
// UI State Types
// ============================================================================

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';

/** Tool category for color coding */
export type ToolCategory = 'read' | 'write' | 'edit' | 'search' | 'shell' | 'task' | 'mcp' | 'thinking' | 'system' | 'other';

/** Get tool category for color coding */
export function getToolCategory(toolName: string): ToolCategory {
  const name = toolName.toLowerCase();
  
  if (name === 'thinking') {
    return 'thinking';
  }
  if (name === 'contextcompact') {
    return 'system';
  }
  if (name === 'read' || name === 'ls' || name === 'glob' || name === 'list') {
    return 'read';
  }
  if (name === 'write') {
    return 'write';
  }
  if (name === 'edit' || name === 'multiedit' || name === 'strreplace') {
    return 'edit';
  }
  if (name === 'grep' || name === 'semanticsearch' || name === 'websearch') {
    return 'search';
  }
  if (name === 'shell' || name === 'bash' || name === 'command') {
    return 'shell';
  }
  if (name === 'task') {
    return 'task';
  }
  if (name.startsWith('mcp') || name.includes('mcp')) {
    return 'mcp';
  }
  
  return 'other';
}

/** Color palette for tool categories */
export const TOOL_COLORS: Record<ToolCategory, string> = {
  read: '#60a5fa',     // Blue
  write: '#4ade80',    // Green
  edit: '#2dd4bf',     // Teal/Cyan
  search: '#a78bfa',   // Purple (Grep)
  shell: '#fb923c',    // Orange (Bash)
  task: '#ec4899',     // Pink/Magenta
  mcp: '#fb923c',      // Orange (same as shell)
  thinking: '#fbbf24', // Yellow/Amber (Thinking)
  system: '#6b7280',   // Gray (Context compact, etc)
  other: '#94a3b8',    // Slate
};

/** Status colors */
export const STATUS_COLORS: Record<SpanStatus, string> = {
  running: '#60a5fa',        // Blue
  ok: '#4ade80',             // Green
  error: '#f87171',          // Red
  timeout: '#fb923c',        // Orange
  permission_denied: '#fbbf24', // Amber
  aborted: '#94a3b8',        // Slate
};

/** Run status colors */
export const RUN_STATUS_COLORS: Record<RunStatus, string> = {
  running: '#60a5fa',
  completed: '#4ade80',
  aborted: '#94a3b8',
  error: '#f87171',
};
