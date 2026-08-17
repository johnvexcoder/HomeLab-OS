import https from 'node:https';
import http from 'node:http';
import { getDb } from '../db/database';
import { secretValue, findActiveIntegration } from './integrations';
import { notifyDispatcher } from './notifyDispatch';

const CHECK_INTERVAL_MS = 30_000; // every 30 seconds
const TIMEOUT_MS = 10_000;

interface UptimeKumaMonitor {
  id: number;
  name: string;
  url: string;
  type: string;
  active: boolean;
}

interface UptimeKumaMonitorCheck {
  monitorId: number;
  status: number; // 2=up, 0=down, 1=pending
}

let timer: NodeJS.Timeout | null = null;
const prevStates = new Map<number, number>(); // monitorId → last status

function getKumaConfig(): { baseUrl: string; apiToken: string } | null {
  const row = findActiveIntegration('uptime_kuma');
  if (!row) return null;
  const token = secretValue(row.id, 'apiToken');
  const config = row.config ? JSON.parse(row.config) : {};
  const baseUrl = config.baseUrl as string | undefined;
  if (!token || !baseUrl) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ''), apiToken: token };
}

function kumaRequest<T>(url: string, apiToken: string): Promise<T | null> {
  const isHttps = url.startsWith('https');
  const client = isHttps ? https : http;
  return new Promise((resolve) => {
    const req = client.get(
      url,
      {
        headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data) as T);
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function fetchMonitors(config: { baseUrl: string; apiToken: string }): Promise<UptimeKumaMonitor[]> {
  const data = await kumaRequest<Record<string, UptimeKumaMonitor>>(`${config.baseUrl}/api/monitors`, config.apiToken);
  if (!data) return [];
  return Object.values(data).filter((m) => m.active);
}

async function fetchMonitorStatus(config: { baseUrl: string; apiToken: string }, monitorId: number): Promise<number | null> {
  const data = await kumaRequest<{ status: number }>(`${config.baseUrl}/api/monitor/${monitorId}`, config.apiToken);
  return data?.status ?? null;
}

async function runCheck(): Promise<void> {
  const config = getKumaConfig();
  if (!config) return;

  const monitors = await fetchMonitors(config);
  if (monitors.length === 0) return;

  for (const monitor of monitors) {
    const status = await fetchMonitorStatus(config, monitor.id);
    if (status === null) continue;

    const prev = prevStates.get(monitor.id);
    prevStates.set(monitor.id, status);

    if (prev === undefined) continue;
    if (prev === status) continue;

    const url = monitor.url || 'N/A';
    if (status === 2 && prev !== 2) {
      notifyDispatcher.notifyUptimeKumaUp(monitor.name, url);
    } else if (status !== 2 && prev === 2) {
      notifyDispatcher.notifyUptimeKumaDown(monitor.name, url);
    }
  }
}

export function startUptimeKumaMonitor(): NodeJS.Timeout {
  runCheck().catch(() => undefined);
  timer = setInterval(() => { void runCheck(); }, CHECK_INTERVAL_MS);
  timer.unref();
  return timer;
}
