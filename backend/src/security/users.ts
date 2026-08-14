import { randomBytes } from 'node:crypto';
import { getDb } from '../db/database';
import type { Role } from './permissions';
import { createPasswordHash, generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, hashPassword, verifyPassword, hashAnswer } from './crypto';
import { audit } from './audit';

export interface UserRow {
  id: string;
  username: string;
  name: string;
  role: Role;
  password_hash: string;
  password_salt: string;
  password_updated_at: number | null;
  two_factor_enabled: number;
  totp_secret: string | null;
  recovery_codes: string | null;
  email: string | null;
  security_questions: string | null;
  email_otp_enabled: number;
  disabled: number;
  must_change_password: number;
  created_at: number;
  updated_at: number;
  last_login_at: number | null;
}

export interface PublicUser {
  id: string;
  username: string;
  name: string;
  role: Role;
  twoFactorEnabled: boolean;
  email: string | null;
  emailOtpEnabled: boolean;
  disabled: boolean;
  mustChangePassword: boolean;
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role,
    twoFactorEnabled: row.two_factor_enabled === 1,
    email: row.email,
    emailOtpEnabled: row.email_otp_enabled === 1,
    disabled: row.disabled === 1,
    mustChangePassword: row.must_change_password === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  };
}

export function getUserByUsername(username: string): UserRow | null {
  const row = getDb().prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username) as UserRow | undefined;
  return row ?? null;
}

export function getUserById(id: string): UserRow | null {
  const row = getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  return row ?? null;
}

export function listUsers(): PublicUser[] {
  const rows = getDb().prepare('SELECT * FROM users ORDER BY created_at ASC').all() as UserRow[];
  return rows.map(toPublicUser);
}

export function countUsers(): number {
  return (getDb().prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
}

export function createUser(input: {
  username: string;
  name?: string;
  role: Role;
  password: string;
  mustChangePassword?: boolean;
  email?: string;
}): PublicUser {
  const id = randomBytes(16).toString('hex');
  const { hash, salt } = createPasswordHash(input.password);
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO users (id, username, name, role, password_hash, password_salt, password_updated_at, two_factor_enabled, totp_secret, recovery_codes, email, email_otp_enabled, disabled, must_change_password, created_at, updated_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?, 0, ?, ?, ?, NULL)`,
    )
    .run(
      id,
      input.username.trim(),
      input.name?.trim() ?? '',
      input.role,
      hash,
      salt,
      now,
      input.email?.trim().toLowerCase() ?? null,
      input.email ? 1 : 0,
      input.mustChangePassword ? 1 : 0,
      now,
      now,
    );
  const row = getUserById(id)!;
  return toPublicUser(row);
}

export function updateUser(
  id: string,
  patch: {
    name?: string;
    role?: Role;
    disabled?: boolean;
    password?: string;
    mustChangePassword?: boolean;
    email?: string | null;
  },
): PublicUser | null {
  const user = getUserById(id);
  if (!user) return null;
  const db = getDb();
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.name !== undefined) {
    sets.push('name = ?');
    params.push(patch.name.trim());
  }
  if (patch.role !== undefined) {
    sets.push('role = ?');
    params.push(patch.role);
  }
  if (patch.disabled !== undefined) {
    sets.push('disabled = ?');
    params.push(patch.disabled ? 1 : 0);
  }
  if (patch.mustChangePassword !== undefined) {
    sets.push('must_change_password = ?');
    params.push(patch.mustChangePassword ? 1 : 0);
  }
  if (patch.email !== undefined) {
    const email = patch.email?.trim().toLowerCase() ?? '';
    if (email) {
      sets.push('email = ?, email_otp_enabled = 1');
      params.push(email);
    } else {
      sets.push('email = NULL, email_otp_enabled = 0');
    }
  }
  if (patch.password !== undefined) {
    const { hash, salt } = createPasswordHash(patch.password);
    sets.push('password_hash = ?, password_salt = ?, password_updated_at = ?');
    params.push(hash, salt, Date.now());
    sets.push('must_change_password = ?');
    params.push(0);
    sets.push('recovery_codes = NULL, totp_secret = NULL, two_factor_enabled = 0');
  }
  if (sets.length === 0) return toPublicUser(user);
  sets.push('updated_at = ?');
  params.push(Date.now());
  params.push(id);
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return toPublicUser(getUserById(id)!);
}

export function deleteUser(id: string): boolean {
  const res = getDb().prepare('DELETE FROM users WHERE id = ?').run(id);
  if (res.changes === 0) return false;
  getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  return true;
}

export function recordLogin(userId: string): void {
  getDb().prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(Date.now(), userId);
}

export function touchPassword(userId: string): void {
  getDb().prepare('UPDATE users SET password_updated_at = ?, updated_at = ? WHERE id = ?').run(Date.now(), Date.now(), userId);
}

export function isPasswordReuse(userId: string, candidate: string, maxHistory = 1): boolean {
  if (maxHistory <= 0) return false;
  const user = getUserById(userId);
  if (!user) return false;
  return verifyPassword(candidate, user.password_salt, user.password_hash);
}

// ---- 2FA ----

export function setupTwoFactor(userId: string): { secret: string; recoveryCodes: string[] } {
  const secret = generateTotpSecret();
  const recoveryCodes = generateRecoveryCodes();
  const hashed = recoveryCodes.map(hashRecoveryCode);
  getDb()
    .prepare('UPDATE users SET totp_secret = ?, recovery_codes = ?, two_factor_enabled = 1, updated_at = ? WHERE id = ?')
    .run(secret, JSON.stringify(hashed), Date.now(), userId);
  return { secret, recoveryCodes };
}

export function disableTwoFactor(userId: string): void {
  getDb()
    .prepare('UPDATE users SET totp_secret = NULL, recovery_codes = NULL, two_factor_enabled = 0, updated_at = ? WHERE id = ?')
    .run(Date.now(), userId);
}

export function getTotpSecret(userId: string): string | null {
  const row = getDb().prepare('SELECT totp_secret FROM users WHERE id = ?').get(userId) as { totp_secret: string | null } | undefined;
  return row?.totp_secret ?? null;
}

export function consumeRecoveryCode(userId: string, code: string): boolean {
  const user = getUserById(userId);
  if (!user?.recovery_codes) return false;
  const hashes: string[] = JSON.parse(user.recovery_codes);
  const idx = hashes.findIndex((h) => h === hashRecoveryCode(code.toUpperCase()));
  if (idx === -1) return false;
  hashes.splice(idx, 1);
  if (hashes.length === 0) {
    getDb()
      .prepare('UPDATE users SET recovery_codes = NULL, totp_secret = NULL, two_factor_enabled = 0 WHERE id = ?')
      .run(userId);
  } else {
    getDb().prepare('UPDATE users SET recovery_codes = ? WHERE id = ?').run(JSON.stringify(hashes), userId);
  }
  audit({ ts: Date.now(), userId, action: 'twofa.recovery_code_used', result: 'success' });
  return true;
}

// ---- Recovery email + security questions ----

export interface StoredSecurityQuestion {
  q: string;
  a: string;
}

export function setRecoveryEmail(userId: string, email: string): void {
  getDb()
    .prepare('UPDATE users SET email = ?, email_otp_enabled = ?, updated_at = ? WHERE id = ?')
    .run(email.trim().toLowerCase(), 1, Date.now(), userId);
}

export function clearRecoveryEmail(userId: string): void {
  getDb()
    .prepare('UPDATE users SET email_otp_enabled = 0, updated_at = ? WHERE id = ?')
    .run(Date.now(), userId);
}

export function getUserEmail(userId: string): string | null {
  const row = getDb().prepare('SELECT email FROM users WHERE id = ?').get(userId) as { email: string | null } | undefined;
  return row?.email ?? null;
}

export function isEmailOtpEnabled(userId: string): boolean {
  const row = getDb().prepare('SELECT email_otp_enabled FROM users WHERE id = ?').get(userId) as { email_otp_enabled: number } | undefined;
  return row?.email_otp_enabled === 1;
}

/** Stores 3 security questions with hashed answers. */
export function setSecurityQuestions(userId: string, questions: Array<{ question: string; answer: string }>): void {
  if (questions.length !== 3) throw new Error('expected 3 questions');
  const stored: StoredSecurityQuestion[] = questions.map((q) => ({
    q: q.question.trim(),
    a: hashAnswer(q.answer),
  }));
  getDb()
    .prepare('UPDATE users SET security_questions = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(stored), Date.now(), userId);
}

export function clearSecurityQuestions(userId: string): void {
  getDb()
    .prepare('UPDATE users SET security_questions = NULL, updated_at = ? WHERE id = ?')
    .run(Date.now(), userId);
}

/** Question prompts only — answers are hashed and never returned. */
export function getSecurityQuestionPrompts(userId: string): string[] {
  const user = getUserById(userId);
  if (!user?.security_questions) return [];
  try {
    const parsed = JSON.parse(user.security_questions) as StoredSecurityQuestion[];
    return parsed.map((q) => q.q);
  } catch {
    return [];
  }
}

/** Random challenge for the 2FA "answer a question" flow. */
export function pickSecurityQuestion(userId: string): { q: string; hash: string } | null {
  const user = getUserById(userId);
  if (!user?.security_questions) return null;
  try {
    const parsed = JSON.parse(user.security_questions) as StoredSecurityQuestion[];
    if (parsed.length === 0) return null;
    const idx = randomBytes(1)[0] % parsed.length;
    return { q: parsed[idx].q, hash: parsed[idx].a };
  } catch {
    return null;
  }
}

/** Verify the 3 supplied answers against the stored hashes. */
export function verifySecurityQuestions(userId: string, answers: string[]): boolean {
  const user = getUserById(userId);
  if (!user?.security_questions) return false;
  let parsed: StoredSecurityQuestion[];
  try {
    parsed = JSON.parse(user.security_questions) as StoredSecurityQuestion[];
  } catch {
    return false;
  }
  if (parsed.length !== 3 || answers.length !== 3) return false;
  return parsed.every((q, i) => {
    const candidate = hashAnswer(answers[i] ?? '');
    const a = q.a;
    return a.length === candidate.length && a === candidate;
  });
}

/** Rehash check helper for the CLI/password-rotation path. */
export { hashPassword, verifyPassword };
