import { randomUUID } from 'node:crypto';
import type { ProviderDiagnostics } from './types';
import {
  DockerClient,
  type DockerContainer,
  type DockerContainerStats,
  type DockerHostInfo,
} from './dockerClient';
import { getBoolSetting, setSetting } from '../security/settings';
import { config } from '../config';
import type { MetricSnapshot, Reachability, ServerRuntime, ServerStatus } from '../types';

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
const round = (v: number, d = 1): number => {
  if (!Number.isFinite(v)) return 0;
  const f = 10 ** d;
  return Math.round(v * f) / f;
};
const toFinite = (v: number, fallback = 0): number => (Number.isFinite(v) ? v : fallback);

/**
 * Polls the Docker Engine API (over the mounted unix socket by default) and
 * keeps the latest container list + host-level metrics. The composite provider
 * merges the containers onto the map AND surfaces this host as its own server
 * (e.g. `docker01`) with live CPU/memory/network derived from per-container
 * usage deltas sampled between polls.
 *
 * Control flow: the provider only runs when DOCKER_ENABLED=true. On its first
 * successful connect it auto-enables the `docker_monitoring` feature flag, so
 * the user gets the Docker layer with zero manual toggling — while still being
 * able to switch it off from Configuration → Features.
 */
export class DockerMetricsProvider {
  private readonly client: DockerClient;
  private readonly host: string;
  private readonly pollIntervalMs: number;
  private interval: NodeJS.Timeout | null = null;
  private polling = false;
  private autoEnabled = false;
  private startedAt = 0;

  private containers: DockerContainer[] = [];
  private hostInfo: DockerHostInfo | null = null;
  private diskUsedGb = 0;
  private cpuPct = 0;
  private memUsedGb = 0;
  private netUpMbps = 0;
  private netDownMbps = 0;
  private lastPollAt: number | null = null;
  private lastPollError: string | null = null;
  private lastErrorAt: number | null = null;
  private prevStats: Record<string, DockerContainerStats> = {};
  private prevNetAt = 0;
  private prevRx = 0;
  private prevTx = 0;
  private serverId: string | null = null;
  private runtime: ServerRuntime | null = null;

  private history: ServerRuntime['history'] = {
    cpu: [],
    ram: [],
    disk: [],
    temp: [],
    netUp: [],
    netDown: [],
    load: [],
  };

  constructor() {
    this.host = config.docker.host;
    this.pollIntervalMs = config.docker.pollIntervalMs;
    this.client = new DockerClient(this.host);
  }

  /** The feature flag lives in the DB — docker nodes appear only while it's on. */
  private featureEnabled(): boolean {
    return getBoolSetting('feature.docker_monitoring');
  }

  async start(): Promise<void> {
    this.startedAt = Date.now();
    await this.poll();
    this.interval = setInterval(() => {
      void this.poll();
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    if (!this.featureEnabled()) {
      this.containers = [];
      this.hostInfo = null;
      this.lastPollError = null;
      return;
    }
    this.polling = true;
    const started = Date.now();
    try {
      await this.client.ping();
      this.containers = await this.client.listContainers();
      const [info, disk] = await Promise.all([this.client.getInfo(), this.client.getDiskUsage()]);
      this.hostInfo = info;
      this.diskUsedGb = round(toFinite(disk.used) / 1e9, 1);

      const running = this.containers.filter((c) => c.running);
      const stats = (
        await Promise.all(running.map((c) => this.client.getContainerStats(c.id)))
      ).filter((s): s is DockerContainerStats => s !== null);

      this.computeDeltas(stats, started);
      this.runtime = this.buildRuntime(started);

      this.lastPollError = null;
      this.lastPollAt = started;
      this.lastErrorAt = null;
      if (!this.autoEnabled) {
        this.autoEnabled = true;
        setSetting('feature.docker_monitoring', 'true');
        console.log('[docker] first successful connect — enabled Docker Monitoring feature flag');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.lastPollError = message;
      this.lastErrorAt = started;
      this.containers = [];
      this.hostInfo = null;
      console.warn(`[docker] poll failed: ${message}`);
    } finally {
      this.polling = false;
    }
  }

  /** Compute host CPU/network from per-container deltas against the previous poll. */
  private computeDeltas(stats: DockerContainerStats[], now: number): void {
    const prev = this.prevStats;
    let cpuSum = 0;
    let memSum = 0;
    let rx = 0;
    let tx = 0;

    for (const s of stats) {
      memSum += s.memUsed;
      rx += s.netRxBytes;
      tx += s.netTxBytes;
      const p = prev[s.id];
      if (p && p.cpuTotal > 0 && s.cpuTotal >= p.cpuTotal && s.systemCpu > p.systemCpu) {
        const cpuDelta = s.cpuTotal - p.cpuTotal;
        const sysDelta = s.systemCpu - p.systemCpu;
        const cpus = s.onlineCpus > 0 ? s.onlineCpus : 1;
        cpuSum += (cpuDelta / sysDelta) * cpus * 100;
      }
      prev[s.id] = s;
    }
    this.prevStats = prev;

    const dt = (now - this.prevNetAt) / 1000;
    if (this.prevNetAt > 0 && dt > 0 && (rx >= this.prevRx || tx >= this.prevTx)) {
      this.netDownMbps = round(((rx - this.prevRx) * 8) / dt / 1e6, 2);
      this.netUpMbps = round(((tx - this.prevTx) * 8) / dt / 1e6, 2);
    } else {
      this.netDownMbps = 0;
      this.netUpMbps = 0;
    }
    this.prevNetAt = now;
    this.prevRx = rx;
    this.prevTx = tx;

    this.cpuPct = round(clamp(cpuSum, 0, 100), 1);
    this.memUsedGb = round(memSum / 1e9, 2);
  }

  /** Build the host runtime for the current poll and roll its history ring. */
  private buildRuntime(now: number): ServerRuntime | null {
    const info = this.hostInfo;
    if (!info) return null;
    const online = this.lastPollError === null;
    const ramTotalGb = round(toFinite(info.memTotal) / 1e9, 1);
    const ramPct = ramTotalGb > 0 ? (this.memUsedGb / ramTotalGb) * 100 : 0;
    const status: ServerStatus = online ? (this.cpuPct > 90 || ramPct > 95 ? 'degraded' : 'online') : 'offline';
    const reachability: Reachability = online ? 'accessible' : 'unreachable';
    const health = online ? clamp(100 - (this.cpuPct > 85 ? 15 : 0) - (ramPct > 90 ? 15 : 0), 0, 100) : 0;
    const running = this.containers.filter((c) => c.running).length;

    const name = info.name || 'docker';
    const id = `docker-${name}`;
    if (!this.serverId) this.serverId = randomUUID();
    const push = (key: keyof ServerRuntime['history'], val: number): number[] => {
      const arr = [...this.history[key]];
      arr.push(val);
      if (arr.length > 360) arr.shift();
      return arr;
    };

    const spec: ServerRuntime['spec'] = {
      id,
      serverId: this.serverId,
      hostname: name,
      name,
      logo: '🐳',
      os: [info.os, info.kernel].filter(Boolean).join(' / '),
      description: 'Docker host',
      role: 'docker',
      capabilities: ['containerization'],
      clusterId: null,
      ip: '',
      location: 'Docker',
      cpuModel: `Docker ${info.dockerVersion} (${info.architecture})`,
      cpuCores: info.ncpu,
      ramTotalGb,
      diskTotalGb: 0,
      sensors: [],
      profile: {
        baseCpu: this.cpuPct,
        cpuAmplitude: 0,
        cpuNoise: 0,
        baseRamGb: this.memUsedGb,
        ramDriftGb: 0,
        baseTemp: 0,
        tempVariance: 0,
        baseNetUpMbps: this.netUpMbps,
        baseNetDownMbps: this.netDownMbps,
        netBurstRate: 0,
        processes: this.containers.length,
        containers: running,
        vms: 0,
        reliability: 1,
      },
    };

    this.history = {
      cpu: push('cpu', this.cpuPct),
      ram: push('ram', round(ramPct, 1)),
      disk: push('disk', this.diskUsedGb),
      temp: push('temp', 0),
      netUp: push('netUp', this.netUpMbps),
      netDown: push('netDown', this.netDownMbps),
      load: push('load', round(this.cpuPct / 100, 2)),
    };

    return {
      spec,
      status,
      reachability,
      health: round(health, 1),
      load: round(this.cpuPct / 100, 2),
      uptimeSeconds: Math.max(0, Math.floor((now - this.startedAt) / 1000)),
      cpu: this.cpuPct,
      ramUsedGb: this.memUsedGb,
      diskUsedGb: this.diskUsedGb,
      tempC: 0,
      netUpMbps: this.netUpMbps,
      netDownMbps: this.netDownMbps,
      processes: this.containers.length,
      lastSeen: now,
      sensors: [],
      history: this.history,
    };
  }

  getContainers(): DockerContainer[] {
    return this.containers;
  }

  /** The Docker host itself (e.g. docker01) as a full server runtime. */
  getHostRuntime(): ServerRuntime | null {
    return this.runtime;
  }

  getHostSnapshot(): MetricSnapshot | null {
    const runtime = this.runtime;
    if (!runtime) return null;
    return {
      serverId: runtime.spec.id,
      timestamp: Date.now(),
      cpu: toFinite(runtime.cpu),
      cpuCores: toFinite(runtime.spec.cpuCores, 1),
      ramUsedGb: toFinite(runtime.ramUsedGb),
      ramTotalGb: toFinite(runtime.spec.ramTotalGb, 1),
      diskUsedGb: toFinite(runtime.diskUsedGb),
      diskTotalGb: toFinite(runtime.spec.diskTotalGb, 1),
      tempC: toFinite(runtime.tempC),
      netUpMbps: toFinite(runtime.netUpMbps),
      netDownMbps: toFinite(runtime.netDownMbps),
      load: toFinite(runtime.load),
      uptimeSeconds: toFinite(runtime.uptimeSeconds),
      processes: toFinite(runtime.processes),
      status: runtime.status,
      reachability: runtime.reachability,
      health: toFinite(runtime.health),
      sensors: [],
    };
  }

  getSourceName(): string {
    return this.featureEnabled() ? `docker (${this.host})` : 'docker (disabled)';
  }

  getDiagnostics(): ProviderDiagnostics {
    return {
      lastPollAt: this.lastPollAt,
      lastPollError: this.lastPollError,
      endpointErrors: this.lastPollError
        ? { [`${this.host} — docker daemon`]: this.lastPollError }
        : {},
    };
  }
}
