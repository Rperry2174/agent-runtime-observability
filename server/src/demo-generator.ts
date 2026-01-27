/**
 * Demo Generator
 * 
 * Generates a comprehensive, realistic demo scenario showing all hook types.
 * Scenario: "Implement auth middleware" with multiple agents and subagents.
 */

import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { TraceStore } from './trace-store.js';
import { TelemetryEvent } from './types.js';

interface ScheduledEvent {
  delayMs: number;
  event: TelemetryEvent;
}

export class DemoGenerator {
  private traceStore: TraceStore;
  private projectRoot: string;
  private isRunning: boolean = false;
  private currentTimeout: NodeJS.Timeout | null = null;

  constructor(traceStore: TraceStore, projectRoot: string) {
    this.traceStore = traceStore;
    this.projectRoot = projectRoot;
  }

  start(): string {
    if (this.isRunning) {
      console.log('[Demo] Already running');
      return '';
    }

    this.isRunning = true;
    const runId = `demo-${uuidv4().slice(0, 8)}`;
    const transcripts = this.fabricateDemoTranscripts(runId);
    const events = this.generateComprehensiveScenario(runId, transcripts);
    
    console.log(`[Demo] Starting comprehensive run ${runId} with ${events.length} events over ${Math.round(events[events.length - 1].delayMs / 1000)}s`);
    
    this.scheduleEvents(events);
    
    return runId;
  }

  stop(): void {
    if (this.currentTimeout) {
      clearTimeout(this.currentTimeout);
      this.currentTimeout = null;
    }
    this.isRunning = false;
  }

  private scheduleEvents(events: ScheduledEvent[]): void {
    let index = 0;
    
    const processNext = () => {
      if (index >= events.length || !this.isRunning) {
        this.isRunning = false;
        console.log('[Demo] Completed');
        return;
      }
      
      const { delayMs, event } = events[index];
      const nextDelay = index + 1 < events.length 
        ? events[index + 1].delayMs - delayMs 
        : 0;
      
      this.traceStore.processEvent(event);
      
      index++;
      
      if (nextDelay > 0 && index < events.length) {
        this.currentTimeout = setTimeout(processNext, nextDelay);
      } else {
        processNext();
      }
    };
    
    const firstDelay = events[0]?.delayMs || 0;
    this.currentTimeout = setTimeout(processNext, firstDelay);
  }

  /**
   * Generate a comprehensive demo scenario: "Implement auth middleware"
   * 
   * Timeline (~100s compressed to ~25s real-time):
   * - Lead agent thinks, analyzes requirements
   * - Spawns Explore subagent to search codebase
   * - Spawns generalPurpose subagent for implementation
   * - Spawns Shell subagent to run tests
   * - Shows thinking, MCP calls, errors
   */
  private generateComprehensiveScenario(
    runId: string,
    transcripts: {
      runTranscriptPath: string;
      transcriptsDir: string;
    }
  ): ScheduledEvent[] {
    const events: ScheduledEvent[] = [];
    const now = Date.now();
    
    // Time compression: 100s scenario in ~25s real-time (4x speed)
    const SPEED = 4;
    const t = (seconds: number) => Math.round((seconds * 1000) / SPEED);
    
    // Agent IDs - using actual subagent type names
    const leadAgentId = runId;
    const exploreAgentId = `explore-${uuidv4().slice(0, 8)}`;
    const implAgentId = `impl-${uuidv4().slice(0, 8)}`;
    const shellAgentId = `shell-${uuidv4().slice(0, 8)}`;
    const reviewerId = `review-${uuidv4().slice(0, 8)}`;

    // Fabricated per-agent transcripts for demo viewing
    const agentTranscriptPaths: Record<string, string> = {
      // Use the overall conversation transcript for the main agent
      [leadAgentId]: transcripts.runTranscriptPath,
    };
    const writeAgentTranscript = (agentId: string, title: string, contentLines: string[]) => {
      const filename = `agent-${agentId}.md`;
      const p = path.join(transcripts.transcriptsDir, filename);
      fs.writeFileSync(
        p,
        [
          `# ${title}`,
          '',
          ...contentLines,
          '',
          '---',
          '',
          '_This is a fabricated transcript for demo purposes._',
        ].join('\n'),
        'utf-8'
      );
      agentTranscriptPaths[agentId] = p;
      return p;
    };

    writeAgentTranscript(exploreAgentId, 'Explore Subagent Transcript', [
      '**System:** Task: Codebase exploration',
      '',
      '**Assistant:** I’ll find auth/JWT usage and report back relevant files and patterns.',
      '',
      '- Searched for `jwt|bearer|token` in `src/`',
      '- Searched for `authenticate|authorize` in `src/`',
      '- Read `src/utils/jwt.ts` and `src/config/auth.ts`',
      '',
      '**Assistant:** Summary: Codebase uses `jsonwebtoken`; auth config lives in `src/config/auth.ts`.',
    ]);

    writeAgentTranscript(implAgentId, 'Implementation Subagent Transcript', [
      '**System:** Task: Auth implementation',
      '',
      '**Assistant:** I’ll implement JWT validation middleware and export it from `src/middleware/index.ts`.',
      '',
      '- Read types in `src/types/express.d.ts`',
      '- Wrote `src/middleware/auth.ts`',
      '- Updated exports in `src/middleware/index.ts`',
      '- Looked up jsonwebtoken best practices (Context7)',
      '',
      '**Assistant:** Done. Middleware validates Bearer token, returns 401 on invalid token, attaches user to request.',
    ]);

    writeAgentTranscript(shellAgentId, 'Shell Subagent Transcript', [
      '**System:** Task: Test runner',
      '',
      '**Assistant:** Running typecheck and auth-related tests.',
      '',
      '1) `npx tsc --noEmit` → OK',
      '2) `npm test -- --grep "auth"` → FAIL (missing `JWT_SECRET`)',
      '3) `JWT_SECRET=test npm test -- --grep "auth"` → PASS',
      '',
      '**Assistant:** Tests now pass with `JWT_SECRET` configured for test env.',
    ]);

    writeAgentTranscript(reviewerId, 'Reviewer Transcript', [
      '**System:** Reviewing auth middleware for security.',
      '',
      '**Assistant:** Checked secret handling, error paths, and token verification.',
      '',
      '- Read `src/middleware/auth.ts`',
      '- Grep for `process.env` usage in `src/`',
      '- Attempted security scan (permission denied)',
      '- Left approval review on PR',
      '',
      '**Assistant:** LGTM. Ensure `JWT_SECRET` is required in all environments.',
    ]);
    
    // Span ID helper
    const span = () => uuidv4().slice(0, 12);
    
    // Helper to add events
    const add = (seconds: number, event: Partial<TelemetryEvent>) => {
      events.push({
        delayMs: t(seconds),
        event: {
          timestamp: now + t(seconds),
          runId,
          source: 'demo',
          ...event,
        } as TelemetryEvent,
      });
    };
    
    // ========================================================================
    // Session Start (0s)
    // ========================================================================
    add(0, {
      eventKind: 'sessionStart',
      agentId: leadAgentId,
      model: 'claude-sonnet-4',
      projectRoot: '/demo/api-service',
      // Main lane should represent the initial prompt that kicked off the run
      toolInput: { displayName: 'Implement auth middleware' },
      transcriptPath: transcripts.runTranscriptPath,
    });
    
    // ========================================================================
    // Lead Agent: Initial thinking (0-3s)
    // ========================================================================
    add(0.5, {
      eventKind: 'thinkingStart',
      agentId: leadAgentId,
      spanId: span(),
    });
    
    add(3, {
      eventKind: 'thinkingEnd',
      agentId: leadAgentId,
      thinkingDurationMs: 2500,
      thinkingText: 'I need to implement JWT authentication middleware. Let me first explore the existing codebase to understand the current auth patterns...',
    });
    
    // ========================================================================
    // Lead Agent: Initial Analysis (3-8s)
    // ========================================================================
    
    // Grep for existing auth code
    const grepAuth = span();
    add(3.5, {
      eventKind: 'toolStart',
      agentId: leadAgentId,
      spanId: grepAuth,
      toolName: 'Grep',
      toolInput: { pattern: 'middleware.*auth', path: 'src/' },
      hookEventName: 'preToolUse',
    });
    add(5, {
      eventKind: 'toolEnd',
      agentId: leadAgentId,
      spanId: grepAuth,
      duration: 1500,
      toolOutput: 'Found 3 matches in src/middleware/',
    });
    
    // Read the main file
    const readMain = span();
    add(5.5, {
      eventKind: 'toolStart',
      agentId: leadAgentId,
      spanId: readMain,
      toolName: 'Read',
      toolInput: { file_path: 'src/middleware/index.ts' },
    });
    add(6.5, {
      eventKind: 'toolEnd',
      agentId: leadAgentId,
      spanId: readMain,
      duration: 1000,
    });
    
    // ========================================================================
    // Lead spawns Explore subagent (7-25s)
    // ========================================================================
    
    const taskExplore = span();
    add(7, {
      eventKind: 'toolStart',
      agentId: leadAgentId,
      spanId: taskExplore,
      toolName: 'Task',
      toolInput: { 
        subagent_type: 'explore',
        prompt: 'Find all authentication-related code patterns',
        description: 'Codebase exploration'
      },
    });
    
    add(7.5, {
      eventKind: 'subagentStart',
      agentId: exploreAgentId,
      parentAgentId: leadAgentId,
      agentType: 'explore',
      model: 'claude-3.5-haiku',
      toolInput: { displayName: 'Explore' },
      agentTranscriptPath: agentTranscriptPaths[exploreAgentId],
    });
    
    // Explore agent: Sequential searches
    const exploreGrep1 = span();
    add(8, {
      eventKind: 'toolStart',
      agentId: exploreAgentId,
      spanId: exploreGrep1,
      parentSpanId: taskExplore,
      toolName: 'Grep',
      toolInput: { pattern: 'jwt|bearer|token', path: 'src/' },
    });
    
    const exploreGrep2 = span();
    add(9.6, {
      eventKind: 'toolStart',
      agentId: exploreAgentId,
      spanId: exploreGrep2,
      parentSpanId: taskExplore,
      toolName: 'Grep',
      toolInput: { pattern: 'authenticate|authorize', path: 'src/' },
    });
    
    add(9.5, {
      eventKind: 'toolEnd',
      agentId: exploreAgentId,
      spanId: exploreGrep1,
      duration: 1500,
    });
    add(11.1, {
      eventKind: 'toolEnd',
      agentId: exploreAgentId,
      spanId: exploreGrep2,
      duration: 1500,
    });
    
    // Explore: Read found files
    const exploreRead1 = span();
    add(11.4, {
      eventKind: 'toolStart',
      agentId: exploreAgentId,
      spanId: exploreRead1,
      parentSpanId: taskExplore,
      toolName: 'Read',
      toolInput: { file_path: 'src/utils/jwt.ts' },
    });
    add(12.4, {
      eventKind: 'toolEnd',
      agentId: exploreAgentId,
      spanId: exploreRead1,
      duration: 1000,
    });
    
    const exploreRead2 = span();
    add(12.7, {
      eventKind: 'toolStart',
      agentId: exploreAgentId,
      spanId: exploreRead2,
      parentSpanId: taskExplore,
      toolName: 'Read',
      toolInput: { file_path: 'src/config/auth.ts' },
    });
    add(13.7, {
      eventKind: 'toolEnd',
      agentId: exploreAgentId,
      spanId: exploreRead2,
      duration: 1000,
    });
    
    // Explore completes
    add(14.2, {
      eventKind: 'subagentStop',
      agentId: exploreAgentId,
      status: 'completed',
      agentTranscriptPath: agentTranscriptPaths[exploreAgentId],
    });
    
    add(14.2, {
      eventKind: 'toolEnd',
      agentId: leadAgentId,
      spanId: taskExplore,
      duration: 7200,
    });
    
    // ========================================================================
    // Lead: Thinking after exploration (14.5-16s)
    // ========================================================================
    add(14.5, {
      eventKind: 'thinkingStart',
      agentId: leadAgentId,
      spanId: span(),
    });
    
    add(16, {
      eventKind: 'thinkingEnd',
      agentId: leadAgentId,
      thinkingDurationMs: 1500,
      thinkingText: 'The codebase uses jsonwebtoken. I should create a middleware that validates tokens and extracts user info...',
    });
    
    // ========================================================================
    // Lead spawns Implementation subagent (16-40s)
    // ========================================================================
    
    const taskImpl = span();
    add(16.5, {
      eventKind: 'toolStart',
      agentId: leadAgentId,
      spanId: taskImpl,
      toolName: 'Task',
      toolInput: { 
        subagent_type: 'generalPurpose',
        prompt: 'Implement JWT validation middleware in src/middleware/auth.ts',
        description: 'Auth implementation'
      },
    });
    
    add(16.5, {
      eventKind: 'subagentStart',
      agentId: implAgentId,
      parentAgentId: leadAgentId,
      agentType: 'generalPurpose',
      model: 'claude-sonnet-4',
      toolInput: { displayName: 'Implementer' },
      agentTranscriptPath: agentTranscriptPaths[implAgentId],
    });
    
    // Implementer: Read existing utils
    const implRead1 = span();
    add(17, {
      eventKind: 'toolStart',
      agentId: implAgentId,
      spanId: implRead1,
      parentSpanId: taskImpl,
      toolName: 'Read',
      toolInput: { file_path: 'src/types/express.d.ts' },
    });
    add(18, {
      eventKind: 'toolEnd',
      agentId: implAgentId,
      spanId: implRead1,
      duration: 1000,
    });
    
    // Implementer: Write the middleware
    const implWrite = span();
    add(18.5, {
      eventKind: 'toolStart',
      agentId: implAgentId,
      spanId: implWrite,
      parentSpanId: taskImpl,
      toolName: 'Write',
      toolInput: { file_path: 'src/middleware/auth.ts' },
    });
    add(22, {
      eventKind: 'toolEnd',
      agentId: implAgentId,
      spanId: implWrite,
      duration: 3500,
    });
    
    // Implementer: Edit index to export
    const implEdit = span();
    add(22.5, {
      eventKind: 'toolStart',
      agentId: implAgentId,
      spanId: implEdit,
      parentSpanId: taskImpl,
      toolName: 'Edit',
      toolInput: { file_path: 'src/middleware/index.ts' },
    });
    add(24, {
      eventKind: 'toolEnd',
      agentId: implAgentId,
      spanId: implEdit,
      duration: 1500,
    });
    
    // Implementer: MCP call to get latest best practices
    const implMcp = span();
    add(24.5, {
      eventKind: 'toolStart',
      agentId: implAgentId,
      spanId: implMcp,
      parentSpanId: taskImpl,
      toolName: 'mcp:context7/resolve-library-id',
      toolInput: { library_name: 'jsonwebtoken' },
      hookEventName: 'beforeMCPExecution',
    });
    add(26, {
      eventKind: 'toolEnd',
      agentId: implAgentId,
      spanId: implMcp,
      duration: 1500,
      toolOutput: '{"libraryId": "jwt-node", "version": "9.0.0"}',
    });
    
    // Implementer completes
    add(27, {
      eventKind: 'subagentStop',
      agentId: implAgentId,
      status: 'completed',
      agentTranscriptPath: agentTranscriptPaths[implAgentId],
    });
    
    add(27, {
      eventKind: 'toolEnd',
      agentId: leadAgentId,
      spanId: taskImpl,
      duration: 11000,
    });
    
    // ========================================================================
    // Lead spawns Shell subagent for testing (28-45s)
    // ========================================================================
    
    const taskShell = span();
    add(28, {
      eventKind: 'toolStart',
      agentId: leadAgentId,
      spanId: taskShell,
      toolName: 'Task',
      toolInput: { 
        subagent_type: 'shell',
        prompt: 'Run type check and tests for auth middleware',
        description: 'Test runner'
      },
    });
    
    add(28.5, {
      eventKind: 'subagentStart',
      agentId: shellAgentId,
      parentAgentId: leadAgentId,
      agentType: 'shell',
      model: 'claude-sonnet-4',
      toolInput: { displayName: 'Shell' },
      agentTranscriptPath: agentTranscriptPaths[shellAgentId],
    });
    
    // Shell: Type check
    const shellBash1 = span();
    add(29, {
      eventKind: 'toolStart',
      agentId: shellAgentId,
      spanId: shellBash1,
      parentSpanId: taskShell,
      toolName: 'Bash',
      toolInput: { command: 'npx tsc --noEmit' },
    });
    add(33, {
      eventKind: 'toolEnd',
      agentId: shellAgentId,
      spanId: shellBash1,
      duration: 4000,
      toolOutput: 'No errors found',
    });
    
    // Shell: Run tests (FAILS!)
    const shellBash2 = span();
    add(33.5, {
      eventKind: 'toolStart',
      agentId: shellAgentId,
      spanId: shellBash2,
      parentSpanId: taskShell,
      toolName: 'Bash',
      toolInput: { command: 'npm test -- --grep "auth"' },
    });
    add(38, {
      eventKind: 'toolFailure',
      agentId: shellAgentId,
      spanId: shellBash2,
      duration: 4500,
      failureType: 'error',
      errorMessage: 'FAIL: Expected 401 but got 500 - JWT_SECRET not set in test env',
    });
    
    // Shell: Fix and retry
    const shellBash3 = span();
    add(38.5, {
      eventKind: 'toolStart',
      agentId: shellAgentId,
      spanId: shellBash3,
      parentSpanId: taskShell,
      toolName: 'Bash',
      toolInput: { command: 'JWT_SECRET=test npm test -- --grep "auth"' },
    });
    add(43, {
      eventKind: 'toolEnd',
      agentId: shellAgentId,
      spanId: shellBash3,
      duration: 4500,
      toolOutput: 'PASS: 8 tests passed',
    });
    
    // Shell completes
    add(44, {
      eventKind: 'subagentStop',
      agentId: shellAgentId,
      status: 'completed',
      agentTranscriptPath: agentTranscriptPaths[shellAgentId],
    });
    
    add(44, {
      eventKind: 'toolEnd',
      agentId: leadAgentId,
      spanId: taskShell,
      duration: 16000,
    });
    
    // ========================================================================
    // Context Compaction (45s) - showing the hook event
    // ========================================================================
    add(45, {
      eventKind: 'contextCompact',
      agentId: leadAgentId,
      contextUsagePercent: 85,
      contextTokens: 120000,
      messagesToCompact: 30,
    });
    
    // ========================================================================
    // Lead: Final verification (46-55s)
    // ========================================================================
    
    // Lead: Read to verify
    const leadRead = span();
    add(46, {
      eventKind: 'toolStart',
      agentId: leadAgentId,
      spanId: leadRead,
      toolName: 'Read',
      toolInput: { file_path: 'src/middleware/auth.ts' },
    });
    add(47, {
      eventKind: 'toolEnd',
      agentId: leadAgentId,
      spanId: leadRead,
      duration: 1000,
    });
    
    // Lead: Edit to add JSDoc
    const leadEdit = span();
    add(47.5, {
      eventKind: 'toolStart',
      agentId: leadAgentId,
      spanId: leadEdit,
      toolName: 'Edit',
      toolInput: { file_path: 'src/middleware/auth.ts' },
    });
    add(49, {
      eventKind: 'toolEnd',
      agentId: leadAgentId,
      spanId: leadEdit,
      duration: 1500,
    });
    
    // ========================================================================
    // Reviewer Agent (50-62s) - independent top-level agent
    // ========================================================================
    
    add(50, {
      eventKind: 'sessionStart',
      runId,
      agentId: reviewerId,
      model: 'claude-sonnet-4',
      projectRoot: '/demo/api-service',
      toolInput: { displayName: 'Reviewer' },
      agentTranscriptPath: agentTranscriptPaths[reviewerId],
    });
    
    // Reviewer: Thinking
    add(50.5, {
      eventKind: 'thinkingStart',
      agentId: reviewerId,
      spanId: span(),
    });
    
    add(52, {
      eventKind: 'thinkingEnd',
      agentId: reviewerId,
      thinkingDurationMs: 1500,
      thinkingText: 'Reviewing the auth middleware implementation for security best practices...',
    });
    
    // Reviewer: Read implementation
    const reviewRead1 = span();
    add(52.5, {
      eventKind: 'toolStart',
      agentId: reviewerId,
      spanId: reviewRead1,
      toolName: 'Read',
      toolInput: { file_path: 'src/middleware/auth.ts' },
    });
    add(53.5, {
      eventKind: 'toolEnd',
      agentId: reviewerId,
      spanId: reviewRead1,
      duration: 1000,
    });
    
    // Reviewer: Grep for security patterns
    const reviewGrep = span();
    add(54, {
      eventKind: 'toolStart',
      agentId: reviewerId,
      spanId: reviewGrep,
      toolName: 'Grep',
      toolInput: { pattern: 'process\\.env', path: 'src/' },
    });
    add(55.5, {
      eventKind: 'toolEnd',
      agentId: reviewerId,
      spanId: reviewGrep,
      duration: 1500,
    });
    
    // Reviewer: MCP security scan (FAILS - permission denied)
    const reviewMcpFail = span();
    add(56, {
      eventKind: 'toolStart',
      agentId: reviewerId,
      spanId: reviewMcpFail,
      toolName: 'mcp:security/scan',
      toolInput: { target: 'src/', depth: 'full' },
      hookEventName: 'beforeMCPExecution',
    });
    add(58, {
      eventKind: 'toolFailure',
      agentId: reviewerId,
      spanId: reviewMcpFail,
      duration: 2000,
      failureType: 'permission_denied',
      errorMessage: 'MCP server security/scan requires elevated permissions',
    });
    
    // Reviewer: MCP create PR review (success)
    const reviewMcp = span();
    add(58.5, {
      eventKind: 'toolStart',
      agentId: reviewerId,
      spanId: reviewMcp,
      toolName: 'mcp:github/create-review',
      toolInput: { repo: 'api-service', pr: 42, body: 'LGTM! Auth middleware looks good.' },
    });
    add(60.5, {
      eventKind: 'toolEnd',
      agentId: reviewerId,
      spanId: reviewMcp,
      duration: 2000,
      toolOutput: '{"id": 123, "state": "approved"}',
    });
    
    // ========================================================================
    // Session End (62s)
    // ========================================================================
    
    add(61, {
      eventKind: 'stop',
      agentId: reviewerId,
      status: 'completed',
    });
    
    // Lead: Final response
    add(61.5, {
      eventKind: 'agentResponse',
      agentId: leadAgentId,
      responseText: 'I\'ve implemented JWT authentication middleware in src/middleware/auth.ts. Tests pass and the code has been reviewed.',
    });
    
    add(62, {
      eventKind: 'stop',
      agentId: leadAgentId,
      status: 'completed',
    });
    
    return events;
  }

  private fabricateDemoTranscripts(runId: string): {
    runTranscriptPath: string;
    transcriptsDir: string;
  } {
    const transcriptsDir = path.join(this.projectRoot, '.agent-runtime-observability', 'demo-transcripts', runId);
    fs.mkdirSync(transcriptsDir, { recursive: true });

    const runTranscriptPath = path.join(transcriptsDir, 'conversation.md');

    fs.writeFileSync(
      runTranscriptPath,
      [
        '# Demo Conversation',
        '',
        '**User:** Implement auth middleware',
        '',
        '**Assistant:** I’ll implement JWT auth middleware, add tests, and verify behavior end-to-end.',
        '',
        '---',
        '',
        '_This is a fabricated transcript for demo purposes._',
      ].join('\n'),
      'utf-8'
    );

    return {
      runTranscriptPath,
      transcriptsDir,
    };
  }
}
