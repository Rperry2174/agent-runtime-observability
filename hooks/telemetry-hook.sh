#!/bin/bash
# Universal Telemetry Hook for Agent Observability
#
# Works with Cursor and Claude Code hooks.
# Extracts relevant fields and sends normalized events to the observability server.
#
# Usage: ./telemetry-hook.sh <eventKind>
#   eventKind: sessionStart, sessionEnd, toolStart, toolEnd, toolFailure,
#              subagentStart, subagentStop, stop

EVENT_KIND="$1"
SERVER_URL="http://localhost:5174/api/telemetry"
LOG_FILE="/tmp/observability-hook.log"
DEBUG_LOG="/tmp/observability-hook-debug.log"

# Enable debug mode with HOOK_DEBUG=1
DEBUG_MODE="${HOOK_DEBUG:-0}"

# Read JSON from stdin
INPUT=$(cat)

# Early exit if no input
if [ -z "$INPUT" ] || [ "$INPUT" = "{}" ]; then
    echo "$(date): [$EVENT_KIND] SKIP - empty input" >> "$LOG_FILE"
    exit 0
fi

# Debug: log raw input
if [ "$DEBUG_MODE" = "1" ]; then
    echo "$(date): [$EVENT_KIND] RAW:" >> "$DEBUG_LOG"
    echo "$INPUT" | /usr/bin/jq -c '.' >> "$DEBUG_LOG" 2>/dev/null || echo "$INPUT" >> "$DEBUG_LOG"
    echo "" >> "$DEBUG_LOG"
fi

# Extract run ID (Cursor: conversation_id, Claude: session_id)
RUN_ID=$(echo "$INPUT" | /usr/bin/jq -r '.conversation_id // .session_id // empty' 2>/dev/null)

if [ -z "$RUN_ID" ]; then
    echo "$(date): [$EVENT_KIND] SKIP - no run ID" >> "$LOG_FILE"
    exit 0
fi

# Build JSON payload with all available fields
# Start with required fields
PAYLOAD="{\"eventKind\":\"$EVENT_KIND\""
PAYLOAD="$PAYLOAD,\"timestamp\":$(date +%s000)"
PAYLOAD="$PAYLOAD,\"runId\":\"$RUN_ID\""

# Add source detection
if echo "$INPUT" | /usr/bin/jq -e '.conversation_id' >/dev/null 2>&1; then
    PAYLOAD="$PAYLOAD,\"source\":\"cursor\""
elif echo "$INPUT" | /usr/bin/jq -e '.session_id' >/dev/null 2>&1; then
    PAYLOAD="$PAYLOAD,\"source\":\"claude\""
fi

# Extract span ID (Cursor tool_use_id)
SPAN_ID=$(echo "$INPUT" | /usr/bin/jq -r '.tool_use_id // empty' 2>/dev/null)
if [ -n "$SPAN_ID" ]; then
    PAYLOAD="$PAYLOAD,\"spanId\":\"$SPAN_ID\""
fi

# Extract agent ID (various possible field names)
AGENT_ID=$(echo "$INPUT" | /usr/bin/jq -r '.agent_id // .agentId // .subagent_id // .task_agent_id // empty' 2>/dev/null)
if [ -n "$AGENT_ID" ]; then
    PAYLOAD="$PAYLOAD,\"agentId\":\"$AGENT_ID\""
fi

# Extract parent agent ID
PARENT_AGENT_ID=$(echo "$INPUT" | /usr/bin/jq -r '.parent_agent_id // .parentAgentId // empty' 2>/dev/null)
if [ -n "$PARENT_AGENT_ID" ]; then
    PAYLOAD="$PAYLOAD,\"parentAgentId\":\"$PARENT_AGENT_ID\""
fi

# Extract parent span ID (for Task tool nesting)
PARENT_SPAN_ID=$(echo "$INPUT" | /usr/bin/jq -r '.parent_span_id // .parentSpanId // .task_span_id // empty' 2>/dev/null)
if [ -n "$PARENT_SPAN_ID" ]; then
    PAYLOAD="$PAYLOAD,\"parentSpanId\":\"$PARENT_SPAN_ID\""
fi

# Extract tool name
TOOL_NAME=$(echo "$INPUT" | /usr/bin/jq -r '.tool_name // empty' 2>/dev/null)
if [ -n "$TOOL_NAME" ]; then
    PAYLOAD="$PAYLOAD,\"toolName\":\"$TOOL_NAME\""
fi

# Extract tool input (safely escape and truncate)
TOOL_INPUT=$(echo "$INPUT" | /usr/bin/jq -c '.tool_input // empty' 2>/dev/null)
if [ -n "$TOOL_INPUT" ] && [ "$TOOL_INPUT" != "null" ]; then
    # Escape for JSON string and truncate
    ESCAPED_INPUT=$(echo "$TOOL_INPUT" | head -c 500 | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | tr -d '\n\r')
    PAYLOAD="$PAYLOAD,\"toolInput\":\"$ESCAPED_INPUT\""
fi

# Extract tool output (for postToolUse)
TOOL_OUTPUT=$(echo "$INPUT" | /usr/bin/jq -r '.tool_output // empty' 2>/dev/null)
if [ -n "$TOOL_OUTPUT" ]; then
    ESCAPED_OUTPUT=$(echo "$TOOL_OUTPUT" | head -c 300 | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | tr -d '\n\r')
    PAYLOAD="$PAYLOAD,\"toolOutput\":\"$ESCAPED_OUTPUT\""
fi

# Extract prompt text (for beforeSubmitPrompt)
PROMPT_TEXT=$(echo "$INPUT" | /usr/bin/jq -r '.prompt // empty' 2>/dev/null)
if [ -n "$PROMPT_TEXT" ]; then
    ESCAPED_PROMPT=$(echo "$PROMPT_TEXT" | head -c 1000 | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | tr -d '\n\r')
    PAYLOAD="$PAYLOAD,\"prompt\":\"$ESCAPED_PROMPT\""
fi

# Extract hook event name
HOOK_NAME=$(echo "$INPUT" | /usr/bin/jq -r '.hook_event_name // empty' 2>/dev/null)
if [ -n "$HOOK_NAME" ]; then
    PAYLOAD="$PAYLOAD,\"hookEventName\":\"$HOOK_NAME\""
fi

# Extract generation/turn ID
TURN_ID=$(echo "$INPUT" | /usr/bin/jq -r '.generation_id // empty' 2>/dev/null)
if [ -n "$TURN_ID" ]; then
    PAYLOAD="$PAYLOAD,\"turnId\":\"$TURN_ID\""
fi

# Extract model
MODEL=$(echo "$INPUT" | /usr/bin/jq -r '.model // empty' 2>/dev/null)
if [ -n "$MODEL" ]; then
    PAYLOAD="$PAYLOAD,\"model\":\"$MODEL\""
fi

# Extract agent/subagent type
AGENT_TYPE=$(echo "$INPUT" | /usr/bin/jq -r '.subagent_type // .agent_type // empty' 2>/dev/null)
if [ -n "$AGENT_TYPE" ]; then
    PAYLOAD="$PAYLOAD,\"agentType\":\"$AGENT_TYPE\""
fi

# Extract duration (various field names)
DURATION=$(echo "$INPUT" | /usr/bin/jq -r '.duration // .duration_ms // empty' 2>/dev/null)
if [ -n "$DURATION" ] && [ "$DURATION" != "null" ]; then
    PAYLOAD="$PAYLOAD,\"duration\":$DURATION"
fi

# Extract error info for failures
ERROR_MSG=$(echo "$INPUT" | /usr/bin/jq -r '.error_message // empty' 2>/dev/null)
if [ -n "$ERROR_MSG" ]; then
    ESCAPED_ERROR=$(echo "$ERROR_MSG" | head -c 200 | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | tr -d '\n\r')
    PAYLOAD="$PAYLOAD,\"errorMessage\":\"$ESCAPED_ERROR\""
fi

FAILURE_TYPE=$(echo "$INPUT" | /usr/bin/jq -r '.failure_type // empty' 2>/dev/null)
if [ -n "$FAILURE_TYPE" ]; then
    PAYLOAD="$PAYLOAD,\"failureType\":\"$FAILURE_TYPE\""
fi

# Extract status (for stop events)
STATUS=$(echo "$INPUT" | /usr/bin/jq -r '.status // empty' 2>/dev/null)
if [ -n "$STATUS" ]; then
    PAYLOAD="$PAYLOAD,\"status\":\"$STATUS\""
fi

# Extract workspace/project info
PROJECT_ROOT=$(echo "$INPUT" | /usr/bin/jq -r '.workspace_roots[0] // empty' 2>/dev/null)
if [ -n "$PROJECT_ROOT" ]; then
    PAYLOAD="$PAYLOAD,\"projectRoot\":\"$PROJECT_ROOT\""
fi

# Extract transcript path (for browsing conversations)
TRANSCRIPT_PATH=$(echo "$INPUT" | /usr/bin/jq -r '.transcript_path // empty' 2>/dev/null)
if [ -n "$TRANSCRIPT_PATH" ]; then
    PAYLOAD="$PAYLOAD,\"transcriptPath\":\"$TRANSCRIPT_PATH\""
fi

# Extract agent transcript path (for subagents)
AGENT_TRANSCRIPT=$(echo "$INPUT" | /usr/bin/jq -r '.agent_transcript_path // empty' 2>/dev/null)
if [ -n "$AGENT_TRANSCRIPT" ]; then
    PAYLOAD="$PAYLOAD,\"agentTranscriptPath\":\"$AGENT_TRANSCRIPT\""
fi

# Extract attachments (for beforeReadFile, beforeSubmitPrompt)
ATTACHMENTS=$(echo "$INPUT" | /usr/bin/jq -c '.attachments // empty' 2>/dev/null)
if [ -n "$ATTACHMENTS" ] && [ "$ATTACHMENTS" != "null" ] && [ "$ATTACHMENTS" != "[]" ]; then
    PAYLOAD="$PAYLOAD,\"attachments\":$ATTACHMENTS"
fi

# Extract thinking info (for afterAgentThought)
THINKING_TEXT=$(echo "$INPUT" | /usr/bin/jq -r '.text // empty' 2>/dev/null)
if [ -n "$THINKING_TEXT" ] && [ "$EVENT_KIND" = "thinkingEnd" ]; then
    ESCAPED_THINKING=$(echo "$THINKING_TEXT" | head -c 500 | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | tr -d '\n\r')
    PAYLOAD="$PAYLOAD,\"thinkingText\":\"$ESCAPED_THINKING\""
fi

THINKING_DURATION=$(echo "$INPUT" | /usr/bin/jq -r '.duration_ms // empty' 2>/dev/null)
if [ -n "$THINKING_DURATION" ] && [ "$THINKING_DURATION" != "null" ]; then
    PAYLOAD="$PAYLOAD,\"thinkingDurationMs\":$THINKING_DURATION"
fi

# Extract response text (for afterAgentResponse)
RESPONSE_TEXT=$(echo "$INPUT" | /usr/bin/jq -r '.text // empty' 2>/dev/null)
if [ -n "$RESPONSE_TEXT" ] && [ "$EVENT_KIND" = "agentResponse" ]; then
    ESCAPED_RESPONSE=$(echo "$RESPONSE_TEXT" | head -c 300 | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | tr -d '\n\r')
    PAYLOAD="$PAYLOAD,\"responseText\":\"$ESCAPED_RESPONSE\""
fi

# Extract context compaction info (for preCompact)
CONTEXT_PERCENT=$(echo "$INPUT" | /usr/bin/jq -r '.context_usage_percent // empty' 2>/dev/null)
if [ -n "$CONTEXT_PERCENT" ]; then
    PAYLOAD="$PAYLOAD,\"contextUsagePercent\":$CONTEXT_PERCENT"
fi

CONTEXT_TOKENS=$(echo "$INPUT" | /usr/bin/jq -r '.context_tokens // empty' 2>/dev/null)
if [ -n "$CONTEXT_TOKENS" ]; then
    PAYLOAD="$PAYLOAD,\"contextTokens\":$CONTEXT_TOKENS"
fi

MESSAGES_COMPACT=$(echo "$INPUT" | /usr/bin/jq -r '.messages_to_compact // empty' 2>/dev/null)
if [ -n "$MESSAGES_COMPACT" ]; then
    PAYLOAD="$PAYLOAD,\"messagesToCompact\":$MESSAGES_COMPACT"
fi

# Close the JSON object
PAYLOAD="$PAYLOAD}"

# Log for debugging (truncated)
TOOL_LOG="${TOOL_NAME:-session}"
LOG_MSG="$(date): [$EVENT_KIND] $TOOL_LOG run=${RUN_ID:0:8}"
if [ -n "$AGENT_ID" ]; then
    LOG_MSG="$LOG_MSG agent=${AGENT_ID:0:8}"
fi
if [ -n "$SPAN_ID" ]; then
    LOG_MSG="$LOG_MSG span=${SPAN_ID:0:8}"
fi
echo "$LOG_MSG" >> "$LOG_FILE"

# Debug: log the payload we're sending
if [ "$DEBUG_MODE" = "1" ]; then
    echo "$(date): PAYLOAD:" >> "$DEBUG_LOG"
    echo "$PAYLOAD" | /usr/bin/jq '.' >> "$DEBUG_LOG" 2>/dev/null || echo "$PAYLOAD" >> "$DEBUG_LOG"
    echo "" >> "$DEBUG_LOG"
fi

# Send event to server (non-blocking with timeout)
/usr/bin/curl -s -X POST "$SERVER_URL" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" \
    --connect-timeout 1 \
    --max-time 2 \
    >/dev/null 2>&1 &

# Always exit successfully to not block the agent
exit 0
