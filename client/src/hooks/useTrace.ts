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

const WS_URL = 'ws://localhost:5174/ws';
const API_URL = 'http://localhost:5174/api';

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

export function useTrace(): UseTraceResult {
  // Refs for high-frequency data (no re-renders)
  const currentRunRef = useRef<RunDetails | null>(null);
  const agentsRef = useRef<Map<string, Agent>>(new Map());
  const spansRef = useRef<Span[]>([]);
  const dataVersionRef = useRef(0);
  
  // State for UI components that need re-renders
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [recentRuns, setRecentRuns] = useState<RunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  
  // WebSocket ref
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number>();
  
  // Fetch recent runs
  const refreshRuns = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/runs`);
      const runs: RunSummary[] = await res.json();
      setRecentRuns(runs);
      
      // Auto-select the most recent running run, or the first run
      if (!selectedRunId && runs.length > 0) {
        const runningRun = runs.find(r => r.status === 'running');
        setSelectedRunId(runningRun?.runId || runs[0].runId);
      }
    } catch (err) {
      console.error('Failed to fetch runs:', err);
    }
  }, [selectedRunId]);
  
  // Load spans for a specific run
  const loadRunData = useCallback(async (runId: string) => {
    try {
      // Fetch run details
      const detailsRes = await fetch(`${API_URL}/runs/${runId}`);
      if (!detailsRes.ok) return;
      const details: RunDetails = await detailsRes.json();
      
      // Fetch spans
      const spansRes = await fetch(`${API_URL}/runs/${runId}/spans`);
      if (!spansRes.ok) return;
      const spansData: SpanListResponse = await spansRes.json();
      
      // Update refs
      currentRunRef.current = details;
      agentsRef.current = new Map(details.agents.map(a => [a.agentId, a]));
      spansRef.current = spansData.spans;
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
    if (selectedRunId && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'unsubscribe', runId: selectedRunId }));
    }
    
    setSelectedRunId(runId);
    loadRunData(runId);
  }, [selectedRunId, loadRunData]);
  
  // Handle WebSocket trace updates
  const handleTraceUpdate = useCallback((update: TraceUpdate) => {
    // Only process updates for the selected run
    if (update.runId !== selectedRunId) {
      // But refresh the runs list on new run events
      if (update.type === 'runStart' || update.type === 'runEnd') {
        refreshRuns();
      }
      return;
    }
    
    switch (update.type) {
      case 'spanStart':
        if (update.span) {
          spansRef.current = [...spansRef.current, update.span];
          dataVersionRef.current++;
        }
        break;
        
      case 'spanEnd':
      case 'spanUpdate':
        if (update.span) {
          spansRef.current = spansRef.current.map(s =>
            s.spanId === update.span!.spanId ? update.span! : s
          );
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
    }
  }, [selectedRunId, refreshRuns]);
  
  // WebSocket connection
  const connect = useCallback(() => {
    setConnectionStatus('connecting');
    
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    
    ws.onopen = () => {
      console.log('[WS] Connected');
      setConnectionStatus('connected');
      
      // Subscribe to all updates initially
      ws.send(JSON.stringify({ type: 'subscribeAll' }));
      
      // If we have a selected run, subscribe specifically
      if (selectedRunId) {
        ws.send(JSON.stringify({ type: 'subscribe', runId: selectedRunId }));
      }
    };
    
    ws.onclose = () => {
      console.log('[WS] Disconnected');
      setConnectionStatus('disconnected');
      
      // Reconnect after 2 seconds
      reconnectTimeoutRef.current = window.setTimeout(connect, 2000);
    };
    
    ws.onerror = (error) => {
      console.error('[WS] Error:', error);
      setConnectionStatus('disconnected');
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
  }, [selectedRunId, handleTraceUpdate]);
  
  // Initialize
  useEffect(() => {
    refreshRuns();
    connect();
    
    // Poll for new runs periodically
    const pollInterval = setInterval(refreshRuns, 5000);
    
    return () => {
      clearInterval(pollInterval);
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect, refreshRuns]);
  
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
