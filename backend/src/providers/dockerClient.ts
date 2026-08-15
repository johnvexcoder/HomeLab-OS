import http from 'node:http';

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
}
