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
SHELL_SPAN_FILE="/tmp/observability-shell-spans.log"
SHELL_AGENT_FILE="/tmp/observability-shell-agent-map.log"

# Enable debug mode by default (set HOOK_DEBUG=0 to disable)
DEBUG_MODE="${HOOK_DEBUG:-1}"

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

generate_shell_span_id() {
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr '[:upper:]' '[:lower:]'
  else
    printf 'shell_%s_%s_%s' "$(date +%s)" "$$" "$RANDOM"
  fi
}

sanitize_shell_command() {
  printf '%s' "$1" | tr '\t\r\n' ' '
}

normalize_tool_name() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

record_shell_agent_map() {
  local tool_name_raw="$1"
  local tool_command_raw="$2"
  local tool_agent_id="$3"
  local tool_span_id="$4"

  if [ -z "$tool_name_raw" ]; then
    return
  fi

  local tool_name
  tool_name=$(normalize_tool_name "$tool_name_raw")

  case "$tool_name" in
    shell|bash|command|terminal|run_terminal_cmd)
      local tool_command
      tool_command=$(sanitize_shell_command "$tool_command_raw")
      if [ -n "$tool_command" ] && [ -n "$tool_agent_id" ]; then
        printf '%s\t%s\t%s\t%s\t%s\n' "$RUN_ID" "$tool_command" "$tool_agent_id" "$tool_span_id" "$(date +%s)" >> "$SHELL_AGENT_FILE"
      fi
      ;;
  esac
}

extract_shell_agent_from_map() {
  local map_file="$1"
  local run_id="$2"
  local shell_command="$3"
  local match_line

  if [ ! -f "$map_file" ]; then
    return
  fi

  match_line=$(awk -v r="$run_id" -v c="$shell_command" 'BEGIN{FS="\t"} $1==r && $2==c {line=$0} END{print line}' "$map_file")
  if [ -z "$match_line" ]; then
    return
  fi

  SHELL_AGENT_ID=$(printf '%s' "$match_line" | awk -F'\t' '{print $3}')
  SHELL_PARENT_SPAN_ID=$(printf '%s' "$match_line" | awk -F'\t' '{print $4}')

  awk -v r="$run_id" -v c="$shell_command" 'BEGIN{FS=OFS="\t"} {if($1==r && $2==c && !done){done=1; next} print}' "$map_file" > "${map_file}.tmp" \
    && mv "${map_file}.tmp" "$map_file"
}

SHELL_COMMAND=""
SHELL_SPAN_ID=""
SHELL_AGENT_ID=""
SHELL_PARENT_SPAN_ID=""

if [ "$EVENT_KIND" = "toolStart" ]; then
  TOOL_NAME_RAW=$(echo "$INPUT" | /usr/bin/jq -r '.tool_name // empty' 2>/dev/null)
  TOOL_COMMAND_RAW=$(echo "$INPUT" | /usr/bin/jq -r '.tool_input.command // .tool_input.cmd // .command // empty' 2>/dev/null)
  TOOL_AGENT_ID=$(echo "$INPUT" | /usr/bin/jq -r '.agent_id // .agentId // .subagent_id // .task_agent_id // empty' 2>/dev/null)
  TOOL_SPAN_ID=$(echo "$INPUT" | /usr/bin/jq -r '.tool_use_id // empty' 2>/dev/null)
  record_shell_agent_map "$TOOL_NAME_RAW" "$TOOL_COMMAND_RAW" "$TOOL_AGENT_ID" "$TOOL_SPAN_ID"
fi

if [ "$EVENT_KIND" = "shellStart" ] || [ "$EVENT_KIND" = "shellEnd" ]; then
  RAW_COMMAND=$(echo "$INPUT" | /usr/bin/jq -r '.command // empty' 2>/dev/null)
  SHELL_COMMAND=$(sanitize_shell_command "$RAW_COMMAND")
  extract_shell_agent_from_map "$SHELL_AGENT_FILE" "$RUN_ID" "$SHELL_COMMAND"
  if [ -z "$SHELL_AGENT_ID" ]; then
    SHELL_AGENT_ID=$(echo "$INPUT" | /usr/bin/jq -r '.agent_id // .agentId // .subagent_id // .task_agent_id // empty' 2>/dev/null)
  fi

  if [ "$EVENT_KIND" = "shellStart" ]; then
    SHELL_SPAN_ID=$(generate_shell_span_id)
    printf '%s\t%s\t%s\t%s\n' "$RUN_ID" "$SHELL_COMMAND" "$SHELL_SPAN_ID" "$SHELL_AGENT_ID" >> "$SHELL_SPAN_FILE"
  else
    if [ -f "$SHELL_SPAN_FILE" ]; then
      MATCH_LINE=$(awk -v r="$RUN_ID" -v c="$SHELL_COMMAND" 'BEGIN{FS="\t"} $1==r && $2==c {print $0; exit}' "$SHELL_SPAN_FILE")
      if [ -n "$MATCH_LINE" ]; then
        SHELL_SPAN_ID=$(printf '%s' "$MATCH_LINE" | awk -F'\t' '{print $3}')
        if [ -z "$SHELL_AGENT_ID" ]; then
          SHELL_AGENT_ID=$(printf '%s' "$MATCH_LINE" | awk -F'\t' '{print $4}')
        fi
        awk -v r="$RUN_ID" -v c="$SHELL_COMMAND" 'BEGIN{FS=OFS="\t"} {if($1==r && $2==c && !done){done=1; next} print}' "$SHELL_SPAN_FILE" > "${SHELL_SPAN_FILE}.tmp" \
          && mv "${SHELL_SPAN_FILE}.tmp" "$SHELL_SPAN_FILE"
      fi
    fi
  fi
fi

# Build JSON payload safely using jq (avoid manual escaping).
# Any truncation happens on the encoded string form.
PAYLOAD=$(
  echo "$INPUT" | /usr/bin/jq -c \
    --arg eventKind "$EVENT_KIND" \
    --argjson timestamp "$(date +%s000)" \
    --arg shellSpanId "$SHELL_SPAN_ID" \
    --arg shellAgentId "$SHELL_AGENT_ID" \
    --arg shellCommand "$SHELL_COMMAND" \
    '
      def trunc($n):
        if . == null then null
        elif type == "string" then .[0:$n]
        else (tojson | .[0:$n])
        end;

      {
        eventKind: $eventKind,
        timestamp: $timestamp,
        runId: (.conversation_id // .session_id // null),
        source: (if .conversation_id then "cursor" elif .session_id then "claude" else null end),

        spanId: (if ($eventKind == "shellStart" or $eventKind == "shellEnd") and $shellSpanId != "" then $shellSpanId else (.tool_use_id // null) end),
        agentId: (if ($eventKind == "shellStart" or $eventKind == "shellEnd") and $shellAgentId != "" then $shellAgentId else (.agent_id // .agentId // .subagent_id // .task_agent_id // null) end),
        parentAgentId: (.parent_agent_id // .parentAgentId // null),
        parentSpanId: (.parent_span_id // .parentSpanId // .task_span_id // null),

        toolName: (if $eventKind == "shellStart" or $eventKind == "shellEnd" then "Shell" else (.tool_name // null) end),
        toolInput: (if $eventKind == "shellStart" then ({command: $shellCommand, cwd: (.cwd // .working_directory // null)} | trunc(500)) else (.tool_input? | trunc(500)) end),
        toolOutput: (if $eventKind == "shellEnd" then (.output? | trunc(300)) else (.tool_output? | trunc(300)) end),
        prompt: (.prompt? | trunc(1000)),

        hookEventName: (.hook_event_name // null),
        turnId: (.generation_id // null),
        model: (.model // null),
        agentType: (.subagent_type // .agent_type // null),

        duration: (.duration // .duration_ms // null),
        errorMessage: (.error_message? | trunc(200)),
        failureType: (.failure_type // null),
        status: (.status // null),

        projectRoot: (.workspace_roots[0] // null),
        transcriptPath: (.transcript_path // null),
        agentTranscriptPath: (.agent_transcript_path // null),

        attachments: (if (.attachments? // null) == null or .attachments == [] then null else .attachments end),

        thinkingText: (if $eventKind == "thinkingEnd" then (.text? | trunc(500)) else null end),
        thinkingDurationMs: (.duration_ms // null),
        responseText: (if $eventKind == "agentResponse" then (.text? | trunc(300)) else null end),

        contextUsagePercent: (.context_usage_percent // null),
        contextTokens: (.context_tokens // null),
        messagesToCompact: (.messages_to_compact // null)
      }
      | with_entries(select(.value != null and .value != "" and .value != []))
    ' 2>/dev/null
)

if [ -z "$PAYLOAD" ] || [ "$PAYLOAD" = "null" ]; then
  echo "$(date): [$EVENT_KIND] SKIP - failed to build payload" >> "$LOG_FILE"
  exit 0
fi

# Log for debugging (truncated)
TOOL_LOG=$(echo "$PAYLOAD" | /usr/bin/jq -r '.toolName // .hookEventName // "session"' 2>/dev/null)
LOG_MSG="$(date): [$EVENT_KIND] $TOOL_LOG run=${RUN_ID:0:8}"
AGENT_ID_SHORT=$(echo "$PAYLOAD" | /usr/bin/jq -r '.agentId // empty' 2>/dev/null)
SPAN_ID_SHORT=$(echo "$PAYLOAD" | /usr/bin/jq -r '.spanId // empty' 2>/dev/null)
if [ -n "$AGENT_ID_SHORT" ]; then LOG_MSG="$LOG_MSG agent=${AGENT_ID_SHORT:0:8}"; fi
if [ -n "$SPAN_ID_SHORT" ]; then LOG_MSG="$LOG_MSG span=${SPAN_ID_SHORT:0:8}"; fi
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
