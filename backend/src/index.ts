import http from 'node:http';
import crypto from 'node:crypto';
import { createApp } from './app';
import { Simulator, seedHistory } from './services/simulator';
import { MockMetricsProvider } from './providers/mockMetricsProvider';
import { ProxmoxMetricsProvider } from './providers/proxmoxMetricsProvider';
import { DockerMetricsProvider } from './providers/dockerMetricsProvider';
import { CompositeProvider } from './providers/compositeProvider';
import { MockNotificationsProvider } from './providers/mockNotificationsProvider';
import type { MetricsProvider, TelemetryBroadcaster } from './providers/types';
import type { Notification } from './types';
import { attachWebSocket } from './ws';
import { config } from './config';
import { getDb, insertMetrics, queryMetrics, countMetrics } from './db/database';
import { bootstrapSecurity } from './security/boot';
import { startBackupScheduler } from './services/backupScheduler';
import { notifyDispatcher } from './services/notifyDispatch';
import { registerNotificationBus } from './services/notificationBus';
import { startSslChecker } from './services/sslChecker';
import { startUptimeKumaMonitor } from './services/uptimeKumaMonitor';
import { startNetworkBandwidth } from './services/networkBandwidth';

async function bootstrap(): Promise<void> {
  getDb();
  bootstrapSecurity();

  let metrics: MetricsProvider;
  let broadcaster: TelemetryBroadcaster;

  // Notifications provider — created early so Docker state-change callbacks
  // can ingest + dispatch directly without going through the broadcaster pipeline.
  const notifications = new MockNotificationsProvider();

  /** Push a notification to the database, Telegram/Email, and WebSocket clients. */
  const dispatchNotification = (n: Notification): void => {
    notifications.ingest(n);
    notifyDispatcher.dispatchNotifications([n]);
    wsBroadcastNotifications([n]);
  };

  // Will be wired once attachWebSocket() returns; safe to call before that
  // because the array starts empty — calls are buffered.
  const pendingWsNotifications: Notification[][] = [];
  let wsBroadcastNotifications = (items: Notification[]) => { pendingWsNotifications.push(items); };

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
      docker.onContainerStateChange = (name, image, event) => {
        const severity: 'critical' | 'success' = event === 'stopped' ? 'critical' : 'success';
        const title = event === 'stopped' ? 'Container Crashed' : 'Container Restarted';
        const message = event === 'stopped'
          ? `Docker container "${name}" has stopped unexpectedly.\nImage: ${image}`
          : `Docker container "${name}" is back online.\nImage: ${image}`;

        const n: Notification = {
          id: `ntf-docker-${event}-${name}-${crypto.randomUUID()}`,
          title,
          message,
          severity,
          timestamp: Date.now(),
          read: false,
          serverId: `docker-${name}`,
        };

        dispatchNotification(n);
      };
      await docker.start();
      console.log(`[homelab] docker provider active (${config.docker.host})`);
      const composite = new CompositeProvider(proxmox, docker);
      metrics = composite;
      broadcaster = composite;
    }
  }

  // Ingest live notifications from the broadcaster (Proxmox) + dispatch to
  // external channels. Docker notifications bypass this — they go through
  // dispatchNotification() directly.
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

  const { broadcastNotifications } = attachWebSocket(server, broadcaster);
  wsBroadcastNotifications = broadcastNotifications;

  // Flush any Docker notifications that arrived before the WS handle was ready.
  for (const batch of pendingWsNotifications) {
    broadcastNotifications(batch);
  }

  // Wire the shared notification bus so agent routes can dispatch notifications
  registerNotificationBus(
    (n) => notifications.ingest(n),
    (items) => notifyDispatcher.dispatchNotifications(items),
    (items) => broadcastNotifications(items),
  );

  startBackupScheduler();
  startSslChecker();
  startUptimeKumaMonitor();
  startNetworkBandwidth();

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
