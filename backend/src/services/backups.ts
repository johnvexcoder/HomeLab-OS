import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from '../config';
import { getDb, closeDb, dbFilePath } from '../db/database';
import { getAllSettings, getFeaturesMap } from '../security/settings';

export type BackupType = 'manual' | 'daily' | 'weekly' | 'monthly';

export interface BackupMeta {
  id: string;
  type: BackupType;
  file: string;
  size: number;
  createdAt: number;
  status: 'ok' | 'failed';
  note: string | null;
}

const BACKUPS_DIR = () => path.join(config.dataDir, 'backups');

function ensureDir(): string {
  const dir = BACKUPS_DIR();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Online SQLite backup via better-sqlite3's `db.backup()` — the safest way to
 * snapshot a WAL database without stopping the server. A JSON manifest records
 * settings/features/integration configs with secrets redacted.
 */
export async function createBackup(type: BackupType, note?: string, by?: string): Promise<BackupMeta> {
  const id = randomBytes(8).toString('hex');
  const dir = ensureDir();
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `homelab-${ts}-${type}.db`);
  const db = getDb();

  try {
    await db.backup(file);
    const size = fs.statSync(file).size;

    const manifest = {
      version: 1,
      createdAt: Date.now(),
      type,
      createdBy: by ?? null,
      note: note ?? null,
      settings: getAllSettings(),
      features: getFeaturesMap(),
      integrations: (getDb().prepare('SELECT id, name, kind, enabled, configured, config FROM integrations').all() as Array<{
        id: string;
        name: string;
        kind: string;
        enabled: number;
        configured: number;
        config: string | null;
      }>).map((i) => ({
        id: i.id,
        name: i.name,
        kind: i.kind,
        enabled: i.enabled === 1,
        configured: i.configured === 1,
        config: i.config ? JSON.parse(i.config) : null,
      })),
    };
    fs.writeFileSync(`${file}.manifest.json`, JSON.stringify(manifest, null, 2));

    getDb()
      .prepare('INSERT INTO backups (id, type, file, size, created_at, status, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, type, file, size, Date.now(), 'ok', note ?? null);

    pruneRetention();
    return { id, type, file, size, createdAt: Date.now(), status: 'ok', note: note ?? null };
  } catch (err) {
    getDb()
      .prepare('INSERT INTO backups (id, type, file, size, created_at, status, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, type, file, 0, Date.now(), 'failed', String(err));
    throw err;
  }
}

/** Retention policy: keep N daily, M weekly, K monthly (manual backups kept). */
export function pruneRetention(): { removed: string[] } {
  const { getIntSetting } = require('../security/settings') as typeof import('../security/settings');
  const keepDaily = Math.max(1, getIntSetting('backup.retentionDaily', 7));
  const keepWeekly = Math.max(1, getIntSetting('backup.retentionWeekly', 4));
  const keepMonthly = Math.max(1, getIntSetting('backup.retentionMonthly', 12));

  const rows = getDb().prepare('SELECT id, type, file, created_at FROM backups WHERE status = ? ORDER BY created_at DESC').all('ok') as Array<{
    id: string;
    type: string;
    file: string;
    created_at: number;
  }>;

  const byType: Record<string, string[]> = { daily: [], weekly: [], monthly: [] };
  for (const row of rows) {
    if (row.type !== 'manual' && byType[row.type]) byType[row.type].push(row.id);
  }

  const caps: Record<string, number> = { daily: keepDaily, weekly: keepWeekly, monthly: keepMonthly };
  const redundant: string[] = [];
  for (const [type, ids] of Object.entries(byType)) redundant.push(...ids.slice(caps[type] ?? 7));
  const removed: string[] = [];
  const del = getDb().prepare('DELETE FROM backups WHERE id = ?');
  for (const id of redundant) {
    const row = rows.find((r) => r.id === id);
    if (row) {
      try {
        fs.unlinkSync(row.file);
        fs.unlinkSync(`${row.file}.manifest.json`);
      } catch {
        // ignore
      }
    }
    del.run(id);
    removed.push(id);
  }
  return { removed };
}

export function listBackups(limit = 50): BackupMeta[] {
  return getDb()
    .prepare('SELECT id, type, file, size, created_at, status, note FROM backups ORDER BY created_at DESC LIMIT ?')
    .all(limit) as BackupMeta[];
}

export function deleteBackup(id: string): boolean {
  const row = getDb().prepare('SELECT file FROM backups WHERE id = ?').get(id) as { file: string } | undefined;
  if (!row) return false;
  getDb().prepare('DELETE FROM backups WHERE id = ?').run(id);
  try {
    fs.unlinkSync(row.file);
    fs.unlinkSync(`${row.file}.manifest.json`);
  } catch {
    // ignore
  }
  return true;
}

/**
 * Restore a backup file: protect the current DB, then swap the backup in.
 * Requires a restart afterwards to fully resynchronize in-memory state.
 */
export function restoreBackup(file: string): { restored: boolean; needsRestart: boolean; message: string } {
  if (!fs.existsSync(file)) return { restored: false, needsRestart: true, message: 'backup file not found' };
  const dataDir = config.dataDir;
  const live = dbFilePath();
  const pre = `${live}.pre-restore-${Date.now()}`;

  closeDb();

  try {
    // Verify it is a valid SQLite db before touching the live file.
    const BetterSqlite3 = require('better-sqlite3') as typeof import('better-sqlite3');
    const probe = new BetterSqlite3(file, { readonly: true });
    probe.pragma('quick_check');
    probe.close();
  } catch {
    getDb(); // reopen
    return { restored: false, needsRestart: false, message: 'backup file is not a valid SQLite database' };
  }

  fs.copyFileSync(live, pre);
  try {
    fs.copyFileSync(file, live);
  } catch {
    fs.copyFileSync(pre, live);
    getDb();
    return { restored: false, needsRestart: false, message: 'restore copy failed' };
  }
  getDb();
  return { restored: true, needsRestart: true, message: `previous db kept at ${pre}` };
}
