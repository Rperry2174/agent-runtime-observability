# Trace Test Scenarios

This directory contains test scenarios for verifying the observability trace system.

## Prerequisites

1. Start the observability server: `npm run dev` (from project root)
2. Enable hooks in your Cursor project by copying `.cursor/hooks.json` (uncomment the JSON)
3. Open the observability dashboard at http://localhost:5273/observability

## How to Run Tests

### Option 1: Manual Cursor Testing

Open Cursor in any project with hooks enabled, then paste the prompt from one of the scenario files below. Watch the dashboard to verify the trace appears correctly.

### Option 2: Automated Event Testing

Run the test script to send synthetic events directly:

```bash
./test-scenarios/send-test-events.sh <scenario>
```

Available scenarios:
- `shell` - 3 shell commands
- `mcp` - 3 MCP tool calls
- `subagent` - Task spawning subagents
- `file-ops` - Read, Write, Edit operations
- `mixed` - Realistic mixed session

### Option 3: Programmatic Testing

Use the verification API:

```bash
# Get trace report for a run
curl http://localhost:5274/api/runs/<runId>/verify

# Verify against expected structure
curl -X POST http://localhost:5274/api/runs/<runId>/verify \
  -H "Content-Type: application/json" \
  -d '{"expected": {"toolCounts": {"Read": 3}, "noErrors": true}}'
```

## Test Scenarios

| Scenario | Description | Expected Spans | Expected Agents |
|----------|-------------|----------------|-----------------|
| [01-shell-commands.md](./01-shell-commands.md) | 3 sequential shell commands | 3 Shell | 1 |
| [02-mcp-calls.md](./02-mcp-calls.md) | 3 MCP tool invocations | 3 MCP tools | 1 |
| [03-subagent-explore.md](./03-subagent-explore.md) | Task spawns explore subagent | 1 Task + N tools | 2 |
| [04-file-operations.md](./04-file-operations.md) | Read, Write, Edit files | 3+ file ops | 1 |
| [05-multiple-subagents.md](./05-multiple-subagents.md) | Multiple Task calls | 3 Task + N tools | 4 |
| [06-error-handling.md](./06-error-handling.md) | Trigger tool failures | Mix with errors | 1 |
| [07-thinking-spans.md](./07-thinking-spans.md) | Extended thinking | Thinking spans | 1 |
| [08-full-session.md](./08-full-session.md) | Realistic code review | Many spans | 2+ |

## Verification Checklist

For each test, verify in the dashboard:

- [ ] Run appears in the run list
- [ ] Correct number of spans
- [ ] Spans have start/end times
- [ ] Durations are reasonable
- [ ] Agent lanes show correctly
- [ ] Subagent hierarchy is visible
- [ ] No orphan or stuck spans
- [ ] Errors show with correct status
