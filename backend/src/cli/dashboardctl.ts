#!/usr/bin/env node
/**
 * dashboardctl — the J0HNVEX HOMELAB OS administration & recovery CLI.
 *
 * Usage:
 *   npm run dashboardctl -- status
 *   npm run dashboardctl -- backup
 *   npm run dashboardctl -- restore <file-or-backup-id>
 *   npm run dashboardctl -- recovery
 *   npm run dashboardctl -- reset-admin [--password <pw>] [--username <u>]
 *   npm run dashboardctl -- reset-settings
 *   npm run dashboardctl -- disable-feature <feature-id>
 *   npm run dashboardctl -- disable-integration <integration-id>
 *   npm run dashboardctl -- emergency-unlock
 *   npm run dashboardctl -- verify-db
 *   npm run dashboardctl -- repair-db
 *   npm run dashboardctl -- rotate-secrets
 *   npm run dashboardctl -- seed-users
 *
 * Everything runs directly against the DATA_DIR SQLite database. No HTTP
 * server is started, so recovery works even when the app won't boot.
 */
import { config } from '../config';
import { getDb, closeDb } from '../db/database';
import {
  getAllSettings,
  setSetting,
  getFeaturesMap,
  settingsDefaults,
  publicFeatureStatus,
} from '../security/settings';
import { listUsers, createUser, getUserByUsername, updateUser, countUsers } from '../security/users';
import { createBackup, listBackups, restoreBackup } from '../services/backups';
import { rotateSecrets } from '../security/secrets';
import { randomBytes } from 'node:crypto';

const [cmd, ...args] = process.argv.slice(2);

function fail(message: string): never {
  console.error(`[dashboardctl] ${message}`);
  process.exit(1);
}

function requireCmd(): void {
  if (!cmd) {
    console.log(USAGE);
    process.exit(0);
  }
}

const USAGE = `
dashboardctl — J0HNVEX HOMELAB OS administration & recovery CLI

Commands:
  status                    Show system/database/security overview
  logs [n]                  Tail the backend log file (default 100 lines)
  backup                    Create a manual backup (DB + manifest)
  restore <file|id>         Restore from a backup file or listed backup id
  recovery                  Guided recovery: verify DB, show latest backup
  reset-admin               Reset/initialise the admin account
  reset-settings            Restore factory default settings & feature flags
  disable-feature <id>      Disable a feature flag
  disable-integration <id>  Disable an integration
  emergency-unlock          Clear the emergency lock (trusted operator)
  verify-db                 Run SQLite integrity checks
  repair-db                 Pre-backup + checkpoint/reindex/vacuum
  rotate-secrets            Re-encrypt integration secrets with a new key
`;

requireCmd();

async function main(): Promise<void> {
  switch (cmd) {
    case 'status':
      status();
      break;
    case 'logs': {
      const n = args[0] ? Number.parseInt(args[0], 10) : 100;
      logs(n);
      break;
    }
    case 'backup': {
      const backup = await createBackup('manual', 'dashboardctl');
      console.log(`[dashboardctl] backup created: ${backup.file} (${backup.size} bytes)`);
      break;
    }
    case 'restore':
      restore();
      break;
    case 'recovery':
      recovery();
      break;
    case 'reset-admin':
      resetAdmin();
      break;
    case 'reset-settings':
      resetSettings();
      break;
    case 'disable-feature':
      disableFeature();
      break;
    case 'disable-integration':
      disableIntegration();
      break;
    case 'emergency-unlock':
      setSetting('security.emergencyLock', 'false');
      console.log('[dashboardctl] emergency lock cleared.');
      break;
    case 'verify-db':
      verifyDb();
      break;
    case 'repair-db':
      await repairDb();
      break;
    case 'rotate-secrets':
      rotate();
      break;
    default:
      fail(`unknown command: ${cmd}`);
  }
}

function status(): void {
  getDb();
  const users = listUsers();
  const settings = getAllSettings();
  const features = getFeaturesMap();
  const backups = listBackups(3);
  console.log('[dashboardctl] ===== J0HNVEX HOMELAB OS status =====');
  console.log(`  data dir      : ${config.dataDir}`);
  console.log(`  database      : ${getDb() ? 'open' : 'error'}`);
  console.log(`  users         : ${users.length}`);
  for (const u of users) {
    console.log(`    - ${u.username} (${u.role})${u.twoFactorEnabled ? ' [2FA]' : ''}${u.disabled ? ' [DISABLED]' : ''}`);
  }
  console.log(`  read-only     : ${settings['security.readOnly']}`);
  console.log(`  safe mode     : ${settings['security.safeMode']}`);
  console.log(`  emergency lock: ${settings['security.emergencyLock']}`);
  console.log(`  2FA required  : ${settings['security.twoFactorEnabled']}`);
  console.log(`  audit log     : ${settings['security.auditEnabled']}`);
  console.log(`  guest access  : ${settings['access.guest.enabled']}`);
  console.log('  feature flags :');
  for (const [id, enabled] of Object.entries(features)) console.log(`    ${enabled ? 'ON ' : 'OFF'} ${id}`);
  if (backups.length) {
    console.log('  latest backups:');
    for (const b of backups) console.log(`    ${b.type.padEnd(7)} ${b.status.padEnd(7)} ${new Date(b.createdAt).toISOString()} ${b.file}`);
  } else {
    console.log('  latest backups: (none yet)');
  }
}

function logs(n: number): void {
  const fs = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  const file = path.join(config.dataDir, 'homelab.log');
  if (!fs.existsSync(file)) {
    console.log('[dashboardctl] no log file at ' + file + ' (log to file is not enabled in this deployment).');
    return;
  }
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-n);
  console.log(lines.join('\n'));
}

function restore(): void {
  const target = args[0];
  if (!target) fail('usage: dashboardctl restore <file-or-backup-id>');
  let file = target;
  if (!file.includes('/')) {
    const row = getDb().prepare('SELECT file FROM backups WHERE id = ?').get(target) as { file: string } | undefined;
    if (row) file = row.file;
  }
  const result = restoreBackup(file);
  console.log(`[dashboardctl] restore ${result.restored ? 'OK' : 'FAILED'}: ${result.message}`);
  console.log('[dashboardctl] restart the backend for the restored database to take effect.');
  process.exit(result.restored ? 0 : 1);
}

function recovery(): void {
  console.log('[dashboardctl] ===== recovery guide =====');
  verifyDbSoft();
  const backups = listBackups(5);
  if (backups.length) {
    console.log(`[dashboardctl] latest backups (restore with: dashboardctl restore <id>):`);
    for (const b of backups) console.log(`  ${b.id.padEnd(12)} ${b.type.padEnd(8)} ${b.status.padEnd(7)} ${new Date(b.createdAt).toISOString()}`);
  } else {
    console.log('[dashboardctl] WARNING: no backups exist yet. Create one with: dashboardctl backup');
  }
  const users = listUsers();
  if (users.length === 0) {
    console.log('[dashboardctl] no users — re-create the admin account with: dashboardctl reset-admin');
  }
  console.log('[dashboardctl] if the app will not start: run `dashboardctl repair-db` or restore a backup.');
}

function resetAdmin(): void {
  getDb();
  const passwordFlag = args.findIndex((a) => a === '--password');
  const usernameFlag = args.findIndex((a) => a === '--username');
  const username = usernameFlag !== -1 ? args[usernameFlag + 1] : 'admin';
  const password = passwordFlag !== -1 ? args[passwordFlag + 1] : randomBytes(18).toString('base64url');
  const existing = getUserByUsername(username);
  if (existing) {
    updateUser(existing.id, { password, mustChangePassword: false });
    console.log(`[dashboardctl] password reset for '${username}'.`);
  } else {
    createUser({ username, role: 'SUPER_ADMIN', password, name: 'System Administrator' });
    console.log(`[dashboardctl] created SUPER_ADMIN '${username}'.`);
  }
  if (passwordFlag === -1) {
    console.log(`[dashboardctl] NEW PASSWORD: ${password}`);
    console.log('[dashboardctl] store it securely and change it after the next login.');
  }
}

function resetSettings(): void {
  getDb();
  const defaults = settingsDefaults();
  for (const [key, value] of Object.entries(defaults)) setSetting(key, value);
  for (const f of publicFeatureStatus()) setSetting(`feature.${f.id}`, String(f.enabled));
  console.log('[dashboardctl] settings reset to defaults. Config snapshots were not touched.');
}

function disableFeature(): void {
  const id = args[0];
  if (!id) fail('usage: dashboardctl disable-feature <feature-id>');
  getDb();
  const statuses = publicFeatureStatus();
  if (!statuses.some((f) => f.id === id)) fail(`unknown feature '${id}'. Available: ${statuses.map((f) => f.id).join(', ')}`);
  setSetting(`feature.${id}`, 'false');
  if (id === 'guest_mode') setSetting('access.guest.enabled', 'false');
  console.log(`[dashboardctl] feature '${id}' disabled.`);
}

function disableIntegration(): void {
  const id = args[0];
  if (!id) fail('usage: dashboardctl disable-integration <integration-id>');
  getDb();
  const res = getDb().prepare('UPDATE integrations SET enabled = 0, status = ? WHERE id = ?').run('disabled', id);
  if (res.changes === 0) fail(`integration '${id}' not found.`);
  console.log(`[dashboardctl] integration '${id}' disabled.`);
}

function verifyDb(): void {
  const db = getDb();
  const ic = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
  const qc = db.pragma('quick_check') as Array<{ quick_check: string }>;
  console.log(`[dashboardctl] integrity_check: ${ic[0].integrity_check}`);
  console.log(`[dashboardctl] quick_check     : ${qc[0].quick_check}`);
  if (ic[0].integrity_check !== 'ok') fail('database corruption detected — run `dashboardctl repair-db` or restore a backup.');
  console.log('[dashboardctl] database OK.');
}

function verifyDbSoft(): void {
  try {
    const db = getDb();
    const ic = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
    console.log(`[dashboardctl] integrity_check: ${ic[0].integrity_check}`);
  } catch (err) {
    console.log(`[dashboardctl] integrity_check: FAILED (${String(err)})`);
  }
}

async function repairDb(): Promise<void> {
  const db = getDb();
  console.log('[dashboardctl] pre-repair backup…');
  const backup = await createBackup('manual', 'pre-repair');
  console.log(`[dashboardctl] pre-repair backup at ${backup.file}`);
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.pragma('journal_mode = DELETE');
    db.pragma('foreign_keys = OFF');
    db.exec('REINDEX;');
    db.exec('VACUUM;');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    const ic = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
    console.log(`[dashboardctl] post-repair integrity_check: ${ic[0].integrity_check}`);
  } catch (err) {
    closeDb();
    console.error('[dashboardctl] repair failed:', String(err));
    console.log('[dashboardctl] restore the pre-repair backup with: dashboardctl restore ' + backup.id);
    process.exit(1);
  }
  console.log('[dashboardctl] repair complete. restart the backend.');
}

function rotate(): void {
  getDb();
  const result = rotateSecrets();
  console.log(`[dashboardctl] re-encrypted ${result.reencrypted} integration secret set(s) with the new key.`);
  console.log('[dashboardctl] keep the OLD key safe until you are sure nothing needs decryption (older backups).');
}

main().catch((err) => {
  console.error('[dashboardctl] fatal:', err);
  process.exit(1);
});
