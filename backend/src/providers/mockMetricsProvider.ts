import type {
  BootStats,
  ClusterInfo,
  GlobalHealth,
  NetworkLink,
  NetworkNode,
  Notification,
  QuickStat,
  ServerRuntime,
} from '../types';
import type { HistoryPoint, HistoryRange, StatsHistoryPoint } from './types';
import { TelemetryEngine } from '../telemetry/engine';
import { NotificationGenerator } from '../telemetry/notification-generator';
import { queryMetrics, insertMetrics, countMetrics } from '../db/database';
import { SERVER_SPECS, CLUSTER_NAMES } from '../mock-data/servers';
import { clamp, round } from '../telemetry/random';

const RANGE_MINUTES: Record<HistoryRange, number> = {
  '15m': 15,
  '1h': 60,
  '6h': 360,
  '24h': 1440,
};

const TARGET_POINTS = 120;

/**
 * Mock implementation of MetricsProvider. Reads from the live simulation engine
 * and the SQLite history store. Swapping this for real integrations keeps the
 * whole API surface identical.
 */
export class MockMetricsProvider {
  constructor(readonly engine: TelemetryEngine) {}

  getServers(): ServerRuntime[] {
    return [...this.engine.servers.values()];
  }

  getServer(id: string): ServerRuntime | undefined {
    return this.engine.servers.get(id);
  }

  getHistory(serverId: string, range: HistoryRange): HistoryPoint[] {
    const now = Date.now();
    const from = now - RANGE_MINUTES[range] * 60_000;
    const rows = queryMetrics(serverId, from, now);

    if (rows.length === 0) return [];

    // Bucket raw rows into TARGET_POINTS by averaging.
    const bucketSize = Math.max(1, Math.ceil(rows.length / TARGET_POINTS));
    const buckets: HistoryPoint[] = [];

    for (let i = 0; i < rows.length; i += bucketSize) {
      const slice = rows.slice(i, i + bucketSize);
      const sum = (fn: (r: (typeof rows)[number]) => number) =>
        slice.reduce((acc, r) => acc + fn(r), 0) / slice.length;

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

  /** Dashboard-wide sparklines: aggregates every server's history into one series. */
  getStatsHistory(range: HistoryRange): StatsHistoryPoint[] {
    const now = Date.now();
    const from = now - RANGE_MINUTES[range] * 60_000;
    const servers = this.getServers();

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

  getGlobalHealth(): GlobalHealth {
    const servers = this.getServers();
    const online = servers.filter((s) => s.status === 'online').length;
    const degraded = servers.filter((s) => s.status === 'degraded').length;
    const offline = servers.filter((s) => s.status === 'offline').length;

    const avgCpu = servers.length ? servers.reduce((a, s) => a + s.cpu, 0) / servers.length : 0;
    const avgRam = servers.length
      ? servers.reduce((a, s) => a + (s.ramUsedGb / s.spec.ramTotalGb) * 100, 0) / servers.length
      : 0;

    const score = servers.length
      ? servers.reduce((a, s) => a + s.health, 0) / servers.length
      : 0;

    return {
      score: round(clamp(score, 0, 100), 1),
      status: offline > 0 ? 'offline' : degraded > 0 ? 'degraded' : 'online',
      totalServers: servers.length,
      onlineServers: online,
      degradedServers: degraded,
      offlineServers: offline,
      activeAlerts: 0,
      avgCpu: round(avgCpu, 1),
      avgRam: round(avgRam, 1),
      totalUptimePercent: round(
        servers.length
          ? (servers.reduce((a, s) => a + (s.status === 'online' ? 1 : s.status === 'degraded' ? 0.6 : 0), 0) / servers.length) * 100
          : 0,
        1,
      ),
    };
  }

  getQuickStats(): QuickStat[] {
    const h = this.getGlobalHealth();
    const servers = this.getServers();
    const totalUptimeDays = servers.reduce((a, s) => a + s.uptimeSeconds / 86400, 0);
    const totalRamUsed = servers.reduce((a, s) => a + s.ramUsedGb, 0);
    const totalRam = servers.reduce((a, s) => a + s.spec.ramTotalGb, 0);
    const totalNet = servers.reduce((a, s) => a + s.netDownMbps, 0);
    const containers = servers.reduce((a, s) => a + s.spec.profile.containers, 0);

    return [
      { id: 'servers', label: 'Servers', value: h.totalServers, unit: '', delta: 0, tone: 'neutral' },
      { id: 'online', label: 'Online', value: h.onlineServers, unit: '', delta: 0, tone: 'good' },
      { id: 'containers', label: 'Containers', value: containers, unit: '', delta: 2, tone: 'neutral' },
      { id: 'cpu', label: 'Avg CPU', value: h.avgCpu, unit: '%', delta: 1.2, tone: h.avgCpu > 70 ? 'warn' : 'good' },
      { id: 'ram', label: 'Memory', value: round((totalRamUsed / totalRam) * 100, 1), unit: '%', delta: 0.4, tone: 'good' },
      { id: 'network', label: 'Network', value: round(totalNet / 1000, 1), unit: 'Gb/s', delta: -3.1, tone: 'neutral' },
      { id: 'uptime', label: 'Uptime', value: round(totalUptimeDays, 0), unit: 'days', delta: 0.1, tone: 'good' },
    ];
  }

  getNetwork(): { nodes: NetworkNode[]; links: NetworkLink[] } {
    return this.engine.getNetwork();
  }

  /** Aggregate the fleet into clusters. Standalone nodes (no clusterId) are excluded. */
  getClusters(): ClusterInfo[] {
    const byCluster = new Map<string, ServerRuntime[]>();
    for (const srv of this.getServers()) {
      const clusterId = srv.spec.clusterId;
      if (!clusterId) continue;
      const list = byCluster.get(clusterId) ?? [];
      list.push(srv);
      byCluster.set(clusterId, list);
    }

    return [...byCluster.entries()].map(([id, members]) => {
      const online = members.filter((s) => s.status === 'online').length;
      const degraded = members.filter((s) => s.status === 'degraded').length;
      const offline = members.length - online - degraded;
      const health = round(members.reduce((a, s) => a + s.health, 0) / members.length, 1);

      return {
        id,
        name: CLUSTER_NAMES[id] ?? id,
        serverIds: members.map((s) => s.spec.id),
        status: offline > 0 ? 'offline' : degraded > 0 ? 'degraded' : 'online',
        health,
        online,
        degraded,
        offline,
      };
    });
  }

  getBootStats(): BootStats {
    return {
      historySeeded: true,
      historyPoints: countMetrics(),
      startedAt: this.bootStartedAt,
    };
  }

  private readonly bootStartedAt = Date.now();
}
