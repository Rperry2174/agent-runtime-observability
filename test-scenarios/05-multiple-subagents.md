# Test Scenario 05: Multiple Subagents

## Purpose
Verify that multiple Task tool invocations create separate subagent entries with correct attribution.

## Cursor Prompt

Copy and paste this prompt into Cursor:

```
I need you to run three separate research tasks in parallel (or sequence):

1. Use an explore agent to find all test files in the project
2. Use a general-purpose agent to analyze the package.json dependencies
3. Use an explore agent to search for any security-related code

Please spawn each as a separate Task with the appropriate subagent type.
```

## Expected Trace

### Agents
| Agent | Type | Parent |
|-------|------|--------|
| Cursor 1 | main | - |
| Cursor Explore 2 | explore | Cursor 1 |
| Cursor GeneralPurpose 3 | generalPurpose | Cursor 1 |
| Cursor Explore 4 | explore | Cursor 1 |

### Spans
| Tool | Agent | Expected |
|------|-------|----------|
| Task | Cursor 1 | 3 spans |
| Various | Cursor Explore 2 | N spans |
| Various | Cursor GeneralPurpose 3 | N spans |
| Various | Cursor Explore 4 | N spans |

### Timeline (Sequential)
```
Cursor 1
├── [Task 1] ─────────────
│   └── Cursor Explore 2
│       └── [Glob] ───
├── [Task 2] ─────────────────────────
│   └── Cursor GeneralPurpose 3
│       ├── [Read] ───
│       └── [Grep] ──
└── [Task 3] ───────────────────────────────────
    └── Cursor Explore 4
        └── [Grep] ────
```

### Timeline (Parallel)
```
Cursor 1
├── [Task 1] ─────────────
│   └── Cursor Explore 2: [Glob] ───
├── [Task 2] ─────────────
│   └── Cursor GeneralPurpose 3: [Read] ──, [Grep] ──
└── [Task 3] ─────────────
    └── Cursor Explore 4: [Grep] ───
```

## Verification

1. Open dashboard at http://localhost:5273/observability
2. Find the run
3. Verify:
   - [ ] 4 agent lanes appear (1 main + 3 subagents)
   - [ ] Each Task span is in the main agent lane
   - [ ] Subagent work is correctly attributed
   - [ ] Agent types shown correctly (explore, generalPurpose)
   - [ ] All subagents marked as ended

## Stats Verification

```bash
curl http://localhost:5274/api/runs/<runId>/verify | jq '.stats | {agents: .agentCount, subagents: .subagentCount}'
# Expected: {"agents": 4, "subagents": 3}
```

## Hierarchy Check

Verify parent-child relationships:

```bash
curl http://localhost:5274/api/runs/<runId> | jq '.agents[] | {name: .displayName, parent: .parentAgentId}'
```

All subagents should have `parentAgentId` equal to the main agent (runId).
