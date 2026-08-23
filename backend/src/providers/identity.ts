import type { ServerRuntime } from '../types';
import { getDb } from '../db/database';

const STALE_THRESHOLD_MS = 60_000;
const PARENT_HEARTBEAT_TIMEOUT_MS = 90_000;

/**
 * Canonical Identity — one server per machine, no duplicates.
 *
 * Proxmox API = inventory provider (VMID, parent node, VM state/type, cluster info)
 * HomeLab Agent = telemetry provider (CPU, RAM, disk, temp, containers, services)
 *
 * Matching priority:
 *   1. Machine ID (/etc/machine-id) — unique per OS install, most stable
 *   2. VMID + Parent Node — Proxmox's own identifier, rock-solid once matched
 *   3. IP + Parent Node — reliable on same subnet
 *   4. Hostname + Parent Node — last resort, never alone
 *
 * Rules:
 *   - If agent IP matches a Proxmox node IP → reject (parent validation)
 *   - If agent has sensors → use agent temp; if not → inherit parent temp with source tag
 *   - If Proxmox says VM stopped → override to offline regardless of agent heartbeat
 *   - If agent heartbeat expired → "Agent Offline" even if Proxmox says running
 */

export interface AgentRow {
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
  machine_id: string;
  mac_address: string;
  host_type_detected: string;
  hypervisor: string;
  container_count: number;
  running_count: number;
  unhealthy_count: number;
  process_count: number;
}

export interface ProxmoxGuest {
  vmid: string;
  name: string;
  ip?: string;
  running: boolean;
  nodeId?: string;
  vmType?: 'vm' | 'lxc';
}

interface MatchResult {
  kind: 'host' | 'guest' | 'none';
  parentServer?: ServerRuntime;
  guest?: ProxmoxGuest;
  confidence: 'high' | 'medium' | 'low' | 'none';
  signal: string;
}

interface ReconciliationResult {
  /** All canonical servers (Proxmox enriched + standalone agents) */
  servers: ServerRuntime[];
  /** Guest IDs claimed by agents (remove stale Proxmox guest cards) */
  claimedGuestIds: Set<string>;
  /** Agents that failed parent validation */
  parentViolations: Array<{ agentId: string; hostName: string; agentIp: string; nodeIp: string }>;
  /** Agents matched to guests with "VM Running, Agent Offline" */
  offlineAgents: Array<{ serverId: string; hostName: string }>;
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

function sameSubnet(a: string, b: string): boolean {
  const pA = a.split('.');
  const pB = b.split('.');
  if (pA.length !== 4 || pB.length !== 4) return false;
  return pA[0] === pB[0] && pA[1] === pB[1] && pA[2] === pB[2];
}

function isValidIp(ip: string): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip) && ip !== '0.0.0.0' && ip !== '127.0.0.1';
}

function findParentNode(nodeId: string | undefined, proxmoxServers: ServerRuntime[]): ServerRuntime | undefined {
  if (!nodeId) return proxmoxServers[0];
  return proxmoxServers.find((s) => s.spec.id === nodeId);
}

/**
 * Validate that the agent is not claiming to be on a parent node's IP.
 * This catches misconfigured agents that pick up the Proxmox host IP via DHCP.
 */
function validateParentIdentity(
  agent: AgentRow,
  proxmoxServers: ServerRuntime[],
): { valid: boolean; nodeIp?: string } {
  const agentIp = agent.ip?.trim();
  if (!agentIp || !isValidIp(agentIp)) return { valid: true };

  for (const node of proxmoxServers) {
    if (!node.spec.ip) continue;
    if (node.spec.ip === agentIp) {
      return { valid: false, nodeIp: node.spec.ip };
    }
  }
  return { valid: true };
}

/**
 * Multi-signal matching: try each signal in priority order.
 * Returns the best match with confidence level.
 */
function matchAgentToInfrastructure(
  agent: AgentRow,
  proxmoxServers: ServerRuntime[],
  proxmoxGuests: Map<string, ProxmoxGuest>,
  claimedVmids: Set<string>,
): MatchResult {
  const agentIp = agent.ip?.trim();
  const agentName = norm(agent.host_name);
  const agentVmid = agent.vm_id?.trim();
  const agentMachineId = agent.machine_id?.trim();

  // ── Signal 1: Machine ID ──
  // If we have stored machine_ids from previous agent sessions, match on that.
  // (For now, this is a placeholder — machine_id matching across restarts
  // requires persisting the mapping guest→machine_id in the DB.)

  // ── Signal 2: VMID + Parent Node ──
  if (agentVmid) {
    for (const [, guest] of proxmoxGuests) {
      if (guest.vmid !== agentVmid) continue;
      if (claimedVmids.has(agentVmid)) continue;
      const parent = findParentNode(guest.nodeId, proxmoxServers);
      if (parent) {
        return { kind: 'guest', parentServer: parent, guest, confidence: 'high', signal: 'vmid' };
      }
    }
  }

  // ── Signal 3: IP + Parent Node ──
  if (agentIp && isValidIp(agentIp)) {
    // Check if agent is ON a Proxmox node
    for (const server of proxmoxServers) {
      if (!server.spec.ip) continue;
      if (server.spec.ip === agentIp) {
        return { kind: 'host', parentServer: server, confidence: 'high', signal: 'ip-host' };
      }
    }

    // Check if agent matches a guest with known IP
    for (const [, guest] of proxmoxGuests) {
      if (claimedVmids.has(guest.vmid)) continue;
      if (guest.ip && guest.ip === agentIp) {
        const parent = findParentNode(guest.nodeId, proxmoxServers);
        if (parent) {
          return { kind: 'guest', parentServer: parent, guest, confidence: 'high', signal: 'ip-guest' };
        }
      }
    }
  }

  // ── Signal 4: Exact hostname match ──
  if (agentName) {
    for (const [, guest] of proxmoxGuests) {
      if (claimedVmids.has(guest.vmid)) continue;
      if (norm(guest.name) === agentName) {
        const parent = findParentNode(guest.nodeId, proxmoxServers);
        if (parent) {
          return { kind: 'guest', parentServer: parent, guest, confidence: 'medium', signal: 'hostname' };
        }
      }
    }
  }

  // ── Signal 5: Subnet heuristic ──
  // Agent is on same /24 subnet as a Proxmox node with unmatched running guests.
  // This is the weakest signal — only use when there's exactly one unmatched guest.
  // Skip if agent IP equals a Proxmox node IP (parent validation should catch this,
  // but add safeguard here too to prevent mis-matches).
  if (agentIp && isValidIp(agentIp)) {
    // Extra safeguard: don't match if agent IP is a Proxmox node IP
    const isProxmoxNodeIp = proxmoxServers.some((s) => s.spec.ip === agentIp);
    if (isProxmoxNodeIp) {
      // Agent claims Proxmox node IP — parent validation should reject this,
      // but if it slipped through, subnet heuristic won't worsen the issue.
      ; // fall through to 'none' match
    } else {
      for (const server of proxmoxServers) {
        if (!server.spec.ip) continue;
        if (!sameSubnet(agentIp, server.spec.ip)) continue;
        if (agentIp === server.spec.ip) continue;

        const unmatchedGuests: ProxmoxGuest[] = [];
        for (const [, guest] of proxmoxGuests) {
          if (guest.nodeId !== server.spec.id) continue;
          if (!guest.running) continue;
          if (claimedVmids.has(guest.vmid)) continue;
          unmatchedGuests.push(guest);
        }

        // Only match subnet heuristic when there's exactly one candidate
        if (unmatchedGuests.length === 1) {
          const parent = findParentNode(unmatchedGuests[0].nodeId, proxmoxServers);
          if (parent) {
            return { kind: 'guest', parentServer: parent, guest: unmatchedGuests[0], confidence: 'low', signal: 'subnet' };
          }
        }
      }
    }
  }

  return { kind: 'none', confidence: 'none', signal: 'none' };
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

/**
 * Enrich an existing Proxmox server with agent-reported telemetry.
 * Agent is authoritative for live readings; Proxmox is authoritative for allocated resources.
 */
function enrichServerWithAgent(
  server: ServerRuntime,
  agent: AgentRow,
  parentNode?: ServerRuntime,
): void {
  const containers = safeJson<{ id: string; name: string; running: boolean; image: string; ports?: string[] }[]>(agent.containers_json, []);

  // ── Spec metadata (agent is more accurate for identity) ──
  if (agent.os) server.spec.os = agent.os;
  if (agent.cpu_cores) server.spec.cpuCores = agent.cpu_cores;
  if (agent.ram_total_gb) server.spec.ramTotalGb = round(agent.ram_total_gb, 1);
  if (agent.disk_total_gb) server.spec.diskTotalGb = round(agent.disk_total_gb, 1);
  if (agent.host_name && agent.host_name !== server.spec.hostname) {
    server.spec.hostname = agent.host_name;
    server.spec.name = agent.host_name;
  }
  if (agent.ip) server.spec.ip = agent.ip;

  // ── Description: preserve Proxmox VM description for VMs ──
  if (server.spec.role !== 'server' || !server.spec.description?.includes('VM')) {
    server.spec.description = server.spec.role === 'hypervisor'
      ? 'Proxmox VE node + HomeLab Agent'
      : `HomeLab Agent on ${agent.host_name}`;
  }

  // ── Live telemetry (agent is authoritative) ──
  server.cpu = round(clamp(agent.cpu_usage, 0, 100), 1);
  server.ramUsedGb = round(agent.ram_used_gb, 1);
  server.diskUsedGb = round(agent.disk_used_gb, 1);
  server.netUpMbps = round(agent.net_up_mbps, 1);
  server.netDownMbps = round(agent.net_down_mbps, 1);
  server.load = round(agent.load_1, 2);
  if (agent.uptime_seconds > 0) server.uptimeSeconds = agent.uptime_seconds;
  if (agent.last_report_at) server.lastSeen = agent.last_report_at;
  server.processes = agent.process_count ?? 0;

  // ── Temperature: agent sensors if available, else inherit from parent ──
  const agentHasTemp = agent.temp_c != null && agent.temp_c > 0;
  let tempSource: string | undefined = undefined;
  if (agentHasTemp) {
    server.tempC = round(agent.temp_c!, 1);
    tempSource = 'agent';
  } else if (parentNode && parentNode.tempC > 0) {
    server.tempC = round(parentNode.tempC, 1);
    tempSource = parentNode.spec.hostname;
  }
  // else: keep the existing server.tempC (from Proxmox) — do NOT overwrite with 0
  if (tempSource) {
    (server.spec as any)._tempSource = tempSource;
  }

  // ── Profile ──
  server.spec.profile.baseCpu = server.cpu;
  server.spec.profile.baseRamGb = server.ramUsedGb;
  server.spec.profile.baseTemp = server.tempC;
  server.spec.profile.baseNetUpMbps = server.netUpMbps;
  server.spec.profile.baseNetDownMbps = server.netDownMbps;
  server.spec.profile.containers = containers.filter((c) => c.running).length;

  // ── Role upgrade: server → docker if containers running ──
  if (server.spec.profile.containers > 0 && server.spec.role === 'server') {
    server.spec.role = 'docker';
  }

  // ── History ──
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

  // ── Health ──
  server.health = round(clamp(
    100 - (cpuPct > 85 ? 15 : 0) - (ramPct > 90 ? 15 : 0) - (diskPct > 92 ? 10 : 0),
    0, 100,
  ));
  server.status = cpuPct > 90 || ramPct > 95 ? 'degraded' : 'online';
}

/**
 * Build a standalone ServerRuntime for an unmatched agent.
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
      os: agent.os || 'Unknown OS',
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
    processes: agent.process_count ?? 0,
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
 * Core reconciliation: merge Proxmox inventory with Agent telemetry.
 *
 * 1. Validate all agents (reject parent IP violations)
 * 2. Match each agent to Proxmox infrastructure (multi-signal)
 * 3. Enrich matched servers with agent telemetry
 * 4. Build standalone servers for unmatched agents
 * 5. Handle offline detection (VM stopped vs agent offline)
 */
export function reconcileServers(
  proxmoxServers: ServerRuntime[],
  proxmoxGuests: Map<string, ProxmoxGuest>,
): ReconciliationResult {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM agents WHERE last_report_at IS NOT NULL ORDER BY host_name ASC`,
  ).all() as AgentRow[];

  const now = Date.now();
  const claimedGuestIds = new Set<string>();
  const parentViolations: ReconciliationResult['parentViolations'] = [];
  const offlineAgents: ReconciliationResult['offlineAgents'] = [];
  const extraServers: ServerRuntime[] = [];
  const claimedVmids = new Set<string>();

  // ── Phase 1: Validate + Match agents ──
  for (const agent of rows) {
    const age = now - (agent.last_report_at ?? 0);
    const agentIsStale = agent.status !== 'online' || age > STALE_THRESHOLD_MS;

    // Parent validation: reject agent claiming a Proxmox node's IP
    const validation = validateParentIdentity(agent, proxmoxServers);
    if (!validation.valid) {
      parentViolations.push({
        agentId: agent.id,
        hostName: agent.host_name,
        agentIp: agent.ip,
        nodeIp: validation.nodeIp!,
      });
      continue; // skip this agent entirely
    }

    const match = matchAgentToInfrastructure(agent, proxmoxServers, proxmoxGuests, claimedVmids);

    if (match.kind === 'host') {
      // Agent runs ON a Proxmox node — enrich the node itself
      // Pass the node itself as parentNode so temperature inheritance works
      enrichServerWithAgent(match.parentServer!, agent, match.parentServer);
      continue;
    }

    if (match.kind === 'guest' && match.guest) {
      const guestServerId = `${match.parentServer!.spec.id}-g${match.guest.vmid}`;
      const guestServer = proxmoxServers.find((s) => s.spec.id === guestServerId);

      if (guestServer) {
        claimedVmids.add(match.guest.vmid);
        // NOTE: Do NOT add to claimedGuestIds — this guest IS the enriched server.
        // claimedGuestIds is only for removing UNMATCHED stale Proxmox guest cards.

        if (agentIsStale) {
          // Proxmox says running, but agent is offline
          guestServer.status = 'degraded';
          guestServer.reachability = 'unreachable';
          (guestServer.spec as any)._agentOffline = true;
          offlineAgents.push({ serverId: guestServerId, hostName: agent.host_name });
        } else {
          enrichServerWithAgent(guestServer, agent, findParentNode(match.guest.nodeId, proxmoxServers));
        }
        continue;
      }
    }

    // ── No match → standalone agent server ──
    // Claim any unmatched Proxmox guests on the same subnet to avoid stale cards
    const agentIp = agent.ip?.trim();
    if (agentIp && isValidIp(agentIp)) {
      for (const server of proxmoxServers) {
        if (!server.spec.ip) continue;
        if (!sameSubnet(agentIp, server.spec.ip)) continue;
        for (const [, guest] of proxmoxGuests) {
          if (guest.nodeId !== server.spec.id) continue;
          if (!guest.running) continue;
          if (claimedVmids.has(guest.vmid)) continue;
          claimedGuestIds.add(`${server.spec.id}-g${guest.vmid}`);
        }
      }
    }

    const id = `agent-${agent.host_id}`;
    const existing = proxmoxServers.some((s) => s.spec.id === id) || extraServers.some((s) => s.spec.id === id);
    if (!existing) {
      extraServers.push(buildAgentRuntime(agent));
    }
  }

  // ── Phase 2: Handle Proxmox-reported stopped VMs ──
  // Even if we have no agent, if Proxmox says stopped → mark offline
  for (const server of proxmoxServers) {
    if (server.spec.role === 'hypervisor') continue;
    // Guest servers created by proxmoxMetricsProvider have IDs like pve0-g100
    const guestMatch = server.spec.id.match(/^.*-g(\d+)$/);
    if (!guestMatch) continue;

    const guestVmid = guestMatch[1];
    for (const [, guest] of proxmoxGuests) {
      if (guest.vmid === guestVmid && !guest.running) {
        server.status = 'offline';
        server.reachability = 'unreachable';
        server.cpu = 0;
        server.ramUsedGb = 0;
        break;
      }
    }
  }

  return {
    servers: extraServers,
    claimedGuestIds,
    parentViolations,
    offlineAgents,
  };
}

/**
 * Convenience wrapper that reads agents from the DB and reconciles.
 * Used by compositeProvider.getServers().
 */
export function getReconciledServers(
  existingIds: Set<string>,
  proxmoxServers: ServerRuntime[],
  proxmoxGuests: Map<string, ProxmoxGuest>,
): { runtimes: ServerRuntime[]; claimedGuestIds: Set<string> } {
  const result = reconcileServers(proxmoxServers, proxmoxGuests);

  // Log parent violations as incidents
  for (const v of result.parentViolations) {
    console.warn(
      `[identity] PARENT VIOLATION: agent "${v.hostName}" (${v.agentId}) at ${v.agentIp} claims parent node IP. Rejected.`,
    );
  }

  // Filter out extra servers that overlap with existing IDs
  const runtimes = result.servers.filter((s) => !existingIds.has(s.spec.id));

  return { runtimes, claimedGuestIds: result.claimedGuestIds };
}
