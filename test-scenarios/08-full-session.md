# Test Scenario 08: Full Realistic Session

## Purpose
Verify end-to-end trace generation for a realistic code review/modification session.

## Cursor Prompt

Copy and paste this prompt into Cursor:

```
Please help me review and improve the error handling in this project.

1. First, explore the codebase to understand the structure
2. Find all places where errors are caught or thrown
3. Read the main entry point files
4. Create a brief report of findings in a new file "error-audit.md"
5. Suggest one improvement and implement it

Work methodically and explain your process.
```

## Expected Trace

### Agents (likely 2+)
| Agent | Type | Role |
|-------|------|------|
| Cursor 1 | main | Orchestration |
| Cursor Explore 2 | explore | Codebase exploration |

### Expected Spans (approximate)
| Phase | Tools | Count |
|-------|-------|-------|
| Exploration | Task, Glob, Grep | 3-5 |
| Reading | Read | 3-5 |
| Writing | Write | 1 |
| (Optional) Editing | Edit | 0-2 |

### Timeline
```
Cursor 1
├── [Thinking...] ────
├── [Task: explore codebase] ────────────────────────────
│   └── Cursor Explore 2
│       ├── [Glob: **/*.ts] ──
│       ├── [Grep: throw|catch] ─────
│       └── [Read: ...] ──
├── [Read: src/index.ts] ──
├── [Read: src/trace-store.ts] ────
├── [Write: error-audit.md] ────
└── [Edit: ...] ──── (if implemented)
```

## Verification Checklist

### Run Level
- [ ] Run appears in dashboard with correct status
- [ ] Run shows initial prompt
- [ ] Duration is reasonable
- [ ] Agent count matches expected

### Agent Level
- [ ] Main agent lane shows orchestration tools
- [ ] Subagent lane shows exploration tools
- [ ] Subagent properly linked to parent

### Span Level
- [ ] All spans have start/end times
- [ ] No orphan spans
- [ ] Tool names correct
- [ ] Input previews show useful info
- [ ] File paths extracted where applicable

### Hierarchy
- [ ] Task spans are roots
- [ ] Subagent work nested under Task
- [ ] Depth is reasonable (1-3)

## Full Verification

Run the comprehensive verification:

```bash
# Get full report
curl http://localhost:5274/api/runs/<runId>/verify | jq

# Or with expected structure
curl -X POST http://localhost:5274/api/runs/<runId>/verify \
  -H "Content-Type: application/json" \
  -d '{
    "expected": {
      "minSpans": 5,
      "agentCount": 2,
      "subagentTypes": ["explore"],
      "noErrors": true,
      "allCompleted": true
    }
  }' | jq
```

## Cleanup

After testing, you may want to:
1. Delete `error-audit.md` if created
2. Revert any edits made during the test

## Troubleshooting

If trace is incomplete:
1. Check `/tmp/observability-hook.log` for hook activity
2. Verify all hooks are configured in `.cursor/hooks.json`
3. Check server console for event processing
4. Look for "unmatched" events in debug log
