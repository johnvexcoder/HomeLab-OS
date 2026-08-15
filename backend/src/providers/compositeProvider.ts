import type { MetricsProvider, TelemetryBroadcaster, ProviderDiagnostics, HistoryRange } from './types';
import type { DockerMetricsProvider } from './dockerMetricsProvider';
import type {
  BootStats,
  ClusterInfo,
  GlobalHealth,
  MetricSnapshot,
  NetworkLink,
  NetworkNode,
  Notification,
  QuickStat,
  ServerRuntime,
} from '../types';
import { config } from '../config';

/**
 * Wraps the primary provider (Proxmox) and merges Docker container nodes into
 * its topology. The Proxmox provider stays the single source of truth for
 * fleet/servers/history; Docker only contributes the container layer that hangs
 * off the Docker-hosting guest (e.g. `docker01`).
 */
export class CompositeProvider implements MetricsProvider, TelemetryBroadcaster {
  constructor(
    private readonly primary: MetricsProvider & TelemetryBroadcaster,
    private readonly docker?: DockerMetricsProvider,
  ) {}

  onTick(listener: (snapshots: MetricSnapshot[]) => void): void {
    this.primary.onTick(listener);
  }

  onNotifications(listener: (notifications: Notification[]) => void): void {
    this.primary.onNotifications(listener);
  }

  getServers(): ServerRuntime[] {
    return this.primary.getServers();
  }

  getServer(id: string): ServerRuntime | undefined {
    return this.primary.getServer(id);
  }

  getHistory(serverId: string, range: HistoryRange) {
    return this.primary.getHistory(serverId, range);
  }

  getStatsHistory(range: HistoryRange) {
    return this.primary.getStatsHistory(range);
  }

  getGlobalHealth(): GlobalHealth {
    return this.primary.getGlobalHealth();
  }

  getQuickStats(): QuickStat[] {
    const stats = this.primary.getQuickStats();
    const containers = this.docker?.getContainers() ?? [];
    if (containers.length === 0) return stats;
    const running = containers.filter((c) => c.running).length;
    return stats.map((s) => {
      if (s.id === 'containers') return { ...s, value: s.value + running };
      return s;
    });
  }

  getNetwork(): { nodes: NetworkNode[]; links: NetworkLink[] } {
    const { nodes, links } = this.primary.getNetwork();
    const containers = this.docker?.getContainers() ?? [];
    if (containers.length === 0) return { nodes, links };

    const match = config.docker.hostGuest.trim().toLowerCase();
    const guests = nodes.filter((n) => n.type === 'container');
    const host =
      (match ? guests.find((g) => g.label.toLowerCase().includes(match)) : undefined) ??
      guests[0] ??
      nodes.find((n) => n.type === 'hypervisor');
    if (!host) return { nodes, links };

    containers.slice(0, 40).forEach((c, i) => {
      const id = `docker-${c.id}`;
      nodes.push({
        id,
        label: c.name,
        type: 'docker',
        status: c.running ? 'online' : 'offline',
        x: host.x + 10 + (i % 4) * 6,
        y: host.y + 14 + (i % 6) * 8,
        parentId: host.id,
        health: c.running ? 100 : 0,
      });
      links.push({
        id: `docker-${c.id}-link`,
        source: host.id,
        target: id,
        status: c.running ? 'healthy' : 'warning',
        latencyMs: 0.1,
        throughputMbps: 0,
        jitterMs: 0.05,
        packetLoss: 0,
      });
    });

    return { nodes, links };
  }

  getClusters(): ClusterInfo[] {
    return this.primary.getClusters();
  }

  getBootStats(): BootStats {
    return this.primary.getBootStats();
  }

  getSourceName(): string {
    const docker = this.docker;
    if (docker && this.docker?.getContainers().length > 0) {
      return `${this.primary.getSourceName?.() ?? 'proxmox'} + ${docker.getSourceName()}`;
    }
    return this.primary.getSourceName?.() ?? 'proxmox';
  }

  getLastPollError(): string | null {
    return this.primary.getLastPollError?.() ?? null;
  }

  getDiagnostics(): ProviderDiagnostics {
    const primary = this.primary.getDiagnostics?.() ?? { lastPollAt: null, lastPollError: null, endpointErrors: {} };
    const docker = this.docker?.getDiagnostics?.();
    if (!docker) return primary;
    return {
      lastPollAt: docker.lastPollAt ?? primary.lastPollAt,
      lastPollError: docker.lastPollError ?? primary.lastPollError,
      endpointErrors: { ...primary.endpointErrors, ...docker.endpointErrors },
    };
  }
}
