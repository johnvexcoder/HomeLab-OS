import type { MetricsProvider, TelemetryBroadcaster, ProviderDiagnostics, HistoryRange, DockerContainerInfo, DockerHostProfile } from './types';
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
import { round } from '../telemetry/random';
import { insertMetrics } from '../db/database';
import { statsHistoryFor } from './history';
import { calculateHierarchicalLayout, applyLayout } from './hierarchicalLayout';

/**
 * Wraps the primary provider (Proxmox) and merges the Docker layer into it:
 * container nodes hang off the Docker-hosting guest on the map, and the Docker
 * host itself (e.g. `docker01`) is surfaced as its own server with live
 * CPU/memory/network. The Proxmox provider stays the source of truth for the
 * PVE node; Docker only contributes the container layer and the host runtime.
 */
export class CompositeProvider implements MetricsProvider, TelemetryBroadcaster {
  constructor(
    private readonly primary: MetricsProvider & TelemetryBroadcaster,
    private readonly docker?: DockerMetricsProvider,
  ) {}

  onTick(listener: (snapshots: MetricSnapshot[]) => void): void {
    this.primary.onTick((snapshots) => {
      const dockerSnap = this.docker?.getHostSnapshot();
      if (!dockerSnap) {
        listener(snapshots);
        return;
      }
      insertMetrics([dockerSnap]);
      listener([...snapshots, dockerSnap]);
    });
  }

  onNotifications(listener: (notifications: Notification[]) => void): void {
    this.primary.onNotifications(listener);
    this.docker?.onNotifications?.(listener);
  }

  getServers(): ServerRuntime[] {
    const primary = this.primary.getServers();
    const docker = this.docker?.getHostRuntime();
    if (!docker) return primary;
    return primary.some((s) => s.spec.id === docker.spec.id) ? primary : [...primary, docker];
  }

  getServer(id: string): ServerRuntime | undefined {
    return this.primary.getServer(id) ?? this.docker?.getHostRuntime() ?? undefined;
  }

  getHistory(serverId: string, range: HistoryRange) {
    return this.primary.getHistory(serverId, range);
  }

  getStatsHistory(range: HistoryRange) {
    return statsHistoryFor(range, this.getServers());
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
      if (s.id === 'containers') return { ...s, value2: running, label2: 'CTs' };
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

    containers.slice(0, 40).forEach((c) => {
      const id = `docker-${c.id}`;
      const dockerIp = host.ip || nodes.find((n) => n.type === 'hypervisor')?.ip || undefined;
      nodes.push({
        id,
        label: c.name,
        type: 'docker',
        status: c.running ? 'online' : 'offline',
        x: 50,
        y: 50,
        parentId: host.id,
        ip: dockerIp,
        health: c.running ? 100 : 0,
      });
      links.push({
        id: `docker-${c.id}-link`,
        source: host.id,
        target: id,
        status: c.running ? 'healthy' : 'warning',
        latencyMs: 0.1,
        throughputMbps: round((c.netDownMbps ?? 0) + (c.netUpMbps ?? 0), 2),
        jitterMs: 0.05,
        packetLoss: 0,
      });
    });

    // The guest that hosts Docker (e.g. `pve-pve0-g0`) carries the Docker host's
    // real traffic on its uplink to the hypervisor.
    const hostRuntime = this.docker?.getHostRuntime();
    if (hostRuntime && host) {
      const hostNet = round(hostRuntime.netUpMbps + hostRuntime.netDownMbps, 2);
      const uplink = links.find(
        (l) => (l.source === host.id || l.target === host.id) && l.id !== 'internet',
      );
      if (uplink) uplink.throughputMbps = hostNet;
    }

    return { nodes: applyLayout(nodes, calculateHierarchicalLayout(nodes, 100, 100)), links };
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

  getDockerContainers(): DockerContainerInfo[] {
    const containers = this.docker?.getContainers() ?? [];
    return containers.map((c) => ({
      id: c.id,
      name: c.name,
      running: c.running,
      image: c.image,
      ports: c.ports,
    }));
  }

  getDockerHostProfiles(): DockerHostProfile[] {
    const runtime = this.docker?.getHostRuntime();
    const containers = this.docker?.getContainers() ?? [];
    if (containers.length === 0) return [];
    const hostName = runtime?.spec.name ?? 'docker';
    const hostIp = runtime?.spec.ip ?? '';
    return [{
      hostName,
      hostIp,
      containers: containers.map((c) => ({
        id: c.id,
        name: c.name,
        running: c.running,
        image: c.image,
        ports: c.ports,
      })),
    }];
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
