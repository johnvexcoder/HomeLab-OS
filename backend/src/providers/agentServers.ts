/**
 * Agent ↔ Proxmox reconciliation layer.
 *
 * This module is now a thin wrapper around the identity engine.
 * All matching, deduplication, parent validation, and temperature
 * inheritance logic lives in identity.ts.
 */
export type { AgentRow, ProxmoxGuest } from './identity';
export { reconcileServers } from './identity';

import type { ServerRuntime } from '../types';
import { getDb } from '../db/database';
import { getReconciledServers } from './identity';

const STALE_THRESHOLD_MS = 60_000;

function safeJson<T>(raw: string, fallback: T): T {
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

/**
 * Read all online agents and reconcile with Proxmox infrastructure.
 * Returns canonical servers + claimed guest IDs for dedup.
 */
export function getAgentServers(
  existingIds: Set<string>,
  proxmoxServers: ServerRuntime[],
  proxmoxGuests: Map<string, { vmid: string; name: string; running: boolean; nodeId: string }>,
): { runtimes: ServerRuntime[]; claimedGuestIds: Set<string> } {
  return getReconciledServers(existingIds, proxmoxServers, proxmoxGuests);
}

/**
 * Build Docker host profiles from agents that report Docker containers.
 * Skips agents that are correlated with Proxmox VMs (they're already enriched there).
 */
export function getAgentDockerHostProfiles(
  proxmoxGuests: Map<string, { vmid: string; name: string; running: boolean; nodeId: string }>,
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

    // Skip agents that match a Proxmox guest (they're already enriched there)
    if (row.vm_id) {
      for (const [, guest] of proxmoxGuests) {
        if (guest.vmid === row.vm_id) {
          // This agent is inside a Proxmox VM — don't create a separate Docker host profile
          break;
        }
      }
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
