import { TelemetryEngine } from '../telemetry/engine';
import { NotificationGenerator } from '../telemetry/notification-generator';
import { insertMetrics, queryMetrics } from '../db/database';
import { SERVER_SPECS } from '../mock-data/servers';
import type { MetricSnapshot, Notification } from '../types';
import { config } from '../config';
import { round } from '../telemetry/random';

export type TickListener = (snapshots: MetricSnapshot[]) => void;
export type NotificationListener = (notifications: Notification[]) => void;

/**
 * Wires the mock engine + notification generator + SQLite persistence together
 * and runs the live loop. In real-integration mode this module stays; only the
 * engine internals get replaced by API-backed providers.
 */
export class Simulator {
  readonly engine: TelemetryEngine;
  readonly notificationGenerator = new NotificationGenerator();

  private tickListeners: TickListener[] = [];
  private notificationListeners: NotificationListener[] = [];
  private interval: NodeJS.Timeout | null = null;
  private lastTickAt = Date.now();

  constructor() {
    this.engine = new TelemetryEngine();
  }

  onTick(listener: TickListener): void {
    this.tickListeners.push(listener);
  }

  onNotifications(listener: NotificationListener): void {
    this.notificationListeners.push(listener);
  }

  start(): void {
    if (this.interval) return;
    this.interval = setInterval(() => {
      const now = Date.now();
      const elapsedSec = Math.max(1, (now - this.lastTickAt) / 1000);
      this.lastTickAt = now;

      const snapshots = this.engine.tick(elapsedSec);

      // Persist to SQLite for the history/chart endpoints.
      insertMetrics(snapshots);

      // Derive notifications from the new telemetry.
      const notifications = this.notificationGenerator.generate(snapshots, now);

      this.tickListeners.forEach((l) => l(snapshots));
      if (notifications.length > 0) {
        this.notificationListeners.forEach((l) => l(notifications));
      }
    }, config.telemetryIntervalMs);

    // Don't hold the process open in tests/scripts.
    if (typeof this.interval.unref === 'function') this.interval.unref();
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }
}

/**
 * Backfill realistic history so charts have data before the app has been running.
 * Generates HISTORY_RETENTION_HOURS of data at 30s granularity in a single tx.
 */
export function seedHistory(db: { insertMetrics: typeof insertMetrics; queryMetrics: typeof queryMetrics }): number {
  const rowsPerServer = Math.floor((config.historyRetentionHours * 3600) / 30);
  const now = Date.now();
  let count = 0;

  const step = 30 * 1000;

  for (const spec of SERVER_SPECS) {
    const p = spec.profile;
    const uptime = 90 * 86400;
    for (let i = rowsPerServer; i >= 0; i--) {
      const ts = now - i * step;
      const phase = Math.sin(ts / 900000 + spec.id.length);
      const cpu = round(Math.min(100, Math.max(1, p.baseCpu + phase * p.cpuAmplitude + (Math.random() - 0.5) * p.cpuNoise * 2)), 1);
      const ramUsed = p.baseRamGb + Math.sin(ts / 7200000) * p.ramDriftGb + (Math.random() - 0.5) * 1.5;
      const diskUsed = spec.diskTotalGb * (0.4 + (Math.random() - 0.5) * 0.02);
      const temp = p.baseTemp + cpu * 0.1 + (Math.random() - 0.5) * p.tempVariance;
      const netUp = Math.max(0, p.baseNetUpMbps * (0.7 + Math.random() * 0.6));
      const netDown = Math.max(0, p.baseNetDownMbps * (0.7 + Math.random() * 0.6));
      const load = (cpu / 100) * spec.cpuCores * 0.7;

      db.insertMetrics([
        {
          serverId: spec.id,
          timestamp: ts,
          cpu,
          cpuCores: spec.cpuCores,
          ramUsedGb: round(ramUsed, 2),
          ramTotalGb: spec.ramTotalGb,
          diskUsedGb: round(diskUsed, 1),
          diskTotalGb: spec.diskTotalGb,
          tempC: round(temp, 1),
          netUpMbps: round(netUp, 0),
          netDownMbps: round(netDown, 0),
          load: round(load, 2),
          uptimeSeconds: uptime + i * 30,
          processes: p.processes,
          status: 'online',
          reachability: 'accessible',
          health: 98,
          sensors: [],
        },
      ]);
      count++;
    }
  }

  return count;
}
