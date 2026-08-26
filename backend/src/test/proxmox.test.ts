/**
 * ProxmoxMetricsProvider resilience tests.
 * Reproduces a crash found in production: PVE's /nodes endpoint omits
 * mem/cpu/disk/uptime for nodes that are OFFLINE, which produced NaN
 * metrics and a NOT NULL constraint crash in SQLite.
 *
 * Run: npm test (backend)
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'homelab-proxmox-'));

let provider: {
  start: () => Promise<void>;
  stop: () => void;
  getServers: () => any[];
};

before(async () => {
  process.env.DATA_DIR = DATA_DIR;
  process.env.MOCK_MODE = 'false';
  process.env.PROXMOX_HOST = 'pve.test:8006';
  process.env.PROXMOX_TOKEN_ID = 'root@pam!test';
  process.env.PROXMOX_TOKEN_SECRET = 'test-secret';
  process.env.PROXMOX_VERIFY_TLS = 'false';
  process.env.PROXMOX_POLL_INTERVAL_MS = '60000';

  const { ProxmoxMetricsProvider } = await import('../providers/proxmoxMetricsProvider');
  const p = new ProxmoxMetricsProvider() as unknown as {
    start: () => Promise<void>;
    stop: () => void;
    getServers: () => any[];
    api: (path: string) => Promise<unknown>;
  };

  // Stub the REST layer: one ONLINE node with full metrics, one OFFLINE
  // node that PVE returns with NO mem/cpu/disk fields at all.
  p.api = async (req: string) => {
    if (req === '/nodes') {
      return [
        {
          node: 'pve-online',
          status: 'online',
          cpu: 0.25,
          maxcpu: 4,
          mem: 17179869184,
          maxmem: 17179869184,
          disk: 8589934592,
          maxdisk: 17179869184,
          uptime: 3600,
          level: '',
          id: 'node/pve-online',
        },
        { node: 'pve-offline', status: 'offline', maxcpu: 8, level: '', id: 'node/pve-offline' },
      ];
    }
    const name = req.split('/')[2];
    if (req.endsWith('/status')) return name === 'pve-online' ? { kversion: '6.5.13' } : {};
    if (req.endsWith('/qemu')) return [];
    if (req.endsWith('/lxc')) return [];
    if (req.includes('rrddata')) return [];
    if (req.endsWith('/sensors')) return [];
    if (req.endsWith('/network')) return [];
    if (req.endsWith('/storage')) return [];
    throw new Error(`unexpected path ${req}`);
  };

  provider = p;
});

after(() => {
  provider?.stop();
});

describe('ProxmoxMetricsProvider offline-node resilience', () => {
  it('discovers the offline node and persists only finite metrics', async () => {
    await provider.start();

    const offline = provider.getServers().find((s) => s.spec.hostname === 'pve-offline');
    assert.ok(offline, 'offline node should still be discovered');
    assert.equal(offline.status, 'offline');
    assert.ok(Number.isFinite(offline.ramUsedGb), `ramUsedGb must be finite, got ${offline.ramUsedGb}`);
    assert.ok(Number.isFinite(offline.diskUsedGb), `diskUsedGb must be finite, got ${offline.diskUsedGb}`);
    assert.ok(Number.isFinite(offline.cpu), `cpu must be finite, got ${offline.cpu}`);
    assert.ok(Number.isFinite(offline.spec.ramTotalGb), `ramTotalGb must be finite, got ${offline.spec.ramTotalGb}`);
    assert.ok(Number.isFinite(offline.spec.diskTotalGb), `diskTotalGb must be finite, got ${offline.spec.diskTotalGb}`);

    const { countMetrics } = await import('../db/database');
    assert.ok(countMetrics() > 0, 'metrics should have been persisted');
  });
});
