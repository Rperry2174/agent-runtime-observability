#!/bin/bash
#
# Send test events to the observability server
# Usage: ./send-test-events.sh <scenario>
#
# Scenarios:
#   shell    - 3 shell commands
#   mcp      - 3 MCP tool calls
#   subagent - Task spawning subagents
#   file-ops - Read, Write, Edit operations
#   mixed    - Realistic mixed session
#   all      - Run all scenarios

set -e

SERVER_URL="${OBSERVABILITY_URL:-http://localhost:5274}"
RUN_ID_PREFIX="${RUN_ID_PREFIX:-test}"

send_event() {
  local json="$1"
  curl -s -X POST "$SERVER_URL/api/telemetry" \
    -H "Content-Type: application/json" \
    -d "$json" > /dev/null
  echo "  Sent: $(echo "$json" | jq -r '.eventKind // "event"')"
}

now_ms() {
  echo $(($(date +%s) * 1000 + RANDOM % 1000))
}

sleep_ms() {
  local ms=$1
  sleep "$(echo "scale=3; $ms/1000" | bc)"
}

# ============================================================================
# Scenario: Shell Commands
# ============================================================================
scenario_shell() {
  local RUN_ID="${RUN_ID_PREFIX}-shell-$(date +%s)"
  echo "Starting shell scenario: $RUN_ID"

  local T0=$(now_ms)

  # Session start
  send_event "$(cat <<EOF
{
  "eventKind": "sessionStart",
  "timestamp": $T0,
  "runId": "$RUN_ID",
  "source": "cursor",
  "projectRoot": "/test/project"
}
EOF
)"

  # Three shell commands
  local commands=("npm test" "ls -la" "pwd")
  for i in "${!commands[@]}"; do
    local cmd="${commands[$i]}"
    local SPAN_ID="shell-span-$i"
    local OFFSET=$((i * 1000))

    send_event "$(cat <<EOF
{
  "eventKind": "shellStart",
  "timestamp": $((T0 + OFFSET)),
  "runId": "$RUN_ID",
  "spanId": "$SPAN_ID",
  "toolName": "Shell",
  "toolInput": {"command": "$cmd", "cwd": "/test/project"}
}
EOF
)"

    sleep_ms 300

    send_event "$(cat <<EOF
{
  "eventKind": "shellEnd",
  "timestamp": $((T0 + OFFSET + 300)),
  "runId": "$RUN_ID",
  "spanId": "$SPAN_ID",
  "toolName": "Shell",
  "toolOutput": "Output of $cmd",
  "duration": 300
}
EOF
)"
  done

  # Session end
  send_event "$(cat <<EOF
{
  "eventKind": "sessionEnd",
  "timestamp": $((T0 + 4000)),
  "runId": "$RUN_ID",
  "status": "completed"
}
EOF
)"

  echo "Shell scenario complete: $RUN_ID"
  echo "View at: http://localhost:5273/observability?run=$RUN_ID"
}

# ============================================================================
# Scenario: MCP Calls
# ============================================================================
scenario_mcp() {
  local RUN_ID="${RUN_ID_PREFIX}-mcp-$(date +%s)"
  echo "Starting MCP scenario: $RUN_ID"

  local T0=$(now_ms)

  send_event "$(cat <<EOF
{
  "eventKind": "sessionStart",
  "timestamp": $T0,
  "runId": "$RUN_ID",
  "source": "cursor"
}
EOF
)"

  local tools=("web_search" "fetch_url" "execute_query")
  local inputs=('{"query": "TypeScript features"}' '{"url": "https://example.com"}' '{"sql": "SELECT * FROM users"}')

  for i in "${!tools[@]}"; do
    local tool="${tools[$i]}"
    local input="${inputs[$i]}"
    local SPAN_ID="mcp-span-$i"
    local OFFSET=$((i * 500))

    # Tool start
    send_event "$(cat <<EOF
{
  "eventKind": "toolStart",
  "timestamp": $((T0 + OFFSET)),
  "runId": "$RUN_ID",
  "spanId": "$SPAN_ID",
  "toolName": "$tool",
  "toolInput": $input,
  "hookEventName": "preToolUse"
}
EOF
)"

    sleep_ms 200

    # MCP end
    send_event "$(cat <<EOF
{
  "eventKind": "mcpEnd",
  "timestamp": $((T0 + OFFSET + 200)),
  "runId": "$RUN_ID",
  "spanId": "$SPAN_ID",
  "toolName": "$tool",
  "toolOutput": {"result": "Results for $tool"},
  "duration": 200
}
EOF
)"
  done

  send_event "$(cat <<EOF
{
  "eventKind": "sessionEnd",
  "timestamp": $((T0 + 2000)),
  "runId": "$RUN_ID",
  "status": "completed"
}
EOF
)"

  echo "MCP scenario complete: $RUN_ID"
}

# ============================================================================
# Scenario: Subagent
# ============================================================================
scenario_subagent() {
  local RUN_ID="${RUN_ID_PREFIX}-subagent-$(date +%s)"
  local SUBAGENT_ID="subagent-explore-1"
  echo "Starting subagent scenario: $RUN_ID"

  local T0=$(now_ms)

  send_event "$(cat <<EOF
{
  "eventKind": "sessionStart",
  "timestamp": $T0,
  "runId": "$RUN_ID",
  "source": "cursor"
}
EOF
)"

  # Task start
  send_event "$(cat <<EOF
{
  "eventKind": "toolStart",
  "timestamp": $((T0 + 100)),
  "runId": "$RUN_ID",
  "spanId": "task-span-1",
  "toolName": "Task",
  "toolInput": {"prompt": "Explore the codebase", "subagent_type": "explore"}
}
EOF
)"

  # Subagent start
  send_event "$(cat <<EOF
{
  "eventKind": "subagentStart",
  "timestamp": $((T0 + 150)),
  "runId": "$RUN_ID",
  "agentId": "$SUBAGENT_ID",
  "agentType": "explore",
  "model": "claude-3.5-sonnet",
  "parentSpanId": "task-span-1"
}
EOF
)"

  sleep_ms 100

  # Subagent does work
  local sub_tools=("Glob" "Grep" "Read")
  for i in "${!sub_tools[@]}"; do
    local tool="${sub_tools[$i]}"
    local SPAN_ID="sub-span-$i"
    local OFFSET=$((200 + i * 200))

    send_event "$(cat <<EOF
{
  "eventKind": "toolStart",
  "timestamp": $((T0 + OFFSET)),
  "runId": "$RUN_ID",
  "spanId": "$SPAN_ID",
  "toolName": "$tool",
  "agentId": "$SUBAGENT_ID",
  "parentSpanId": "task-span-1"
}
EOF
)"

    sleep_ms 100

    send_event "$(cat <<EOF
{
  "eventKind": "toolEnd",
  "timestamp": $((T0 + OFFSET + 100)),
  "runId": "$RUN_ID",
  "spanId": "$SPAN_ID",
  "duration": 100
}
EOF
)"
  done

  # Subagent stop
  send_event "$(cat <<EOF
{
  "eventKind": "subagentStop",
  "timestamp": $((T0 + 1000)),
  "runId": "$RUN_ID",
  "agentId": "$SUBAGENT_ID",
  "status": "completed"
}
EOF
)"

  send_event "$(cat <<EOF
{
  "eventKind": "sessionEnd",
  "timestamp": $((T0 + 1200)),
  "runId": "$RUN_ID",
  "status": "completed"
}
EOF
)"

  echo "Subagent scenario complete: $RUN_ID"
}

# ============================================================================
# Scenario: File Operations
# ============================================================================
scenario_file_ops() {
  local RUN_ID="${RUN_ID_PREFIX}-file-ops-$(date +%s)"
  echo "Starting file operations scenario: $RUN_ID"

  local T0=$(now_ms)

  send_event "$(cat <<EOF
{
  "eventKind": "sessionStart",
  "timestamp": $T0,
  "runId": "$RUN_ID",
  "source": "cursor"
}
EOF
)"

  # Read
  send_event "$(cat <<EOF
{
  "eventKind": "toolStart",
  "timestamp": $((T0 + 100)),
  "runId": "$RUN_ID",
  "spanId": "read-1",
  "toolName": "Read",
  "toolInput": {"file_path": "/project/package.json"}
}
EOF
)"
  sleep_ms 50
  send_event "$(cat <<EOF
{
  "eventKind": "toolEnd",
  "timestamp": $((T0 + 150)),
  "runId": "$RUN_ID",
  "spanId": "read-1",
  "duration": 50
}
EOF
)"

  # Write
  send_event "$(cat <<EOF
{
  "eventKind": "toolStart",
  "timestamp": $((T0 + 200)),
  "runId": "$RUN_ID",
  "spanId": "write-1",
  "toolName": "Write",
  "toolInput": {"file_path": "/project/test.txt", "content": "Hello world"}
}
EOF
)"
  sleep_ms 50
  send_event "$(cat <<EOF
{
  "eventKind": "toolEnd",
  "timestamp": $((T0 + 250)),
  "runId": "$RUN_ID",
  "spanId": "write-1",
  "duration": 50
}
EOF
)"

  # Edit
  send_event "$(cat <<EOF
{
  "eventKind": "toolStart",
  "timestamp": $((T0 + 300)),
  "runId": "$RUN_ID",
  "spanId": "edit-1",
  "toolName": "Edit",
  "toolInput": {"file_path": "/project/test.txt", "old_string": "Hello", "new_string": "Hi"}
}
EOF
)"
  sleep_ms 50
  send_event "$(cat <<EOF
{
  "eventKind": "fileEditEnd",
  "timestamp": $((T0 + 350)),
  "runId": "$RUN_ID",
  "spanId": "edit-1",
  "duration": 50
}
EOF
)"

  send_event "$(cat <<EOF
{
  "eventKind": "sessionEnd",
  "timestamp": $((T0 + 500)),
  "runId": "$RUN_ID",
  "status": "completed"
}
EOF
)"

  echo "File operations scenario complete: $RUN_ID"
}

# ============================================================================
# Scenario: Mixed (Full Session)
# ============================================================================
scenario_mixed() {
  local RUN_ID="${RUN_ID_PREFIX}-mixed-$(date +%s)"
  local SUBAGENT_ID="explore-agent-1"
  echo "Starting mixed scenario: $RUN_ID"

  local T0=$(now_ms)

  # Session start with prompt
  send_event "$(cat <<EOF
{
  "eventKind": "sessionStart",
  "timestamp": $T0,
  "runId": "$RUN_ID",
  "source": "cursor",
  "projectRoot": "/test/project"
}
EOF
)"

  send_event "$(cat <<EOF
{
  "eventKind": "beforeSubmitPrompt",
  "timestamp": $((T0 + 10)),
  "runId": "$RUN_ID",
  "prompt": "Review the codebase for security issues"
}
EOF
)"

  # Thinking
  send_event "$(cat <<EOF
{
  "eventKind": "thinkingEnd",
  "timestamp": $((T0 + 2000)),
  "runId": "$RUN_ID",
  "thinkingDurationMs": 2000,
  "thinkingText": "I need to analyze this codebase for security vulnerabilities. First, I should explore the structure..."
}
EOF
)"

  # Task + Subagent
  send_event "$(cat <<EOF
{
  "eventKind": "toolStart",
  "timestamp": $((T0 + 2100)),
  "runId": "$RUN_ID",
  "spanId": "task-1",
  "toolName": "Task",
  "toolInput": {"prompt": "Find security-related code"}
}
EOF
)"

  send_event "$(cat <<EOF
{
  "eventKind": "subagentStart",
  "timestamp": $((T0 + 2150)),
  "runId": "$RUN_ID",
  "agentId": "$SUBAGENT_ID",
  "agentType": "explore",
  "parentSpanId": "task-1"
}
EOF
)"

  # Subagent work
  send_event "$(cat <<EOF
{
  "eventKind": "toolStart",
  "timestamp": $((T0 + 2200)),
  "runId": "$RUN_ID",
  "spanId": "grep-1",
  "toolName": "Grep",
  "toolInput": {"pattern": "password|secret|token"},
  "agentId": "$SUBAGENT_ID",
  "parentSpanId": "task-1"
}
EOF
)"
  sleep_ms 100
  send_event "$(cat <<EOF
{
  "eventKind": "toolEnd",
  "timestamp": $((T0 + 2300)),
  "runId": "$RUN_ID",
  "spanId": "grep-1",
  "duration": 100
}
EOF
)"

  send_event "$(cat <<EOF
{
  "eventKind": "subagentStop",
  "timestamp": $((T0 + 2500)),
  "runId": "$RUN_ID",
  "agentId": "$SUBAGENT_ID",
  "status": "completed"
}
EOF
)"

  # Main agent reads files
  local files=("auth.ts" "config.ts")
  for i in "${!files[@]}"; do
    local file="${files[$i]}"
    local OFFSET=$((3000 + i * 200))

    send_event "$(cat <<EOF
{
  "eventKind": "toolStart",
  "timestamp": $((T0 + OFFSET)),
  "runId": "$RUN_ID",
  "spanId": "read-$i",
  "toolName": "Read",
  "toolInput": {"file_path": "/src/$file"}
}
EOF
)"
    sleep_ms 50
    send_event "$(cat <<EOF
{
  "eventKind": "toolEnd",
  "timestamp": $((T0 + OFFSET + 50)),
  "runId": "$RUN_ID",
  "spanId": "read-$i",
  "duration": 50
}
EOF
)"
  done

  # Write report
  send_event "$(cat <<EOF
{
  "eventKind": "toolStart",
  "timestamp": $((T0 + 3500)),
  "runId": "$RUN_ID",
  "spanId": "write-1",
  "toolName": "Write",
  "toolInput": {"file_path": "/security-report.md", "content": "# Security Audit\\n..."}
}
EOF
)"
  sleep_ms 50
  send_event "$(cat <<EOF
{
  "eventKind": "toolEnd",
  "timestamp": $((T0 + 3550)),
  "runId": "$RUN_ID",
  "spanId": "write-1",
  "duration": 50
}
EOF
)"

  send_event "$(cat <<EOF
{
  "eventKind": "sessionEnd",
  "timestamp": $((T0 + 4000)),
  "runId": "$RUN_ID",
  "status": "completed"
}
EOF
)"

  echo "Mixed scenario complete: $RUN_ID"
  echo ""
  echo "Verifying trace..."
  sleep 1
  curl -s "$SERVER_URL/api/runs/$RUN_ID/verify" | jq -r '.stats | "Spans: \(.totalSpans), Agents: \(.agentCount), Errors: \(.errorSpans)"'
}

# ============================================================================
# Main
# ============================================================================
print_usage() {
  echo "Usage: $0 <scenario>"
  echo ""
  echo "Scenarios:"
  echo "  shell     - 3 shell commands"
  echo "  mcp       - 3 MCP tool calls"
  echo "  subagent  - Task spawning subagents"
  echo "  file-ops  - Read, Write, Edit operations"
  echo "  mixed     - Realistic mixed session"
  echo "  all       - Run all scenarios"
  echo ""
  echo "Environment variables:"
  echo "  OBSERVABILITY_URL - Server URL (default: http://localhost:5274)"
  echo "  RUN_ID_PREFIX     - Prefix for run IDs (default: test)"
}

case "${1:-}" in
  shell)
    scenario_shell
    ;;
  mcp)
    scenario_mcp
    ;;
  subagent)
    scenario_subagent
    ;;
  file-ops)
    scenario_file_ops
    ;;
  mixed)
    scenario_mixed
    ;;
  all)
    scenario_shell
    echo ""
    scenario_mcp
    echo ""
    scenario_subagent
    echo ""
    scenario_file_ops
    echo ""
    scenario_mixed
    ;;
  -h|--help|help)
    print_usage
    ;;
  *)
    echo "Unknown scenario: $1"
    echo ""
    print_usage
    exit 1
    ;;
esac
