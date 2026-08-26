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
    message: 'PVE0: vzdump snapshot VM 100 (docker01) completed in 3m 45s (4.2 GB written to Backup01).',
    severity: 'success',
    timestamp: Date.now() - 2 * MIN,
    read: false,
    serverId: 'pve0',
  },
  {
    id: 'ntf-seed-02',
    title: 'Container updated',
    message: 'docker01: pulled latest image for grafana (tag: 10.4 -> 11.0). Restart successful.',
    severity: 'info',
    timestamp: Date.now() - 9 * MIN,
    read: false,
    serverId: 'docker01',
  },
  {
    id: 'ntf-seed-03',
    title: 'High CPU',
    message: 'docker02: sustained CPU above 80% for 5 minutes during Jellyfin hardware transcode.',
    severity: 'warning',
    timestamp: Date.now() - 24 * MIN,
    read: false,
    serverId: 'docker02',
  },
  {
    id: 'ntf-seed-04',
    title: 'Telegram delivered',
    message: 'Alert digest delivered to @homelab channel (2 notifications).',
    severity: 'success',
    timestamp: Date.now() - 31 * MIN,
    read: true,
  },
  {
    id: 'ntf-seed-05',
    title: 'Disk scrub completed',
    message: 'nas01: ZFS pool tank scrub completed. 0 errors found (24.5 TB verified).',
    severity: 'success',
    timestamp: Date.now() - 55 * MIN,
    read: true,
    serverId: 'nas01',
  },
  {
    id: 'ntf-seed-06',
    title: 'Rule table updated',
    message: 'firewall01: Suricata IPS ruleset reloaded (12,480 active inspection signatures).',
    severity: 'info',
    timestamp: Date.now() - 2 * HOUR,
    read: true,
    serverId: 'firewall01',
  },
  {
    id: 'ntf-seed-07',
    title: 'Cluster state verified',
    message: 'Proxmox Cluster: corosync quorum healthy across 3 nodes (pve0, pve1, pve2).',
    severity: 'success',
    timestamp: Date.now() - 4 * HOUR,
    read: true,
    serverId: 'pve0',
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
    title: 'Replication sync',
    message: 'backup01: Proxmox Backup Server verified deduplication chunk store (ratio: 3.42x).',
    severity: 'info',
    timestamp: Date.now() - 9 * HOUR,
    read: true,
    serverId: 'backup01',
  },
  {
    id: 'ntf-seed-10',
    title: 'Temperature normal',
    message: 'pve1: cooling fans modulated down to 920 RPM (CPU temp 43°C).',
    severity: 'info',
    timestamp: Date.now() - 12 * HOUR,
    read: true,
    serverId: 'pve1',
  },
  {
    id: 'ntf-seed-11',
    title: 'Uptime Kuma check',
    message: 'All 15 monitored services returned healthy responses across the cluster.',
    severity: 'success',
    timestamp: Date.now() - 16 * HOUR,
    read: true,
  },
  {
    id: 'ntf-seed-12',
    title: 'Container health verified',
    message: 'docker03: PostgreSQL database automated integrity vacuum completed in 18s.',
    severity: 'info',
    timestamp: Date.now() - 20 * HOUR,
    read: true,
    serverId: 'docker03',
  },
];

/** Live generator templates. */
export const NOTIFICATION_TEMPLATES: Template[] = [
  {
    title: 'Backup completed',
    message: '{server}: nightly backup finished in {dur} — {size} written to Backup01.',
    severity: 'success',
  },
  {
    title: 'VM Snapshot verified',
    message: '{server}: VM disk state snapshot verified. No errors reported.',
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
    title: 'ZFS Scrub finished',
    message: '{server}: ZFS pool scrub completed. 0 checksum errors.',
    severity: 'success',
  },
  {
    title: 'Telegram delivered',
    message: 'Digest with {n} notifications delivered to @homelab channel.',
    severity: 'success',
  },
  {
    title: 'Certificate renewed',
    message: 'TLS cert for {host} renewed successfully.',
    severity: 'success',
  },
  {
    title: 'Temperature warning',
    message: '{server}: sensor at {temp}°C exceeded warning threshold.',
    severity: 'warning',
  },
  {
    title: 'Replication caught up',
    message: 'backup01: PBS deduplication store synchronized with cluster nodes.',
    severity: 'success',
  },
  {
    title: 'Container health warning',
    message: '{server}: {image} high latency response detected.',
    severity: 'warning',
  },
  {
    title: 'SSH connection blocked',
    message: 'Gateway: blocked {n} brute force attempts from {country} in the last 10 minutes.',
    severity: 'warning',
  },
  {
    title: 'Traffic spike',
    message: '{server}: {dir} traffic peaked at {rate} during the last interval.',
    severity: 'info',
  },
];

export const TEMPLATE_SERVERS: Record<string, { name: string; image: string; workload: string; policy: string }> = {
  pve0: { name: 'pve0', image: 'pve-ha-manager', workload: 'cluster quorum sync', policy: 'HA policy' },
  pve1: { name: 'pve1', image: 'pve-firewall', workload: 'network bridging', policy: 'HA policy' },
  pve2: { name: 'pve2', image: 'zfs-zed', workload: 'ZFS RAIDZ2 pool scrub', policy: 'storage policy' },
  docker01: { name: 'docker01', image: 'prometheus', workload: 'metrics scrape job', policy: 'health-check policy' },
  docker02: { name: 'docker02', image: 'plex', workload: 'hardware transcoding', policy: 'restart policy' },
  docker03: { name: 'docker03', image: 'postgres', workload: 'database vacuuming', policy: 'docker-compose policy' },
  firewall01: { name: 'firewall01', image: 'suricata', workload: 'IPS packet inspection', policy: 'system watchdog' },
  nas01: { name: 'nas01', image: 'smbd', workload: 'ZFS dataset compression', policy: 'cron policy' },
  backup01: { name: 'backup01', image: 'proxmox-backup-proxy', workload: 'dedup chunk verification', policy: 'backup scheduler' },
  gateway: { name: 'Gateway', image: 'unbound', workload: 'DNS query resolution', policy: 'system watchdog' },
  switch01: { name: 'Switch01', image: 'unifi-core', workload: 'Layer-3 packet forwarding', policy: 'auto-recovery' },
};

export const CONTAINER_NAMES = [
  'homelab-frontend',
  'homelab-backend',
  'uptime-kuma',
  'grafana',
  'prometheus',
  'plex',
  'jellyfin',
  'sonarr',
  'radarr',
  'transmission',
  'vaultwarden',
  'nextcloud',
  'postgres',
  'redis',
  'nginx-proxy-manager',
];
