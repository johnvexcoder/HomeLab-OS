import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config';

/**
 * Key management for integration secrets at rest.
 *
 * Key source precedence:
 *   1. SECRET_ENCRYPTION_KEY env var (recommended, survives DATA_DIR wipes)
 *   2. data/secrets.key – generated once, chmod 600
 *
 * Key rotation (dashboardctl rotate-secrets) re-encrypts every stored secret
 * under a new key. The raw key is never exposed via any API.
 */

let cachedKey: Buffer | null = null;

export function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;

  const fromEnv = process.env.SECRET_ENCRYPTION_KEY;
  if (fromEnv) {
    cachedKey = deriveKey(fromEnv);
    return cachedKey;
  }

  const keyFile = path.join(config.dataDir, 'secrets.key');
  if (fs.existsSync(keyFile)) {
    cachedKey = fs.readFileSync(keyFile);
    return cachedKey;
  }

  const generated = crypto.randomBytes(32);
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(keyFile, generated, { mode: 0o600 });
  cachedKey = generated;
  return cachedKey;
}

/** Deterministic 32-byte key from a user-provided string (must be >= 16 chars). */
export function deriveKey(secret: string): Buffer {
  const material = secret.length >= 16 ? secret : secret.padEnd(16, '0');
  return crypto.createHash('sha256').update(material).digest();
}

export function rotateSecrets(): { reencrypted: number } {
  const oldKey = getEncryptionKey();
  const newKey = process.env.SECRET_ENCRYPTION_KEY
    ? deriveKey(process.env.SECRET_ENCRYPTION_KEY)
    : crypto.randomBytes(32);

  const { decryptSecret, encryptSecret } = require('./crypto') as typeof import('./crypto');
  const { getDb } = require('../db/database') as typeof import('../db/database');
  const rows = getDb().prepare('SELECT id, secrets FROM integrations WHERE secrets IS NOT NULL').all() as Array<{
    id: string;
    secrets: string | null;
  }>;
  let reencrypted = 0;
  const tx = getDb().transaction(() => {
    const stmt = getDb().prepare('UPDATE integrations SET secrets = ? WHERE id = ?');
    for (const row of rows) {
      if (!row.secrets) continue;
      try {
        const parsed = JSON.parse(row.secrets) as Record<string, string>;
        const out: Record<string, string> = {};
        for (const [field, payload] of Object.entries(parsed)) {
          const plain = decryptSecret(payload, oldKey);
          if (plain === null) continue;
          out[field] = encryptSecret(plain, newKey);
        }
        stmt.run(JSON.stringify(out), row.id);
        reencrypted += 1;
      } catch {
        // leave entry untouched rather than corrupting it
      }
    }
  });
  tx();

  if (!process.env.SECRET_ENCRYPTION_KEY) {
    const keyFile = path.join(config.dataDir, 'secrets.key');
    fs.writeFileSync(keyFile, newKey, { mode: 0o600 });
  }
  cachedKey = newKey;
  return { reencrypted };
}
