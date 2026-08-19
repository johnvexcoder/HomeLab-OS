import { Router, type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import { getDb } from '../db/database';
import { sha256, randomBytes } from '../security/crypto';
import { requireAuth, requirePermission } from '../security/middleware';
import { audit } from '../security/audit';

function generateApiKey(): { plain: string; prefix: string; hash: string } {
  const plain = `hl_${randomBytes(32)}`;
  const prefix = plain.slice(0, 12);
  const hash = sha256(plain);
  return { plain, prefix, hash };
}

/** Middleware: authenticate agent requests via X-Agent-Key header. */
function requireAgentAuth(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers['x-agent-key'] as string | undefined;
  if (!key || !key.startsWith('hl_')) {
    res.status(401).json({ error: 'invalid_agent_key' });
    return;
  }

  const hash = sha256(key);
  const db = getDb();
  const row = db.prepare('SELECT * FROM agents WHERE api_key_hash = ?').get(hash) as Record<string, unknown> | undefined;

  if (!row) {
    res.status(401).json({ error: 'unknown_agent_key' });
    return;
  }

  (req as any).agent = row;
  next();
}

/**
 * Extract flat metrics from v2 plugin data for the dashboard agents table.
 * The agents table has flat columns for quick display; the full plugin data
 * is stored in plugins_json for detailed views.
 */
function extractFlatMetrics(body: Record<string, unknown>): Record<string, unknown> {
  const plugins = body.plugins as Array<{ plugin: string; data: Record<string, unknown> }> | undefined;
  if (!plugins || !Array.isArray(plugins)) return {};

  const metrics: Record<string, unknown> = {};

  for (const p of plugins) {
    const d = p.data;
    switch (p.plugin) {
      case 'linux': {
        const cpu = d.cpu as Record<string, unknown> | undefined;
        const mem = d.memory as Record<string, unknown> | undefined;
        const disk = d.disk as Record<string, unknown> | undefined;
        const load = d.load as Record<string, unknown> | undefined;
        const net = d.network as Record<string, unknown> | undefined;
        const procs = d.processes as Record<string, unknown> | undefined;
        if (cpu) {
          metrics.cpuUsage = (cpu.usagePercent as number) ?? 0;
          metrics.cpuCores = (cpu.cores as number) ?? 0;
        }
        if (mem) {
          metrics.ramTotalGb = (mem.totalGb as number) ?? 0;
          metrics.ramUsedGb = (mem.usedGb as number) ?? 0;
        }
        if (disk) {
          const root = disk.root as Record<string, unknown> | undefined;
          if (root) {
            metrics.diskUsedGb = (root.usedGb as number) ?? 0;
            metrics.diskTotalGb = (root.totalGb as number) ?? 0;
          }
        }
        if (load) metrics.load1 = (load.avg1 as number) ?? 0;
        if (net) {
          metrics.netDownMbps = (net.downMbps as number) ?? 0;
          metrics.netUpMbps = (net.upMbps as number) ?? 0;
        }
        if (procs) metrics.processCount = (procs.total as number) ?? 0;
        break;
      }
      case 'sensors': {
        metrics.tempC = (d.cpuTempC as number) ?? null;
        break;
      }
      case 'docker': {
        metrics.containerCount = (d.containerCount as number) ?? 0;
        metrics.runningCount = (d.runningCount as number) ?? 0;
        metrics.unhealthyCount = (d.unhealthyCount as number) ?? 0;
        metrics.containersJson = JSON.stringify(d.containers ?? []);
        break;
      }
      case 'proxmox': {
        const node = d.node as Record<string, unknown> | undefined;
        if (node) {
          metrics.uptimeSeconds = (node.uptime as number) ?? 0;
          if (!metrics.cpuUsage) metrics.cpuUsage = (node.cpuPercent as number) ?? 0;
          if (!metrics.ramTotalGb) metrics.ramTotalGb = (node.memTotalGb as number) ?? 0;
          if (!metrics.ramUsedGb) metrics.ramUsedGb = (node.memUsedGb as number) ?? 0;
        }
        // Store Proxmox-specific data
        metrics.proxmoxNode = d.node;
        metrics.zfs = d.zfs;
        metrics.ceph = d.ceph;
        metrics.ups = d.ups;
        metrics.hardware = d.hardware;
        metrics.temperatures = d.temperatures;
        metrics.fans = d.fans;
        break;
      }
      case 'smart': {
        metrics.drives = d.drives;
        metrics.driveCount = (d.driveCount as number) ?? 0;
        metrics.failingCount = (d.failingCount as number) ?? 0;
        break;
      }
      case 'network': {
        metrics.networkInterfaces = d.interfaces;
        metrics.gateway = d.gateway;
        metrics.dns = d.dns;
        metrics.publicIp = d.publicIp;
        metrics.latency = d.latency;
        metrics.packetLoss = d.packetLoss;
        break;
      }
    }
  }

  return metrics;
}

export function createAgentRouter(): Router {
  const router = Router();

  // ── Agent self-report (called by agents every few seconds) ──
  router.post('/report', requireAgentAuth, (req: Request, res: Response) => {
    const agent = (req as any).agent as Record<string, unknown>;
    const body = req.body as Record<string, unknown>;
    const now = Date.now();
    const db = getDb();

    // v2 format: body has hostInfo, capabilities, plugins[], events[]
    // v1 format: body has flat metrics directly
    const hostInfo = body.hostInfo as Record<string, unknown> | undefined;
    const capabilities = body.capabilities as string[] | undefined;
    const plugins = body.plugins as Array<{ plugin: string; collectedAt: number; data: Record<string, unknown> }> | undefined;

    // Extract flat metrics for the agents table columns
    const flat = extractFlatMetrics(body);

    // Build the full plugin payload for plugins_json
    const pluginsJson = plugins ? JSON.stringify(plugins) : null;
    const capabilitiesJson = capabilities ? JSON.stringify(capabilities) : null;

    // Use hostInfo values if present (v2), otherwise fall back to flat body (v1)
    const ip = hostInfo?.ip as string ?? String(body.ip ?? agent.ip ?? '');
    const os = hostInfo?.os as string ?? String(body.os ?? agent.os ?? '');
    const hostType = hostInfo?.hostType as string ?? String(body.hostType ?? agent.host_type ?? 'unknown');
    const cpuCores = Number(flat.cpuCores ?? hostInfo?.arch ? 0 : body.cpuCores) || Number(agent.cpu_cores) || 0;
    const ramTotalGb = Number(flat.ramTotalGb ?? 0) || Number(agent.ram_total_gb) || 0;
    const cpuUsage = Number(flat.cpuUsage ?? 0);
    const ramUsedGb = Number(flat.ramUsedGb ?? 0);
    const diskUsedGb = Number(flat.diskUsedGb ?? 0);
    const diskTotalGb = Number(flat.diskTotalGb ?? 0);
    const netDownMbps = Number(flat.netDownMbps ?? 0);
    const netUpMbps = Number(flat.netUpMbps ?? 0);
    const uptimeSeconds = Number(flat.uptimeSeconds ?? 0);
    const tempC = flat.tempC != null ? Number(flat.tempC) : null;
    const load1 = Number(flat.load1 ?? 0);

    db.prepare(`
      UPDATE agents SET
        os = ?, cpu_cores = ?, ram_total_gb = ?, host_type = ?,
        ip = ?, cpu_usage = ?, ram_used_gb = ?, disk_used_gb = ?, disk_total_gb = ?,
        net_down_mbps = ?, net_up_mbps = ?, uptime_seconds = ?,
        temp_c = ?, load_1 = ?, containers_json = ?,
        plugins_json = ?, capabilities_json = ?,
        status = 'online', last_report_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      os,
      cpuCores,
      ramTotalGb,
      hostType,
      ip,
      cpuUsage,
      ramUsedGb,
      diskUsedGb,
      diskTotalGb,
      netDownMbps,
      netUpMbps,
      uptimeSeconds,
      tempC,
      load1,
      flat.containersJson ? String(flat.containersJson) : '[]',
      pluginsJson,
      capabilitiesJson,
      String(hostInfo?.vmId ?? ''),
      String(hostInfo?.parentIp ?? ''),
      String(hostInfo?.virtType ?? ''),
      now,
      now,
      agent.id,
    );

    res.json({ ok: true });
  });

  // ── Agent registration (called once on first boot) ──
  router.post('/register', requireAgentAuth, (req: Request, res: Response) => {
    const agent = (req as any).agent as Record<string, unknown>;
    const body = req.body as Record<string, unknown>;
    const now = Date.now();
    const db = getDb();

    // v2 format has hostInfo + capabilities + plugins
    const hostInfo = body.hostInfo as Record<string, unknown> | undefined;
    const capabilities = body.capabilities as string[] | undefined;

    db.prepare(`
      UPDATE agents SET
        host_name = ?, ip = ?, os = ?, host_type = ?,
        capabilities_json = ?, agent_version = ?,
        vm_id = ?, parent_ip = ?, virt_type = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      String(body.hostName ?? hostInfo?.hostName ?? agent.host_name),
      String(body.ip ?? hostInfo?.ip ?? agent.ip),
      String(body.os ?? hostInfo?.os ?? ''),
      String(body.hostType ?? hostInfo?.hostType ?? 'unknown'),
      capabilities ? JSON.stringify(capabilities) : null,
      String(body.agentVersion ?? '1.0.0'),
      String(hostInfo?.vmId ?? ''),
      String(hostInfo?.parentIp ?? ''),
      String(hostInfo?.virtType ?? ''),
      now,
      agent.id,
    );

    audit({
      ts: now,
      username: `agent:${agent.host_id}`,
      action: 'agent.registered',
      target: String(agent.host_id),
      result: 'success',
      details: JSON.stringify({ hostName: body.hostName ?? hostInfo?.hostName, ip: body.ip ?? hostInfo?.ip, capabilities }),
    });

    res.json({ ok: true, agentId: agent.id, hostId: agent.host_id });
  });

  // ── Agent events (batched event reports) ──
  router.post('/events', requireAgentAuth, (req: Request, res: Response) => {
    const agent = (req as any).agent as Record<string, unknown>;
    const body = req.body as { hostId: string; events: Array<Record<string, unknown>> };
    const now = Date.now();
    const db = getDb();

    // Store events in the agent_events table
    const insert = db.prepare(`
      INSERT INTO agent_events (id, agent_id, timestamp, severity, plugin, resource, message, previous_state, current_state)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = db.transaction(() => {
      for (const evt of body.events ?? []) {
        insert.run(
          crypto.randomUUID(),
          agent.id,
          evt.timestamp ?? now,
          evt.severity ?? 'info',
          evt.plugin ?? 'unknown',
          evt.resource ?? '',
          evt.message ?? '',
          evt.previousState ?? '',
          evt.currentState ?? '',
        );
      }
    });
    tx();

    res.json({ ok: true, stored: (body.events ?? []).length });
  });

  // ── Admin: list all agents ──
  router.get('/', requireAuth, requirePermission('settings.view'), (_req: Request, res: Response) => {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM agents ORDER BY created_at DESC').all();
    res.json({ agents: rows });
  });

  // ── Admin: get agent events ──
  router.get('/:id/events', requireAuth, requirePermission('settings.view'), (req: Request, res: Response) => {
    const db = getDb();
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const rows = db.prepare(
      'SELECT * FROM agent_events WHERE agent_id = ? ORDER BY timestamp DESC LIMIT ?',
    ).all(req.params.id, limit);
    res.json({ events: rows });
  });

  // ── Admin: create a new agent (generates API key) ──
  router.post('/', requireAuth, requirePermission('settings.manage'), (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const hostId = String(body.hostId ?? '').trim();
    const hostName = String(body.hostName ?? '').trim();

    if (!hostId || !hostName) {
      res.status(400).json({ error: 'hostId and hostName are required' });
      return;
    }

    const db = getDb();
    const existing = db.prepare('SELECT id FROM agents WHERE host_id = ?').get(hostId);
    if (existing) {
      res.status(409).json({ error: 'agent with this hostId already exists' });
      return;
    }

    const { plain, prefix, hash } = generateApiKey();
    const now = Date.now();
    const id = crypto.randomUUID();

    db.prepare(`
      INSERT INTO agents (id, host_id, host_name, api_key_prefix, api_key_hash, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(id, hostId, hostName, prefix, hash, now, now);

    audit({
      ts: now,
      username: req.auth!.user.username,
      action: 'agent.created',
      target: hostId,
      result: 'success',
      details: JSON.stringify({ hostName }),
    });

    res.json({ agentId: id, hostId, hostName, apiKey: plain });
  });

  // ── Admin: delete an agent ──
  router.delete('/:id', requireAuth, requirePermission('settings.manage'), (req: Request, res: Response) => {
    const db = getDb();
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    db.prepare('DELETE FROM agent_events WHERE agent_id = ?').run(req.params.id);
    db.prepare('DELETE FROM agents WHERE id = ?').run(req.params.id);

    audit({
      ts: Date.now(),
      username: req.auth!.user.username,
      action: 'agent.deleted',
      target: String(agent.host_id),
      result: 'success',
    });

    res.json({ ok: true });
  });

  // ── Admin: revoke + rotate API key ──
  router.post('/:id/rotate-key', requireAuth, requirePermission('settings.manage'), (req: Request, res: Response) => {
    const db = getDb();
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const { plain, prefix, hash } = generateApiKey();
    db.prepare('UPDATE agents SET api_key_prefix = ?, api_key_hash = ?, updated_at = ? WHERE id = ?')
      .run(prefix, hash, Date.now(), req.params.id);

    audit({
      ts: Date.now(),
      username: req.auth!.user.username,
      action: 'agent.key_rotated',
      target: String(agent.host_id),
      result: 'success',
    });

    res.json({ apiKey: plain });
  });

  // ── Admin: mark agents offline if stale (>30s since last report) ──
  router.post('/heartbeat-check', requireAuth, requirePermission('settings.manage'), (_req: Request, res: Response) => {
    const db = getDb();
    const cutoff = Date.now() - 30_000;
    const result = db.prepare("UPDATE agents SET status = 'offline' WHERE status = 'online' AND last_report_at < ?").run(cutoff);
    res.json({ ok: true, markedOffline: result.changes });
  });

  return router;
}
