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
import type { HistoryPoint, HistoryRange, StatsHistoryPoint, DockerHostProfile } from './types';
import type { MetricsProvider } from './types';
import { TelemetryEngine } from '../telemetry/engine';
import { NotificationGenerator } from '../telemetry/notification-generator';
import { countMetrics } from '../db/database';
import { SERVER_SPECS, CLUSTER_NAMES } from '../mock-data/servers';
import { clamp, round } from '../telemetry/random';
import { historyForServer, statsHistoryFor } from './history';

/**
 * Mock implementation of MetricsProvider. Reads from the live simulation engine
 * and the SQLite history store. Swapping this for real integrations keeps the
 * whole API surface identical.
 */
export class MockMetricsProvider implements MetricsProvider {
  constructor(readonly engine: TelemetryEngine) {}

  getServers(): ServerRuntime[] {
    return [...this.engine.servers.values()];
  }

  getServer(id: string): ServerRuntime | undefined {
    return this.engine.servers.get(id);
  }

  getHistory(serverId: string, range: HistoryRange): HistoryPoint[] {
    return historyForServer(serverId, range);
  }

  /** Dashboard-wide sparklines: aggregates every server's history into one series. */
  getStatsHistory(range: HistoryRange): StatsHistoryPoint[] {
    return statsHistoryFor(range, this.getServers());
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
    const totalUptimeSeconds = servers.reduce((a, s) => a + s.uptimeSeconds, 0);
    const totalRamUsed = servers.reduce((a, s) => a + s.ramUsedGb, 0);
    const totalRam = servers.reduce((a, s) => a + s.spec.ramTotalGb, 0);
    const totalDown = servers.reduce((a, s) => a + s.netDownMbps, 0);
    const totalUp = servers.reduce((a, s) => a + s.netUpMbps, 0);
    const containers = servers.reduce((a, s) => a + s.spec.profile.containers, 0);

    return [
      { id: 'servers', label: 'Servers', value: h.totalServers, unit: '', delta: 0, tone: 'neutral' },
      { id: 'online', label: 'Online', value: h.onlineServers, unit: '', delta: 0, tone: 'good' },
      { id: 'containers', label: 'VMs & CTs', value: containers, unit: '', delta: 2, tone: 'neutral',
        value2: 0, label2: 'CTs', unit2: '' },
      { id: 'cpu', label: 'Avg CPU', value: h.avgCpu, unit: '%', delta: 1.2, tone: h.avgCpu > 70 ? 'warn' : 'good' },
      { id: 'ram', label: 'Memory', value: round((totalRamUsed / Math.max(totalRam, 1)) * 100, 1), unit: '%', delta: 0.4, tone: 'good' },
      { id: 'download', label: 'Download', value: round(totalDown, 1), unit: 'Mbps', delta: 0, tone: 'neutral' },
      { id: 'upload', label: 'Upload', value: round(totalUp, 1), unit: 'Mbps', delta: 0, tone: 'neutral' },
      { id: 'uptime', label: 'Uptime', value: totalUptimeSeconds, unit: 'sec', delta: 0.1, tone: 'good' },
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

  getDockerHostProfiles(): DockerHostProfile[] {
    return [
      {
        hostName: 'docker02',
        hostIp: '192.168.1.33',
        containers: [
          { id: 'c06a1b2c3d53', name: 'jellyfin', running: true, image: 'jellyfin/jellyfin:latest', ports: ['8096->8096/tcp'] },
          { id: 'c07a1b2c3d54', name: 'jellyfin-transcode', running: true, image: 'jellyfin/jellyfin:latest', ports: [] },
          { id: 'c08a1b2c3d55', name: 'uptime-kuma', running: true, image: 'louislam/uptime-kuma:latest', ports: ['3001->3001/tcp'] },
          { id: 'c09a1b2c3d56', name: 'homelab-frontend', running: false, image: 'homelab/frontend:latest', ports: [] },
          { id: 'c10a1b2c3d57', name: 'homelab-backend', running: true, image: 'homelab/backend:latest', ports: ['4000->4000/tcp'] },
          { id: 'c11a1b2c3d58', name: 'nginx-proxy', running: true, image: 'nginx:alpine', ports: ['80->80/tcp', '443->443/tcp'] },
          { id: 'c12a1b2c3d59', name: 'redis', running: true, image: 'redis:7-alpine', ports: ['6379->6379/tcp'] },
          { id: 'c13a1b2c3d5a', name: 'postgres', running: true, image: 'postgres:16-alpine', ports: ['5432->5432/tcp'] },
          { id: 'c14a1b2c3d5b', name: 'grafana', running: true, image: 'grafana/grafana:latest', ports: ['3002->3000/tcp'] },
          { id: 'c15a1b2c3d5c', name: 'prometheus', running: true, image: 'prom/prometheus:latest', ports: ['9090->9090/tcp'] },
        ],
      },
    ];
  }

  private readonly bootStartedAt = Date.now();
}
