# Test Scenario 02: MCP Tool Calls

## Purpose
Verify that MCP (Model Context Protocol) tool invocations are tracked via `mcpEnd` events.

## Prerequisites
- You need MCP tools configured in Cursor (e.g., a web search tool, database tool, etc.)
- If no MCP tools are available, this test verifies the hook infrastructure

## Cursor Prompt

Copy and paste this prompt into Cursor:

```
Please help me search the web for information about "TypeScript 5.0 new features".
Then search for "React Server Components best practices".
Finally, search for "Cursor AI IDE features".

Summarize the key points from each search.
```

*Note: Adjust the prompt based on what MCP tools you have available.*

## Expected Trace (with MCP tools)

### Spans
| Tool | Status | Expected |
|------|--------|----------|
| MCP Tool (e.g., search) | ok | 3 spans |

### Timeline
```
[search: "TypeScript 5.0..."] ────────
                                 [search: "React Server..."] ────────
                                                               [search: "Cursor AI..."] ────
```

## Expected Trace (without MCP tools)

If no MCP tools are configured, you'll see standard tool calls instead:
- Web search spans (if WebSearch tool is used)
- Read/Glob/Grep spans for local search

## Verification

1. Open dashboard at http://localhost:5273/observability
2. Find the new run
3. Verify:
   - [ ] MCP tool spans appear (or fallback tools)
   - [ ] Each span completes successfully
   - [ ] Tool names reflect MCP server names
   - [ ] Duration reasonable for network calls

## Notes on MCP Events

- `afterMCPExecution` hook fires after MCP tool completion
- The hook receives tool name, input, and result
- Results are truncated to 300 chars in trace
