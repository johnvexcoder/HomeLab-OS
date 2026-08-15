import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { rmSync } from 'node:fs';
import { CompositeProvider } from '../providers/compositeProvider';
import { DockerClient } from '../providers/dockerClient';
import type { MetricsProvider, TelemetryBroadcaster } from '../providers/types';
import type { DockerMetricsProvider } from '../providers/dockerMetricsProvider';
import type { MetricSnapshot, NetworkNode, ServerRuntime } from '../types';

function makePrimary(guestLabels: string[]): MetricsProvider & TelemetryBroadcaster {
  const nodes: NetworkNode[] = [
    { id: 'internet', label: 'Internet', type: 'internet', status: 'online', x: 6, y: 50, health: 100 },
    { id: 'pve', label: 'pve0', type: 'hypervisor', status: 'online', x: 30, y: 30, health: 100 },
  ];
  guestLabels.forEach((label, i) =>
    nodes.push({
      id: `g${i}`,
      label,
      type: 'container',
      status: 'online',
      x: 38,
      y: 46,
      parentId: 'pve',
      health: 100,
    }),
  );
  const tick = (_snapshots: MetricSnapshot[]): void => {};
  const base = {
    getNetwork: () => ({ nodes, links: [] }),
    getQuickStats: () => [{ id: 'containers', label: 'VMs & CTs', value: guestLabels.length, unit: '', delta: 0, tone: 'neutral' as const }],
    getSourceName: () => 'proxmox',
    getDiagnostics: () => ({ lastPollAt: 1, lastPollError: null, endpointErrors: {} }),
    getServers: (): ServerRuntime[] => [],
    getServer: () => undefined,
    onTick: (l: (snapshots: MetricSnapshot[]) => void): void => void tick,
  };
  return base as unknown as MetricsProvider & TelemetryBroadcaster;
}

const HOST_RUNTIME: ServerRuntime = {
  spec: {
    id: 'docker-docker01',
    serverId: 'uuid-1',
    hostname: 'docker01',
    name: 'docker01',
    logo: '🐳',
    os: 'Ubuntu 22.04 / 6.2.0',
    description: 'Docker host',
    role: 'docker',
    capabilities: ['containerization'],
    clusterId: null,
    ip: '',
    location: 'Docker',
    cpuModel: 'Docker 27.0 (x86_64)',
    cpuCores: 4,
    ramTotalGb: 16,
    diskTotalGb: 0,
    sensors: [],
    profile: {
      baseCpu: 12,
      cpuAmplitude: 0,
      cpuNoise: 0,
      baseRamGb: 3.1,
      ramDriftGb: 0,
      baseTemp: 0,
      tempVariance: 0,
      baseNetUpMbps: 0,
      baseNetDownMbps: 0,
      netBurstRate: 0,
      processes: 5,
      containers: 3,
      vms: 0,
      reliability: 1,
    },
  },
  status: 'online',
  reachability: 'accessible',
  health: 100,
  load: 0.12,
  uptimeSeconds: 3600,
  cpu: 12,
  ramUsedGb: 3.1,
  diskUsedGb: 2.4,
  tempC: 0,
  netUpMbps: 0.1,
  netDownMbps: 0.4,
  processes: 5,
  lastSeen: 1,
  sensors: [],
  history: { cpu: [12], ram: [19.4], disk: [2.4], temp: [0], netUp: [0.1], netDown: [0.4], load: [0.12] },
};

function fakeDocker(containers: Array<{ id: string; name: string; running: boolean }>, error?: string): DockerMetricsProvider {
  return {
    getContainers: () => containers,
    getHostRuntime: () => (error ? null : HOST_RUNTIME),
    getHostSnapshot: () =>
      error
        ? null
        : ({
            serverId: 'docker-docker01',
            timestamp: 1,
            cpu: 12,
            cpuCores: 4,
            ramUsedGb: 3.1,
            ramTotalGb: 16,
            diskUsedGb: 2.4,
            diskTotalGb: 0,
            tempC: 0,
            netUpMbps: 0.1,
            netDownMbps: 0.4,
            load: 0.12,
            uptimeSeconds: 3600,
            processes: 5,
            status: 'online',
            reachability: 'accessible',
            health: 100,
            sensors: [],
          }) as unknown as MetricSnapshot,
    getSourceName: () => (error ? 'docker (error)' : 'docker (socket)'),
    getDiagnostics: () => ({
      lastPollAt: error ? null : 2,
      lastPollError: error ?? null,
      endpointErrors: error ? { '/var/run/docker.sock — docker daemon': error } : {},
    }),
  } as unknown as DockerMetricsProvider;
}

test('composite: no docker containers leaves topology untouched', () => {
  const composite = new CompositeProvider(makePrimary(['docker01']), fakeDocker([]));
  const net = composite.getNetwork();
  assert.equal(net.nodes.length, 3);
  assert.equal(net.links.length, 0);
});

test('composite: containers attach under the Docker-hosting guest (docker01)', () => {
  const composite = new CompositeProvider(makePrimary(['docker01', 'nas']), fakeDocker([
    { id: 'abc123def456', name: 'portainer', running: true },
    { id: 'z99z88y77y', name: 'redis', running: false },
  ]));
  const net = composite.getNetwork();
  const dockerNodes = net.nodes.filter((n) => n.type === 'docker');
  assert.equal(dockerNodes.length, 2);
  assert.ok(dockerNodes.every((n) => n.parentId === 'g0'));
  assert.equal(dockerNodes.find((n) => n.label === 'portainer')?.status, 'online');
  assert.equal(dockerNodes.find((n) => n.label === 'redis')?.status, 'offline');
  assert.equal(net.links.length, 2);

  const stats = composite.getQuickStats();
  assert.equal(stats.find((s) => s.id === 'containers')?.value, 3); // 2 guests + 1 running container
});

test('composite: without a matching guest, containers attach under the first guest', () => {
  const composite = new CompositeProvider(makePrimary(['nas']), fakeDocker([{ id: 'x', name: 'web', running: true }]));
  const dockerNodes = composite.getNetwork().nodes.filter((n) => n.type === 'docker');
  assert.equal(dockerNodes[0].parentId, 'g0');
});

test('composite: without any guest, containers attach under the hypervisor', () => {
  const composite = new CompositeProvider(makePrimary([]), fakeDocker([{ id: 'x', name: 'web', running: true }]));
  const dockerNodes = composite.getNetwork().nodes.filter((n) => n.type === 'docker');
  assert.equal(dockerNodes[0].parentId, 'pve');
});

test('composite: getDiagnostics merges docker reachability errors', () => {
  const composite = new CompositeProvider(makePrimary(['docker01']), fakeDocker([], 'connect ENOENT /var/run/docker.sock'));
  const diag = composite.getDiagnostics();
  assert.equal(diag.lastPollError, 'connect ENOENT /var/run/docker.sock');
  assert.ok(Object.keys(diag.endpointErrors).some((k) => k.includes('docker daemon')));
});

test('composite: docker host appears as its own server in the fleet', () => {
  const composite = new CompositeProvider(makePrimary(['docker01']), fakeDocker([{ id: 'x', name: 'web', running: true }]));
  const servers = composite.getServers();
  assert.ok(servers.some((s) => s.spec.id === 'docker-docker01'));
  assert.equal(composite.getServer('docker-docker01')?.spec.hostname, 'docker01');
});

test('composite: docker host server disappears when the provider is failing', () => {
  const composite = new CompositeProvider(makePrimary([]), fakeDocker([], 'connect ENOENT /var/run/docker.sock'));
  assert.ok(!composite.getServers().some((s) => s.spec.id === 'docker-docker01'));
});

test('composite: host snapshot is appended to telemetry ticks', () => {
  let primaryListener: ((snapshots: MetricSnapshot[]) => void) | undefined;
  const primary = makePrimary([]) as unknown as MetricsProvider & TelemetryBroadcaster & { onTick: (l: (s: MetricSnapshot[]) => void) => void };
  primary.onTick = (l) => {
    primaryListener = l;
  };
  const composite = new CompositeProvider(primary, fakeDocker([{ id: 'x', name: 'web', running: true }]));
  const received: MetricSnapshot[][] = [];
  composite.onTick((snapshots) => received.push(snapshots));
  primaryListener?.([{ serverId: 'pve-pve0' } as unknown as MetricSnapshot]);
  assert.equal(received.length, 1);
  assert.deepEqual(
    received[0].map((s) => s.serverId),
    ['pve-pve0', 'docker-docker01'],
  );
});

test('docker client: talks to a real unix-socket daemon and parses containers', async (t) => {
  const socketPath = path.join(os.tmpdir(), `homelab-docker-test-${Date.now()}.sock`);
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/_ping')) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
      return;
    }
    if (req.url?.startsWith('/containers/json')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify([
          { Id: 'abcdef1234567890deadbeef', Names: ['/jellyfin'], State: 'running', Image: 'lscr.io/linuxserver/jellyfin:latest' },
          { Id: '1234567890abcdef12345678', Names: ['/uptime-kuma', '/uptime-kuma2'], State: 'exited', Image: 'louislam/uptime-kuma:1' },
        ]),
      );
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"message":"not found"}');
  });

  try {
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    t.after(() => {
      server.close();
      rmSync(socketPath, { force: true });
    });

    const client = new DockerClient(socketPath);
    await client.ping();
    const containers = await client.listContainers();
    assert.equal(containers.length, 2);
    assert.deepEqual(
      containers.map((c) => ({ name: c.name, running: c.running, image: c.image })),
      [
        { name: 'jellyfin', running: true, image: 'lscr.io/linuxserver/jellyfin:latest' },
        { name: 'uptime-kuma,uptime-kuma2', running: false, image: 'louislam/uptime-kuma:1' },
      ],
    );
  } finally {
    server.close();
    rmSync(socketPath, { force: true });
  }
});

test('docker client: non-2xx statuses surface as errors', async (t) => {
  const socketPath = path.join(os.tmpdir(), `homelab-docker-test-${Date.now()}.sock`);
  const server = http.createServer((_req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end('{"message":"boom"}');
  });

  try {
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    t.after(() => {
      server.close();
      rmSync(socketPath, { force: true });
    });

    const client = new DockerClient(socketPath);
    await assert.rejects(() => client.listContainers(), /HTTP 500/);
  } finally {
    server.close();
    rmSync(socketPath, { force: true });
  }
});

test('docker client: parses host info, container stats and disk usage', async (t) => {
  const socketPath = path.join(os.tmpdir(), `homelab-docker-test-${Date.now()}.sock`);
  const server = http.createServer((req, res) => {
    const respond = (body: unknown): void => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.url === '/info') {
      respond({ Name: 'docker01', NCPU: 4, MemTotal: 16_000_000_000, OperatingSystem: 'Ubuntu 22.04', KernelVersion: '6.2.0', ServerVersion: '27.0.1', Architecture: 'x86_64' });
      return;
    }
    if (req.url?.startsWith('/containers/abc/stats')) {
      respond({
        cpu_stats: { cpu_usage: { total_usage: 1000 }, system_cpu_usage: 2000, online_cpus: 4 },
        memory_stats: { usage: 3_100_000_000 },
        networks: { eth0: { rx_bytes: 800, tx_bytes: 200 } },
      });
      return;
    }
    if (req.url === '/system/df') {
      respond({ LayersSize: 1_000_000_000, Images: [], Containers: [{ Size: 500_000_000 }], Volumes: [{ UsageData: { Size: 300_000_000 } }], BuildCache: [{ Size: 200_000_000 }] });
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"message":"not found"}');
  });

  try {
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    t.after(() => {
      server.close();
      rmSync(socketPath, { force: true });
    });

    const client = new DockerClient(socketPath);
    const info = await client.getInfo();
    assert.equal(info.name, 'docker01');
    assert.equal(info.ncpu, 4);
    assert.equal(info.memTotal, 16_000_000_000);
    assert.equal(info.dockerVersion, '27.0.1');

    const stats = await client.getContainerStats('abc');
    assert.equal(stats?.cpuTotal, 1000);
    assert.equal(stats?.systemCpu, 2000);
    assert.equal(stats?.memUsed, 3_100_000_000);
    assert.equal(stats?.netRxBytes, 800);

    const disk = await client.getDiskUsage();
    assert.equal(disk.used, 2_000_000_000); // layers + containers + volumes + build cache
  } finally {
    server.close();
    rmSync(socketPath, { force: true });
  }
});
