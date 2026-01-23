/**
 * Tests for TraceStore
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TraceStore } from './trace-store.js';
import { TelemetryEvent, TraceUpdate } from './types.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('TraceStore', () => {
  let store: TraceStore;
  let tempDir: string;
  let updates: TraceUpdate[];

  beforeEach(() => {
    // Create temp directory for traces
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-test-'));
    store = new TraceStore(tempDir);
    updates = [];
    store.setUpdateCallback((update) => {
      updates.push(update);
    });
  });

  afterEach(() => {
    // Clean up temp dir
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('Session lifecycle', () => {
    it('should create a run on sessionStart', () => {
      const event: TelemetryEvent = {
        eventKind: 'sessionStart',
        timestamp: Date.now(),
        runId: 'run-123',
        source: 'cursor',
        projectRoot: '/test/project',
      };

      store.processEvent(event);

      const runs = store.getRecentRuns();
      expect(runs).toHaveLength(1);
      expect(runs[0].runId).toBe('run-123');
      expect(runs[0].status).toBe('running');
      expect(runs[0].source).toBe('cursor');
    });

    it('should end a run on sessionEnd', () => {
      // Start
      store.processEvent({
        eventKind: 'sessionStart',
        timestamp: Date.now(),
        runId: 'run-123',
        source: 'cursor',
      });

      // End
      store.processEvent({
        eventKind: 'sessionEnd',
        timestamp: Date.now() + 1000,
        runId: 'run-123',
        status: 'completed',
      });

      const runs = store.getRecentRuns();
      expect(runs[0].status).toBe('completed');
      expect(runs[0].endedAt).toBeDefined();
    });

    it('should broadcast runStart and runEnd updates', () => {
      store.processEvent({
        eventKind: 'sessionStart',
        timestamp: Date.now(),
        runId: 'run-123',
        source: 'cursor',
      });

      store.processEvent({
        eventKind: 'sessionEnd',
        timestamp: Date.now() + 1000,
        runId: 'run-123',
        status: 'completed',
      });

      expect(updates.some(u => u.type === 'runStart')).toBe(true);
      expect(updates.some(u => u.type === 'runEnd')).toBe(true);
    });

    it('should force-close any running spans when the run ends', () => {
      const t0 = Date.now();

      store.processEvent({
        eventKind: 'sessionStart',
        timestamp: t0,
        runId: 'run-123',
        source: 'cursor',
      });

      store.processEvent({
        eventKind: 'toolStart',
        timestamp: t0 + 10,
        runId: 'run-123',
        spanId: 'span-1',
        toolName: 'Read',
      });

      store.processEvent({
        eventKind: 'sessionEnd',
        timestamp: t0 + 1000,
        runId: 'run-123',
        status: 'completed',
      });

      const spans = store.getSpans('run-123')?.spans || [];
      const span = spans.find(s => s.spanId === 'span-1');
      expect(span?.status).toBe('ok');
      expect(span?.endedAt).toBeDefined();
      expect(span?.durationMs).toBeGreaterThan(0);

      // Should also broadcast a spanEnd update for the forced-closed span
      expect(updates.some(u => u.type === 'spanEnd' && u.span?.spanId === 'span-1')).toBe(true);
    });
  });

  describe('Span tracking', () => {
    beforeEach(() => {
      // Create a run first
      store.processEvent({
        eventKind: 'sessionStart',
        timestamp: Date.now(),
        runId: 'run-123',
        source: 'cursor',
      });
    });

    it('should create a span on toolStart', () => {
      store.processEvent({
        eventKind: 'toolStart',
        timestamp: Date.now(),
        runId: 'run-123',
        spanId: 'span-1',
        toolName: 'Read',
        toolInput: { file_path: '/test/file.ts' },
      });

      const result = store.getSpans('run-123');
      expect(result?.spans).toHaveLength(1);
      expect(result?.spans[0].toolName).toBe('Read');
      expect(result?.spans[0].status).toBe('running');
    });

    it('should complete a span on toolEnd', () => {
      const startTime = Date.now();
      
      store.processEvent({
        eventKind: 'toolStart',
        timestamp: startTime,
        runId: 'run-123',
        spanId: 'span-1',
        toolName: 'Read',
      });

      store.processEvent({
        eventKind: 'toolEnd',
        timestamp: startTime + 100,
        runId: 'run-123',
        spanId: 'span-1',
        duration: 100,
      });

      const result = store.getSpans('run-123');
      expect(result?.spans[0].status).toBe('ok');
      expect(result?.spans[0].durationMs).toBe(100);
    });

    it('should mark span as error on toolFailure', () => {
      store.processEvent({
        eventKind: 'toolStart',
        timestamp: Date.now(),
        runId: 'run-123',
        spanId: 'span-1',
        toolName: 'Read',
      });

      store.processEvent({
        eventKind: 'toolFailure',
        timestamp: Date.now() + 100,
        runId: 'run-123',
        spanId: 'span-1',
        failureType: 'permission_denied',
        errorMessage: 'Access denied',
      });

      const result = store.getSpans('run-123');
      expect(result?.spans[0].status).toBe('permission_denied');
      expect(result?.spans[0].errorMessage).toBe('Access denied');
    });

    it('should correlate spans by spanId', () => {
      store.processEvent({
        eventKind: 'toolStart',
        timestamp: Date.now(),
        runId: 'run-123',
        spanId: 'unique-span-id',
        toolName: 'Write',
      });

      store.processEvent({
        eventKind: 'toolStart',
        timestamp: Date.now(),
        runId: 'run-123',
        spanId: 'another-span-id',
        toolName: 'Read',
      });

      // End the first span
      store.processEvent({
        eventKind: 'toolEnd',
        timestamp: Date.now() + 50,
        runId: 'run-123',
        spanId: 'unique-span-id',
      });

      const result = store.getSpans('run-123');
      const writeSpan = result?.spans.find(s => s.toolName === 'Write');
      const readSpan = result?.spans.find(s => s.toolName === 'Read');

      expect(writeSpan?.status).toBe('ok');
      expect(readSpan?.status).toBe('running');
    });

    it('should normalize spanId/runId so toolEnd can close spans with newline separators', () => {
      const t0 = Date.now();

      // Start a run whose id contains a newline separator
      store.processEvent({
        eventKind: 'sessionStart',
        timestamp: t0,
        runId: 'run-123\nfc_abc',
        source: 'cursor',
      });

      store.processEvent({
        eventKind: 'toolStart',
        timestamp: t0 + 10,
        runId: 'run-123\nfc_abc',
        spanId: 'call_foo\nfc_bar',
        toolName: 'Grep',
      });

      store.processEvent({
        eventKind: 'toolEnd',
        timestamp: t0 + 50,
        runId: 'run-123\nfc_abc',
        spanId: 'call_foo\nfc_bar',
        duration: 40,
      });

      const result = store.getSpans('run-123fc_abc');
      expect(result?.spans).toHaveLength(1);
      expect(result?.spans[0].spanId).toBe('call_foofc_bar');
      expect(result?.spans[0].status).toBe('ok');
    });

    it('should not clobber toolName when the same spanId is updated', () => {
      const t0 = Date.now();

      store.processEvent({
        eventKind: 'toolStart',
        timestamp: t0,
        runId: 'run-123',
        spanId: 'span-1',
        toolName: 'Grep',
        toolInput: { pattern: 'foo' },
      });

      // Simulate a follow-up hook event that reuses spanId but carries a different toolName
      store.processEvent({
        eventKind: 'toolStart',
        timestamp: t0 + 10,
        runId: 'run-123',
        spanId: 'span-1',
        toolName: 'Read',
        toolInput: { file_path: 'some/file.txt' },
      });

      const result = store.getSpans('run-123');
      expect(result?.spans).toHaveLength(1);
      expect(result?.spans[0].toolName).toBe('Grep');
    });

    it('should still complete a span on toolEnd if pendingSpans is missing but activeSpans has it', () => {
      const t0 = Date.now();

      store.processEvent({
        eventKind: 'toolStart',
        timestamp: t0,
        runId: 'run-123',
        spanId: 'span-1',
        toolName: 'Read',
      });

      // Force a pendingSpans desync
      (store as unknown as { pendingSpans: Map<string, unknown> }).pendingSpans.delete('span-1');

      store.processEvent({
        eventKind: 'toolEnd',
        timestamp: t0 + 100,
        runId: 'run-123',
        spanId: 'span-1',
        duration: 100,
      });

      const result = store.getSpans('run-123');
      expect(result?.spans[0].status).toBe('ok');
      expect(result?.spans[0].durationMs).toBe(100);
      expect(result?.spans[0].endedAt).toBeDefined();
    });

    it('should complete the most recent matching running span when toolEnd has no spanId', () => {
      const t0 = Date.now();

      store.processEvent({
        eventKind: 'toolStart',
        timestamp: t0,
        runId: 'run-123',
        spanId: 'span-old',
        toolName: 'Read',
      });

      store.processEvent({
        eventKind: 'toolStart',
        timestamp: t0 + 50,
        runId: 'run-123',
        spanId: 'span-new',
        toolName: 'Read',
      });

      // End without spanId; should close span-new, not span-old
      store.processEvent({
        eventKind: 'toolEnd',
        timestamp: t0 + 120,
        runId: 'run-123',
        toolName: 'Read',
        duration: 70,
      });

      const result = store.getSpans('run-123');
      const oldSpan = result?.spans.find(s => s.spanId === 'span-old');
      const newSpan = result?.spans.find(s => s.spanId === 'span-new');

      expect(newSpan?.status).toBe('ok');
      expect(oldSpan?.status).toBe('running');
    });

    it('should attribute Task tool spans to the parent run even when a subagent is active', () => {
      const t0 = Date.now();

      // Start a run
      store.processEvent({
        eventKind: 'sessionStart',
        timestamp: t0,
        runId: 'run-123',
        source: 'cursor',
      });

      // Start a subagent so it's considered active for attribution
      store.processEvent({
        eventKind: 'subagentStart',
        timestamp: t0 + 10,
        runId: 'run-123',
        agentId: 'subagent-1',
        agentType: 'generalPurpose',
        source: 'cursor',
      });

      // Now a Task toolStart comes in (from the parent) while the subagent is active
      store.processEvent({
        eventKind: 'toolStart',
        timestamp: t0 + 20,
        runId: 'run-123',
        spanId: 'task-span',
        toolName: 'Task',
        source: 'cursor',
      });

      const result = store.getSpans('run-123');
      const taskSpan = result?.spans.find(s => s.spanId === 'task-span');
      expect(taskSpan?.agentId).toBe('run-123');
    });

    it('should broadcast spanStart and spanEnd updates', () => {
      updates = []; // Clear previous updates

      store.processEvent({
        eventKind: 'toolStart',
        timestamp: Date.now(),
        runId: 'run-123',
        spanId: 'span-1',
        toolName: 'Read',
      });

      store.processEvent({
        eventKind: 'toolEnd',
        timestamp: Date.now() + 100,
        runId: 'run-123',
        spanId: 'span-1',
      });

      expect(updates.some(u => u.type === 'spanStart')).toBe(true);
      expect(updates.some(u => u.type === 'spanEnd')).toBe(true);
    });
  });

  describe('Subagent tracking', () => {
    beforeEach(() => {
      store.processEvent({
        eventKind: 'sessionStart',
        timestamp: Date.now(),
        runId: 'run-123',
        source: 'cursor',
      });
    });

    it('should create a subagent on subagentStart', () => {
      store.processEvent({
        eventKind: 'subagentStart',
        timestamp: Date.now(),
        runId: 'run-123',
        agentId: 'subagent-1',
        agentType: 'explore',
        model: 'claude-3.5-sonnet',
      });

      const details = store.getRunDetails('run-123');
      expect(details?.agents).toHaveLength(2); // Main + subagent
      
      const subagent = details?.agents.find(a => a.agentId === 'subagent-1');
      expect(subagent?.agentType).toBe('explore');
      expect(subagent?.displayName).toContain('Explore');
    });

    it('should end a subagent on subagentStop', () => {
      store.processEvent({
        eventKind: 'subagentStart',
        timestamp: Date.now(),
        runId: 'run-123',
        agentId: 'subagent-1',
        agentType: 'explore',
      });

      store.processEvent({
        eventKind: 'subagentStop',
        timestamp: Date.now() + 5000,
        runId: 'run-123',
        agentId: 'subagent-1',
      });

      const details = store.getRunDetails('run-123');
      const subagent = details?.agents.find(a => a.agentId === 'subagent-1');
      expect(subagent?.endedAt).toBeDefined();
    });
  });

  describe('Input sanitization', () => {
    beforeEach(() => {
      store.processEvent({
        eventKind: 'sessionStart',
        timestamp: Date.now(),
        runId: 'run-123',
        source: 'cursor',
      });
    });

    it('should redact API keys in input preview', () => {
      store.processEvent({
        eventKind: 'toolStart',
        timestamp: Date.now(),
        runId: 'run-123',
        spanId: 'span-1',
        toolName: 'Shell',
        toolInput: { command: 'curl -H "api_key: sk-1234567890abcdef"' },
      });

      const result = store.getSpans('run-123');
      expect(result?.spans[0].inputPreview).toContain('[REDACTED]');
      expect(result?.spans[0].inputPreview).not.toContain('sk-1234567890');
    });

    it('should truncate long inputs', () => {
      const longInput = 'x'.repeat(500);
      
      store.processEvent({
        eventKind: 'toolStart',
        timestamp: Date.now(),
        runId: 'run-123',
        spanId: 'span-1',
        toolName: 'Shell',
        toolInput: { command: longInput },
      });

      const result = store.getSpans('run-123');
      expect(result?.spans[0].inputPreview?.length).toBeLessThan(250);
      expect(result?.spans[0].inputPreview?.endsWith('...')).toBe(true);
    });
  });

  describe('JSONL persistence', () => {
    it('should persist runs to disk', () => {
      store.processEvent({
        eventKind: 'sessionStart',
        timestamp: Date.now(),
        runId: 'persist-test',
        source: 'cursor',
      });

      store.processEvent({
        eventKind: 'toolStart',
        timestamp: Date.now(),
        runId: 'persist-test',
        spanId: 'span-1',
        toolName: 'Read',
      });

      const filePath = path.join(tempDir, '.codemap', 'traces', 'persist-test.jsonl');
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBeGreaterThanOrEqual(2);
    });

    it('should load runs from disk on init', () => {
      // Create a run and persist it
      store.processEvent({
        eventKind: 'sessionStart',
        timestamp: Date.now(),
        runId: 'reload-test',
        source: 'cursor',
      });

      // Create new store instance to test loading
      const newStore = new TraceStore(tempDir);
      const runs = newStore.getRecentRuns();
      
      expect(runs.some(r => r.runId === 'reload-test')).toBe(true);
    });
  });

  describe('Query methods', () => {
    beforeEach(() => {
      // Create multiple runs
      for (let i = 0; i < 5; i++) {
        store.processEvent({
          eventKind: 'sessionStart',
          timestamp: Date.now() + i * 1000,
          runId: `run-${i}`,
          source: 'cursor',
        });
      }
    });

    it('should return runs sorted by startedAt descending', () => {
      const runs = store.getRecentRuns();
      expect(runs[0].runId).toBe('run-4');
      expect(runs[4].runId).toBe('run-0');
    });

    it('should respect limit parameter', () => {
      const runs = store.getRecentRuns(2);
      expect(runs).toHaveLength(2);
    });

    it('should return run summary with counts', () => {
      store.processEvent({
        eventKind: 'toolStart',
        timestamp: Date.now(),
        runId: 'run-0',
        spanId: 'span-1',
        toolName: 'Read',
      });

      store.processEvent({
        eventKind: 'toolFailure',
        timestamp: Date.now() + 100,
        runId: 'run-0',
        spanId: 'span-1',
        failureType: 'error',
      });

      const summary = store.getRunSummary('run-0');
      expect(summary?.spanCount).toBe(1);
      expect(summary?.errorCount).toBe(1);
    });
  });
});
