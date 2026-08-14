import type { Notification, Severity } from '../types';

interface Template {
  title: string;
  message: string;
  severity: Severity;
  serverId?: string;
}

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;

/**
 * Seed notifications — a believable timeline of the last hours of lab life.
 * New notifications are generated live by the engine from these templates.
 */
export const SEED_NOTIFICATIONS: Notification[] = [
  {
    id: 'ntf-seed-01',
    title: 'Backup completed',
    message: 'PVE0: vzdump snapshot VM 101 completed in 4m 12s (1.2 TB written to NAS01).',
    severity: 'success',
    timestamp: Date.now() - 2 * MIN,
    read: false,
    serverId: 'pve0',
  },
  {
    id: 'ntf-seed-02',
    title: 'Container updated',
    message: 'Docker01: pulled latest image for traefik (tag: 3.1 → 3.2). Restart successful.',
    severity: 'info',
    timestamp: Date.now() - 9 * MIN,
    read: false,
    serverId: 'docker01',
  },
  {
    id: 'ntf-seed-03',
    title: 'High CPU',
    message: 'Docker01: sustained CPU above 85% for 5 minutes on container immich-server.',
    severity: 'warning',
    timestamp: Date.now() - 24 * MIN,
    read: false,
    serverId: 'docker01',
  },
  {
    id: 'ntf-seed-04',
    title: 'Telegram delivered',
    message: 'Alert digest delivered to @homelab channel (3 notifications).',
    severity: 'success',
    timestamp: Date.now() - 31 * MIN,
    read: true,
  },
  {
    id: 'ntf-seed-05',
    title: 'Disk cleaned',
    message: 'NAS01: trimmed 42 GB from incomplete dataset snapshots.',
    severity: 'info',
    timestamp: Date.now() - 55 * MIN,
    read: true,
    serverId: 'nas01',
  },
  {
    id: 'ntf-seed-06',
    title: 'Docker restarted',
    message: 'Docker01: daemon restarted (moved to socket.allowlist). 64 containers back online.',
    severity: 'warning',
    timestamp: Date.now() - 2 * HOUR,
    read: true,
    serverId: 'docker01',
  },
  {
    id: 'ntf-seed-07',
    title: 'Server rebooted',
    message: 'Gateway: scheduled reboot completed. Uptime reset, VPN tunnels re-established.',
    severity: 'info',
    timestamp: Date.now() - 5 * HOUR,
    read: true,
    serverId: 'gateway',
  },
  {
    id: 'ntf-seed-08',
    title: 'Certificate renewed',
    message: 'Let\u2019s Encrypt: renewed wildcard *.homelab.local (expires in 90 days).',
    severity: 'success',
    timestamp: Date.now() - 7 * HOUR,
    read: true,
  },
  {
    id: 'ntf-seed-09',
    title: 'Backup warning',
    message: 'NAS01: replication to offsite pool is 3h behind schedule.',
    severity: 'warning',
    timestamp: Date.now() - 9 * HOUR,
    read: true,
    serverId: 'nas01',
  },
  {
    id: 'ntf-seed-10',
    title: 'Temperature high',
    message: 'PVE0: NVMe sensor peaked at 71°C during backup window.',
    severity: 'warning',
    timestamp: Date.now() - 12 * HOUR,
    read: true,
    serverId: 'pve0',
  },
  {
    id: 'ntf-seed-11',
    title: 'Uptime Kuma reachable',
    message: 'All 24 monitored endpoints returned healthy after a 2-minute blip.',
    severity: 'success',
    timestamp: Date.now() - 16 * HOUR,
    read: true,
  },
  {
    id: 'ntf-seed-12',
    title: 'Container restarted',
    message: 'Docker01: home-assistant restarted by health-check policy (exit code 137).',
    severity: 'info',
    timestamp: Date.now() - 20 * HOUR,
    read: true,
    serverId: 'docker01',
  },
];

/** Live generator templates. Pick a template, fill the braces, emit. */
export const NOTIFICATION_TEMPLATES: Template[] = [
  {
    title: 'Backup completed',
    message: '{server}: nightly backup finished in {dur} — {size} written to NAS01.',
    severity: 'success',
  },
  {
    title: 'Backup completed',
    message: '{server}: VM snapshot verified. No errors reported.',
    severity: 'success',
  },
  {
    title: 'Container updated',
    message: '{server}: pulled new image for {image} — rolling update applied.',
    severity: 'info',
  },
  {
    title: 'Container restarted',
    message: '{server}: {image} restarted by {policy}.',
    severity: 'info',
  },
  {
    title: 'High CPU',
    message: '{server}: CPU above {threshold}% for {mins} minutes on {workload}.',
    severity: 'warning',
  },
  {
    title: 'Memory pressure',
    message: '{server}: RAM at {pct}% — top consumer {workload}.',
    severity: 'warning',
  },
  {
    title: 'Disk cleanup',
    message: '{server}: reclaimed {size} from stale images and logs.',
    severity: 'info',
  },
  {
    title: 'Telegram delivered',
    message: 'Digest with {n} notifications delivered to @homelab.',
    severity: 'success',
  },
  {
    title: 'Certificate renewed',
    message: 'TLS cert for {host} renewed successfully.',
    severity: 'success',
  },
  {
    title: 'Temperature high',
    message: '{server}: sensor at {temp}°C exceeded warning threshold.',
    severity: 'warning',
  },
  {
    title: 'Replication caught up',
    message: 'NAS01: ZFS replication to offsite pool is back on schedule.',
    severity: 'success',
  },
  {
    title: 'Container failed',
    message: '{server}: {image} is restarting — crash loop detected.',
    severity: 'critical',
  },
  {
    title: 'Watchdog fired',
    message: '{server}: watchdog reset {service} after missed heartbeat.',
    severity: 'critical',
  },
  {
    title: 'SSH brute force blocked',
    message: 'Gateway: blocked {n} IPs from {country} in the last 10 minutes.',
    severity: 'warning',
  },
  {
    title: 'Traffic spike',
    message: '{server}: {dir} traffic peaked at {rate} during the last interval.',
    severity: 'info',
  },
];

export const TEMPLATE_SERVERS: Record<string, { name: string; image: string; workload: string; policy: string }> = {
  pve0: { name: 'PVE0', image: 'pve-firmware', workload: 'vzdump backup job', policy: 'HA policy' },
  docker01: { name: 'Docker01', image: 'immich-server', workload: 'immich machine-learning', policy: 'health-check policy' },
  nas01: { name: 'NAS01', image: 'smb-shares', workload: 'ZFS scrub', policy: 'cron policy' },
  gateway: { name: 'Gateway', image: 'suricata', workload: 'IPS engine', policy: 'watchdog' },
  switch01: { name: 'Switch01', image: 'unifi-controller', workload: 'port-scan detector', policy: 'auto-recovery' },
};

export const CONTAINER_NAMES = [
  'traefik',
  'immich-server',
  'home-assistant',
  'n8n',
  'grafana',
  'prometheus',
  'uptime-kuma',
  'vaultwarden',
  'nextcloud',
  'frigate',
  'paperless-ngx',
  'authelia',
  'redis',
  'postgres',
  'mqtt-broker',
];
