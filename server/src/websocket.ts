/**
 * WebSocket Manager for Agent Observability
 * 
 * Handles real-time broadcasting of trace updates to connected clients.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { TraceUpdate, WsMessage } from './types.js';

interface ExtendedWebSocket extends WebSocket {
  isAlive?: boolean;
  subscribedRuns?: Set<string>;  // Runs this client is interested in
}

export class WebSocketManager {
  private wss: WebSocketServer;
  private clients: Set<ExtendedWebSocket> = new Set();
  private pingInterval: ReturnType<typeof setInterval>;

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws: ExtendedWebSocket) => {
      ws.isAlive = true;
      ws.subscribedRuns = new Set();
      this.clients.add(ws);
      
      console.log(`[WS] Client connected. Total: ${this.clients.size}`);

      // Send connection confirmation
      this.sendTo(ws, { type: 'connected', data: { clientCount: this.clients.size } });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleClientMessage(ws, msg);
        } catch {
          // Ignore malformed messages
        }
      });

      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        console.log(`[WS] Client disconnected. Total: ${this.clients.size}`);
      });

      ws.on('error', (err) => {
        console.error('[WS] Client error:', err.message);
        this.clients.delete(ws);
      });
    });

    // Ping clients every 30 seconds to detect dead connections
    this.pingInterval = setInterval(() => {
      this.clients.forEach((ws) => {
        if (ws.isAlive === false) {
          console.log('[WS] Terminating dead connection');
          this.clients.delete(ws);
          return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);
  }

  private handleClientMessage(ws: ExtendedWebSocket, msg: { type: string; runId?: string }): void {
    switch (msg.type) {
      case 'subscribe':
        // Client wants updates for a specific run
        if (msg.runId) {
          ws.subscribedRuns?.add(msg.runId);
          console.log(`[WS] Client subscribed to run: ${msg.runId}`);
        }
        break;
      case 'unsubscribe':
        if (msg.runId) {
          ws.subscribedRuns?.delete(msg.runId);
        }
        break;
      case 'subscribeAll':
        // Special marker to receive all updates
        ws.subscribedRuns?.add('*');
        break;
    }
  }

  private sendTo(ws: ExtendedWebSocket, message: WsMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /** Broadcast a trace update to relevant clients */
  broadcastTrace(update: TraceUpdate): void {
    const message: WsMessage = { type: 'trace', data: update };
    const messageStr = JSON.stringify(message);
    const toRemove: ExtendedWebSocket[] = [];

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        // Send if client subscribed to this run or to all runs
        const subs = client.subscribedRuns;
        if (!subs || subs.size === 0 || subs.has('*') || subs.has(update.runId)) {
          client.send(messageStr);
        }
      } else if (client.readyState === WebSocket.CLOSED || client.readyState === WebSocket.CLOSING) {
        toRemove.push(client);
      }
    }

    // Clean up closed connections
    for (const client of toRemove) {
      this.clients.delete(client);
    }
  }

  /** Broadcast a message to all clients */
  broadcast(type: string, data: unknown): void {
    const message = JSON.stringify({ type, data });
    const toRemove: ExtendedWebSocket[] = [];

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      } else if (client.readyState === WebSocket.CLOSED || client.readyState === WebSocket.CLOSING) {
        toRemove.push(client);
      }
    }

    for (const client of toRemove) {
      this.clients.delete(client);
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }

  close(): void {
    clearInterval(this.pingInterval);
    this.wss.close();
  }
}
