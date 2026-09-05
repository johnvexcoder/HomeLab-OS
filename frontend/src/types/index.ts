export type ServerStatus = 'online' | 'degraded' | 'offline';
export type Reachability = 'accessible' | 'degraded' | 'unreachable';
export type ServerRole = 'hypervisor' | 'server' | 'vm' | 'lxc' | 'docker' | 'storage' | 'network' | 'gateway' | 'switch';
export type Severity = 'info' | 'success' | 'warning' | 'critical';
export type Tone = 'neutral' | 'good' | 'warn' | 'crit';

export type ServerCapability =
  | 'virtualization'
  | 'containerization'
  | 'storage'
  | 'gateway'
  | 'switching'
  | 'monitoring';

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
  /** optional cluster membership; null = standalone node */
  clusterId: string | null;
  /** parent relationship (e.g. storage/VM hosts attached to a compute node) */
  parentId?: string;
  ip: string;
  location: string;
  cpuModel: string;
  cpuCores: number;
  ramTotalGb: number;
  diskTotalGb: number;
  sensors: SensorReading[];
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
  reliability: number;
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
  /** Selected System Tags (max 3) with per-host installed/running state */
  tags?: SystemTagState[];
}

export type SystemTagId = 'dbus' | 'docker' | 'lm-sensors' | 'ssh' | 'containerd' | 'networkmanager';

export interface SystemTagState {
  id: SystemTagId;
  label: string;
  installed: boolean;
  running: boolean;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  severity: Severity;
  timestamp: number;
  read: boolean;
  serverId?: string;
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
  childCount?: number;
  tempC?: number;
  cpuPercent?: number;
}

export interface NetworkLink {
  id: string;
  source: string;
  target: string;
  status: 'healthy' | 'warning' | 'critical' | 'unknown';
  state?: 'observed' | 'inferred' | 'configured' | 'unknown';
  latencyMs?: number | null;
  throughputMbps?: number | null;
  jitterMs?: number | null;
  packetLoss?: number | null;
}

export interface NetworkTopology {
  nodes: NetworkNode[];
  links: NetworkLink[];
  icons: Record<NetworkNode['type'], string>;
}

export interface QuickStat {
  id: string;
  label: string;
  value: number;
  unit: string;
  delta: number;
  tone: Tone;
  /** Optional secondary value for split cards (e.g. VMs & CTs) */
  value2?: number;
  label2?: string;
  unit2?: string;
}

export interface GlobalHealth {
  score: number;
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

export interface HistoryPoint {
  ts: number;
  cpu: number;
  ram: number;
  disk: number;
  temp: number;
  netUp: number;
  netDown: number;
  load: number;
}

export type HistoryRange = '15m' | '1h' | '6h' | '24h';

export interface StatsHistoryPoint {
  ts: number;
  cpu: number;
  mem: number;
  network: number;
  containers: number;
}

export type MetricKey = 'cpu' | 'ram' | 'disk' | 'temp' | 'netUp' | 'netDown' | 'load';

export interface BootStats {
  historySeeded: boolean;
  historyPoints: number;
  startedAt: number;
}

export interface SearchResults {
  servers: SearchItem[];
  notifications: SearchItem[];
  actions: SearchItem[];
}

export interface SearchItem {
  type: 'server' | 'notification' | 'action';
  id: string;
  title: string;
  subtitle: string;
  logo: string;
  route: string;
}

export interface QuickAction {
  id: string;
  label: string;
  kind: string;
  keywords: string;
  route?: string;
  href?: string;
  icon: string;
  enabled: boolean;
}
