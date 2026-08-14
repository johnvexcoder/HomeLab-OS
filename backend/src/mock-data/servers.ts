import type { ServerSpec } from '../types';

/** Deterministic FNV-1a hash so generated UUIDs are stable across restarts. */
function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

/** Deterministic UUID from a seed — the fleet identity persists across restarts. */
export function uuid(seed: string): string {
  const x = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  const a = hash(`${seed}::1`);
  const b = hash(`${seed}::2`);
  const c = hash(`${seed}::3`);
  const d = hash(`${seed}::4`);
  return `${x(a).slice(0, 8)}-${x(b).slice(0, 4)}-4${x(b).slice(4, 7)}-${x(c).slice(0, 4)}-${x(c).slice(4, 8)}${x(d).slice(0, 8)}`;
}

/** Display names for the demo clusters referenced by `clusterId`. */
export const CLUSTER_NAMES: Record<string, string> = {
  'lab-proxmox': 'HomeLab Proxmox',
};

/**
 * Static catalog of the HomeLab fleet. These are the "truth" the simulator
 * animates around. Replacing the mock provider later means you keep the specs
 * but fetch live values from Proxmox / Docker / Node Exporter instead.
 *
 * The fleet model is cluster-aware: nodes with a `clusterId` belong to a
 * cluster; `clusterId: null` nodes are standalone. Both shapes coexist and
 * every consumer must treat the fleet as a set (never assume a "first server").
 */
export const SERVER_SPECS: ServerSpec[] = [
  {
    id: 'pve0',
    serverId: uuid('pve0'),
    hostname: 'pve0.lab',
    name: 'PVE0',
    logo: '🟩',
    capabilities: ['virtualization', 'containerization'],
    clusterId: 'lab-proxmox',
    os: 'Proxmox VE 8.2',
    description: 'Primary hypervisor — runs the whole lab.',
    role: 'hypervisor',
    ip: '10.0.0.2',
    location: 'Rack R1 / U32',
    cpuModel: 'AMD Ryzen 9 5950X (16C/32T)',
    cpuCores: 32,
    ramTotalGb: 128,
    diskTotalGb: 8192,
    sensors: [
      { kind: 'cpu_temp', label: 'CPU Temperature', unit: '°C', base: 52, variance: 4, correlatesWith: 'temp', correlation: 0.9, warningThreshold: 78, criticalThreshold: 88 },
      { kind: 'gpu_temp', label: 'GPU Temperature', unit: '°C', base: 46, variance: 5, correlatesWith: 'cpu', correlation: 0.45, warningThreshold: 82, criticalThreshold: 92 },
      { kind: 'gpu_usage', label: 'GPU Utilization', unit: '%', base: 12, variance: 10, correlatesWith: 'cpu', correlation: 0.5, warningThreshold: 90, criticalThreshold: 98 },
      { kind: 'gpu_power', label: 'GPU Power', unit: 'W', base: 34, variance: 14, correlatesWith: 'cpu', correlation: 0.55, warningThreshold: 210, criticalThreshold: 240 },
      { kind: 'fan_rpm', label: 'Case Fan RPM', unit: 'rpm', base: 820, variance: 60, correlatesWith: 'temp', correlation: 0.7, warningThreshold: 2400, criticalThreshold: 2600 },
      { kind: 'fan_speed', label: 'Fan Duty', unit: '%', base: 28, variance: 8, correlatesWith: 'temp', correlation: 0.7, warningThreshold: 85, criticalThreshold: 95 },
      { kind: 'power_consumption', label: 'Power Draw', unit: 'W', base: 96, variance: 18, correlatesWith: 'cpu', correlation: 0.6, warningThreshold: 320, criticalThreshold: 360 },
      { kind: 'nvme_temp', label: 'NVMe Temp', unit: '°C', base: 44, variance: 4, correlatesWith: 'cpu', correlation: 0.35, warningThreshold: 68, criticalThreshold: 74 },
    ],
    profile: {
      baseCpu: 24,
      cpuAmplitude: 16,
      cpuNoise: 6,
      baseRamGb: 74,
      ramDriftGb: 4,
      baseTemp: 52,
      tempVariance: 5,
      baseNetUpMbps: 120,
      baseNetDownMbps: 420,
      netBurstRate: 0.15,
      processes: 214,
      containers: 12,
      vms: 5,
      reliability: 0.995,
    },
  },
  {
    id: 'docker01',
    serverId: uuid('docker01'),
    hostname: 'docker01.lab',
    name: 'Docker01',
    logo: '🐳',
    capabilities: ['containerization'],
    clusterId: 'lab-proxmox',
    os: 'Debian 12 · Docker 27',
    description: 'Application host — 60+ containers.',
    role: 'docker',
    ip: '10.0.0.10',
    location: 'Rack R1 / U33',
    cpuModel: 'Intel i7-12700 (12C/20T)',
    cpuCores: 20,
    ramTotalGb: 64,
    diskTotalGb: 4096,
    sensors: [
      { kind: 'cpu_temp', label: 'CPU Temperature', unit: '°C', base: 47, variance: 4, correlatesWith: 'temp', correlation: 0.9, warningThreshold: 80, criticalThreshold: 90 },
      { kind: 'fan_rpm', label: 'CPU Fan RPM', unit: 'rpm', base: 980, variance: 90, correlatesWith: 'temp', correlation: 0.75, warningThreshold: 2500, criticalThreshold: 2800 },
      { kind: 'fan_speed', label: 'Fan Duty', unit: '%', base: 34, variance: 10, correlatesWith: 'temp', correlation: 0.7, warningThreshold: 85, criticalThreshold: 95 },
      { kind: 'power_consumption', label: 'Power Draw', unit: 'W', base: 58, variance: 15, correlatesWith: 'cpu', correlation: 0.65, warningThreshold: 200, criticalThreshold: 240 },
      { kind: 'nvme_temp', label: 'NVMe Temp', unit: '°C', base: 43, variance: 5, correlatesWith: 'cpu', correlation: 0.4, warningThreshold: 68, criticalThreshold: 74 },
    ],
    profile: {
      baseCpu: 32,
      cpuAmplitude: 22,
      cpuNoise: 9,
      baseRamGb: 38,
      ramDriftGb: 3,
      baseTemp: 47,
      tempVariance: 6,
      baseNetUpMbps: 80,
      baseNetDownMbps: 260,
      netBurstRate: 0.25,
      processes: 186,
      containers: 64,
      vms: 0,
      reliability: 0.992,
    },
  },
  {
    id: 'nas01',
    serverId: uuid('nas01'),
    hostname: 'nas01.lab',
    name: 'NAS01',
    logo: '🗄️',
    capabilities: ['storage'],
    clusterId: 'lab-proxmox',
    parentId: 'docker01',
    os: 'TrueNAS SCALE 24.04',
    description: 'ZFS storage pool — media + backups.',
    role: 'storage',
    ip: '10.0.0.30',
    location: 'Rack R2 / U14',
    cpuModel: 'Intel Xeon E-2276G (6C/12T)',
    cpuCores: 12,
    ramTotalGb: 64,
    diskTotalGb: 24576,
    sensors: [
      { kind: 'cpu_temp', label: 'CPU Temperature', unit: '°C', base: 41, variance: 3, correlatesWith: 'temp', correlation: 0.85, warningThreshold: 75, criticalThreshold: 85 },
      { kind: 'disk_temp', label: 'Drive Temp (avg)', unit: '°C', base: 36, variance: 3, correlatesWith: 'net', correlation: 0.15, warningThreshold: 52, criticalThreshold: 58 },
      { kind: 'fan_rpm', label: 'Chassis Fan RPM', unit: 'rpm', base: 720, variance: 40, correlatesWith: 'temp', correlation: 0.5, warningThreshold: 2200, criticalThreshold: 2500 },
      { kind: 'fan_speed', label: 'Fan Duty', unit: '%', base: 22, variance: 6, correlatesWith: 'temp', correlation: 0.5, warningThreshold: 85, criticalThreshold: 95 },
      { kind: 'power_consumption', label: 'Power Draw', unit: 'W', base: 74, variance: 12, correlatesWith: 'cpu', correlation: 0.55, warningThreshold: 280, criticalThreshold: 320 },
    ],
    profile: {
      baseCpu: 12,
      cpuAmplitude: 10,
      cpuNoise: 4,
      baseRamGb: 41,
      ramDriftGb: 3,
      baseTemp: 41,
      tempVariance: 4,
      baseNetUpMbps: 200,
      baseNetDownMbps: 520,
      netBurstRate: 0.18,
      processes: 92,
      containers: 4,
      vms: 0,
      reliability: 0.998,
    },
  },
  {
    id: 'gateway',
    serverId: uuid('gateway'),
    hostname: 'gateway.lab',
    name: 'Gateway',
    logo: '🛡️',
    capabilities: ['gateway'],
    clusterId: null,
    os: 'OPNsense 24.7',
    description: 'Router / firewall / VPN edge.',
    role: 'gateway',
    ip: '10.0.0.1',
    location: 'Rack R1 / U1',
    cpuModel: 'Intel N5105 (4C/4T)',
    cpuCores: 4,
    ramTotalGb: 16,
    diskTotalGb: 128,
    sensors: [
      { kind: 'cpu_temp', label: 'CPU Temperature', unit: '°C', base: 49, variance: 5, correlatesWith: 'temp', correlation: 0.9, warningThreshold: 80, criticalThreshold: 90 },
      { kind: 'power_consumption', label: 'Power Draw', unit: 'W', base: 11, variance: 3, correlatesWith: 'cpu', correlation: 0.5, warningThreshold: 25, criticalThreshold: 30 },
    ],
    profile: {
      baseCpu: 8,
      cpuAmplitude: 8,
      cpuNoise: 3,
      baseRamGb: 6.5,
      ramDriftGb: 0.6,
      baseTemp: 49,
      tempVariance: 5,
      baseNetUpMbps: 340,
      baseNetDownMbps: 940,
      netBurstRate: 0.3,
      processes: 58,
      containers: 0,
      vms: 0,
      reliability: 0.999,
    },
  },
  {
    id: 'switch01',
    serverId: uuid('switch01'),
    hostname: 'switch01.lab',
    name: 'Switch01',
    logo: '🔀',
    capabilities: ['switching'],
    clusterId: null,
    os: 'Ubiquiti UniFi USW-Pro-24',
    description: '24-port PoE core switch.',
    role: 'switch',
    ip: '10.0.0.5',
    location: 'Rack R1 / U4',
    cpuModel: 'MIPS SoC',
    cpuCores: 2,
    ramTotalGb: 2,
    diskTotalGb: 16,
    sensors: [
      { kind: 'power_consumption', label: 'PoE Budget', unit: 'W', base: 84, variance: 20, correlatesWith: 'net', correlation: 0.3, warningThreshold: 380, criticalThreshold: 400 },
      { kind: 'fan_rpm', label: 'Fan RPM', unit: 'rpm', base: 1150, variance: 80, correlatesWith: 'temp', correlation: 0.5, warningThreshold: 2400, criticalThreshold: 2700 },
    ],
    profile: {
      baseCpu: 5,
      cpuAmplitude: 6,
      cpuNoise: 3,
      baseRamGb: 0.9,
      ramDriftGb: 0.1,
      baseTemp: 38,
      tempVariance: 3,
      baseNetUpMbps: 500,
      baseNetDownMbps: 900,
      netBurstRate: 0.35,
      processes: 12,
      containers: 0,
      vms: 0,
      reliability: 0.999,
    },
  },
];

export const DEFAULT_SERVER = 'pve0';

/** Boot-time uptimes (seconds) so the numbers look like a real running lab. */
export const INITIAL_UPTIME_SECONDS: Record<string, number> = {
  pve0: 90 * 24 * 3600 + 3600 * 4,
  docker01: 14 * 24 * 3600 + 3600 * 9,
  nas01: 210 * 24 * 3600,
  gateway: 31 * 24 * 3600 + 3600 * 22,
  switch01: 365 * 24 * 3600,
};
