import crypto from 'node:crypto';

const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTS = { N: 2 ** 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function randomBytes(length: number): string {
  return crypto.randomBytes(length).toString('hex');
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Constant-time string comparison (length fixed by hashing both sides). */
export function safeEqual(a: string, b: string): boolean {
  const ah = crypto.createHash('sha256').update(a, 'utf8').digest();
  const bh = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(ah, bh);
}

// ---- Passwords (scrypt) ----

export function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTS).toString('hex');
}

export function createPasswordHash(password: string): { hash: string; salt: string } {
  const salt = crypto.randomBytes(16).toString('hex');
  return { hash: hashPassword(password, salt), salt };
}

export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const candidate = hashPassword(password, salt);
  return safeEqual(candidate, expectedHash);
}

// ---- Session tokens ----

/** 32 random bytes, base64url. Only the SHA-256 hash is ever persisted. */
export function createSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

// ---- TOTP (RFC 6238, HMAC-SHA1, 30s window) ----

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(): string {
  const bytes = crypto.randomBytes(20);
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let secret = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    secret += BASE32_ALPHABET[Number.parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  }
  return secret;
}

function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/[\s=]/g, '');
  let bits = '';
  for (const char of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

export function totpFor(secret: string, at = Date.now()): string {
  const counter = Math.floor(at / 30_000);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  counterBuf.writeUInt32BE(counter >>> 0, 4);

  const key = base32Decode(secret);
  const hmac = crypto.createHmac('sha1', key);
  hmac.update(counterBuf);
  const digest = hmac.digest();

  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return (code % 1_000_000).toString().padStart(6, '0');
}

/** Accepts the current 30s window plus one window either side for clock drift. */
export function verifyTotp(secret: string, code: string, at = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  for (const offset of [0, -1, 1]) {
    if (safeEqual(totpFor(secret, at + offset * 30_000), code)) return true;
  }
  return false;
}

export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const bytes = crypto.randomBytes(6).toString('hex').toUpperCase();
    return `${bytes.slice(0, 4)}-${bytes.slice(4, 8)}-${bytes.slice(8, 12)}`;
  });
}

export function hashRecoveryCode(code: string): string {
  return sha256(code);
}

// ---- Email OTP / one-time codes ----

/** Cryptographically random N-digit numeric code (default 6). */
export function generateOtpCode(digits = 6): string {
  const max = 10 ** digits;
  const min = 10 ** (digits - 1);
  let value = 0;
  do {
    value = crypto.randomInt(min, max);
  } while (value === 0);
  return String(value);
}

/** Normalise a security-question answer before hashing/comparing. */
export function normalizeAnswer(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Hash a security-question answer (never stored in plaintext). */
export function hashAnswer(value: string): string {
  return sha256(normalizeAnswer(value));
}

export function verifyRecoveryCode(code: string, hashes: string[]): boolean {
  const candidate = sha256(code.toUpperCase());
  return hashes.some((h) => safeEqual(h, candidate));
}

// ---- AES-256-GCM secret encryption (at-rest) ----

export function encryptSecret(plain: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(payload: string, key: Buffer): string | null {
  try {
    const [version, ivB64, tagB64, dataB64] = payload.split(':');
    if (version !== 'v1') return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
    return plain.toString('utf8');
  } catch {
    return null;
  }
}
