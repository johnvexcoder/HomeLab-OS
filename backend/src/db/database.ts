import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config';
import type { MetricSnapshot } from '../types';

let db: Database.Database | null = null;

export interface MetricRow {
  id: number;
  server_id: string;
  ts: number;
  cpu: number;
  ram_used_gb: number;
  ram_total_gb: number;
  disk_used_gb: number;
  disk_total_gb: number;
  temp_c: number;
  net_up_mbps: number;
  net_down_mbps: number;
  load: number;
  uptime_seconds: number;
  processes: number;
  status: string;
}

export interface NotificationRow {
  id: string;
  title: string;
  message: string;
  severity: string;
  timestamp: number;
  read: number;
  server_id: string | null;
}

export function getDb(): Database.Database {
  if (db) return db;

  const dataDir = config.dataDir;
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  db = new Database(path.join(dataDir, 'homelab.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  migrate(db);
  return db;
}

export function dbFilePath(): string {
  return path.join(config.dataDir, 'homelab.db');
}

/** Close the live handle (used by restore/repair). Re-opened lazily. */
export function closeDb(): void {
  if (db) {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      // ignore
    }
    db.close();
    db = null;
  }
}

function migrate(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      cpu REAL NOT NULL,
      ram_used_gb REAL NOT NULL,
      ram_total_gb REAL NOT NULL,
      disk_used_gb REAL NOT NULL,
      disk_total_gb REAL NOT NULL,
      temp_c REAL NOT NULL,
      net_up_mbps REAL NOT NULL,
      net_down_mbps REAL NOT NULL,
      load REAL NOT NULL,
      uptime_seconds REAL NOT NULL,
      processes INTEGER NOT NULL,
      status TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_metrics_server_ts ON metrics(server_id, ts);

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      severity TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      server_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_ts ON notifications(timestamp DESC);

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'VIEWER',
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_updated_at INTEGER,
      two_factor_enabled INTEGER NOT NULL DEFAULT 0,
      totp_secret TEXT,
      recovery_codes TEXT,
      disabled INTEGER NOT NULL DEFAULT 0,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_login_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      ip TEXT,
      user_agent TEXT,
      created_at INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      user_id TEXT,
      username TEXT,
      role TEXT,
      ip TEXT,
      user_agent TEXT,
      action TEXT NOT NULL,
      target TEXT,
      result TEXT NOT NULL,
      details TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_logs(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(username);
    CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);

    CREATE TABLE IF NOT EXISTS integrations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      configured INTEGER NOT NULL DEFAULT 0,
      config TEXT,
      secrets TEXT,
      status TEXT NOT NULL DEFAULT 'disabled',
      last_success_at INTEGER,
      last_error_at INTEGER,
      last_error TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS config_snapshots (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      note TEXT,
      created_at INTEGER NOT NULL,
      created_by TEXT,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS backups (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      file TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      status TEXT NOT NULL,
      note TEXT
    );

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      host_id TEXT NOT NULL UNIQUE,
      host_name TEXT NOT NULL,
      ip TEXT NOT NULL DEFAULT '',
      api_key_prefix TEXT NOT NULL,
      api_key_hash TEXT NOT NULL,
      os TEXT NOT NULL DEFAULT '',
      cpu_cores INTEGER NOT NULL DEFAULT 0,
      ram_total_gb REAL NOT NULL DEFAULT 0,
      host_type TEXT NOT NULL DEFAULT 'unknown',
      cpu_usage REAL NOT NULL DEFAULT 0,
      ram_used_gb REAL NOT NULL DEFAULT 0,
      disk_used_gb REAL NOT NULL DEFAULT 0,
      disk_total_gb REAL NOT NULL DEFAULT 0,
      net_down_mbps REAL NOT NULL DEFAULT 0,
      net_up_mbps REAL NOT NULL DEFAULT 0,
      uptime_seconds INTEGER NOT NULL DEFAULT 0,
      temp_c REAL,
      load_1 REAL NOT NULL DEFAULT 0,
      containers_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending',
      last_report_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agents_host_id ON agents(host_id);
  `);

  // Incremental column migrations (safe on pre-existing databases).
  const userColumns = database.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
  const hasColumn = (name: string) => userColumns.some((c) => c.name === name);
  if (!hasColumn('email')) database.exec('ALTER TABLE users ADD COLUMN email TEXT');
  if (!hasColumn('security_questions')) database.exec('ALTER TABLE users ADD COLUMN security_questions TEXT');
  if (!hasColumn('email_otp_enabled')) {
    database.exec('ALTER TABLE users ADD COLUMN email_otp_enabled INTEGER NOT NULL DEFAULT 0');
  }

  // Agent table incremental migrations (v2 plugin support).
  const agentColumns = database.prepare('PRAGMA table_info(agents)').all() as Array<{ name: string }>;
  const hasAgentCol = (name: string) => agentColumns.some((c) => c.name === name);
  if (!hasAgentCol('plugins_json')) database.exec("ALTER TABLE agents ADD COLUMN plugins_json TEXT NOT NULL DEFAULT '[]'");
  if (!hasAgentCol('capabilities_json')) database.exec("ALTER TABLE agents ADD COLUMN capabilities_json TEXT NOT NULL DEFAULT '[]'");
  if (!hasAgentCol('agent_version')) database.exec("ALTER TABLE agents ADD COLUMN agent_version TEXT NOT NULL DEFAULT '1.0.0'");
  if (!hasAgentCol('process_count')) database.exec("ALTER TABLE agents ADD COLUMN process_count INTEGER NOT NULL DEFAULT 0");
  if (!hasAgentCol('container_count')) database.exec("ALTER TABLE agents ADD COLUMN container_count INTEGER NOT NULL DEFAULT 0");
  if (!hasAgentCol('running_count')) database.exec("ALTER TABLE agents ADD COLUMN running_count INTEGER NOT NULL DEFAULT 0");
  if (!hasAgentCol('unhealthy_count')) database.exec("ALTER TABLE agents ADD COLUMN unhealthy_count INTEGER NOT NULL DEFAULT 0");
  if (!hasAgentCol('vm_id')) database.exec("ALTER TABLE agents ADD COLUMN vm_id TEXT");
  if (!hasAgentCol('parent_ip')) database.exec("ALTER TABLE agents ADD COLUMN parent_ip TEXT");
  if (!hasAgentCol('virt_type')) database.exec("ALTER TABLE agents ADD COLUMN virt_type TEXT");
  if (!hasAgentCol('machine_id')) database.exec("ALTER TABLE agents ADD COLUMN machine_id TEXT NOT NULL DEFAULT ''");
  if (!hasAgentCol('mac_address')) database.exec("ALTER TABLE agents ADD COLUMN mac_address TEXT NOT NULL DEFAULT ''");
  if (!hasAgentCol('host_type_detected')) database.exec("ALTER TABLE agents ADD COLUMN host_type_detected TEXT NOT NULL DEFAULT ''");
  if (!hasAgentCol('hypervisor')) database.exec("ALTER TABLE agents ADD COLUMN hypervisor TEXT NOT NULL DEFAULT ''");
  if (!hasAgentCol('tags_json')) database.exec("ALTER TABLE agents ADD COLUMN tags_json TEXT NOT NULL DEFAULT '{}'");

  // Agent events table.
  database.exec(`
    CREATE TABLE IF NOT EXISTS agent_events (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      plugin TEXT NOT NULL,
      resource TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      previous_state TEXT NOT NULL DEFAULT '',
      current_state TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_agent_events_agent_id ON agent_events(agent_id);
    CREATE INDEX IF NOT EXISTS idx_agent_events_timestamp ON agent_events(timestamp);
  `);
}

/** Persist a batch of snapshots in one transaction. */
let lastPruneAt = 0;

export function insertMetrics(snapshots: MetricSnapshot[]): void {
  const database = getDb();
  const stmt = database.prepare(`
    INSERT INTO metrics
      (server_id, ts, cpu, ram_used_gb, ram_total_gb, disk_used_gb, disk_total_gb,
       temp_c, net_up_mbps, net_down_mbps, load, uptime_seconds, processes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = database.transaction((rows: MetricSnapshot[]) => {
    for (const s of rows) {
      stmt.run(
        s.serverId, s.timestamp, s.cpu, s.ramUsedGb, s.ramTotalGb,
        s.diskUsedGb, s.diskTotalGb, s.tempC, s.netUpMbps, s.netDownMbps,
        s.load, s.uptimeSeconds, s.processes, s.status,
      );
    }
  });
  tx(snapshots);

  // Periodic TTL pruning (once every hour) to prevent unbounded DB growth
  const now = Date.now();
  if (now - lastPruneAt > 3600_000) {
    lastPruneAt = now;
    try {
      const retentionMs = Math.max(24, config.historyRetentionHours) * 3600 * 1000;
      const cutoff = now - retentionMs;
      database.prepare(`DELETE FROM metrics WHERE ts < ?`).run(cutoff);
    } catch {
      // ignore pruning errors during recovery/backup
    }
  }
}

export function queryMetrics(
  serverId: string,
  from: number,
  to: number,
  limit = 100_000,
): MetricRow[] {
  const database = getDb();
  return database
    .prepare(
      `SELECT * FROM metrics
       WHERE server_id = ? AND ts >= ? AND ts <= ?
       ORDER BY ts ASC
       LIMIT ?`,
    )
    .all(serverId, from, to, limit) as MetricRow[];
}

export function insertNotification(notification: NotificationRow): void {
  const database = getDb();
  database
    .prepare(
      `INSERT OR IGNORE INTO notifications (id, title, message, severity, timestamp, read, server_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      notification.id,
      notification.title,
      notification.message,
      notification.severity,
      notification.timestamp,
      notification.read,
      notification.server_id,
    );
}

export function getNotifications(limit: number, offset = 0): NotificationRow[] {
  const database = getDb();
  return database
    .prepare(
      `SELECT * FROM notifications ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as NotificationRow[];
}

export function getUnreadCount(): number {
  const database = getDb();
  const row = database.prepare(`SELECT COUNT(*) as c FROM notifications WHERE read = 0`).get() as { c: number };
  return row.c;
}

export function markNotificationsRead(ids: string[]): void {
  const database = getDb();
  const tx = database.transaction((list: string[]) => {
    const stmt = database.prepare(`UPDATE notifications SET read = 1 WHERE id = ?`);
    for (const id of list) stmt.run(id);
  });
  tx(ids);
}

export function markAllNotificationsRead(): void {
  getDb().prepare(`UPDATE notifications SET read = 1`).run();
}

export function countMetrics(): number {
  const database = getDb();
  const row = database.prepare(`SELECT COUNT(*) as c FROM metrics`).get() as { c: number };
  return row.c;
}
