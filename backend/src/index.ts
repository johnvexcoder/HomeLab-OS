import http from 'node:http';
import { createApp } from './app';
import { Simulator, seedHistory } from './services/simulator';
import { MockMetricsProvider } from './providers/mockMetricsProvider';
import { ProxmoxMetricsProvider } from './providers/proxmoxMetricsProvider';
import { DockerMetricsProvider } from './providers/dockerMetricsProvider';
import { CompositeProvider } from './providers/compositeProvider';
import { MockNotificationsProvider } from './providers/mockNotificationsProvider';
import type { MetricsProvider, TelemetryBroadcaster } from './providers/types';
import { attachWebSocket } from './ws';
import { config } from './config';
import { getDb, insertMetrics, queryMetrics, countMetrics } from './db/database';
import { bootstrapSecurity } from './security/boot';
import { startBackupScheduler } from './services/backupScheduler';
import { notifyDispatcher } from './services/notifyDispatch';

async function bootstrap(): Promise<void> {
  getDb();
  bootstrapSecurity();

  let metrics: MetricsProvider;
  let broadcaster: TelemetryBroadcaster;

  if (config.mockMode) {
    // Pre-seed historical data so charts are populated from first boot.
    if (countMetrics() < 1000) {
      console.log('[homelab] seeding historical telemetry…');
      const seeded = seedHistory({ insertMetrics, queryMetrics });
      console.log(`[homelab] seeded ${seeded} history points`);
    }

    const simulator = new Simulator();
    simulator.start();
    metrics = new MockMetricsProvider(simulator.engine);
    broadcaster = simulator;
  } else {
    const proxmox = new ProxmoxMetricsProvider();
    await proxmox.start();
    console.log(`[homelab] proxmox provider active (${config.proxmox.host})`);
    metrics = proxmox;
    broadcaster = proxmox;

    if (config.docker.enabled) {
      const docker = new DockerMetricsProvider();
      await docker.start();
      console.log(`[homelab] docker provider active (${config.docker.host})`);
      const composite = new CompositeProvider(proxmox, docker);
      metrics = composite;
      broadcaster = composite;
    }
  }

  const notifications = new MockNotificationsProvider();

  // Ingest live notifications into the provider + dispatch to external channels.
  broadcaster.onNotifications((items) => {
    items.forEach((n) => notifications.ingest(n));
    notifyDispatcher.dispatchNotifications(items);
  });

  // Detect server state transitions (online/offline/degraded) and notify.
  broadcaster.onTick((snapshots) => {
    notifyDispatcher.checkStateChanges(snapshots);
  });

  const app = createApp({ metrics, notifications });
  const server = http.createServer(app);

  attachWebSocket(server, broadcaster);
  startBackupScheduler();

  server.listen(config.port, config.host, () => {
    console.log(`[homelab] backend listening on http://${config.host}:${config.port}`);
    console.log(`[homelab] mock mode: ${config.mockMode}`);
    console.log(`[homelab] telemetry interval: ${config.telemetryIntervalMs}ms`);
    console.log(`[homelab] ws endpoint: ws://${config.host}:${config.port}/ws`);
  });
}

bootstrap().catch((err) => {
  console.error('[homelab] fatal startup error', err);
  process.exit(1);
});
