import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from '../config';
import { seedDefaultSettings } from './settings';
import { countUsers, createUser } from './users';
import { createPasswordHash } from './crypto';
import { getDb } from '../db/database';

/**
 * First-boot bootstrap:
 *  - seed default settings + feature flags
 *  - create the initial SUPER_ADMIN if no users exist
 *  - seed disabled integration stubs (so the Integrations UI has a registry)
 */

export function bootstrapSecurity(): void {
  seedDefaultSettings();
  ensureAdminUser();
  seedIntegrations();
}

function ensureAdminUser(): void {
  const fromEnv = process.env.ADMIN_INITIAL_PASSWORD;
  const isMock = config.mockMode;

  if (isMock && !fromEnv && countUsers() > 0) {
    const db = getDb();
    const row = db.prepare('SELECT id, password_salt, password_hash FROM users WHERE username = ?').get('admin') as { id: string; password_salt: string; password_hash: string } | undefined;
    if (row) {
      const { hash, salt } = createPasswordHash('homelab-demo');
      db.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?').run(hash, salt, row.id);
    }
    console.log('[homelab] Demo credentials: admin / homelab-demo');
    return;
  }

  if (countUsers() > 0) return;

  const password = fromEnv && fromEnv.length >= 10 ? fromEnv : (isMock ? 'homelab-demo' : randomBytes(18).toString('base64url'));

  const admin = createUser({
    username: 'admin',
    name: 'System Administrator',
    role: 'SUPER_ADMIN',
    password,
    mustChangePassword: false,
  });

  if (isMock && !fromEnv) {
    console.log('[homelab] Demo credentials: admin / homelab-demo');
  } else if (!fromEnv) {
    const file = path.join(config.dataDir, '.admin-initial-password');
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(file, `${admin.username} / ${password}\n`, { mode: 0o600 });
    console.log('');
    console.log('==================================================================');
    console.log('[homelab] Initial administrator created.');
    console.log(`[homelab]   username: ${admin.username}`);
    console.log(`[homelab]   password: ${password}`);
    console.log(`[homelab]   saved to: ${file}  (delete this file after login)`);
    console.log('==================================================================');
    console.log('');
  } else {
    console.log('[homelab] Initial administrator created from ADMIN_INITIAL_PASSWORD.');
  }
}

function seedIntegrations(): void {
  const db = getDb();
  const existing = (db.prepare('SELECT COUNT(*) AS c FROM integrations').get() as { c: number }).c;
  if (existing > 0) return;

  const now = Date.now();
  const stmt = db.prepare(
    `INSERT INTO integrations (id, name, kind, enabled, configured, config, secrets, status, updated_at)
     VALUES (?, ?, ?, 0, 0, NULL, NULL, 'disabled', ?)`,
  );
  const tx = db.transaction(() => {
    const rows: Array<[string, string, string]> = [
      ['uptime-kuma', 'Uptime Kuma', 'uptime_kuma'],
      ['telegram', 'Telegram', 'telegram'],
      ['email', 'Email (SMTP)', 'email'],
      ['prometheus', 'Prometheus', 'prometheus'],
      ['ai-assistant', 'AI Assistant', 'ai_assistant'],
    ];
    for (const [id, name, kind] of rows) stmt.run(id, name, kind, now);
  });
  tx();
}
