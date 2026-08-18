import type {
  BootStats,
  ClusterInfo,
  GlobalHealth,
  MetricSnapshot,
  NetworkLink,
  NetworkNode,
  Notification,
  QuickStat,
  ServerRuntime,
} from '../types';

export interface HistoryPoint {
  ts: number;
  cpu: number;
  ram: number; // %
  disk: number; // %
  temp: number; // °C
  netUp: number; // Mb/s
  netDown: number; // Mb/s
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

/**
 * The full contract every metrics provider (mock or real Proxmox) must
 * implement. Routes only ever depend on this — swapping the source never
 * touches the API surface or the frontend.
 */
export interface MetricsProvider {
  getServers(): ServerRuntime[];
  getServer(id: string): ServerRuntime | undefined;
  getHistory(serverId: string, range: HistoryRange): HistoryPoint[];
  getStatsHistory(range: HistoryRange): StatsHistoryPoint[];
  getGlobalHealth(): GlobalHealth;
  getQuickStats(): QuickStat[];
  getNetwork(): { nodes: NetworkNode[]; links: NetworkLink[] };
  getClusters(): ClusterInfo[];
  getBootStats(): BootStats;
  getDockerContainers?(): DockerContainerInfo[];
  getDockerHostProfiles?(): DockerHostProfile[];
  /** Optional: provider name shown on /api/health (defaults to mock/proxmox). */
  getSourceName?(): string;
  /** Optional: last poll error, surfaced on /api/health for real integrations. */
  getLastPollError?(): string | null;
  /** Optional: per-endpoint diagnostics for real integrations (e.g. PVE auth failures). */
  getDiagnostics?(): ProviderDiagnostics;
}

export interface DockerContainerInfo {
  id: string;
  name: string;
  running: boolean;
  image: string;
  ports?: string[];
}

export interface DockerHostProfile {
  hostName: string;
  hostIp: string;
  containers: DockerContainerInfo[];
}

export interface ProviderDiagnostics {
  lastPollAt: number | null;
  lastPollError: string | null;
  /** Maps an API path (e.g. `/nodes/pve1/status`) to its last error message. */
  endpointErrors: Record<string, string>;
}

/**
 * Emits the live telemetry loop (snapshots + derived notifications) to the
 * WebSocket broadcaster. Both the mock Simulator and the real Proxmox poller
 * satisfy this structurally, so `ws/` never cares which source is active.
 */
export interface TelemetryBroadcaster {
  onTick(listener: (snapshots: MetricSnapshot[]) => void): void;
  onNotifications(listener: (notifications: Notification[]) => void): void;
}

export interface NotificationsProvider {
  list(limit: number, offset?: number): Notification[];
  unreadCount(): number;
  markRead(ids: string[]): void;
  markAllRead(): void;
  /** engine pushes new notifications here at boot of each tick */
  ingest(n: Notification): void;
  clear(): void;
}
