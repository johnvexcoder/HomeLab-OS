/**
 * In-memory sliding-window rate limiter.
 * Per-key counters live in a small Map with periodic GC — safe for a single
 * process homelab deployment. Buckets are 60s wide; `max` is the burst cap.
 */
export interface RateLimitEntry {
  timestamps: number[];
}

const buckets = new Map<string, number[]>();
let lastGc = Date.now();

const WINDOW_MS = 60_000;

function gc(): void {
  const now = Date.now();
  if (now - lastGc < 60_000) return;
  lastGc = now;
  for (const [key, stamps] of buckets) {
    const fresh = stamps.filter((t) => now - t < WINDOW_MS);
    if (fresh.length === 0) buckets.delete(key);
    else buckets.set(key, fresh);
  }
}

export function hit(key: string, max: number, windowMs = WINDOW_MS): { allowed: boolean; retryAfterSeconds: number } {
  gc();
  const now = Date.now();
  const stamps = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (stamps.length >= max) {
    const oldest = stamps[0];
    const retryAfterSeconds = Math.ceil((windowMs - (now - oldest)) / 1000);
    buckets.set(key, stamps);
    return { allowed: false, retryAfterSeconds };
  }
  stamps.push(now);
  buckets.set(key, stamps);
  return { allowed: true, retryAfterSeconds: 0 };
}

export function clear(key: string): void {
  buckets.delete(key);
}

/**
 * Failed-login lockout. A lockout engages once `maxAttempts` failures have
 * occurred within the lockout window (tracked via a sliding window of stamps).
 * Returns remaining seconds, or 0 when not locked.
 */
export function lockoutRemainingSeconds(key: string, lockoutMinutes: number, maxAttempts: number): number {
  const windowMs = lockoutMinutes * 60_000;
  const now = Date.now();
  const stamps = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (stamps.length < maxAttempts) return 0;
  const last = stamps[stamps.length - 1];
  const remaining = windowMs - (now - last);
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

/** Record one failed login attempt for the given key. */
export function recordLoginFailure(key: string, windowMs: number): void {
  gc();
  const now = Date.now();
  const stamps = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  stamps.push(now);
  buckets.set(key, stamps);
}

/** Sensitive / admin actions get a strict per-user+IP cap (default 30/min). */
export function assertSensitiveAllowed(req: { ip?: string; user?: { id: string } }): boolean {
  const key = `admin:${req.ip ?? '?'}:${req.user?.id ?? '?'}`;
  const max = 30;
  return hit(key, max).allowed;
}
