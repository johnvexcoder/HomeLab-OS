import type { MetricsProvider, TelemetryBroadcaster, ProviderDiagnostics, HistoryRange, DockerContainerInfo, DockerHostProfile } from './types';
import type { DockerMetricsProvider } from './dockerMetricsProvider';
import type { ProxmoxMetricsProvider } from './proxmoxMetricsProvider';
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
import { getAgentServers, getAgentDockerHostProfiles } from './agentServers';
import { reconcileServers } from './identity';
import { getNetworkBandwidth } from '../services/networkBandwidth';
import { collectSelfMetrics, type SelfMonitorData } from './selfMonitor';
import * as os from 'os';

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
      // Build a comprehensive snapshot list from ALL servers (Proxmox + Docker + Agent)
      // This ensures agent-enriched data and agent servers get written to the metrics DB
      const allServers = this.getServers();
      const enrichedSnapshots: MetricSnapshot[] = allServers.map((s) => ({
        serverId: s.spec.id,
        timestamp: Date.now(),
        cpu: s.cpu,
        cpuCores: s.spec.cpuCores || 1,
        ramUsedGb: s.ramUsedGb,
        ramTotalGb: s.spec.ramTotalGb || 1,
        diskUsedGb: s.diskUsedGb,
        diskTotalGb: s.spec.diskTotalGb || 1,
        tempC: s.tempC,
        netUpMbps: s.netUpMbps,
        netDownMbps: s.netDownMbps,
        load: s.load,
        uptimeSeconds: s.uptimeSeconds,
        processes: s.processes,
        status: s.status,
        reachability: s.reachability,
        health: s.health,
        sensors: s.sensors,
      }));

      if (enrichedSnapshots.length > 0) {
        insertMetrics(enrichedSnapshots);
      }

      const dockerSnap = this.docker?.getHostSnapshot();
      if (dockerSnap) {
        insertMetrics([dockerSnap]);
      }

      listener(enrichedSnapshots);
    });
  }

  onNotifications(listener: (notifications: Notification[]) => void): void {
    this.primary.onNotifications(listener);
    this.docker?.onNotifications?.(listener);
  }

  private getGuestMap(): Map<string, { vmid: string; name: string; running: boolean; nodeId: string }> {
    // Try to get guest map from Proxmox provider
    const primary = this.primary as ProxmoxMetricsProvider | undefined;
    if (primary && typeof primary.getGuestMap === 'function') {
      return primary.getGuestMap();
    }
    return new Map();
  }

  getServers(): ServerRuntime[] {
    const primary = this.primary.getServers();
    const docker = this.docker?.getHostRuntime();
    const primaryIds = new Set<string>();
    const result: ServerRuntime[] = [];

    // Add Proxmox servers
    for (const s of primary) {
      primaryIds.add(s.spec.id);
      result.push(s);
    }

    // Add local Docker host if not already a Proxmox server
    if (docker && !primaryIds.has(docker.spec.id)) {
      primaryIds.add(docker.spec.id);
      result.push(docker);
    }

    // Merge agent-reported servers using the identity reconciliation engine
    const guestMap = this.getGuestMap();
    const { runtimes: agentServers, claimedGuestIds } = getAgentServers(primaryIds, primary, guestMap);
    for (const s of agentServers) {
      result.push(s);
    }

    // Remove stale Proxmox guest cards that an agent has claimed
    if (claimedGuestIds.size > 0) {
      for (let i = result.length - 1; i >= 0; i--) {
        if (claimedGuestIds.has(result[i].spec.id)) {
          result.splice(i, 1);
        }
      }
    }

    // Self-monitor: if the backend's own host wasn't enriched by an agent,
    // enrich it with local /proc metrics so it shows real data
    this.selfEnrichIfUnenriched(result);

    return result;
  }

  /**
   * Detect the backend's own IP by looking at non-internal, non-loopback
   * interfaces on the 192.168.x.x subnet.
   */
  private getOwnIp(): string | null {
    const ifaces = os.networkInterfaces();
    for (const addrs of Object.values(ifaces)) {
      if (!addrs) continue;
      for (const a of addrs) {
        if (a.internal || a.family !== 'IPv4') continue;
        if (a.address.startsWith('127.')) continue;
        if (a.address.startsWith('192.168.')) return a.address;
      }
    }
    return null;
  }

  /**
   * If the backend's own IP matches a Proxmox guest that wasn't enriched
   * by an agent, apply self-monitor data (CPU, RAM, disk, temp, network).
   * This ensures the backend's own VM always shows real metrics.
   */
  private selfEnrichIfUnenriched(servers: ServerRuntime[]): void {
    const ownIp = this.getOwnIp();
    if (!ownIp) return;

    // Find a server with our IP and apply self-monitor fallback for tempC
    for (const s of servers) {
      if (s.spec.ip !== ownIp) continue;
      // Skip entirely if agent already provided any real metrics — the agent
      // is the source of truth for CPU/RAM/disk; temperature is inherited from
      // the parent Proxmox node via buildAgentRuntime() / enrichServerWithAgent().
      if (s.cpu > 0 || s.diskUsedGb > 0) continue;

      const m = collectSelfMetrics();
      s.cpu = m.cpuUsage;
      s.ramUsedGb = m.ramUsedGb;
      s.spec.ramTotalGb = m.ramTotalGb;
      s.diskUsedGb = m.diskUsedGb;
      s.spec.diskTotalGb = m.diskTotalGb;
      if (m.tempC != null) s.tempC = m.tempC;
      s.netUpMbps = m.netUpMbps;
      s.netDownMbps = m.netDownMbps;
      s.load = m.load1;
      s.uptimeSeconds = m.uptimeSeconds;
      s.processes = m.processes;
      s.spec.cpuCores = m.cpuCores;
      s.spec.os = m.os;
      s.status = 'online';
      s.reachability = 'accessible';
      s.health = 100;

      const ramPct = m.ramTotalGb > 0 ? (m.ramUsedGb / m.ramTotalGb) * 100 : 0;
      const diskPct = m.diskTotalGb > 0 ? (m.diskUsedGb / m.diskTotalGb) * 100 : 0;
      s.health = Math.round(100 - (m.cpuUsage > 85 ? 15 : 0) - (ramPct > 90 ? 15 : 0) - (diskPct > 92 ? 10 : 0));
      s.status = m.cpuUsage > 90 || ramPct > 95 ? 'degraded' : 'online';

      s.spec.profile.baseCpu = m.cpuUsage;
      s.spec.profile.baseRamGb = m.ramUsedGb;
      if (m.tempC != null) s.spec.profile.baseTemp = m.tempC;
      s.spec.profile.baseNetUpMbps = m.netUpMbps;
      s.spec.profile.baseNetDownMbps = m.netDownMbps;

      break; // only enrich one server
    }

    // Temperature inheritance pass: any server without tempC inherits from the
    // parent Proxmox node on the same subnet. This runs AFTER self-enrichment
    // and agent enrichment so it catches docker host runtimes, self-enriched
    // VMs, and unmatched Proxmox guest cards alike.
    for (const s of servers) {
      if (s.tempC != null && s.tempC > 0) continue;
      if (!s.spec.ip) continue;
      const sp = s.spec.ip.split('.');
      if (sp.length !== 4) continue;
      for (const candidate of servers) {
        if (candidate.spec.role !== 'hypervisor') continue;
        if (!candidate.spec.ip) continue;
        if (candidate.tempC <= 0) continue;
        const cp = candidate.spec.ip.split('.');
        if (sp[0] === cp[0] && sp[1] === cp[1] && sp[2] === cp[2]) {
          s.tempC = round(candidate.tempC, 1);
          s.spec.profile.baseTemp = s.tempC;
          (s.spec as any)._tempSource = candidate.spec.hostname;
          break;
        }
      }
    }
  }

  getServer(id: string): ServerRuntime | undefined {
    // Use getServers() which applies agent enrichment to Proxmox servers
    return this.getServers().find((s) => s.spec.id === id);
  }

  getHistory(serverId: string, range: HistoryRange) {
    return this.primary.getHistory(serverId, range);
  }

  getStatsHistory(range: HistoryRange) {
    return statsHistoryFor(range, this.getServers());
  }

  getGlobalHealth(): GlobalHealth {
    const servers = this.getServers();
    const online = servers.filter((s) => s.status === 'online').length;
    const degraded = servers.filter((s) => s.status === 'degraded').length;
    const offline = servers.length - online - degraded;

    const avgCpu = servers.length ? servers.reduce((a, s) => a + s.cpu, 0) / servers.length : 0;
    const avgRam = servers.length
      ? servers.reduce((a, s) => a + (s.spec.ramTotalGb > 0 ? (s.ramUsedGb / s.spec.ramTotalGb) * 100 : 0), 0) / servers.length
      : 0;
    const score = servers.length ? servers.reduce((a, s) => a + s.health, 0) / servers.length : 0;

    return {
      score: round(Math.min(100, Math.max(0, score)), 1),
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
    const servers = this.getServers();
    const h = this.getGlobalHealth();
    const totalUptimeSeconds = servers.reduce((a, s) => a + s.uptimeSeconds, 0);
    const totalRamUsed = servers.reduce((a, s) => a + s.ramUsedGb, 0);
    const totalRam = servers.reduce((a, s) => a + s.spec.ramTotalGb, 0);

    const localContainers = this.docker?.getContainers() ?? [];
    const guestMap = this.getGuestMap();
    const agentProfiles = getAgentDockerHostProfiles(guestMap);
    const agentContainerCount = agentProfiles.reduce((sum, p) => sum + p.containers.filter((c) => c.running).length, 0);
    const runningContainers = localContainers.filter((c) => c.running).length + agentContainerCount;

    const bw = getNetworkBandwidth();

    return [
      { id: 'servers', label: 'Nodes', value: h.totalServers, unit: '', delta: 0, tone: 'neutral' },
      { id: 'online', label: 'Online', value: h.onlineServers, unit: '', delta: 0, tone: 'good' },
      { id: 'containers', label: 'VMs & CTs', value: runningContainers, unit: '', delta: 0, tone: 'neutral',
        value2: 0, label2: 'CTs', unit2: '' },
      { id: 'cpu', label: 'Avg CPU', value: h.avgCpu, unit: '%', delta: 0, tone: h.avgCpu > 70 ? 'warn' : 'good' },
      { id: 'ram', label: 'Memory', value: round((totalRamUsed / Math.max(totalRam, 1)) * 100, 1), unit: '%', delta: 0, tone: 'good' },
      { id: 'download', label: 'Download', value: bw.downloadMbps, unit: 'Mbps', delta: 0, tone: 'neutral' },
      { id: 'upload', label: 'Upload', value: bw.uploadMbps, unit: 'Mbps', delta: 0, tone: 'neutral' },
      { id: 'uptime', label: 'Uptime', value: totalUptimeSeconds, unit: 'sec', delta: 0, tone: 'good' },
    ];
  }

  getNetwork(): { nodes: NetworkNode[]; links: NetworkLink[] } {
    const { nodes, links } = this.primary.getNetwork();
    const guestMap = this.getGuestMap();
    const existingIds = new Set(nodes.map((n) => n.id));

    // Merge standalone agent servers using identity reconciliation
    const recon = reconcileServers(this.primary.getServers(), guestMap);
    const agentServers = recon.servers;
    const claimedGuestIds = recon.claimedGuestIds;

    // Remove claimed guest nodes from the network map
    if (claimedGuestIds.size > 0) {
      for (let i = nodes.length - 1; i >= 0; i--) {
        if (claimedGuestIds.has(nodes[i].id)) {
          nodes.splice(i, 1);
        }
      }
      for (let i = links.length - 1; i >= 0; i--) {
        if (claimedGuestIds.has(links[i].source) || claimedGuestIds.has(links[i].target)) {
          links.splice(i, 1);
        }
      }
    }
    for (const s of agentServers) {
      if (existingIds.has(s.spec.id)) continue;
      const parentNode = s.spec.clusterId && nodes.some((n) => n.id === s.spec.clusterId)
        ? s.spec.clusterId
        : 'gateway';
      const nodeType: NetworkNode['type'] =
        s.spec.role === 'vm' ? 'vm'
        : s.spec.role === 'lxc' ? 'lxc'
        : 'container';
      nodes.push({
        id: s.spec.id,
        label: s.spec.name,
        type: nodeType,
        status: s.status,
        x: 50, y: 50,
        parentId: parentNode,
        ip: s.spec.ip || undefined,
        health: s.health,
        tempC: s.tempC,
        cpuPercent: s.cpu,
      });
      links.push({
        id: `${parentNode}-${s.spec.id}`,
        source: parentNode,
        target: s.spec.id,
        status: s.status === 'online' ? 'healthy' : s.status === 'degraded' ? 'warning' : 'critical',
        latencyMs: 1,
        throughputMbps: round(s.netUpMbps + s.netDownMbps, 1),
        jitterMs: 0.1,
        packetLoss: 0,
      });
    }

    // Add local Docker containers: group under a Docker engine node
    const containers = this.docker?.getContainers() ?? [];
    if (containers.length > 0) {
      const match = config.docker.hostGuest.trim().toLowerCase();
      const guests = nodes.filter((n) => n.type === 'vm' || n.type === 'lxc' || n.type === 'container');
      const host =
        (match ? guests.find((g) => g.label.toLowerCase().includes(match)) : undefined) ??
        guests[0] ??
        nodes.find((n) => n.type === 'hypervisor');
      if (host) {
        const engineId = `${host.id}-docker`;
        if (!existingIds.has(engineId)) {
          nodes.push({
            id: engineId,
            label: 'Docker',
            type: 'docker',
            status: containers.some((c) => !c.running) ? 'degraded' : 'online',
            x: 50, y: 50,
            parentId: host.id,
            health: 100,
            childCount: containers.length,
          });
          links.push({
            id: `${host.id}-${engineId}`,
            source: host.id,
            target: engineId,
            status: 'healthy',
            latencyMs: 0.1,
            throughputMbps: 0,
            jitterMs: 0.05,
            packetLoss: 0,
          });
        }

        const dockerIp = host.ip || undefined;
        containers.slice(0, 40).forEach((c) => {
          const id = `docker-${c.id}`;
          nodes.push({
            id,
            label: c.name,
            type: 'container',
            status: c.running ? 'online' : 'offline',
            x: 50, y: 50,
            parentId: engineId,
            ip: dockerIp,
            health: c.running ? 100 : 0,
          });
          links.push({
            id: `${engineId}-${id}`,
            source: engineId,
            target: id,
            status: c.running ? 'healthy' : 'warning',
            latencyMs: 0.1,
            throughputMbps: round((c.netDownMbps ?? 0) + (c.netUpMbps ?? 0), 2),
            jitterMs: 0.05,
            packetLoss: 0,
          });
        });

        const hostRuntime = this.docker?.getHostRuntime();
        if (hostRuntime) {
          const hostNet = round(hostRuntime.netUpMbps + hostRuntime.netDownMbps, 2);
          const uplink = links.find(
            (l) => (l.source === host.id || l.target === host.id) && l.id !== 'internet',
          );
          if (uplink) uplink.throughputMbps = hostNet;
        }
      }
    }

    // Ensure all servers with IPs appear in the network (catches docker host
    // runtimes and any other servers that the primary network doesn't include).
    const allServers = this.getServers();
    for (const s of allServers) {
      if (existingIds.has(s.spec.id)) continue;
      if (nodes.some((n) => n.id === s.spec.id)) continue;
      if (!s.spec.ip) continue;

      // Find parent hypervisor node by subnet
      let parentId = 'gateway';
      const sp = s.spec.ip.split('.');
      if (sp.length === 4) {
        for (const n of nodes) {
          if (n.type !== 'hypervisor' || !n.ip) continue;
          const cp = n.ip.split('.');
          if (sp[0] === cp[0] && sp[1] === cp[1] && sp[2] === cp[2]) {
            parentId = n.id;
            break;
          }
        }
      }

      const nodeType: NetworkNode['type'] =
        s.spec.role === 'vm' ? 'vm'
        : s.spec.role === 'lxc' ? 'lxc'
        : 'container';
      nodes.push({
        id: s.spec.id,
        label: s.spec.name,
        type: nodeType,
        status: s.status,
        x: 50, y: 50,
        parentId,
        ip: s.spec.ip,
        health: s.health,
        tempC: s.tempC,
        cpuPercent: s.cpu,
      });
      links.push({
        id: `${parentId}-${s.spec.id}`,
        source: parentId,
        target: s.spec.id,
        status: s.status === 'online' ? 'healthy' : s.status === 'degraded' ? 'warning' : 'critical',
        latencyMs: 1,
        throughputMbps: round(s.netUpMbps + s.netDownMbps, 1),
        jitterMs: 0.1,
        packetLoss: 0,
      });
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
    const result: DockerContainerInfo[] = containers.map((c) => ({
      id: c.id,
      name: c.name,
      running: c.running,
      image: c.image,
      ports: c.ports,
    }));

    // Merge agent-reported containers (skip those correlated with Proxmox VMs)
    const guestMap = this.getGuestMap();
    const agentProfiles = getAgentDockerHostProfiles(guestMap);
    for (const ap of agentProfiles) {
      for (const c of ap.containers) {
        if (result.some((r) => r.name === c.name)) continue;
        result.push({
          id: c.id,
          name: c.name,
          running: c.running,
          image: c.image,
          ports: c.ports,
        });
      }
    }

    return result;
  }

  getDockerHostProfiles(): DockerHostProfile[] {
    const runtime = this.docker?.getHostRuntime();
    const containers = this.docker?.getContainers() ?? [];
    const profiles: DockerHostProfile[] = [];

    if (containers.length > 0 && runtime) {
      profiles.push({
        hostName: runtime.spec.name,
        hostIp: runtime.spec.ip,
        netDownMbps: runtime.netDownMbps,
        netUpMbps: runtime.netUpMbps,
        containers: containers.map((c) => ({
          id: c.id,
          name: c.name,
          running: c.running,
          image: c.image,
          ports: c.ports,
        })),
      });
    }

    // Merge agent-reported Docker host profiles (skip those correlated with Proxmox VMs)
    const guestMap = this.getGuestMap();
    const agentProfiles = getAgentDockerHostProfiles(guestMap);
    for (const ap of agentProfiles) {
      if (profiles.some((p) => p.hostName === ap.hostName)) continue;
      profiles.push(ap);
    }

    return profiles;
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
