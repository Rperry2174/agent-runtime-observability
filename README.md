# Agent Observability

Real-time tracing and visualization for Cursor AI agents.

See what your agents are doing: tool calls, durations, errors, subagent workflows — all in a timeline UI.

## Quick Start

```bash
# Clone and install
git clone https://github.com/your-org/agent-runtime-observability
cd agent-runtime-observability
npm install

# Start the observability server + dashboard
npm run dev
```

- **Server**: http://localhost:5174
- **Dashboard**: http://localhost:5173/observability

## Setup Hooks in Your Project

To observe an agent session in another project, add hooks that point to this repo's telemetry script.

### Cursor

Create/edit `<your-project>/.cursor/hooks.json`:

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [{ "command": "/path/to/agent-runtime-observability/hooks/telemetry-hook.sh sessionStart" }],
    "sessionEnd": [{ "command": "/path/to/agent-runtime-observability/hooks/telemetry-hook.sh sessionEnd" }],
    "preToolUse": [{ "command": "/path/to/agent-runtime-observability/hooks/telemetry-hook.sh toolStart" }],
    "postToolUse": [{ "command": "/path/to/agent-runtime-observability/hooks/telemetry-hook.sh toolEnd" }],
    "postToolUseFailure": [{ "command": "/path/to/agent-runtime-observability/hooks/telemetry-hook.sh toolFailure" }],
    "beforeShellExecution": [{ "command": "/path/to/agent-runtime-observability/hooks/telemetry-hook.sh shellStart" }],
    "afterShellExecution": [{ "command": "/path/to/agent-runtime-observability/hooks/telemetry-hook.sh shellEnd" }],
    "afterMCPExecution": [{ "command": "/path/to/agent-runtime-observability/hooks/telemetry-hook.sh mcpEnd" }],
    "afterFileEdit": [{ "command": "/path/to/agent-runtime-observability/hooks/telemetry-hook.sh fileEditEnd" }],
    "beforeTabFileRead": [{ "command": "/path/to/agent-runtime-observability/hooks/telemetry-hook.sh tabReadStart" }],
    "afterTabFileEdit": [{ "command": "/path/to/agent-runtime-observability/hooks/telemetry-hook.sh tabEditEnd" }],
    "subagentStart": [{ "command": "/path/to/agent-runtime-observability/hooks/telemetry-hook.sh subagentStart" }],
    "subagentStop": [{ "command": "/path/to/agent-runtime-observability/hooks/telemetry-hook.sh subagentStop" }],
    "afterAgentThought": [{ "command": "/path/to/agent-runtime-observability/hooks/telemetry-hook.sh thinkingEnd" }],
    "beforeSubmitPrompt": [{ "command": "/path/to/agent-runtime-observability/hooks/telemetry-hook.sh beforeSubmitPrompt" }],
    "preCompact": [{ "command": "/path/to/agent-runtime-observability/hooks/telemetry-hook.sh contextCompact" }],
    "stop": [{ "command": "/path/to/agent-runtime-observability/hooks/telemetry-hook.sh stop" }]
  }
}
```

Replace `/path/to/agent-runtime-observability` with the actual path to this repo (e.g. `/Users/you/Desktop/projects/agent-runtime-observability`).

### Gitignore

Add `.agent-runtime-observability/` to your project's `.gitignore` — that's where trace files are stored.

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
Cursor Hooks → Telemetry API → TraceStore → WebSocket → Dashboard
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

The telemetry hook script (`hooks/telemetry-hook.sh`) handles all Cursor events:

- `sessionStart/sessionEnd` — Run lifecycle
- `preToolUse/postToolUse/postToolUseFailure` — Tool spans
- `subagentStart/subagentStop` — Subagent lifecycle
- `stop` — Completion status
- `beforeReadFile/beforeSubmitPrompt` — Attachments visibility

## Data Model

- **Run**: A single agent session (maps to Cursor's `conversation_id`)
- **Agent**: An agent within a run (main agent + subagents)
- **Span**: A single tool execution with start/end times, status, and metadata

Traces are persisted to `.agent-runtime-observability/traces/<runId>.jsonl` for replay and debugging.

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
