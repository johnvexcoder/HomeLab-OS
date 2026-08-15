import type { MetricSnapshot, Notification } from '@/types';
import { useTelemetryStore } from '@/store/telemetry';
import { useNotificationStore } from '@/store/notifications';

const WS_URL = (import.meta.env.VITE_WS_URL ?? '').trim() || (() => {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
})();

const MAX_BACKOFF_MS = 15_000;
const INITIAL_BACKOFF_MS = 750;

type WsMessage =
  | { type: 'connected'; data: { timestamp: number } }
  | { type: 'telemetry'; data: MetricSnapshot[] }
  | { type: 'notifications'; data: Notification[] }
  | { type: 'ping'; data: { ts: number } }
  | { type: 'pong' };

let socket: WebSocket | null = null;
let reconnectTimer: number | undefined;
let reconnectDelay = INITIAL_BACKOFF_MS;
let running = true;

export type WsStatus = 'connecting' | 'open' | 'closed' | 'reconnecting';

const listeners = new Set<(status: WsStatus) => void>();

export function subscribeWs(cb: (status: WsStatus) => void): () => void {
  listeners.add(cb);
  cb(currentStatus());
  return () => listeners.delete(cb);
}

function currentStatus(): WsStatus {
  if (!running) return 'closed';
  if (!socket) return 'connecting';
  if (socket.readyState === WebSocket.OPEN) return 'open';
  if (socket.readyState === WebSocket.CONNECTING) return 'connecting';
  return 'reconnecting';
}

function emit(status: WsStatus): void {
  listeners.forEach((cb) => cb(status));
}

/**
 * Singleton connection: safe to call multiple times (StrictMode double-mount,
 * route changes, etc.) — only one socket is ever created.
 */
export function connectWs(): void {
  running = true;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  if (reconnectTimer !== undefined) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }
  open();
}

function open(): void {
  if (!running) return;

  const ws = new WebSocket(WS_URL);
  socket = ws;
  emit('connecting');

  ws.onopen = () => {
    if (ws !== socket) return; // a newer socket took over
    reconnectDelay = INITIAL_BACKOFF_MS;
    emit('open');
  };

  ws.onmessage = (event) => {
    if (ws !== socket) return;
    try {
      const msg = JSON.parse(event.data as string) as WsMessage;

      // App-level heartbeat echo (see backend/src/ws).
      if (msg.type === 'ping') {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
        return;
      }

      if (msg.type === 'telemetry') {
        useTelemetryStore.getState().applySnapshots(msg.data);
      } else if (msg.type === 'notifications') {
        useNotificationStore.getState().ingest(msg.data);
      }
    } catch {
      // ignore malformed frames
    }
  };

  ws.onclose = () => {
    if (ws !== socket) return; // stale close from an older socket
    socket = null;
    if (!running) return;
    emit('reconnecting');
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = undefined;
      open();
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_BACKOFF_MS);
  };

  ws.onerror = () => {
    // The close handler owns reconnection; just make sure it fires.
    if (ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
      ws.close();
    }
  };
}

export function disconnectWs(): void {
  running = false;
  if (reconnectTimer !== undefined) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }
  const s = socket;
  socket = null;
  if (s) {
    s.onclose = null;
    s.close();
  }
  emit('closed');
}

/** Reconnect immediately if the tab becomes visible and we dropped offline. */
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) connectWs();
  });
}
