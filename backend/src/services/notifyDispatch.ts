import type { Notification, MetricSnapshot, ServerStatus } from '../types';
import { dispatchToChannels } from './integrations';
import { dispatchNotification } from './notificationBus';

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

      // Create a database notification record so it appears in the frontend panel
      const serverName = snap.serverId.replace(/-/g, ' ');
      if (curr === 'offline' && prev !== 'offline') {
        const n: Notification = {
          id: `ntf-server-offline-${snap.serverId}-${Date.now()}`,
          title: 'Server Offline',
          message: `${serverName} has gone OFFLINE.\nPrevious status: ${prev}`,
          severity: 'critical',
          timestamp: Date.now(),
          read: false,
          serverId: snap.serverId,
        };
        dispatchNotification(n);
        this.enqueue(() =>
          dispatchToChannels(
            `Server Offline`,
            `${serverName} has gone OFFLINE.\nPrevious status: ${prev}`,
            'critical',
          ).catch(() => {}),
        );
      } else if (curr === 'online' && prev === 'offline') {
        const n: Notification = {
          id: `ntf-server-online-${snap.serverId}-${Date.now()}`,
          title: 'Server Online',
          message: `${serverName} is back ONLINE.`,
          severity: 'success',
          timestamp: Date.now(),
          read: false,
          serverId: snap.serverId,
        };
        dispatchNotification(n);
        this.enqueue(() =>
          dispatchToChannels(
            `Server Online`,
            `${serverName} is back ONLINE.`,
            'success',
          ).catch(() => {}),
        );
      } else if (curr === 'degraded' && prev === 'online') {
        const n: Notification = {
          id: `ntf-server-degraded-${snap.serverId}-${Date.now()}`,
          title: 'Server Degraded',
          message: `${serverName} status changed to DEGRADED.`,
          severity: 'warning',
          timestamp: Date.now(),
          read: false,
          serverId: snap.serverId,
        };
        dispatchNotification(n);
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

  /* ------------------------------------------------------------------ */
  /* Infrastructure notifications                                       */
  /* ------------------------------------------------------------------ */

  notifyDockerContainerCrash(containerName: string, image: string): void {
    this.enqueue(() =>
      dispatchToChannels(
        `Container Crashed`,
        `Docker container "${containerName}" has stopped unexpectedly.\nImage: ${image}\nTime: ${new Date().toISOString()}`,
        'critical',
      ).catch(() => {}),
    );
  }

  notifyDockerContainerRestart(containerName: string, image: string): void {
    this.enqueue(() =>
      dispatchToChannels(
        `Container Restarted`,
        `Docker container "${containerName}" is back online.\nImage: ${image}\nTime: ${new Date().toISOString()}`,
        'success',
      ).catch(() => {}),
    );
  }

  notifyDiskWarning(serverName: string, diskPct: number, diskUsed: number, diskTotal: number): void {
    this.enqueue(() =>
      dispatchToChannels(
        `Disk Space Warning`,
        `${serverName} disk usage is at ${diskPct.toFixed(1)}% (${diskUsed.toFixed(1)} / ${diskTotal.toFixed(1)} GB).\nTime: ${new Date().toISOString()}`,
        'warning',
      ).catch(() => {}),
    );
  }

  notifyDiskCritical(serverName: string, diskPct: number, diskUsed: number, diskTotal: number): void {
    this.enqueue(() =>
      dispatchToChannels(
        `Disk Space Critical`,
        `${serverName} disk usage is critically high at ${diskPct.toFixed(1)}% (${diskUsed.toFixed(1)} / ${diskTotal.toFixed(1)} GB).\nImmediate action required.\nTime: ${new Date().toISOString()}`,
        'critical',
      ).catch(() => {}),
    );
  }

  notifySslExpiryWarning(hostname: string, daysLeft: number, expiresAt: string): void {
    this.enqueue(() =>
      dispatchToChannels(
        `SSL Certificate Expiring`,
        `SSL certificate for ${hostname} expires in ${daysLeft} day(s).\nExpiry date: ${expiresAt}\nTime: ${new Date().toISOString()}`,
        'warning',
      ).catch(() => {}),
    );
  }

  notifySslExpiryCritical(hostname: string, daysLeft: number, expiresAt: string): void {
    this.enqueue(() =>
      dispatchToChannels(
        `SSL Certificate Almost Expired`,
        `SSL certificate for ${hostname} expires in ${daysLeft} day(s).\nExpiry date: ${expiresAt}\nRenew immediately.\nTime: ${new Date().toISOString()}`,
        'critical',
      ).catch(() => {}),
    );
  }

  notifyBackupFailure(type: string, error: string): void {
    this.enqueue(() =>
      dispatchToChannels(
        `Backup Failed`,
        `Scheduled ${type} backup failed.\nError: ${error}\nTime: ${new Date().toISOString()}`,
        'critical',
      ).catch(() => {}),
    );
  }

  notifyProxmoxNodeOffline(nodeName: string): void {
    this.enqueue(() =>
      dispatchToChannels(
        `Proxmox Node Offline`,
        `Proxmox node "${nodeName}" is no longer responding.\nTime: ${new Date().toISOString()}`,
        'critical',
      ).catch(() => {}),
    );
  }

  notifyProxmoxNodeOnline(nodeName: string): void {
    this.enqueue(() =>
      dispatchToChannels(
        `Proxmox Node Online`,
        `Proxmox node "${nodeName}" is back online.\nTime: ${new Date().toISOString()}`,
        'success',
      ).catch(() => {}),
    );
  }

  notifyProxmoxStorageWarning(nodeName: string, storageName: string, usagePct: number): void {
    this.enqueue(() =>
      dispatchToChannels(
        `Proxmox Storage Warning`,
        `Storage "${storageName}" on node "${nodeName}" is at ${usagePct.toFixed(1)}% usage.\nTime: ${new Date().toISOString()}`,
        'warning',
      ).catch(() => {}),
    );
  }

  notifyProxmoxStorageCritical(nodeName: string, storageName: string, usagePct: number): void {
    this.enqueue(() =>
      dispatchToChannels(
        `Proxmox Storage Critical`,
        `Storage "${storageName}" on node "${nodeName}" is at ${usagePct.toFixed(1)}% usage.\nImmediate cleanup required.\nTime: ${new Date().toISOString()}`,
        'critical',
      ).catch(() => {}),
    );
  }

  notifyUptimeKumaDown(monitorName: string, url: string): void {
    this.enqueue(() =>
      dispatchToChannels(
        `Monitor Down`,
        `Uptime Kuma monitor "${monitorName}" is DOWN.\nURL: ${url}\nTime: ${new Date().toISOString()}`,
        'critical',
      ).catch(() => {}),
    );
  }

  notifyUptimeKumaUp(monitorName: string, url: string): void {
    this.enqueue(() =>
      dispatchToChannels(
        `Monitor Up`,
        `Uptime Kuma monitor "${monitorName}" is back UP.\nURL: ${url}\nTime: ${new Date().toISOString()}`,
        'success',
      ).catch(() => {}),
    );
  }
}

/** Singleton dispatcher instance shared across the application. */
export const notifyDispatcher = new NotifyDispatcher();
