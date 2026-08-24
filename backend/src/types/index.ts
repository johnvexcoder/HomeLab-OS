export type ServerStatus = 'online' | 'degraded' | 'offline';
export type Reachability = 'accessible' | 'degraded' | 'unreachable';
export type ServerRole = 'hypervisor' | 'docker' | 'vm' | 'lxc' | 'storage' | 'network' | 'gateway' | 'switch' | 'server';

/**
 * Fleet capability model — what a node can do. The UI surfaces these as chips
 * and the simulator/aggregation can key off them instead of hard-coded roles.
 */
export type ServerCapability =
  | 'virtualization' // runs VMs / LXC
  | 'containerization' // runs containers (Docker/Podman)
  | 'storage' // provides persistent / shared storage
  | 'gateway' // routing / NAT / firewall edge
  | 'switching' // L2/L3 forwarding fabric
  | 'monitoring'; // telemetry aggregation
export type Severity = 'info' | 'success' | 'warning' | 'critical';

/**
 * Optional hardware sensors. Only sensors a server actually exposes appear in
 * its `sensors` array; the UI renders the full registry and shows
 * "Not Available" for anything missing — no placeholder zeroes.
 */
export type SensorKind =
  | 'gpu_temp'
  | 'gpu_usage'
  | 'gpu_power'
  | 'fan_rpm'
  | 'fan_speed'
  | 'power_consumption'
  | 'disk_temp'
  | 'nvme_temp'
  | 'nic_temp'
  | 'cpu_temp';

export interface SensorConfig {
  kind: SensorKind;
  label: string;
  unit: string;
  /** nominal value */
  base: number;
  /** random-walk amplitude */
  variance: number;
  /** metric this sensor tracks (0..1 normalized driver) */
  correlatesWith?: 'cpu' | 'temp' | 'net';
  /** how strongly it follows the driver (0..1) */
  correlation?: number;
  warningThreshold?: number;
  criticalThreshold?: number;
}

export interface SensorReading {
  kind: SensorKind;
  label: string;
  unit: string;
  value: number | null;
  available: boolean;
  warningThreshold?: number;
  criticalThreshold?: number;
}

export interface ServerSpec {
  id: string;
  /** stable, globally-unique identity (UUID) — persists across sessions */
  serverId: string;
  /** short hostname (e.g. pve0.lab) */
  hostname: string;
  /** display name shown across the UI */
  name: string;
  logo: string;
  os: string;
  description: string;
  role: ServerRole;
  /** capability set this node advertises */
  capabilities: ServerCapability[];
  /** optional cluster membership; null/undefined = standalone node */
  clusterId: string | null;
  /** parent relationship (e.g. storage/VM hosts attached to a compute node) */
  parentId?: string;
  ip: string;
  location: string;
  cpuModel: string;
  cpuCores: number;
  ramTotalGb: number;
  diskTotalGb: number;
  /** hardware sensors this host exposes; anything else is "Not Available" */
  sensors: SensorConfig[];
  /** baseline/behavior tuning for the simulator */
  profile: SimProfile;
}

export interface SimProfile {
  baseCpu: number;
  cpuAmplitude: number;
  cpuNoise: number;
  baseRamGb: number;
  ramDriftGb: number;
  baseTemp: number;
  tempVariance: number;
  baseNetUpMbps: number;
  baseNetDownMbps: number;
  netBurstRate: number;
  processes: number;
  containers: number;
  vms: number;
  reliability: number; // 0..1 chance of staying healthy
}

export interface MetricSnapshot {
  serverId: string;
  timestamp: number;
  cpu: number;
  cpuCores: number;
  ramUsedGb: number;
  ramTotalGb: number;
  diskUsedGb: number;
  diskTotalGb: number;
  tempC: number;
  netUpMbps: number;
  netDownMbps: number;
  load: number;
  uptimeSeconds: number;
  processes: number;
  status: ServerStatus;
  reachability: Reachability;
  health: number;
  sensors: SensorReading[];
}

export interface ServerRuntime {
  spec: ServerSpec;
  status: ServerStatus;
  reachability: Reachability;
  health: number;
  load: number;
  uptimeSeconds: number;
  cpu: number;
  ramUsedGb: number;
  diskUsedGb: number;
  tempC: number;
  netUpMbps: number;
  netDownMbps: number;
  processes: number;
  lastSeen: number;
  sensors: SensorReading[];
  history: Record<
    'cpu' | 'ram' | 'disk' | 'temp' | 'netUp' | 'netDown' | 'load',
    number[]
  >;
  /** Canonical container list from the agent (source of truth for topology) */
  containers?: Array<{ id: string; name: string; running: boolean; image: string; ports?: string[] }>;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  severity: Severity;
  timestamp: number;
  read: boolean;
  serverId?: string;
  acknowledged?: boolean;
}

export type NetworkNodeType =
  | 'internet' | 'gateway' | 'switch' | 'bridge'
  | 'physical' | 'hypervisor'
  | 'vm' | 'lxc' | 'container'
  | 'docker' | 'podman' | 'kubernetes'
  | 'storage' | 'nas' | 'ups' | 'firewall'
  | 'cloud' | 'laptop' | 'desktop';

export interface NetworkNode {
  id: string;
  label: string;
  type: NetworkNodeType;
  status: ServerStatus;
  ip?: string;
  x: number;
  y: number;
  parentId?: string;
  health: number;
  /** Number of child containers/VMs (for badge display). */
  childCount?: number;
  /** Temperature in Celsius if available. */
  tempC?: number;
  /** CPU percentage if available. */
  cpuPercent?: number;
}

export interface NetworkLink {
  id: string;
  source: string;
  target: string;
  status: 'healthy' | 'warning' | 'critical';
  latencyMs: number;
  throughputMbps: number;
  jitterMs: number;
  packetLoss: number;
}

export interface QuickStat {
  id: string;
  label: string;
  value: number;
  unit: string;
  delta: number; // % change vs previous interval
  tone: 'neutral' | 'good' | 'warn' | 'crit';
  /** Optional secondary value for split cards (e.g. VMs & CTs) */
  value2?: number;
  label2?: string;
  unit2?: string;
}

export interface ClusterInfo {
  id: string;
  name: string;
  serverIds: string[];
  status: ServerStatus;
  health: number;
  online: number;
  degraded: number;
  offline: number;
}

export interface GlobalHealth {
  score: number; // 0..100
  status: ServerStatus;
  totalServers: number;
  onlineServers: number;
  degradedServers: number;
  offlineServers: number;
  activeAlerts: number;
  avgCpu: number;
  avgRam: number;
  totalUptimePercent: number;
}

export interface Incident {
  id: string;
  serverId: string;
  serverName: string;
  type: string;
  severity: Severity;
  message: string;
  startedAt: number;
  resolvedAt: number | null;
  resolved: boolean;
}

export interface BootStats {
  historySeeded: boolean;
  historyPoints: number;
  startedAt: number;
}
