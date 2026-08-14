import http from 'node:http';
import { createApp } from './app';
import { Simulator, seedHistory } from './services/simulator';
import { MockMetricsProvider } from './providers/mockMetricsProvider';
import { MockNotificationsProvider } from './providers/mockNotificationsProvider';
import { attachWebSocket } from './ws';
import { config } from './config';
import { getDb, insertMetrics, queryMetrics, countMetrics } from './db/database';
import { bootstrapSecurity } from './security/boot';
import { startBackupScheduler } from './services/backupScheduler';

async function bootstrap(): Promise<void> {
  getDb();
  bootstrapSecurity();

  // Pre-seed historical data so charts are populated from first boot.
  if (countMetrics() < 1000) {
    console.log('[homelab] seeding historical telemetry…');
    const seeded = seedHistory({ insertMetrics, queryMetrics });
    console.log(`[homelab] seeded ${seeded} history points`);
  }

  const simulator = new Simulator();
  simulator.start();

  const metrics = new MockMetricsProvider(simulator.engine);
  const notifications = new MockNotificationsProvider();

  // Ingest live notifications into the provider.
  simulator.onNotifications((items) => items.forEach((n) => notifications.ingest(n)));

  const app = createApp({ simulator, metrics, notifications });
  const server = http.createServer(app);

  attachWebSocket(server, simulator);
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
