# Test Scenario 07: Thinking Spans

## Purpose
Verify that extended thinking (reasoning) is tracked via `thinkingEnd` events.

## Cursor Prompt

Copy and paste this prompt into Cursor:

```
I have a complex architectural decision to make. Please think through this carefully:

Given a microservices architecture with 5 services that need to communicate:
1. Service A: User authentication
2. Service B: Order processing
3. Service C: Inventory management
4. Service D: Payment processing
5. Service E: Notification service

What communication pattern would you recommend? Consider:
- Synchronous vs asynchronous
- Event-driven architecture
- Service mesh
- Message queues

Please think step by step and show your reasoning process.
```

*Note: Thinking spans require Claude to use extended thinking, which may depend on model configuration.*

## Expected Trace

### Spans
| Tool | Status | Notes |
|------|--------|-------|
| Thinking | ok | Extended reasoning block |
| (optional) Read/Search | ok | If agent researches |

### Timeline
```
[Thinking] ───────────────────────────────
                                          [Response generation...]
```

## Verification

1. Open dashboard at http://localhost:5273/observability
2. Find the run
3. Verify:
   - [ ] Thinking span appears (if thinking was used)
   - [ ] Duration reflects actual thinking time
   - [ ] Output preview shows thinking summary
   - [ ] Thinking attributed to correct agent

## Thinking Event Details

The `afterAgentThought` hook provides:
- `text`: Full thinking content
- `duration_ms`: Time spent thinking

TraceStore creates a synthetic span:
- `toolName`: "Thinking"
- `startedAt`: calculated from endedAt - durationMs
- `outputPreview`: truncated thinking text

## Notes

- Not all prompts trigger extended thinking
- Thinking spans are synthetic (created from thinkingEnd event)
- Duration may not be exact if timing varies

## Alternative Test

If thinking doesn't trigger naturally, you can verify the system handles thinking events by sending a synthetic event:

```bash
curl -X POST http://localhost:5274/api/telemetry \
  -H "Content-Type: application/json" \
  -d '{
    "eventKind": "thinkingEnd",
    "timestamp": '$(date +%s000)',
    "runId": "test-thinking-'$(date +%s)'",
    "thinkingDurationMs": 5000,
    "thinkingText": "Let me think about this step by step..."
  }'
```
