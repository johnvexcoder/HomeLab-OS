import type { Request, Response, NextFunction } from 'express';
import { getDb } from '../db/database';
import { createSessionToken, sha256 } from './crypto';
import { getIntSetting } from './settings';
import { config } from '../config';

export const SESSION_COOKIE = 'homelab_session';

export const SESSION_TTL_MINUTES = 60 * 24 * 7; // absolute cap (7 days)
const MAX_SESSIONS_PER_USER = 12;

export interface SessionUser {
  id: string;
  username: string;
  name: string;
  role: import('./permissions').Role;
  twoFactorEnabled: boolean;
  disabled: boolean;
  mustChangePassword: boolean;
}

export interface AuthContext {
  user: SessionUser;
  sessionId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
      cookies?: Record<string, string>;
    }
  }
}

function ipOf(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
  return req.ip ?? '';
}

export function createSession(userId: string, req: Request): { token: string; expiresAt: number; maxAgeMs: number } {
  const db = getDb();
  const ttlMinutes = Math.max(5, Math.min(getIntSetting('security.sessionTimeoutMinutes', 60), SESSION_TTL_MINUTES));
  const expiresAt = Date.now() + ttlMinutes * 60_000;
  const token = createSessionToken();
  const id = sha256(token);

  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  db.prepare(
    `INSERT INTO sessions (id, token_hash, user_id, ip, user_agent, created_at, last_active_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, id, userId, ipOf(req), (req.headers['user-agent'] ?? '').slice(0, 300), Date.now(), Date.now(), expiresAt);

  // Enforce a sane cap per user (revoke oldest).
  const excess = db
    .prepare('SELECT id FROM sessions WHERE user_id = ? AND revoked = 0 ORDER BY last_active_at ASC')
    .all(userId) as Array<{ id: string }>;
  if (excess.length > MAX_SESSIONS_PER_USER) {
    const toRevoke = excess.slice(0, excess.length - MAX_SESSIONS_PER_USER);
    const revoke = db.prepare('UPDATE sessions SET revoked = 1 WHERE id = ?');
    for (const s of toRevoke) revoke.run(s.id);
  }

  return { token, expiresAt, maxAgeMs: ttlMinutes * 60_000 };
}

export function setSessionCookie(res: Response, token: string, maxAgeMs: number): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
    maxAge: maxAgeMs,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', path: '/' });
}

function fetchUser(userId: string): SessionUser | null {
  const row = getDb().prepare('SELECT * FROM users WHERE id = ?').get(userId) as
    | (Omit<SessionUser, 'twoFactorEnabled' | 'disabled' | 'mustChangePassword'> & {
        two_factor_enabled: number;
        disabled: number;
        must_change_password: number;
        password_hash: string;
        password_salt: string;
      })
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role,
    twoFactorEnabled: row.two_factor_enabled === 1,
    disabled: row.disabled === 1,
    mustChangePassword: row.must_change_password === 1,
  };
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    try {
      out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
    }
  }
  return out;
}

function loadSession(req: Request): AuthContext | null {
  const cookies = req.cookies ?? parseCookies(req.headers.cookie);
  return loadSessionByCookies(cookies);
}

/** Load a session directly from a Cookie header (used by the WS upgrade). */
export function loadSessionByCookieHeader(cookieHeader: string | undefined): AuthContext | null {
  return loadSessionByCookies(parseCookies(cookieHeader));
}

function loadSessionByCookies(cookies: Record<string, string>): AuthContext | null {
  const token = cookies[SESSION_COOKIE];
  if (typeof token !== 'string' || token.length < 32) return null;
  const id = sha256(token);
  const row = getDb().prepare('SELECT * FROM sessions WHERE token_hash = ?').get(id) as
    | { id: string; user_id: string; expires_at: number; revoked: number }
    | undefined;
  if (!row) return null;
  if (row.revoked === 1 || row.expires_at < Date.now()) {
    getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(id);
    return null;
  }
  const user = fetchUser(row.user_id);
  if (!user || user.disabled) return null;

  // Sliding expiry: refresh last_active and expiry when >1/3 of TTL elapsed.
  const ttlMs = getIntSetting('security.sessionTimeoutMinutes', 60) * 60_000;
  const refreshAfter = row.expires_at - ttlMs * (2 / 3);
  if (Date.now() > refreshAfter) {
    const expiresAt = Date.now() + ttlMs;
    getDb()
      .prepare('UPDATE sessions SET last_active_at = ?, expires_at = ? WHERE id = ?')
      .run(Date.now(), expiresAt, row.id);
  }

  return { user, sessionId: row.id };
}

export function authenticate(_req: Request, res: Response, next: NextFunction): void {
  const ctx = loadSession(_req);
  if (!ctx) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  _req.auth = ctx;
  next();
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  req.auth = loadSession(req) ?? undefined;
  next();
}

export function revokeSession(sessionId: string): void {
  getDb().prepare('UPDATE sessions SET revoked = 1 WHERE id = ?').run(sessionId);
}

/** Revoke a specific session, but only if it belongs to the given user. */
export function revokeSessionByUser(userId: string, sessionId: string): boolean {
  const res = getDb()
    .prepare('UPDATE sessions SET revoked = 1 WHERE id = ? AND user_id = ?')
    .run(sessionId, userId);
  return res.changes > 0;
}

export function revokeAllSessionsForUser(userId: string, exceptSessionId?: string): number {
  const res = getDb()
    .prepare('UPDATE sessions SET revoked = 1 WHERE user_id = ? AND revoked = 0 AND id != ?')
    .run(userId, exceptSessionId ?? '');
  return res.changes;
}

/** Emergency lock: revoke every session except the requester's. */
export function revokeAllSessions(exceptSessionId?: string): number {
  const res = getDb()
    .prepare('UPDATE sessions SET revoked = 1 WHERE revoked = 0 AND id != ?')
    .run(exceptSessionId ?? '');
  return res.changes;
}

export function listSessionsForUser(userId: string, exceptSessionId?: string): unknown[] {
  return getDb()
    .prepare(
      `SELECT id, ip, user_agent, created_at, last_active_at, expires_at, revoked
       FROM sessions WHERE user_id = ? AND id != ? ORDER BY last_active_at DESC`,
    )
    .all(userId, exceptSessionId ?? '');
}

export { ipOf };
