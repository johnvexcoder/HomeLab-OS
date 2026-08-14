export const STATUS_META = {
  online: { label: 'Online', color: 'text-accent', bg: 'bg-accent', dot: 'bg-accent', ring: 'ring-accent/20' },
  degraded: { label: 'Degraded', color: 'text-warn', bg: 'bg-warn', dot: 'bg-warn', ring: 'ring-warn/20' },
  offline: { label: 'Offline', color: 'text-crit', bg: 'bg-crit', dot: 'bg-crit', ring: 'ring-crit/20' },
} as const;

export const REACH_META = {
  accessible: { label: 'Accessible', dot: 'bg-accent', text: 'text-accent' },
  degraded: { label: 'Degraded', dot: 'bg-warn', text: 'text-warn' },
  unreachable: { label: 'Unreachable', dot: 'bg-crit', text: 'text-crit' },
} as const;

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
};

/** Fleet capability model — shown as chips; the system keys off these, not role names. */
export const CAPABILITY_META: Record<string, { label: string }> = {
  virtualization: { label: 'Virtualization' },
  containerization: { label: 'Containers' },
  storage: { label: 'Storage' },
  gateway: { label: 'Gateway' },
  switching: { label: 'Switching' },
  monitoring: { label: 'Monitoring' },
};

export const NETWORK_NODE_ICONS_FRONTEND: Record<
  'internet' | 'router' | 'switch' | 'hypervisor' | 'docker' | 'container' | 'storage',
  string
> = {
  internet: '🌐',
  router: '🛡️',
  switch: '🔀',
  hypervisor: '🟩',
  docker: '🐳',
  container: '📦',
  storage: '🗄️',
};
