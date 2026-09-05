import { execSync } from 'node:child_process';
import fsSync from 'node:fs';
import { getJsonSetting } from '../security/settings';

/**
 * System Tags — up to 3 selectable tags shown on host/VM/LXC profile cards.
 *
 * Each machine reports one of two booleans per tag:
 *   installed — the package/daemon is present
 *   running   — installed AND currently active
 *
 * Display color coding (frontend):
 *   GREY = not installed
 *   RED  = installed but not running
 *   BLUE = installed and running
 */

export const SYSTEM_TAGS = [
  { id: 'dbus', label: 'DBUS' },
  { id: 'docker', label: 'docker' },
  { id: 'lm-sensors', label: 'lm-sensors' },
  { id: 'ssh', label: 'SSH' },
  { id: 'containerd', label: 'containerd' },
  { id: 'networkmanager', label: 'NetworkManager' },
] as const;

export type SystemTagId = (typeof SYSTEM_TAGS)[number]['id'];

export interface SystemTagState {
  id: SystemTagId;
  label: string;
  installed: boolean;
  running: boolean;
}

export type SystemTagReport = Record<string, { installed?: boolean; running?: boolean }>;

/** Which tags (max 3) the admin selected, in the selected order. */
export function getSelectedSystemTags(): SystemTagId[] {
  const raw = getJsonSetting<string[]>('system.tags', []);
  if (!Array.isArray(raw)) return [];
  const valid = SYSTEM_TAGS.map((t) => t.id).filter((id) => raw.includes(id));
  return valid.slice(0, 3);
}

/** Resolve the selected tags into card-ready states from a machine's report. */
export function resolveSystemTags(report?: SystemTagReport | null): SystemTagState[] {
  const selected = getSelectedSystemTags();
  if (selected.length === 0) return [];
  const src = report ?? {};
  return selected.map((id) => {
    const meta = SYSTEM_TAGS.find((t) => t.id === id)!;
    const s = src[id];
    return { id, label: meta.label, installed: !!s?.installed, running: !!s?.running };
  });
}

// ── Local (HomeLab-OS host) detection ──────────────────────────────────────

let localCache: SystemTagReport | null = null;
let localCacheAt = 0;
const LOCAL_TTL_MS = 30_000;

function hasBin(bin: string): boolean {
  try {
    execSync(`command -v ${bin}`, { stdio: 'pipe', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/** True when a process whose comm matches `name` exists on this host's /proc. */
function processRunning(name: string): boolean {
  try {
    const entries = fsSync.readdirSync('/proc');
    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const comm = fsSync.readFileSync(`/proc/${entry}/comm`, 'utf-8').trim();
        if (comm === name) return true;
      } catch {
        // PID vanished — skip
      }
    }
  } catch {
    // /proc unavailable
  }
  return false;
}

function sensorsReadable(): boolean {
  try {
    const out = execSync('sensors -A 2>/dev/null', { encoding: 'utf-8', timeout: 4000 });
    return /\d+(\.\d+)?\s*°C|^\S+\s+.*$/m.test(out) && out.trim().length > 0;
  } catch {
    return false;
  }
}

/** Detect tag states on the backend's own host (HomeLab-OS install). Best-effort. */
export function detectLocalSystemTags(): SystemTagReport {
  const now = Date.now();
  if (localCache && now - localCacheAt < LOCAL_TTL_MS) return localCache;

  const dbus = hasBin('dbus-daemon');
  const docker = hasBin('docker');
  const lm = hasBin('sensors');
  const ssh = hasBin('sshd') || hasBin('ssh');
  const containerd = hasBin('containerd');
  const networkmanager = hasBin('NetworkManager');

  const report: SystemTagReport = {
    dbus: { installed: dbus, running: dbus && processRunning('dbus-daemon') },
    docker: { installed: docker, running: docker && processRunning('dockerd') },
    'lm-sensors': { installed: lm, running: lm && sensorsReadable() },
    ssh: { installed: ssh, running: ssh && (processRunning('sshd') || processRunning('ssh')) },
    containerd: { installed: containerd, running: containerd && processRunning('containerd') },
    networkmanager: { installed: networkmanager, running: networkmanager && (processRunning('NetworkManager') || processRunning('networkmanager')) },
  };

  localCache = report;
  localCacheAt = now;
  return report;
}