import { Router, type Request, type Response } from 'express';
import type { MetricsProvider } from '../providers/types';
import { MockNotificationsProvider } from '../providers/mockNotificationsProvider';
import type { HistoryRange } from '../providers/types';
import type { ServerRuntime } from '../types';
import { config } from '../config';
import { NETWORK_NODE_ICONS } from '../mock-data/network';
import { requireAuth, requirePermission, requireAuthOrGuest } from '../security/middleware';
import { featureEnabled, applySensorFlags } from '../security/features';
import { listQuickActions } from '../services/quickActions';

export interface ApiContext {
  metrics: MetricsProvider;
  notifications: MockNotificationsProvider;
}

const RANGES: HistoryRange[] = ['15m', '1h', '6h', '24h'];

function stripSensors(server: ServerRuntime): ServerRuntime {
  return { ...server, sensors: applySensorFlags(server.sensors) };
}

export function createRouter(ctx: ApiContext): Router {
  const router = Router();
  const { metrics, notifications } = ctx;

  router.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      mockMode: config.mockMode,
      provider: metrics.getSourceName?.() ?? (config.mockMode ? 'mock' : 'proxmox'),
      lastPollError: metrics.getLastPollError?.() ?? null,
      bootStats: metrics.getBootStats(),
      timestamp: Date.now(),
    });
  });

  router.get('/servers', requireAuthOrGuest('servers.view', 'serverStatus'), (_req: Request, res: Response) => {
    res.json(metrics.getServers().map(stripSensors));
  });

  router.get('/clusters', requireAuthOrGuest('servers.view', 'serverStatus'), (_req: Request, res: Response) => {
    res.json({ clusters: metrics.getClusters() });
  });

  router.get('/servers/:id', requireAuthOrGuest('servers.view', 'serverStatus'), (req: Request, res: Response) => {
    const server = metrics.getServer(req.params.id);
    if (!server) return res.status(404).json({ error: 'Server not found' });
    return res.json(stripSensors(server));
  });

  router.get('/servers/:id/history', requireAuthOrGuest('servers.view', 'serverStatus'), (req: Request, res: Response) => {
    const range = (req.query.range as HistoryRange) ?? '1h';
    if (!RANGES.includes(range)) return res.status(400).json({ error: 'Invalid range' });
    const server = metrics.getServer(req.params.id);
    if (!server) return res.status(404).json({ error: 'Server not found' });
    return res.json({ serverId: req.params.id, range, points: metrics.getHistory(req.params.id, range) });
  });

  router.get('/health/global', requireAuthOrGuest('dashboard.view', 'cpu'), (_req: Request, res: Response) => {
    res.json(metrics.getGlobalHealth());
  });

  router.get('/stats', requireAuthOrGuest('dashboard.view', 'cpu'), (_req: Request, res: Response) => {
    res.json(metrics.getQuickStats());
  });

  router.get('/stats/history', requireAuthOrGuest('dashboard.view', 'cpu'), (req: Request, res: Response) => {
    const range = (req.query.range as HistoryRange) ?? '15m';
    if (!RANGES.includes(range)) return res.status(400).json({ error: 'Invalid range' });
    res.json({ range, points: metrics.getStatsHistory(range) });
  });

  router.get('/network', requireAuthOrGuest('dashboard.view', 'ipAddresses'), (_req: Request, res: Response) => {
    if (!featureEnabled('infrastructure_map')) {
      res.status(403).json({ error: 'feature_disabled' });
      return;
    }
    const { nodes, links } = metrics.getNetwork();
    res.json({ nodes, links, icons: NETWORK_NODE_ICONS });
  });

  router.get('/notifications', requireAuthOrGuest('notifications.view', 'notifications'), (req: Request, res: Response) => {
    const limit = Math.min(100, Number.parseInt(req.query.limit as string, 10) || 30);
    const offset = Number.parseInt(req.query.offset as string, 10) || 0;
    res.json(notifications.list(limit, offset));
  });

  router.get('/notifications/unread-count', requireAuthOrGuest('notifications.view', 'notifications'), (_req: Request, res: Response) => {
    res.json({ count: notifications.unreadCount() });
  });

  router.post('/notifications/read', requireAuth, requirePermission('notifications.view'), (req: Request, res: Response) => {
    const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
    notifications.markRead(ids);
    res.json({ ok: true, count: ids.length });
  });

  router.post('/notifications/read-all', requireAuth, requirePermission('notifications.view'), (_req: Request, res: Response) => {
    notifications.markAllRead();
    res.json({ ok: true });
  });

  /** Global search: servers, notifications, quick actions. */
  router.get('/search', requireAuthOrGuest('dashboard.view', 'serverStatus'), (req: Request, res: Response) => {
    const q = String(req.query.q ?? '').trim().toLowerCase();
    if (!q) return res.json({ servers: [], notifications: [], actions: [] });

    const serverHits = metrics
      .getServers()
      .filter(
        (s) =>
          s.spec.name.toLowerCase().includes(q) ||
          s.spec.os.toLowerCase().includes(q) ||
          s.spec.description.toLowerCase().includes(q) ||
          s.spec.ip.includes(q),
      )
      .map((s) => ({
        type: 'server' as const,
        id: s.spec.id,
        title: s.spec.name,
        subtitle: `${s.spec.os} · ${s.spec.ip}`,
        logo: s.spec.logo,
        route: `/servers/${s.spec.id}`,
      }));

    const notificationHits = notifications
      .list(50)
      .filter((n) => n.title.toLowerCase().includes(q) || n.message.toLowerCase().includes(q))
      .slice(0, 5)
      .map((n) => ({
        type: 'notification' as const,
        id: n.id,
        title: n.title,
        subtitle: n.message,
        logo: '',
        route: `/alerts`,
      }));

    const actions = listQuickActions()
      .filter((a) => a.enabled)
      .filter(
        (a) => a.label.toLowerCase().includes(q) || a.keywords.toLowerCase().includes(q),
      )
      .map((a) => ({ type: 'action' as const, id: a.id, title: a.label, subtitle: a.kind, logo: '', route: a.href ?? '' }));

    res.json({ servers: serverHits, notifications: notificationHits, actions });
  });

  router.get('/quick-actions', requireAuth, (_req: Request, res: Response) => {
    res.json(listQuickActions().filter((a) => a.enabled));
  });

  return router;
}
