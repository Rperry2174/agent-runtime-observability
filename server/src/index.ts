/**
 * Agent Observability Server
 * 
 * Telemetry-first server for real-time agent tracing.
 * Receives events from Cursor/Claude hooks and broadcasts to dashboard.
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { createServer } from 'http';
import { WebSocketManager } from './websocket.js';
import { TraceStore } from './trace-store.js';
import { DemoGenerator } from './demo-generator.js';
import { TelemetryEvent, AgentSource, TelemetryEventKind } from './types.js';

const PORT = 5174;

// Project root detection
function detectProjectRoot(): string {
  if (process.env.PROJECT_ROOT) return process.env.PROJECT_ROOT;
  if (process.argv[2]) return process.argv[2];

  const cwd = process.cwd();
  if (cwd.endsWith('/server') || cwd.endsWith('\\server')) {
    return path.dirname(cwd);
  }
  return cwd;
}

const PROJECT_ROOT = detectProjectRoot();

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const server = createServer(app);
const wsManager = new WebSocketManager(server);
const traceStore = new TraceStore(PROJECT_ROOT);

// Wire up trace updates to WebSocket broadcast
traceStore.setUpdateCallback((update) => {
  wsManager.broadcastTrace(update);
});

// Demo generator
const demoGenerator = new DemoGenerator(traceStore, PROJECT_ROOT);

// ============================================================================
// Telemetry Ingest API
// ============================================================================

/**
 * POST /api/telemetry
 * 
 * Main ingest endpoint for hook events.
 * Accepts raw hook JSON wrapped with eventKind.
 */
app.post('/api/telemetry', (req, res) => {
  try {
    const event = normalizeEvent(req.body);
    
    if (!event.eventKind) {
      console.log('[Telemetry] Missing eventKind, inferring from payload');
      event.eventKind = inferEventKind(event);
    }
    
    console.log(`[Telemetry] ${event.eventKind}: ${event.toolName || event.agentType || 'session'} (${event.runId?.slice(0, 8) || 'unknown'})`);
    
    traceStore.processEvent(event);
    
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('[Telemetry] Error processing event:', err);
    // Fail open - don't block hooks
    res.status(200).json({ success: true, error: 'Processing error' });
  }
});

/**
 * Normalize incoming event from various hook formats
 */
function normalizeEvent(body: Record<string, unknown>): TelemetryEvent {
  const event: TelemetryEvent = {
    eventKind: body.eventKind as TelemetryEventKind,
    timestamp: (body.timestamp as number) || Date.now(),
  };
  
  // Run ID: Cursor uses conversation_id, Claude uses session_id
  event.runId = (body.runId || body.conversation_id || body.session_id) as string;
  
  // Agent ID for subagents
  event.agentId = body.agentId as string;
  
  // Span ID: Cursor provides tool_use_id
  event.spanId = (body.spanId || body.tool_use_id) as string;
  
  // Tool info
  event.toolName = body.toolName || body.tool_name as string;
  event.toolInput = body.toolInput || body.tool_input;
  event.toolOutput = body.toolOutput || body.tool_output;
  
  // Metadata
  event.hookEventName = body.hookEventName || body.hook_event_name as string;
  event.turnId = (body.turnId || body.generation_id) as string;
  event.model = body.model as string;
  event.agentType = (body.agentType || body.subagent_type) as string;
  
  // Source detection
  if (body.source) {
    event.source = body.source as AgentSource;
  } else if (body.conversation_id) {
    event.source = 'cursor';
  } else if (body.session_id) {
    event.source = 'claude';
  }
  
  // Duration
  event.duration = body.duration as number;
  event.durationMs = body.duration_ms as number;
  
  // Error info
  event.errorMessage = (body.errorMessage || body.error_message) as string;
  event.failureType = body.failure_type as 'error' | 'timeout' | 'permission_denied';
  
  // Session info
  event.status = body.status as string;
  event.projectRoot = body.projectRoot as string;
  event.workspaceRoots = body.workspace_roots as string[];
  
  // Transcript paths
  event.transcriptPath = (body.transcriptPath || body.transcript_path) as string;
  event.agentTranscriptPath = (body.agentTranscriptPath || body.agent_transcript_path) as string;
  
  // Attachments
  event.attachments = body.attachments as TelemetryEvent['attachments'];
  
  // Parent references
  event.parentSpanId = body.parentSpanId as string;
  event.parentAgentId = body.parentAgentId as string;
  
  return event;
}

/**
 * Infer event kind from payload if not explicitly provided
 */
function inferEventKind(event: TelemetryEvent): TelemetryEventKind {
  const hookName = event.hookEventName?.toLowerCase() || '';
  
  if (hookName.includes('sessionstart')) return 'sessionStart';
  if (hookName.includes('sessionend')) return 'sessionEnd';
  if (hookName.includes('stop')) return 'stop';
  if (hookName.includes('subagentstart')) return 'subagentStart';
  if (hookName.includes('subagentstop')) return 'subagentStop';
  if (hookName.includes('pretooluse') || hookName.includes('before')) return 'toolStart';
  if (hookName.includes('posttooluse') || hookName.includes('after')) return 'toolEnd';
  if (hookName.includes('failure')) return 'toolFailure';
  
  // Default based on other fields
  if (event.errorMessage || event.failureType) return 'toolFailure';
  if (event.toolOutput || event.duration) return 'toolEnd';
  if (event.toolName) return 'toolStart';
  if (event.status) return 'stop';
  
  return 'sessionStart';
}

// ============================================================================
// Query API
// ============================================================================

/**
 * GET /api/runs
 * 
 * List recent runs.
 */
app.get('/api/runs', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 20;
  const runs = traceStore.getRecentRuns(limit);
  res.json(runs);
});

/**
 * GET /api/runs/:runId
 * 
 * Get run details.
 */
app.get('/api/runs/:runId', (req, res) => {
  const { runId } = req.params;
  const details = traceStore.getRunDetails(runId);
  
  if (!details) {
    res.status(404).json({ error: 'Run not found' });
    return;
  }
  
  res.json(details);
});

/**
 * GET /api/runs/:runId/spans
 * 
 * Get spans for a run.
 */
app.get('/api/runs/:runId/spans', (req, res) => {
  const { runId } = req.params;
  const since = req.query.since ? parseInt(req.query.since as string) : undefined;
  
  const result = traceStore.getSpans(runId, since);
  
  if (!result) {
    res.status(404).json({ error: 'Run not found' });
    return;
  }
  
  res.json(result);
});

// ============================================================================
// Transcript API
// ============================================================================

const MAX_TRANSCRIPT_BYTES = 2 * 1024 * 1024; // 2MB

function readTranscriptFile(filePath: string): { content: string; truncated: boolean; sizeBytes: number } {
  const st = fs.statSync(filePath);
  if (!st.isFile()) {
    throw new Error('Transcript path is not a file');
  }

  const sizeBytes = st.size;
  const truncated = sizeBytes > MAX_TRANSCRIPT_BYTES;
  const bytesToRead = Math.min(sizeBytes, MAX_TRANSCRIPT_BYTES);

  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(bytesToRead);
    fs.readSync(fd, buf, 0, bytesToRead, 0);
    const content = buf.toString('utf-8');
    return { content, truncated, sizeBytes };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * GET /api/runs/:runId/transcript
 * 
 * Get the conversation transcript for a run.
 */
app.get('/api/runs/:runId/transcript', (req, res) => {
  const { runId } = req.params;
  const details = traceStore.getRunDetails(runId);
  
  if (!details) {
    res.status(404).json({ error: 'Run not found' });
    return;
  }
  
  if (!details.transcriptPath) {
    res.status(404).json({ error: 'No transcript available for this run' });
    return;
  }
  
  try {
    if (!fs.existsSync(details.transcriptPath)) {
      res.status(404).json({ error: 'Transcript file not found', path: details.transcriptPath });
      return;
    }
    
    const { content, truncated, sizeBytes } = readTranscriptFile(details.transcriptPath);
    res.json({ 
      runId,
      path: details.transcriptPath,
      content,
      truncated,
      sizeBytes,
    });
  } catch (err) {
    console.error('[Transcript] Error reading file:', err);
    res.status(500).json({ error: 'Failed to read transcript' });
  }
});

/**
 * GET /api/runs/:runId/agents/:agentId/transcript
 * 
 * Get the transcript for a specific subagent.
 */
app.get('/api/runs/:runId/agents/:agentId/transcript', (req, res) => {
  const { runId, agentId } = req.params;
  const details = traceStore.getRunDetails(runId);
  
  if (!details) {
    res.status(404).json({ error: 'Run not found' });
    return;
  }
  
  const agent = details.agents.find(a => a.agentId === agentId);
  
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }
  
  if (!agent.transcriptPath) {
    res.status(404).json({ error: 'No transcript available for this agent' });
    return;
  }
  
  try {
    if (!fs.existsSync(agent.transcriptPath)) {
      res.status(404).json({ error: 'Transcript file not found', path: agent.transcriptPath });
      return;
    }
    
    const { content, truncated, sizeBytes } = readTranscriptFile(agent.transcriptPath);
    res.json({ 
      runId,
      agentId,
      agentName: agent.displayName,
      path: agent.transcriptPath,
      content,
      truncated,
      sizeBytes,
    });
  } catch (err) {
    console.error('[Transcript] Error reading agent transcript:', err);
    res.status(500).json({ error: 'Failed to read transcript' });
  }
});

// ============================================================================
// Demo Mode
// ============================================================================

/**
 * POST /api/demo/start
 * 
 * Start a demo run with scripted telemetry events.
 */
app.post('/api/demo/start', (_req, res) => {
  const runId = demoGenerator.start();
  
  if (!runId) {
    res.status(409).json({ error: 'Demo already running' });
    return;
  }
  
  res.json({ success: true, runId });
});

/**
 * POST /api/demo/stop
 * 
 * Stop the current demo run.
 */
app.post('/api/demo/stop', (_req, res) => {
  demoGenerator.stop();
  res.json({ success: true });
});

// ============================================================================
// Health & Debug
// ============================================================================

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    wsClients: wsManager.getClientCount(),
    projectRoot: PROJECT_ROOT,
  });
});

// ============================================================================
// Start Server
// ============================================================================

server.listen(PORT, () => {
  console.log(`
  Agent Observability Server
  ==========================
  HTTP:      http://localhost:${PORT}
  WebSocket: ws://localhost:${PORT}/ws
  Project:   ${PROJECT_ROOT}
  
  Endpoints:
    POST /api/telemetry     - Ingest hook events
    GET  /api/runs          - List recent runs
    GET  /api/runs/:id      - Run details
    GET  /api/runs/:id/spans - Run spans
  `);
});
