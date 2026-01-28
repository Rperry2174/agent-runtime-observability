# Test Scenario 04: File Operations

## Purpose
Verify that Read, Write, and Edit tool operations are properly tracked.

## Cursor Prompt

Copy and paste this prompt into Cursor:

```
Please do the following file operations in sequence:

1. Read the package.json file
2. Read the README.md file
3. Create a new file called "test-output.txt" with the content "Test file created by observability test"
4. Edit test-output.txt to append a new line: "Second line added"
5. Read test-output.txt to verify the changes
6. Delete test-output.txt when done
```

## Expected Trace

### Spans
| Tool | Status | Count | Notes |
|------|--------|-------|-------|
| Read | ok | 3 | package.json, README.md, test-output.txt |
| Write | ok | 1 | Create test-output.txt |
| Edit | ok | 1 | Modify test-output.txt |
| Bash (rm) | ok | 1 | Delete file (may be Shell) |

### Timeline
```
[Read: package.json] ──
                      [Read: README.md] ──
                                         [Write: test-output.txt] ────
                                                                     [Edit: test-output.txt] ──
                                                                                              [Read: test-output.txt] ──
                                                                                                                       [Shell: rm] ─
```

## Verification

1. Open dashboard at http://localhost:5273/observability
2. Find the run
3. Verify:
   - [ ] Read spans show file paths in input preview
   - [ ] Write span shows file creation
   - [ ] Edit span shows old/new string preview
   - [ ] File paths are correctly extracted
   - [ ] All operations complete successfully

## File Path Verification

Check that the `files` field is populated:

```bash
curl http://localhost:5274/api/runs/<runId>/spans | jq '.spans[] | select(.files) | {tool: .toolName, files: .files}'
```

## Notes

- `afterFileEdit` hook fires after Edit tool
- `preToolUse` captures file_path from toolInput
- Write operations may trigger `afterFileEdit` or `postToolUse`
