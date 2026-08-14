import type { MetricSnapshot, Notification, ServerSpec } from '../types';
import { NOTIFICATION_TEMPLATES, TEMPLATE_SERVERS, CONTAINER_NAMES } from '../mock-data/notifications';
import { pick, randomInt } from './random';

let seq = 1;

/**
 * Derives realistic notifications from the live telemetry stream. Pure-ish:
 * reads snapshots, returns zero or more new notifications per tick.
 */
export class NotificationGenerator {
  private lastHighCpuAt: Record<string, number> = {};
  private lastTempWarnAt: Record<string, number> = {};
  private lastRandomAt = 0;

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

      // High temperature — every ~10 minutes
      if (snap.tempC > 70 && now - (this.lastTempWarnAt[snap.serverId] ?? 0) > 10 * MIN) {
        this.lastTempWarnAt[snap.serverId] = now;
        out.push(this.fromTemplate('Temperature high', snap.serverId, now, {
          '{temp}': String(Math.round(snap.tempC)),
          '{server}': snap.serverId,
        }));
      }
    }

    // Random ambient noise every 45-120s
    if (now - this.lastRandomAt > randomInt(Math.random, 45, 120) * 1000) {
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
