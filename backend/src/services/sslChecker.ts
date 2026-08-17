import tls from 'node:tls';
import { notifyDispatcher } from './notifyDispatch';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours
const WARNING_DAYS = 14;
const CRITICAL_DAYS = 3;

interface SslTarget {
  hostname: string;
  port: number;
}

const DEFAULT_TARGETS: SslTarget[] = [
  { hostname: 'api.telegram.org', port: 443 },
];

let timer: NodeJS.Timeout | null = null;
const lastWarnAt = new Map<string, number>();
const lastCritAt = new Map<string, number>();

function checkCert(target: SslTarget): Promise<{ valid: boolean; daysLeft: number; expiresAt: string } | null> {
  return new Promise((resolve) => {
    const req = tls.connect(
      { host: target.hostname, port: target.port, servername: target.hostname, rejectUnauthorized: false, timeout: 10_000 },
      () => {
        const cert = req.getPeerCertificate();
        if (!cert || !cert.valid_to) {
          req.destroy();
          resolve(null);
          return;
        }
        const expiresAt = new Date(cert.valid_to);
        const now = Date.now();
        const daysLeft = Math.ceil((expiresAt.getTime() - now) / (1000 * 60 * 60 * 24));
        req.destroy();
        resolve({ valid: daysLeft > 0, daysLeft: Math.max(0, daysLeft), expiresAt: expiresAt.toISOString() });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function runCheck(): Promise<void> {
  const now = Date.now();
  for (const target of DEFAULT_TARGETS) {
    const result = await checkCert(target);
    if (!result) continue;

    const key = `${target.hostname}:${target.port}`;
    if (result.daysLeft <= CRITICAL_DAYS && now - (lastCritAt.get(key) ?? 0) > 24 * 60 * 60 * 1000) {
      lastCritAt.set(key, now);
      notifyDispatcher.notifySslExpiryCritical(target.hostname, result.daysLeft, result.expiresAt);
    } else if (result.daysLeft <= WARNING_DAYS && now - (lastWarnAt.get(key) ?? 0) > 24 * 60 * 60 * 1000) {
      lastWarnAt.set(key, now);
      notifyDispatcher.notifySslExpiryWarning(target.hostname, result.daysLeft, result.expiresAt);
    }
  }
}

export function startSslChecker(): NodeJS.Timeout {
  runCheck().catch(() => undefined);
  timer = setInterval(() => { void runCheck(); }, CHECK_INTERVAL_MS);
  timer.unref();
  return timer;
}
