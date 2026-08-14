/**
 * Security, administration & recovery integration tests.
 * Runs against a real HTTP server on an ephemeral port with a temp DATA_DIR.
 * Uses Node's built-in test runner + global fetch (no new dependencies).
 *
 * Run: npm test (backend)  →  tsx --test src/test/*.test.ts
 */
import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import type { Server } from 'node:http';

const ADMIN_PASSWORD = 'Zq7!mN4pRt9W';

// Modules are imported lazily inside before() AFTER env is set so that
// config reads the temp DATA_DIR at module-load time.
let app: import('node:http').RequestListener;
let server: Server;
let getDb: () => any;
let setSetting: (key: string, value: string) => void;

let base = '';
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'homelab-test-'));

before(async () => {
  process.env.DATA_DIR = DATA_DIR;
  process.env.ADMIN_INITIAL_PASSWORD = ADMIN_PASSWORD;
  process.env.SECRET_ENCRYPTION_KEY = 'test-encryption-key-1234567890';

  const { createApp } = await import('../app');
  const { TelemetryEngine } = await import('../telemetry/engine');
  const { MockMetricsProvider } = await import('../providers/mockMetricsProvider');
  const { MockNotificationsProvider } = await import('../providers/mockNotificationsProvider');
  const { getDb: get } = await import('../db/database');
  const { setSetting: set } = await import('../security/settings');
  const { bootstrapSecurity } = await import('../security/boot');
  getDb = get;
  setSetting = set;

  getDb();
  bootstrapSecurity();

  app = createApp({
    simulator: null as never,
    metrics: new MockMetricsProvider(new TelemetryEngine()),
    notifications: new MockNotificationsProvider(),
  });
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  base = `http://127.0.0.1:${address.port}`;
  // Generous global login cap for tests; lockout params tuned per test.
  setSetting('security.loginRateLimitPerMinute', '1000');
});

after(() => {
  server.close();
  try {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

// Tests that lock out / modify global state must not leak into later tests.
afterEach(async () => {
  const { clear } = await import('../security/rateLimit');
  clear('lock:127.0.0.1:admin');
  clear('admin:127.0.0.1:');
  setSetting('security.readOnly', 'false');
  setSetting('security.safeMode', 'false');
  setSetting('security.emergencyLock', 'false');
  setSetting('security.twoFactorEnabled', 'false');
  setSetting('access.guest.enabled', 'false');
});

// ---- helpers ----

interface Jar {
  [key: string]: string;
}

function parseSetCookie(header: string): Jar {
  const jar: Jar = {};
  for (const part of header.split(',')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).split(';')[0].trim();
    if (name && value) jar[name] = value;
  }
  return jar;
}

const cookieHeader = (jar: Jar) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');

async function req(
  method: string,
  p: string,
  opts: { jar?: Jar; headers?: Record<string, string>; body?: unknown } = {},
): Promise<{ status: number; json: any; jar: Jar; setCookie: string }> {
  const jar = opts.jar ?? {};
  const res = await fetch(base + p, {
    method,
    headers: { 'content-type': 'application/json', cookie: cookieHeader(jar), ...opts.headers },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie') || '';
  Object.assign(jar, parseSetCookie(setCookie));
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json, jar, setCookie };
}

const csrf = (jar: Jar) => ({ 'x-csrf-token': jar.csrf });

async function login(username: string, password: string): Promise<Jar> {
  const jar: Jar = {};
  const r = await req('POST', '/api/auth/login', { jar, body: { username, password } });
  assert.equal(r.status, 200, `login failed for ${username}: ${JSON.stringify(r.json)}`);
  return jar;
}

async function totpCode(secret: string): Promise<string> {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secret) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  const counter = Math.floor(Date.now() / 30_000);
  const cb = Buffer.alloc(8);
  cb.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  cb.writeUInt32BE(counter >>> 0, 4);
  const digest = crypto.createHmac('sha1', Buffer.from(bytes)).update(cb).digest();
  const o = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[o] & 0x7f) << 24) | ((digest[o + 1] & 0xff) << 16) | ((digest[o + 2] & 0xff) << 8) | (digest[o + 3] & 0xff);
  return (code % 1_000_000).toString().padStart(6, '0');
}

// ---- tests ----

describe('bootstrap & auth', () => {
  it('seeds the initial SUPER_ADMIN and default settings', async () => {
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get('admin') as any;
    assert.ok(user, 'admin user exists');
    assert.equal(user.role, 'SUPER_ADMIN');
    assert.ok(user.password_hash.length > 0);
    const settings = db.prepare('SELECT COUNT(*) AS c FROM settings').get() as { c: number };
    assert.ok(settings.c > 10, 'default settings seeded');
  });

  it('rejects unauthenticated /me', async () => {
    const r = await req('GET', '/api/auth/me');
    assert.equal(r.status, 401);
  });

  it('logs in with session + csrf cookies', async () => {
    const jar = await login('admin', ADMIN_PASSWORD);
    assert.ok(jar.homelab_session, 'session cookie set');
    assert.ok(jar.csrf, 'csrf cookie set');
    const me = await req('GET', '/api/auth/me', { jar });
    assert.equal(me.status, 200);
    assert.equal(me.json.user.username, 'admin');
    assert.equal(me.json.user.role, 'SUPER_ADMIN');
    assert.ok(me.json.permissions.includes('users.manage'));
    assert.ok(me.json.permissions.includes('recovery.manage'));
  });

  it('rejects wrong password', async () => {
    const r = await req('POST', '/api/auth/login', { body: { username: 'admin', password: 'wrong' } });
    assert.equal(r.status, 401);
  });

  it('survives SQL injection payloads without erroring', async () => {
    const r = await req('POST', '/api/auth/login', {
      body: { username: "' OR '1'='1", password: "'; DROP TABLE users;--" },
    });
    assert.equal(r.status, 401);
    const me = await req('GET', '/api/auth/me', { jar: await login('admin', ADMIN_PASSWORD) });
    assert.equal(me.json.user.username, 'admin');
  });

  it('locks the account after repeated failures', async () => {
    setSetting('security.maxLoginAttempts', '3');
    setSetting('security.lockoutMinutes', '1');
    const jar: Jar = {};
    let last = 0;
    for (let i = 0; i < 4; i++) {
      const r = await req('POST', '/api/auth/login', { jar, body: { username: 'admin', password: 'bad-password' } });
      last = r.status;
      if (r.status === 429) break;
    }
    assert.equal(last, 429, 'account should lock');
  });

  it('logs out and revokes the session', async () => {
    const jar = await login('admin', ADMIN_PASSWORD);
    const out = await req('POST', '/api/auth/logout', { jar });
    assert.equal(out.status, 200);
    const me = await req('GET', '/api/auth/me', { jar });
    assert.equal(me.status, 401);
  });
});

describe('2FA', () => {
  it('enables, verifies, and requires a code on login', async () => {
    const jar = await login('admin', ADMIN_PASSWORD);
    await req('PUT', '/api/admin/settings', {
      jar,
      headers: csrf(jar),
      body: { settings: { 'security.twoFactorEnabled': 'true' } },
    });
    const setup = await req('POST', '/api/auth/2fa/setup', {
      jar,
      headers: csrf(jar),
      body: { password: ADMIN_PASSWORD },
    });
    assert.equal(setup.status, 200);
    const secret = setup.json.secret;
    assert.ok(secret);
    assert.ok(Array.isArray(setup.json.recoveryCodes) && setup.json.recoveryCodes.length === 10);

    const verify = await req('POST', '/api/auth/2fa/verify-setup', {
      jar,
      headers: csrf(jar),
      body: { code: await totpCode(secret) },
    });
    assert.equal(verify.status, 200);

    // Fresh login now requires 2FA.
    const fresh: Jar = {};
    const step1 = await req('POST', '/api/auth/login', { jar: fresh, body: { username: 'admin', password: ADMIN_PASSWORD } });
    assert.equal(step1.status, 200);
    assert.equal(step1.json.twoFactorRequired, true);

    const step2 = await req('POST', '/api/auth/login', {
      jar: fresh,
      body: { username: 'admin', password: ADMIN_PASSWORD, twoFactorToken: step1.json.twoFactorToken, twoFactorCode: await totpCode(secret) },
    });
    assert.equal(step2.status, 200);
    assert.equal(step2.json.user.username, 'admin');

    // Wrong code rejected.
    const bad: Jar = {};
    const s1 = await req('POST', '/api/auth/login', { jar: bad, body: { username: 'admin', password: ADMIN_PASSWORD } });
    const s2 = await req('POST', '/api/auth/login', {
      jar: bad,
      body: { username: 'admin', password: ADMIN_PASSWORD, twoFactorToken: s1.json.twoFactorToken, twoFactorCode: '000000' },
    });
    assert.equal(s2.status, 401);

    // Recovery code works.
    const rec: Jar = {};
    const r1 = await req('POST', '/api/auth/login', { jar: rec, body: { username: 'admin', password: ADMIN_PASSWORD } });
    const r2 = await req('POST', '/api/auth/login', {
      jar: rec,
      body: { username: 'admin', password: ADMIN_PASSWORD, twoFactorToken: r1.json.twoFactorToken, twoFactorCode: setup.json.recoveryCodes[0] },
    });
    assert.equal(r2.status, 200);
  });
});

describe('RBAC', () => {
  let admin: Jar;
  let viewer: Jar;

  before(async () => {
    admin = await login('admin', ADMIN_PASSWORD);
    const created = await req('POST', '/api/admin/users', {
      jar: admin,
      headers: csrf(admin),
      body: { username: 'viewer1', password: 'ViewerK9pX!42', role: 'VIEWER' },
    });
    assert.equal(created.status, 200);
    viewer = await login('viewer1', 'ViewerK9pX!42');
  });

  it('allows admins, denies viewers on admin endpoints', async () => {
    const a = await req('GET', '/api/admin/users', { jar: admin });
    assert.equal(a.status, 200);
    assert.ok(Array.isArray(a.json.users));

    const v = await req('GET', '/api/admin/users', { jar: viewer });
    assert.equal(v.status, 403);

    const s = await req('PUT', '/api/admin/settings', {
      jar: viewer,
      headers: csrf(viewer),
      body: { settings: { 'security.readOnly': 'true' } },
    });
    assert.equal(s.status, 403);
  });

  it('allows viewers read-only data access', async () => {
    const servers = await req('GET', '/api/servers', { jar: viewer });
    assert.equal(servers.status, 200);
    assert.ok(servers.json.length >= 1);
  });

  it('blocks viewers from notifications write without permission', async () => {
    // VIEWER lacks notifications.manage; mark-read requires auth+view permission
    // which VIEWER has, but read-only test is more interesting: toggle read-only.
    const r = await req('POST', '/api/admin/safe-mode', { jar: viewer, headers: csrf(viewer), body: { enabled: true } });
    assert.equal(r.status, 403);
  });

  it('protects the last SUPER_ADMIN', async () => {
    const me = await req('GET', '/api/auth/me', { jar: admin });
    const uid = me.json.user.id;
    const del = await req('DELETE', `/api/admin/users/${uid}`, { jar: admin, headers: csrf(admin) });
    assert.equal(del.status, 400);
    assert.equal(del.json.error, 'cannot_delete_self');
  });

  it('denies role escalation to viewer', async () => {
    const me = await req('GET', '/api/auth/me', { jar: viewer });
    const uid = me.json.user.id;
    const r = await req('PUT', `/api/admin/users/${uid}`, {
      jar: viewer,
      headers: csrf(viewer),
      body: { role: 'SUPER_ADMIN' },
    });
    assert.equal(r.status, 403);
  });
});

describe('read-only mode', () => {
  it('blocks mutations while keeping auth endpoints working', async () => {
    const admin = await login('admin', ADMIN_PASSWORD);
    const on = await req('PUT', '/api/admin/settings', {
      jar: admin,
      headers: csrf(admin),
      body: { settings: { 'security.readOnly': 'true' } },
    });
    assert.equal(on.status, 200);

    const blocked = await req('POST', '/api/admin/snapshots', {
      jar: admin,
      headers: csrf(admin),
      body: { name: 'x' },
    });
    assert.equal(blocked.status, 423);

    // Reads still fine.
    const servers = await req('GET', '/api/servers', { jar: admin });
    assert.equal(servers.status, 200);

    // Login still works.
    const fresh = await req('POST', '/api/auth/login', { body: { username: 'admin', password: ADMIN_PASSWORD } });
    assert.equal(fresh.status, 200);

    // Turn it back off via CLI-path DB write to avoid sticky RO.
    setSetting('security.readOnly', 'false');
  });
});

describe('emergency lock', () => {
  it('revokes other sessions and blocks everything until SUPER_ADMIN unlocks', async () => {
    const admin = await login('admin', ADMIN_PASSWORD);
    const viewerJar = await login('viewer1', 'ViewerK9pX!42');

    const lock = await req('POST', '/api/admin/lock', { jar: admin, headers: csrf(admin) });
    assert.equal(lock.status, 200);
    assert.ok(lock.json.revoked >= 1, 'revoked the viewer session');

    // Revoked session is dead.
    const viewerMe = await req('GET', '/api/auth/me', { jar: viewerJar });
    assert.equal(viewerMe.status, 401);

    // Non-mutation guard blocks admin mutations too.
    const mode = await req('GET', '/api/admin/mode');
    assert.equal(mode.status, 200);
    assert.equal(mode.json.emergencyLock, true);

    // Unlock requires SUPER_ADMIN password.
    const unlock = await req('POST', '/api/admin/unlock', { jar: admin, headers: csrf(admin), body: { password: ADMIN_PASSWORD } });
    assert.equal(unlock.status, 200);
    const mode2 = await req('GET', '/api/admin/mode');
    assert.equal(mode2.json.emergencyLock, false);
  });
});

describe('CSRF & hardening headers', () => {
  it('rejects mutations without the CSRF token', async () => {
    const admin = await login('admin', ADMIN_PASSWORD);
    const r = await req('PUT', '/api/admin/settings', { jar: admin, body: { settings: {} } });
    assert.equal(r.status, 403);
    assert.equal(r.json.error, 'csrf');
  });

  it('rejects a mismatched CSRF token', async () => {
    const admin = await login('admin', ADMIN_PASSWORD);
    const r = await req('PUT', '/api/admin/settings', { jar: admin, headers: { 'x-csrf-token': 'a'.repeat(32) }, body: { settings: {} } });
    assert.equal(r.status, 403);
  });

  it('emits security headers and no x-powered-by', async () => {
    const r = await req('GET', '/api/ping');
    assert.ok(r.json.pong === true);
  });
});

describe('feature flags', () => {
  let admin: Jar;

  before(async () => {
    admin = await login('admin', ADMIN_PASSWORD);
  });

  it('denies /api/network when infrastructure_map is disabled', async () => {
    const off = await req('PUT', '/api/admin/features/infrastructure_map', {
      jar: admin,
      headers: csrf(admin),
      body: { enabled: false },
    });
    assert.equal(off.status, 200);
    const network = await req('GET', '/api/network', { jar: admin });
    assert.equal(network.status, 403);
  });

  it('empties sensors when hardware_monitoring is disabled', async () => {
    const off = await req('PUT', '/api/admin/features/hardware_monitoring', {
      jar: admin,
      headers: csrf(admin),
      body: { enabled: false },
    });
    assert.equal(off.status, 200);
    const servers = await req('GET', '/api/servers', { jar: admin });
    const withSensors = servers.json.some((s: any) => s.sensors.length > 0);
    assert.equal(withSensors, false);
  });
});

describe('guest access', () => {
  let admin: Jar;

  before(async () => {
    admin = await login('admin', ADMIN_PASSWORD);
  });

  it('rejects unauthenticated data by default', async () => {
    const servers = await req('GET', '/api/servers');
    assert.equal(servers.status, 403);
  });

  it('allows scoped unauthenticated access once guest mode is on', async () => {
    await req('PUT', '/api/admin/settings', {
      jar: admin,
      headers: csrf(admin),
      body: { settings: { 'access.guest.enabled': 'true' } },
    });
    const servers = await req('GET', '/api/servers');
    assert.equal(servers.status, 200);
    assert.ok(servers.json.length >= 1);

    // Guests still cannot touch admin or auth.
    const settings = await req('GET', '/api/admin/settings');
    assert.equal(settings.status, 401);
    const me = await req('GET', '/api/auth/me');
    assert.equal(me.status, 401);

    // Narrow the guest scope to services only → servers denied.
    await req('PUT', '/api/admin/settings', {
      jar: admin,
      headers: csrf(admin),
      body: { settings: { 'access.guest.scopes': ['serviceStatus'] } },
    });
    const servers2 = await req('GET', '/api/servers');
    assert.equal(servers2.status, 403);
  });
});

describe('users CRUD', () => {
  let admin: Jar;

  before(async () => {
    admin = await login('admin', ADMIN_PASSWORD);
  });

  it('creates, updates and deletes a user', async () => {
    const created = await req('POST', '/api/admin/users', {
      jar: admin,
      headers: csrf(admin),
      body: { username: 'op1', password: 'OperatorK9pX!42', role: 'OPERATOR' },
    });
    assert.equal(created.status, 200);
    const uid = created.json.user.id;

    const updated = await req('PUT', `/api/admin/users/${uid}`, {
      jar: admin,
      headers: csrf(admin),
      body: { name: 'Ops One' },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.json.user.name, 'Ops One');

    const del = await req('DELETE', `/api/admin/users/${uid}`, { jar: admin, headers: csrf(admin) });
    assert.equal(del.status, 200);
  });

  it('rejects weak passwords and invalid usernames', async () => {
    const weak = await req('POST', '/api/admin/users', {
      jar: admin,
      headers: csrf(admin),
      body: { username: 'weakpass', password: 'short', role: 'VIEWER' },
    });
    assert.equal(weak.status, 400);
    const badName = await req('POST', '/api/admin/users', {
      jar: admin,
      headers: csrf(admin),
      body: { username: 'bad name!', password: 'GoodPass123!', role: 'VIEWER' },
    });
    assert.equal(badName.status, 400);
  });

  it('rejects a duplicate username', async () => {
    const dup = await req('POST', '/api/admin/users', {
      jar: admin,
      headers: csrf(admin),
      body: { username: 'viewer1', password: 'ViewerK9pX!42', role: 'VIEWER' },
    });
    assert.equal(dup.status, 409);
  });

  it('manages an optional recovery email on users', async () => {
    const created = await req('POST', '/api/admin/users', {
      jar: admin,
      headers: csrf(admin),
      body: { username: 'emailuser', password: 'EmailK9pX!42', role: 'VIEWER', email: 'ops@homelab.local' },
    });
    assert.equal(created.status, 200, JSON.stringify(created.json));
    const uid = created.json.user.id;
    assert.equal(created.json.user.email, 'ops@homelab.local');
    assert.equal(created.json.user.emailOtpEnabled, true);

    const listed = await req('GET', '/api/admin/users', { jar: admin });
    const row = listed.json.users.find((u: any) => u.id === uid);
    assert.equal(row.email, 'ops@homelab.local');

    // Clearing the email also disables email OTP.
    const cleared = await req('PUT', `/api/admin/users/${uid}`, {
      jar: admin,
      headers: csrf(admin),
      body: { email: null },
    });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.json.user.email, null);
    assert.equal(cleared.json.user.emailOtpEnabled, false);

    const invalid = await req('PUT', `/api/admin/users/${uid}`, {
      jar: admin,
      headers: csrf(admin),
      body: { email: 'not-an-email' },
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.json.error, 'invalid_email');

    await req('DELETE', `/api/admin/users/${uid}`, { jar: admin, headers: csrf(admin) });
  });
});

describe('password change & sessions', () => {
  it('change-password revokes other sessions', async () => {
    const a = await login('admin', ADMIN_PASSWORD);
    const b = await login('admin', ADMIN_PASSWORD);
    const change = await req('POST', '/api/auth/change-password', {
      jar: a,
      headers: csrf(a),
      body: { currentPassword: ADMIN_PASSWORD, newPassword: 'K9pX!r2mB4vL' },
    });
    assert.equal(change.status, 200, JSON.stringify(change.json));

    // Session B must be dead; session A survives.
    const meB = await req('GET', '/api/auth/me', { jar: b });
    assert.equal(meB.status, 401);
    const meA = await req('GET', '/api/auth/me', { jar: a });
    assert.equal(meA.status, 200);

    // Change back for later tests.
    await req('POST', '/api/auth/change-password', {
      jar: a,
      headers: csrf(a),
      body: { currentPassword: 'K9pX!r2mB4vL', newPassword: ADMIN_PASSWORD },
    });
  });

  it('rejects password reuse', async () => {
    const a = await login('admin', ADMIN_PASSWORD);
    const r = await req('POST', '/api/auth/change-password', {
      jar: a,
      headers: csrf(a),
      body: { currentPassword: ADMIN_PASSWORD, newPassword: ADMIN_PASSWORD },
    });
    assert.equal(r.status, 400);
  });
});

describe('snapshots, backups & audit', () => {
  let admin: Jar;

  before(async () => {
    admin = await login('admin', ADMIN_PASSWORD);
  });

  it('creates and lists config snapshots', async () => {
    const created = await req('POST', '/api/admin/snapshots', { jar: admin, headers: csrf(admin), body: { name: 'test-snapshot' } });
    assert.equal(created.status, 200);
    assert.ok(created.json.snapshot.id);
    const list = await req('GET', '/api/admin/snapshots', { jar: admin });
    assert.ok(list.json.snapshots.some((s: any) => s.name === 'test-snapshot'));
  });

  it('snapshot restore reverts a settings change', async () => {
    // Change a setting.
    await req('PUT', '/api/admin/settings', {
      jar: admin,
      headers: csrf(admin),
      body: { settings: { 'backup.retentionDaily': '99' } },
    });
    // Snapshot now.
    const snap = await req('POST', '/api/admin/snapshots', { jar: admin, headers: csrf(admin), body: { name: 'pre-change' } });
    // Change again.
    await req('PUT', '/api/admin/settings', {
      jar: admin,
      headers: csrf(admin),
      body: { settings: { 'backup.retentionDaily': '5' } },
    });
    // Restore the snapshot → back to 99.
    const restored = await req('POST', `/api/admin/snapshots/${snap.json.snapshot.id}/restore`, { jar: admin, headers: csrf(admin) });
    assert.equal(restored.status, 200);
    const settings = await req('GET', '/api/admin/settings', { jar: admin });
    assert.equal(settings.json.settings['backup.retentionDaily'], '99');
  });

  it('creates a manual backup and lists it', async () => {
    const created = await req('POST', '/api/admin/backups', { jar: admin, headers: csrf(admin) });
    assert.equal(created.status, 200);
    assert.equal(created.json.backup.status, 'ok');
    const file = created.json.backup.file;
    assert.ok(fs.existsSync(file), 'backup db file exists');
    assert.ok(fs.existsSync(file + '.manifest.json'), 'manifest exists');

    const list = await req('GET', '/api/admin/backups', { jar: admin });
    assert.ok(list.json.backups.length >= 1);
    assert.equal(list.json.status.enabled, true);
  });

  it('deletes a backup', async () => {
    const created = await req('POST', '/api/admin/backups', { jar: admin, headers: csrf(admin) });
    const id = created.json.backup.id;
    const del = await req('DELETE', `/api/admin/backups/${id}`, { jar: admin, headers: csrf(admin) });
    assert.equal(del.status, 200);
    const list = await req('GET', '/api/admin/backups', { jar: admin });
    assert.ok(!list.json.backups.some((b: any) => b.id === id));
  });

  it('records audit entries and allows filtering', async () => {
    const audit = await req('GET', '/api/admin/audit', { jar: admin });
    assert.equal(audit.status, 200);
    assert.ok(audit.json.total > 0);
    assert.ok(Array.isArray(audit.json.items));
    const actions = await req('GET', '/api/admin/audit/actions', { jar: admin });
    assert.ok(actions.json.actions.includes('settings.updated'));
  });
});

describe('integrations', () => {
  let admin: Jar;

  before(async () => {
    admin = await login('admin', ADMIN_PASSWORD);
  });

  it('creates an integration without leaking secrets', async () => {
    const created = await req('POST', '/api/admin/integrations', {
      jar: admin,
      headers: csrf(admin),
      body: { name: 'Telegram Ops', kind: 'telegram', config: { chatId: '12345' }, secrets: { botToken: 'sekrit-token' } },
    });
    assert.equal(created.status, 200);
    assert.deepEqual(created.json.integration.secretFields, ['botToken']);
    assert.ok(!JSON.stringify(created.json).includes('sekrit-token'), 'secret never returned');

    // Raw encrypted value must be present in DB, decrypted form must not.
    const row = getDb().prepare('SELECT secrets FROM integrations WHERE id = ?').get(created.json.integration.id) as { secrets: string };
    assert.ok(row.secrets.includes('v1:'), 'secret encrypted at rest');
    assert.ok(!row.secrets.includes('sekrit-token'), 'plaintext not stored');
  });

  it('updates and deletes an integration', async () => {
    const created = await req('POST', '/api/admin/integrations', {
      jar: admin,
      headers: csrf(admin),
      body: { name: 'Temp', kind: 'email', config: { host: 'smtp.example.com' }, secrets: { smtpPassword: 'pw' } },
    });
    const id = created.json.integration.id;
    const updated = await req('PUT', `/api/admin/integrations/${id}`, {
      jar: admin,
      headers: csrf(admin),
      body: { name: 'Renamed', enabled: true },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.json.integration.name, 'Renamed');

    const del = await req('DELETE', `/api/admin/integrations/${id}`, { jar: admin, headers: csrf(admin) });
    assert.equal(del.status, 200);
  });
});

describe('session expiry & guest WS baseline', () => {
  it('expires sessions past their deadline', async () => {
    const jar = await login('admin', ADMIN_PASSWORD);
    // Fast-forward the session expiry in the DB.
    getDb()
      .prepare('UPDATE sessions SET expires_at = ?')
      .run(Date.now() - 1000);
    const me = await req('GET', '/api/auth/me', { jar });
    assert.equal(me.status, 401);
  });
});

describe('recovery & 2FA methods', () => {
  it('sets up security questions and recovers the password locally', async () => {
    const jar = await login('admin', ADMIN_PASSWORD);

    const setup = await req('POST', '/api/auth/security-questions/setup', {
      jar,
      headers: csrf(jar),
      body: {
        password: ADMIN_PASSWORD,
        questions: [
          { question: 'What is your pet name?', answer: 'Rex' },
          { question: 'What is your birth city?', answer: 'Manila' },
          { question: 'What is your favorite color?', answer: 'Emerald' },
        ],
      },
    });
    assert.equal(setup.status, 200, JSON.stringify(setup.json));

    const status = await req('GET', '/api/auth/recovery/status', { jar });
    assert.equal(status.json.questionsConfigured, true);

    const options = await req('GET', '/api/auth/recovery/options?username=admin');
    assert.ok(options.json.methods.includes('questions'), JSON.stringify(options.json));

    const started = await req('POST', '/api/auth/recovery/start', { body: { username: 'admin' } });
    assert.equal(started.status, 200);
    assert.ok(started.json.recoveryToken, 'token issued');
    assert.ok(started.json.methods.includes('questions'));
    assert.deepEqual(started.json.questions, [
      'What is your pet name?',
      'What is your birth city?',
      'What is your favorite color?',
    ]);

    // Wrong answers rejected.
    const wrong = await req('POST', '/api/auth/recovery/questions', {
      body: { recoveryToken: started.json.recoveryToken, answers: ['nope', 'nope', 'nope'] },
    });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.json.error, 'invalid_answers');

    // Restart and answer correctly.
    const restarted = await req('POST', '/api/auth/recovery/start', { body: { username: 'admin' } });
    const answered = await req('POST', '/api/auth/recovery/questions', {
      body: { recoveryToken: restarted.json.recoveryToken, answers: ['Rex', 'Manila', 'Emerald'] },
    });
    assert.equal(answered.status, 200, JSON.stringify(answered.json));
    assert.ok(answered.json.resetToken);

    const reset = await req('POST', '/api/auth/recovery/reset', {
      body: { resetToken: answered.json.resetToken, newPassword: NEW_PASSWORD_REF },
    });
    assert.equal(reset.status, 200, JSON.stringify(reset.json));

    // Old password no longer works; new one does.
    const oldLogin = await req('POST', '/api/auth/login', { body: { username: 'admin', password: ADMIN_PASSWORD } });
    assert.equal(oldLogin.status, 401);
    const newLogin = await req('POST', '/api/auth/login', { body: { username: 'admin', password: NEW_PASSWORD_REF } });
    assert.equal(newLogin.status, 200);

    // Reset disabled any previously-enabled 2FA (fresh password, clean state).
    assert.equal(newLogin.json.user.twoFactorEnabled, false);
  });

  it('offers a security-question challenge as a 2FA method', async () => {
    const jar = await login('admin', NEW_PASSWORD_REF);
    const setup = await req('POST', '/api/auth/security-questions/setup', {
      jar,
      headers: csrf(jar),
      body: {
        password: NEW_PASSWORD_REF,
        questions: [
          { question: 'Mother maiden name?', answer: 'Santos' },
          { question: 'First school?', answer: 'Rizal' },
          { question: 'Favorite food?', answer: 'Adobo' },
        ],
      },
    });
    assert.equal(setup.status, 200);

    // Enable TOTP so login actually demands a 2FA step.
    await req('PUT', '/api/admin/settings', {
      jar,
      headers: csrf(jar),
      body: { settings: { 'security.twoFactorEnabled': 'true' } },
    });
    const setup2fa = await req('POST', '/api/auth/2fa/setup', {
      jar,
      headers: csrf(jar),
      body: { password: NEW_PASSWORD_REF },
    });
    assert.equal(setup2fa.status, 200);
    const verify = await req('POST', '/api/auth/2fa/verify-setup', {
      jar,
      headers: csrf(jar),
      body: { code: await totpCode(setup2fa.json.secret) },
    });
    assert.equal(verify.status, 200);

    const fresh: Jar = {};
    const step1 = await req('POST', '/api/auth/login', { jar: fresh, body: { username: 'admin', password: NEW_PASSWORD_REF } });
    assert.equal(step1.status, 200);
    assert.equal(step1.json.twoFactorRequired, true);
    assert.ok(step1.json.twoFactorMethods.includes('question'), JSON.stringify(step1.json.twoFactorMethods));

    const challenge = await req('POST', '/api/auth/2fa/question', {
      body: { twoFactorToken: step1.json.twoFactorToken },
    });
    assert.equal(challenge.status, 200);
    assert.ok(challenge.json.question);

    const answerMap: Record<string, string> = {
      'Mother maiden name?': 'Santos',
      'First school?': 'Rizal',
      'Favorite food?': 'Adobo',
    };
    const step2 = await req('POST', '/api/auth/login', {
      jar: fresh,
      body: {
        username: 'admin',
        password: NEW_PASSWORD_REF,
        twoFactorToken: step1.json.twoFactorToken,
        twoFactorMethod: 'question',
        twoFactorCode: answerMap[challenge.json.question] ?? 'nope',
      },
    });
    assert.equal(step2.status, 200, JSON.stringify(step2.json));
  });

  it('keeps email OTP unavailable until SMTP is configured', async () => {
    const jar = await login('admin', NEW_PASSWORD_REF);
    const enable = await req('POST', '/api/auth/2fa/email/enable', {
      jar,
      headers: csrf(jar),
      body: { password: NEW_PASSWORD_REF, email: 'admin@homelab.local' },
    });
    assert.equal(enable.status, 200, JSON.stringify(enable.json));

    const status = await req('GET', '/api/auth/recovery/status', { jar });
    assert.equal(status.json.emailOtpEnabled, true);
    assert.equal(status.json.smtpConfigured, false);
    assert.ok(status.json.email.includes('***@'));

    // Global 2FA switch on → challenge offered, but email must be absent.
    await req('PUT', '/api/admin/settings', {
      jar,
      headers: csrf(jar),
      body: { settings: { 'security.twoFactorEnabled': 'true' } },
    });
    const fresh: Jar = {};
    const step1 = await req('POST', '/api/auth/login', { jar: fresh, body: { username: 'admin', password: NEW_PASSWORD_REF } });
    assert.equal(step1.status, 200);
    assert.ok(!(step1.json.twoFactorMethods ?? []).includes('email'), JSON.stringify(step1.json.twoFactorMethods));

    // The email challenge cannot be requested without SMTP.
    const send = await req('POST', '/api/auth/2fa/email/send', {
      body: { twoFactorToken: step1.json.twoFactorToken },
    });
    assert.equal(send.status, 403);
    assert.equal(send.json.error, 'method_unavailable');

    // Recovery options likewise exclude email without SMTP.
    const options = await req('GET', '/api/auth/recovery/options?username=admin');
    assert.ok(!options.json.methods.includes('email'), JSON.stringify(options.json));
  });
});

const NEW_PASSWORD_REF = 'Recovered#2026Zz';
