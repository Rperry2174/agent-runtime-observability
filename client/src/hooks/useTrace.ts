/**
 * useTrace Hook
 * 
 * Manages trace data from WebSocket + REST API.
 * Uses refs to avoid React re-render storms during high-frequency updates.
 */

import { useEffect, useRef, useCallback, MutableRefObject, useState } from 'react';
import {
  RunSummary,
  RunDetails,
  Agent,
  Span,
  SpanListResponse,
  TraceUpdate,
  ConnectionStatus,
} from '../types';

const WS_URL = 'ws://localhost:5274/ws';
const API_URL = 'http://localhost:5274/api';

export interface UseTraceResult {
  // Current run data (refs for animation loop access)
  currentRunRef: MutableRefObject<RunDetails | null>;
  agentsRef: MutableRefObject<Map<string, Agent>>;
  spansRef: MutableRefObject<Span[]>;
  
  // Version counters to detect changes without re-rendering
  dataVersionRef: MutableRefObject<number>;
  
  // Connection status (state for UI display)
  connectionStatus: ConnectionStatus;
  
  // Recent runs list (state for run picker)
  recentRuns: RunSummary[];
  
  // Selected run ID (state)
  selectedRunId: string | null;
  
  // Actions
  selectRun: (runId: string) => void;
  refreshRuns: () => void;
}

export interface UseTraceOptions {
  autoSelect?: boolean;
}

export function useTrace(options: UseTraceOptions = {}): UseTraceResult {
  const { autoSelect = true } = options;
  // Refs for high-frequency data (no re-renders)
  const currentRunRef = useRef<RunDetails | null>(null);
  const agentsRef = useRef<Map<string, Agent>>(new Map());
  const spansRef = useRef<Span[]>([]);
  const dataVersionRef = useRef(0);
  const spanIndexRef = useRef<Map<string, number>>(new Map());
  
  // State for UI components that need re-renders
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [recentRuns, setRecentRuns] = useState<RunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  
  // Refs for stable callbacks (avoid dependency cascade)
  const selectedRunIdRef = useRef<string | null>(null);
  const refreshRunsRef = useRef<() => void>(() => {});
  
  // WebSocket ref
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number>();
  const isCleaningUpRef = useRef(false);
  
  // Keep selectedRunIdRef in sync
  useEffect(() => {
    selectedRunIdRef.current = selectedRunId;
  }, [selectedRunId]);
  
  const isTaskCallRun = (runId: string) => runId.startsWith('task-call_');

  const pickBestDefaultRun = useCallback((runs: RunSummary[]): string | null => {
    if (runs.length === 0) return null;

    // Sort by: running status first, then recency, then activity as tie-breaker
    const sorted = [...runs].sort((a, b) => {
      // 1. Running runs always come first
      const aRunning = a.status === 'running' ? 1 : 0;
      const bRunning = b.status === 'running' ? 1 : 0;
      if (aRunning !== bRunning) return bRunning - aRunning;

      // 2. Prefer main runs over task-call subagent runs
      const aMain = !isTaskCallRun(a.runId) ? 1 : 0;
      const bMain = !isTaskCallRun(b.runId) ? 1 : 0;
      if (aMain !== bMain) return bMain - aMain;

      // 3. Most recent first (by startedAt timestamp)
      const aTime = a.startedAt ?? 0;
      const bTime = b.startedAt ?? 0;
      if (aTime !== bTime) return bTime - aTime;

      // 4. Tie-breaker: more activity
      const aActivity = (a.spanCount ?? 0) + (a.agentCount ?? 0) * 2;
      const bActivity = (b.spanCount ?? 0) + (b.agentCount ?? 0) * 2;
      return bActivity - aActivity;
    });

    return sorted[0].runId;
  }, []);

  // Fetch recent runs - stable callback
  const refreshRuns = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/runs`);
      const runs: RunSummary[] = await res.json();
      setRecentRuns(runs);
      
      // Auto-select a "best" run (avoid task-call subagent runs by default)
      // Use functional update to check current state without dependency
      setSelectedRunId(current => {
        if (autoSelect && !current && runs.length > 0) {
          const best = pickBestDefaultRun(runs);
          const selected = best || runs[0].runId;
          console.log('[useTrace] Auto-selecting run:', selected, 'from', runs.length, 'runs');
          return selected;
        }
        return current;
      });
    } catch (err) {
      console.error('Failed to fetch runs:', err);
    }
  }, [autoSelect, pickBestDefaultRun]);
  
  // Keep refreshRunsRef in sync
  useEffect(() => {
    refreshRunsRef.current = refreshRuns;
  }, [refreshRuns]);
  
  // Load spans for a specific run
  const loadRunData = useCallback(async (runId: string) => {
    try {
      const encodedRunId = encodeURIComponent(runId);
      // Fetch run details
      const detailsRes = await fetch(`${API_URL}/runs/${encodedRunId}`);
      if (!detailsRes.ok) return;
      const details: RunDetails = await detailsRes.json();
      
      // Fetch spans
      const spansRes = await fetch(`${API_URL}/runs/${encodedRunId}/spans`);
      if (!spansRes.ok) return;
      const spansData: SpanListResponse = await spansRes.json();
      
      // Deduplicate spans by spanId (keep latest version based on startedAt)
      const spanMap = new Map<string, Span>();
      for (const span of spansData.spans) {
        const existing = spanMap.get(span.spanId);
        if (!existing || (span.endedAt && !existing.endedAt) || span.startedAt > existing.startedAt) {
          spanMap.set(span.spanId, span);
        }
      }
      const dedupedSpans = Array.from(spanMap.values());
      
      // Update refs
      currentRunRef.current = details;
      agentsRef.current = new Map(details.agents.map(a => [a.agentId, a]));
      spansRef.current = dedupedSpans;
      spanIndexRef.current = new Map(dedupedSpans.map((span, idx) => [span.spanId, idx]));
      dataVersionRef.current++;
      
      // Subscribe to this run's updates
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'subscribe', runId }));
      }
    } catch (err) {
      console.error('Failed to load run data:', err);
    }
  }, []);
  
  // Select a run
  const selectRun = useCallback((runId: string) => {
    // Unsubscribe from previous run
    const prevRunId = selectedRunIdRef.current;
    if (prevRunId && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'unsubscribe', runId: prevRunId }));
    }
    
    setSelectedRunId(runId);
    loadRunData(runId);
  }, [loadRunData]);
  
  // Handle WebSocket trace updates - uses refs to avoid recreating
  const handleTraceUpdate = useCallback((update: TraceUpdate) => {
    const currentSelectedRunId = selectedRunIdRef.current;
    
    // Only process updates for the selected run
    if (update.runId !== currentSelectedRunId) {
      // But refresh the runs list on new run events
      if (update.type === 'runStart' || update.type === 'runEnd') {
        refreshRunsRef.current();
      }
      return;
    }
    
    switch (update.type) {
      case 'spanStart':
        if (update.span) {
          // Ensure agent exists for this span (auto-create placeholder if needed)
          if (update.span.agentId && !agentsRef.current.has(update.span.agentId)) {
            const agentCount = agentsRef.current.size + 1;
            agentsRef.current.set(update.span.agentId, {
              agentId: update.span.agentId,
              runId: update.runId,
              displayName: `Agent ${agentCount}`,
              startedAt: update.span.startedAt,
            });
          }

          const existingIndex = spanIndexRef.current.get(update.span.spanId);
          if (existingIndex !== undefined) {
            const next = [...spansRef.current];
            next[existingIndex] = update.span;
            spansRef.current = next;
          } else {
            spansRef.current = [...spansRef.current, update.span];
            spanIndexRef.current.set(update.span.spanId, spansRef.current.length - 1);
          }
          dataVersionRef.current++;
        }
        break;
        
      case 'spanEnd':
      case 'spanUpdate':
        if (update.span) {
          // Ensure agent exists for this span (auto-create placeholder if needed)
          if (update.span.agentId && !agentsRef.current.has(update.span.agentId)) {
            const agentCount = agentsRef.current.size + 1;
            agentsRef.current.set(update.span.agentId, {
              agentId: update.span.agentId,
              runId: update.runId,
              displayName: `Agent ${agentCount}`,
              startedAt: update.span.startedAt,
            });
          }

          const existingIndex = spanIndexRef.current.get(update.span.spanId);
          if (existingIndex !== undefined) {
            const next = [...spansRef.current];
            next[existingIndex] = update.span;
            spansRef.current = next;
          } else {
            spansRef.current = [...spansRef.current, update.span];
            spanIndexRef.current.set(update.span.spanId, spansRef.current.length - 1);
          }
          dataVersionRef.current++;
        }
        break;
        
      case 'agentStart':
        if (update.agent) {
          agentsRef.current.set(update.agent.agentId, update.agent);
          dataVersionRef.current++;
        }
        break;
        
      case 'agentEnd':
        if (update.agent) {
          agentsRef.current.set(update.agent.agentId, update.agent);
          dataVersionRef.current++;
        }
        break;
        
      case 'runEnd':
        if (update.run && currentRunRef.current) {
          currentRunRef.current = {
            ...currentRunRef.current,
            ...update.run,
          };
          dataVersionRef.current++;
        }
        break;

      case 'runUpdate':
        if (update.run && currentRunRef.current) {
          currentRunRef.current = {
            ...currentRunRef.current,
            ...update.run,
          };
          dataVersionRef.current++;
        }
        break;
    }
  }, []); // No dependencies - uses refs for everything
  
  // WebSocket connection - completely stable, no dependencies
  useEffect(() => {
    isCleaningUpRef.current = false;
    
    const connect = () => {
      if (isCleaningUpRef.current) return;
      
      setConnectionStatus('connecting');
      
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      
      ws.onopen = () => {
        console.log('[WS] Connected');
        setConnectionStatus('connected');
        
        // Subscribe to all updates initially
        ws.send(JSON.stringify({ type: 'subscribeAll' }));
        
        // If we have a selected run, subscribe specifically
        const currentRunId = selectedRunIdRef.current;
        if (currentRunId) {
          ws.send(JSON.stringify({ type: 'subscribe', runId: currentRunId }));
        }
      };
      
      ws.onclose = () => {
        if (!isCleaningUpRef.current) {
          console.log('[WS] Disconnected');
          setConnectionStatus('disconnected');
          
          // Reconnect after 2 seconds
          reconnectTimeoutRef.current = window.setTimeout(connect, 2000);
        }
      };
      
      ws.onerror = (error) => {
        if (!isCleaningUpRef.current) {
          console.error('[WS] Error:', error);
          setConnectionStatus('disconnected');
        }
      };
      
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          if (message.type === 'trace') {
            handleTraceUpdate(message.data as TraceUpdate);
          } else if (message.type === 'connected') {
            console.log('[WS] Server confirmed connection');
          }
        } catch (err) {
          console.error('[WS] Failed to parse message:', err);
        }
      };
    };
    
    connect();
    
    return () => {
      isCleaningUpRef.current = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [handleTraceUpdate]);
  
  // Poll for runs separately
  useEffect(() => {
    refreshRuns();
    const pollInterval = setInterval(refreshRuns, 5000);
    return () => clearInterval(pollInterval);
  }, [refreshRuns]);
  
  // Load data when selected run changes
  useEffect(() => {
    if (selectedRunId) {
      loadRunData(selectedRunId);
    }
  }, [selectedRunId, loadRunData]);
  
  return {
    currentRunRef,
    agentsRef,
    spansRef,
    dataVersionRef,
    connectionStatus,
    recentRuns,
    selectedRunId,
    selectRun,
    refreshRuns,
  };
}
