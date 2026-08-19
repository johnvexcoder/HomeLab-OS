import type { Request, Response, NextFunction } from 'express';
import { roleHasPermission, type Permission, type Role } from './permissions';
import { authenticate, optionalAuth } from './session';
import { getBoolSetting, getJsonSetting } from './settings';
import { validateCsrf, CSRF_COOKIE, CSRF_HEADER } from './csrf';
import { audit } from './audit';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Express middleware: requires a valid session. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  authenticate(req, res, next);
}

/** Express middleware: attaches auth if present (never rejects). */
export function authOptional(req: Request, res: Response, next: NextFunction): void {
  optionalAuth(req, res, next);
}

/** Express middleware factory: require a specific permission. */
export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    if (!roleHasPermission(req.auth.user.role, permission)) {
      audit({
        ts: Date.now(),
        userId: req.auth.user.id,
        username: req.auth.user.username,
        role: req.auth.user.role,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        action: 'permission.denied',
        target: `${req.method} ${req.path}`,
        result: 'denied',
      });
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    next();
  };
}

/** Express middleware factory: require one of several permissions. */
export function requireAnyPermission(permissions: Permission[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    if (!permissions.some((p) => roleHasPermission(req.auth!.user.role, p))) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    next();
  };
}

/** Express middleware: require exactly one of the given roles. */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    if (!roles.includes(req.auth.user.role)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    next();
  };
}

/**
 * Guest access: allow an unauthenticated request IF guest mode is on AND the
 * guest scope grants the permission. Used on read-only data endpoints.
 */
export function requireAuthOrGuest(_permission: Permission, scopeKey: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    optionalAuth(req, res, () => {
      if (req.auth) {
        if (roleHasPermission(req.auth.user.role, _permission)) return next();
        res.status(403).json({ error: 'forbidden' });
        return;
      }
      if (guestScopeIncludes(scopeKey)) {
        next();
        return;
      }
      res.status(403).json({ error: 'forbidden' });
    });
  };
}

export function guestScopeIncludes(scopeKey: string): boolean {
  if (!getBoolSetting('access.guest.enabled')) return false;
  const scopes = getJsonSetting<string[]>('access.guest.scopes', []);
  return scopes.includes(scopeKey);
}

/**
 * Global mutation guard. Rejects state-changing requests while any of these
 * protections are active, with a single audit record. Auth endpoints are
 * exempt by design (login/logout/change-password must stay reachable).
 *
 * Read-only and safe mode both leave one escape hatch: a request that turns
 * the active protection OFF (settings PUT setting `security.readOnly=false`,
 * or `POST /api/admin/safe-mode { enabled:false }`). Otherwise a super admin
 * who enabled the mode from the UI could never disable it from the UI.
 * CSRF and the route's own permission checks still apply to that request.
 */
function fullPath(req: Request): string {
  return `${req.baseUrl}${req.path}`;
}

/** Look up a setting key in either the `{settings:{...}}` or flat body shape. */
function bodySetting(req: Request, key: string): unknown {
  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body !== 'object') return undefined;
  const inner = body.settings as Record<string, unknown> | undefined;
  return (inner && typeof inner === 'object' ? inner : body)[key];
}

/** Settings arrive either as booleans (UI) or normalized strings (API). */
function isFalse(v: unknown): boolean {
  return v === false || v === 'false' || v === 0;
}

export function mutationGuard(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) return next();

  const path = fullPath(req);

  // Login has no CSRF cookie yet by design (SameSite=Lax + rate limiting
  // protect it); logout is harmless. Forgot-password / 2FA challenge helpers
  // also run before a session exists, so they are CSRF-exempt too.
  const csrfExempt =
    path.startsWith('/api/auth/login') ||
    path.startsWith('/api/auth/logout') ||
    path.startsWith('/api/auth/recovery') ||
    path.startsWith('/api/auth/2fa/email/send') ||
    path.startsWith('/api/auth/2fa/question') ||
    path.startsWith('/api/agent/');

  // CSRF double-submit (skipped for authenticated API-token style calls).
  if (!csrfExempt && validateCsrf(req.cookies?.[CSRF_COOKIE], req.headers[CSRF_HEADER] as string | undefined) === false) {
    audit({
      ts: Date.now(),
      username: req.auth?.user.username,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      action: 'csrf.rejected',
      target: `${req.method} ${path}`,
      result: 'failure',
    });
    res.status(403).json({ error: 'csrf' });
    return;
  }

  const emergencyLock = getBoolSetting('security.emergencyLock');
  const readOnly = getBoolSetting('security.readOnly');
  const safeMode = getBoolSetting('security.safeMode');

  // Emergency lock blocks everything except the (SUPER_ADMIN-protected) unlock
  // path and auth. The requester's role is only known after auth middleware
  // runs, so the unlock route itself enforces SUPER_ADMIN.
  if (emergencyLock && !path.startsWith('/api/admin/unlock') && !path.startsWith('/api/auth/')) {
    audit({
      ts: Date.now(),
      userId: req.auth?.user.id,
      username: req.auth?.user.username,
      role: req.auth?.user.role,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      action: 'mutation.blocked',
      target: `${req.method} ${path}`,
      result: 'denied',
      details: 'emergency lock',
    });
    res.status(423).json({ error: 'emergency_lock' });
    return;
  }

  // Read-only mode blocks everything except login/logout/password changes and
  // the explicit turn-off of read-only mode itself.
  if (readOnly && !isAuthExemptPath(fullPath(req)) && !isFalse(bodySetting(req, 'security.readOnly'))) {
    audit({
      ts: Date.now(),
      userId: req.auth?.user.id,
      username: req.auth?.user.username,
      role: req.auth?.user.role,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      action: 'mutation.blocked',
      target: `${req.method} ${fullPath(req)}`,
      result: 'denied',
      details: 'read-only mode',
    });
    res.status(423).json({ error: 'read_only' });
    return;
  }

  // Safe mode: dashboard monitoring stays up, mutations are blocked (except
  // the explicit turn-off of safe mode itself).
  if (safeMode && !isAuthExemptPath(fullPath(req)) && !(fullPath(req) === '/api/admin/safe-mode' && isFalse(req.body?.enabled))) {
    audit({
      ts: Date.now(),
      userId: req.auth?.user.id,
      username: req.auth?.user.username,
      role: req.auth?.user.role,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      action: 'mutation.blocked',
      target: `${req.method} ${fullPath(req)}`,
      result: 'denied',
      details: 'safe mode',
    });
    res.status(423).json({ error: 'safe_mode' });
    return;
  }

  next();
}

/** Paths that must remain writable even in read-only / safe mode. */
function isAuthExemptPath(path: string): boolean {
  return (
    path.startsWith('/api/auth/login') ||
    path.startsWith('/api/auth/logout') ||
    path.startsWith('/api/auth/change-password') ||
    path.startsWith('/api/auth/recovery') ||
    path.startsWith('/api/auth/2fa') ||
    path.startsWith('/api/admin/unlock')
  );
}
