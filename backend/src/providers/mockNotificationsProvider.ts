import type { Notification } from '../types';
import type { NotificationsProvider } from './types';
import {
  getNotifications,
  getUnreadCount,
  insertNotification,
  markNotificationsRead,
  markAllNotificationsRead,
} from '../db/database';
import { SEED_NOTIFICATIONS } from '../mock-data/notifications';

/**
 * Mock notifications provider backed by SQLite. Seed data is written once at
 * boot; live notifications flow in from the generator via `ingest`.
 */
export class MockNotificationsProvider implements NotificationsProvider {
  private inMemory: Notification[] = [];

  constructor() {
    this.seedIfEmpty();
  }

  private seedIfEmpty(): void {
    const existing = getNotifications(1);
    if (existing.length > 0) return;

    const seed = SEED_NOTIFICATIONS.map((n) => ({ ...n }));
    for (const n of seed) {
      this.ingest(n);
    }
  }

  ingest(n: Notification): void {
    this.inMemory.unshift(n);
    if (this.inMemory.length > 50) this.inMemory.length = 50;

    insertNotification({
      id: n.id,
      title: n.title,
      message: n.message,
      severity: n.severity,
      timestamp: n.timestamp,
      read: n.read ? 1 : 0,
      server_id: n.serverId ?? null,
    });
  }

  list(limit: number, offset = 0): Notification[] {
    const recent = new Map<string, Notification>();
    for (const n of this.inMemory) recent.set(n.id, n);

    const rows = getNotifications(limit + this.inMemory.length, offset);
    const merged = rows
      .map((r) => ({
        id: r.id,
        title: r.title,
        message: r.message,
        severity: r.severity as Notification['severity'],
        timestamp: r.timestamp,
        read: r.read === 1,
        serverId: r.server_id ?? undefined,
      }))
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);

    return merged;
  }

  unreadCount(): number {
    return this.inMemory.filter((n) => !n.read).length + getUnreadCount();
  }

  markRead(ids: string[]): void {
    const set = new Set(ids);
    this.inMemory.forEach((n) => {
      if (set.has(n.id)) n.read = true;
    });
    markNotificationsRead(ids);
  }

  markAllRead(): void {
    this.inMemory.forEach((n) => (n.read = true));
    markAllNotificationsRead();
  }

  clear(): void {
    this.inMemory = [];
  }
}
