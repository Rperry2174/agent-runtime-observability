/**
 * Integration Tests for TraceStore - All Hook Event Types
 *
 * These tests verify that traces are properly generated for all supported
 * Cursor hook events. Each test simulates a realistic sequence of events.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TraceStore } from './trace-store.js';
import { TelemetryEvent, TraceUpdate, Span } from './types.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('TraceStore Integration - Hook Event Types', () => {
  let store: TraceStore;
  let tempDir: string;
  let updates: TraceUpdate[];

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-integration-'));
    store = new TraceStore(tempDir);
    updates = [];
    store.setUpdateCallback((update) => {
      updates.push(update);
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // Helper to create a base session
  const createSession = (runId: string) => {
    store.processEvent({
      eventKind: 'sessionStart',
      timestamp: Date.now(),
      runId,
      source: 'cursor',
      projectRoot: '/test/project',
    });
  };

  // Helper to end a session
  const endSession = (runId: string, status = 'completed') => {
    store.processEvent({
      eventKind: 'sessionEnd',
      timestamp: Date.now(),
      runId,
      status,
    });
  };

  // Helper to get spans summary
  const getSpansSummary = (runId: string): { tools: string[]; statuses: string[] } => {
    const result = store.getSpans(runId);
    const spans = result?.spans || [];
    return {
      tools: spans.map(s => s.toolName),
      statuses: spans.map(s => s.status),
    };
  };

  describe('Shell Command Events', () => {
    it('should track shell commands with shellStart/shellEnd events', () => {
      const runId = 'shell-test-1';
      const t0 = Date.now();
      createSession(runId);

      // Simulate shellStart with synthetic span ID (as the hook generates)
      const shellSpanId = 'shell-span-123';
      store.processEvent({
        eventKind: 'shellStart',
        timestamp: t0 + 100,
        runId,
        spanId: shellSpanId,
        toolName: 'Shell',
        toolInput: { command: 'npm test', cwd: '/test/project' },
      });

      // Verify span is running
      let result = store.getSpans(runId);
      let shellSpan = result?.spans.find(s => s.spanId === shellSpanId);
      expect(shellSpan?.status).toBe('running');
      expect(shellSpan?.toolName).toBe('Shell');

      // Simulate shellEnd
      store.processEvent({
        eventKind: 'shellEnd',
        timestamp: t0 + 500,
        runId,
        spanId: shellSpanId,
        toolName: 'Shell',
        toolOutput: 'All tests passed',
        duration: 400,
      });

      // Verify span completed
      result = store.getSpans(runId);
      shellSpan = result?.spans.find(s => s.spanId === shellSpanId);
      expect(shellSpan?.status).toBe('ok');
      expect(shellSpan?.durationMs).toBe(400);
      expect(shellSpan?.outputPreview).toContain('All tests passed');
    });

    it('should handle multiple sequential shell commands', () => {
      const runId = 'shell-test-2';
      const t0 = Date.now();
      createSession(runId);

      const commands = ['npm install', 'npm test', 'npm run build'];

      for (let i = 0; i < commands.length; i++) {
        const spanId = `shell-span-${i}`;
        store.processEvent({
          eventKind: 'shellStart',
          timestamp: t0 + i * 200,
          runId,
          spanId,
          toolName: 'Shell',
          toolInput: { command: commands[i] },
        });

        store.processEvent({
          eventKind: 'shellEnd',
          timestamp: t0 + i * 200 + 100,
          runId,
          spanId,
          toolOutput: `Output of ${commands[i]}`,
          duration: 100,
        });
      }

      const result = store.getSpans(runId);
      const shellSpans = result?.spans.filter(s => s.toolName === 'Shell') || [];
      expect(shellSpans).toHaveLength(3);
      expect(shellSpans.every(s => s.status === 'ok')).toBe(true);
    });

    it('should skip shell events without span ID (fallback to preToolUse)', () => {
      const runId = 'shell-test-3';
      createSession(runId);

      // shellStart without spanId should be skipped
      store.processEvent({
        eventKind: 'shellStart',
        timestamp: Date.now(),
        runId,
        // No spanId - simulates missing synthetic span ID
        toolInput: { command: 'ls -la' },
      });

      const result = store.getSpans(runId);
      expect(result?.spans).toHaveLength(0);
    });
  });

  describe('MCP Execution Events', () => {
    it('should track MCP tool completion with mcpEnd event', () => {
      const runId = 'mcp-test-1';
      const t0 = Date.now();
      createSession(runId);

      // Start MCP tool via preToolUse
      const mcpSpanId = 'mcp-span-123';
      store.processEvent({
        eventKind: 'toolStart',
        timestamp: t0,
        runId,
        spanId: mcpSpanId,
        toolName: 'fetch_url',
        toolInput: { url: 'https://example.com' },
        hookEventName: 'preToolUse',
      });

      // Complete with mcpEnd
      store.processEvent({
        eventKind: 'mcpEnd',
        timestamp: t0 + 300,
        runId,
        spanId: mcpSpanId,
        toolName: 'fetch_url',
        toolOutput: { content: 'Page content...' },
        duration: 300,
      });

      const result = store.getSpans(runId);
      const mcpSpan = result?.spans.find(s => s.spanId === mcpSpanId);
      expect(mcpSpan?.status).toBe('ok');
      expect(mcpSpan?.toolName).toBe('fetch_url');
      expect(mcpSpan?.durationMs).toBe(300);
    });

    it('should track multiple MCP tool calls', () => {
      const runId = 'mcp-test-2';
      const t0 = Date.now();
      createSession(runId);

      const mcpTools = ['search', 'fetch_url', 'execute_sql'];

      for (let i = 0; i < mcpTools.length; i++) {
        const spanId = `mcp-span-${i}`;
        store.processEvent({
          eventKind: 'toolStart',
          timestamp: t0 + i * 500,
          runId,
          spanId,
          toolName: mcpTools[i],
          toolInput: { query: `test-${i}` },
        });

        store.processEvent({
          eventKind: 'mcpEnd',
          timestamp: t0 + i * 500 + 300,
          runId,
          spanId,
          toolName: mcpTools[i],
          toolOutput: { result: `result-${i}` },
          duration: 300,
        });
      }

      const result = store.getSpans(runId);
      expect(result?.spans).toHaveLength(3);
      expect(result?.spans.map(s => s.toolName)).toEqual(mcpTools);
    });
  });

  describe('File Edit Events', () => {
    it('should track file edits with fileEditEnd event', () => {
      const runId = 'file-edit-test-1';
      const t0 = Date.now();
      createSession(runId);

      // Start edit via preToolUse
      const spanId = 'edit-span-123';
      store.processEvent({
        eventKind: 'toolStart',
        timestamp: t0,
        runId,
        spanId,
        toolName: 'Edit',
        toolInput: { file_path: '/test/file.ts', old_string: 'foo', new_string: 'bar' },
      });

      // Complete with fileEditEnd
      store.processEvent({
        eventKind: 'fileEditEnd',
        timestamp: t0 + 50,
        runId,
        spanId,
        toolName: 'Edit',
        duration: 50,
      });

      const result = store.getSpans(runId);
      const editSpan = result?.spans.find(s => s.spanId === spanId);
      expect(editSpan?.status).toBe('ok');
      expect(editSpan?.toolName).toBe('Edit');
      expect(editSpan?.files).toContain('/test/file.ts');
    });

    it('should track Write tool operations', () => {
      const runId = 'file-write-test-1';
      const t0 = Date.now();
      createSession(runId);

      const spanId = 'write-span-123';
      store.processEvent({
        eventKind: 'toolStart',
        timestamp: t0,
        runId,
        spanId,
        toolName: 'Write',
        toolInput: { file_path: '/test/new-file.ts', content: 'export const x = 1;' },
      });

      store.processEvent({
        eventKind: 'toolEnd',
        timestamp: t0 + 30,
        runId,
        spanId,
        duration: 30,
      });

      const result = store.getSpans(runId);
      const writeSpan = result?.spans.find(s => s.spanId === spanId);
      expect(writeSpan?.status).toBe('ok');
      expect(writeSpan?.toolName).toBe('Write');
    });
  });

  describe('Tab File Events', () => {
    it('should track tab file reads with tabReadStart', () => {
      const runId = 'tab-read-test-1';
      const t0 = Date.now();
      createSession(runId);

      store.processEvent({
        eventKind: 'tabReadStart',
        timestamp: t0,
        runId,
        spanId: 'tab-read-1',
        toolInput: { file_path: '/test/file.ts' },
      });

      store.processEvent({
        eventKind: 'toolEnd',
        timestamp: t0 + 20,
        runId,
        spanId: 'tab-read-1',
        duration: 20,
      });

      const result = store.getSpans(runId);
      const span = result?.spans.find(s => s.spanId === 'tab-read-1');
      expect(span?.toolName).toBe('TabRead');
      expect(span?.status).toBe('ok');
    });

    it('should track tab file edits with tabEditEnd', () => {
      const runId = 'tab-edit-test-1';
      const t0 = Date.now();
      createSession(runId);

      // Tab edit typically starts via toolStart
      store.processEvent({
        eventKind: 'toolStart',
        timestamp: t0,
        runId,
        spanId: 'tab-edit-1',
        toolName: 'TabEdit',
        toolInput: { file_path: '/test/file.ts' },
      });

      store.processEvent({
        eventKind: 'tabEditEnd',
        timestamp: t0 + 30,
        runId,
        spanId: 'tab-edit-1',
        duration: 30,
      });

      const result = store.getSpans(runId);
      const span = result?.spans.find(s => s.spanId === 'tab-edit-1');
      expect(span?.toolName).toBe('TabEdit');
      expect(span?.status).toBe('ok');
    });
  });

  describe('Subagent (Task) Events', () => {
    it('should track subagent lifecycle with subagentStart/subagentStop', () => {
      const runId = 'subagent-test-1';
      const t0 = Date.now();
      createSession(runId);

      // Parent spawns a Task
      store.processEvent({
        eventKind: 'toolStart',
        timestamp: t0 + 100,
        runId,
        spanId: 'task-span-1',
        toolName: 'Task',
        toolInput: { prompt: 'Search for X', subagent_type: 'explore' },
      });

      // Subagent starts
      const subagentId = 'subagent-explore-1';
      store.processEvent({
        eventKind: 'subagentStart',
        timestamp: t0 + 150,
        runId,
        agentId: subagentId,
        agentType: 'explore',
        model: 'claude-3.5-sonnet',
        parentSpanId: 'task-span-1',
      });

      // Verify subagent was created
      let details = store.getRunDetails(runId);
      expect(details?.agents).toHaveLength(2); // Main + subagent
      const subagent = details?.agents.find(a => a.agentId === subagentId);
      expect(subagent?.agentType).toBe('explore');
      expect(subagent?.endedAt).toBeUndefined();

      // Subagent does work (Read tool)
      store.processEvent({
        eventKind: 'toolStart',
        timestamp: t0 + 200,
        runId,
        spanId: 'subagent-read-1',
        toolName: 'Read',
        toolInput: { file_path: '/test/file.ts' },
        agentId: subagentId,
      });

      store.processEvent({
        eventKind: 'toolEnd',
        timestamp: t0 + 250,
        runId,
        spanId: 'subagent-read-1',
        duration: 50,
      });

      // Subagent stops
      store.processEvent({
        eventKind: 'subagentStop',
        timestamp: t0 + 500,
        runId,
        agentId: subagentId,
        status: 'completed',
      });

      // Verify subagent ended and Task span closed
      details = store.getRunDetails(runId);
      const endedSubagent = details?.agents.find(a => a.agentId === subagentId);
      expect(endedSubagent?.endedAt).toBeDefined();

      const result = store.getSpans(runId);
      const taskSpan = result?.spans.find(s => s.spanId === 'task-span-1');
      expect(taskSpan?.status).toBe('ok');
    });

    it('should handle multiple subagents sequentially', () => {
      const runId = 'subagent-test-2';
      const t0 = Date.now();
      createSession(runId);

      const subagentTypes = ['explore', 'generalPurpose', 'shell'];

      for (let i = 0; i < subagentTypes.length; i++) {
        const offset = i * 1000;
        const subagentId = `subagent-${i}`;
        const taskSpanId = `task-span-${i}`;

        // Task start
        store.processEvent({
          eventKind: 'toolStart',
          timestamp: t0 + offset,
          runId,
          spanId: taskSpanId,
          toolName: 'Task',
          toolInput: { prompt: `Task ${i}`, subagent_type: subagentTypes[i] },
        });

        // Subagent start
        store.processEvent({
          eventKind: 'subagentStart',
          timestamp: t0 + offset + 50,
          runId,
          agentId: subagentId,
          agentType: subagentTypes[i],
          parentSpanId: taskSpanId,
        });

        // Subagent does work
        store.processEvent({
          eventKind: 'toolStart',
          timestamp: t0 + offset + 100,
          runId,
          spanId: `work-span-${i}`,
          toolName: 'Read',
          agentId: subagentId,
        });

        store.processEvent({
          eventKind: 'toolEnd',
          timestamp: t0 + offset + 200,
          runId,
          spanId: `work-span-${i}`,
          duration: 100,
        });

        // Subagent stop
        store.processEvent({
          eventKind: 'subagentStop',
          timestamp: t0 + offset + 500,
          runId,
          agentId: subagentId,
          status: 'completed',
        });
      }

      const details = store.getRunDetails(runId);
      expect(details?.agents).toHaveLength(4); // Main + 3 subagents
      expect(details?.agents.filter(a => a.endedAt).length).toBe(3); // All subagents ended

      const result = store.getSpans(runId);
      const taskSpans = result?.spans.filter(s => s.toolName === 'Task') || [];
      expect(taskSpans).toHaveLength(3);
      expect(taskSpans.every(s => s.status === 'ok')).toBe(true);
    });

    it('should attribute tool calls to active subagent', () => {
      const runId = 'subagent-test-3';
      const t0 = Date.now();
      createSession(runId);

      const subagentId = 'subagent-1';

      // Start subagent
      store.processEvent({
        eventKind: 'toolStart',
        timestamp: t0,
        runId,
        spanId: 'task-span',
        toolName: 'Task',
      });

      store.processEvent({
        eventKind: 'subagentStart',
        timestamp: t0 + 50,
        runId,
        agentId: subagentId,
        agentType: 'explore',
      });

      // Tool call without explicit agentId should be attributed to active subagent
      store.processEvent({
        eventKind: 'toolStart',
        timestamp: t0 + 100,
        runId,
        spanId: 'grep-span',
        toolName: 'Grep',
        toolInput: { pattern: 'foo' },
        // No agentId specified
      });

      store.processEvent({
        eventKind: 'toolEnd',
        timestamp: t0 + 150,
        runId,
        spanId: 'grep-span',
        duration: 50,
      });

      const result = store.getSpans(runId);
      const grepSpan = result?.spans.find(s => s.spanId === 'grep-span');
      expect(grepSpan?.agentId).toBe(subagentId);
    });

    it('should always attribute Task spans to parent agent', () => {
      const runId = 'subagent-test-4';
      const t0 = Date.now();
      createSession(runId);

      // Start first subagent
      store.processEvent({
        eventKind: 'subagentStart',
        timestamp: t0,
        runId,
        agentId: 'subagent-1',
        agentType: 'explore',
      });

      // Parent issues another Task while subagent is active
      store.processEvent({
        eventKind: 'toolStart',
        timestamp: t0 + 100,
        runId,
        spanId: 'second-task',
        toolName: 'Task',
        toolInput: { prompt: 'Another task' },
      });

      const result = store.getSpans(runId);
      const taskSpan = result?.spans.find(s => s.spanId === 'second-task');
      // Task span should be attributed to parent (runId), not the active subagent
      expect(taskSpan?.agentId).toBe(runId);
    });
  });

  describe('Thinking Events', () => {
    it('should create thinking span from thinkingEnd with duration', () => {
      const runId = 'thinking-test-1';
      const t0 = Date.now();
      createSession(runId);

      // thinkingEnd comes with duration and text
      store.processEvent({
        eventKind: 'thinkingEnd',
        timestamp: t0 + 5000,
        runId,
        thinkingDurationMs: 3000,
        thinkingText: 'Let me analyze this problem step by step...',
      });

      const result = store.getSpans(runId);
      const thinkingSpan = result?.spans.find(s => s.toolName === 'Thinking');
      expect(thinkingSpan).toBeDefined();
      expect(thinkingSpan?.status).toBe('ok');
      expect(thinkingSpan?.durationMs).toBe(3000);
      expect(thinkingSpan?.outputPreview).toContain('Let me analyze');
    });

    it('should handle thinking start/end pair', () => {
      const runId = 'thinking-test-2';
      const t0 = Date.now();
      createSession(runId);

      store.processEvent({
        eventKind: 'thinkingStart',
        timestamp: t0,
        runId,
        spanId: 'thinking-1',
      });

      store.processEvent({
        eventKind: 'thinkingEnd',
        timestamp: t0 + 2000,
        runId,
        spanId: 'thinking-1',
        thinkingDurationMs: 2000,
        thinkingText: 'I need to consider...',
      });

      const result = store.getSpans(runId);
      const thinkingSpans = result?.spans.filter(s => s.toolName === 'Thinking') || [];
      expect(thinkingSpans).toHaveLength(1);
      expect(thinkingSpans[0].status).toBe('ok');
    });
  });

  describe('Context Compaction Events', () => {
    it('should track context compaction events', () => {
      const runId = 'compact-test-1';
      const t0 = Date.now();
      createSession(runId);

      store.processEvent({
        eventKind: 'contextCompact',
        timestamp: t0 + 10000,
        runId,
        contextUsagePercent: 85,
        contextTokens: 120000,
        messagesToCompact: 30,
      });

      const result = store.getSpans(runId);
      const compactSpan = result?.spans.find(s => s.toolName === 'ContextCompact');
      expect(compactSpan).toBeDefined();
      expect(compactSpan?.status).toBe('ok');
      expect(compactSpan?.inputPreview).toContain('85%');
      expect(compactSpan?.inputPreview).toContain('120000 tokens');
      expect(compactSpan?.inputPreview).toContain('30 messages');
    });
  });

  describe('Initial Prompt Capture', () => {
    it('should capture initial prompt from beforeSubmitPrompt', () => {
      const runId = 'prompt-test-1';
      createSession(runId);

      store.processEvent({
        eventKind: 'beforeSubmitPrompt',
        timestamp: Date.now(),
        runId,
        prompt: 'Help me refactor the login module',
        attachments: [
          { type: 'file', filePath: '/project/src/login.ts' },
          { type: 'rule', filePath: '/project/.cursor/rules/typescript.md' },
        ],
      });

      const summary = store.getRunSummary(runId);
      expect(summary?.initialPrompt).toBe('Help me refactor the login module');
    });
  });

  describe('Tool Failures', () => {
    it('should track permission denied failures', () => {
      const runId = 'failure-test-1';
      createSession(runId);

      store.processEvent({
        eventKind: 'toolStart',
        timestamp: Date.now(),
        runId,
        spanId: 'read-span-1',
        toolName: 'Read',
        toolInput: { file_path: '/etc/passwd' },
      });

      store.processEvent({
        eventKind: 'toolFailure',
        timestamp: Date.now() + 50,
        runId,
        spanId: 'read-span-1',
        failureType: 'permission_denied',
        errorMessage: 'Access denied to system file',
      });

      const result = store.getSpans(runId);
      const span = result?.spans.find(s => s.spanId === 'read-span-1');
      expect(span?.status).toBe('permission_denied');
      expect(span?.errorMessage).toContain('Access denied');
    });

    it('should track timeout failures', () => {
      const runId = 'failure-test-2';
      createSession(runId);

      store.processEvent({
        eventKind: 'toolStart',
        timestamp: Date.now(),
        runId,
        spanId: 'shell-span-1',
        toolName: 'Shell',
        toolInput: { command: 'sleep 1000' },
      });

      store.processEvent({
        eventKind: 'toolFailure',
        timestamp: Date.now() + 30000,
        runId,
        spanId: 'shell-span-1',
        failureType: 'timeout',
        errorMessage: 'Command timed out after 30s',
      });

      const result = store.getSpans(runId);
      const span = result?.spans.find(s => s.spanId === 'shell-span-1');
      expect(span?.status).toBe('timeout');
    });
  });

  describe('Realistic Session Scenarios', () => {
    it('should handle a typical code review session', () => {
      const runId = 'session-code-review';
      const t0 = Date.now();
      createSession(runId);

      // User submits prompt
      store.processEvent({
        eventKind: 'beforeSubmitPrompt',
        timestamp: t0,
        runId,
        prompt: 'Review the auth module for security issues',
      });

      // Agent reads files
      const files = ['auth.ts', 'middleware.ts', 'config.ts'];
      for (let i = 0; i < files.length; i++) {
        store.processEvent({
          eventKind: 'toolStart',
          timestamp: t0 + 100 + i * 200,
          runId,
          spanId: `read-${i}`,
          toolName: 'Read',
          toolInput: { file_path: `/src/${files[i]}` },
        });

        store.processEvent({
          eventKind: 'toolEnd',
          timestamp: t0 + 200 + i * 200,
          runId,
          spanId: `read-${i}`,
          duration: 100,
        });
      }

      // Agent spawns explore subagent
      store.processEvent({
        eventKind: 'toolStart',
        timestamp: t0 + 1000,
        runId,
        spanId: 'task-explore',
        toolName: 'Task',
        toolInput: { prompt: 'Find all authentication patterns' },
      });

      store.processEvent({
        eventKind: 'subagentStart',
        timestamp: t0 + 1050,
        runId,
        agentId: 'explore-agent',
        agentType: 'explore',
      });

      // Subagent does grep
      store.processEvent({
        eventKind: 'toolStart',
        timestamp: t0 + 1100,
        runId,
        spanId: 'grep-1',
        toolName: 'Grep',
        toolInput: { pattern: 'authenticate' },
        agentId: 'explore-agent',
      });

      store.processEvent({
        eventKind: 'toolEnd',
        timestamp: t0 + 1200,
        runId,
        spanId: 'grep-1',
        duration: 100,
      });

      // Subagent ends
      store.processEvent({
        eventKind: 'subagentStop',
        timestamp: t0 + 1500,
        runId,
        agentId: 'explore-agent',
        status: 'completed',
      });

      // Session ends
      endSession(runId);

      // Verify final state
      const details = store.getRunDetails(runId);
      expect(details?.status).toBe('completed');
      expect(details?.agents).toHaveLength(2);
      expect(details?.spanCount).toBeGreaterThanOrEqual(5);

      const result = store.getSpans(runId);
      expect(result?.spans.every(s => s.status !== 'running')).toBe(true);
    });

    it('should handle a session with shell commands and edits', () => {
      const runId = 'session-shell-edit';
      const t0 = Date.now();
      createSession(runId);

      // Shell: npm install
      store.processEvent({
        eventKind: 'shellStart',
        timestamp: t0,
        runId,
        spanId: 'shell-1',
        toolName: 'Shell',
        toolInput: { command: 'npm install lodash' },
      });

      store.processEvent({
        eventKind: 'shellEnd',
        timestamp: t0 + 3000,
        runId,
        spanId: 'shell-1',
        toolOutput: 'added 1 package',
        duration: 3000,
      });

      // Edit package.json
      store.processEvent({
        eventKind: 'toolStart',
        timestamp: t0 + 3500,
        runId,
        spanId: 'edit-1',
        toolName: 'Edit',
        toolInput: { file_path: '/package.json', old_string: '"lodash": "^4.17.20"', new_string: '"lodash": "^4.17.21"' },
      });

      store.processEvent({
        eventKind: 'fileEditEnd',
        timestamp: t0 + 3550,
        runId,
        spanId: 'edit-1',
        duration: 50,
      });

      // Shell: npm test
      store.processEvent({
        eventKind: 'shellStart',
        timestamp: t0 + 4000,
        runId,
        spanId: 'shell-2',
        toolName: 'Shell',
        toolInput: { command: 'npm test' },
      });

      store.processEvent({
        eventKind: 'shellEnd',
        timestamp: t0 + 9000,
        runId,
        spanId: 'shell-2',
        toolOutput: 'All 42 tests passed',
        duration: 5000,
      });

      endSession(runId);

      const result = store.getSpans(runId);
      expect(result?.spans).toHaveLength(3);

      const shellSpans = result?.spans.filter(s => s.toolName === 'Shell') || [];
      const editSpans = result?.spans.filter(s => s.toolName === 'Edit') || [];

      expect(shellSpans).toHaveLength(2);
      expect(editSpans).toHaveLength(1);
    });
  });

  describe('Session End Cleanup', () => {
    it('should force-close all running spans on session end', () => {
      const runId = 'cleanup-test-1';
      const t0 = Date.now();
      createSession(runId);

      // Start several spans but don't end them
      for (let i = 0; i < 3; i++) {
        store.processEvent({
          eventKind: 'toolStart',
          timestamp: t0 + i * 100,
          runId,
          spanId: `orphan-${i}`,
          toolName: ['Read', 'Grep', 'Shell'][i],
        });
      }

      // Verify spans are running
      let result = store.getSpans(runId);
      expect(result?.spans.filter(s => s.status === 'running')).toHaveLength(3);

      // End session
      endSession(runId);

      // All spans should be closed
      result = store.getSpans(runId);
      expect(result?.spans.filter(s => s.status === 'running')).toHaveLength(0);
      expect(result?.spans.every(s => s.endedAt !== undefined)).toBe(true);
    });

    it('should close subagent spans when subagent stops', () => {
      const runId = 'cleanup-test-2';
      const t0 = Date.now();
      createSession(runId);

      // Start subagent
      store.processEvent({
        eventKind: 'subagentStart',
        timestamp: t0,
        runId,
        agentId: 'subagent-1',
        agentType: 'explore',
      });

      // Start some spans for the subagent
      store.processEvent({
        eventKind: 'toolStart',
        timestamp: t0 + 100,
        runId,
        spanId: 'subagent-span-1',
        toolName: 'Read',
        agentId: 'subagent-1',
      });

      store.processEvent({
        eventKind: 'toolStart',
        timestamp: t0 + 200,
        runId,
        spanId: 'subagent-span-2',
        toolName: 'Grep',
        agentId: 'subagent-1',
      });

      // Stop subagent without ending individual spans
      store.processEvent({
        eventKind: 'subagentStop',
        timestamp: t0 + 500,
        runId,
        agentId: 'subagent-1',
        status: 'completed',
      });

      // Subagent spans should be closed
      const result = store.getSpans(runId);
      const subagentSpans = result?.spans.filter(s => s.agentId === 'subagent-1') || [];
      expect(subagentSpans.every(s => s.status === 'ok')).toBe(true);
      expect(subagentSpans.every(s => s.endedAt !== undefined)).toBe(true);
    });
  });

  describe('Broadcast Updates', () => {
    it('should broadcast correct update types for all events', () => {
      const runId = 'broadcast-test-1';
      updates = []; // Clear updates

      createSession(runId);

      store.processEvent({
        eventKind: 'toolStart',
        timestamp: Date.now(),
        runId,
        spanId: 'span-1',
        toolName: 'Read',
      });

      store.processEvent({
        eventKind: 'toolEnd',
        timestamp: Date.now() + 100,
        runId,
        spanId: 'span-1',
        duration: 100,
      });

      store.processEvent({
        eventKind: 'subagentStart',
        timestamp: Date.now() + 200,
        runId,
        agentId: 'subagent-1',
        agentType: 'explore',
      });

      store.processEvent({
        eventKind: 'subagentStop',
        timestamp: Date.now() + 300,
        runId,
        agentId: 'subagent-1',
      });

      endSession(runId);

      const updateTypes = updates.map(u => u.type);
      expect(updateTypes).toContain('runStart');
      expect(updateTypes).toContain('agentStart');
      expect(updateTypes).toContain('spanStart');
      expect(updateTypes).toContain('spanEnd');
      expect(updateTypes).toContain('agentEnd');
      expect(updateTypes).toContain('runEnd');
    });
  });
});
