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

export interface ProxmoxGuest {
  vmid: string;
  name: string;
  ip?: string;
  running: boolean;
  nodeId?: string;
}

function hostLogo(hostType: string): string {
  switch (hostType) {
    case 'proxmox': return '\u{1F7E9}';
    case 'debian':
    case 'ubuntu':
    case 'linux': return '\u{1F427}';
    case 'docker': return '\u{1F433}';
    default: return '\u{1F5A5}\uFE0F';
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

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Match an agent to Proxmox infrastructure.
 *
 * - `host`  : agent runs ON the Proxmox host itself → enrich the node server
 * - `guest` : agent runs INSIDE a VM/CT on Proxmox → enrich the guest server
 * - `none`  : agent is not on any known Proxmox host → standalone server
 */
type MatchResult =
  | { kind: 'host'; server: ServerRuntime }
  | { kind: 'guest'; parentServer: ServerRuntime; guest: ProxmoxGuest }
  | { kind: 'none' };

function matchAgent(
  agent: AgentRow,
  proxmoxServers: ServerRuntime[],
  proxmoxGuests: Map<string, ProxmoxGuest>,
  matchedVmids?: Set<string>,
): MatchResult {
  const agentIp = agent.ip?.trim();
  const agentName = norm(agent.host_name);
  const agentVmid = agent.vm_id?.trim();

  // 1. VMID match → agent is inside a specific VM/CT (most reliable)
  if (agentVmid) {
    for (const [, guest] of proxmoxGuests) {
      if (guest.vmid === agentVmid) {
        if (matchedVmids?.has(agentVmid)) continue;
        const parent = findParentNode(guest, proxmoxServers);
        if (parent) return { kind: 'guest', parentServer: parent, guest };
      }
    }
  }

  // 2. IP match to Proxmox node → agent runs ON the host
  if (agentIp) {
    for (const server of proxmoxServers) {
      if (server.spec.ip && server.spec.ip === agentIp) {
        return { kind: 'host', server };
      }
    }
  }

  // 3. Name match to a guest (exact normalized match)
  if (agentName) {
    for (const [, guest] of proxmoxGuests) {
      if (matchedVmids?.has(guest.vmid)) continue;
      if (norm(guest.name) === agentName) {
        const parent = findParentNode(guest, proxmoxServers);
        if (parent) return { kind: 'guest', parentServer: parent, guest };
      }
    }
  }

  // 4. Subnet heuristic: agent is a VM on the same /24 subnet as a Proxmox node
  //    Match if there is exactly ONE unmatched running guest on that node,
  //    OR if the number of unmatched agents on this subnet equals unmatched guests
  //    (batch matching handled by getAgentServers).
  if (agentIp && agent.virt_type && ['kvm', 'qemu', 'xen', 'vmware'].includes(agent.virt_type)) {
    for (const server of proxmoxServers) {
      if (!server.spec.ip) continue;
      if (!sameSubnet(agentIp, server.spec.ip)) continue;
      const unmatchedGuests: ProxmoxGuest[] = [];
      for (const [, guest] of proxmoxGuests) {
        if (guest.nodeId !== server.spec.id) continue;
        if (!guest.running) continue;
        if (matchedVmids?.has(guest.vmid)) continue;
        unmatchedGuests.push(guest);
      }
      if (unmatchedGuests.length === 1) {
        const parent = findParentNode(unmatchedGuests[0], proxmoxServers);
        if (parent) return { kind: 'guest', parentServer: parent, guest: unmatchedGuests[0] };
      }
      // When multiple unmatched guests remain, return the first one
      // getAgentServers handles batch matching to avoid duplicates
      if (unmatchedGuests.length > 1) {
        const parent = findParentNode(unmatchedGuests[0], proxmoxServers);
        if (parent) return { kind: 'guest', parentServer: parent, guest: unmatchedGuests[0] };
      }
    }
  }

  return { kind: 'none' };
}

function sameSubnet(a: string, b: string): boolean {
  const pA = a.split('.');
  const pB = b.split('.');
  if (pA.length !== 4 || pB.length !== 4) return false;
  return pA[0] === pB[0] && pA[1] === pB[1] && pA[2] === pB[2];
}

function findParentNode(guest: ProxmoxGuest, servers: ServerRuntime[]): ServerRuntime | undefined {
  if (!guest.nodeId) return servers[0];
  return servers.find((s) => s.spec.id === guest.nodeId) ?? servers[0];
}

/**
 * Enrich an existing Proxmox server with agent-reported data.
 * Agent data is MORE ACCURATE for live readings (CPU, RAM, temp, net, disk).
 * Proxmox data is MORE ACCURATE for allocated resources (cores, total RAM, etc).
 */
function enrichServerWithAgent(server: ServerRuntime, agent: AgentRow): void {
  const containers = safeJson<{ id: string; name: string; running: boolean; image: string; ports?: string[] }[]>(agent.containers_json, []);

  // Spec metadata — only override if agent has values
  if (agent.os) server.spec.os = agent.os;
  if (agent.cpu_cores) server.spec.cpuCores = agent.cpu_cores;
  if (agent.ram_total_gb) server.spec.ramTotalGb = round(agent.ram_total_gb, 1);
  if (agent.disk_total_gb) server.spec.diskTotalGb = round(agent.disk_total_gb, 1);
  // Agent knows the real hostname — update if different (e.g., debian01 → docker01)
  if (agent.host_name && agent.host_name !== server.spec.hostname) {
    server.spec.hostname = agent.host_name;
    server.spec.name = agent.host_name;
  }
  // Agent knows the real IP — always update (Proxmox guest IPs are unreliable)
  if (agent.ip) server.spec.ip = agent.ip;
  // Preserve Proxmox guest description for VMs; only set agent description for standalone agents
  if (server.spec.role !== 'server' || !server.spec.description?.includes('VM')) {
    server.spec.description = server.spec.role === 'hypervisor'
      ? 'Proxmox VE node + HomeLab Agent'
      : `HomeLab Agent on ${agent.host_name}`;
  }

  // Live runtime — agent is authoritative
  server.cpu = round(clamp(agent.cpu_usage, 0, 100), 1);
  server.ramUsedGb = round(agent.ram_used_gb, 1);
  server.diskUsedGb = round(agent.disk_used_gb, 1);
  if (agent.temp_c != null && agent.temp_c > 0) server.tempC = round(agent.temp_c, 1);
  server.netUpMbps = round(agent.net_up_mbps, 1);
  server.netDownMbps = round(agent.net_down_mbps, 1);
  server.load = round(agent.load_1, 2);
  if (agent.uptime_seconds > 0) server.uptimeSeconds = agent.uptime_seconds;
  if (agent.last_report_at) server.lastSeen = agent.last_report_at;

  // Profile
  server.spec.profile.baseCpu = server.cpu;
  server.spec.profile.baseRamGb = server.ramUsedGb;
  if (agent.temp_c != null && agent.temp_c > 0) server.spec.profile.baseTemp = round(agent.temp_c, 1);
  server.spec.profile.baseNetUpMbps = server.netUpMbps;
  server.spec.profile.baseNetDownMbps = server.netDownMbps;
  server.spec.profile.containers = containers.filter((c) => c.running).length;

  // History
  const cpuPct = server.cpu;
  const ramPct = agent.ram_total_gb > 0 ? (agent.ram_used_gb / agent.ram_total_gb) * 100 : 0;
  const diskPct = agent.disk_total_gb > 0 ? (agent.disk_used_gb / agent.disk_total_gb) * 100 : 0;

  const push = (arr: number[], val: number) => { arr.push(val); if (arr.length > 360) arr.shift(); };
  push(server.history.cpu, cpuPct);
  push(server.history.ram, round(ramPct));
  push(server.history.disk, round(diskPct));
  push(server.history.temp, server.tempC);
  push(server.history.netUp, server.netUpMbps);
  push(server.history.netDown, server.netDownMbps);
  push(server.history.load, server.load);

  // Recalculate health
  server.health = round(clamp(
    100 - (cpuPct > 85 ? 15 : 0) - (ramPct > 90 ? 15 : 0) - (diskPct > 92 ? 10 : 0),
    0, 100,
  ));
  server.status = cpuPct > 90 || ramPct > 95 ? 'degraded' : 'online';
}

/**
 * Build a standalone ServerRuntime for an agent that is not running on a
 * known Proxmox host, or that is inside a Proxmox VM (guest match).
 */
function buildAgentRuntime(agent: AgentRow, parentNodeId?: string): ServerRuntime {
  const containers = safeJson<{ id: string; name: string; running: boolean; image: string; ports?: string[] }[]>(agent.containers_json, []);

  const cpuPct = clamp(agent.cpu_usage, 0, 100);
  const ramPct = agent.ram_total_gb > 0 ? (agent.ram_used_gb / agent.ram_total_gb) * 100 : 0;
  const diskPct = agent.disk_total_gb > 0 ? (agent.disk_used_gb / agent.disk_total_gb) * 100 : 0;
  const health = clamp(100 - (cpuPct > 85 ? 15 : 0) - (ramPct > 90 ? 15 : 0) - (diskPct > 92 ? 10 : 0), 0, 100);

  const prev = new Map<string, number[]>();
  const ph = (key: keyof ServerRuntime['history'], val: number): number[] => {
    const arr = prev.get(key) ?? [];
    arr.push(val);
    if (arr.length > 360) arr.shift();
    prev.set(key, arr);
    return arr;
  };

  return {
    spec: {
      id: `agent-${agent.host_id}`,
      serverId: agent.id,
      hostname: agent.host_name,
      name: agent.host_name,
      logo: hostLogo(agent.host_type),
      os: agent.os || agent.host_type,
      description: `HomeLab Agent on ${agent.host_name}`,
      role: containers.length > 0 ? 'docker' : 'server',
      capabilities: ['monitoring'],
      clusterId: parentNodeId || null,
      ip: agent.ip,
      location: agent.virt_type ? `VM (${agent.virt_type})` : 'Agent',
      cpuModel: `${agent.host_type} (${agent.cpu_cores || '?'} cores)`,
      cpuCores: agent.cpu_cores || 1,
      ramTotalGb: round(agent.ram_total_gb || 1, 1),
      diskTotalGb: round(agent.disk_total_gb || 1, 1),
      sensors: [],
      profile: {
        baseCpu: round(cpuPct, 1),
        cpuAmplitude: 0,
        cpuNoise: 0,
        baseRamGb: round(agent.ram_used_gb, 1),
        ramDriftGb: 0,
        baseTemp: agent.temp_c ?? 0,
        tempVariance: 0,
        baseNetUpMbps: round(agent.net_up_mbps, 1),
        baseNetDownMbps: round(agent.net_down_mbps, 1),
        netBurstRate: 0,
        processes: 0,
        containers: containers.filter((c) => c.running).length,
        vms: 0,
        reliability: 1,
      },
    },
    status: cpuPct > 90 || ramPct > 95 ? 'degraded' : 'online',
    reachability: 'accessible',
    health: round(health),
    load: round(agent.load_1, 2),
    uptimeSeconds: agent.uptime_seconds || 0,
    cpu: round(cpuPct),
    ramUsedGb: round(agent.ram_used_gb, 1),
    diskUsedGb: round(agent.disk_used_gb, 1),
    tempC: agent.temp_c ?? 0,
    netUpMbps: round(agent.net_up_mbps, 1),
    netDownMbps: round(agent.net_down_mbps, 1),
    processes: 0,
    lastSeen: agent.last_report_at ?? Date.now(),
    sensors: [],
    history: {
      cpu: ph('cpu', round(cpuPct)),
      ram: ph('ram', round(ramPct)),
      disk: ph('disk', round(diskPct)),
      temp: ph('temp', agent.temp_c ?? 0),
      netUp: ph('netUp', round(agent.net_up_mbps)),
      netDown: ph('netDown', round(agent.net_down_mbps)),
      load: ph('load', round(agent.load_1, 2)),
    },
  };
}

/**
 * Read all online agents from the DB.
 *
 * - Agents running ON a Proxmox host → enrich that host server
 * - Agents inside a Proxmox VM → create a standalone server linked to parent
 * - Agents not on Proxmox → create a standalone server
 *
 * Returns only the NEW standalone servers (enriched servers are mutated in-place).
 */
export function getAgentServers(
  existingIds: Set<string>,
  proxmoxServers: ServerRuntime[],
  proxmoxGuests: Map<string, ProxmoxGuest>,
): ServerRuntime[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM agents WHERE last_report_at IS NOT NULL ORDER BY host_name ASC`,
  ).all() as AgentRow[];

  const now = Date.now();
  const runtimes: ServerRuntime[] = [];
  const matchedVmids = new Set<string>();

  for (const row of rows) {
    const age = now - (row.last_report_at ?? 0);
    if (row.status !== 'online' || age > STALE_THRESHOLD_MS) continue;

    const match = matchAgent(row, proxmoxServers, proxmoxGuests, matchedVmids);

    if (match.kind === 'host') {
      enrichServerWithAgent(match.server, row);
      continue;
    }

    if (match.kind === 'guest') {
      matchedVmids.add(match.guest.vmid);
      const guestServerId = `${match.parentServer.spec.id}-g${match.guest.vmid}`;
      const guestServer = proxmoxServers.find((s) => s.spec.id === guestServerId);
      if (guestServer) {
        enrichServerWithAgent(guestServer, row);
        continue;
      }
    }

    // No match or unmatched guest → standalone server
    const id = `agent-${row.host_id}`;
    if (existingIds.has(id)) continue;

    const parentNodeId = match.kind === 'guest' ? match.parentServer.spec.id : undefined;
    runtimes.push(buildAgentRuntime(row, parentNodeId));
  }

  return runtimes;
}

/** Build Docker host profiles from agents that report Docker containers. */
export function getAgentDockerHostProfiles(
  proxmoxGuests: Map<string, ProxmoxGuest>,
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

    if (row.vm_id) {
      const matched = matchAgent(
        { vm_id: row.vm_id, ip: row.ip, host_name: row.host_name } as AgentRow,
        [],
        proxmoxGuests,
      );
      if (matched.kind !== 'none') continue;
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
