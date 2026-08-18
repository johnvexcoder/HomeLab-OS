import https from 'node:https';
import type {
  BootStats,
  ClusterInfo,
  GlobalHealth,
  MetricSnapshot,
  NetworkLink,
  NetworkNode,
  Notification,
  QuickStat,
  Reachability,
  SensorConfig,
  SensorReading,
  ServerRuntime,
  ServerSpec,
  ServerStatus,
} from '../types';
import type { HistoryPoint, HistoryRange, StatsHistoryPoint, ProviderDiagnostics } from './types';
import { insertMetrics, countMetrics } from '../db/database';
import { historyForServer, statsHistoryFor } from './history';
import { NotificationGenerator } from '../telemetry/notification-generator';
import { uuid } from '../mock-data/servers';
import { clamp, round } from '../telemetry/random';
import { config } from '../config';
import { calculateHierarchicalLayout, applyLayout } from './hierarchicalLayout';
import { getNetworkBandwidth } from '../services/networkBandwidth';

/** Coerce any value to a finite number, falling back to `fallback`. */
function toFinite(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/* ------------------------------------------------------------------ */
/* Proxmox VE REST API response shapes (subset we consume)             */
/* ------------------------------------------------------------------ */

interface PveNode {
  node: string;
  status: string;
  cpu: number; // 0..1 utilization
  maxcpu: number;
  mem: number;
  maxmem: number;
  disk: number;
  maxdisk: number;
  uptime: number;
  level: string;
  id: string;
}

interface PveNodeStatus {
  cpuinfo?: { 'model name'?: string; cpus?: number; cores?: number; sockets?: number };
  kversion?: string;
  pveversion?: string;
  loadavg?: number[];
  memory?: { total: number; used: number; free: number };
  uptime?: number;
}

interface PveGuest {
  vmid: number;
  name: string;
  status: string;
  cpu?: number;
  cpus?: number;
  mem?: number;
  maxmem?: number;
  disk?: number;
  maxdisk?: number;
  uptime?: number;
  template?: number;
}

interface PveRrdPoint {
  time: number;
  load1?: number;
  netin?: number; // bytes/s
  netout?: number; // bytes/s
}

interface PveSensor {
  name: string;
  type: 'temperature' | 'fan' | 'power' | 'voltage' | 'current';
  value: number;
  unit: string;
}

interface PveNetworkIface {
  iface: string;
  type: string;
  active?: number;
  address?: string;
}

interface PveStorage {
  storage: string;
  type: string;
  content: string;
  total: number;
  used: number;
  active: number;
  enabled: number;
}

interface PollDetail {
  node: PveNode;
  status: PveNodeStatus;
  qemu: PveGuest[];
  lxc: PveGuest[];
  rrd: PveRrdPoint[];
  sensors: PveSensor[];
  network: PveNetworkIface[];
  storage: PveStorage[];
}

type TickListener = (snapshots: MetricSnapshot[]) => void;
type NotificationListener = (notifications: Notification[]) => void;

/**
 * Real Proxmox VE provider. Polls the Proxmox REST API on an interval,
 * discovers nodes + guests, samples node status/RRD/sensors, persists the
 * snapshots to SQLite (same pipeline as the simulator) and broadcasts them
 * over the existing WebSocket. No agent — the backend talks to Proxmox API.
 *
 * Set MOCK_MODE=false plus PROXMOX_HOST / PROXMOX_TOKEN_ID /
 * PROXMOX_TOKEN_SECRET to activate.
 */
export class ProxmoxMetricsProvider {
  private readonly host = config.proxmox.host;
  private readonly tokenId = config.proxmox.tokenId;
  private readonly tokenSecret = config.proxmox.tokenSecret;
  private readonly verifyTls = config.proxmox.verifyTls;
  private readonly pollIntervalMs = config.proxmox.pollIntervalMs;

  private readonly runtimes = new Map<string, ServerRuntime>();
  private readonly guests = new Map<string, Array<{ id: string; name: string; running: boolean }>>();
  private readonly tickListeners: TickListener[] = [];
  private readonly notifListeners: NotificationListener[] = [];
  private readonly generator = new NotificationGenerator({ ambient: false });
  private readonly startedAt = Date.now();

  private interval: NodeJS.Timeout | null = null;
  private polling = false;
  private lastPollError: string | null = null;
  private lastPollAt: number | null = null;
  private readonly endpointErrors = new Map<string, string>();
  /** Endpoints the PVE server itself does not implement (HTTP 501) — never retried, never reported. */
  private readonly unsupportedEndpoints = new Set<string>();
  private prevNodeStatus = new Map<string, string>();
  private lastStorageWarnAt = new Map<string, number>();
  private lastStorageCritAt = new Map<string, number>();

  constructor() {
    if (!this.host || !this.tokenId || !this.tokenSecret) {
      throw new Error(
        'Proxmox provider requires PROXMOX_HOST, PROXMOX_TOKEN_ID and PROXMOX_TOKEN_SECRET (set MOCK_MODE=false).',
      );
    }
  }

  /* ---------------------------------------------------------------- */
  /* Lifecycle                                                        */
  /* ---------------------------------------------------------------- */

  async start(): Promise<void> {
    await this.poll();
    this.interval = setInterval(() => {
      void this.poll();
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  onTick(listener: TickListener): void {
    this.tickListeners.push(listener);
  }

  onNotifications(listener: NotificationListener): void {
    this.notifListeners.push(listener);
  }

  getSourceName(): string {
    return 'proxmox';
  }

  getLastPollError(): string | null {
    return this.lastPollError;
  }

  getDiagnostics(): ProviderDiagnostics {
    return {
      lastPollAt: this.lastPollAt,
      lastPollError: this.lastPollError,
      endpointErrors: Object.fromEntries(this.endpointErrors),
    };
  }

  /* ---------------------------------------------------------------- */
  /* Polling                                                          */
  /* ---------------------------------------------------------------- */

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const nodes = await this.api<PveNode[]>('/nodes');
      const details = await Promise.all(nodes.map((n) => this.pollNode(n)));
      for (const detail of details) this.applyDetail(detail);
      this.detectNodeAlerts(details);
      this.detectStorageAlerts(details);
      this.lastPollError = null;
      this.lastPollAt = Date.now();
      this.emitTick();
    } catch (err) {
      this.lastPollError = err instanceof Error ? err.message : String(err);
      this.lastPollAt = Date.now();
      console.error(`[proxmox] poll failed: ${this.lastPollError}`);
      this.markAllUnreachable();
    } finally {
      this.polling = false;
    }
  }

  private pollNode(node: PveNode): Promise<PollDetail> {
    const name = encodeURIComponent(node.node);
    return Promise.all([
      this.fetchOr<PveNodeStatus>(`/nodes/${name}/status`, {}),
      this.fetchOr<PveGuest[]>(`/nodes/${name}/qemu`, []),
      this.fetchOr<PveGuest[]>(`/nodes/${name}/lxc`, []),
      this.fetchOr<PveRrdPoint[]>(`/nodes/${name}/rrddata?timeframe=hour&cf=AVERAGE`, []),
      this.fetchOr<PveSensor[]>(`/nodes/${name}/sensors`, []),
      this.fetchOr<PveNetworkIface[]>(`/nodes/${name}/network`, []),
      this.fetchOr<PveStorage[]>(`/nodes/${name}/storage`, []),
    ]).then(([status, qemu, lxc, rrd, sensors, network, storage]) => ({ node, status, qemu, lxc, rrd, sensors, network, storage }));
  }

  /** Fetch a per-node endpoint, remembering failures instead of swallowing them. */
  private async fetchOr<T>(path: string, fallback: T): Promise<T> {
    if (this.unsupportedEndpoints.has(path)) return fallback;
    try {
      const result = await this.api<T>(path);
      this.endpointErrors.delete(path);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith('PVE 501 ')) {
        // The PVE server does not implement this endpoint (e.g. /sensors on older
        // nodes). Permanent — stop polling it and never surface it as an error.
        this.unsupportedEndpoints.add(path);
        this.endpointErrors.delete(path);
        console.warn(`[proxmox] ${path} not supported by this PVE server — disabling endpoint`);
        return fallback;
      }
      if (!/^PVE \d{3}/.test(message)) {
        // Transport-level failure (ECONNRESET "socket hang up", ECONNREFUSED,
        // timeout). Retry once before flagging so transient blips don't alarm.
        try {
          await new Promise((r) => setTimeout(r, 500));
          return await this.api<T>(path);
        } catch (retryErr) {
          if (retryErr instanceof Error && /^PVE \d{3}/.test(retryErr.message)) {
            this.endpointErrors.set(path, retryErr.message);
            return fallback;
          }
        }
      }
      if (this.endpointErrors.get(path) !== message) {
        this.endpointErrors.set(path, message);
        if (this.endpointErrors.size > 24) {
          const oldest = this.endpointErrors.keys().next().value;
          if (oldest !== undefined) this.endpointErrors.delete(oldest);
        }
        console.warn(`[proxmox] ${path}: ${message}`);
      }
      return fallback;
    }
  }

  private applyDetail(detail: PollDetail): void {
    const spec = this.buildSpec(detail);
    const runtime = this.buildRuntime(detail, spec);
    this.runtimes.set(spec.id, runtime);
    this.guests.set(
      spec.id,
      [...detail.qemu, ...detail.lxc].map((g) => ({
        id: `${g.vmid}`,
        name: g.name || `${g.vmid}`,
        running: g.status === 'running',
      })),
    );
  }

  private detectNodeAlerts(details: PollDetail[]): void {
    const MIN = 60_000;
    for (const detail of details) {
      const nodeName = detail.node.node;
      const currStatus = detail.node.status;
      const prevStatus = this.prevNodeStatus.get(nodeName);
      this.prevNodeStatus.set(nodeName, currStatus);

      if (!prevStatus || prevStatus === currStatus) continue;

      if (currStatus !== 'online' && prevStatus === 'online') {
        this.emitNotification({
          id: `ntf-proxmox-node-${nodeName}-${Date.now()}`,
          title: 'Proxmox Node Offline',
          message: `Proxmox node "${nodeName}" has gone offline (was ${prevStatus}).`,
          severity: 'critical',
          timestamp: Date.now(),
          read: false,
          serverId: `pve-${nodeName}`,
        });
      } else if (currStatus === 'online' && prevStatus !== 'online') {
        this.emitNotification({
          id: `ntf-proxmox-node-${nodeName}-${Date.now()}`,
          title: 'Proxmox Node Online',
          message: `Proxmox node "${nodeName}" is back online.`,
          severity: 'success',
          timestamp: Date.now(),
          read: false,
          serverId: `pve-${nodeName}`,
        });
      }
    }
  }

  private detectStorageAlerts(details: PollDetail[]): void {
    const MIN = 60_000;
    const now = Date.now();
    for (const detail of details) {
      const nodeName = detail.node.node;
      for (const s of detail.storage) {
        if (!s.total || s.total <= 0 || !s.active) continue;
        const pct = (s.used / s.total) * 100;
        const key = `${nodeName}:${s.storage}`;

        if (pct > 95 && now - (this.lastStorageCritAt.get(key) ?? 0) > 30 * MIN) {
          this.lastStorageCritAt.set(key, now);
          this.emitNotification({
            id: `ntf-storage-crit-${key}-${now}`,
            title: 'Proxmox Storage Critical',
            message: `Storage "${s.storage}" on node "${nodeName}" is at ${pct.toFixed(1)}% usage (${(s.used / 1e9).toFixed(1)} / ${(s.total / 1e9).toFixed(1)} GB).`,
            severity: 'critical',
            timestamp: now,
            read: false,
            serverId: `pve-${nodeName}`,
          });
        } else if (pct > 85 && now - (this.lastStorageWarnAt.get(key) ?? 0) > 30 * MIN) {
          this.lastStorageWarnAt.set(key, now);
          this.emitNotification({
            id: `ntf-storage-warn-${key}-${now}`,
            title: 'Proxmox Storage Warning',
            message: `Storage "${s.storage}" on node "${nodeName}" is at ${pct.toFixed(1)}% usage (${(s.used / 1e9).toFixed(1)} / ${(s.total / 1e9).toFixed(1)} GB).`,
            severity: 'warning',
            timestamp: now,
            read: false,
            serverId: `pve-${nodeName}`,
          });
        }
      }
    }
  }

  private emitNotification(n: Notification): void {
    this.notifListeners.forEach((l) => l([n]));
  }

  /* ---------------------------------------------------------------- */
  /* Proxmox API                                                      */
  /* ---------------------------------------------------------------- */

  private api<T>(path: string): Promise<T> {
    const base = /^https?:\/\//i.test(this.host) ? this.host.replace(/\/+$/, '') : `https://${this.host}`;
    const url = `${base}/api2/json${path}`;

    return new Promise<T>((resolve, reject) => {
      const req = https.request(
        url,
        {
          method: 'GET',
          headers: {
            Authorization: `PVEAPIToken=${this.tokenId}=${this.tokenSecret}`,
            Accept: 'application/json',
          },
          rejectUnauthorized: this.verifyTls,
          timeout: 15_000,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            let body: { data?: T; errors?: unknown; message?: string } | null = null;
            try {
              body = data ? JSON.parse(data) : null;
            } catch {
              body = null;
            }
            if (res.statusCode && res.statusCode >= 400) {
              const detail = body?.errors
                ? JSON.stringify(body.errors)
                : body?.message ?? data.slice(0, 200);
              return reject(new Error(`PVE ${res.statusCode} ${path}: ${detail}`));
            }
            resolve((body?.data ?? body) as T);
          });
        },
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy(new Error('PVE request timed out'));
      });
      req.end();
    });
  }

  /* ---------------------------------------------------------------- */
  /* Mapping                                                          */
  /* ---------------------------------------------------------------- */

  private buildSpec(detail: PollDetail): ServerSpec {
    const node = detail.node;
    const cpuinfo = detail.status.cpuinfo ?? {};
    const cpuModel = cpuinfo['model name'] ?? 'Unknown CPU';
    const id = `pve-${node.node}`;
    const lxcCount = detail.lxc.filter((g) => g.status === 'running').length;
    const qemuCount = detail.qemu.filter((g) => g.status === 'running').length;

    return {
      id,
      serverId: uuid(`pve:${node.node}`),
      hostname: node.node,
      name: node.node,
      logo: '🟩',
      os: `${detail.status.kversion ?? 'Linux'}${detail.status.pveversion ? ` / ${detail.status.pveversion}` : ''}`,
      description: 'Proxmox VE node',
      role: 'hypervisor',
      capabilities: lxcCount > 0 ? ['virtualization', 'containerization'] : ['virtualization'],
      clusterId: 'proxmox-cluster',
      ip: this.nodeIp(detail.network),
      location: 'Proxmox Cluster',
      cpuModel,
      cpuCores: node.maxcpu || cpuinfo.cpus || 1,
      ramTotalGb: round(toFinite(node.maxmem) / 1e9, 1),
      diskTotalGb: round(toFinite(node.maxdisk) / 1e9, 1),
      sensors: this.sensorConfigs(detail.sensors),
      profile: {
        baseCpu: clamp((node.cpu ?? 0) * 100, 0, 100),
        cpuAmplitude: 0,
        cpuNoise: 0,
        baseRamGb: round(toFinite(node.mem) / 1e9, 1),
        ramDriftGb: 0,
        baseTemp: this.nodeTempC(detail.sensors),
        tempVariance: 0,
        baseNetUpMbps: round(this.rrdMbps(detail.rrd, 'netout'), 1),
        baseNetDownMbps: round(this.rrdMbps(detail.rrd, 'netin'), 1),
        netBurstRate: 0,
        processes: 0,
        containers: lxcCount,
        vms: qemuCount,
        reliability: 1,
      },
    };
  }

  private buildRuntime(detail: PollDetail, spec: ServerSpec): ServerRuntime {
    const node = detail.node;
    const online = node.status === 'online';
    const cpuPct = clamp((node.cpu ?? 0) * 100, 0, 100);
    const ramPct = toFinite(node.maxmem) > 0 ? (toFinite(node.mem) / toFinite(node.maxmem)) * 100 : 0;
    const diskPct = toFinite(node.maxdisk) > 0 ? (toFinite(node.disk) / toFinite(node.maxdisk)) * 100 : 0;
    const load = detail.status.loadavg?.[0] ?? detail.rrd[detail.rrd.length - 1]?.load1 ?? 0;
    const tempC = this.nodeTempC(detail.sensors);
    const netUpMbps = this.rrdMbps(detail.rrd, 'netout');
    const netDownMbps = this.rrdMbps(detail.rrd, 'netin');

    const status: ServerStatus = !online ? 'offline' : cpuPct > 90 || ramPct > 95 ? 'degraded' : 'online';
    const reachability: Reachability = !online ? 'unreachable' : 'accessible';
    const health = clamp(100 - (cpuPct > 85 ? 15 : 0) - (ramPct > 90 ? 15 : 0) - (diskPct > 92 ? 10 : 0), 0, 100);

    const prev = this.runtimes.get(spec.id);
    const push = (key: keyof ServerRuntime['history'], val: number): number[] => {
      const arr = prev?.history[key] ? [...prev.history[key]] : [];
      arr.push(val);
      if (arr.length > 360) arr.shift();
      return arr;
    };

    return {
      spec,
      status,
      reachability,
      health: round(health, 1),
      load: round(load, 2),
      uptimeSeconds: node.uptime ?? detail.status.uptime ?? 0,
      cpu: round(cpuPct, 1),
      ramUsedGb: round(toFinite(node.mem) / 1e9, 1),
      diskUsedGb: round(toFinite(node.disk) / 1e9, 1),
      tempC: round(tempC, 1),
      netUpMbps: round(netUpMbps, 1),
      netDownMbps: round(netDownMbps, 1),
      processes: 0,
      lastSeen: Date.now(),
      sensors: this.sensorReadings(detail.sensors),
      history: {
        cpu: push('cpu', round(cpuPct, 1)),
        ram: push('ram', round(ramPct, 1)),
        disk: push('disk', round(diskPct, 1)),
        temp: push('temp', round(tempC, 1)),
        netUp: push('netUp', round(netUpMbps, 1)),
        netDown: push('netDown', round(netDownMbps, 1)),
        load: push('load', round(load, 2)),
      },
    };
  }

  private emitTick(): void {
    const now = Date.now();
    const snapshots: MetricSnapshot[] = [...this.runtimes.values()].map((r) => ({
      serverId: r.spec.id,
      timestamp: now,
      cpu: toFinite(r.cpu),
      cpuCores: toFinite(r.spec.cpuCores, 1),
      ramUsedGb: toFinite(r.ramUsedGb),
      ramTotalGb: toFinite(r.spec.ramTotalGb, 1),
      diskUsedGb: toFinite(r.diskUsedGb),
      diskTotalGb: toFinite(r.spec.diskTotalGb, 1),
      tempC: toFinite(r.tempC),
      netUpMbps: toFinite(r.netUpMbps),
      netDownMbps: toFinite(r.netDownMbps),
      load: toFinite(r.load),
      uptimeSeconds: toFinite(r.uptimeSeconds),
      processes: toFinite(r.processes),
      status: r.status,
      reachability: r.reachability,
      health: toFinite(r.health),
      sensors: r.sensors,
    }));

    if (snapshots.length > 0) insertMetrics(snapshots);

    const notifications = this.generator.generate(snapshots, now);
    this.tickListeners.forEach((l) => l(snapshots));
    if (notifications.length > 0) this.notifListeners.forEach((l) => l(notifications));
  }

  private markAllUnreachable(): void {
    const now = Date.now();
    for (const [id, r] of this.runtimes) {
      this.runtimes.set(id, { ...r, status: 'offline', reachability: 'unreachable', health: 0, lastSeen: now });
    }
    if (this.runtimes.size > 0) this.emitTick();
  }

  /* ---------------------------------------------------------------- */
  /* Small mappers                                                    */
  /* ---------------------------------------------------------------- */

  private nodeIp(ifaces: PveNetworkIface[]): string {
    const active = ifaces.find((i) => i.active === 1 && i.address) ?? ifaces.find((i) => i.address);
    if (!active?.address) return '';
    return active.address.split('/')[0];
  }

  private nodeTempC(sensors: PveSensor[]): number {
    const temps = sensors.filter((s) => s.type === 'temperature');
    if (temps.length === 0) return 0;
    return Math.max(...temps.map((s) => s.value));
  }

  private rrdMbps(rrd: PveRrdPoint[], field: 'netin' | 'netout'): number {
    for (let i = rrd.length - 1; i >= 0; i--) {
      const v = rrd[i]?.[field];
      if (typeof v === 'number' && v > 0) return (v * 8) / 1e6;
    }
    return 0;
  }

  private sensorConfigs(sensors: PveSensor[]): SensorConfig[] {
    const out: SensorConfig[] = [];
    for (const s of sensors) {
      const mapped = mapSensor(s);
      if (!mapped) continue;
      out.push({ ...mapped, base: s.value, variance: 0 });
    }
    return out;
  }

  private sensorReadings(sensors: PveSensor[]): SensorReading[] {
    const out: SensorReading[] = [];
    for (const s of sensors) {
      const mapped = mapSensor(s);
      if (!mapped) continue;
      out.push({
        kind: mapped.kind,
        label: mapped.label,
        unit: mapped.unit,
        value: round(s.value, 1),
        available: true,
        warningThreshold: mapped.warningThreshold,
        criticalThreshold: mapped.criticalThreshold,
      });
    }
    return out;
  }

  /* ---------------------------------------------------------------- */
  /* MetricsProvider contract                                         */
  /* ---------------------------------------------------------------- */

  getServers(): ServerRuntime[] {
    return [...this.runtimes.values()];
  }

  getServer(id: string): ServerRuntime | undefined {
    return this.runtimes.get(id);
  }

  getHistory(serverId: string, range: HistoryRange): HistoryPoint[] {
    return historyForServer(serverId, range);
  }

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
      ? servers.reduce((a, s) => a + (s.spec.ramTotalGb > 0 ? (s.ramUsedGb / s.spec.ramTotalGb) * 100 : 0), 0) / servers.length
      : 0;
    const score = servers.length ? servers.reduce((a, s) => a + s.health, 0) / servers.length : 0;

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
    const guests = [...this.guests.values()].flat();
    const running = guests.filter((g) => g.running).length;

    const bw = getNetworkBandwidth();

    return [
      { id: 'servers', label: 'Nodes', value: h.totalServers, unit: '', delta: 0, tone: 'neutral' },
      { id: 'online', label: 'Online', value: h.onlineServers, unit: '', delta: 0, tone: 'good' },
      { id: 'containers', label: 'VMs & CTs', value: running, unit: '', delta: 0, tone: 'neutral',
        value2: 0, label2: 'CTs', unit2: '' },
      { id: 'cpu', label: 'Avg CPU', value: h.avgCpu, unit: '%', delta: 0, tone: h.avgCpu > 70 ? 'warn' : 'good' },
      { id: 'ram', label: 'Memory', value: round((totalRamUsed / Math.max(totalRam, 1)) * 100, 1), unit: '%', delta: 0, tone: 'good' },
      { id: 'download', label: 'Download', value: bw.downloadMbps, unit: 'Mbps', delta: 0, tone: 'neutral' },
      { id: 'upload', label: 'Upload', value: bw.uploadMbps, unit: 'Mbps', delta: 0, tone: 'neutral' },
      { id: 'uptime', label: 'Uptime', value: totalUptimeSeconds, unit: 'sec', delta: 0, tone: 'good' },
    ];
  }

  getNetwork(): { nodes: NetworkNode[]; links: NetworkLink[] } {
    const nodes: NetworkNode[] = [];
    const links: NetworkLink[] = [];

    nodes.push({ id: 'internet', label: 'Internet', type: 'internet', status: 'online', x: 50, y: 50, health: 100 });

    const servers = this.getServers();
    servers.forEach((s) => {
      nodes.push({
        id: s.spec.id,
        label: s.spec.name,
        type: 'hypervisor',
        status: s.status,
        x: 50,
        y: 50,
        parentId: 'internet',
        ip: s.spec.ip || undefined,
        health: s.health,
      });
      links.push({
        id: `internet-${s.spec.id}`,
        source: 'internet',
        target: s.spec.id,
        status: s.status === 'online' ? 'healthy' : s.status === 'degraded' ? 'warning' : 'critical',
        latencyMs: 1,
        throughputMbps: round(s.netUpMbps + s.netDownMbps, 1),
        jitterMs: 0.1,
        packetLoss: 0,
      });

      const guestList = (this.guests.get(s.spec.id) ?? []).slice(0, 20);
      guestList.forEach((g, gi) => {
        const gid = `${s.spec.id}-g${gi}`;
        nodes.push({
          id: gid,
          label: g.name,
          type: 'container',
          status: g.running ? 'online' : 'offline',
          x: 50,
          y: 50,
          parentId: s.spec.id,
          ip: s.spec.ip || undefined,
          health: g.running ? 100 : 0,
        });
        links.push({
          id: `${s.spec.id}-${gid}`,
          source: s.spec.id,
          target: gid,
          status: g.running ? 'healthy' : 'warning',
          latencyMs: 0.1,
          throughputMbps: 0,
          jitterMs: 0.05,
          packetLoss: 0,
        });
      });
    });

    return { nodes: applyLayout(nodes, calculateHierarchicalLayout(nodes, 100, 100)), links };
  }

  getClusters(): ClusterInfo[] {
    const servers = this.getServers();
    if (servers.length === 0) return [];
    const online = servers.filter((s) => s.status === 'online').length;
    const degraded = servers.filter((s) => s.status === 'degraded').length;
    const offline = servers.length - online - degraded;

    return [
      {
        id: 'proxmox-cluster',
        name: 'Proxmox Cluster',
        serverIds: servers.map((s) => s.spec.id),
        status: offline > 0 ? 'offline' : degraded > 0 ? 'degraded' : 'online',
        health: round(servers.reduce((a, s) => a + s.health, 0) / servers.length, 1),
        online,
        degraded,
        offline,
      },
    ];
  }

  getBootStats(): BootStats {
    return {
      historySeeded: true,
      historyPoints: countMetrics(),
      startedAt: this.startedAt,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Sensor mapping (lm-sensors on the node → dashboard sensor registry) */
/* ------------------------------------------------------------------ */

function mapSensor(
  s: PveSensor,
): Pick<SensorConfig, 'kind' | 'label' | 'unit' | 'warningThreshold' | 'criticalThreshold'> | null {
  const name = s.name.toLowerCase();
  switch (s.type) {
    case 'temperature':
      if (name.includes('gpu')) {
        return { kind: 'gpu_temp', label: `${s.name} Temperature`, unit: '°C', warningThreshold: 82, criticalThreshold: 92 };
      }
      if (/nvme|ssd|disk|hdd/.test(name)) {
        return { kind: 'disk_temp', label: `${s.name} Temp`, unit: '°C', warningThreshold: 60, criticalThreshold: 70 };
      }
      if (name.includes('nic') || name.includes('lan')) {
        return { kind: 'nic_temp', label: `${s.name} Temp`, unit: '°C', warningThreshold: 80, criticalThreshold: 90 };
      }
      return { kind: 'cpu_temp', label: `${s.name}`, unit: '°C', warningThreshold: 78, criticalThreshold: 88 };
    case 'fan':
      return { kind: 'fan_rpm', label: `${s.name}`, unit: 'rpm', warningThreshold: 2400, criticalThreshold: 2600 };
    case 'power':
      return { kind: 'power_consumption', label: `${s.name}`, unit: 'W', warningThreshold: 320, criticalThreshold: 360 };
    default:
      return null;
  }
}
