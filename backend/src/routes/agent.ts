import { z } from 'zod';
import { Router, type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import { getDb } from '../db/database';
import { sha256, randomBytes } from '../security/crypto';
import { requireAuth, requirePermission } from '../security/middleware';
import { audit } from '../security/audit';
import { dispatchNotification } from '../services/notificationBus';
import type { Notification } from '../types';

function generateApiKey(): { plain: string; prefix: string; hash: string } {
  const plain = `hl_${randomBytes(32)}`;
  const prefix = plain.slice(0, 12);
  const hash = sha256(plain);
  return { plain, prefix, hash };
}

function isValidIp(ip: string): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip) && ip !== '0.0.0.0' && ip !== '127.0.0.1';
}

function isDockerBridgeIp(ip: string): boolean {
  if (!isValidIp(ip)) return false;
  const parts = ip.split('.').map(Number);
  if (parts[0] === 172 && parts[1] >= 17 && parts[1] <= 31) return true;
  if (parts[0] === 10 && parts[1] <= 1) return true;
  return false;
}

/**
 * Extract authoritative LAN IP address for an agent.
 * Handles agents reporting internal Docker bridge IPs (e.g. 172.17.0.1) by
 * falling back to non-bridge network interfaces or the TCP request remote IP.
 */
function extractRealAgentIp(reportedIp: string, req: Request, flat: Record<string, unknown>): string {
  const cleanReported = (reportedIp ?? '').replace(/^::ffff:/, '').trim();

  // If reported IP is valid and NOT a docker bridge or loopback IP, use it!
  if (isValidIp(cleanReported) && !isDockerBridgeIp(cleanReported)) {
    return cleanReported;
  }

  // 1. Check network interfaces from plugin data if available
  const ifaces = flat.networkInterfaces as Array<{ ip?: string; name?: string }> | undefined;
  if (Array.isArray(ifaces)) {
    for (const iface of ifaces) {
      const ifip = (iface.ip ?? '').replace(/^::ffff:/, '').trim();
      const ifname = (iface.name ?? '').toLowerCase();
      if (
        isValidIp(ifip) &&
        !isDockerBridgeIp(ifip) &&
        !ifname.startsWith('docker') &&
        !ifname.startsWith('veth') &&
        !ifname.startsWith('br-')
      ) {
        return ifip;
      }
    }
  }

  // 2. Fallback to TCP connection source IP from request headers or socket
  const forwarded = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim().replace(/^::ffff:/, '');
  if (forwarded && isValidIp(forwarded) && !isDockerBridgeIp(forwarded)) {
    return forwarded;
  }

  const socketIp = (req.socket.remoteAddress ?? req.ip ?? '').replace(/^::ffff:/, '').trim();
  if (socketIp && isValidIp(socketIp) && !isDockerBridgeIp(socketIp)) {
    return socketIp;
  }

  return cleanReported;
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
        // Extract uptime from the Linux plugin (os.uptime() in seconds)
        if (d.uptime != null) metrics.uptimeSeconds = (d.uptime as number) ?? 0;
        break;
      }
      case 'sensors': {
        if (d.cpuTempC !== undefined) metrics.tempC = (d.cpuTempC as number) ?? null;
        break;
      }
      case 'docker': {
        if (d.containerCount !== undefined) metrics.containerCount = (d.containerCount as number) ?? 0;
        if (d.runningCount !== undefined) metrics.runningCount = (d.runningCount as number) ?? 0;
        if (d.unhealthyCount !== undefined) metrics.unhealthyCount = (d.unhealthyCount as number) ?? 0;
        if (d.containers !== undefined) metrics.containersJson = JSON.stringify(d.containers ?? []);
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


const AgentReportSchema = z.object({
  hostInfo: z.object({
    hostId: z.string(),
    hostName: z.string(),
    ip: z.string(),
    os: z.string().optional(),
    osId: z.string().optional(),
    kernel: z.string().optional(),
    arch: z.string().optional(),
    hostType: z.string().optional(),
    hypervisor: z.string().optional(),
    platform: z.string().optional(),
    manufacturer: z.string().optional(),
    product: z.string().optional(),
    machineId: z.string().optional(),
    uptimeSeconds: z.number().nonnegative().optional(),
  }).optional(),
  capabilities: z.array(z.string().max(128)).max(100).optional(),
  plugins: z.array(z.object({
    plugin: z.string().min(1).max(64),
    collectedAt: z.number().positive(),
    data: z.record(z.string(), z.unknown()),
  })).max(20).optional(),
  events: z.array(z.unknown()).max(100).optional(),
}).passthrough();

const AgentRegistrationSchema = z.object({
  hostId: z.string().min(1).max(128),
  hostName: z.string().min(1).max(255),
  ip: z.string().max(128),
  os: z.string().max(255).optional(),
  osId: z.string().max(128).optional(),
  kernel: z.string().max(255).optional(),
  arch: z.string().max(64).optional(),
  hostType: z.string().max(64).optional(),
  hypervisor: z.string().max(128).optional(),
  platform: z.string().max(128).optional(),
  manufacturer: z.string().max(255).optional(),
  product: z.string().max(255).optional(),
  machineId: z.string().max(255).optional(),
  capabilities: z.array(z.string().max(128)).max(100).optional(),
  plugins: z.array(z.string().max(64)).max(20).optional(),
}).strict();

const AgentEventsSchema = z.object({
  hostId: z.string().min(1).max(128),
  events: z.array(z.object({
    id: z.string().min(1).max(255),
    timestamp: z.number().int().nonnegative(),
    severity: z.enum(['info', 'warning', 'critical']),
    plugin: z.enum(['linux', 'docker', 'proxmox', 'sensors', 'smart', 'network']),
    resource: z.string().max(512),
    message: z.string().max(2048),
    previousState: z.string().max(512),
    currentState: z.string().max(512),
  }).strict()).max(100),
}).strict();

export function createAgentRouter(): Router {
  const router = Router();

  // ── Agent self-report (called by agents every few seconds) ──
  router.post('/report', requireAgentAuth, (req: Request, res: Response) => {
    try {
      const agent = (req as any).agent as Record<string, unknown>;
      
      const parsed = AgentReportSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_payload', details: parsed.error.issues });
        return;
      }
      const body = parsed.data;
      const now = Date.now();
      const db = getDb();

      // v2 format: body has hostInfo, capabilities, plugins[], events[]
      // v1 format: body has flat metrics directly
      const hostInfo = body.hostInfo as Record<string, unknown> | undefined;
      const capabilities = body.capabilities as string[] | undefined;
      const plugins = body.plugins as Array<{ plugin: string; collectedAt: number; data: Record<string, unknown> }> | undefined;

      // Extract flat metrics for the agents table columns
      const flat = extractFlatMetrics(body);

      // Build the full plugin payload for plugins_json (Merge deltas)
      let mergedPlugins: Array<{ plugin: string; collectedAt: number; data: Record<string, unknown> }> = [];
      if (agent.plugins_json) {
        try {
          mergedPlugins = JSON.parse(String(agent.plugins_json));
        } catch {}
      }
      if (plugins) {
        for (const p of plugins) {
          const idx = mergedPlugins.findIndex(mp => mp.plugin === p.plugin);
          if (idx !== -1) mergedPlugins[idx] = p;
          else mergedPlugins.push(p);
        }
      }
      const pluginsJson = mergedPlugins.length > 0 ? JSON.stringify(mergedPlugins) : null;
      const capabilitiesJson = capabilities ? JSON.stringify(capabilities) : null;

      // Use hostInfo values if present (v2), otherwise fall back to flat body (v1)
      const reportedIp = hostInfo?.ip as string ?? String(body.ip ?? agent.ip ?? '');
      const ip = extractRealAgentIp(reportedIp, req, flat);
      const os = hostInfo?.os as string ?? String(body.os ?? agent.os ?? '');
      const hostType = hostInfo?.hostType as string ?? String(body.hostType ?? agent.host_type ?? 'unknown');
      const cpuCores = Number(flat.cpuCores ?? (hostInfo?.arch ? 0 : body.cpuCores)) || Number(agent.cpu_cores) || 0;
      const ramTotalGb = Number(flat.ramTotalGb ?? 0) || Number(agent.ram_total_gb) || 0;
      const cpuUsage = flat.cpuUsage !== undefined ? Number(flat.cpuUsage) : Number(agent.cpu_usage ?? 0);
      const ramUsedGb = flat.ramUsedGb !== undefined ? Number(flat.ramUsedGb) : Number(agent.ram_used_gb ?? 0);
      const diskUsedGb = flat.diskUsedGb !== undefined ? Number(flat.diskUsedGb) : Number(agent.disk_used_gb ?? 0);
      const diskTotalGb = flat.diskTotalGb !== undefined ? Number(flat.diskTotalGb) : Number(agent.disk_total_gb ?? 0);
      const netDownMbps = flat.netDownMbps !== undefined ? Number(flat.netDownMbps) : Number(agent.net_down_mbps ?? 0);
      const netUpMbps = flat.netUpMbps !== undefined ? Number(flat.netUpMbps) : Number(agent.net_up_mbps ?? 0);
      const uptimeSeconds = flat.uptimeSeconds !== undefined ? Number(flat.uptimeSeconds) : (hostInfo?.uptimeSeconds !== undefined ? Number(hostInfo.uptimeSeconds) : Number(agent.uptime_seconds ?? 0));
      const tempC = flat.tempC !== undefined ? (flat.tempC !== null ? Number(flat.tempC) : null) : (agent.temp_c != null ? Number(agent.temp_c) : null);
      const load1 = flat.load1 !== undefined ? Number(flat.load1) : Number(agent.load_1 ?? 0);

      const containerCount = flat.containerCount !== undefined ? Number(flat.containerCount) : Number(agent.container_count ?? 0);
      const runningCount = flat.runningCount !== undefined ? Number(flat.runningCount) : Number(agent.running_count ?? 0);
      const unhealthyCount = flat.unhealthyCount !== undefined ? Number(flat.unhealthyCount) : Number(agent.unhealthy_count ?? 0);
      const processCount = flat.processCount !== undefined ? Number(flat.processCount) : Number(agent.process_count ?? 0);
      const containersJson = flat.containersJson !== undefined ? String(flat.containersJson) : String(agent.containers_json ?? '[]');

      db.prepare(`
        UPDATE agents SET
          os = ?, cpu_cores = ?, ram_total_gb = ?, host_type = ?,
          ip = ?, cpu_usage = ?, ram_used_gb = ?, disk_used_gb = ?, disk_total_gb = ?,
          net_down_mbps = ?, net_up_mbps = ?, uptime_seconds = ?,
          temp_c = ?, load_1 = ?, containers_json = ?,
          plugins_json = CASE WHEN ? IS NOT NULL THEN ? ELSE plugins_json END,
          capabilities_json = CASE WHEN ? IS NOT NULL THEN ? ELSE capabilities_json END,
          vm_id = ?, parent_ip = ?, virt_type = ?,
          machine_id = CASE WHEN ? != '' THEN ? ELSE machine_id END,
          mac_address = CASE WHEN ? != '' THEN ? ELSE mac_address END,
          host_type_detected = CASE WHEN ? != '' THEN ? ELSE host_type_detected END,
          hypervisor = CASE WHEN ? != '' THEN ? ELSE hypervisor END,
          container_count = ?, running_count = ?, unhealthy_count = ?,
          process_count = ?,
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
        containersJson,
        pluginsJson, pluginsJson,
        capabilitiesJson, capabilitiesJson,
        String(hostInfo?.vmId ?? ''),
        String(hostInfo?.parentIp ?? ''),
        String(hostInfo?.virtType ?? ''),
        String(hostInfo?.machineId ?? ''),
        String(hostInfo?.machineId ?? ''),
        String(hostInfo?.mac ?? ''),
        String(hostInfo?.mac ?? ''),
        String(hostInfo?.hostType ?? ''),
        String(hostInfo?.hostType ?? ''),
        String(hostInfo?.hypervisor ?? ''),
        String(hostInfo?.hypervisor ?? ''),
        containerCount,
        runningCount,
        unhealthyCount,
        processCount,
        now,
        now,
        agent.id,
      );

      // ── Container state change detection ──
      // Compare previous containers_json with new data to detect stopped/started containers
      const prevContainersJson = String(agent.containers_json ?? '[]');
      const newContainersJson = String(flat.containersJson ?? '[]');
      if (prevContainersJson !== '[]' && newContainersJson !== '[]' && prevContainersJson !== newContainersJson) {
        try {
          const prevContainers = JSON.parse(prevContainersJson) as Array<{ name: string; running: boolean; image: string }>;
          const newContainers = JSON.parse(newContainersJson) as Array<{ name: string; running: boolean; image: string }>;
          const prevMap = new Map(prevContainers.map((c) => [c.name, c]));
          const newMap = new Map(newContainers.map((c) => [c.name, c]));

          // Detect stopped containers (was running, now stopped)
          for (const [name, prev] of prevMap) {
            const cur = newMap.get(name);
            if (cur && prev.running && !cur.running) {
              const n: Notification = {
                id: `ntf-agent-stopped-${name}-${crypto.randomUUID()}`,
                title: 'Container Stopped',
                message: `Container "${name}" on agent ${agent.host_name} has stopped.\nImage: ${cur.image}`,
                severity: 'critical',
                timestamp: now,
                read: false,
                serverId: `agent-${agent.host_id}`,
              };
              dispatchNotification(n);
            }
          }

          // Detect started containers (was stopped, now running)
          for (const [name, prev] of prevMap) {
            const cur = newMap.get(name);
            if (cur && !prev.running && cur.running) {
              const n: Notification = {
                id: `ntf-agent-started-${name}-${crypto.randomUUID()}`,
                title: 'Container Started',
                message: `Container "${name}" on agent ${agent.host_name} is back online.\nImage: ${cur.image}`,
                severity: 'success',
                timestamp: now,
                read: false,
                serverId: `agent-${agent.host_id}`,
              };
              dispatchNotification(n);
            }
          }

          // Detect new containers (not in previous, running now)
          for (const [name, cur] of newMap) {
            if (!prevMap.has(name) && cur.running) {
              const n: Notification = {
                id: `ntf-agent-added-${name}-${crypto.randomUUID()}`,
                title: 'Container Added',
                message: `New container "${name}" detected on agent ${agent.host_name}.\nImage: ${cur.image}`,
                severity: 'info',
                timestamp: now,
                read: false,
                serverId: `agent-${agent.host_id}`,
              };
              dispatchNotification(n);
            }
          }
        } catch {
          // JSON parse error — ignore, don't crash the report handler
        }
      }

      res.json({ ok: true });
    } catch (err) {
      console.error('[agent/report] Handler error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'report_handler_error', message: (err as Error).message });
      }
    }
  });

  // ── Agent registration (called once on first boot) ──
  router.post('/register', requireAgentAuth, (req: Request, res: Response) => {
    const agent = (req as any).agent as Record<string, unknown>;
    const parsed = AgentRegistrationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', details: parsed.error.issues });
      return;
    }
    const body = parsed.data as Record<string, unknown>;
    const now = Date.now();
    const db = getDb();

    // v2 format has hostInfo + capabilities + plugins
    const hostInfo = body.hostInfo as Record<string, unknown> | undefined;
    const capabilities = body.capabilities as string[] | undefined;
    const reportedRegIp = String(body.ip ?? hostInfo?.ip ?? agent.ip ?? '');
    const regIp = extractRealAgentIp(reportedRegIp, req, {});

    db.prepare(`
      UPDATE agents SET
        host_name = ?, ip = ?, os = ?, host_type = ?,
        capabilities_json = ?, agent_version = ?,
        vm_id = ?, parent_ip = ?, virt_type = ?,
        machine_id = ?, mac_address = ?, host_type_detected = ?, hypervisor = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      String(body.hostName ?? hostInfo?.hostName ?? agent.host_name),
      regIp,
      String(body.os ?? hostInfo?.os ?? ''),
      String(body.hostType ?? hostInfo?.hostType ?? 'unknown'),
      capabilities ? JSON.stringify(capabilities) : null,
      String(body.agentVersion ?? '1.0.0'),
      String(hostInfo?.vmId ?? ''),
      String(hostInfo?.parentIp ?? ''),
      String(hostInfo?.virtType ?? ''),
      String(hostInfo?.machineId ?? ''),
      String(hostInfo?.mac ?? ''),
      String(hostInfo?.hostType ?? ''),
      String(hostInfo?.hypervisor ?? ''),
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
    const parsed = AgentEventsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', details: parsed.error.issues });
      return;
    }
    const body = parsed.data;
    if (body.hostId !== String(agent.host_id)) {
      res.status(403).json({ error: 'agent_identity_mismatch' });
      return;
    }
    const now = Date.now();
    const db = getDb();

    // Store events in the agent_events table
    const insert = db.prepare(`
      INSERT OR IGNORE INTO agent_events (id, agent_id, timestamp, severity, plugin, resource, message, previous_state, current_state)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = db.transaction(() => {
      for (const evt of body.events ?? []) {
        insert.run(
          `${String(agent.id)}:${evt.id}`,
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

    res.json({ ok: true, accepted: body.events.length });
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
