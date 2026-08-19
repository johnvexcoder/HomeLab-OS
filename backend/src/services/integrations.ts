import { randomBytes } from 'node:crypto';
import https from 'node:https';
import net from 'node:net';
import { getDb } from '../db/database';
import { getEncryptionKey, rotateSecrets } from '../security/secrets';
import { decryptSecret, encryptSecret } from '../security/crypto';
import { getBoolSetting, getSetting, getIntSetting } from '../security/settings';

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

async function httpProbe(url: string, timeoutMs = 6000): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return { ok: false, latencyMs: 0, error: 'invalid URL' };
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return { ok: false, latencyMs: 0, error: 'URL must be http(s)' };
  }
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(target, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: { accept: 'application/json, text/plain, */*' },
    });
    const latencyMs = Date.now() - start;
    if (res.ok) return { ok: true, latencyMs };
    return { ok: false, latencyMs, error: `HTTP ${res.status}` };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const message = err instanceof Error ? (err.name === 'AbortError' ? 'timeout' : err.message) : 'request failed';
    return { ok: false, latencyMs, error: message };
  } finally {
    clearTimeout(timer);
  }
}

function smtpProbe(host: string, port: number, timeoutMs = 6000): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = net.createConnection({ host, port, timeout: timeoutMs });
    let settled = false;
    const done = (ok: boolean, error?: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ok, latencyMs: Date.now() - start, error });
    };
    socket.on('connect', () => done(true));
    socket.on('error', (err) => done(false, err.message));
    socket.on('timeout', () => done(false, 'timeout'));
  });
}

/** Per-kind connectivity checks. Error message must NOT leak secret values. */
async function probeKind(kind: IntegrationKind, row: IntegrationRow): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const config = row.config ? (JSON.parse(row.config) as Record<string, unknown>) : {};
  const secret = (field: string): string | null => secretValue(row.id, field);

  switch (kind) {
    case 'uptime_kuma': {
      const url = typeof config.url === 'string' ? config.url : '';
      return httpProbe(url);
    }
    case 'prometheus': {
      const base = typeof config.url === 'string' ? config.url.replace(/\/$/, '') : '';
      return httpProbe(`${base}/api/v1/status`);
    }
    case 'telegram': {
      const token = secret('botToken');
      if (!token) return { ok: false, latencyMs: 0, error: 'missing bot token' };
      return httpProbe(`https://api.telegram.org/bot${encodeURIComponent(token)}/getMe`).then((r) => {
        if (!r.ok && /401|403|404/.test(r.error ?? '')) return { ...r, error: 'invalid bot token' };
        return r;
      });
    }
    case 'email': {
      const host = typeof config.smtpHost === 'string' && config.smtpHost ? config.smtpHost : getSetting('security.smtpHost');
      const rawPort = typeof config.smtpPort === 'number' ? config.smtpPort : getIntSetting('security.smtpPort', 587);
      if (!host) return { ok: false, latencyMs: 0, error: 'missing SMTP host' };
      return smtpProbe(host, rawPort);
    }
    case 'ai_assistant':
      return { ok: false, latencyMs: 0, error: 'AI Assistant delivery is not implemented yet' };
  }
}

/** Test connectivity against the real target (no secrets in the response). */
export async function testIntegration(id: string): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const row = getIntegration(id);
  if (!row) return { ok: false, latencyMs: 0, error: 'not found' };
  if (!integrationEnabledByFeature(row.kind as IntegrationKind)) {
    return { ok: false, latencyMs: 0, error: 'feature disabled' };
  }
  if (row.configured !== 1) {
    return { ok: false, latencyMs: 0, error: 'not configured' };
  }
  const result = await probeKind(row.kind as IntegrationKind, row);
  if (result.ok) {
    getDb()
      .prepare('UPDATE integrations SET status = ?, last_success_at = ?, last_error_at = ?, last_error = ? WHERE id = ?')
      .run('ok', Date.now(), null, null, id);
  } else {
    markIntegrationError(id, result.error ?? 'test failed');
  }
  return result;
}

export function markIntegrationError(id: string, error: string): void {
  getDb().prepare('UPDATE integrations SET status = ?, last_error_at = ?, last_error = ? WHERE id = ?').run('error', Date.now(), error.slice(0, 500), id);
}

export { rotateSecrets, findActiveIntegration };

/* ------------------------------------------------------------------ */
/* Delivery helpers — send messages to configured Telegram / Email     */
/* ------------------------------------------------------------------ */

/** Find the first enabled+configured integration of a given kind. */
function findActiveIntegration(kind: IntegrationKind): IntegrationRow | null {
  const row = getDb()
    .prepare('SELECT * FROM integrations WHERE kind = ? AND enabled = 1 AND configured = 1 ORDER BY updated_at DESC LIMIT 1')
    .get(kind) as IntegrationRow | undefined;
  return row ?? null;
}

/** Send a plain-text message via the Telegram Bot API. */
export function sendTelegramMessage(text: string): Promise<boolean> {
  return new Promise<boolean>(async (resolve) => {
    const row = findActiveIntegration('telegram');
    if (!row) { resolve(false); return; }
    const token = secretValue(row.id, 'botToken');
    const config = row.config ? JSON.parse(row.config) : {};
    const chatId = config.chatId;
    if (!token || !chatId) { resolve(false); return; }

    const payload = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });
    const url = new URL(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`);

    const req = https.request(
      {
        hostname: url.hostname,
        port: 443,
        path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout: 10_000,
        family: 4,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            getDb()
              .prepare('UPDATE integrations SET status = ?, last_success_at = ?, last_error_at = ?, last_error = ? WHERE id = ?')
              .run('ok', Date.now(), null, null, row.id);
            resolve(true);
          } else {
            markIntegrationError(row.id, `Telegram API ${res.statusCode}: ${body.slice(0, 200)}`);
            resolve(false);
          }
        });
      },
    );
    req.on('error', (err) => {
      markIntegrationError(row.id, `Telegram send failed: ${err.message}`);
      resolve(false);
    });
    req.on('timeout', () => { req.destroy(); markIntegrationError(row.id, 'Telegram send timed out'); resolve(false); });
    req.write(payload);
    req.end();
  });
}

/** Send an alert email via the configured SMTP integration or global SMTP settings. */
export async function sendAlertEmail(subject: string, body: string): Promise<boolean> {
  const { smtpConfigured } = await import('../security/smtp');
  const { sendEmail } = await import('../security/smtp');
  const { getSmtpConfig } = await import('../security/smtp');
  const { getSetting } = await import('../security/settings');
  if (!smtpConfigured()) return false;
  const cfg = getSmtpConfig();
  const to = getSetting('security.smtpTo').trim() || cfg.from;
  try {
    await sendEmail({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, from: cfg.from, to, subject, text: body });
    return true;
  } catch {
    return false;
  }
}

/** Dispatch a notification to all enabled channels (Telegram + Email). */
export async function dispatchToChannels(title: string, message: string, severity: string): Promise<void> {
  const emoji = severity === 'critical' ? '🔴' : severity === 'warning' ? '🟡' : severity === 'success' ? '🟢' : 'ℹ️';
  const telegramText = `${emoji} <b>${title}</b>\n\n${message}`;

  const htmlBody = [
    `HomeLab OS Notification`,
    ``,
    `${title}`,
    ``,
    message,
    ``,
    `Severity: ${severity}`,
    `Time: ${new Date().toISOString()}`,
  ].join('\n');

  await Promise.allSettled([
    sendTelegramMessage(telegramText).catch(() => {}),
    sendAlertEmail(`[HomeLab] ${title}`, htmlBody).catch(() => {}),
  ]);
}
