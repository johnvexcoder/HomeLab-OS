import fs from 'node:fs';

interface InterfaceCounters {
  rxBytes: number;
  txBytes: number;
}

let prevCounters: InterfaceCounters | null = null;
let prevTimestamp = 0;
let cachedResult: { downloadMbps: number; uploadMbps: number } = { downloadMbps: 0, uploadMbps: 0 };

// EMA smoothing factor (0-1). Lower = smoother, higher = more responsive.
const EMA_ALPHA = 0.3;
let emaDown = 0;
let emaUp = 0;
let hasEma = false;

const POLL_INTERVAL_MS = 1000;

function readProcNetDev(): InterfaceCounters | null {
  try {
    const content = fs.readFileSync('/proc/net/dev', 'utf8');
    const lines = content.split('\n').slice(2);

    let totalRx = 0;
    let totalTx = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) continue;

      const iface = trimmed.slice(0, colonIdx).trim();
      if (iface === 'lo' || iface.startsWith('veth') || iface.startsWith('br-') || iface.startsWith('docker')) continue;

      const fields = trimmed.slice(colonIdx + 1).trim().split(/\s+/);
      totalRx += Number(fields[0]) || 0;
      totalTx += Number(fields[8]) || 0;
    }

    return { rxBytes: totalRx, txBytes: totalTx };
  } catch {
    return null;
  }
}

function poll(): void {
  const now = Date.now();
  const current = readProcNetDev();

  if (!current) {
    // Non-Linux or /proc/net/dev unavailable — keep last cached value
    return;
  }

  if (prevCounters && prevTimestamp > 0) {
    const elapsedSec = (now - prevTimestamp) / 1000;
    if (elapsedSec > 0.5) {
      const rxDelta = Math.max(0, current.rxBytes - prevCounters.rxBytes);
      const txDelta = Math.max(0, current.txBytes - prevCounters.txBytes);

      // bytes → megabits: / 1_000_000 (decimal megabits, standard networking)
      const rawDown = (rxDelta / elapsedSec * 8) / 1_000_000;
      const rawUp = (txDelta / elapsedSec * 8) / 1_000_000;

      if (!hasEma) {
        emaDown = rawDown;
        emaUp = rawUp;
        hasEma = true;
      } else {
        emaDown = EMA_ALPHA * rawDown + (1 - EMA_ALPHA) * emaDown;
        emaUp = EMA_ALPHA * rawUp + (1 - EMA_ALPHA) * emaUp;
      }

      cachedResult = {
        downloadMbps: Math.round(emaDown * 100) / 100,
        uploadMbps: Math.round(emaUp * 100) / 100,
      };
    }
  }

  prevCounters = current;
  prevTimestamp = now;
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startNetworkBandwidth(): void {
  if (intervalHandle) return;
  poll();
  intervalHandle = setInterval(poll, POLL_INTERVAL_MS);
}

export function stopNetworkBandwidth(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

export function getNetworkBandwidth(): { downloadMbps: number; uploadMbps: number } {
  return cachedResult;
}
