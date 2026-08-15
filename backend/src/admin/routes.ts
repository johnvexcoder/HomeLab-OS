import { Router, type Request, type Response } from 'express';
import {
  requireAuth,
  requirePermission,
  requireRole,
  requireAnyPermission,
} from '../security/middleware';
import { getDb } from '../db/database';
import {
  getAllSettings,
  setSetting,
  getBoolSetting,
  getIntSetting,
  publicFeatureStatus,
  FEATURES,
  getFeaturesMap,
} from '../security/settings';
import { audit, listAudit, auditActions } from '../security/audit';
import { listUsers, getUserById, createUser, updateUser, deleteUser } from '../security/users';
import { ROLES, type Role } from '../security/permissions';
import { createBackup, listBackups, deleteBackup, restoreBackup } from '../services/backups';
import { backupStatus } from '../services/backupScheduler';
import { captureSnapshot, listSnapshots, getSnapshot, deleteSnapshot, restoreSnapshot } from '../services/snapshots';
import {
  listIntegrations,
  createIntegration,
  updateIntegration,
  deleteIntegration,
  testIntegration,
  getIntegration,
  INTEGRATION_SECRET_FIELDS,
  type IntegrationKind,
} from '../services/integrations';
import { revokeAllSessions } from '../security/session';
import { verifyPassword } from '../security/crypto';
import { assertSensitiveAllowed } from '../security/rateLimit';
import { passwordStrength } from '../security/passwordPolicy';
import { listQuickActions, saveQuickActions } from '../services/quickActions';

/**
 * Settings keys that can be changed via the API. Everything else (modes,
 * features, credentials) has dedicated endpoints with stronger checks.
 */
const WRITABLE_SETTINGS = new Set([
  'security.readOnly',
  'security.sessionTimeoutMinutes',
  'security.absoluteSessionHours',
  'security.maxLoginAttempts',
  'security.lockoutMinutes',
  'security.loginRateLimitPerMinute',
  'security.passwordPolicyMinLength',
  'security.passwordPolicyRequireSymbol',
  'security.twoFactorEnabled',
  'security.auditEnabled',
  'security.csrfProtection',
  'security.smtpHost',
  'security.smtpPort',
  'security.smtpSecure',
  'security.smtpUser',
  'security.smtpPassword',
  'security.smtpFrom',
  'access.guest.enabled',
  'access.guest.scopes',
  'backup.enabled',
  'backup.retentionDaily',
  'backup.retentionWeekly',
  'backup.retentionMonthly',
  'backup.hour',
  'backup.minute',
]);

function normalizeSettingValue(key: string, value: unknown): string | null {
  if (typeof value === 'boolean' || typeof value === 'string') return String(value);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) return JSON.stringify(value);
  return null;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

export function createAdminRouter(): Router {
  const router = Router();

  // --- Public mode status (used by UI for badges, safe for guests) ---
  router.get('/mode', (_req: Request, res: Response) => {
    res.json({
      readOnly: getBoolSetting('security.readOnly'),
      emergencyLock: getBoolSetting('security.emergencyLock'),
      safeMode: getBoolSetting('security.safeMode'),
      guest: getBoolSetting('access.guest.enabled'),
    });
  });

  // --- Settings ---
  const SMTP_PASSWORD_MASK = '••••••••••';
  router.get('/settings', requireAuth, requirePermission('settings.view'), (_req: Request, res: Response) => {
    const settings = getAllSettings();
    if (settings['security.smtpPassword']) settings['security.smtpPassword'] = SMTP_PASSWORD_MASK;
    res.json({ settings, writable: [...WRITABLE_SETTINGS] });
  });

  router.put('/settings', requireAuth, requirePermission('settings.manage'), (req: Request, res: Response) => {
    const user = req.auth!.user;
    if (!assertSensitiveAllowed(req)) {
      res.status(429).json({ error: 'too_many_requests' });
      return;
    }
    const body = req.body?.settings;
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const applied: string[] = [];
    const invalid: string[] = [];
    for (const [key, value] of Object.entries(body)) {
      if (!WRITABLE_SETTINGS.has(key)) {
        invalid.push(key);
        continue;
      }
      const normalized = normalizeSettingValue(key, value);
      if (normalized === null) {
        invalid.push(key);
        continue;
      }
      if (key === 'security.smtpPassword') {
        if (normalized === SMTP_PASSWORD_MASK || normalized === '') {
          // Keep the existing stored secret unless the admin entered a new one.
          if (normalized === '') setSetting(key, '');
          applied.push(key);
          continue;
        }
      }
      setSetting(key, normalized);
      applied.push(key);
    }

    // Guest master switch ↔ feature flag sync.
    if (applied.includes('access.guest.enabled')) {
      setSetting('feature.guest_mode', getBoolSetting('access.guest.enabled'));
    }

    if (applied.length > 0) {
      captureSnapshot('auto: settings change', user.username, `keys: ${applied.join(', ')}`);
      audit({ ts: Date.now(), userId: user.id, username: user.username, role: user.role, ip: req.ip, userAgent: req.headers['user-agent'], action: 'settings.updated', target: applied.join(','), result: 'success' });
    }
    res.json({ ok: true, applied, invalid });
  });

  // --- Feature flags ---
  router.get('/features', requireAuth, requirePermission('settings.view'), (_req: Request, res: Response) => {
    res.json({ features: publicFeatureStatus() });
  });

  router.put('/features/:id', requireAuth, requirePermission('settings.manage'), (req: Request, res: Response) => {
    const user = req.auth!.user;
    const feature = FEATURES.find((f) => f.id === req.params.id);
    if (!feature) {
      res.status(404).json({ error: 'feature not found' });
      return;
    }
    const enabled = Boolean(req.body?.enabled);
    if (enabled && !feature.supported) {
      res.status(400).json({ error: 'feature unsupported' });
      return;
    }
    setSetting(`feature.${feature.id}`, String(enabled));
    if (feature.id === 'guest_mode') setSetting('access.guest.enabled', String(enabled));
    captureSnapshot('auto: feature flag change', user.username, `feature ${feature.id} → ${enabled}`);
    audit({ ts: Date.now(), userId: user.id, username: user.username, role: user.role, ip: req.ip, userAgent: req.headers['user-agent'], action: 'feature.updated', target: feature.id, result: 'success', details: `enabled=${enabled}` });
    res.json({ ok: true, feature: { id: feature.id, enabled } });
  });

  // --- Users ---
  router.get('/users', requireAuth, requirePermission('users.view'), (_req: Request, res: Response) => {
    res.json({ users: listUsers(), roles: ROLES });
  });

  router.post('/users', requireAuth, requirePermission('users.manage'), (req: Request, res: Response) => {
    const user = req.auth!.user;
    if (!assertSensitiveAllowed(req)) {
      res.status(429).json({ error: 'too_many_requests' });
      return;
    }
    const username = String(req.body?.username ?? '').trim();
    const password = String(req.body?.password ?? '');
    const role = String(req.body?.role ?? 'VIEWER') as Role;
    if (!username || !/^[a-zA-Z0-9._-]{3,32}$/.test(username)) {
      res.status(400).json({ error: 'invalid_username' });
      return;
    }
    if (!ROLES.includes(role)) {
      res.status(400).json({ error: 'invalid_role' });
      return;
    }
    if (role === 'GUEST') {
      res.status(400).json({ error: 'guest_is_not_a_user_role' });
      return;
    }
    const policyError = passwordStrength(password);
    if (policyError) {
      res.status(400).json({ error: 'weak_password', details: policyError });
      return;
    }
    const email = req.body?.email !== undefined && req.body?.email !== '' ? String(req.body.email).trim() : undefined;
    if (email !== undefined && !isValidEmail(email)) {
      res.status(400).json({ error: 'invalid_email' });
      return;
    }
    try {
      const created = createUser({ username, name: String(req.body?.name ?? ''), role, password, mustChangePassword: Boolean(req.body?.mustChangePassword), email });
      audit({ ts: Date.now(), userId: user.id, username: user.username, role: user.role, ip: req.ip, userAgent: req.headers['user-agent'], action: 'user.created', target: created.username, result: 'success', details: `role=${role}${email ? ', email set' : ''}` });
      res.json({ user: created });
    } catch (err) {
      res.status(409).json({ error: 'username_taken' });
      void err;
    }
  });

  router.put('/users/:id', requireAuth, requirePermission('users.manage'), (req: Request, res: Response) => {
    const actor = req.auth!.user;
    const target = getUserById(req.params.id);
    if (!target) {
      res.status(404).json({ error: 'user not found' });
      return;
    }
    if (target.id === actor.id) {
      res.status(400).json({ error: 'cannot_modify_self' });
      return;
    }
    const patch: { name?: string; role?: Role; disabled?: boolean; password?: string; mustChangePassword?: boolean; email?: string | null } = {};
    if (req.body?.name !== undefined) patch.name = String(req.body.name);
    if (req.body?.role !== undefined) {
      const role = req.body.role as Role;
      if (!ROLES.includes(role) || role === 'GUEST') {
        res.status(400).json({ error: 'invalid_role' });
        return;
      }
      if (target.role === 'SUPER_ADMIN' && actor.role !== 'SUPER_ADMIN') {
        res.status(403).json({ error: 'forbidden' });
        return;
      }
      if (role !== 'SUPER_ADMIN' && countSuperAdmins() <= 1 && target.role === 'SUPER_ADMIN') {
        res.status(400).json({ error: 'last_super_admin' });
        return;
      }
      patch.role = role;
    }
    if (req.body?.disabled !== undefined) {
      const disabled = Boolean(req.body.disabled);
      if (disabled && target.role === 'SUPER_ADMIN' && countSuperAdmins() <= 1) {
        res.status(400).json({ error: 'last_super_admin' });
        return;
      }
      patch.disabled = disabled;
    }
    if (req.body?.password) {
      const policyError = passwordStrength(String(req.body.password));
      if (policyError) {
        res.status(400).json({ error: 'weak_password', details: policyError });
        return;
      }
      patch.password = String(req.body.password);
      patch.mustChangePassword = true;
    }
    if (req.body?.mustChangePassword !== undefined) patch.mustChangePassword = Boolean(req.body.mustChangePassword);
    if (req.body?.email !== undefined) {
      const email = req.body.email === null ? null : String(req.body.email).trim();
      if (email !== null && !isValidEmail(email)) {
        res.status(400).json({ error: 'invalid_email' });
        return;
      }
      patch.email = email;
    }

    const updated = updateUser(target.id, patch);
    audit({ ts: Date.now(), userId: actor.id, username: actor.username, role: actor.role, ip: req.ip, userAgent: req.headers['user-agent'], action: 'user.updated', target: target.username, result: 'success', details: Object.keys(patch).join(',') });
    res.json({ user: updated });
  });

  router.delete('/users/:id', requireAuth, requirePermission('users.manage'), (req: Request, res: Response) => {
    const actor = req.auth!.user;
    const target = getUserById(req.params.id);
    if (!target) {
      res.status(404).json({ error: 'user not found' });
      return;
    }
    if (target.id === actor.id) {
      res.status(400).json({ error: 'cannot_delete_self' });
      return;
    }
    if (target.role === 'SUPER_ADMIN' && countSuperAdmins() <= 1) {
      res.status(400).json({ error: 'last_super_admin' });
      return;
    }
    deleteUser(target.id);
    audit({ ts: Date.now(), userId: actor.id, username: actor.username, role: actor.role, ip: req.ip, userAgent: req.headers['user-agent'], action: 'user.deleted', target: target.username, result: 'success' });
    res.json({ ok: true });
  });

  // --- Audit log ---
  router.get('/audit', requireAuth, requirePermission('audit.view'), (req: Request, res: Response) => {
    res.json(
      listAudit({
        page: Number.parseInt(String(req.query.page ?? '1'), 10) || 1,
        perPage: Number.parseInt(String(req.query.perPage ?? '50'), 10) || 50,
        search: req.query.search ? String(req.query.search) : undefined,
        action: req.query.action ? String(req.query.action) : undefined,
        result: req.query.result ? String(req.query.result) : undefined,
      }),
    );
  });

  router.get('/audit/actions', requireAuth, requirePermission('audit.view'), (_req: Request, res: Response) => {
    res.json({ actions: auditActions() });
  });

  // --- Security health ---
  router.get('/security-health', requireAuth, requirePermission('settings.view'), (_req: Request, res: Response) => {
    const db = getDb();
    const sessions = (db.prepare('SELECT COUNT(*) AS c FROM sessions WHERE revoked = 0').get() as { c: number }).c;
    const users = listUsers();
    const admins = users.filter((u) => ['SUPER_ADMIN', 'ADMIN'].includes(u.role));
    const with2fa = users.filter((u) => u.twoFactorEnabled).length;
    const lastBackup = listBackups(1)[0] ?? null;
    res.json({
      users: users.length,
      admins: admins.length,
      sessions,
      twoFactorAdoption: users.length ? Math.round((with2fa / users.length) * 100) : 0,
      passwordPolicy: {
        minLength: getIntSetting('security.passwordPolicyMinLength', 10),
        requireSymbol: getBoolSetting('security.passwordPolicyRequireSymbol'),
      },
      modes: {
        readOnly: getBoolSetting('security.readOnly'),
        safeMode: getBoolSetting('security.safeMode'),
        emergencyLock: getBoolSetting('security.emergencyLock'),
      },
      auditEnabled: getBoolSetting('security.auditEnabled'),
      guestAccess: getBoolSetting('access.guest.enabled'),
      lastBackup: lastBackup ? { createdAt: lastBackup.createdAt, type: lastBackup.type, status: lastBackup.status } : null,
      features: getFeaturesMap(),
    });
  });

  // --- Config snapshots ---
  router.get('/snapshots', requireAuth, requirePermission('settings.view'), (_req: Request, res: Response) => {
    res.json({ snapshots: listSnapshots() });
  });

  router.post('/snapshots', requireAuth, requireAnyPermission(['settings.manage', 'recovery.manage']), (req: Request, res: Response) => {
    const user = req.auth!.user;
    const meta = captureSnapshot(String(req.body?.name ?? `manual-${Date.now()}`).slice(0, 120), user.username, req.body?.note ? String(req.body.note) : undefined);
    audit({ ts: Date.now(), userId: user.id, username: user.username, role: user.role, ip: req.ip, userAgent: req.headers['user-agent'], action: 'snapshot.created', target: meta.name, result: 'success' });
    res.json({ snapshot: meta });
  });

  router.get('/snapshots/:id', requireAuth, requirePermission('settings.view'), (req: Request, res: Response) => {
    const data = getSnapshot(req.params.id);
    if (!data) {
      res.status(404).json({ error: 'snapshot not found' });
      return;
    }
    res.json({ snapshot: data });
  });

  router.post('/snapshots/:id/restore', requireAuth, requirePermission('recovery.manage'), (req: Request, res: Response) => {
    const user = req.auth!.user;
    const result = restoreSnapshot(req.params.id, user.username);
    if (!result.restored) {
      res.status(404).json({ error: 'snapshot not found' });
      return;
    }
    audit({ ts: Date.now(), userId: user.id, username: user.username, role: user.role, ip: req.ip, userAgent: req.headers['user-agent'], action: 'snapshot.restored', target: req.params.id, result: 'success' });
    res.json({ ok: true, integrationsRestored: result.integrationCount });
  });

  router.delete('/snapshots/:id', requireAuth, requirePermission('settings.manage'), (req: Request, res: Response) => {
    const user = req.auth!.user;
    if (!deleteSnapshot(req.params.id)) {
      res.status(404).json({ error: 'snapshot not found' });
      return;
    }
    audit({ ts: Date.now(), userId: user.id, username: user.username, role: user.role, ip: req.ip, userAgent: req.headers['user-agent'], action: 'snapshot.deleted', target: req.params.id, result: 'success' });
    res.json({ ok: true });
  });

  // --- Integrations ---
  router.get('/integrations', requireAuth, requirePermission('integrations.view'), (_req: Request, res: Response) => {
    res.json({
      integrations: listIntegrations(),
      kinds: Object.fromEntries(Object.entries(INTEGRATION_SECRET_FIELDS).map(([kind, fields]) => [kind, { secretFields: fields }])),
      featureMap: {
        uptime_kuma_integration: getBoolSetting('feature.uptime_kuma_integration'),
        telegram_notifications: getBoolSetting('feature.telegram_notifications'),
        email_notifications: getBoolSetting('feature.email_notifications'),
        prometheus_integration: getBoolSetting('feature.prometheus_integration'),
        ai_assistant: getBoolSetting('feature.ai_assistant'),
      },
    });
  });

  router.post('/integrations', requireAuth, requirePermission('integrations.manage'), (req: Request, res: Response) => {
    const user = req.auth!.user;
    const kind = String(req.body?.kind ?? '') as IntegrationKind;
    if (!(kind in INTEGRATION_SECRET_FIELDS)) {
      res.status(400).json({ error: 'invalid_kind' });
      return;
    }
    const integration = createIntegration({
      name: String(req.body?.name ?? ''),
      kind,
      enabled: Boolean(req.body?.enabled),
      config: req.body?.config && typeof req.body.config === 'object' ? req.body.config : {},
      secrets: req.body?.secrets && typeof req.body.secrets === 'object' ? req.body.secrets : {},
    });
    audit({ ts: Date.now(), userId: user.id, username: user.username, role: user.role, ip: req.ip, userAgent: req.headers['user-agent'], action: 'integration.created', target: integration.name, result: 'success' });
    res.json({ integration });
  });

  router.put('/integrations/:id', requireAuth, requirePermission('integrations.manage'), (req: Request, res: Response) => {
    const user = req.auth!.user;
    const existing = getIntegration(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'integration not found' });
      return;
    }
    const integration = updateIntegration(req.params.id, {
      name: req.body?.name !== undefined ? String(req.body.name) : undefined,
      kind: req.body?.kind !== undefined ? (String(req.body.kind) as IntegrationKind) : undefined,
      enabled: req.body?.enabled !== undefined ? Boolean(req.body.enabled) : undefined,
      config: req.body?.config !== undefined && typeof req.body.config === 'object' ? req.body.config : undefined,
      secrets: req.body?.secrets !== undefined && typeof req.body.secrets === 'object' ? req.body.secrets : undefined,
    });
    audit({ ts: Date.now(), userId: user.id, username: user.username, role: user.role, ip: req.ip, userAgent: req.headers['user-agent'], action: 'integration.updated', target: integration?.name ?? req.params.id, result: 'success' });
    res.json({ integration });
  });

  router.delete('/integrations/:id', requireAuth, requirePermission('integrations.manage'), (req: Request, res: Response) => {
    const user = req.auth!.user;
    if (!deleteIntegration(req.params.id)) {
      res.status(404).json({ error: 'integration not found' });
      return;
    }
    audit({ ts: Date.now(), userId: user.id, username: user.username, role: user.role, ip: req.ip, userAgent: req.headers['user-agent'], action: 'integration.deleted', target: req.params.id, result: 'success' });
    res.json({ ok: true });
  });

  router.post('/integrations/:id/test', requireAuth, requirePermission('integrations.manage'), async (req: Request, res: Response) => {
    const user = req.auth!.user;
    const result = await testIntegration(req.params.id);
    audit({ ts: Date.now(), userId: user.id, username: user.username, role: user.role, ip: req.ip, userAgent: req.headers['user-agent'], action: 'integration.test', target: req.params.id, result: result.ok ? 'success' : 'failure', details: result.error });
    if (!result.ok && result.error) {
      res.json({ ok: false, error: result.error });
      return;
    }
    res.json({ ok: true, latencyMs: result.latencyMs });
  });

  // --- Backups ---
  router.get('/backups', requireAuth, requirePermission('backups.view'), (_req: Request, res: Response) => {
    res.json({ backups: listBackups(), status: backupStatus() });
  });

  router.post('/backups', requireAuth, requirePermission('backups.manage'), async (req: Request, res: Response) => {
    const user = req.auth!.user;
    try {
      const backup = await createBackup('manual', req.body?.note ? String(req.body.note) : undefined, user.username);
      audit({ ts: Date.now(), userId: user.id, username: user.username, role: user.role, ip: req.ip, userAgent: req.headers['user-agent'], action: 'backup.created', target: backup.file, result: 'success', details: 'manual' });
      res.json({ backup });
    } catch (err) {
      audit({ ts: Date.now(), userId: user.id, username: user.username, role: user.role, ip: req.ip, userAgent: req.headers['user-agent'], action: 'backup.created', result: 'failure', details: String(err) });
      res.status(500).json({ error: 'backup_failed' });
    }
  });

  router.delete('/backups/:id', requireAuth, requirePermission('backups.manage'), (req: Request, res: Response) => {
    const user = req.auth!.user;
    if (!deleteBackup(req.params.id)) {
      res.status(404).json({ error: 'backup not found' });
      return;
    }
    audit({ ts: Date.now(), userId: user.id, username: user.username, role: user.role, ip: req.ip, userAgent: req.headers['user-agent'], action: 'backup.deleted', target: req.params.id, result: 'success' });
    res.json({ ok: true });
  });

  router.post('/backups/:id/restore', requireAuth, requirePermission('recovery.manage'), async (req: Request, res: Response) => {
    const user = req.auth!.user;
    const row = getDb().prepare('SELECT file FROM backups WHERE id = ?').get(req.params.id) as { file: string } | undefined;
    if (!row) {
      res.status(404).json({ error: 'backup not found' });
      return;
    }
    const result = restoreBackup(row.file);
    audit({ ts: Date.now(), userId: user.id, username: user.username, role: user.role, ip: req.ip, userAgent: req.headers['user-agent'], action: 'backup.restored', target: row.file, result: result.restored ? 'success' : 'failure', details: result.message });
    res.json(result);
  });

  // --- Emergency controls ---
  router.post('/lock', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN'), requirePermission('recovery.manage'), (req: Request, res: Response) => {
    const user = req.auth!.user;
    setSetting('security.emergencyLock', 'true');
    const revoked = revokeAllSessions(req.auth!.sessionId);
    audit({ ts: Date.now(), userId: user.id, username: user.username, role: user.role, ip: req.ip, userAgent: req.headers['user-agent'], action: 'emergency_lock.enabled', result: 'success', details: `sessions revoked: ${revoked}` });
    res.json({ ok: true, revoked });
  });

  router.post('/unlock', requireAuth, requireRole('SUPER_ADMIN'), (req: Request, res: Response) => {
    const user = req.auth!.user;
    const row = getUserById(user.id)!;
    const password = String(req.body?.password ?? '');
    if (!verifyPassword(password, row.password_salt, row.password_hash)) {
      audit({ ts: Date.now(), userId: user.id, username: user.username, role: user.role, ip: req.ip, userAgent: req.headers['user-agent'], action: 'emergency_lock.unlock_failed', result: 'failure' });
      res.status(400).json({ error: 'current_password_incorrect' });
      return;
    }
    setSetting('security.emergencyLock', 'false');
    audit({ ts: Date.now(), userId: user.id, username: user.username, role: user.role, ip: req.ip, userAgent: req.headers['user-agent'], action: 'emergency_lock.disabled', result: 'success' });
    res.json({ ok: true });
  });

  router.post('/safe-mode', requireAuth, requirePermission('system.manage'), (req: Request, res: Response) => {
    const user = req.auth!.user;
    const enabled = Boolean(req.body?.enabled);
    setSetting('security.safeMode', String(enabled));
    audit({ ts: Date.now(), userId: user.id, username: user.username, role: user.role, ip: req.ip, userAgent: req.headers['user-agent'], action: 'safe_mode.updated', result: 'success', details: `enabled=${enabled}` });
    res.json({ ok: true, enabled });
  });

  // --- Quick Actions (configurable one-click buttons) ---
  router.get('/quick-actions', requireAuth, requirePermission('settings.view'), (_req: Request, res: Response) => {
    res.json(listQuickActions());
  });

  router.put('/quick-actions', requireAuth, requirePermission('settings.manage'), (req: Request, res: Response) => {
    const user = req.auth!.user;
    const result = saveQuickActions(req.body?.actions);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    audit({ ts: Date.now(), userId: user.id, username: user.username, role: user.role, ip: req.ip, userAgent: req.headers['user-agent'], action: 'quick_actions.updated', result: 'success', details: `count=${result.actions.length}` });
    res.json({ ok: true, actions: result.actions });
  });

  return router;
}

function countSuperAdmins(): number {
  const row = getDb().prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'SUPER_ADMIN'").get() as { c: number };
  return row.c;
}
