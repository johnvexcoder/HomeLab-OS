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
import type { HistoryPoint, HistoryRange, StatsHistoryPoint, DockerHostProfile, DockerContainerInfo } from './types';
import type { MetricsProvider } from './types';
import { TelemetryEngine } from '../telemetry/engine';
import { countMetrics } from '../db/database';
import { SERVER_SPECS, CLUSTER_NAMES, MOCK_SERVER_CONTAINERS } from '../mock-data/servers';
import { clamp, round } from '../telemetry/random';
import { historyForServer, statsHistoryFor } from './history';

/**
 * Mock implementation of MetricsProvider.
 * Serves a realistic 3-node Proxmox Cluster with VMs, Docker hosts, TrueNAS storage,
 * and OPNsense firewall running on simulated infrastructure.
 */
export class MockMetricsProvider implements MetricsProvider {
  constructor(readonly engine: TelemetryEngine) {}

  getServers(): ServerRuntime[] {
    return [...this.engine.servers.values()];
  }

  getServer(id: string): ServerRuntime | undefined {
    return this.engine.servers.get(id) ??
      [...this.engine.servers.values()].find((s) =>
        s.spec.id === id ||
        `docker-${s.spec.id}` === id ||
        `docker-${s.spec.name}` === id ||
        s.spec.name === id ||
        s.spec.hostname === id,
      );
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

    const activeVms = servers.filter((s) => s.spec.parentId).length;
    const runningContainers = servers.reduce((a, s) => a + (s.containers ? s.containers.filter((c) => c.running).length : 0), 0);

    return [
      { id: 'servers', label: 'Nodes', value: h.totalServers, unit: '', delta: 0, tone: 'neutral' },
      { id: 'online', label: 'Online', value: h.onlineServers, unit: '', delta: 0, tone: 'good' },
      { id: 'containers', label: 'VMs & CTs', value: activeVms, unit: '', delta: 0, tone: 'neutral',
        value2: runningContainers, label2: 'CTs', unit2: '' },
      { id: 'cpu', label: 'Avg CPU', value: h.avgCpu, unit: '%', delta: 0.8, tone: h.avgCpu > 70 ? 'warn' : 'good' },
      { id: 'ram', label: 'Memory', value: round((totalRamUsed / Math.max(totalRam, 1)) * 100, 1), unit: '%', delta: 0.2, tone: 'good' },
      { id: 'download', label: 'Download', value: round(totalDown, 1), unit: 'Mbps', delta: 0, tone: 'neutral' },
      { id: 'upload', label: 'Upload', value: round(totalUp, 1), unit: 'Mbps', delta: 0, tone: 'neutral' },
      { id: 'uptime', label: 'Uptime', value: totalUptimeSeconds, unit: 'sec', delta: 0.1, tone: 'good' },
    ];
  }

  getNetwork(): { nodes: NetworkNode[]; links: NetworkLink[] } {
    return this.engine.getNetwork();
  }

  /** Aggregate the fleet into clusters (Proxmox cluster: pve0, pve1, pve2). */
  getClusters(): ClusterInfo[] {
    const byCluster = new Map<string, ServerRuntime[]>();
    for (const srv of this.getServers()) {
      const clusterId = srv.spec.clusterId;
      if (!clusterId) continue;
      // Only include hypervisors in the Proxmox cluster definition
      if (srv.spec.role !== 'hypervisor') continue;
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

  getDockerContainers(): DockerContainerInfo[] {
    const list: DockerContainerInfo[] = [];
    for (const [hostId, containers] of Object.entries(MOCK_SERVER_CONTAINERS)) {
      for (const c of containers) {
        list.push({
          id: c.id,
          name: c.name,
          running: c.running,
          image: c.image,
          ports: c.ports,
        });
      }
    }
    return list;
  }

  getDockerHostProfiles(): DockerHostProfile[] {
    const servers = this.getServers();
    const profiles: DockerHostProfile[] = [];

    for (const [hostId, containers] of Object.entries(MOCK_SERVER_CONTAINERS)) {
      const srv = servers.find((s) => s.spec.id === hostId);
      if (!srv) continue;

      profiles.push({
        hostName: srv.spec.name,
        hostIp: srv.spec.ip,
        netDownMbps: srv.netDownMbps,
        netUpMbps: srv.netUpMbps,
        containers: containers.map((c) => ({
          id: c.id,
          name: c.name,
          running: c.running,
          image: c.image,
          ports: c.ports,
        })),
      });
    }

    return profiles;
  }

  private readonly bootStartedAt = Date.now();
}
