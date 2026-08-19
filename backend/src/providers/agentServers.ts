import { getDb } from '../db/database';
import type { ServerRuntime, Notification } from '../types';

const STALE_THRESHOLD_MS = 60_000;

interface AgentRow {
  id: string;
  host_id: string;
  host_name: string;
  ip: string;
  os: string;
  host_type: string;
  cpu_cores: number;
  ram_total_gb: number;
  cpu_usage: number;
  ram_used_gb: number;
  disk_used_gb: number;
  disk_total_gb: number;
  net_down_mbps: number;
  net_up_mbps: number;
  uptime_seconds: number;
  temp_c: number | null;
  load_1: number;
  containers_json: string;
  status: string;
  last_report_at: number | null;
  plugins_json: string;
}

/** Logo per host type. */
function hostLogo(hostType: string): string {
  switch (hostType) {
    case 'proxmox': return '🟩';
    case 'debian':
    case 'ubuntu':
    case 'linux': return '🐧';
    case 'docker': return '🐳';
    default: return '🖥️';
  }
}

/** Read all online agents from the DB and convert them to ServerRuntime
 *  objects that the dashboard can render alongside Proxmox-discovered servers. */
export function getAgentServers(existingIds: Set<string>): ServerRuntime[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM agents WHERE last_report_at IS NOT NULL ORDER BY host_name ASC`,
  ).all() as AgentRow[];

  const now = Date.now();
  const runtimes: ServerRuntime[] = [];

  for (const row of rows) {
    const age = now - (row.last_report_at ?? 0);
    const online = row.status === 'online' && age < STALE_THRESHOLD_MS;
    const health = online
      ? clamp(100
          - (row.cpu_usage > 85 ? 15 : 0)
          - (row.ram_total_gb > 0 && (row.ram_used_gb / row.ram_total_gb) * 100 > 90 ? 15 : 0)
          - (row.disk_total_gb > 0 && (row.disk_used_gb / row.disk_total_gb) * 100 > 92 ? 10 : 0),
        0, 100)
      : 0;

    const cpuPct = clamp(row.cpu_usage, 0, 100);
    const ramPct = row.ram_total_gb > 0 ? (row.ram_used_gb / row.ram_total_gb) * 100 : 0;
    const diskPct = row.disk_total_gb > 0 ? (row.disk_used_gb / row.disk_total_gb) * 100 : 0;

    const id = `agent-${row.host_id}`;
    if (existingIds.has(id)) continue;

    const containers = safeJson<{ id: string; name: string; running: boolean; image: string; ports?: string[] }[]>(row.containers_json, []);

    const spec: ServerRuntime['spec'] = {
      id,
      serverId: row.id,
      hostname: row.host_name,
      name: row.host_name,
      logo: hostLogo(row.host_type),
      os: row.os || row.host_type,
      description: `HomeLab Agent on ${row.host_name}`,
      role: containers.length > 0 ? 'docker' : 'server',
      capabilities: ['monitoring'],
      clusterId: null,
      ip: row.ip,
      location: 'Agent',
      cpuModel: `${row.host_type} (${row.cpu_cores || '?'} cores)`,
      cpuCores: row.cpu_cores || 1,
      ramTotalGb: row.ram_total_gb || 1,
      diskTotalGb: row.disk_total_gb || 1,
      sensors: [],
      profile: {
        baseCpu: cpuPct,
        cpuAmplitude: 0,
        cpuNoise: 0,
        baseRamGb: row.ram_used_gb,
        ramDriftGb: 0,
        baseTemp: row.temp_c ?? 0,
        tempVariance: 0,
        baseNetUpMbps: row.net_up_mbps,
        baseNetDownMbps: row.net_down_mbps,
        netBurstRate: 0,
        processes: 0,
        containers: containers.filter((c) => c.running).length,
        vms: 0,
        reliability: 1,
      },
    };

    const prev = new Map<string, number[]>();
    const push = (key: keyof ServerRuntime['history'], val: number): number[] => {
      const arr = prev.get(key) ?? [];
      arr.push(val);
      if (arr.length > 360) arr.shift();
      prev.set(key, arr);
      return arr;
    };

    const runtime: ServerRuntime = {
      spec,
      status: online ? (cpuPct > 90 || ramPct > 95 ? 'degraded' : 'online') : 'offline',
      reachability: online ? 'accessible' : 'unreachable',
      health: round(health),
      load: round(row.load_1, 2),
      uptimeSeconds: row.uptime_seconds || 0,
      cpu: round(cpuPct),
      ramUsedGb: round(row.ram_used_gb, 1),
      diskUsedGb: round(row.disk_used_gb, 1),
      tempC: row.temp_c ?? 0,
      netUpMbps: round(row.net_up_mbps, 1),
      netDownMbps: round(row.net_down_mbps, 1),
      processes: 0,
      lastSeen: row.last_report_at ?? now,
      sensors: [],
      history: {
        cpu: push('cpu', round(cpuPct)),
        ram: push('ram', round(ramPct)),
        disk: push('disk', round(diskPct)),
        temp: push('temp', row.temp_c ?? 0),
        netUp: push('netUp', round(row.net_up_mbps)),
        netDown: push('netDown', round(row.net_down_mbps)),
        load: push('load', round(row.load_1, 2)),
      },
    };

    runtimes.push(runtime);
  }

  return runtimes;
}

/** Build Docker host profiles from agents that report Docker containers. */
export function getAgentDockerHostProfiles(): Array<{
  hostName: string;
  hostIp: string;
  netDownMbps: number;
  netUpMbps: number;
  containers: Array<{ id: string; name: string; running: boolean; image: string; ports?: string[] }>;
}> {
  const db = getDb();
  const rows = db.prepare(
    `SELECT host_name, ip, containers_json, net_down_mbps, net_up_mbps, status, last_report_at
     FROM agents WHERE containers_json != '[]' AND containers_json != '' AND last_report_at IS NOT NULL`,
  ).all() as Array<{
    host_name: string;
    ip: string;
    containers_json: string;
    net_down_mbps: number;
    net_up_mbps: number;
    status: string;
    last_report_at: number;
  }>;

  const now = Date.now();
  const profiles: Array<{
    hostName: string;
    hostIp: string;
    netDownMbps: number;
    netUpMbps: number;
    containers: Array<{ id: string; name: string; running: boolean; image: string; ports?: string[] }>;
  }> = [];

  for (const row of rows) {
    const age = now - (row.last_report_at ?? 0);
    if (row.status !== 'online' || age > STALE_THRESHOLD_MS) continue;

    const containers = safeJson<Array<{ id: string; name: string; running: boolean; image: string; ports?: string[] }>>(
      row.containers_json, [],
    );
    if (containers.length === 0) continue;

    profiles.push({
      hostName: row.host_name,
      hostIp: row.ip,
      netDownMbps: row.net_down_mbps,
      netUpMbps: row.net_up_mbps,
      containers,
    });
  }

  return profiles;
}

function safeJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function round(v: number, d = 1): number {
  if (!Number.isFinite(v)) return 0;
  const f = 10 ** d;
  return Math.round(v * f) / f;
}
