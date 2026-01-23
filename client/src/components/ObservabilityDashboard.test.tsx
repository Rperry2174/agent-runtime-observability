/**
 * Tests for ObservabilityDashboard
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { ObservabilityDashboard } from './ObservabilityDashboard';

// Mock WebSocket
class MockWebSocket {
  static OPEN = 1;
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  
  constructor() {
    setTimeout(() => this.onopen?.(), 0);
  }
  
  send = vi.fn();
  close = vi.fn();
}

// Mock fetch
const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.stubGlobal('fetch', mockFetch);
  
  // Default responses
  mockFetch.mockImplementation((url: string) => {
    if (url.includes('/api/runs') && !url.includes('/spans')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([]),
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ spans: [], agents: [] }),
    });
  });
});

describe('ObservabilityDashboard', () => {
  const renderDashboard = () => {
    return render(
      <BrowserRouter>
        <ObservabilityDashboard />
      </BrowserRouter>
    );
  };

  it('should render the header with CodeMap branding', () => {
    renderDashboard();
    expect(screen.getByText('CodeMap')).toBeDefined();
    expect(screen.getByText('Observability')).toBeDefined();
  });

  it('should show empty state when no runs', () => {
    renderDashboard();
    expect(screen.getByText('No runs yet')).toBeDefined();
  });

  it('should have a Run Demo button', () => {
    renderDashboard();
    // There are two demo buttons - one in header, one in empty state
    const demoButtons = screen.getAllByText(/Run Demo/);
    expect(demoButtons.length).toBeGreaterThan(0);
  });
});

describe('Types', () => {
  it('should export tool category helper', async () => {
    const { getToolCategory, TOOL_COLORS } = await import('../types');
    
    expect(getToolCategory('Read')).toBe('read');
    expect(getToolCategory('Write')).toBe('write');
    expect(getToolCategory('Edit')).toBe('edit');
    expect(getToolCategory('Grep')).toBe('search');
    expect(getToolCategory('Shell')).toBe('shell');
    expect(getToolCategory('Task')).toBe('task');
    expect(getToolCategory('mcp:github/test')).toBe('mcp');
    expect(getToolCategory('Thinking')).toBe('thinking');
    expect(getToolCategory('ContextCompact')).toBe('system');
    expect(getToolCategory('unknown')).toBe('other');
    
    expect(TOOL_COLORS.read).toBeDefined();
    expect(TOOL_COLORS.write).toBeDefined();
    expect(TOOL_COLORS.edit).toBeDefined();
    expect(TOOL_COLORS.thinking).toBeDefined();
  });
});
