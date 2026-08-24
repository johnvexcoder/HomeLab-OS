import type { Notification, MetricSnapshot, ServerStatus } from '../types';
import { dispatchToChannels } from './integrations';
import { dispatchNotification } from './notificationBus';

/**
 * Format a timestamp as YYYY-MM-DD HH:mm:ss in the server's local timezone.
 * Single canonical format for all notification messages.
 */
export function fmtTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Format an elapsed duration in ms as e.g. "4m 46s" or "2h 03m" or "45s". */
export function fmtDuration(fromMs: number, toMs: number): string {
  const s = Math.max(0, Math.floor((toMs - fromMs) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/**
 * Central notification dispatcher. Routes notifications to external channels
 * (Telegram, Email) based on integration configuration. Also detects service
 * state transitions and generates notifications for login / settings events.
 *
 * State machine semantics:
 *   - Notifications fire ONLY on state transitions (never per polling cycle).
 *   - Agent heartbeat lost → OFFLINE. CRASHED is never claimed without
 *     actual crash evidence (e.g. Docker die/OOM events).
 *   - Recovery messages include real downtime computed from tracked state.
 */
class NotifyDispatcher {
  private prevStates = new Map<string, ServerStatus>();
  /** When each resource entered its current state (ms epoch), for duration calc. */
  private stateSince = new Map<string, number>();
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

  /** Check for server status transitions and dispatch notifications.
   *  Fires ONLY on real transitions — repeated polls in the same state are
   *  silently tracked, never re-notified. */
  checkStateChanges(snapshots: MetricSnapshot[]): void {
    const now = Date.now();
    for (const snap of snapshots) {
      const prev = this.prevStates.get(snap.serverId);
      const curr = snap.status;
      this.prevStates.set(snap.serverId, curr);

      // First observation: seed state silently (no notification on boot).
      if (!prev) {
        this.stateSince.set(snap.serverId, now);
        continue;
      }
      if (prev === curr) continue;

      const since = this.stateSince.get(snap.serverId) ?? now;
      this.stateSince.set(snap.serverId, now);
      const name = snap.serverId.replace(/-/g, ' ');

      // ── ONLINE → OFFLINE ────────────────────────────────────────
      // Agent heartbeat lost / host unreachable → OFFLINE. We do NOT
      // claim CRASHED here: losing contact is not evidence of a crash.
      if (curr === 'offline' && prev !== 'offline') {
        const message = [
          'Status: OFFLINE',
          `Resource: Server`,
          `Name: ${name}`,
          '',
          `Detected At:`,
          fmtTime(now),
          '',
          `Previous Status:`,
          prev === 'degraded' ? 'DEGRADED' : 'ONLINE',
          '',
          'Impact:',
          'The server is currently unreachable.',
          'Services running on it may be unavailable.',
          '',
          'Current Status:',
          'OFFLINE',
        ].join('\n');
        const n: Notification = {
          id: `ntf-server-offline-${snap.serverId}-${now}`,
          title: 'SERVER ALERT',
          message,
          severity: 'critical',
          timestamp: now,
          read: false,
          serverId: snap.serverId,
        };
        dispatchNotification(n);
        this.enqueue(() =>
          dispatchToChannels('SERVER ALERT', message, 'critical').catch(() => {}),
        );
      }
      // ── OFFLINE → ONLINE (recovery) ─────────────────────────────
      else if (curr === 'online' && prev === 'offline') {
        const downtime = fmtDuration(since, now);
        const message = [
          'Status: RECOVERED',
          `Resource: Server`,
          `Name: ${name}`,
          '',
          `Offline Since:`,
          fmtTime(since),
          '',
          `Recovered At:`,
          fmtTime(now),
          '',
          `Downtime: ${downtime}`,
          '',
          'Current Status:',
          'ONLINE',
        ].join('\n');
        const n: Notification = {
          id: `ntf-server-online-${snap.serverId}-${now}`,
          title: 'SERVER RECOVERED',
          message,
          severity: 'success',
          timestamp: now,
          read: false,
          serverId: snap.serverId,
        };
        dispatchNotification(n);
        this.enqueue(() =>
          dispatchToChannels('SERVER RECOVERED', message, 'success').catch(() => {}),
        );
      }
      // ── ONLINE → DEGRADED ───────────────────────────────────────
      else if (curr === 'degraded' && prev === 'online') {
        const conditions: string[] = [];
        if (snap.cpu > 85) conditions.push(`HIGH CPU USAGE\nCPU Usage:\n${Math.round(snap.cpu)}%\nThreshold:\n85%`);
        if (snap.tempC > 70) conditions.push(`HIGH TEMPERATURE\nTemperature:\n${Math.round(snap.tempC)}°C\nThreshold:\n70°C`);
        const ramPct = snap.ramTotalGb > 0 ? (snap.ramUsedGb / snap.ramTotalGb) * 100 : 0;
        if (ramPct > 90) conditions.push(`HIGH MEMORY USAGE\nMemory Usage:\n${Math.round(ramPct)}%\nThreshold:\n90%`);
        const conditionBlock = conditions.length > 0 ? conditions.join('\n\n') : 'RESOURCE THRESHOLD EXCEEDED';

        const message = [
          'Status: DEGRADED',
          `Resource: Server`,
          `Name: ${name}`,
          '',
          `Detected At:`,
          fmtTime(now),
          '',
          'Condition:',
          conditionBlock,
          '',
          `Previous Status:`,
          'ONLINE',
          '',
          'Current Status:',
          'DEGRADED',
        ].join('\n');
        const n: Notification = {
          id: `ntf-server-degraded-${snap.serverId}-${now}`,
          title: 'SERVER WARNING',
          message,
          severity: 'warning',
          timestamp: now,
          read: false,
          serverId: snap.serverId,
        };
        dispatchNotification(n);
        this.enqueue(() =>
          dispatchToChannels('SERVER WARNING', message, 'warning').catch(() => {}),
        );
      }
      // ── DEGRADED → ONLINE (problem recovery) ────────────────────
      else if (curr === 'online' && prev === 'degraded') {
        const duration = fmtDuration(since, now);
        const message = [
          'Status: RECOVERED',
          `Resource: Server`,
          `Name: ${name}`,
          '',
          `Issue Started At:`,
          fmtTime(since),
          '',
          `Resolved At:`,
          fmtTime(now),
          '',
          `Duration: ${duration}`,
          '',
          'Current Status:',
          'ONLINE',
        ].join('\n');
        const n: Notification = {
          id: `ntf-server-recov-${snap.serverId}-${now}`,
          title: 'SERVER RECOVERED',
          message,
          severity: 'success',
          timestamp: now,
          read: false,
          serverId: snap.serverId,
        };
        dispatchNotification(n);
        this.enqueue(() =>
          dispatchToChannels('SERVER RECOVERED', message, 'success').catch(() => {}),
        );
      }
    }
  }

  /** Notify when a user logs in to the dashboard. */
  notifyLogin(username: string, ip: string, role: string): void {
    this.enqueue(() =>
      dispatchToChannels(
        `Dashboard Login`,
        `User "${username}" (${role}) logged in to the Dashboard.\nIP: ${ip}\nDetected At: ${fmtTime(Date.now())}`,
        'info',
      ).catch(() => {}),
    );
  }

  /** Notify when settings or config are changed in the dashboard. */
  notifySettingsChange(username: string, action: string, details: string): void {
    this.enqueue(() =>
      dispatchToChannels(
        `Dashboard Settings Changed`,
        `User "${username}" ${action}.\n${details}\nDetected At: ${fmtTime(Date.now())}`,
        'warning',
      ).catch(() => {}),
    );
  }

  /** Notify when a feature flag or integration is modified. */
  notifyConfigChange(username: string, target: string, details: string): void {
    this.enqueue(() =>
      dispatchToChannels(
        `Configuration Updated`,
        `User "${username}" updated ${target}.\n${details}\nDetected At: ${fmtTime(Date.now())}`,
        'warning',
      ).catch(() => {}),
    );
  }

  /* ------------------------------------------------------------------ */
  /* Infrastructure notifications                                       */
  /* ------------------------------------------------------------------ */

  notifyDockerContainerCrash(containerName: string, image: string): void {
    // A container stop event alone is NOT proof of a crash (could be a
    // graceful stop). Report OFFLINE; only real crash evidence would
    // justify CRASHED wording.
    const message = [
      'Status: OFFLINE',
      'Resource: Container',
      `Name: ${containerName}`,
      '',
      `Detected At:`,
      fmtTime(Date.now()),
      '',
      'Previous Status:',
      'RUNNING',
      '',
      'Current Status:',
      'OFFLINE',
    ].join('\n');
    this.enqueue(() =>
      dispatchToChannels('SERVICE ALERT', message, 'critical').catch(() => {}),
    );
  }

  notifyDockerContainerRestart(containerName: string, image: string): void {
    const message = [
      'Status: RESTARTED',
      'Resource: Container',
      `Name: ${containerName}`,
      '',
      `Restart Detected At:`,
      fmtTime(Date.now()),
      '',
      'Previous Status:',
      'OFFLINE',
      '',
      'Current Status:',
      'ONLINE',
    ].join('\n');
    this.enqueue(() =>
      dispatchToChannels('SERVICE RECOVERED', message, 'success').catch(() => {}),
    );
  }

  notifyDiskWarning(serverName: string, diskPct: number, diskUsed: number, diskTotal: number): void {
    this.enqueue(() =>
      dispatchToChannels(
        `Disk Space Warning`,
        `${serverName} disk usage is at ${diskPct.toFixed(1)}% (${diskUsed.toFixed(1)} / ${diskTotal.toFixed(1)} GB).\nDetected At: ${fmtTime(Date.now())}`,
        'warning',
      ).catch(() => {}),
    );
  }

  notifyDiskCritical(serverName: string, diskPct: number, diskUsed: number, diskTotal: number): void {
    this.enqueue(() =>
      dispatchToChannels(
        `Disk Space Critical`,
        `${serverName} disk usage is critically high at ${diskPct.toFixed(1)}% (${diskUsed.toFixed(1)} / ${diskTotal.toFixed(1)} GB).\nImmediate action required.\nDetected At: ${fmtTime(Date.now())}`,
        'critical',
      ).catch(() => {}),
    );
  }

  notifySslExpiryWarning(hostname: string, daysLeft: number, expiresAt: string): void {
    this.enqueue(() =>
      dispatchToChannels(
        `SSL Certificate Expiring`,
        `SSL certificate for ${hostname} expires in ${daysLeft} day(s).\nExpiry date: ${expiresAt}\nDetected At: ${fmtTime(Date.now())}`,
        'warning',
      ).catch(() => {}),
    );
  }

  notifySslExpiryCritical(hostname: string, daysLeft: number, expiresAt: string): void {
    this.enqueue(() =>
      dispatchToChannels(
        `SSL Certificate Almost Expired`,
        `SSL certificate for ${hostname} expires in ${daysLeft} day(s).\nExpiry date: ${expiresAt}\nRenew immediately.\nDetected At: ${fmtTime(Date.now())}`,
        'critical',
      ).catch(() => {}),
    );
  }

  notifyBackupFailure(type: string, error: string): void {
    this.enqueue(() =>
      dispatchToChannels(
        `Backup Failed`,
        `Scheduled ${type} backup failed.\nError: ${error}\nDetected At: ${fmtTime(Date.now())}`,
        'critical',
      ).catch(() => {}),
    );
  }

  notifyProxmoxNodeOffline(nodeName: string): void {
    this.enqueue(() =>
      dispatchToChannels(
        `Proxmox Node Offline`,
        `Proxmox node "${nodeName}" is no longer responding.\nDetected At: ${fmtTime(Date.now())}`,
        'critical',
      ).catch(() => {}),
    );
  }

  notifyProxmoxNodeOnline(nodeName: string): void {
    this.enqueue(() =>
      dispatchToChannels(
        `Proxmox Node Online`,
        `Proxmox node "${nodeName}" is back online.\nDetected At: ${fmtTime(Date.now())}`,
        'success',
      ).catch(() => {}),
    );
  }

  notifyProxmoxStorageWarning(nodeName: string, storageName: string, usagePct: number): void {
    this.enqueue(() =>
      dispatchToChannels(
        `Proxmox Storage Warning`,
        `Storage "${storageName}" on node "${nodeName}" is at ${usagePct.toFixed(1)}% usage.\nDetected At: ${fmtTime(Date.now())}`,
        'warning',
      ).catch(() => {}),
    );
  }

  notifyProxmoxStorageCritical(nodeName: string, storageName: string, usagePct: number): void {
    this.enqueue(() =>
      dispatchToChannels(
        `Proxmox Storage Critical`,
        `Storage "${storageName}" on node "${nodeName}" is at ${usagePct.toFixed(1)}% usage.\nImmediate cleanup required.\nDetected At: ${fmtTime(Date.now())}`,
        'critical',
      ).catch(() => {}),
    );
  }

  notifyUptimeKumaDown(monitorName: string, url: string): void {
    this.enqueue(() =>
      dispatchToChannels(
        `Monitor Down`,
        `Uptime Kuma monitor "${monitorName}" is DOWN.\nURL: ${url}\nDetected At: ${fmtTime(Date.now())}`,
        'critical',
      ).catch(() => {}),
    );
  }

  notifyUptimeKumaUp(monitorName: string, url: string): void {
    this.enqueue(() =>
      dispatchToChannels(
        `Monitor Up`,
        `Uptime Kuma monitor "${monitorName}" is back UP.\nURL: ${url}\nDetected At: ${fmtTime(Date.now())}`,
        'success',
      ).catch(() => {}),
    );
  }
}

/** Singleton dispatcher instance shared across the application. */
export const notifyDispatcher = new NotifyDispatcher();
