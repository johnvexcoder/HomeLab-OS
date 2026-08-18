import fs from 'node:fs';

interface InterfaceCounters {
  rxBytes: number;
  txBytes: number;
}

let prevCounters: InterfaceCounters | null = null;
let prevTimestamp = 0;
let cachedResult: { downloadMbps: number; uploadMbps: number } = { downloadMbps: 0, uploadMbps: 0 };

const POLL_INTERVAL_MS = 3000;

function readProcNetDev(): InterfaceCounters {
  const content = fs.readFileSync('/proc/net/dev', 'utf8');
  const lines = content.split('\n').slice(2); // skip headers

  let totalRx = 0;
  let totalTx = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const iface = trimmed.slice(0, colonIdx).trim();
    // Skip loopback and virtual interfaces
    if (iface === 'lo' || iface.startsWith('veth') || iface.startsWith('br-') || iface.startsWith('docker')) continue;

    const fields = trimmed.slice(colonIdx + 1).trim().split(/\s+/);
    // /proc/net/dev format: rx_bytes is field[0], tx_bytes is field[8]
    totalRx += Number(fields[0]) || 0;
    totalTx += Number(fields[8]) || 0;
  }

  return { rxBytes: totalRx, txBytes: totalTx };
}

function poll(): void {
  const now = Date.now();
  const current = readProcNetDev();

  if (prevCounters && prevTimestamp > 0) {
    const elapsedSec = (now - prevTimestamp) / 1000;
    if (elapsedSec > 0) {
      const rxDelta = Math.max(0, current.rxBytes - prevCounters.rxBytes);
      const txDelta = Math.max(0, current.txBytes - prevCounters.txBytes);
      // bytes → megabits: / 1000000 (decimal megabits, standard networking convention)
      cachedResult = {
        downloadMbps: Math.round((rxDelta / elapsedSec / 1_000_000) * 100) / 100,
        uploadMbps: Math.round((txDelta / elapsedSec / 1_000_000) * 100) / 100,
      };
    }
  }

  prevCounters = current;
  prevTimestamp = now;
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startNetworkBandwidth(): void {
  if (intervalHandle) return;
  // Seed first reading (no delta yet)
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
