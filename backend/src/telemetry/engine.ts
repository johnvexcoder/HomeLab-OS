import { SERVER_SPECS, INITIAL_UPTIME_SECONDS, MOCK_SERVER_CONTAINERS } from '../mock-data/servers';
import type { MetricSnapshot, ServerRuntime, ServerSpec, NetworkLink, NetworkNode, SensorConfig, SensorReading, SensorKind } from '../types';
import { clamp, jitter, lerp, round, smoothNoise, applyBurst } from './random';
import { buildTopology, NODE_TO_SERVER } from '../mock-data/network';

/**
 * The live simulation engine. Owns all mutable runtime state (servers, network,
 * health, uptime). A tick advances every server one step and produces a batch of
 * snapshots ready to be broadcast + persisted.
 */
export class TelemetryEngine {
  readonly servers = new Map<string, ServerRuntime>();
  private tickCount = 0;
  /** simulated sensor read failures: serverId -> kind -> unavailable until (ts) */
  private sensorFailures = new Map<string, Map<SensorKind, number>>();

  constructor() {
    for (const spec of SERVER_SPECS) {
      this.servers.set(spec.id, this.initServer(spec));
    }
  }

  private initServer(spec: ServerSpec): ServerRuntime {
    const p = spec.profile;
    const ramUsedGb = round(p.baseRamGb * (0.95 + Math.random() * 0.1), 2);
    const diskUsedGb = round(spec.diskTotalGb * (0.42 + Math.random() * 0.1), 0);
    const net = 100; // history window length

    const containers = MOCK_SERVER_CONTAINERS[spec.id]
      ? MOCK_SERVER_CONTAINERS[spec.id].map((c) => ({ ...c }))
      : undefined;

    return {
      spec,
      status: 'online',
      reachability: 'accessible',
      health: round(96 + Math.random() * 3, 1),
      load: round(p.baseCpu * 0.7, 1),
      uptimeSeconds: INITIAL_UPTIME_SECONDS[spec.id] ?? 86400,
      cpu: round(p.baseCpu, 1),
      ramUsedGb,
      diskUsedGb,
      tempC: round(p.baseTemp, 1),
      netUpMbps: round(p.baseNetUpMbps * 0.8, 0),
      netDownMbps: round(p.baseNetDownMbps * 0.8, 0),
      processes: p.processes,
      lastSeen: Date.now(),
      sensors: this.generateSensors(spec, p.baseCpu, p.baseTemp, p.baseNetDownMbps, 0),
      history: {
        cpu: Array.from({ length: net }, () => round(p.baseCpu + jitter(Math.random, p.cpuAmplitude * 0.5), 1)),
        ram: Array.from({ length: net }, () => round((ramUsedGb / spec.ramTotalGb) * 100, 1)),
        disk: Array.from({ length: net }, () => round((diskUsedGb / spec.diskTotalGb) * 100, 1)),
        temp: Array.from({ length: net }, () => round(p.baseTemp + jitter(Math.random, p.tempVariance * 0.5), 1)),
        netUp: Array.from({ length: net }, () => round(p.baseNetUpMbps * (0.7 + Math.random() * 0.5), 0)),
        netDown: Array.from({ length: net }, () => round(p.baseNetDownMbps * (0.7 + Math.random() * 0.5), 0)),
        load: Array.from({ length: net }, () => round(p.baseCpu * (0.6 + Math.random() * 0.6), 1)),
      },
      containers,
    };
  }

  /**
   * Advance the simulation one step (called every TELEMETRY_INTERVAL_MS).
   * Returns one snapshot per server.
   */
  tick(intervalSeconds: number): MetricSnapshot[] {
    this.tickCount++;
    const t = this.tickCount;
    const snapshots: MetricSnapshot[] = [];

    // First pass: advance physical hypervisors & spine nodes
    for (const srv of this.servers.values()) {
      const spec = srv.spec;
      const p = spec.profile;
      const r = Math.random;
      const phase = t * 0.08 + this.hash(spec.id);

      // --- CPU: smooth organic wave + noise ----------------------------------
      const wave = (smoothNoise(t * 0.015, phase) * 2 - 1) * p.cpuAmplitude;
      let cpu = p.baseCpu + wave + jitter(r, p.cpuNoise);
      cpu = clamp(cpu, 2, 98);

      // --- RAM: gentle drift towards baseline --------------------------------
      let ramUsedGb = lerp(srv.ramUsedGb, p.baseRamGb + jitter(r, p.ramDriftGb), 0.05);
      ramUsedGb = clamp(ramUsedGb, 0.5, spec.ramTotalGb * 0.95);

      // --- Disk: slow steady baseline ---------------------------------------
      const diskUsedGb = srv.diskUsedGb;

      // --- Temperature: hypervisors calculate from CPU; VMs inherit from parent
      let tempC = srv.tempC;
      if (spec.role === 'hypervisor' || spec.role === 'gateway' || spec.role === 'switch') {
        const tempTarget = p.baseTemp + (cpu / 100) * 12 + jitter(r, p.tempVariance);
        tempC = round(lerp(srv.tempC, tempTarget, 0.12), 1);
      }

      // --- Network: smooth throughput with occasional realistic bursts ------
      let netUp = applyBurst(r, p.baseNetUpMbps + jitter(r, p.baseNetUpMbps * 0.15), p.netBurstRate, p.baseNetUpMbps * 1.5, 10000);
      let netDown = applyBurst(r, p.baseNetDownMbps + jitter(r, p.baseNetDownMbps * 0.15), p.netBurstRate, p.baseNetDownMbps * 1.5, 10000);
      netUp = Math.max(0, round(netUp, 0));
      netDown = Math.max(0, round(netDown, 0));

      const health = this.computeHealth(srv, cpu, ramUsedGb, spec.ramTotalGb, tempC);
      const status = health >= 75 ? 'online' : health >= 45 ? 'degraded' : 'offline';
      const reachability = status === 'offline' ? 'unreachable' : status === 'degraded' ? 'degraded' : 'accessible';
      const load = round((cpu / 100) * spec.cpuCores * 0.7, 2);
      const processes = Math.max(2, p.processes + Math.round(jitter(r, 4)));
      const uptimeSeconds = srv.uptimeSeconds + intervalSeconds;

      srv.status = status;
      srv.reachability = reachability;
      srv.health = health;
      srv.load = load;
      srv.cpu = round(cpu, 1);
      srv.ramUsedGb = round(ramUsedGb, 2);
      srv.diskUsedGb = round(diskUsedGb, 1);
      srv.tempC = round(tempC, 1);
      srv.netUpMbps = netUp;
      srv.netDownMbps = netDown;
      srv.processes = processes;
      srv.uptimeSeconds = uptimeSeconds;
      srv.lastSeen = Date.now();
      srv.sensors = this.generateSensors(spec, cpu, tempC, netDown, t);
    }

    // Second pass: reflect parent temperature onto child VMs
    for (const srv of this.servers.values()) {
      if (srv.spec.parentId) {
        const parent = this.servers.get(srv.spec.parentId);
        if (parent && parent.tempC > 0) {
          srv.tempC = parent.tempC;
        }
      }

      // Update history ring buffer
      srv.history = {
        cpu: [...srv.history.cpu.slice(1), srv.cpu],
        ram: [...srv.history.ram.slice(1), round((srv.ramUsedGb / srv.spec.ramTotalGb) * 100, 1)],
        disk: [...srv.history.disk.slice(1), round((srv.diskUsedGb / srv.spec.diskTotalGb) * 100, 1)],
        temp: [...srv.history.temp.slice(1), srv.tempC],
        netUp: [...srv.history.netUp.slice(1), srv.netUpMbps],
        netDown: [...srv.history.netDown.slice(1), srv.netDownMbps],
        load: [...srv.history.load.slice(1), srv.load],
      };

      snapshots.push({
        serverId: srv.spec.id,
        timestamp: Date.now(),
        cpu: srv.cpu,
        cpuCores: srv.spec.cpuCores,
        ramUsedGb: srv.ramUsedGb,
        ramTotalGb: srv.spec.ramTotalGb,
        diskUsedGb: srv.diskUsedGb,
        diskTotalGb: srv.spec.diskTotalGb,
        tempC: srv.tempC,
        netUpMbps: srv.netUpMbps,
        netDownMbps: srv.netDownMbps,
        load: srv.load,
        uptimeSeconds: srv.uptimeSeconds,
        processes: srv.processes,
        status: srv.status,
        reachability: srv.reachability,
        health: srv.health,
        sensors: srv.sensors,
      });
    }

    return snapshots;
  }

  /**
   * Generate optional hardware readings for a server.
   */
  private generateSensors(
    spec: ServerSpec,
    cpu: number,
    tempC: number,
    netDown: number,
    tick: number,
  ): SensorReading[] {
    const now = Date.now();
    const r = Math.random;

    if (r() < 0.0005) {
      const failures = this.sensorFailures.get(spec.id) ?? new Map<SensorKind, number>();
      const kind = spec.sensors[Math.floor(r() * spec.sensors.length)].kind;
      failures.set(kind, now + 6000 + r() * 24000);
      this.sensorFailures.set(spec.id, failures);
    }
    const failures = this.sensorFailures.get(spec.id);

    return spec.sensors.map((cfg: SensorConfig): SensorReading => {
      const unavailableUntil = failures?.get(cfg.kind);
      const available = !unavailableUntil || now > unavailableUntil;

      if (!available) {
        return {
          kind: cfg.kind,
          label: cfg.label,
          unit: cfg.unit,
          value: null,
          available: false,
          warningThreshold: cfg.warningThreshold,
          criticalThreshold: cfg.criticalThreshold,
        };
      }

      const driver = this.sensorDriver(cfg, cpu, tempC, netDown);
      const value = clamp(
        cfg.base + driver * (cfg.correlation ?? 0) * cfg.base * 0.6 + jitter(r, cfg.variance * 0.5),
        Math.max(0, cfg.base * 0.5),
        cfg.base * 2.5,
      );

      return {
        kind: cfg.kind,
        label: cfg.label,
        unit: cfg.unit,
        value: round(value, cfg.unit === 'rpm' ? 0 : 1),
        available: true,
        warningThreshold: cfg.warningThreshold,
        criticalThreshold: cfg.criticalThreshold,
      };
    });
  }

  private sensorDriver(cfg: SensorConfig, cpu: number, tempC: number, netDown: number): number {
    switch (cfg.correlatesWith) {
      case 'cpu':
        return cpu / 100;
      case 'net':
        return Math.min(1, netDown / 1000);
      case 'temp':
      default:
        return Math.min(1, Math.max(0, (tempC - 25) / 50));
    }
  }

  /**
   * Produce the current network topology.
   */
  getNetwork(): { nodes: NetworkNode[]; links: NetworkLink[] } {
    const { nodes, links } = buildTopology((serverId) => this.servers.get(serverId));

    const nodeStatus = (nodeId: string) => {
      const serverId = NODE_TO_SERVER[nodeId] ?? nodeId;
      return this.servers.get(serverId)?.status;
    };

    const derived = links.map((link) => {
      const src = nodeStatus(link.source);
      const dst = nodeStatus(link.target);
      let status: NetworkLink['status'] = 'healthy';
      if (src === 'offline' || dst === 'offline') status = 'critical';
      else if (src === 'degraded' || dst === 'degraded') status = 'warning';

      const jitterMs = Math.random() * 0.4;
      return {
        ...link,
        status,
        latencyMs: round((link.latencyMs || 0.1) + jitterMs, 1),
        throughputMbps: Math.round((link.throughputMbps || 100) * (0.85 + Math.random() * 0.3)),
      };
    });

    return { nodes, links: derived };
  }

  private computeHealth(srv: ServerRuntime, cpu: number, ramUsedGb: number, ramTotalGb: number, tempC: number): number {
    const ramPct = (ramUsedGb / ramTotalGb) * 100;
    let score = srv.health;
    const target =
      100
      - Math.max(0, (cpu - 80)) * 0.6
      - Math.max(0, (ramPct - 85)) * 0.5
      - Math.max(0, (tempC - 70)) * 0.4;
    score = lerp(score, clamp(target, 0, 100), 0.05);
    return round(clamp(score, 0, 100), 1);
  }

  private hash(str: string): number {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    }
    return h & 0x7fffffff;
  }
}
