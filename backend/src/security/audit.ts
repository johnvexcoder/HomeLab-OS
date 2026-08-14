import { getDb } from '../db/database';
import { getBoolSetting } from './settings';

export interface AuditEntry {
  ts: number;
  userId?: string;
  username?: string;
  role?: string;
  ip?: string;
  userAgent?: string;
  action: string;
  target?: string;
  result: 'success' | 'failure' | 'denied';
  details?: string;
}

export function audit(entry: AuditEntry): void {
  if (!getBoolSetting('security.auditEnabled')) return;
  try {
    getDb()
      .prepare(
        `INSERT INTO audit_logs (ts, user_id, username, role, ip, user_agent, action, target, result, details)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.ts,
        entry.userId ?? null,
        entry.username ?? null,
        entry.role ?? null,
        entry.ip ?? null,
        entry.userAgent ? entry.userAgent.slice(0, 500) : null,
        entry.action,
        entry.target ?? null,
        entry.result,
        entry.details ? entry.details.slice(0, 2000) : null,
      );
  } catch {
    // Audit must never take the request down.
  }
}

export interface AuditQuery {
  page?: number;
  perPage?: number;
  search?: string;
  action?: string;
  result?: string;
  from?: number;
  to?: number;
}

export function listAudit(query: AuditQuery): { items: unknown[]; total: number } {
  const page = Math.max(1, query.page ?? 1);
  const perPage = Math.min(200, Math.max(1, query.perPage ?? 50));
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query.search) {
    conditions.push('(username LIKE ? OR target LIKE ? OR details LIKE ?)');
    const like = `%${query.search}%`;
    params.push(like, like, like);
  }
  if (query.action) {
    conditions.push('action = ?');
    params.push(query.action);
  }
  if (query.result) {
    conditions.push('result = ?');
    params.push(query.result);
  }
  if (query.from) {
    conditions.push('ts >= ?');
    params.push(query.from);
  }
  if (query.to) {
    conditions.push('ts <= ?');
    params.push(query.to);
  }

  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  const db = getDb();
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM audit_logs${where}`).get(...params) as { c: number }).c;
  const items = db
    .prepare(`SELECT * FROM audit_logs${where} ORDER BY ts DESC LIMIT ? OFFSET ?`)
    .all(...params, perPage, (page - 1) * perPage);
  return { items, total };
}

/** Distinct audit actions for filter dropdowns. */
export function auditActions(): string[] {
  return (getDb().prepare('SELECT DISTINCT action FROM audit_logs ORDER BY action').all() as Array<{ action: string }>).map(
    (r) => r.action,
  );
}

export function purgeAudit(olderThanMs: number): number {
  const res = getDb().prepare('DELETE FROM audit_logs WHERE ts < ?').run(Date.now() - olderThanMs);
  return res.changes;
}
