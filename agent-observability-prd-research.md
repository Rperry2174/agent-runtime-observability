# Agent Observability PRD Research
## Market Research & User Insights for Claude/Cursor Agent Monitoring

**Author:** Ryan (Cursor Technical Enablement)  
**Date:** January 2026  
**Sources:** Reddit (r/ClaudeAI, r/ClaudeCode), Hacker News, GitHub Issues, Industry Blogs

---

## Executive Summary

There's a clear and growing demand for observability tooling around AI coding agents like Claude Code and Cursor. Users consistently describe the current experience as a "black box" — they can see agents working, but have no visibility into *what* they're doing, *why* they're making certain decisions, or *how* to debug when things go wrong.

This document synthesizes research from across the web to inform a PRD for agent observability tooling.

---

## 1. Primary Pain Points (User Voices)

### 1.1 Subagent Black Box Problem

**Reddit Thread that Sparked This Research:**
> "I really like using subagents (especially in parallel) but I have found there is not enough observability into their approach, their initial instructions, their reasoning. Sometimes they start to execute tasks that seem to be in divergence of the main thread and it's a black box."
> — u/Budget_Map_3333, r/ClaudeAI

**Additional User Quotes:**

> "When an agent takes 30 seconds to respond, you need to know if the delay was caused by the LLM 'thinking' or by a slow third-party API."

> "You can't see the pan. You can't see how high the flame is. You can't see that they accidentally grabbed the chili flakes instead of oregano... This is exactly what happens when you ask Claude Code to fix a bug."

> "It's not pair programming at least what I'm doing. I'm designing and directing the development of applications. The agents are responsible for implementing those designs under my direction."

### 1.2 Cancellation Cascade Problem

From the original Reddit thread:
> "I have frequently had sessions where multiple agents are working in parallel and it takes just one agent to suggest a completely wrong file edit, and cancelling it will cancel all other agents too!"

### 1.3 Cost & Token Visibility

From Cursor Forum:
> "I'd like to get visibility into background agent costs... to use them more efficiently going forward, I'd like to know how much each execution costs."

From Quesma Blog:
> "Hitting your Claude Code limit mid-sprint feels less like a feature and more like a bug you can't fix. One minute you're deep in the flow, the next you're staring at a lockout."

### 1.4 Debugging Without Runtime Context

From debugging guide:
> "Claude almost never fails because it lacks intelligence. It fails because it lacks visibility... You're asking a brilliant chef to fix your burning pasta—but they can only read the recipe card. They can't see the flame."

---

## 2. GitHub Feature Requests (Official Channels)

### 2.1 Parent-Child Agent Communication (Issue #1770)

**Title:** Enable Parent-Child Agent Communication and Monitoring in Task Tool

**Problem Statement:**
> "When a Claude instance spawns sub-agents using the Task tool, the parent has no visibility into sub-agent activities until completion. Sub-agents operate as black boxes."

**Real Failure Case Observed:**
1. Agent began correctly (console showed searches starting)
2. Searches were "backtracked out" — agent changed approach mid-execution
3. Agent used Bash to create Python simulation scripts instead of real work
4. Result: 10 fake "agent_N.py" files with simulated results

**Proposed Capabilities:**
- Stream events from sub-agents (tool calls, decisions, progress)
- Send control messages to sub-agents mid-execution
- Pause/resume/halt capabilities
- Broadcast messages to all active agents

**Use Cases Listed:**
- M&A due diligence (20 parallel research agents, halt on deal-breaker)
- Code migration (prevent conflicts, ensure patterns)
- Security incident response (pivot all agents when IOC discovered)

### 2.2 Parallel Agent Execution Mode (Issue #3013)

**Requested Features:**
- Recursive task decomposition for complex requests
- 47+ active agents working simultaneously
- Status dashboard showing completion progress
- File ownership to prevent conflicts

---

## 3. Existing Solutions (Competitive Landscape)

### 3.1 Open Source Projects

| Project | Description | Approach |
|---------|-------------|----------|
| **claude-code-hooks-multi-agent-observability** (disler) | Real-time monitoring via hook event tracking | Hook scripts → HTTP POST → SQLite → WebSocket → Vue UI |
| **multi-agent-dashboard** (TheAIuniversity) | Live tracking of 68+ agents | WebSocket-based with Haiku summaries |
| **claude-code-otel** (ColeMurray) | Grafana-based monitoring | OTel → Prometheus + Loki → Grafana |
| **dev-agent-lens** (Arize) | Proxy-based tracing | LiteLLM proxy → OpenInference spans |
| **AgTrace** | Cross-provider log normalization | Auto-discovers logs from Claude/Codex/Gemini |

### 3.2 Commercial Platforms

| Platform | Focus |
|----------|-------|
| **Datadog AI Agents Console** | Claude Code adoption, performance, spend |
| **Langfuse** | Workflow-level tracing, prompt-to-output |
| **LangSmith** | Framework-agnostic tracing and eval |
| **Arize/Phoenix** | OpenInference spans, model quality |
| **Helicone** | Session-level agent workflow execution |
---

## 4. Key Observability Requirements

### 4.1 Real-Time Visibility

**What Users Want to See:**
- Which tool each agent is calling right now
- What parameters are being passed
- How much time/tokens each step consumed
- When an agent deviates from instructions
- Error states and recovery attempts
- what hooks, rules, and skills got used 

### 4.2 Trace Hierarchy

**Critical for Multi-Agent:**
```
Run (session)
├── Agent 1 (main)
│   ├── Span: Grep search (2.3s, 150 tokens)
│   ├── Span: Read file (0.8s)
│   ├── Task: Subagent spawn
│   │   ├── Span: Web search
│   │   └── Span: Write file
│   └── Span: Final output
├── Agent 2 (parallel)
└── Agent 3 (parallel)
```

### 4.3 Control Plane

**Minimum Viable Control:**
- View intermediate results before completion

**Advanced Control (to be considered for later do NOT do this for mvp):**
- Pause/resume individual agents (too )
- Halt all agents (emergency stop)
- Send messages to running agents
- Broadcast context updates across all agents
- Redirect agent strategy mid-execution

### 4.4 Cost Attribution (also do this for later do NOT do that for this)

**Per-Session Metrics:**
- Total tokens (input/output split)
- API costs by model
- Tool call counts
- Time breakdown

**Aggregated Analytics:**
- Cost per user/project
- Model usage distribution
- Quota consumption rate

---

## 5. Architecture Patterns

### 5.1 Hook-Based Collection (Most Common)

```
Claude Code Hooks → HTTP POST → Server → WebSocket → Client UI
                                  ↓
                              SQLite/DuckDB
```

**Available Hooks:**
- SessionStart
- UserPromptSubmit
- PreToolUse
- PostToolUse
- SubagentStop
- Stop
- Notification
- PreCompact
- SessionEnd

### 5.2 Proxy-Based Tracing

```
Claude Code → LiteLLM Proxy → Claude API
                ↓
            OTel Spans → Observability Backend
```

**Advantages:**
- Captures full request/response
- Works without hooks
- Can add rate limiting/caching

### 5.3 OTEL Native Export

```
Claude Code (OTEL enabled) → OTel Collector → Backend
```

**Advantages:**
- No additional code needed
- Standard format
- Vendor-agnostic

---

## 6. UI/UX Patterns

### 6.1 Swimlane/Timeline View (Recommended)

Users consistently want a "Grafana-like" or honeycomb like or "Gantt chart" view:

```
Time →
Agent 1 (name): ████████████████████░░░░░░░░
Agent 2:     ██████████░░░░░░░░░░░░░░
Agent 3:         ██████████████░░░░░░
         ↑      ↑           ↑
       Turn   Tool        Turn
       Start  Call        End
```

**Each bar segment shows:**
- Tool type (color-coded)
- Duration
- Status (running/complete/failed)
- Click to drill down

### 6.2 Inspect Panel

**On span click, show:**
- Agent name
- Tool name + type
- model
- Start/end time, duration
- Input parameters (truncated)
- Output preview
- File paths affected
- Error details if failed

### 6.3 Run Summary Header

**Always visible:**
- Run name/status
- Duration (elapsed/total)
- Agent count / peak concurrency
- Total tool calls
- Total turns (chat markers)
- Cost estimate

---


## 8. Demo Mode Requirement

Multiple users mention needing demos without running real prompts:

> "I want to demo this in 15–45 seconds without running real prompts."

**Demo should include:**
- 3-6 synthetic agents with staggered starts
- Mix of tool spans (Grep, Read, Task, Write)
- some external api (or mock external api ) -- getting hit and also showing up 
- At least one Task spawn showing sublanes
- Chat/turn markers
- Complete in 20-30 seconds

---

## 9. Feature Prioritization Matrix

### Must Have (P0)
- [ ] Real-time tool call visibility
- [ ] Agent-level swimlanes
- [ ] Basic timing/duration metrics
- [ ] Error state visibility
- [ ] Subagent/Task tool nesting display

---

## 10. Competitive Positioning for Cursor

### 10.2 vs Third-Party Tools

Most existing solutions require complex setup (Docker, Prometheus, Grafana). An integrated solution would win on:
- Zero-config experience
- IDE-native integration
- Real-time vs batch

### 10.3 Unique Opportunity

Cursor Background Agents create an even stronger need because:
- They run in cloud VMs, not local
- Users can't even see console output
- Cost is usage-based, needs visibility

---

## 11. Key Quotes for PRD

### On the Core Problem
> "AI agents are getting more capable, but we're increasingly in the dark about what they're actually doing. They run complex multi-step workflows, call dozens of tools, reason through problems - and we just watch the output scroll by. It's a black box, and humans end up being led around by the agent rather than understanding it."

### On What's Needed
> "I can see what each agent did, when, and why. I can debug/monitor a parallel run in real time. I can replay a synthetic demo run without running real prompts."

### On Trust
> "Without this capability, multi-agent orchestration will continue to suffer from reliability issues as agents optimize for appearing successful rather than achieving assigned goals."

---

## 12. Source Links

### Reddit Threads
- [Subagents (Tasks) in CC: We need more observability](https://www.reddit.com/r/ClaudeAI/comments/1lxblpf/subagents_tasks_in_cc_we_need_more_observability/)
- r/ClaudeCode various threads on parallel agents

### GitHub Issues
- [anthropics/claude-code#1770: Parent-Child Agent Communication](https://github.com/anthropics/claude-code/issues/1770)
- [anthropics/claude-code#3013: Parallel Agent Execution Mode](https://github.com/anthropics/claude-code/issues/3013)

### Technical Guides
- [Arize: Claude Code Observability and Tracing](https://arize.com/blog/claude-code-observability-and-tracing-introducing-dev-agent-lens/)
- [SigNoz: Bringing Observability to Claude Code](https://signoz.io/blog/claude-code-monitoring-with-opentelemetry/)
- [Datadog: Claude Code Monitoring](https://www.datadoghq.com/blog/claude-code-monitoring/)
- [Anthropic: Claude Code Best Practices](https://www.anthropic.com/engineering/claude-code-best-practices)

### Open Source Projects
- [disler/claude-code-hooks-multi-agent-observability](https://github.com/disler/claude-code-hooks-multi-agent-observability)
- [ColeMurray/claude-code-otel](https://github.com/ColeMurray/claude-code-otel)
- [lanegrid/agtrace](https://github.com/lanegrid/agtrace)

---

## Next Steps

1. **Define MVP scope** based on P0 features above
2. **Validate with Cursor GTM team** — does this resonate with customer pain points?
3. **Prototype swimlane UI** — can start with React/D3 for quick iteration
4. **Evaluate hook architecture** — what hooks does Cursor expose vs Claude Code?
5. **Consider competitive demo** — show this working against Claude Code's raw OTEL

---

*This research was compiled from 50+ sources including Reddit, Hacker News, GitHub issues, and technical blog posts. All quotes are paraphrased or directly cited from public sources.*
