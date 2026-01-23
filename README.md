# Agent Observability

Real-time tracing and visualization for AI coding agents (Cursor, Claude Code).

See what your agents are doing: tool calls, durations, errors, subagent workflows — all in a timeline UI.

## Quick Start

```bash
# Clone and install
git clone https://github.com/JamsusMaximus/codemap
cd codemap
npm install

# Start the observability server + dashboard
npm run dev
```

Then open http://localhost:5173/observability

## Setup Hooks

In your project directory, run:

```bash
npx github:JamsusMaximus/codemap setup
```

This configures hooks for both Cursor (`.cursor/hooks.json`) and Claude Code (`.claude/settings.local.json`).

## Features

- **Real-time tool call visibility** — See which tool each agent is running right now
- **Agent swimlanes** — Timeline view with per-agent lanes
- **Timing/duration** — Know how long each operation takes
- **Error states** — Clearly see failures, timeouts, and permission denials
- **Subagent nesting** — Track Task tool spawns and their child agent work
- **Hook metadata** — See which hooks and rules fired
- **Demo mode** — Run a demo to see the dashboard in action

## Architecture

```
Cursor/Claude Hooks → Telemetry API → TraceStore → WebSocket → Dashboard
                                         ↓
                                     JSONL Logs
```

### Server (Port 5174)

| Endpoint | Description |
|----------|-------------|
| `POST /api/telemetry` | Ingest hook events |
| `GET /api/runs` | List recent runs |
| `GET /api/runs/:id` | Run details |
| `GET /api/runs/:id/spans` | Run spans |
| `POST /api/demo/start` | Start demo run |
| `WS /ws` | Real-time updates |

### Client (Port 5173)

| Route | Description |
|-------|-------------|
| `/observability` | Main dashboard |

## Development

```bash
# Start dev servers (server + client)
npm run dev

# Run tests
npm test --workspaces

# Server only
cd server && npm run dev

# Client only
cd client && npm run dev
```

## Hooks Reference

The telemetry hook script (`hooks/telemetry-hook.sh`) handles all events:

**Cursor hooks:**
- `sessionStart/sessionEnd` — Run lifecycle
- `preToolUse/postToolUse/postToolUseFailure` — Tool spans
- `subagentStart/subagentStop` — Subagent lifecycle
- `stop` — Completion status
- `beforeReadFile/beforeSubmitPrompt` — Attachments visibility

**Claude Code hooks:**
- `PreToolUse/PostToolUse` — Tool spans
- `Stop` — Completion status

## Data Model

- **Run**: A single agent session (maps to `conversation_id` or `session_id`)
- **Agent**: An agent within a run (main agent + subagents)
- **Span**: A single tool execution with start/end times, status, and metadata

Traces are persisted to `.codemap/traces/<runId>.jsonl` for replay and debugging.

## Troubleshooting

**Server not starting?**
```bash
lsof -i :5174  # Check if port in use
curl http://localhost:5174/api/health
```

**Hooks not firing?**
```bash
tail -f /tmp/observability-hook.log
```

**No spans appearing?**
```bash
curl http://localhost:5174/api/runs | jq
```

## License

MIT
