# Test Scenario 06: Error Handling

## Purpose
Verify that tool failures are properly tracked with correct error status and messages.

## Cursor Prompt

Copy and paste this prompt into Cursor:

```
Please attempt the following operations (some will fail intentionally):

1. Read a file that doesn't exist: "/nonexistent/file/path/foo.txt"
2. Run a shell command that will fail: "exit 1"
3. Try to write to a read-only location: "/etc/test-readonly.txt"
4. Successfully read package.json (to verify mixed success/failure)
```

## Expected Trace

### Spans
| Tool | Status | Error Type |
|------|--------|------------|
| Read | error | File not found |
| Shell | error | Exit code 1 |
| Write | permission_denied | Access denied |
| Read | ok | Success |

### Timeline with Errors
```
[Read: /nonexistent/...] ✗ error
                           [Shell: exit 1] ✗ error
                                             [Write: /etc/...] 🚫 permission_denied
                                                                 [Read: package.json] ✓ ok
```

## Verification

1. Open dashboard at http://localhost:5273/observability
2. Find the run
3. Verify:
   - [ ] Failed spans show error status (red/orange)
   - [ ] Error messages are captured
   - [ ] Different failure types distinguished (error, permission_denied, timeout)
   - [ ] Successful spans still show correctly
   - [ ] Run-level error count is accurate

## Error Details Check

```bash
curl http://localhost:5274/api/runs/<runId>/spans | jq '.spans[] | select(.status != "ok") | {tool: .toolName, status: .status, error: .errorMessage}'
```

## Stats Verification

```bash
curl http://localhost:5274/api/runs/<runId>/verify | jq '.stats | {total: .totalSpans, errors: .errorSpans, completed: .completedSpans}'
```

## Failure Type Mapping

| Hook failureType | Span Status |
|------------------|-------------|
| `error` | `error` |
| `timeout` | `timeout` |
| `permission_denied` | `permission_denied` |
| (interrupted) | `aborted` |

## Notes

- `postToolUseFailure` hook provides error details
- Some failures may not trigger hooks (agent-side filtering)
- Permission errors depend on sandbox configuration
