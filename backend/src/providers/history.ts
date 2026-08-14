import { queryMetrics, type MetricRow } from '../db/database';
import type { ServerRuntime } from '../types';
import type { HistoryPoint, HistoryRange, StatsHistoryPoint } from './types';
import { round } from '../telemetry/random';

export const RANGE_MINUTES: Record<HistoryRange, number> = {
  '15m': 15,
  '1h': 60,
  '6h': 360,
  '24h': 1440,
};

const TARGET_POINTS = 120;

/**
 * Shared SQLite-backed history helpers used by every provider. Metrics are
 * persisted per tick (simulated or real), so chart endpoints always read the
 * same bucketed series regardless of the active data source.
 */

/** Bucket raw metric rows into TARGET_POINTS averaged points for charting. */
export function bucketHistory(rows: MetricRow[]): HistoryPoint[] {
  if (rows.length === 0) return [];

  const bucketSize = Math.max(1, Math.ceil(rows.length / TARGET_POINTS));
  const buckets: HistoryPoint[] = [];

  for (let i = 0; i < rows.length; i += bucketSize) {
    const slice = rows.slice(i, i + bucketSize);
    const sum = (fn: (r: MetricRow) => number) => slice.reduce((acc, r) => acc + fn(r), 0) / slice.length;

    buckets.push({
      ts: slice[0].ts,
      cpu: round(sum((r) => r.cpu), 1),
      ram: round(sum((r) => (r.ram_used_gb / r.ram_total_gb) * 100), 1),
      disk: round(sum((r) => (r.disk_used_gb / r.disk_total_gb) * 100), 1),
      temp: round(sum((r) => r.temp_c), 1),
      netUp: round(sum((r) => r.net_up_mbps), 0),
      netDown: round(sum((r) => r.net_down_mbps), 0),
      load: round(sum((r) => r.load), 2),
    });
  }

  return buckets;
}

/** History for a single server over a range, straight from SQLite. */
export function historyForServer(serverId: string, range: HistoryRange): HistoryPoint[] {
  const now = Date.now();
  const from = now - RANGE_MINUTES[range] * 60_000;
  return bucketHistory(queryMetrics(serverId, from, now));
}

/** Dashboard-wide sparklines: aggregates every server's history into one series. */
export function statsHistoryFor(range: HistoryRange, servers: ServerRuntime[]): StatsHistoryPoint[] {
  const now = Date.now();
  const from = now - RANGE_MINUTES[range] * 60_000;

  const nBuckets = 60;
  const bucketMs = Math.max(1, Math.ceil((RANGE_MINUTES[range] * 60_000) / nBuckets));
  const buckets = Array.from({ length: nBuckets }, (_, i) => ({
    ts: from + i * bucketMs,
    cpu: [] as number[],
    ram: [] as number[],
    netDown: [] as number[],
  }));

  for (const server of servers) {
    const rows = queryMetrics(server.spec.id, from, now);
    for (const row of rows) {
      const idx = Math.min(nBuckets - 1, Math.floor((row.ts - from) / bucketMs));
      if (idx < 0) continue;
      const bucket = buckets[idx];
      bucket.cpu.push(row.cpu);
      bucket.ram.push(row.ram_total_gb > 0 ? (row.ram_used_gb / row.ram_total_gb) * 100 : 0);
      bucket.netDown.push(row.net_down_mbps);
    }
  }

  const totalContainers = servers.reduce((a, s) => a + s.spec.profile.containers, 0);
  let lastCpu = 0;
  let lastRam = 0;
  let lastNet = 0;

  return buckets.map((bucket) => {
    const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
    if (bucket.cpu.length > 0) lastCpu = round(avg(bucket.cpu), 1);
    if (bucket.ram.length > 0) lastRam = round(avg(bucket.ram), 1);
    if (bucket.netDown.length > 0) lastNet = round(sum(bucket.netDown), 0);
    return {
      ts: bucket.ts,
      cpu: lastCpu,
      mem: lastRam,
      network: lastNet,
      containers: totalContainers,
    };
  });
}
