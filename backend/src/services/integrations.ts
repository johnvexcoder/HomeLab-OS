import { randomBytes } from 'node:crypto';
import { getDb } from '../db/database';
import { getEncryptionKey, rotateSecrets } from '../security/secrets';
import { decryptSecret, encryptSecret } from '../security/crypto';
import { getBoolSetting } from '../security/settings';

export type IntegrationKind = 'uptime_kuma' | 'telegram' | 'email' | 'prometheus' | 'ai_assistant';

export interface IntegrationInput {
  name: string;
  kind: IntegrationKind;
  enabled?: boolean;
  config?: Record<string, unknown>;
  secrets?: Record<string, string>;
}

export interface IntegrationPublic {
  id: string;
  name: string;
  kind: IntegrationKind;
  enabled: boolean;
  configured: boolean;
  config: Record<string, unknown> | null;
  secretFields: string[];
  status: string;
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastError: string | null;
  updatedAt: number;
}

interface IntegrationRow {
  id: string;
  name: string;
  kind: string;
  enabled: number;
  configured: number;
  config: string | null;
  secrets: string | null;
  status: string;
  last_success_at: number | null;
  last_error_at: number | null;
  last_error: string | null;
  updated_at: number;
}

/** Which secret fields each integration kind may hold (for masking UI). */
export const INTEGRATION_SECRET_FIELDS: Record<IntegrationKind, string[]> = {
  uptime_kuma: ['token'],
  telegram: ['botToken'],
  email: ['smtpPassword'],
  prometheus: ['bearerToken'],
  ai_assistant: ['apiKey'],
};

export function toPublic(row: IntegrationRow): IntegrationPublic {
  const secrets: Record<string, string> = row.secrets ? JSON.parse(row.secrets) : {};
  const secretFields = Object.keys(secrets).filter((field) => {
    const payload = secrets[field];
    return typeof payload === 'string' && payload.startsWith('v1:');
  });
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as IntegrationKind,
    enabled: row.enabled === 1,
    configured: row.configured === 1,
    config: row.config ? JSON.parse(row.config) : null,
    secretFields,
    status: row.status,
    lastSuccessAt: row.last_success_at,
    lastErrorAt: row.last_error_at,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  };
}

/** Secrets are NEVER returned. Only the field names are exposed. */
function mask(row: IntegrationRow): IntegrationPublic {
  return toPublic(row);
}

export function listIntegrations(): IntegrationPublic[] {
  const rows = getDb().prepare('SELECT * FROM integrations ORDER BY updated_at DESC').all() as IntegrationRow[];
  return rows.map(mask);
}

export function getIntegration(id: string): IntegrationRow | null {
  const row = getDb().prepare('SELECT * FROM integrations WHERE id = ?').get(id) as IntegrationRow | undefined;
  return row ?? null;
}

/** Resolve the decrypted secret value for a field (internal use only). */
export function secretValue(id: string, field: string): string | null {
  const row = getIntegration(id);
  if (!row?.secrets) return null;
  const secrets: Record<string, string> = JSON.parse(row.secrets);
  const payload = secrets[field];
  if (!payload) return null;
  return decryptSecret(payload, getEncryptionKey());
}

export function createIntegration(input: IntegrationInput): IntegrationPublic {
  const id = randomBytes(8).toString('hex');
  const now = Date.now();
  const { secrets, configured } = encryptSecrets(input.secrets ?? {}, input.config ?? {});
  getDb()
    .prepare(
      `INSERT INTO integrations (id, name, kind, enabled, configured, config, secrets, status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'disabled', ?)`,
    )
    .run(
      id,
      input.name.trim(),
      input.kind,
      input.enabled ? 1 : 0,
      configured ? 1 : 0,
      input.config && Object.keys(input.config).length ? JSON.stringify(input.config) : null,
      secrets,
      now,
    );
  return mask(getIntegration(id)!);
}

export function updateIntegration(id: string, input: Partial<IntegrationInput>): IntegrationPublic | null {
  const row = getIntegration(id);
  if (!row) return null;
  const db = getDb();
  const sets: string[] = [];
  const params: unknown[] = [];
  if (input.name !== undefined) {
    sets.push('name = ?');
    params.push(input.name.trim());
  }
  if (input.kind !== undefined) {
    sets.push('kind = ?');
    params.push(input.kind);
  }
  if (input.enabled !== undefined) {
    sets.push('enabled = ?');
    params.push(input.enabled ? 1 : 0);
  }
  if (input.config !== undefined) {
    sets.push('config = ?');
    params.push(Object.keys(input.config ?? {}).length ? JSON.stringify(input.config) : null);
  }
  if (input.secrets !== undefined) {
    const { secrets, configured } = encryptSecrets(input.secrets, input.config ?? (row.config ? JSON.parse(row.config) : {}));
    sets.push('secrets = ?');
    params.push(secrets);
    sets.push('configured = ?');
    params.push(configured ? 1 : 0);
  }
  if (sets.length === 0) return mask(row);
  sets.push('status = ?, updated_at = ?');
  params.push(row.enabled === 1 ? 'idle' : 'disabled', Date.now(), id);
  db.prepare(`UPDATE integrations SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return mask(getIntegration(id)!);
}

export function deleteIntegration(id: string): boolean {
  return getDb().prepare('DELETE FROM integrations WHERE id = ?').run(id).changes > 0;
}

function encryptSecrets(
  secrets: Record<string, string>,
  config: Record<string, unknown>,
): { secrets: string; configured: boolean } {
  const key = getEncryptionKey();
  const encrypted: Record<string, string> = {};
  for (const [field, value] of Object.entries(secrets)) {
    if (value) encrypted[field] = encryptSecret(value, key);
  }
  const hasAllSecrets = Object.values(encrypted).length > 0 || Object.keys(secrets).length === 0;
  const configured = hasAllSecrets && Object.keys(config).length > 0;
  return { secrets: JSON.stringify(encrypted), configured };
}

/** Feature-flag gating for integration endpoints. */
export function integrationEnabledByFeature(kind: IntegrationKind): boolean {
  const feature = {
    uptime_kuma: 'uptime_kuma_integration',
    telegram: 'telegram_notifications',
    email: 'email_notifications',
    prometheus: 'prometheus_integration',
    ai_assistant: 'ai_assistant',
  }[kind];
  if (!feature) return false;
  return getBoolSetting(`feature.${feature}`);
}

/** Test connectivity (stub — real delivery lands with real integrations). */
export async function testIntegration(id: string): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const row = getIntegration(id);
  if (!row) return { ok: false, latencyMs: 0, error: 'not found' };
  if (!integrationEnabledByFeature(row.kind as IntegrationKind)) {
    return { ok: false, latencyMs: 0, error: 'feature disabled' };
  }
  if (row.configured !== 1) {
    return { ok: false, latencyMs: 0, error: 'not configured' };
  }
  const start = Date.now();
  await new Promise((r) => setTimeout(r, 150));
  const latencyMs = Date.now() - start;
  getDb()
    .prepare('UPDATE integrations SET status = ?, last_success_at = ?, last_error_at = ?, last_error = ? WHERE id = ?')
    .run('ok', Date.now(), null, null, id);
  return { ok: true, latencyMs };
}

export function markIntegrationError(id: string, error: string): void {
  getDb().prepare('UPDATE integrations SET status = ?, last_error_at = ?, last_error = ? WHERE id = ?').run('error', Date.now(), error.slice(0, 500), id);
}

export { rotateSecrets };
