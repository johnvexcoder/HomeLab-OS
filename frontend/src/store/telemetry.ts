import { create } from 'zustand';
import type { MetricSnapshot, ServerRuntime, ServerStatus, GlobalHealth } from '@/types';

interface TelemetryState {
  servers: Record<string, ServerRuntime>;
  snapshots: Record<string, MetricSnapshot>;
  lastTickAt: number | null;
  connected: boolean;
  /** ring buffers keyed by serverId for sparklines */
  sparklines: Record<string, Record<'cpu' | 'ram' | 'disk' | 'temp' | 'netUp' | 'netDown' | 'load', number[]>>;

  applySnapshots: (snapshots: MetricSnapshot[]) => void;
  hydrate: (servers: ServerRuntime[]) => void;
  patchServer: (server: ServerRuntime) => void;
  setConnected: (connected: boolean) => void;
}

const HISTORY_LEN = 90;

function emptyRings(): Record<'cpu' | 'ram' | 'disk' | 'temp' | 'netUp' | 'netDown' | 'load', number[]> {
  return { cpu: [], ram: [], disk: [], temp: [], netUp: [], netDown: [], load: [] };
}

export const useTelemetryStore = create<TelemetryState>((set, get) => ({
  servers: {},
  snapshots: {},
  lastTickAt: null,
  connected: false,
  sparklines: {},

  applySnapshots: (snapshots) =>
    set((state) => {
      const servers = { ...state.servers };
      const snapMap = { ...state.snapshots };
      const sparklines = { ...state.sparklines };

      for (const snap of snapshots) {
        const runtime = servers[snap.serverId];
        if (!runtime) continue;

        snapMap[snap.serverId] = snap;

        servers[snap.serverId] = {
          ...runtime,
          status: snap.status,
          reachability: snap.reachability,
          health: snap.health,
          load: snap.load,
          uptimeSeconds: snap.uptimeSeconds,
          cpu: snap.cpu,
          ramUsedGb: snap.ramUsedGb,
          diskUsedGb: snap.diskUsedGb,
          tempC: snap.tempC,
          netUpMbps: snap.netUpMbps,
          netDownMbps: snap.netDownMbps,
          processes: snap.processes,
          lastSeen: snap.timestamp,
          sensors: snap.sensors,
        };

        const rings = sparklines[snap.serverId] ?? emptyRings();
        sparklines[snap.serverId] = {
          cpu: [...rings.cpu.slice(-HISTORY_LEN), snap.cpu],
          ram: [...rings.ram.slice(-HISTORY_LEN), (snap.ramUsedGb / snap.ramTotalGb) * 100],
          disk: [...rings.disk.slice(-HISTORY_LEN), (snap.diskUsedGb / snap.diskTotalGb) * 100],
          temp: [...rings.temp.slice(-HISTORY_LEN), snap.tempC],
          netUp: [...rings.netUp.slice(-HISTORY_LEN), snap.netUpMbps],
          netDown: [...rings.netDown.slice(-HISTORY_LEN), snap.netDownMbps],
          load: [...rings.load.slice(-HISTORY_LEN), snap.load],
        };
      }

      return { servers, snapshots: snapMap, sparklines, lastTickAt: Date.now() };
    }),

  hydrate: (servers) =>
    set((state) => {
      const map: Record<string, ServerRuntime> = {};
      for (const s of servers) map[s.spec.id] = s;
      return { servers: { ...state.servers, ...map } };
    }),

  patchServer: (server) =>
    set((state) => ({
      servers: { ...state.servers, [server.spec.id]: server },
    })),

  setConnected: (connected) => set({ connected }),
}));

export function selectServers(state: TelemetryState): ServerRuntime[] {
  return Object.values(state.servers);
}

export function selectServer(state: TelemetryState, id: string): ServerRuntime | undefined {
  return state.servers[id];
}

export function serverStatusCount(servers: ServerRuntime[], status: ServerStatus): number {
  return servers.filter((s) => s.status === status).length;
}

export function globalHealthFromServers(servers: ServerRuntime[]): GlobalHealth {
  if (servers.length === 0) {
    return { score: 0, status: 'offline', totalServers: 0, onlineServers: 0, degradedServers: 0, offlineServers: 0, activeAlerts: 0, avgCpu: 0, avgRam: 0, totalUptimePercent: 0 };
  }
  const online = serverStatusCount(servers, 'online');
  const degraded = serverStatusCount(servers, 'degraded');
  const offline = serverStatusCount(servers, 'offline');
  const score = servers.reduce((a, s) => a + s.health, 0) / servers.length;
  const avgCpu = servers.reduce((a, s) => a + s.cpu, 0) / servers.length;
  const avgRam = servers.reduce((a, s) => a + (s.ramUsedGb / s.spec.ramTotalGb) * 100, 0) / servers.length;
  return {
    score: Math.round(score * 10) / 10,
    status: offline > 0 ? 'offline' : degraded > 0 ? 'degraded' : 'online',
    totalServers: servers.length,
    onlineServers: online,
    degradedServers: degraded,
    offlineServers: offline,
    activeAlerts: 0,
    avgCpu: Math.round(avgCpu * 10) / 10,
    avgRam: Math.round(avgRam * 10) / 10,
    totalUptimePercent: Math.round((online / servers.length) * 1000) / 10,
  };
}
