import { getDb } from '../db/database';

/**
 * Configuration store. Every value is JSON-encoded in the `settings` table.
 * Keys are flat strings; feature flags live under `feature.<id>`.
 * Secrets NEVER live here — integration secrets are stored encrypted in the
 * `integrations` table and never returned by the API.
 */

export interface FeatureDef {
  id: string;
  label: string;
  description: string;
  group: 'infrastructure' | 'integrations' | 'notifications' | 'platform';
  /** backend-supported today (mock or real) — false = "unsupported", togglable */
  supported: boolean;
  /** when false, UI + API are disabled (feature flag enforced server-side) */
  defaultEnabled: boolean;
}

export const FEATURES: FeatureDef[] = [
  { id: 'infrastructure_map', label: 'Infrastructure Map', description: 'Animated network topology view', group: 'infrastructure', supported: true, defaultEnabled: true },
  { id: 'hardware_monitoring', label: 'Hardware Monitoring', description: 'Optional hardware sensors', group: 'infrastructure', supported: true, defaultEnabled: true },
  { id: 'fan_monitoring', label: 'Fan Monitoring', description: 'Fan RPM / duty sensors', group: 'infrastructure', supported: true, defaultEnabled: true },
  { id: 'temperature_monitoring', label: 'Temperature Monitoring', description: 'CPU/GPU/disk/NVMe temperature sensors', group: 'infrastructure', supported: true, defaultEnabled: true },
  { id: 'docker_monitoring', label: 'Docker Monitoring', description: 'Container host metrics — needs DOCKER_ENABLED=true + the Docker socket mounted; containers appear under the docker01 guest on the map', group: 'infrastructure', supported: true, defaultEnabled: true },
  { id: 'proxmox_monitoring', label: 'Proxmox Monitoring', description: 'Hypervisor / VM metrics', group: 'infrastructure', supported: true, defaultEnabled: true },
  { id: 'gpu_monitoring', label: 'GPU Monitoring', description: 'GPU telemetry (unsupported yet)', group: 'infrastructure', supported: false, defaultEnabled: false },
  { id: 'ups_monitoring', label: 'UPS Monitoring', description: 'Battery/power telemetry (unsupported yet)', group: 'infrastructure', supported: false, defaultEnabled: false },
  { id: 'prometheus_integration', label: 'Prometheus Integration', description: 'Prometheus scrape/query (unsupported yet)', group: 'integrations', supported: false, defaultEnabled: false },
  { id: 'uptime_kuma_integration', label: 'Uptime Kuma Integration', description: 'Status page ingestion — connectivity test supported, ingestion pending', group: 'integrations', supported: true, defaultEnabled: true },
  { id: 'telegram_notifications', label: 'Telegram Notifications', description: 'Telegram bot integration — connectivity test supported, alert delivery pending', group: 'notifications', supported: true, defaultEnabled: true },
  { id: 'email_notifications', label: 'Email Notifications', description: 'SMTP integration — connectivity test supported, alert delivery pending', group: 'notifications', supported: true, defaultEnabled: false },
  { id: 'ai_assistant', label: 'AI Assistant', description: 'Conversational assistant (unsupported yet)', group: 'platform', supported: false, defaultEnabled: false },
  { id: 'experimental_features', label: 'Experimental Features', description: 'Unstable features behind this flag', group: 'platform', supported: false, defaultEnabled: false },
  { id: 'wall_display_mode', label: 'Wall Display Mode', description: 'Kiosk-friendly read-only wall display (UI not implemented yet)', group: 'platform', supported: false, defaultEnabled: false },
  { id: 'guest_mode', label: 'Guest Mode', description: 'Allow unauthenticated read-only access (see Access settings)', group: 'platform', supported: true, defaultEnabled: false },
];

export type SettingsMap = Record<string, string>;

/** Default Quick Actions. Stored as JSON under the `quick.actions` settings key so
 *  backups, config snapshots and `reset-settings` cover them automatically. */
export interface QuickAction {
  id: string;
  label: string;
  kind: string;
  keywords: string;
  href?: string;
  icon: string;
  enabled: boolean;
}

export const DEFAULT_QUICK_ACTIONS: QuickAction[] = [
  { id: 'proxmox', label: 'Open Proxmox', kind: 'open UI', keywords: 'proxmox pve hypervisor', href: 'https://pve.homelab.local:8006', icon: 'server', enabled: true },
  { id: 'docker', label: 'Open Docker', kind: 'open UI', keywords: 'docker portainer containers', href: 'https://portainer.homelab.local', icon: 'container', enabled: true },
  { id: 'uptime', label: 'Open Uptime Kuma', kind: 'open UI', keywords: 'uptime kuma status monitoring', href: 'https://uptime.homelab.local', icon: 'activity', enabled: true },
  { id: 'restart-docker', label: 'Restart Docker', kind: 'command', keywords: 'restart docker daemon', icon: 'refresh', enabled: false },
  { id: 'ssh', label: 'SSH', kind: 'command', keywords: 'ssh terminal shell session', icon: 'terminal', enabled: false },
  { id: 'wake', label: 'Wake Server', kind: 'command', keywords: 'wake on lan wol wake server', icon: 'power', enabled: false },
];

const DEFAULTS: SettingsMap = {
  'security.readOnly': 'false',
  'security.emergencyLock': 'false',
  'security.safeMode': 'false',
  'security.sessionTimeoutMinutes': '60',
  'security.absoluteSessionHours': '168', // 7 days
  'security.maxLoginAttempts': '5',
  'security.lockoutMinutes': '15',
  'security.loginRateLimitPerMinute': '10',
  'security.passwordPolicyMinLength': '10',
  'security.passwordPolicyRequireSymbol': 'false',
  'security.twoFactorEnabled': 'false',
  'security.auditEnabled': 'true',
  'security.csrfProtection': 'true',
  'security.smtpHost': '',
  'security.smtpPort': '587',
  'security.smtpSecure': 'false',
  'security.smtpUser': '',
  'security.smtpPassword': '',
  'security.smtpFrom': '',
  'security.smtpTo': '',
  'access.guest.enabled': 'false',
  'access.guest.scopes': JSON.stringify(['serverStatus', 'serviceStatus', 'containers', 'cpu', 'ram', 'storage', 'temp', 'uptime']),
  'backup.enabled': 'true',
  'backup.retentionDaily': '7',
  'backup.retentionWeekly': '4',
  'backup.retentionMonthly': '12',
  'backup.hour': '3', // 03:00 local
  'backup.minute': '0',
  'quick.actions': JSON.stringify(DEFAULT_QUICK_ACTIONS),
};

export function settingsDefaults(): SettingsMap {
  return { ...DEFAULTS };
}

export function getSetting(key: string): string {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  if (row) return row.value;
  return DEFAULTS[key] ?? '';
}

export function setSetting(key: string, value: string | boolean | number | string[]): void {
  const encoded = typeof value === 'string' ? value : JSON.stringify(value);
  getDb()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, encoded, Date.now());
}

export function getBoolSetting(key: string): boolean {
  return getSetting(key).toLowerCase() === 'true';
}

export function getIntSetting(key: string, fallback = 0): number {
  const parsed = Number.parseInt(getSetting(key), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getJsonSetting<T>(key: string, fallback: T): T {
  const raw = getSetting(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function getFeaturesMap(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const def of FEATURES) out[def.id] = getBoolSetting(`feature.${def.id}`);
  return out;
}

/** All settings as a flat object (safe to return to admins — no secrets). */
export function getAllSettings(): SettingsMap {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>;
  const out: SettingsMap = { ...DEFAULTS };
  for (const row of rows) out[row.key] = row.value;
  return out;
}

export function seedDefaultSettings(): void {
  const db = getDb();
  const hasAny = db.prepare('SELECT COUNT(*) AS c FROM settings').get() as { c: number };
  if (hasAny.c > 0) return;
  const stmt = db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)');
  const tx = db.transaction(() => {
    for (const [key, value] of Object.entries(DEFAULTS)) stmt.run(key, value, Date.now());
    for (const def of FEATURES) stmt.run(`feature.${def.id}`, String(def.defaultEnabled), Date.now());
  });
  tx();
}

/** Feature flag status for public/UI consumption (no secrets). */
export function publicFeatureStatus(): Array<{ id: string; label: string; description: string; group: string; enabled: boolean; supported: boolean }> {
  return FEATURES.map((def) => ({
    id: def.id,
    label: def.label,
    description: def.description,
    group: def.group,
    enabled: getBoolSetting(`feature.${def.id}`),
    supported: def.supported,
  }));
}
