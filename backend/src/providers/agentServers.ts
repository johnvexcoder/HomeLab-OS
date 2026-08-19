import { getDb } from '../db/database';
import type { ServerRuntime } from '../types';

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
  vm_id: string;
  parent_ip: string;
  virt_type: string;
}

/** Proxmox guest (VM/CT) from the Proxmox provider. */
interface ProxmoxGuest {
  vmid: string;
  name: string;
  ip?: string;
  running: boolean;
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

function safeJson<T>(raw: string, fallback: T): T {
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function round(v: number, d = 1): number {
  if (!Number.isFinite(v)) return 0;
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

/**
 * Build a mapping of Proxmox guest VMID -> guest info by querying the DB
 * for servers that look like Proxmox guests.
 * Note: This is a best-effort correlation. The primary source of truth is
 * the Proxmox provider's `guests` map, but we don't have direct access here.
 * We use IP + name matching from the agents table.
 */
function getProxmoxGuestMap(): Map<string, ProxmoxGuest> {
  const db = getDb();
  // The Proxmox guests are stored as servers with IDs like "pve-pve0-g0"
  // We can't easily get the VMID from the DB alone without the provider.
  // Instead, we'll do correlation in getAgentServers by receiving the guest map as a parameter.
  return new Map();
}

/** Check if an agent's IP matches a Proxmox guest IP. */
function matchAgentToProxmoxGuest(
  agent: AgentRow,
  proxmoxGuests: Map<string, ProxmoxGuest>
): ProxmoxGuest | null {
  // Strategy 1: Match by VMID if agent reports it
  if (agent.vm_id) {
    for (const [, guest] of proxmoxGuests) {
      if (guest.vmid === agent.vm_id) return guest;
    }
  }

  // Strategy 2: Match by IP (agent's IP = guest's IP)
  for (const [, guest] of proxmoxGuests) {
    if (guest.ip && guest.ip === agent.ip) return guest;
  }

  // Strategy 3: Match by parent IP (agent's parent_ip = Proxmox node IP)
  // and agent's VMID matches a guest on that node
  if (agent.parent_ip && agent.vm_id) {
    for (const [, guest] of proxmoxGuests) {
      if (guest.vmid === agent.vm_id) return guest; // already checked
    }
  }

  return null;
}

/**
 * Read all online agents from the DB and convert them to ServerRuntime
 * objects. Agents that correlate with a Proxmox VM are MERGED into that
 * VM's server entry (enriching it with sensor data, Docker containers, etc.)
 * instead of creating duplicate entries.
 */
export function getAgentServers(
  existingIds: Set<string>,
  proxmoxServers: ServerRuntime[],
  proxmoxGuests: Map<string, ProxmoxGuest>
): ServerRuntime[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM agents WHERE last_report_at IS NOT NULL ORDER BY host_name ASC`,
  ).all() as AgentRow[];

  const now = Date.now();
  const runtimes: ServerRuntime[] = [];

  // Build a lookup of existing server IPs for correlation
  const serverByIp = new Map<string, ServerRuntime>();
  for (const s of proxmoxServers) {
    if (s.spec.ip) serverByIp.set(s.spec.ip, s);
    // Also index guests by their IPs
    // Note: We don't have guest IPs easily, so we rely on proxmoxGuests map
  }

  for (const row of rows) {
    const age = now - (row.last_report_at ?? 0);
    const online = row.status === 'online' && age < STALE_THRESHOLD_MS;
    if (!online) continue;

    // Try to correlate this agent with a Proxmox guest
    const matchedGuest = matchAgentToProxmoxGuest(row, proxmoxGuests);

    if (matchedGuest) {
      // Find the Proxmox server that owns this guest
      const parentServer = proxmoxServers.find(s =>
        s.spec.id === `pve-${matchedGuest.vmid.split('-')[0]}` ||
        (s.spec.id.startsWith('pve-') && Array.from(proxmoxGuests.values()).some(g => g.vmid === matchedGuest.vmid))
      );

      // If we can't find the parent server easily, just use IP correlation
      let targetServer = parentServer;
      if (!targetServer && matchedGuest.ip) {
        targetServer = serverByIp.get(matchedGuest.ip);
      }

      if (targetServer) {
        // MERGE: Enrich the existing Proxmox server with agent data
        enrichServerWithAgent(targetServer, row);
        continue; // Don't create a separate entry
      }
    }

    // No correlation found — this is a standalone agent server (e.g., docker02 on bare metal)
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
      location: row.virt_type ? `VM (${row.virt_type})` : 'Agent',
      cpuModel: `${row.host_type} (${row.cpu_cores || '?'} cores)`,
      cpuCores: row.cpu_cores || 1,
      ramTotalGb: row.ram_total_gb || 1,
      diskTotalGb: row.disk_total_gb || 1,
      sensors: [],
      profile: {
        baseCpu: clamp(row.cpu_usage, 0, 100),
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

    const cpuPct = clamp(row.cpu_usage, 0, 100);
    const ramPct = row.ram_total_gb > 0 ? (row.ram_used_gb / row.ram_total_gb) * 100 : 0;
    const diskPct = row.disk_total_gb > 0 ? (row.disk_used_gb / row.disk_total_gb) * 100 : 0;
    const health = clamp(100 - (cpuPct > 85 ? 15 : 0) - (ramPct > 90 ? 15 : 0) - (diskPct > 92 ? 10 : 0), 0, 100);

    const runtime: ServerRuntime = {
      spec,
      status: cpuPct > 90 || ramPct > 95 ? 'degraded' : 'online',
      reachability: 'accessible',
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

/**
 * Enrich an existing Proxmox server with agent-reported data.
 * Agent data is MORE ACCURATE for: CPU temp, sensors, Docker containers, processes
 * Proxmox data is MORE ACCURATE for: allocated resources (cores, RAM, disk), VM list
 */
function enrichServerWithAgent(server: ServerRuntime, agent: AgentRow): void {
  const containers = safeJson<{ id: string; name: string; running: boolean; image: string; ports?: string[] }[]>(agent.containers_json, []);

  // Update spec with agent-enriched data
  server.spec.description = `Proxmox VM + HomeLab Agent on ${agent.host_name}`;
  server.spec.os = agent.os || server.spec.os;
  server.spec.cpuModel = `${agent.host_type} (${agent.cpu_cores || server.spec.cpuCores} cores)`;
  server.spec.cpuCores = agent.cpu_cores || server.spec.cpuCores;
  server.spec.ramTotalGb = agent.ram_total_gb || server.spec.ramTotalGb;
  server.spec.diskTotalGb = agent.disk_total_gb || server.spec.diskTotalGb;

  // Update runtime with agent's more accurate readings
  server.cpu = clamp(agent.cpu_usage, 0, 100);
  server.ramUsedGb = round(agent.ram_used_gb, 1);
  server.diskUsedGb = round(agent.disk_used_gb, 1);
  server.tempC = agent.temp_c ?? server.tempC;
  server.netUpMbps = round(agent.net_up_mbps, 1);
  server.netDownMbps = round(agent.net_down_mbps, 1);
  server.load = round(agent.load_1, 2);
  server.uptimeSeconds = agent.uptime_seconds || server.uptimeSeconds;
  server.lastSeen = agent.last_report_at ?? server.lastSeen;

  // Update profile with agent data (ServerSpec has profile)
  server.spec.profile.baseCpu = clamp(agent.cpu_usage, 0, 100);
  server.spec.profile.baseRamGb = agent.ram_used_gb;
  server.spec.profile.baseTemp = agent.temp_c ?? 0;
  server.spec.profile.baseNetUpMbps = agent.net_up_mbps;
  server.spec.profile.baseNetDownMbps = agent.net_down_mbps;
  server.spec.profile.containers = containers.filter((c) => c.running).length;

  // Update history
  const cpuPct = clamp(agent.cpu_usage, 0, 100);
  const ramPct = agent.ram_total_gb > 0 ? (agent.ram_used_gb / agent.ram_total_gb) * 100 : 0;
  const diskPct = agent.disk_total_gb > 0 ? (agent.disk_used_gb / agent.disk_total_gb) * 100 : 0;

  const push = (arr: number[], val: number) => { arr.push(val); if (arr.length > 360) arr.shift(); };
  push(server.history.cpu, round(cpuPct));
  push(server.history.ram, round(ramPct));
  push(server.history.disk, round(diskPct));
  push(server.history.temp, agent.temp_c ?? 0);
  push(server.history.netUp, round(agent.net_up_mbps));
  push(server.history.netDown, round(agent.net_down_mbps));
  push(server.history.load, round(agent.load_1, 2));
}

/** Build Docker host profiles from agents that report Docker containers. */
export function getAgentDockerHostProfiles(
  proxmoxGuests: Map<string, ProxmoxGuest>
): Array<{
  hostName: string;
  hostIp: string;
  netDownMbps: number;
  netUpMbps: number;
  containers: Array<{ id: string; name: string; running: boolean; image: string; ports?: string[] }>;
}> {
  const db = getDb();
  const rows = db.prepare(
    `SELECT host_name, ip, containers_json, net_down_mbps, net_up_mbps, status, last_report_at, vm_id
     FROM agents WHERE containers_json != '[]' AND containers_json != '' AND last_report_at IS NOT NULL`,
  ).all() as Array<{
    host_name: string;
    ip: string;
    containers_json: string;
    net_down_mbps: number;
    net_up_mbps: number;
    status: string;
    last_report_at: number;
    vm_id: string;
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

    // Skip if this agent correlates with a Proxmox guest (already handled by parent)
    if (row.vm_id) {
      const matched = matchAgentToProxmoxGuest(
        { vm_id: row.vm_id, ip: row.ip } as AgentRow,
        proxmoxGuests,
      );
      if (matched) continue; // Will be shown under the Proxmox VM's Docker profile
    }

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