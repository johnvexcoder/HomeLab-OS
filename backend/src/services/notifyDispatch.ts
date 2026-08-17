import type { Notification, MetricSnapshot, ServerStatus } from '../types';
import { dispatchToChannels } from './integrations';

/**
 * Central notification dispatcher. Routes notifications to external channels
 * (Telegram, Email) based on integration configuration. Also detects service
 * state transitions and generates notifications for login / settings events.
 */
class NotifyDispatcher {
  private prevStates = new Map<string, ServerStatus>();
  private queue: Promise<void> = Promise.resolve();
  private minIntervalMs = 2_000;
  private lastSendAt = 0;

  /** Rate-limited queue: ensures messages are sent sequentially with a minimum gap. */
  private enqueue(fn: () => Promise<void>): void {
    this.queue = this.queue.then(async () => {
      const elapsed = Date.now() - this.lastSendAt;
      if (elapsed < this.minIntervalMs) {
        await new Promise((r) => setTimeout(r, this.minIntervalMs - elapsed));
      }
      this.lastSendAt = Date.now();
      await fn();
    });
  }

  /** Dispatch a batch of notifications to Telegram + Email. */
  dispatchNotifications(notifications: Notification[]): void {
    for (const n of notifications) {
      if (n.severity === 'info') continue;
      this.enqueue(() =>
        dispatchToChannels(n.title, n.message, n.severity).catch(() => {}),
      );
    }
  }

  /** Check for server status transitions and dispatch notifications. */
  checkStateChanges(snapshots: MetricSnapshot[]): void {
    for (const snap of snapshots) {
      const prev = this.prevStates.get(snap.serverId);
      const curr = snap.status;
      this.prevStates.set(snap.serverId, curr);

      if (!prev || prev === curr) continue;

      const serverName = snap.serverId.replace(/-/g, ' ');
      if (curr === 'offline' && prev !== 'offline') {
        this.enqueue(() =>
          dispatchToChannels(
            `Server Offline`,
            `${serverName} has gone OFFLINE.\nPrevious status: ${prev}`,
            'critical',
          ).catch(() => {}),
        );
      } else if (curr === 'online' && prev === 'offline') {
        this.enqueue(() =>
          dispatchToChannels(
            `Server Online`,
            `${serverName} is back ONLINE.`,
            'success',
          ).catch(() => {}),
        );
      } else if (curr === 'degraded' && prev === 'online') {
        this.enqueue(() =>
          dispatchToChannels(
            `Server Degraded`,
            `${serverName} status changed to DEGRADED.`,
            'warning',
          ).catch(() => {}),
        );
      }
    }
  }

  /** Notify when a user logs in to the dashboard. */
  notifyLogin(username: string, ip: string, role: string): void {
    this.enqueue(() =>
      dispatchToChannels(
        `Dashboard Login`,
        `User "${username}" (${role}) logged in to the Dashboard.\nIP: ${ip}\nTime: ${new Date().toISOString()}`,
        'info',
      ).catch(() => {}),
    );
  }

  /** Notify when settings or config are changed in the dashboard. */
  notifySettingsChange(username: string, action: string, details: string): void {
    this.enqueue(() =>
      dispatchToChannels(
        `Dashboard Settings Changed`,
        `User "${username}" ${action}.\n${details}\nTime: ${new Date().toISOString()}`,
        'warning',
      ).catch(() => {}),
    );
  }

  /** Notify when a feature flag or integration is modified. */
  notifyConfigChange(username: string, target: string, details: string): void {
    this.enqueue(() =>
      dispatchToChannels(
        `Configuration Updated`,
        `User "${username}" updated ${target}.\n${details}\nTime: ${new Date().toISOString()}`,
        'warning',
      ).catch(() => {}),
    );
  }
}

/** Singleton dispatcher instance shared across the application. */
export const notifyDispatcher = new NotifyDispatcher();
