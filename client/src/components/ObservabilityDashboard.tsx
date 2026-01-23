/**
 * ObservabilityDashboard
 * 
 * Real-time agent observability dashboard matching the mockup design.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useTrace } from '../hooks/useTrace';
import {
  Span,
  Agent,
  RunSummary,
  getToolCategory,
  TOOL_COLORS,
  STATUS_COLORS,
  RUN_STATUS_COLORS,
  ConnectionStatus,
  ToolCategory,
} from '../types';

type DisplaySpan = Span & { compactCount?: number; compactFiles?: string[] };

// ============================================================================
// Tool Legend Configuration
// ============================================================================

const TOOL_LEGEND: { name: string; category: ToolCategory }[] = [
  { name: 'Thinking', category: 'thinking' },
  { name: 'Grep', category: 'search' },
  { name: 'Read', category: 'read' },
  { name: 'Write', category: 'write' },
  { name: 'Edit', category: 'edit' },
  { name: 'Bash', category: 'shell' },
  { name: 'Task', category: 'task' },
  { name: 'MCP', category: 'mcp' },
];

const SPAN_TRACK_BG = '#0a0a0f';
const SPAN_ROW_HEIGHT = 18;
const SPAN_ROW_GAP = 4;
const SPAN_TRACK_MIN_HEIGHT = 28;
const API_URL = 'http://localhost:5174/api';

// ============================================================================
// Main Component
// ============================================================================

export function ObservabilityDashboard() {
  const {
    currentRunRef,
    agentsRef,
    spansRef,
    dataVersionRef,
    connectionStatus,
    recentRuns,
    selectedRunId,
    selectRun,
    refreshRuns,
  } = useTrace();

  const [selectedSpan, setSelectedSpan] = useState<Span | null>(null);
  const [, forceUpdate] = useState(0);
  const [demoLoading, setDemoLoading] = useState(false);
  const [compactMode, setCompactMode] = useState(true);

  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [transcriptTitle, setTranscriptTitle] = useState<string>('');
  const [transcriptPath, setTranscriptPath] = useState<string>('');
  const [transcriptContent, setTranscriptContent] = useState<string>('');
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  
  const lastVersionRef = useRef(0);
  
  // Animation frame for live updates
  useEffect(() => {
    let animationId: number;
    
    const tick = () => {
      if (dataVersionRef.current !== lastVersionRef.current) {
        lastVersionRef.current = dataVersionRef.current;
        forceUpdate(n => n + 1);
      }
      animationId = requestAnimationFrame(tick);
    };
    
    animationId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationId);
  }, [dataVersionRef]);

  // Get current data from refs
  const agents = Array.from(agentsRef.current.values());
  const spans = spansRef.current;
  const run = currentRunRef.current;

  // Calculate time range
  const now = Date.now();
  let timeStart = run?.startedAt || now - 60000;
  let timeEnd = run?.endedAt || now;
  
  if (timeEnd - timeStart < 10000) {
    timeEnd = timeStart + 10000;
  }
  const duration = timeEnd - timeStart;
  timeEnd += duration * 0.02;

  // Build run summary
  const runSummary: RunSummary | null = run ? {
    runId: run.runId,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    status: run.status,
    source: run.source,
    agentCount: agents.length,
    spanCount: spans.length,
    errorCount: spans.filter(s => s.status === 'error' || s.status === 'timeout' || s.status === 'permission_denied').length,
    durationMs: run.endedAt ? run.endedAt - run.startedAt : Date.now() - run.startedAt,
  } : null;

  const selectedAgent = selectedSpan ? agentsRef.current.get(selectedSpan.agentId) || null : null;

  const openTranscript = async (opts: { agentId?: string; title: string }) => {
    if (!selectedRunId) return;
    setTranscriptOpen(true);
    setTranscriptTitle(opts.title);
    setTranscriptLoading(true);
    setTranscriptError(null);
    setTranscriptContent('');
    setTranscriptPath('');

    try {
      const endpoint = opts.agentId
        ? `${API_URL}/runs/${encodeURIComponent(selectedRunId)}/agents/${encodeURIComponent(opts.agentId)}/transcript`
        : `${API_URL}/runs/${encodeURIComponent(selectedRunId)}/transcript`;
      const res = await fetch(endpoint);
      const data = await res.json();
      if (!res.ok) {
        setTranscriptError(data?.error || 'Failed to load transcript');
        return;
      }
      setTranscriptPath(data?.path || '');
      setTranscriptContent(data?.content || '');
      if (data?.truncated) {
        setTranscriptError(`Showing first ${(data?.content?.length || 0).toLocaleString()} chars of a ${(data?.sizeBytes || 0).toLocaleString()} byte file (truncated).`);
      }
    } catch (err) {
      setTranscriptError('Failed to load transcript');
    } finally {
      setTranscriptLoading(false);
    }
  };

  // Start demo
  const startDemo = async () => {
    setDemoLoading(true);
    try {
      const res = await fetch('http://localhost:5174/api/demo/start', { method: 'POST' });
      const data = await res.json();
      if (data.runId) {
        setTimeout(() => {
          refreshRuns();
          selectRun(data.runId);
        }, 500);
      }
    } catch (err) {
      console.error('Failed to start demo:', err);
    }
    setDemoLoading(false);
  };

  // Find parent agent for subagents
  const getParentAgent = (agent: Agent) => {
    if (!agent.parentAgentId) return null;
    return agentsRef.current.get(agent.parentAgentId);
  };

  // Get the prompt/title from run metadata
  const runTitle = run?.projectRoot?.split('/').pop() || 'Agent Run';
  
  // Extract a clean prompt - avoid showing raw JSON
  const getRunPrompt = () => {
    if (!run) return 'Agent Session';
    
    // For demo runs, use a nice title
    if (run.source === 'demo') return 'Implement auth middleware';
    
    // For real runs, show a generic title based on project
    return `Session in ${runTitle}`;
  };
  const runPrompt = getRunPrompt();

  return (
    <div style={styles.container}>
      {/* Transcript Modal */}
      {transcriptOpen && (
        <div
          style={styles.modalOverlay}
          onClick={() => setTranscriptOpen(false)}
        >
          <div
            style={styles.modal}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={styles.modalHeader}>
              <div style={styles.modalTitleBlock}>
                <div style={styles.modalTitle}>{transcriptTitle}</div>
                {transcriptPath && <div style={styles.modalSubtitle}>{transcriptPath}</div>}
              </div>
              <button style={styles.modalCloseButton} onClick={() => setTranscriptOpen(false)}>
                Close
              </button>
            </div>

            {transcriptLoading ? (
              <div style={styles.modalBody}>Loading…</div>
            ) : transcriptError && !transcriptContent ? (
              <div style={styles.modalBody}>
                <div style={styles.modalError}>{transcriptError}</div>
              </div>
            ) : (
              <div style={styles.modalBody}>
                {transcriptError && <div style={styles.modalWarning}>{transcriptError}</div>}
                <pre style={styles.transcriptPre}>{transcriptContent}</pre>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.logo}>⚡</div>
          <span style={styles.logoText}>CodeMap</span>
          <span style={styles.headerDivider}>/</span>
          <span style={styles.headerTitle}>Observability</span>
        </div>
        <div style={styles.headerRight}>
          {/* Run selector */}
          {recentRuns.length > 0 && (
            <select
              value={selectedRunId || ''}
              onChange={(e) => selectRun(e.target.value)}
              style={styles.runSelector}
            >
              {recentRuns.map(r => (
                <option key={r.runId} value={r.runId}>
                  {r.source === 'demo' ? '🎬 Demo' : '🔴 Live'} - {new Date(r.startedAt).toLocaleTimeString()} ({r.spanCount} spans)
                </option>
              ))}
            </select>
          )}
          <button 
            style={styles.demoButton}
            onClick={startDemo}
            disabled={demoLoading}
          >
            {demoLoading ? '...' : '▷ Run Demo'}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main style={styles.main}>
        {selectedRunId && runSummary ? (
          <>
            {/* Run Summary Card */}
            <section style={styles.runCard}>
              <div style={styles.runHeader}>
                <h1 style={styles.runTitle}>{runPrompt}</h1>
                <span style={{
                  ...styles.statusBadge,
                  backgroundColor: RUN_STATUS_COLORS[runSummary.status],
                }}>
                  {runSummary.status.charAt(0).toUpperCase() + runSummary.status.slice(1)}
                </span>
              </div>
              
              <div style={styles.runMeta}>
                <span>⚡ {runTitle}</span>
                <span style={styles.metaDot}>•</span>
                <span>{new Date(runSummary.startedAt).toLocaleString()}</span>
                <span style={styles.metaDot}>•</span>
                <span>via {runSummary.source === 'demo' ? 'Demo' : runSummary.source === 'cursor' ? 'Cursor' : 'Claude'}</span>
                {run?.transcriptPath && (
                  <>
                    <span style={styles.metaDot}>•</span>
                    <button
                      style={styles.linkButton}
                      onClick={() => openTranscript({ title: 'Conversation transcript' })}
                    >
                      View conversation
                    </button>
                  </>
                )}
              </div>

              {run?.initialPrompt && (
                <div style={styles.initialPrompt}>
                  <div style={styles.initialPromptLabel}>Initial query</div>
                  <div style={styles.initialPromptText}>{run.initialPrompt}</div>
                </div>
              )}

              <div style={styles.statsGrid}>
                <div style={styles.statBox}>
                  <div style={styles.statValue}>{formatDuration(runSummary.durationMs)}</div>
                  <div style={styles.statLabel}>DURATION</div>
                </div>
                <div style={styles.statBox}>
                  <div style={styles.statValue}>{runSummary.agentCount}</div>
                  <div style={styles.statLabel}>AGENTS</div>
                </div>
                <div style={styles.statBox}>
                  <div style={styles.statValue}>{runSummary.spanCount}</div>
                  <div style={styles.statLabel}>TOOL CALLS</div>
                </div>
                <div style={{
                  ...styles.statBox,
                  ...(runSummary.errorCount > 0 ? styles.statBoxError : {}),
                }}>
                  <div style={styles.statValue}>
                    {runSummary.errorCount}
                    {runSummary.errorCount > 0 && <span style={styles.errorIcon}> ⚠</span>}
                  </div>
                  <div style={styles.statLabel}>ERRORS</div>
                </div>
              </div>
            </section>

            {/* Agent Activity + Inspect Panel */}
            <div style={styles.activityContainer}>
              {/* Agent Activity */}
              <section style={styles.activityCard}>
                <div style={styles.activityHeader}>
                  <h2 style={styles.activityTitle}>Agent Activity</h2>
                  <div style={styles.activityControls}>
                    <button
                      style={{
                        ...styles.compactToggle,
                        ...(compactMode ? styles.compactToggleActive : {}),
                      }}
                      onClick={() => setCompactMode(prev => !prev)}
                    >
                      Compact {compactMode ? 'On' : 'Off'}
                    </button>
                    <div style={styles.legend}>
                      {TOOL_LEGEND.map(tool => (
                        <div key={tool.name} style={styles.legendItem}>
                          <div style={{
                            ...styles.legendDot,
                            backgroundColor: TOOL_COLORS[tool.category],
                          }} />
                          <span>{tool.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Timeline */}
                <div style={styles.timeline}>
                  {/* Time ruler */}
                  <div style={styles.timeRuler}>
                    <span></span>
                    {[0, 25, 50, 75, 100].map(pct => (
                      <span key={pct} style={styles.timeLabel}>
                        {Math.round((duration * pct / 100) / 1000)}s
                      </span>
                    ))}
                  </div>

                  {/* Agent swimlanes */}
                  {agents.map(agent => {
                    // Filter spans - exclude Task spans from parent agents since 
                    // subagents have their own swimlanes
                    const agentSpans = spans.filter(s => {
                      if (s.agentId !== agent.agentId) return false;
                      // Keep Task spans only if we want to see them (could toggle this)
                      // For cleaner visualization, exclude Task spans - subagent swimlane shows the work
                      if (s.toolName === 'Task') return false;
                      return true;
                    });
                    const displaySpans: DisplaySpan[] = compactMode
                      ? buildCompactSpans(agentSpans, now, run?.projectRoot)
                      : agentSpans;
                    const isSubagent = !!agent.parentAgentId;
                    const parentAgent = getParentAgent(agent);
                    
                    return (
                      <div 
                        key={agent.agentId} 
                        style={{
                          ...styles.swimlane,
                          ...(isSubagent ? styles.swimlaneIndented : {}),
                        }}
                      >
                        <div style={styles.agentInfo}>
                          <div style={styles.agentNameRow}>
                            <span style={styles.agentName} title={agent.displayName}>{agent.displayName}</span>
                            {isSubagent && (
                              <span style={styles.taskBadge}>TASK</span>
                            )}
                          </div>
                          <div style={styles.agentModel}>
                            {agent.model?.replace('claude-', '').replace('-20250514', '') || 'unknown'}
                          </div>
                        </div>
                        
                        {(() => {
                          const { spanLayouts, laneCount } = buildSpanLanes(displaySpans, now);
                          const trackHeight = Math.max(
                            SPAN_TRACK_MIN_HEIGHT,
                            laneCount * (SPAN_ROW_HEIGHT + SPAN_ROW_GAP) + SPAN_ROW_GAP
                          );

                          return (
                            <div style={{ ...styles.spanTrack, height: `${trackHeight}px` }}>
                              {spanLayouts.map(({ span, lane }) => {
                              const left = ((span.startedAt - timeStart) / duration) * 100;
                              const end = span.endedAt || now;
                              const rawWidth = ((end - span.startedAt) / duration) * 100;
                              const width = Math.max(rawWidth, 1);
                              const category = getToolCategory(span.toolName);
                              const isError = span.status === 'error' || span.status === 'timeout' || span.status === 'permission_denied';
                              const isSelected = selectedSpan?.spanId === span.spanId;
                              const bgColor = isError ? STATUS_COLORS[span.status] : TOOL_COLORS[category];
                              const top = SPAN_ROW_GAP + lane * (SPAN_ROW_HEIGHT + SPAN_ROW_GAP);
                              const label = span.compactCount ? `${span.toolName} ×${span.compactCount}` : span.toolName;

                              return (
                                <div
                                  key={span.spanId}
                                  onClick={() => setSelectedSpan(span)}
                                  style={{
                                    ...styles.span,
                                    left: `${Math.max(0, left)}%`,
                                    width: `${Math.min(100 - left, width)}%`,
                                    top: `${top}px`,
                                    height: `${SPAN_ROW_HEIGHT}px`,
                                    backgroundColor: bgColor,
                                    // Draw separators inside the span so adjacent spans never "touch"
                                    borderLeft: `2px solid ${SPAN_TRACK_BG}`,
                                    borderRight: `2px solid ${SPAN_TRACK_BG}`,
                                    backgroundClip: 'padding-box',
                                    zIndex: isSelected ? 10 : 1,
                                    boxShadow: isSelected ? `0 0 0 2px white, 0 0 0 4px ${bgColor}` : 'none',
                                  }}
                                  title={`${label} (${span.status})`}
                                >
                                  {width > 5 && (
                                    <span style={styles.spanLabel}>
                                      {label.replace('mcp:', '').replace('context7/', '')}
                                    </span>
                                  )}
                                </div>
                              );
                              })}
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}

                  {agents.length === 0 && (
                    <div style={styles.emptyTimeline}>
                      <div style={styles.emptyIcon}>📊</div>
                      <div>Waiting for agent activity...</div>
                    </div>
                  )}
                </div>
              </section>

              {/* Inspect Panel */}
              <aside style={styles.inspectPanel}>
                <h2 style={styles.inspectTitle}>Span Details</h2>
                
                {selectedSpan ? (
                  <div style={styles.inspectContent}>
                    {/* Tool header */}
                    <div style={styles.inspectHeader}>
                      <div style={{
                        ...styles.toolIcon,
                        backgroundColor: TOOL_COLORS[getToolCategory(selectedSpan.toolName)],
                      }}>
                        {getToolIcon(selectedSpan.toolName)}
                      </div>
                      <div style={styles.toolInfo}>
                        <div style={styles.toolName}>
                          {selectedSpan.toolName.replace('mcp:', '')}
                          {selectedSpan.status === 'ok' && <span style={styles.checkmark}> ✓</span>}
                        </div>
                        <div style={styles.toolAgent}>{selectedAgent?.displayName}</div>
                      </div>
                    </div>

                    {/* Status */}
                    <div style={styles.inspectRow}>
                      <span style={styles.inspectLabel}>Status</span>
                      <span style={{
                        ...styles.statusValue,
                        color: STATUS_COLORS[selectedSpan.status],
                      }}>
                        {selectedSpan.status === 'ok' && '✓ '}
                        {selectedSpan.status}
                      </span>
                    </div>

                    {/* Conversation */}
                    {selectedAgent?.transcriptPath && (
                      <div style={styles.inspectSection}>
                        <div style={styles.inspectLabel}>Conversation</div>
                        <button
                          style={styles.linkButton}
                          onClick={() => openTranscript({ agentId: selectedAgent.agentId, title: `${selectedAgent.displayName} transcript` })}
                        >
                          View {selectedAgent.displayName}
                        </button>
                      </div>
                    )}

                    {/* Duration */}
                    <div style={styles.inspectRow}>
                      <span style={styles.inspectLabel}>Duration</span>
                      <span style={styles.inspectValue}>
                        {selectedSpan.durationMs ? `${(selectedSpan.durationMs / 1000).toFixed(1)}s` : 'Running...'}
                      </span>
                    </div>

                    {/* Started */}
                    <div style={styles.inspectRow}>
                      <span style={styles.inspectLabel}>Started</span>
                      <span style={styles.inspectValue}>
                        +{Math.round((selectedSpan.startedAt - timeStart) / 1000)}s
                      </span>
                    </div>

                    {/* Input */}
                    {selectedSpan.inputPreview && (
                      <div style={styles.inspectSection}>
                        <div style={styles.inspectLabel}>Input</div>
                        <div style={styles.codeBlock}>
                          {selectedSpan.inputPreview}
                        </div>
                      </div>
                    )}

                    {/* Output */}
                    {selectedSpan.outputPreview && (
                      <div style={styles.inspectSection}>
                        <div style={styles.inspectLabel}>Output</div>
                        <div style={styles.codeBlock}>
                          {selectedSpan.outputPreview}
                        </div>
                      </div>
                    )}

                    {/* Error */}
                    {selectedSpan.errorMessage && (
                      <div style={styles.inspectSection}>
                        <div style={styles.inspectLabel}>Error</div>
                        <div style={{...styles.codeBlock, borderLeft: '3px solid #f87171'}}>
                          {selectedSpan.errorMessage}
                        </div>
                      </div>
                    )}

                    {/* Spawned Subagent (for Task spans) */}
                    {selectedSpan.toolName === 'Task' && (() => {
                      const childAgent = agents.find(a => 
                        a.parentAgentId && 
                        spans.some(s => s.spanId === selectedSpan.spanId && s.agentId === a.parentAgentId)
                      );
                      // Find child agent by checking if any spans from this Task have children
                      const childAgentBySpans = agents.find(a => 
                        a.parentAgentId === selectedSpan.agentId &&
                        spans.some(s => s.agentId === a.agentId && s.parentSpanId === selectedSpan.spanId)
                      );
                      const subagent = childAgent || childAgentBySpans || agents.find(a => 
                        a.parentAgentId === selectedSpan.agentId
                      );
                      
                      if (subagent) {
                        return (
                          <div style={styles.spawnedSubagent}>
                            <div style={styles.spawnedLabel}>Spawned Subagent</div>
                            <div style={styles.spawnedValue}>→ {subagent.displayName}</div>
                          </div>
                        );
                      }
                      return null;
                    })()}
                  </div>
                ) : (
                  <div style={styles.inspectEmpty}>
                    <div style={styles.inspectEmptyIcon}>⚡</div>
                    <div>Click a span to inspect</div>
                  </div>
                )}
              </aside>
            </div>
          </>
        ) : (
          /* Empty State */
          <div style={styles.emptyState}>
            <div style={styles.emptyStateIcon}>⚡</div>
            <h2 style={styles.emptyStateTitle}>No runs yet</h2>
            <p style={styles.emptyStateText}>
              Start a Cursor or Claude Code session with hooks configured,<br />
              or run a demo to see the dashboard in action.
            </p>
            <button 
              style={styles.demoBigButton}
              onClick={startDemo}
              disabled={demoLoading}
            >
              {demoLoading ? 'Starting...' : '▷ Run Demo'}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function formatDuration(ms?: number): string {
  if (!ms) return '--';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function getToolIcon(toolName: string): string {
  const name = toolName.toLowerCase();
  if (name.includes('grep') || name.includes('search')) return '🔍';
  if (name.includes('read')) return '📄';
  if (name.includes('write') || name.includes('edit')) return '✏️';
  if (name.includes('bash') || name.includes('shell')) return '💻';
  if (name.includes('task')) return '📋';
  if (name.includes('mcp')) return '🔌';
  return '⚡';
}

function buildSpanLanes(spans: DisplaySpan[], now: number): {
  spanLayouts: Array<{ span: DisplaySpan; lane: number }>;
  laneCount: number;
} {
  const sorted = [...spans].sort((a, b) => a.startedAt - b.startedAt);
  const laneEnds: number[] = [];
  const spanLayouts: Array<{ span: DisplaySpan; lane: number }> = [];

  sorted.forEach(span => {
    const end = span.endedAt || now;
    let laneIndex = laneEnds.findIndex(laneEnd => span.startedAt >= laneEnd);
    if (laneIndex === -1) {
      laneIndex = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[laneIndex] = end;
    }
    spanLayouts.push({ span, lane: laneIndex });
  });

  return {
    spanLayouts,
    laneCount: Math.max(1, laneEnds.length),
  };
}

function buildCompactSpans(spans: Span[], now: number, projectRoot?: string): DisplaySpan[] {
  if (spans.length === 0) return [];

  const compactableTools = new Set(['read', 'list', 'ls', 'glob']);
  const windowMs = 500;
  const sorted = [...spans].sort((a, b) => a.startedAt - b.startedAt);

  const result: DisplaySpan[] = [];
  let currentGroup: {
    key: string;
    start: number;
    end: number;
    spans: Span[];
    files: string[];
  } | null = null;

  const flushGroup = () => {
    if (!currentGroup) return;
    if (currentGroup.spans.length === 1) {
      result.push(currentGroup.spans[0]);
      currentGroup = null;
      return;
    }

    const base = currentGroup.spans[0];
    const compactCount = currentGroup.spans.length;
    const files = Array.from(new Set(currentGroup.files)).filter(Boolean);
    const status = mergeSpanStatus(currentGroup.spans);

    const filePreview = files.length > 0
      ? `Files (${files.length}): ${files.slice(0, 5).join(', ')}${files.length > 5 ? ` +${files.length - 5} more` : ''}`
      : 'Files: unknown';

    const compactSpan: DisplaySpan = {
      ...base,
      spanId: `compact-${base.spanId}`,
      startedAt: currentGroup.start,
      endedAt: currentGroup.end,
      durationMs: currentGroup.end - currentGroup.start,
      status,
      inputPreview: `Aggregated ${base.toolName} ×${compactCount}\n${filePreview}`,
      files,
      compactCount,
      compactFiles: files,
    };

    result.push(compactSpan);
    currentGroup = null;
  };

  sorted.forEach(span => {
    const toolKey = span.toolName.toLowerCase();
    const isCompactable = compactableTools.has(toolKey);
    if (!isCompactable) {
      flushGroup();
      result.push(span);
      return;
    }

    const normalizedPath = normalizePath(span.files?.[0], projectRoot) || '';
    const groupKey = `${span.toolName}:${normalizedPath}`;
    const start = span.startedAt;
    const end = span.endedAt || now;

    if (
      currentGroup &&
      currentGroup.key === groupKey &&
      start - currentGroup.end <= windowMs
    ) {
      currentGroup.spans.push(span);
      currentGroup.end = Math.max(currentGroup.end, end);
      if (normalizedPath) currentGroup.files.push(normalizedPath);
    } else {
      flushGroup();
      currentGroup = {
        key: groupKey,
        start,
        end,
        spans: [span],
        files: normalizedPath ? [normalizedPath] : [],
      };
    }
  });

  flushGroup();
  return result;
}

function normalizePath(filePath?: string, projectRoot?: string): string | undefined {
  if (!filePath) return undefined;
  let normalized = filePath.replace(/^\.\/+/, '');
  if (projectRoot && normalized.startsWith(projectRoot)) {
    normalized = normalized.slice(projectRoot.length);
  }
  normalized = normalized.replace(/^\/+/, '');
  return normalized || undefined;
}

function mergeSpanStatus(spans: Span[]): Span['status'] {
  const priority: Span['status'][] = [
    'error',
    'timeout',
    'permission_denied',
    'aborted',
    'running',
    'ok',
  ];

  for (const status of priority) {
    if (spans.some(span => span.status === status)) {
      return status;
    }
  }
  return 'ok';
}

// ============================================================================
// Styles
// ============================================================================

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#0a0a0f',
    color: '#e2e8f0',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },

  // Modal
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '24px',
  },
  modal: {
    width: 'min(1100px, 100%)',
    maxHeight: '85vh',
    backgroundColor: '#111118',
    border: '1px solid #1e293b',
    borderRadius: '16px',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  modalHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '16px',
    padding: '16px 16px 12px 16px',
    borderBottom: '1px solid #1e293b',
  },
  modalTitleBlock: {
    minWidth: 0,
  },
  modalTitle: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#f1f5f9',
    marginBottom: '4px',
  },
  modalSubtitle: {
    fontSize: '12px',
    color: '#64748b',
    fontFamily: 'monospace',
    wordBreak: 'break-all',
  },
  modalCloseButton: {
    padding: '8px 12px',
    backgroundColor: 'transparent',
    border: '1px solid #334155',
    borderRadius: '8px',
    color: '#e2e8f0',
    fontSize: '13px',
    cursor: 'pointer',
    flexShrink: 0,
  },
  modalBody: {
    padding: '16px',
    overflow: 'auto',
  },
  modalError: {
    padding: '12px',
    backgroundColor: 'rgba(248, 113, 113, 0.1)',
    border: '1px solid rgba(248, 113, 113, 0.3)',
    borderRadius: '10px',
    color: '#fca5a5',
    fontSize: '13px',
  },
  modalWarning: {
    padding: '10px 12px',
    backgroundColor: 'rgba(251, 191, 36, 0.1)',
    border: '1px solid rgba(251, 191, 36, 0.25)',
    borderRadius: '10px',
    color: '#fde68a',
    fontSize: '12px',
    marginBottom: '12px',
  },
  transcriptPre: {
    margin: 0,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontSize: '13px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    color: '#cbd5e1',
    lineHeight: 1.5,
  },

  linkButton: {
    padding: 0,
    backgroundColor: 'transparent',
    border: 'none',
    color: '#60a5fa',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500,
    textDecoration: 'underline',
  },
  
  // Header
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 24px',
    borderBottom: '1px solid #1e293b',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  logo: {
    width: '36px',
    height: '36px',
    borderRadius: '10px',
    backgroundColor: '#7c3aed',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '18px',
  },
  logoText: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#f1f5f9',
  },
  headerDivider: {
    color: '#475569',
    fontSize: '20px',
  },
  headerTitle: {
    fontSize: '16px',
    color: '#94a3b8',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  runSelector: {
    padding: '8px 12px',
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: '8px',
    color: '#e2e8f0',
    fontSize: '13px',
    cursor: 'pointer',
    minWidth: '200px',
  },
  demoButton: {
    padding: '10px 20px',
    backgroundColor: 'transparent',
    border: '1px solid #334155',
    borderRadius: '8px',
    color: '#e2e8f0',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  
  // Main
  main: {
    padding: '24px',
    maxWidth: '1600px',
    margin: '0 auto',
  },
  
  // Run Card
  runCard: {
    backgroundColor: '#111118',
    borderRadius: '16px',
    padding: '24px',
    marginBottom: '24px',
  },
  runHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    marginBottom: '12px',
  },
  runTitle: {
    fontSize: '24px',
    fontWeight: 600,
    color: '#f1f5f9',
    margin: 0,
  },
  statusBadge: {
    padding: '6px 14px',
    borderRadius: '20px',
    fontSize: '13px',
    fontWeight: 600,
    color: '#0a0a0f',
  },
  runMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    color: '#64748b',
    marginBottom: '24px',
  },
  initialPrompt: {
    marginBottom: '20px',
    padding: '12px 16px',
    backgroundColor: '#0a0a0f',
    borderRadius: '10px',
    border: '1px solid #1e293b',
  },
  initialPromptLabel: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#94a3b8',
    marginBottom: '6px',
    letterSpacing: '0.4px',
    textTransform: 'uppercase',
  },
  initialPromptText: {
    fontSize: '14px',
    color: '#e2e8f0',
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
  },
  metaDot: {
    color: '#334155',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '16px',
  },
  statBox: {
    backgroundColor: '#0a0a0f',
    borderRadius: '12px',
    padding: '20px',
  },
  statBoxError: {
    backgroundColor: 'rgba(248, 113, 113, 0.1)',
  },
  statValue: {
    fontSize: '32px',
    fontWeight: 600,
    color: '#f1f5f9',
    marginBottom: '4px',
  },
  statLabel: {
    fontSize: '12px',
    fontWeight: 500,
    color: '#64748b',
    letterSpacing: '0.5px',
  },
  errorIcon: {
    color: '#f87171',
    fontSize: '24px',
  },
  
  // Activity Container
  activityContainer: {
    display: 'grid',
    gridTemplateColumns: '1fr 360px',
    gap: '24px',
  },
  
  // Activity Card
  activityCard: {
    backgroundColor: '#111118',
    borderRadius: '16px',
    padding: '24px',
    maxHeight: 'calc(100vh - 320px)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  activityHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '20px',
  },
  activityControls: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  activityTitle: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#f1f5f9',
    margin: 0,
  },
  legend: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    fontSize: '13px',
    color: '#94a3b8',
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  legendDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
  },
  compactToggle: {
    padding: '6px 12px',
    borderRadius: '999px',
    border: '1px solid #334155',
    backgroundColor: 'transparent',
    color: '#94a3b8',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  compactToggleActive: {
    backgroundColor: '#1e293b',
    color: '#e2e8f0',
    borderColor: '#475569',
  },
  
  // Timeline
  timeline: {
    position: 'relative',
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
    paddingRight: '8px',
  },
  timeRuler: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '16px',
    marginLeft: '220px',
    fontSize: '12px',
    color: '#475569',
  },
  timeLabel: {
    minWidth: '30px',
  },
  
  // Swimlane
  swimlane: {
    display: 'flex',
    alignItems: 'flex-start',
    marginBottom: '12px',
    minHeight: '48px',
  },
  swimlaneIndented: {
    marginLeft: '20px',
  },
  agentInfo: {
    width: '200px',
    flexShrink: 0,
    paddingRight: '16px',
    paddingTop: '4px',
  },
  agentNameRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '2px',
    minWidth: 0,
  },
  agentName: {
    fontSize: '15px',
    fontWeight: 500,
    color: '#f1f5f9',
    lineHeight: 1.2,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'normal',
    maxHeight: '2.4em',
    minWidth: 0,
  },
  taskBadge: {
    fontSize: '10px',
    fontWeight: 600,
    padding: '2px 6px',
    borderRadius: '4px',
    backgroundColor: '#ec4899',
    color: '#fff',
  },
  agentModel: {
    fontSize: '13px',
    color: '#64748b',
  },
  spanTrack: {
    flex: 1,
    position: 'relative',
    minHeight: '28px',
    backgroundColor: SPAN_TRACK_BG,
    borderRadius: '6px',
  },
  span: {
    position: 'absolute',
    top: '4px',
    height: '20px',
    borderRadius: '4px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    transition: 'box-shadow 0.15s ease',
    boxSizing: 'border-box',
  },
  spanLabel: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#0a0a0f',
    padding: '0 4px',
    whiteSpace: 'nowrap',
  },
  emptyTimeline: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px',
    color: '#64748b',
    gap: '12px',
  },
  emptyIcon: {
    fontSize: '48px',
    opacity: 0.5,
  },
  
  // Inspect Panel
  inspectPanel: {
    backgroundColor: '#111118',
    borderRadius: '16px',
    padding: '24px',
    height: 'fit-content',
  },
  inspectTitle: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#f1f5f9',
    margin: '0 0 20px 0',
  },
  inspectContent: {},
  inspectHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    marginBottom: '24px',
  },
  toolIcon: {
    width: '48px',
    height: '48px',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '24px',
  },
  toolInfo: {},
  toolName: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#f1f5f9',
  },
  checkmark: {
    color: '#4ade80',
  },
  toolAgent: {
    fontSize: '14px',
    color: '#64748b',
  },
  inspectRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 0',
    borderBottom: '1px solid #1e293b',
  },
  inspectLabel: {
    fontSize: '14px',
    color: '#64748b',
  },
  inspectValue: {
    fontSize: '14px',
    fontWeight: 500,
    color: '#f1f5f9',
    fontFamily: 'monospace',
  },
  statusValue: {
    fontSize: '14px',
    fontWeight: 600,
  },
  inspectSection: {
    marginTop: '16px',
  },
  codeBlock: {
    marginTop: '8px',
    padding: '12px',
    backgroundColor: '#0a0a0f',
    borderRadius: '8px',
    fontSize: '13px',
    fontFamily: 'monospace',
    color: '#94a3b8',
    wordBreak: 'break-word',
    whiteSpace: 'pre-wrap',
  },
  spawnedSubagent: {
    marginTop: '20px',
    padding: '16px',
    backgroundColor: 'rgba(236, 72, 153, 0.1)',
    borderRadius: '8px',
    borderLeft: '3px solid #ec4899',
  },
  spawnedLabel: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#ec4899',
    marginBottom: '4px',
  },
  spawnedValue: {
    fontSize: '14px',
    color: '#f1f5f9',
  },
  inspectEmpty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px 20px',
    color: '#64748b',
    gap: '12px',
  },
  inspectEmptyIcon: {
    fontSize: '48px',
    opacity: 0.3,
  },
  
  // Empty State
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '120px 20px',
    textAlign: 'center',
  },
  emptyStateIcon: {
    fontSize: '80px',
    marginBottom: '24px',
    opacity: 0.3,
  },
  emptyStateTitle: {
    fontSize: '24px',
    fontWeight: 600,
    color: '#f1f5f9',
    margin: '0 0 12px 0',
  },
  emptyStateText: {
    fontSize: '16px',
    color: '#64748b',
    lineHeight: 1.6,
    marginBottom: '32px',
  },
  demoBigButton: {
    padding: '14px 32px',
    backgroundColor: '#7c3aed',
    border: 'none',
    borderRadius: '10px',
    color: '#fff',
    fontSize: '16px',
    fontWeight: 600,
    cursor: 'pointer',
  },
};
