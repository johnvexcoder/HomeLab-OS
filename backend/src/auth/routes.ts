import { Router, type Request, type Response } from 'express';
import { randomBytes } from 'node:crypto';
import {
  getUserByUsername,
  getUserById,
  recordLogin,
  updateUser,
  setupTwoFactor,
  disableTwoFactor,
  getTotpSecret,
  consumeRecoveryCode,
  isPasswordReuse,
  touchPassword,
  toPublicUser,
  setRecoveryEmail,
  clearRecoveryEmail,
  getUserEmail,
  isEmailOtpEnabled,
  setSecurityQuestions,
  clearSecurityQuestions,
  getSecurityQuestionPrompts,
  verifySecurityQuestions,
  pickSecurityQuestion,
  type UserRow,
} from '../security/users';
import { verifyPassword, verifyTotp, verifyRecoveryCode, generateOtpCode, hashAnswer, safeEqual, hashRecoveryCode } from '../security/crypto';
import {
  createSession,
  setSessionCookie,
  clearSessionCookie,
  revokeSession,
  revokeAllSessionsForUser,
  revokeSessionByUser,
  listSessionsForUser,
  ipOf,
  SESSION_COOKIE,
} from '../security/session';
import { generateCsrfToken, CSRF_COOKIE } from '../security/csrf';
import { audit } from '../security/audit';
import { hit, clear as clearRateLimit, lockoutRemainingSeconds, recordLoginFailure } from '../security/rateLimit';
import { requireAuth, authOptional } from '../security/middleware';
import { getBoolSetting, getIntSetting, getJsonSetting } from '../security/settings';
import { permissionsForRole, guestPermissionsFor, type Role } from '../security/permissions';
import { passwordStrength } from '../security/passwordPolicy';
import { smtpConfigured, sendOtpEmail } from '../security/smtp';

type TwoFactorMethod = 'totp' | 'email' | 'question';
type RecoveryMethod = 'questions' | 'email';

interface PendingTwoFactor {
  userId: string;
  username: string;
  role: Role;
  expiresAt: number;
  attempts: number;
  methods: TwoFactorMethod[];
  emailOtp?: { hash: string; expiresAt: number };
  question?: { q: string; hash: string };
}

interface RecoveryEntry {
  userId: string;
  username: string;
  expiresAt: number;
  attempts: number;
  methods: RecoveryMethod[];
  emailOtp?: { hash: string; expiresAt: number };
}

interface ResetEntry {
  userId: string;
  expiresAt: number;
}

const pendingTwoFactor = new Map<string, PendingTwoFactor>();
const recoveryPending = new Map<string, RecoveryEntry>();
const resetTokens = new Map<string, ResetEntry>();
const PENDING_TTL_MS = 5 * 60_000;
const PENDING_MAX_ATTEMPTS = 5;
const OTP_TTL_MS = 10 * 60_000;
const RESET_TTL_MS = 10 * 60_000;

function twoFactorMethodsFor(user: UserRow): TwoFactorMethod[] {
  const methods: TwoFactorMethod[] = [];
  if (user.totp_secret) methods.push('totp');
  if (isEmailOtpEnabled(user.id) && getUserEmail(user.id) && smtpConfigured()) methods.push('email');
  if (user.security_questions) methods.push('question');
  return methods;
}

function recoveryMethodsFor(user: UserRow): RecoveryMethod[] {
  const methods: RecoveryMethod[] = [];
  if (getSecurityQuestionPrompts(user.id).length === 3) methods.push('questions');
  if (isEmailOtpEnabled(user.id) && getUserEmail(user.id) && smtpConfigured()) methods.push('email');
  return methods;
}

function issuePending(user: UserRow, attempts = 0): string {
  const token = randomBytes(24).toString('base64url');
  pendingTwoFactor.set(token, {
    userId: user.id,
    username: user.username,
    role: user.role,
    expiresAt: Date.now() + PENDING_TTL_MS,
    attempts,
    methods: twoFactorMethodsFor(user),
  });
  return token;
}

function consumePending(token: string): PendingTwoFactor | null {
  const entry = pendingTwoFactor.get(token);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    pendingTwoFactor.delete(token);
    return null;
  }
  pendingTwoFactor.delete(token);
  return entry;
}

function peekPending(token: string): PendingTwoFactor | null {
  const entry = pendingTwoFactor.get(token);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    pendingTwoFactor.delete(token);
    return null;
  }
  return entry;
}

function issueRecovery(user: UserRow): string {
  const token = randomBytes(24).toString('base64url');
  recoveryPending.set(token, {
    userId: user.id,
    username: user.username,
    expiresAt: Date.now() + PENDING_TTL_MS,
    attempts: 0,
    methods: recoveryMethodsFor(user),
  });
  return token;
}

function consumeRecovery(token: string): RecoveryEntry | null {
  const entry = recoveryPending.get(token);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    recoveryPending.delete(token);
    return null;
  }
  recoveryPending.delete(token);
  return entry;
}

function peekRecovery(token: string): RecoveryEntry | null {
  const entry = recoveryPending.get(token);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    recoveryPending.delete(token);
    return null;
  }
  return entry;
}

function issueResetToken(userId: string): string {
  const token = randomBytes(24).toString('base64url');
  resetTokens.set(token, { userId, expiresAt: Date.now() + RESET_TTL_MS });
  return token;
}

function consumeResetToken(token: string): ResetEntry | null {
  const entry = resetTokens.get(token);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    resetTokens.delete(token);
    return null;
  }
  resetTokens.delete(token);
  return entry;
}

function modePayload() {
  return {
    readOnly: getBoolSetting('security.readOnly'),
    emergencyLock: getBoolSetting('security.emergencyLock'),
    safeMode: getBoolSetting('security.safeMode'),
    guest: getBoolSetting('access.guest.enabled'),
  };
}

export function createAuthRouter(): Router {
  const router = Router();

  router.post('/login', (req: Request, res: Response) => {
    const ip = ipOf(req);
    const username = String(req.body?.username ?? '').trim();
    const password = String(req.body?.password ?? '');
    const twoFactorToken = typeof req.body?.twoFactorToken === 'string' ? req.body.twoFactorToken : '';
    const twoFactorCode = String(req.body?.twoFactorCode ?? '').trim();

    // General per-IP rate cap for the login endpoint.
    const globalCap = Math.max(5, getIntSetting('security.loginRateLimitPerMinute', 10));
    const global = hit(`login:${ip}`, globalCap);
    if (!global.allowed) {
      res.status(429).json({ error: 'too_many_attempts', retryAfter: global.retryAfterSeconds });
      return;
    }

    if (!username || !password) {
      res.status(400).json({ error: 'missing_credentials' });
      return;
    }

    // --- Step 2: complete a pending 2FA challenge ---
    if (twoFactorToken) {
      const pending = consumePending(twoFactorToken);
      if (!pending) {
        res.status(400).json({ error: 'challenge_expired' });
        return;
      }
      const user = getUserById(pending.userId);
      if (!user || user.disabled) {
        res.status(401).json({ error: 'invalid_credentials' });
        return;
      }
      const method = (String(req.body?.twoFactorMethod ?? 'totp') as TwoFactorMethod) || 'totp';
      let verified = false;
      let recoveryUsed = false;

      if (method === 'email') {
        verified = Boolean(
          pending.emailOtp &&
            pending.emailOtp.expiresAt > Date.now() &&
            safeEqual(hashRecoveryCode(twoFactorCode), pending.emailOtp.hash),
        );
      } else if (method === 'question') {
        verified = Boolean(
          pending.question &&
            pending.question.hash.length === hashAnswer(twoFactorCode).length &&
            pending.question.hash === hashAnswer(twoFactorCode),
        );
      } else {
        const secret = getTotpSecret(pending.userId);
        const isRecovery = secret !== null && verifyRecoveryCode(twoFactorCode, JSON.parse(user.recovery_codes ?? '[]'));
        const isTotp = secret !== null && verifyTotp(secret, twoFactorCode);
        verified = isTotp || isRecovery;
        recoveryUsed = isRecovery;
      }

      if (!verified) {
        pending.attempts += 1;
        if (pending.attempts >= PENDING_MAX_ATTEMPTS) {
          audit({
            ts: Date.now(),
            userId: pending.userId,
            username: pending.username,
            role: pending.role,
            ip,
            userAgent: req.headers['user-agent'],
            action: 'login.2fa_failed',
            result: 'failure',
          });
          res.status(401).json({ error: 'invalid_2fa' });
          return;
        }
        const fresh = issuePending(user, pending.attempts);
        res.status(401).json({ error: 'invalid_2fa', twoFactorToken: fresh, attemptsRemaining: PENDING_MAX_ATTEMPTS - pending.attempts });
        return;
      }
      if (recoveryUsed) {
        consumeRecoveryCode(pending.userId, twoFactorCode);
      }
      finalizeLogin(req, res, user, ip);
      return;
    }

    // --- Step 1: username + password ---
    const user = getUserByUsername(username);
    const lockKey = `lock:${ip}:${username.toLowerCase()}`;
    const maxAttempts = Math.max(2, getIntSetting('security.maxLoginAttempts', 5));
    const lockoutMinutes = Math.max(1, getIntSetting('security.lockoutMinutes', 15));

    if (user && user.disabled) {
      audit({ ts: Date.now(), username, ip, userAgent: req.headers['user-agent'], action: 'login.blocked', result: 'denied', details: 'account disabled' });
      res.status(401).json({ error: 'invalid_credentials' });
      return;
    }

    // Locked out?
    if (user) {
      const remaining = lockoutRemainingSeconds(lockKey, lockoutMinutes, maxAttempts);
      if (remaining > 0) {
        res.status(429).json({ error: 'account_locked', retryAfter: remaining });
        return;
      }
    }

    const valid = user ? verifyPassword(password, user.password_salt, user.password_hash) : false;
    if (!valid || !user) {
      // Anti-enumeration: always do a scrypt compare for unknown users too.
      const dummy = getUserByUsername('__nonexistent__');
      if (dummy) verifyPassword(password, dummy.password_salt, dummy.password_hash);
      recordLoginFailure(lockKey, lockoutMinutes * 60_000);
      if (user) {
        audit({
          ts: Date.now(),
          userId: user.id,
          username: user.username,
          role: user.role,
          ip,
          userAgent: req.headers['user-agent'],
          action: 'login.failed',
          result: 'failure',
        });
        const remaining = lockoutRemainingSeconds(lockKey, lockoutMinutes, maxAttempts);
        if (remaining > 0) {
          res.status(429).json({ error: 'account_locked', retryAfter: remaining });
          return;
        }
      }
      res.status(401).json({ error: 'invalid_credentials' });
      return;
    }

    // 2FA required?
    if (user.two_factor_enabled === 1 && getBoolSetting('security.twoFactorEnabled')) {
      const methods = twoFactorMethodsFor(user);
      if (methods.length > 0) {
        const token = issuePending(user);
        audit({ ts: Date.now(), userId: user.id, username: user.username, role: user.role, ip, userAgent: req.headers['user-agent'], action: 'login.password_ok', result: 'success', details: '2fa required' });
        res.json({ twoFactorRequired: true, twoFactorToken: token, username: user.username, twoFactorMethods: methods });
        return;
      }
      // Fallback: no usable challenge (e.g. SMTP disabled after setup) — allow sign-in.
    }

    clearRateLimit(lockKey);
    finalizeLogin(req, res, user, ip);
  });

  router.post('/logout', authOptional, (req: Request, res: Response) => {
    const sessionId = req.auth?.sessionId;
    if (sessionId) revokeSession(sessionId);
    clearSessionCookie(res);
    res.clearCookie(CSRF_COOKIE);
    res.json({ ok: true });
  });

  router.get('/me', requireAuth, (req: Request, res: Response) => {
    const sessionId = req.auth?.sessionId;
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    const csrf = req.cookies?.[CSRF_COOKIE] as string | undefined;
    const ctx = req.auth;
    if (!ctx) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const user = getUserById(ctx.user.id);
    if (!user) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    res.json({
      user: toPublicUser(user),
      permissions: user.role === 'GUEST' ? guestPermissionsFor(getGuestScopes()) : permissionsForRole(user.role),
      modes: modePayload(),
      session: { id: ctx.sessionId, csrf, tokenSet: !!token },
    });
  });

  router.post('/change-password', requireAuth, (req: Request, res: Response) => {
    const user = req.auth!.user;
    const current = String(req.body?.currentPassword ?? '');
    const next = String(req.body?.newPassword ?? '');

    const row = getUserById(user.id)!;
    if (!verifyPassword(current, row.password_salt, row.password_hash)) {
      audit({ ts: Date.now(), userId: user.id, username: user.username, role: user.role, ip: req.ip, userAgent: req.headers['user-agent'], action: 'password.change_failed', result: 'failure' });
      res.status(400).json({ error: 'current_password_incorrect' });
      return;
    }
    const policyError = passwordStrength(next);
    if (policyError) {
      res.status(400).json({ error: 'weak_password', details: policyError });
      return;
    }
    if (isPasswordReuse(user.id, next)) {
      res.status(400).json({ error: 'password_reuse' });
      return;
    }
    updateUser(user.id, { password: next });
    touchPassword(user.id);
    const revoked = revokeAllSessionsForUser(user.id, req.auth!.sessionId);
    audit({ ts: Date.now(), userId: user.id, username: user.username, role: user.role, ip: req.ip, userAgent: req.headers['user-agent'], action: 'password.changed', result: 'success', details: `sessions revoked: ${revoked}` });
    res.json({ ok: true });
  });

  router.post('/2fa/setup', requireAuth, (req: Request, res: Response) => {
    const user = req.auth!.user;
    const password = String(req.body?.password ?? '');
    const row = getUserById(user.id)!;
    if (!verifyPassword(password, row.password_salt, row.password_hash)) {
      res.status(400).json({ error: 'current_password_incorrect' });
      return;
    }
    if (getBoolSetting('security.twoFactorEnabled') === false) {
      res.status(403).json({ error: 'feature_disabled' });
      return;
    }
    const { secret, recoveryCodes } = setupTwoFactor(user.id);
    audit({ ts: Date.now(), userId: user.id, username: user.username, role: user.role, ip: req.ip, userAgent: req.headers['user-agent'], action: '2fa.setup_started', result: 'success' });
    res.json({ secret, recoveryCodes, otpauth: `otpauth://totp/Homelab:${encodeURIComponent(user.username)}?secret=${secret}&issuer=Homelab&period=30&digits=6&algorithm=SHA1` });
  });

  router.post('/2fa/verify-setup', requireAuth, (req: Request, res: Response) => {
    const user = req.auth!.user;
    const code = String(req.body?.code ?? '');
    const secret = getTotpSecret(user.id);
    if (!secret || !verifyTotp(secret, code)) {
      res.status(400).json({ error: 'invalid_2fa' });
      return;
    }
    audit({ ts: Date.now(), userId: user.id, username: user.username, role: user.role, ip: req.ip, userAgent: req.headers['user-agent'], action: '2fa.enabled', result: 'success' });
    res.json({ ok: true });
  });

  router.post('/2fa/disable', requireAuth, (req: Request, res: Response) => {
    const user = req.auth!.user;
    const password = String(req.body?.password ?? '');
    const row = getUserById(user.id)!;
    if (!verifyPassword(password, row.password_salt, row.password_hash)) {
      res.status(400).json({ error: 'current_password_incorrect' });
      return;
    }
    disableTwoFactor(user.id);
    audit({ ts: Date.now(), userId: user.id, username: user.username, role: user.role, ip: req.ip, userAgent: req.headers['user-agent'], action: '2fa.disabled', result: 'success' });
    res.json({ ok: true });
  });

  router.post('/2fa/regenerate-recovery', requireAuth, (req: Request, res: Response) => {
    const user = req.auth!.user;
    const password = String(req.body?.password ?? '');
    const row = getUserById(user.id)!;
    if (!verifyPassword(password, row.password_salt, row.password_hash)) {
      res.status(400).json({ error: 'current_password_incorrect' });
      return;
    }
    const { secret, recoveryCodes } = setupTwoFactor(user.id);
    audit({ ts: Date.now(), userId: user.id, username: user.username, role: user.role, ip: req.ip, userAgent: req.headers['user-agent'], action: '2fa.recovery_regenerated', result: 'success' });
    res.json({ secret, recoveryCodes });
  });

  // --- Email OTP 2FA (challenge helpers for the login flow) ---

  router.post('/2fa/email/send', (req: Request, res: Response) => {
    const token = String(req.body?.twoFactorToken ?? '');
    const pending = peekPending(token);
    if (!pending) {
      res.status(400).json({ error: 'challenge_expired' });
      return;
    }
    if (!pending.methods.includes('email')) {
      res.status(403).json({ error: 'method_unavailable' });
      return;
    }
    const capped = hit(`2fa-email:${token}`, 3, 5 * 60_000);
    if (!capped.allowed) {
      res.status(429).json({ error: 'too_many_requests', retryAfter: capped.retryAfterSeconds });
      return;
    }
    const email = getUserEmail(pending.userId);
    if (!email) {
      res.status(400).json({ error: 'no_recovery_email' });
      return;
    }
    const code = generateOtpCode(6);
    sendOtpEmail(email, code)
      .then(() => {
        pending.emailOtp = { hash: hashRecoveryCode(code), expiresAt: Date.now() + OTP_TTL_MS };
        audit({ ts: Date.now(), userId: pending.userId, username: pending.username, role: pending.role, ip: ipOf(req), userAgent: req.headers['user-agent'], action: 'login.2fa_email_sent', result: 'success' });
        res.json({ ok: true, resentAfterSec: 30 });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'send_failed';
        res.status(400).json({ error: message === 'smtp_not_configured' ? 'smtp_not_configured' : 'email_send_failed' });
      });
  });

  router.post('/2fa/question', (req: Request, res: Response) => {
    const token = String(req.body?.twoFactorToken ?? '');
    const pending = peekPending(token);
    if (!pending) {
      res.status(400).json({ error: 'challenge_expired' });
      return;
    }
    if (!pending.methods.includes('question')) {
      res.status(403).json({ error: 'method_unavailable' });
      return;
    }
    const challenge = pickSecurityQuestion(pending.userId);
    if (!challenge) {
      res.status(400).json({ error: 'method_unavailable' });
      return;
    }
    pending.question = challenge;
    res.json({ question: challenge.q });
  });

  // --- Account: recovery email + security questions setup ---

  router.get('/recovery/status', requireAuth, (req: Request, res: Response) => {
    const user = getUserById(req.auth!.user.id)!;
    const email = getUserEmail(user.id);
    res.json({
      questionsConfigured: getSecurityQuestionPrompts(user.id).length === 3,
      email: email ? `${email.slice(0, 1)}***@${email.split('@')[1] ?? ''}` : null,
      emailOtpEnabled: isEmailOtpEnabled(user.id),
      smtpConfigured: smtpConfigured(),
    });
  });

  router.post('/2fa/email/enable', requireAuth, (req: Request, res: Response) => {
    const user = req.auth!.user;
    const password = String(req.body?.password ?? '');
    const email = String(req.body?.email ?? '').trim();
    const row = getUserById(user.id)!;
    if (!verifyPassword(password, row.password_salt, row.password_hash)) {
      res.status(400).json({ error: 'current_password_incorrect' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      res.status(400).json({ error: 'invalid_email' });
      return;
    }
    setRecoveryEmail(user.id, email);
    audit({ ts: Date.now(), userId: user.id, username: user.username, role: user.role, ip: req.ip, userAgent: req.headers['user-agent'], action: '2fa.email_enabled', result: 'success' });
    res.json({ ok: true });
  });

  router.post('/2fa/email/disable', requireAuth, (req: Request, res: Response) => {
    const user = req.auth!.user;
    const password = String(req.body?.password ?? '');
    const row = getUserById(user.id)!;
    if (!verifyPassword(password, row.password_salt, row.password_hash)) {
      res.status(400).json({ error: 'current_password_incorrect' });
      return;
    }
    clearRecoveryEmail(user.id);
    audit({ ts: Date.now(), userId: user.id, username: user.username, role: user.role, ip: req.ip, userAgent: req.headers['user-agent'], action: '2fa.email_disabled', result: 'success' });
    res.json({ ok: true });
  });

  router.post('/security-questions/setup', requireAuth, (req: Request, res: Response) => {
    const user = req.auth!.user;
    const password = String(req.body?.password ?? '');
    const questions = Array.isArray(req.body?.questions) ? (req.body.questions as Array<{ question: string; answer: string }>) : [];
    const row = getUserById(user.id)!;
    if (!verifyPassword(password, row.password_salt, row.password_hash)) {
      res.status(400).json({ error: 'current_password_incorrect' });
      return;
    }
    if (
      questions.length !== 3 ||
      !questions.every((q) => typeof q.question === 'string' && q.question.trim().length >= 4 && typeof q.answer === 'string' && q.answer.trim().length >= 2)
    ) {
      res.status(400).json({ error: 'invalid_questions' });
      return;
    }
    setSecurityQuestions(user.id, questions);
    audit({ ts: Date.now(), userId: user.id, username: user.username, role: user.role, ip: req.ip, userAgent: req.headers['user-agent'], action: 'recovery.questions_set', result: 'success' });
    res.json({ ok: true });
  });

  router.post('/security-questions/clear', requireAuth, (req: Request, res: Response) => {
    const user = req.auth!.user;
    const password = String(req.body?.password ?? '');
    const row = getUserById(user.id)!;
    if (!verifyPassword(password, row.password_salt, row.password_hash)) {
      res.status(400).json({ error: 'current_password_incorrect' });
      return;
    }
    clearSecurityQuestions(user.id);
    audit({ ts: Date.now(), userId: user.id, username: user.username, role: user.role, ip: req.ip, userAgent: req.headers['user-agent'], action: 'recovery.questions_cleared', result: 'success' });
    res.json({ ok: true });
  });

  // --- Forgot-password recovery (works fully locally via security questions) ---

  router.get('/recovery/options', (req: Request, res: Response) => {
    const username = String(req.query?.username ?? '').trim();
    const user = username ? getUserByUsername(username) : null;
    if (!user || user.disabled) {
      res.json({ methods: [] });
      return;
    }
    res.json({ methods: recoveryMethodsFor(user) });
  });

  router.post('/recovery/start', (req: Request, res: Response) => {
    const ip = ipOf(req);
    const capped = hit(`recovery:${ip}`, 5, 15 * 60_000);
    if (!capped.allowed) {
      res.status(429).json({ error: 'too_many_attempts', retryAfter: capped.retryAfterSeconds });
      return;
    }
    const username = String(req.body?.username ?? '').trim();
    const user = username ? getUserByUsername(username) : null;
    if (!user || user.disabled) {
      res.json({ methods: [] });
      return;
    }
    const methods = recoveryMethodsFor(user);
    if (methods.length === 0) {
      res.json({ methods: [] });
      return;
    }
    const token = issueRecovery(user);
    const email = getUserEmail(user.id);
    audit({ ts: Date.now(), userId: user.id, username: user.username, ip, userAgent: req.headers['user-agent'], action: 'recovery.started', result: 'success' });
    res.json({
      recoveryToken: token,
      methods,
      questions: methods.includes('questions') ? getSecurityQuestionPrompts(user.id) : [],
      emailMasked: email ? `${email.slice(0, 1)}***@${email.split('@')[1] ?? ''}` : null,
    });
  });

  router.post('/recovery/questions', (req: Request, res: Response) => {
    const token = String(req.body?.recoveryToken ?? '');
    const entry = consumeRecovery(token);
    if (!entry) {
      res.status(400).json({ error: 'challenge_expired' });
      return;
    }
    if (!entry.methods.includes('questions')) {
      res.status(403).json({ error: 'method_unavailable' });
      return;
    }
    const answers = Array.isArray(req.body?.answers) ? (req.body.answers as string[]) : [];
    const ok = verifySecurityQuestions(entry.userId, answers.map((a) => String(a ?? '')));
    if (!ok) {
      entry.attempts += 1;
      if (entry.attempts >= PENDING_MAX_ATTEMPTS) {
        audit({ ts: Date.now(), userId: entry.userId, username: entry.username, ip: ipOf(req), userAgent: req.headers['user-agent'], action: 'recovery.questions_failed', result: 'failure', details: 'exceeded attempts' });
        res.status(429).json({ error: 'recovery_locked' });
        return;
      }
      recoveryPending.set(token, entry);
      res.status(400).json({ error: 'invalid_answers', attemptsRemaining: PENDING_MAX_ATTEMPTS - entry.attempts });
      return;
    }
    const resetToken = issueResetToken(entry.userId);
    audit({ ts: Date.now(), userId: entry.userId, username: entry.username, ip: ipOf(req), userAgent: req.headers['user-agent'], action: 'recovery.questions_ok', result: 'success' });
    res.json({ resetToken });
  });

  router.post('/recovery/email', (req: Request, res: Response) => {
    const token = String(req.body?.recoveryToken ?? '');
    const entry = peekRecovery(token);
    if (!entry) {
      res.status(400).json({ error: 'challenge_expired' });
      return;
    }
    if (!entry.methods.includes('email')) {
      res.status(403).json({ error: 'method_unavailable' });
      return;
    }
    const capped = hit(`recovery-email:${token}`, 3, 5 * 60_000);
    if (!capped.allowed) {
      res.status(429).json({ error: 'too_many_requests', retryAfter: capped.retryAfterSeconds });
      return;
    }
    const email = getUserEmail(entry.userId);
    if (!email) {
      res.status(400).json({ error: 'no_recovery_email' });
      return;
    }
    const code = generateOtpCode(6);
    sendOtpEmail(email, code)
      .then(() => {
        entry.emailOtp = { hash: hashRecoveryCode(code), expiresAt: Date.now() + OTP_TTL_MS };
        res.json({ ok: true, resentAfterSec: 30 });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'send_failed';
        res.status(400).json({ error: message === 'smtp_not_configured' ? 'smtp_not_configured' : 'email_send_failed' });
      });
  });

  router.post('/recovery/email-verify', (req: Request, res: Response) => {
    const token = String(req.body?.recoveryToken ?? '');
    const entry = consumeRecovery(token);
    if (!entry) {
      res.status(400).json({ error: 'challenge_expired' });
      return;
    }
    const code = String(req.body?.code ?? '');
    const ok = Boolean(entry.emailOtp && entry.emailOtp.expiresAt > Date.now() && safeEqual(hashRecoveryCode(code), entry.emailOtp.hash));
    if (!ok) {
      entry.attempts += 1;
      if (entry.attempts >= PENDING_MAX_ATTEMPTS) {
        res.status(429).json({ error: 'recovery_locked' });
        return;
      }
      recoveryPending.set(token, entry);
      res.status(400).json({ error: 'invalid_code', attemptsRemaining: PENDING_MAX_ATTEMPTS - entry.attempts });
      return;
    }
    const resetToken = issueResetToken(entry.userId);
    audit({ ts: Date.now(), userId: entry.userId, username: entry.username, ip: ipOf(req), userAgent: req.headers['user-agent'], action: 'recovery.email_ok', result: 'success' });
    res.json({ resetToken });
  });

  router.post('/recovery/reset', (req: Request, res: Response) => {
    const token = String(req.body?.resetToken ?? '');
    const entry = consumeResetToken(token);
    if (!entry) {
      res.status(400).json({ error: 'challenge_expired' });
      return;
    }
    const newPassword = String(req.body?.newPassword ?? '');
    const policyError = passwordStrength(newPassword);
    if (policyError) {
      resetTokens.set(token, entry);
      res.status(400).json({ error: 'weak_password', details: policyError });
      return;
    }
    const user = getUserById(entry.userId);
    if (!user) {
      res.status(400).json({ error: 'invalid_credentials' });
      return;
    }
    updateUser(entry.userId, { password: newPassword });
    revokeAllSessionsForUser(entry.userId);
    audit({ ts: Date.now(), userId: entry.userId, username: user.username, role: user.role, ip: ipOf(req), userAgent: req.headers['user-agent'], action: 'recovery.password_reset', result: 'success', details: '2FA disabled by reset' });
    res.json({ ok: true });
  });

  router.get('/sessions', requireAuth, (req: Request, res: Response) => {
    res.json({ sessions: listSessionsForUser(req.auth!.user.id, req.auth!.sessionId) });
  });

  router.post('/sessions/:id/terminate', requireAuth, (req: Request, res: Response) => {
    const { id } = req.params;
    if (id === req.auth!.sessionId) {
      revokeSession(id);
      clearSessionCookie(res);
      res.json({ ok: true });
      return;
    }
    const { revokeSessionByUser } = require('../security/session') as typeof import('../security/session');
    revokeSessionByUser(req.auth!.user.id, id);
    audit({ ts: Date.now(), userId: req.auth!.user.id, username: req.auth!.user.username, role: req.auth!.user.role, ip: req.ip, userAgent: req.headers['user-agent'], action: 'session.terminated', target: id, result: 'success' });
    res.json({ ok: true });
  });

  router.post('/sessions/terminate-all', requireAuth, (req: Request, res: Response) => {
    const revoked = revokeAllSessionsForUser(req.auth!.user.id, req.auth!.sessionId);
    audit({ ts: Date.now(), userId: req.auth!.user.id, username: req.auth!.user.username, role: req.auth!.user.role, ip: req.ip, userAgent: req.headers['user-agent'], action: 'sessions.terminated_all', result: 'success', details: `revoked ${revoked}` });
    res.json({ ok: true, revoked });
  });

  return router;
}

function finalizeLogin(req: Request, res: Response, user: UserRow, ip: string): void {
  recordLogin(user.id);
  const { token, maxAgeMs } = createSession(user.id, req);
  setSessionCookie(res, token, maxAgeMs);
  const csrf = generateCsrfToken();
  res.cookie(CSRF_COOKIE, csrf, { httpOnly: false, sameSite: 'lax', path: '/', maxAge: maxAgeMs });
  res.json({
    user: toPublicUser(user),
    permissions: user.role === 'GUEST' ? guestPermissionsFor(getGuestScopes()) : permissionsForRole(user.role),
    modes: modePayload(),
    session: { csrf },
  });
}

function getGuestScopes(): string[] {
  return getJsonSetting<string[]>('access.guest.scopes', []);
}
