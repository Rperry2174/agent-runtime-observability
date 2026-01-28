# Test Scenario 03: Subagent (Explore)

## Purpose
Verify that Task tool spawning creates subagent entries with proper parent-child relationships.

## Cursor Prompt

Copy and paste this prompt into Cursor:

```
I need you to thoroughly explore this codebase. Please spawn an explore agent to:
1. Find all TypeScript files in the project
2. Search for any TODO comments
3. Identify the main entry points

Use the Task tool with the "explore" subagent type.
```

## Expected Trace

### Agents
| Agent | Type | Parent |
|-------|------|--------|
| Cursor 1 | main | - |
| Cursor Explore 2 | explore | Cursor 1 |

### Spans
| Tool | Agent | Expected |
|------|-------|----------|
| Task | Cursor 1 | 1 span (parent) |
| Glob/Grep/Read | Cursor Explore 2 | Multiple spans |

### Hierarchy
```
Cursor 1
└── [Task: "explore codebase"] ─────────────────────────────
    └── Cursor Explore 2
        ├── [Glob: "**/*.ts"] ────
        ├── [Grep: "TODO"] ────────
        └── [Read: "src/index.ts"] ───
```

## Verification

1. Open dashboard at http://localhost:5273/observability
2. Find the run
3. Verify:
   - [ ] Two agent lanes appear (main + subagent)
   - [ ] Task span appears in main agent lane
   - [ ] Subagent spans appear in separate lane
   - [ ] Task span duration encompasses subagent work
   - [ ] Subagent is marked as "ended" when complete

## Trace Tree Verification

Use the verification API:

```bash
curl http://localhost:5274/api/runs/<runId>/verify | jq
```

Expected output includes:
- `agentCount: 2`
- `subagentCount: 1`
- Task span as root with children

## Common Issues

1. **Subagent lane empty**: Check `subagentStart` hook is firing
2. **Task span never completes**: Check `subagentStop` hook
3. **Tools not attributed to subagent**: Check agent ID propagation
