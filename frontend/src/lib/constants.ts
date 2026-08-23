export const STATUS_META = {
  online: { label: 'Online', color: 'text-success', bg: 'bg-success', dot: 'bg-success', ring: 'ring-success/20' },
  degraded: { label: 'Degraded', color: 'text-warn', bg: 'bg-warn', dot: 'bg-warn', ring: 'ring-warn/20' },
  offline: { label: 'Offline', color: 'text-crit', bg: 'bg-crit', dot: 'bg-crit', ring: 'ring-crit/20' },
} as const;

export const REACH_META = {
  accessible: { label: 'Accessible', dot: 'bg-success', text: 'text-success' },
  degraded: { label: 'Degraded', dot: 'bg-warn', text: 'text-warn' },
  unreachable: { label: 'Unreachable', dot: 'bg-crit', text: 'text-crit' },
} as const;

/**
 * Semantic infrastructure status colors — deliberately independent of the
 * user-selected accent theme so "online" always reads green, "degraded"
 * amber and "offline" red, no matter the accent. Unknown states (e.g.
 * maintenance) fall back to neutral.
 */
export function statusTextClass(status: string): string {
  switch (status) {
    case 'online':
      return 'text-success';
    case 'degraded':
      return 'text-warn';
    case 'offline':
      return 'text-crit';
    default:
      return 'text-text-muted';
  }
}

export function statusDotClass(status: string): string {
  switch (status) {
    case 'online':
      return 'bg-success';
    case 'degraded':
      return 'bg-warn';
    case 'offline':
      return 'bg-crit';
    default:
      return 'bg-text-muted';
  }
}

/** Renders a compact display label for verbose platform names (presentation only). */
export function compactClusterLabel(name: string): string {
  const compact = name.replace(/^HomeLab\s+/i, '').trim();
  return compact || name;
}

export const SEVERITY_META = {
  info: { label: 'Info', text: 'text-info', dot: 'bg-info', soft: 'bg-info/10 text-info border-info/20' },
  success: { label: 'Success', text: 'text-accent', dot: 'bg-accent', soft: 'bg-accent/10 text-accent border-accent/20' },
  warning: { label: 'Warning', text: 'text-warn', dot: 'bg-warn', soft: 'bg-warn/10 text-warn border-warn/20' },
  critical: { label: 'Critical', text: 'text-crit', dot: 'bg-crit', soft: 'bg-crit/10 text-crit border-crit/20' },
} as const;

export const ROLE_META: Record<string, { label: string; dot: string }> = {
  hypervisor: { label: 'Hypervisor', dot: 'bg-accent' },
  docker: { label: 'Container Host', dot: 'bg-info' },
  storage: { label: 'Storage', dot: 'bg-warn' },
  gateway: { label: 'Gateway', dot: 'bg-crit' },
  switch: { label: 'Switch', dot: 'bg-warn' },
  network: { label: 'Network', dot: 'bg-info' },
  server: { label: 'Server', dot: 'bg-primary' },
};

/**
 * Secondary role tags — two states only for VMs:
 *   - containers > 0 → "CONTAINERS"
 *   - containers = 0 → "VIRTUAL MACHINE"
 * Hypervisors show their cluster name. Other roles show a contextual label.
 */
export function getSecondaryRole(
  server: { spec: { role: string; profile: { containers: number; vms: number }; clusterId?: string | null } },
  clusters?: Array<{ id: string; name: string }>,
): { label: string; tone: string } | null {
  const { role, profile, clusterId } = server.spec;
  const cluster = clusterId ? clusters?.find((c) => c.id === clusterId) : undefined;

  // Hypervisors → show cluster name
  if (role === 'hypervisor') {
    return cluster
      ? { label: compactClusterLabel(cluster.name), tone: 'bg-crit/15 text-crit border-crit/20' }
      : { label: 'Proxmox Cluster', tone: 'bg-crit/15 text-crit border-crit/20' };
  }

  // VMs with containers running → "CONTAINERS"
  if (profile.containers > 0) {
    return { label: 'CONTAINERS', tone: 'bg-amber-500/15 text-amber-400 border-amber-500/20' };
  }

  // VMs without containers → "VIRTUAL MACHINE"
  if (role === 'server') {
    return { label: 'VIRTUAL MACHINE', tone: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' };
  }

  // Docker hosts
  if (role === 'docker') {
    return { label: 'DOCKER HOST', tone: 'bg-blue-500/15 text-blue-400 border-blue-500/20' };
  }

  // Storage
  if (role === 'storage') {
    return { label: 'NAS', tone: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/20' };
  }

  // Gateway/Firewall
  if (role === 'gateway') {
    return { label: 'GATEWAY', tone: 'bg-teal-500/15 text-teal-400 border-teal-500/20' };
  }

  return null;
}

/** Fleet capability model — shown as chips; the system keys off these, not role names. */
export const CAPABILITY_META: Record<string, { label: string }> = {
  virtualization: { label: 'Virtualization' },
  containerization: { label: 'Containers' },
  storage: { label: 'Storage' },
  gateway: { label: 'Gateway' },
  switching: { label: 'Switching' },
  monitoring: { label: 'Monitoring' },
};

export const NETWORK_NODE_ICONS_FRONTEND: Record<string, string> = {
  internet: '🌐',
  gateway: '🛡️',
  switch: '🔀',
  bridge: '🌉',
  physical: '🖲️',
  hypervisor: '🖥️',
  vm: '📦',
  lxc: '📦',
  container: '🐳',
  docker: '🐳',
  podman: '🐙',
  kubernetes: '☸️',
  storage: '🗄️',
  nas: '💾',
  ups: '🔋',
  firewall: '🧱',
  cloud: '☁️',
  laptop: '💻',
  desktop: '🖥️',
};
