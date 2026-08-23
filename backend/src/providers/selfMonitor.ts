/*
 * Self-Monitor Provider
 *
 * Reads system metrics from /proc and Node.js os module so the backend
 * can monitor its own host without the HomeLab Agent. This fills in
 * metrics for the VM where the backend is installed (e.g. docker01).
 *
 * Data sources:
 *   CPU       /proc/stat (delta between two reads)
 *   RAM       os.totalmem() / os.freemem()
 *   Disk      statvfs on root mount
 *   Temp      sys/class/thermal/thermal_zone temps
 *   Network   /proc/net/dev (delta between two reads)
 *   Load      os.loadavg()
 *   Uptime    /proc/uptime
 *   Processes /proc (count of pid directories)
 */

import * as os from 'os';
import * as fs from 'fs';

export interface SelfMonitorData {
  cpuUsage: number;        // 0–100
  ramUsedGb: number;
  ramTotalGb: number;
  diskUsedGb: number;
  diskTotalGb: number;
  tempC: number | null;
  netUpMbps: number;
  netDownMbps: number;
  load1: number;
  load5: number;
  load15: number;
  uptimeSeconds: number;
  processes: number;
  cpuCores: number;
  os: string;
}

let prevCpuIdle = 0;
let prevCpuTotal = 0;
let prevNetRx = 0;
let prevNetTx = 0;
let prevTs = 0;

function readProcFile(path: string): string {
  try { return fs.readFileSync(path, 'utf-8'); } catch { return ''; }
}

function getCpuTimes(): { idle: number; total: number } {
  const line = readProcFile('/proc/stat').split('\n')[0];
  const parts = line.split(/\s+/).slice(1).map(Number);
  const idle = parts[3] ?? 0;
  const total = parts.reduce((a, b) => a + b, 0);
  return { idle, total };
}

function getTemp(): number | null {
  const paths = ['/sys/class/thermal', '/host-thermal'];
  for (const basePath of paths) {
    try {
      const zones = fs.readdirSync(basePath).filter((z) => z.startsWith('thermal_zone'));
      for (const zone of zones) {
        const raw = readProcFile(`${basePath}/${zone}/temp`).trim();
        const val = parseInt(raw, 10);
        if (Number.isFinite(val) && val > 0) {
          return val > 1000 ? val / 1000 : val; // some report in millidegrees
        }
      }
    } catch { /* path not found, try next */ }
  }
  return null;
}

function getNetBytes(): { rx: number; tx: number } {
  let rx = 0, tx = 0;
  const content = readProcFile('/proc/net/dev');
  for (const line of content.split('\n').slice(2)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 10) continue;
    const iface = parts[0].replace(':', '');
    if (iface === 'lo' || iface === 'docker0' || iface.startsWith('br-') || iface.startsWith('veth')) continue;
    rx += parseInt(parts[1], 10) || 0;
    tx += parseInt(parts[9], 10) || 0;
  }
  return { rx, tx };
}

function getDisk(): { used: number; total: number } {
  try {
    const stat = fs.statfsSync('/');
    const total = (stat.blocks * stat.bsize) / (1024 ** 3);
    const free = (stat.bfree * stat.bsize) / (1024 ** 3);
    return { used: Math.round((total - free) * 10) / 10, total: Math.round(total * 10) / 10 };
  } catch {
    return { used: 0, total: 0 };
  }
}

function countProcesses(): number {
  try {
    return fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)).length;
  } catch { return 0; }
}

function getNetworkInterfaces(): string {
  try {
    const interfaces = os.networkInterfaces();
    const names = Object.keys(interfaces).filter(
      (name) => !name.startsWith('lo') && !name.startsWith('docker') && !name.startsWith('br-') && !name.startsWith('veth')
    );
    return names[0] || 'eth0';
  } catch { return 'eth0'; }
}

/**
 * Collect current system metrics. Call periodically (e.g. every 10s).
 */
export function collectSelfMetrics(): SelfMonitorData {
  const now = Date.now();
  const cpu = getCpuTimes();
  const net = getNetBytes();
  const disk = getDisk();
  const loadAvg = os.loadavg();

  // CPU usage (delta-based)
  let cpuUsage = 0;
  if (prevTs > 0) {
    const dtIdle = cpu.idle - prevCpuIdle;
    const dtTotal = cpu.total - prevCpuTotal;
    cpuUsage = dtTotal > 0 ? Math.round(((dtTotal - dtIdle) / dtTotal) * 1000) / 10 : 0;
  }
  prevCpuIdle = cpu.idle;
  prevCpuTotal = cpu.total;

  // Network Mbps (delta-based)
  let netUpMbps = 0;
  let netDownMbps = 0;
  if (prevTs > 0) {
    const dtSec = (now - prevTs) / 1000;
    if (dtSec > 0) {
      netDownMbps = Math.round(((net.rx - prevNetRx) * 8 / dtSec / 1_000_000) * 10) / 10;
      netUpMbps = Math.round(((net.tx - prevNetTx) * 8 / dtSec / 1_000_000) * 10) / 10;
    }
  }
  prevNetRx = net.rx;
  prevNetTx = net.tx;
  prevTs = now;

  const ramTotal = os.totalmem() / (1024 ** 3);
  const ramUsed = (os.totalmem() - os.freemem()) / (1024 ** 3);

  return {
    cpuUsage: Math.min(100, Math.max(0, cpuUsage)),
    ramUsedGb: Math.round(ramUsed * 10) / 10,
    ramTotalGb: Math.round(ramTotal * 10) / 10,
    diskUsedGb: disk.used,
    diskTotalGb: disk.total,
    tempC: getTemp(),
    netUpMbps,
    netDownMbps,
    load1: loadAvg[0],
    load5: loadAvg[1],
    load15: loadAvg[2],
    uptimeSeconds: Math.floor(os.uptime()),
    processes: countProcesses(),
    cpuCores: os.cpus().length,
    os: `${os.type()} ${os.release()}`,
  };
}
