import type { MetricSnapshot, Notification, ServerSpec } from '../types';
import { NOTIFICATION_TEMPLATES, TEMPLATE_SERVERS, CONTAINER_NAMES } from '../mock-data/notifications';
import { pick, randomInt } from './random';
import { config } from '../config';

let seq = 1;

/**
 * Derives realistic notifications from the live telemetry stream. Pure-ish:
 * reads snapshots, returns zero or more new notifications per tick.
 */
export class NotificationGenerator {
  private lastHighCpuAt: Record<string, number> = {};
  private lastHighRamAt: Record<string, number> = {};
  private lastTempWarnAt: Record<string, number> = {};
  private lastDiskWarnAt: Record<string, number> = {};
  private lastDiskCritAt: Record<string, number> = {};
  private lastRandomAt = 0;
  private readonly ambient: boolean;

  constructor(options?: { ambient?: boolean }) {
    this.ambient = options?.ambient ?? config.mockMode;
  }

  generate(snapshots: MetricSnapshot[], now: number): Notification[] {
    const out: Notification[] = [];
    const MIN = 60_000;

    for (const snap of snapshots) {
      // High CPU — only re-fire every ~6 minutes per server
      if (snap.cpu > 88 && now - (this.lastHighCpuAt[snap.serverId] ?? 0) > 6 * MIN) {
        this.lastHighCpuAt[snap.serverId] = now;
        out.push(this.fromTemplate('High CPU', snap.serverId, now, {
          '{threshold}': '85',
          '{mins}': String(randomInt(Math.random, 3, 12)),
          '{workload}': TEMPLATE_SERVERS[snap.serverId]?.workload ?? 'a workload',
          '{server}': snap.serverId,
        }));
      }

      // High RAM — only re-fire every ~6 minutes per server
      if (snap.ramUsedGb > 0 && snap.ramTotalGb > 0) {
        const ramPct = (snap.ramUsedGb / snap.ramTotalGb) * 100;
        if (ramPct > 90 && now - (this.lastHighRamAt[snap.serverId] ?? 0) > 6 * MIN) {
          this.lastHighRamAt[snap.serverId] = now;
          out.push({
            id: `ntf-${now}-${seq++}`,
            title: 'High Memory Usage',
            message: `Memory usage on ${snap.serverId} reached ${Math.round(ramPct)}% (${snap.ramUsedGb.toFixed(1)} GB / ${snap.ramTotalGb.toFixed(1)} GB).`,
            severity: 'warning',
            timestamp: now,
            read: false,
            serverId: snap.serverId,
          });
        }
      }

      // High temperature — every ~10 minutes
      if (snap.tempC > 70 && now - (this.lastTempWarnAt[snap.serverId] ?? 0) > 10 * MIN) {
        this.lastTempWarnAt[snap.serverId] = now;
        out.push(this.fromTemplate('Temperature high', snap.serverId, now, {
          '{temp}': String(Math.round(snap.tempC)),
          '{server}': snap.serverId,
        }));
      }

      // Disk space — warn at >85%, critical at >95%
      if (snap.diskUsedGb > 0 && snap.diskTotalGb > 1) {
        const diskPct = (snap.diskUsedGb / snap.diskTotalGb) * 100;
        if (diskPct > 95 && now - (this.lastDiskCritAt[snap.serverId] ?? 0) > 30 * MIN) {
          this.lastDiskCritAt[snap.serverId] = now;
          out.push({
            id: `ntf-${now}-${seq++}`,
            title: 'Disk Space Critical',
            message: `Disk usage on ${snap.serverId} is critically high at ${Math.round(diskPct)}% (${snap.diskUsedGb.toFixed(1)} / ${snap.diskTotalGb.toFixed(1)} GB).`,
            severity: 'critical',
            timestamp: now,
            read: false,
            serverId: snap.serverId,
          });
        } else if (diskPct > 85 && now - (this.lastDiskWarnAt[snap.serverId] ?? 0) > 30 * MIN) {
          this.lastDiskWarnAt[snap.serverId] = now;
          out.push({
            id: `ntf-${now}-${seq++}`,
            title: 'Disk Space Warning',
            message: `Disk usage on ${snap.serverId} reached ${Math.round(diskPct)}% (${snap.diskUsedGb.toFixed(1)} / ${snap.diskTotalGb.toFixed(1)} GB).`,
            severity: 'warning',
            timestamp: now,
            read: false,
            serverId: snap.serverId,
          });
        }
      }
    }

    // Random ambient noise every 45-120s (simulation only — real providers
    // disable this so no fake mock-server notifications appear)
    if (
      this.ambient &&
      now - this.lastRandomAt > randomInt(Math.random, 45, 120) * 1000
    ) {
      this.lastRandomAt = now;
      const tpl = pick(Math.random, NOTIFICATION_TEMPLATES);
      const serverId = pick(Math.random, ['pve0', 'docker01', 'nas01', 'gateway', 'switch01']);
      const meta = TEMPLATE_SERVERS[serverId];
      out.push(
        this.fromTemplate(tpl.title, serverId, now, {
          '{server}': meta.name,
          '{image}': pick(Math.random, CONTAINER_NAMES),
          '{workload}': meta.workload,
          '{policy}': meta.policy,
          '{dur}': `${randomInt(Math.random, 2, 15)}m ${randomInt(Math.random, 0, 59)}s`,
          '{size}': pick(Math.random, ['412 MB', '1.2 GB', '780 MB', '2.4 GB']),
          '{pct}': String(randomInt(Math.random, 78, 96)),
          '{mins}': String(randomInt(Math.random, 3, 20)),
          '{host}': pick(Math.random, ['*.homelab.local', 'vaultwarden.homelab.local', 'immich.homelab.local']),
          '{n}': String(randomInt(Math.random, 1, 8)),
          '{rate}': `${randomInt(Math.random, 5, 60)}x`,
          '{country}': pick(Math.random, ['RU', 'CN', 'NL', 'US', 'BR']),
          '{dir}': pick(Math.random, ['inbound', 'outbound']),
        }),
      );
    }

    return out;
  }

  private fromTemplate(
    title: string,
    serverId: string | undefined,
    now: number,
    vars: Record<string, string>,
  ): Notification {
    const tpl = NOTIFICATION_TEMPLATES.find((t) => t.title === title);
    let message = tpl?.message ?? title;
    for (const [k, v] of Object.entries(vars)) message = message.replaceAll(k, v);

    return {
      id: `ntf-${now}-${seq++}`,
      title,
      message,
      severity: tpl?.severity ?? 'info',
      timestamp: now,
      read: false,
      serverId,
    };
  }
}
