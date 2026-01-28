# Test Scenario 01: Shell Commands

## Purpose
Verify that shell command execution is properly tracked with `shellStart`/`shellEnd` events.

## Cursor Prompt

Copy and paste this prompt into Cursor:

```
Run the following three shell commands in sequence with a 2-second pause between each:

1. echo "Test 1: Hello from observability test"
2. ls -la
3. pwd

After each command, wait 2 seconds before the next one.
```

## Expected Trace

### Spans
| Tool | Status | Expected |
|------|--------|----------|
| Shell | ok | 3 spans |

### Timeline
```
[Shell: echo "Test 1: Hello..."] ────────
                                    [Shell: ls -la] ────────
                                                        [Shell: pwd] ────
```

## Verification

1. Open dashboard at http://localhost:5273/observability
2. Find the new run in the run list
3. Click to expand the timeline
4. Verify:
   - [ ] 3 Shell spans appear
   - [ ] Each span has a start and end time
   - [ ] Durations are reasonable (100ms - 5s)
   - [ ] Command preview visible in span details
   - [ ] Output preview visible after completion

## API Verification

```bash
# Get the run ID from the dashboard, then:
curl http://localhost:5274/api/runs/<runId>/spans | jq '.spans | map(.toolName)'
# Expected: ["Shell", "Shell", "Shell"]
```

## Troubleshooting

If shells don't appear:
1. Check `/tmp/observability-hook.log` for hook execution
2. Verify `beforeShellExecution` hook is configured
3. Check server logs for telemetry reception
