# Agent Observability

Real-time tracing dashboard for Cursor and Claude Code agents. Shows tool call timelines, durations, errors, and subagent workflows.

## Agent Quick Start

**Working on hooks?** → Edit `hooks/telemetry-hook.sh`
**Working on server?** → Edit `server/src/index.ts` (endpoints), `server/src/trace-store.ts` (storage)
**Working on dashboard?** → Edit `client/src/components/ObservabilityDashboard.tsx`

Key files to understand first:
1. `server/src/types.ts` — All shared interfaces (Run, Agent, Span, TelemetryEvent)
2. `hooks/telemetry-hook.sh` — How hook data flows in
3. `client/src/hooks/useTrace.ts` — Client data layer

Run tests: `cd server && npm test` and `cd client && npm test`

## Quick Reference

| Resource | URL |
|----------|-----|
| Server | `http://localhost:5174` |
| Dashboard | `http://localhost:5173/observability` |
| Start both | `npm run dev` |
| Run tests | `npm test` (from client/ or server/) |
| Hook logs | `tail -f /tmp/observability-hook.log` |

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ DATA FLOW                                                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ Cursor / Claude Code                                            │
│         │                                                       │
│         ▼                                                       │
│ ┌─────────────────┐                                             │
│ │ telemetry-hook.sh │ Captures events, POSTs to server          │
│ └────────┬────────┘                                             │
│          │ POST /api/telemetry                                  │
│          ▼                                                      │
│ ┌─────────────────┐                                             │
│ │ server/         │ Express + WebSocket on port 5174            │
│ │ - index.ts      │ API endpoints                               │
│ │ - trace-store.ts│ Span correlation + JSONL persistence        │
│ │ - websocket.ts  │ Real-time broadcast                         │
│ └────────┬────────┘                                             │
│          │ WebSocket `trace` messages                           │
│          ▼                                                      │
│ ┌─────────────────┐                                             │
│ │ client/         │ React dashboard on port 5173                │
│ │ - useTrace.ts   │ WebSocket + REST data layer                 │
│ │ - Dashboard.tsx │ Swimlane timeline + inspect panel           │
│ └─────────────────┘                                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
agent-runtime-observability/
├── bin/
│   └── setup.js            # Universal setup script for any project
├── hooks/
│   └── telemetry-hook.sh   # Captures events from Cursor/Claude hooks
├── server/
│   └── src/
│       ├── index.ts        # Express server + API endpoints
│       ├── trace-store.ts  # Span correlation, persistence, queries
│       ├── demo-generator.ts # Demo run generator
│       ├── websocket.ts    # WebSocket client management
│       ├── types.ts        # Shared TypeScript interfaces
│       └── *.test.ts       # Test files
├── client/
│   └── src/
│       ├── components/
│       │   └── ObservabilityDashboard.tsx  # Main UI (timeline + inspect)
│       ├── hooks/
│       │   └── useTrace.ts  # WebSocket + REST data layer
│       └── types.ts         # Client-side types
├── CLAUDE.md               # This file (agent reference)
├── README.md               # User documentation
└── package.json            # Workspace root
```

## Server API Reference

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/telemetry` | Receive hook events |
| GET | `/api/runs` | List recent runs |
| GET | `/api/runs/:runId` | Run details |
| GET | `/api/runs/:runId/spans` | Run spans |
| POST | `/api/demo/start` | Start demo run |
| POST | `/api/demo/stop` | Stop demo run |
| GET | `/api/health` | Health check |

### WebSocket

- Path: `ws://localhost:5174/ws`
- Messages: `{ type: 'trace', data: TraceUpdate }`
- Client can subscribe: `{ type: 'subscribe', runId: '...' }` or `{ type: 'subscribeAll' }`

### Data Types

```typescript
// Telemetry event from hooks
type TelemetryEventKind = 
  | 'sessionStart' | 'sessionEnd'
  | 'toolStart' | 'toolEnd' | 'toolFailure'
  | 'subagentStart' | 'subagentStop'
  | 'stop';

interface TelemetryEvent {
  eventKind: TelemetryEventKind;
  timestamp: number;
  runId?: string;      // conversation_id (Cursor) or session_id (Claude)
  agentId?: string;    // For subagents
  spanId?: string;     // tool_use_id when available
  toolName?: string;
  toolInput?: unknown;
  duration?: number;
  errorMessage?: string;
  // ... more fields in types.ts
}

// Span (stored/displayed)
interface Span {
  spanId: string;
  runId: string;
  agentId: string;
  parentSpanId?: string;  // For Task nesting
  toolName: string;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  status: 'running' | 'ok' | 'error' | 'timeout' | 'permission_denied' | 'aborted';
  inputPreview?: string;
  outputPreview?: string;
  errorMessage?: string;
}

// Trace update (WebSocket)
interface TraceUpdate {
  type: 'spanStart' | 'spanEnd' | 'agentStart' | 'agentEnd' | 'runStart' | 'runEnd';
  runId: string;
  span?: Span;
  agent?: Agent;
  run?: RunSummary;
}
```

## Testing

```bash
# Server tests (17 tests)
cd server && npm test

# Client tests (5 tests)
cd client && npm test

# Watch mode
npm test -- --watch
```

## Common Tasks

### Adding a new hook event type

1. Add the event kind to `TelemetryEventKind` in `server/src/types.ts`
2. Update `telemetry-hook.sh` to emit the new event
3. Add handling in `TraceStore.processEvent()`
4. Update setup.js to configure the new hook

### Adding span metadata

1. Add field to `Span` interface in `server/src/types.ts`
2. Extract in `TraceStore.handleToolStart()` or similar
3. Mirror in `client/src/types.ts`
4. Display in `InspectPanel` component

### Changing timeline colors

Edit `TOOL_COLORS` and `STATUS_COLORS` in `client/src/types.ts`:

```typescript
export const TOOL_COLORS: Record<ToolCategory, string> = {
  read: '#60a5fa',     // Blue
  write: '#4ade80',    // Green
  search: '#f472b6',   // Pink
  shell: '#fbbf24',    // Amber
  task: '#a78bfa',     // Purple
  mcp: '#2dd4bf',      // Teal
  other: '#94a3b8',    // Slate
};
```

## Debugging

### Hook Issues

```bash
# Watch hook logs in real-time
tail -f /tmp/observability-hook.log

# Test telemetry endpoint manually
curl -X POST http://localhost:5174/api/telemetry \
  -H "Content-Type: application/json" \
  -d '{"eventKind":"toolStart","runId":"test-123","toolName":"Read","timestamp":'$(date +%s000)'}'
```

### Server Issues

```bash
# Get recent runs
curl http://localhost:5174/api/runs | jq

# Get run details
curl http://localhost:5174/api/runs/RUN_ID | jq

# Health check
curl http://localhost:5174/api/health | jq
```

### Client Issues

- Open browser DevTools console
- Check WebSocket connection in Network tab
- The dashboard polls `/api/runs` every 5 seconds

## Setup for Other Projects

To observe agent sessions in another project, manually create hook configs pointing to this repo's telemetry script.

**Cursor**: Create `<project>/.cursor/hooks.json` with hooks calling `/path/to/agent-runtime-observability/hooks/telemetry-hook.sh <eventKind>`.

**Claude Code**: Create `<project>/.claude/settings.local.json` with hooks calling the same script.

See `README.md` for full example configs.

## Key Design Decisions

1. **Fixed Ports (5173/5174)**: Never change. Hooks and client hardcode these.

2. **Fail-open ingestion**: Telemetry endpoint always returns 200 to not block hooks.

3. **JSONL persistence**: Simple, append-only, easy to replay and debug.

4. **Ref-based client state**: Avoids React re-render storms during high-frequency updates.

5. **Span correlation by tool_use_id**: Cursor provides this; Claude falls back to (agentId, toolName).

6. **WebSocket subscriptions**: Clients can subscribe to specific runs or all runs.

7. **Demo mode**: Server-driven, emits events over ~20s for quick demos.

## Trace File Format

Traces are stored in `.agent-runtime-observability/traces/<runId>.jsonl`:

```jsonl
{"type":"run","data":{"runId":"...","status":"running",...},"ts":1234567890}
{"type":"agent","data":{"agentId":"...","displayName":"Cursor 1",...},"ts":1234567891}
{"type":"span","data":{"spanId":"...","toolName":"Read","status":"ok",...},"ts":1234567892}
```
