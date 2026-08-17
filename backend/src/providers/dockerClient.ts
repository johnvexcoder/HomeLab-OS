import http from 'node:http';
import { execSync } from 'node:child_process';

/**
 * Minimal Docker Engine API client. Talks to the daemon over a unix socket
 * (e.g. /var/run/docker.sock) or a tcp://host:port endpoint — no TLS support
 * (exposing a Docker daemon over TLS is out of scope; use the socket).
 */

export interface DockerContainer {
  id: string;
  name: string;
  running: boolean;
  image: string;
  /** Live network throughput since the previous poll (Mb/s), when known. */
  netUpMbps?: number;
  netDownMbps?: number;
}

export interface DockerHostInfo {
  name: string;
  ncpu: number;
  memTotal: number;
  os: string;
  kernel: string;
  dockerVersion: string;
  architecture: string;
}

export interface DockerContainerStats {
  id: string;
  cpuTotal: number;
  systemCpu: number;
  onlineCpus: number;
  memUsed: number;
  netRxBytes: number;
  netTxBytes: number;
}

export interface DockerDiskUsage {
  used: number;
}

export class DockerClient {
  constructor(private readonly host: string) {}

  private request<T>(path: string): Promise<{ statusCode: number; body: T | null }> {
    return new Promise((resolve, reject) => {
      const isTcp = /^tcp:\/\//i.test(this.host);
      const options: http.RequestOptions = {
        method: 'GET',
        path,
        timeout: 10_000,
        headers: { Accept: 'application/json' },
      };
      if (isTcp) {
        const url = new URL(this.host);
        options.host = url.hostname;
        options.port = url.port ? Number(url.port) : 2375;
      } else {
        options.socketPath = this.host;
      }

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let body: T | null = null;
          try {
            body = data ? (JSON.parse(data) as T) : null;
          } catch {
            body = null;
          }
          resolve({ statusCode: res.statusCode ?? 0, body });
        });
      });
      req.on('error', (err) => reject(err));
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.end();
    });
  }

  /** Verify the daemon is reachable and sane. */
  async ping(): Promise<void> {
    const { statusCode } = await this.request<unknown>('/_ping');
    if (statusCode >= 400) throw new Error(`Docker daemon returned HTTP ${statusCode}`);
  }

  async listContainers(): Promise<DockerContainer[]> {
    const { statusCode, body } = await this.request<Array<Record<string, unknown>>>('/containers/json?all=1');
    if (statusCode >= 400) throw new Error(`Docker containers returned HTTP ${statusCode}`);
    const raw = body ?? [];
    return raw.map((c) => {
      const id = typeof c.Id === 'string' ? c.Id.slice(0, 12) : 'unknown';
      const names = Array.isArray(c.Names) ? (c.Names as string[]) : [];
      const name = names.map((n) => n.replace(/^\//, '')).join(',') || id;
      return {
        id,
        name,
        running: c.State === 'running',
        image: typeof c.Image === 'string' ? c.Image : '',
      };
    });
  }

  /** Host-level capacity + identity from /info. */
  async getInfo(): Promise<DockerHostInfo> {
    const { statusCode, body } = await this.request<Record<string, unknown>>('/info');
    if (statusCode >= 400) throw new Error(`Docker info returned HTTP ${statusCode}`);
    const raw = body ?? {};
    return {
      name: typeof raw.Name === 'string' ? raw.Name : 'docker',
      ncpu: typeof raw.NCPU === 'number' ? raw.NCPU : 1,
      memTotal: typeof raw.MemTotal === 'number' ? raw.MemTotal : 0,
      os: typeof raw.OperatingSystem === 'string' ? raw.OperatingSystem : '',
      kernel: typeof raw.KernelVersion === 'string' ? raw.KernelVersion : '',
      dockerVersion: typeof raw.ServerVersion === 'string' ? raw.ServerVersion : '',
      architecture: typeof raw.Architecture === 'string' ? raw.Architecture : '',
    };
  }

  /** Single-shot usage snapshot for one container (no CPU delta — caller computes). */
  async getContainerStats(id: string): Promise<DockerContainerStats | null> {
    const { statusCode, body } = await this.request<Record<string, unknown>>(`/containers/${id}/stats?stream=false`);
    if (statusCode >= 400) return null;
    const raw = body ?? {};
    const cpu = raw.cpu_stats as Record<string, unknown> | undefined;
    const cpuUsage = cpu?.cpu_usage as Record<string, unknown> | undefined;
    const mem = raw.memory_stats as Record<string, unknown> | undefined;
    const nets = (raw.networks as Record<string, Record<string, unknown>> | undefined) ?? {};
    let rx = 0;
    let tx = 0;
    for (const n of Object.values(nets)) {
      rx += typeof n.rx_bytes === 'number' ? n.rx_bytes : 0;
      tx += typeof n.tx_bytes === 'number' ? n.tx_bytes : 0;
    }
    return {
      id,
      cpuTotal: typeof cpuUsage?.total_usage === 'number' ? cpuUsage.total_usage : 0,
      systemCpu: typeof cpu?.system_cpu_usage === 'number' ? cpu.system_cpu_usage : 0,
      onlineCpus: typeof cpu?.online_cpus === 'number' ? cpu.online_cpus : 1,
      memUsed: typeof mem?.usage === 'number' ? mem.usage : 0,
      netRxBytes: rx,
      netTxBytes: tx,
    };
  }

  /** Docker-owned disk footprint (layers + containers + volumes). */
  async getDiskUsage(): Promise<DockerDiskUsage> {
    const { statusCode, body } = await this.request<Record<string, unknown>>('/system/df');
    if (statusCode >= 400) throw new Error(`Docker df returned HTTP ${statusCode}`);
    const raw = body ?? {};
    const sum = (arr: unknown, key: string): number =>
      Array.isArray(arr)
        ? arr.reduce((acc, item) => {
            const it = item as Record<string, unknown>;
            const direct = typeof it[key] === 'number' ? (it[key] as number) : 0;
            const usage = it.UsageData as Record<string, unknown> | undefined;
            const nested = typeof usage?.Size === 'number' ? usage.Size : 0;
            return acc + direct + nested;
          }, 0)
        : 0;
    const layers = typeof raw.LayersSize === 'number' ? raw.LayersSize : 0;
    const containers = sum(raw.Containers, 'Size');
    const volumes = sum(raw.Volumes, 'Size');
    const buildCache = sum(raw.BuildCache, 'Size');
    return { used: layers + containers + volumes + buildCache };
  }

  /** Total filesystem size in bytes (reads from /proc/1/mounts + statvfs or falls back to `df`). */
  getDiskTotalBytes(): number {
    try {
      const out = execSync('df -B1 / 2>/dev/null | tail -1', { encoding: 'utf-8', timeout: 3000 });
      const parts = out.trim().split(/\s+/);
      const total = Number(parts[1]);
      return Number.isFinite(total) && total > 0 ? total : 0;
    } catch {
      return 0;
    }
  }
}
