import type { MetricsProvider, TelemetryBroadcaster, ProviderDiagnostics, HistoryRange, DockerContainerInfo, DockerHostProfile } from './types';
import type { BootStats, ClusterInfo, GlobalHealth, MetricSnapshot, NetworkLink, NetworkNode, Notification, QuickStat, ServerRuntime } from '../types';
import { getAgentServers, getAgentDockerHostProfiles } from './agentServers';
import { statsHistoryFor, historyForServer } from './history';
import { getNetworkBandwidth } from '../services/networkBandwidth';
import { NotificationGenerator } from '../telemetry/notification-generator';
import { calculateHierarchicalLayout, applyLayout } from './hierarchicalLayout';
import { round } from '../telemetry/random';

type TickListener = (snapshots: MetricSnapshot[]) => void;
type NotificationListener = (notifications: Notification[]) => void;

/**
 * AgentMetricsProvider provides live dashboard telemetry exclusively from the 
 * HomeLab-Agent data stored in the local SQLite database.
 * Used when no hypervisor (Proxmox) is configured.
 */
export class AgentMetricsProvider implements MetricsProvider, TelemetryBroadcaster {
  private tickListeners: TickListener[] = [];
  private notifListeners: NotificationListener[] = [];
  private interval: NodeJS.Timeout | null = null;
  private readonly generator = new NotificationGenerator({ ambient: false });
  private runtimes: ServerRuntime[] = [];

  async start(): Promise<void> {
    this.poll();
    this.interval = setInterval(() => void this.poll(), 5000);
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
  }

  private poll(): void {
    const { runtimes } = getAgentServers(new Set(), [], new Map());
    this.runtimes = runtimes;

    const now = Date.now();
    const snapshots: MetricSnapshot[] = runtimes.map(r => ({
      serverId: r.spec.id,
      timestamp: now,
      cpu: r.cpu,
      cpuCores: r.spec.cpuCores,
      ramUsedGb: r.ramUsedGb,
      ramTotalGb: r.spec.ramTotalGb,
      diskUsedGb: r.diskUsedGb,
      diskTotalGb: r.spec.diskTotalGb,
      tempC: r.tempC,
      netUpMbps: r.netUpMbps,
      netDownMbps: r.netDownMbps,
      load: r.load,
      uptimeSeconds: r.uptimeSeconds,
      processes: r.processes,
      status: r.status,
      reachability: r.reachability,
      health: r.health,
      sensors: r.sensors,
    }));

    const notifications = this.generator.generate(snapshots, now);
    this.tickListeners.forEach(l => l(snapshots));
    if (notifications.length > 0) this.notifListeners.forEach(l => l(notifications));
  }

  onTick(listener: TickListener): void {
    this.tickListeners.push(listener);
  }

  onNotifications(listener: NotificationListener): void {
    this.notifListeners.push(listener);
  }

  getServers(): ServerRuntime[] {
    return this.runtimes;
  }

  getServer(id: string): ServerRuntime | undefined {
    return this.runtimes.find((s) =>
      s.spec.id === id ||
      `docker-${s.spec.id}` === id ||
      `docker-${s.spec.name}` === id ||
      s.spec.name === id ||
      s.spec.hostname === id,
    );
  }

  getHistory(serverId: string, range: HistoryRange) {
    return historyForServer(serverId, range);
  }

  getStatsHistory(range: HistoryRange) {
    return statsHistoryFor(range, this.getServers());
  }

  getGlobalHealth(): GlobalHealth {
    const servers = this.getServers();
    const online = servers.filter(s => s.status === 'online').length;
    const degraded = servers.filter(s => s.status === 'degraded').length;
    const offline = servers.length - online - degraded;
    const avgCpu = servers.length ? servers.reduce((a, s) => a + s.cpu, 0) / servers.length : 0;
    const avgRam = servers.length ? servers.reduce((a, s) => a + (s.spec.ramTotalGb > 0 ? (s.ramUsedGb / s.spec.ramTotalGb) * 100 : 0), 0) / servers.length : 0;
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
      totalUptimePercent: round(servers.length ? (servers.reduce((a, s) => a + (s.status === 'online' ? 1 : s.status === 'degraded' ? 0.6 : 0), 0) / servers.length) * 100 : 0, 1),
    };
  }

  getQuickStats(): QuickStat[] {
    const servers = this.getServers();
    const h = this.getGlobalHealth();
    const bw = getNetworkBandwidth();
    const totalUptimeSeconds = servers.reduce((a, s) => a + s.uptimeSeconds, 0);
    const totalRamUsed = servers.reduce((a, s) => a + s.ramUsedGb, 0);
    const totalRam = servers.reduce((a, s) => a + s.spec.ramTotalGb, 0);
    const activeVms = servers.filter(s => s.spec.role === 'vm' || s.spec.role === 'lxc').length;
    
    let runningContainers = 0;
    for (const s of servers) {
      if (s.containers) runningContainers += s.containers.filter(c => c.running).length;
    }

    return [
      { id: 'servers', label: 'Nodes', value: h.totalServers, unit: '', delta: 0, tone: 'neutral' },
      { id: 'online', label: 'Online', value: h.onlineServers, unit: '', delta: 0, tone: 'good' },
      { id: 'containers', label: 'VMs & CTs', value: activeVms || 0, unit: '', delta: 0, tone: 'neutral', value2: runningContainers || 0, label2: 'CTs', unit2: '' },
      { id: 'cpu', label: 'Avg CPU', value: h.avgCpu, unit: '%', delta: 0, tone: h.avgCpu > 70 ? 'warn' : 'good' },
      { id: 'ram', label: 'Memory', value: round((totalRamUsed / Math.max(totalRam, 1)) * 100, 1), unit: '%', delta: 0, tone: 'good' },
      { id: 'download', label: 'Download', value: round(bw.downloadMbps, 1), unit: 'Mbps', delta: 0, tone: 'neutral' },
      { id: 'upload', label: 'Upload', value: round(bw.uploadMbps, 1), unit: 'Mbps', delta: 0, tone: 'neutral' },
      { id: 'uptime', label: 'Uptime', value: totalUptimeSeconds, unit: 'sec', delta: 0, tone: 'good' },
    ];
  }

  getNetwork(): { nodes: NetworkNode[]; links: NetworkLink[] } {
    const servers = this.getServers();
    const nodes: NetworkNode[] = [{ id: 'internet', label: 'Internet', type: 'internet', status: 'online', x: 50, y: 50, health: 100 }];
    const links: NetworkLink[] = [];

    if (servers.length > 0) {
      nodes.push({ id: 'gateway', label: 'Gateway', type: 'gateway', status: 'online', x: 50, y: 50, health: 100 });
      links.push({ id: 'internet-gateway', source: 'internet', target: 'gateway', status: 'healthy', latencyMs: 0, throughputMbps: 0, jitterMs: 0, packetLoss: 0 });
    }

    for (const s of servers) {
      nodes.push({
        id: s.spec.id,
        label: s.spec.name,
        type: s.spec.role === 'vm' ? 'vm' : s.spec.role === 'lxc' ? 'lxc' : 'physical',
        status: s.status,
        x: 50, y: 50,
        parentId: s.spec.clusterId || 'gateway',
        ip: s.spec.ip || undefined,
        health: s.health,
        tempC: s.tempC,
        cpuPercent: s.cpu,
      });

      links.push({
        id: `link-${s.spec.id}`,
        source: s.spec.clusterId || 'gateway',
        target: s.spec.id,
        status: s.status === 'online' ? 'healthy' : s.status === 'degraded' ? 'warning' : 'critical',
        latencyMs: null,
        throughputMbps: null,
        jitterMs: null,
        packetLoss: null,
      });
      
      if (s.containers) {
        for (const c of s.containers.slice(0, 40)) {
          const cid = `docker-${c.id}`;
          nodes.push({
            id: cid,
            label: c.name,
            type: 'container',
            status: c.running ? 'online' : 'offline',
            x: 50, y: 50,
            parentId: s.spec.id,
            ip: s.spec.ip,
            health: c.running ? 100 : 0,
          });
          links.push({
            id: `${s.spec.id}-${cid}`,
            source: s.spec.id,
            target: cid,
            status: c.running ? 'healthy' : 'warning',
            latencyMs: null,
            throughputMbps: null,
            jitterMs: null,
            packetLoss: null,
          });
        }
      }
    }

    return { nodes: applyLayout(nodes, calculateHierarchicalLayout(nodes, 100, 100)), links };
  }

  getClusters(): ClusterInfo[] { return []; }
  getBootStats(): BootStats { return { historySeeded: false, historyPoints: 0, startedAt: Date.now() }; }
  getSourceName(): string { return 'agent'; }
  getDockerContainers(): DockerContainerInfo[] { return []; }
  getDockerHostProfiles(): DockerHostProfile[] { return getAgentDockerHostProfiles(new Map()); }
  getLastPollError(): string | null { return null; }
  getDiagnostics(): ProviderDiagnostics { return { lastPollAt: Date.now(), lastPollError: null, endpointErrors: {} }; }
}
