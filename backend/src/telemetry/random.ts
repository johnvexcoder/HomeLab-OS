/**
 * Deterministic-ish PRNG and small math helpers used by the simulator.
 * Pure functions, no state kept here.
 */

/** Mulberry32 — tiny fast seeded PRNG so simulations are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rand = Math.random;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function round(value: number, digits = 0): number {
  const f = Math.pow(10, digits);
  return Math.round(value * f) / f;
}

export function smoothNoise(x: number, seed = 0): number {
  const s = Math.sin(x * 12.9898 + seed * 78.233) * 43758.5453;
  return s - Math.floor(s); // 0..1
}

/** Random walk step bounded by [-amp, amp]. */
export function jitter(randFn: () => number, amp: number): number {
  return (randFn() * 2 - 1) * amp;
}

/** Add a spike to `current` with probability `rate`, decaying over time. */
export function applyBurst(
  randFn: () => number,
  current: number,
  rate: number,
  amp: number,
  max: number,
): number {
  if (randFn() < rate) {
    return clamp(current + randFn() * amp, 0, max);
  }
  return current;
}

export function pick<T>(randFn: () => number, arr: T[]): T {
  return arr[Math.floor(randFn() * arr.length)];
}

export function randomInt(randFn: () => number, min: number, max: number): number {
  return Math.floor(randFn() * (max - min + 1)) + min;
}

/** Seconds -> human friendly "3d 4h 22m" */
export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function formatMbps(mbps: number): string {
  if (mbps >= 1000) return `${round(mbps / 1000, 1)} Gb/s`;
  return `${round(mbps, 0)} Mb/s`;
}
