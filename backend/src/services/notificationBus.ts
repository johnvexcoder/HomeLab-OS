import type { Notification } from '../types';

/**
 * Shared notification bus — allows any module (agent routes, providers, etc.)
 * to dispatch notifications to the database, external channels, and WebSocket clients.
 *
 * Wiring happens once in bootstrap() via register().
 */
type IngestFn = (n: Notification) => void;
type DispatchFn = (items: Notification[]) => void;
type WsFn = (items: Notification[]) => void;

let ingestFn: IngestFn | null = null;
let dispatchFn: DispatchFn | null = null;
let wsFn: WsFn | null = null;

/** Wire the bus to the active providers. Called once during bootstrap. */
export function registerNotificationBus(
  ingest: IngestFn,
  dispatch: DispatchFn,
  broadcast: WsFn,
): void {
  ingestFn = ingest;
  dispatchFn = dispatch;
  wsFn = broadcast;
}

/**
 * Push a notification to the database, Telegram/Email, and WebSocket clients.
 * Safe to call before wiring — notifications are dropped silently if not wired yet.
 */
export function dispatchNotification(n: Notification): void {
  ingestFn?.(n);
  dispatchFn?.([n]);
  wsFn?.([n]);
}
