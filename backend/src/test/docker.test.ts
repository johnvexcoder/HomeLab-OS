import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CompositeProvider } from '../providers/compositeProvider';
import type { MetricsProvider, TelemetryBroadcaster } from '../providers/types';
import type { DockerMetricsProvider } from '../providers/dockerMetricsProvider';
import type { NetworkNode } from '../types';

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
  const base = {
    getNetwork: () => ({ nodes, links: [] }),
    getQuickStats: () => [{ id: 'containers', label: 'VMs & CTs', value: guestLabels.length, unit: '', delta: 0, tone: 'neutral' as const }],
    getSourceName: () => 'proxmox',
    getDiagnostics: () => ({ lastPollAt: 1, lastPollError: null, endpointErrors: {} }),
  };
  return base as unknown as MetricsProvider & TelemetryBroadcaster;
}

function fakeDocker(containers: Array<{ id: string; name: string; running: boolean }>, error?: string): DockerMetricsProvider {
  return {
    getContainers: () => containers,
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
