import type {
  BootStats,
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
 * The contract every backend integration (Proxmox, Docker API, Node Exporter,
 * Uptime Kuma…) must implement. The mock provider is the default implementation.
 */
export interface MetricsProvider {
  getServers(): ServerRuntime[];
  getServer(id: string): ServerRuntime | undefined;
  getHistory(serverId: string, range: HistoryRange): HistoryPoint[];
  getGlobalHealth(): GlobalHealth;
  getQuickStats(): QuickStat[];
  getNetwork(): { nodes: NetworkNode[]; links: NetworkLink[] };
  getBootStats(): BootStats;
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
