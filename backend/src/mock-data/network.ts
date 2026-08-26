import type { NetworkLink, NetworkNode, ServerRuntime, ServerSpec } from '../types';
import { SERVER_SPECS, MOCK_SERVER_CONTAINERS } from './servers';
import { calculateHierarchicalLayout, type LayoutNode } from '../providers/hierarchicalLayout';

export const NETWORK_NODE_ICONS: Record<string, string> = {
  internet: '🌐',
  gateway: '🛡️',
  switch: '🔀',
  bridge: '🌉',
  physical: '🖲️',
  hypervisor: '🖥️',
  vm: '💾',
  lxc: '📦',
  container: '📦',
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

/**
 * Fixed infrastructure spine: Internet -> Gateway -> Core Switch.
 */
const SPINE: Array<{ id: string; label: string; type: NetworkNode['type'] }> = [
  { id: 'internet', label: 'Internet', type: 'internet' },
  { id: 'gateway', label: 'Gateway (Edge Router)', type: 'gateway' },
  { id: 'switch01', label: 'Switch01 (UniFi Core)', type: 'switch' },
];

/** Maps a fleet role onto the network-node type. */
const ROLE_TO_TYPE: Record<ServerSpec['role'], NetworkNode['type']> = {
  hypervisor: 'hypervisor',
  docker: 'docker',
  vm: 'vm',
  lxc: 'lxc',
  storage: 'storage',
  gateway: 'gateway',
  switch: 'switch',
  network: 'gateway',
  server: 'physical',
};

export const NODE_TO_SERVER: Record<string, string> = {
  gateway: 'gateway',
  switch01: 'switch01',
};

const LINK_BASE: Record<string, { latencyMs: number | null; throughputMbps: number | null; jitterMs: number | null; packetLoss: number | null }> = {
  'internet-gateway': { latencyMs: 0, throughputMbps: 0, jitterMs: 0, packetLoss: 0 },
  'gateway-switch': { latencyMs: 0, throughputMbps: 0, jitterMs: 0, packetLoss: 0 },
  uplink: { latencyMs: 0, throughputMbps: 0, jitterMs: 0, packetLoss: 0 },
  virtual: { latencyMs: 0, throughputMbps: 0, jitterMs: 0, packetLoss: 0 },
  peer: { latencyMs: 0, throughputMbps: 0, jitterMs: 0, packetLoss: 0 },
};

/**
 * Build the full topology from the unified mock infrastructure fleet model.
 */
export function buildTopology(
  getRuntime: (serverId: string) => ServerRuntime | undefined,
): { nodes: NetworkNode[]; links: NetworkLink[] } {
  const specById = new Map(SERVER_SPECS.map((s) => [s.id, s]));
  const nodesBeforeLayout: NetworkNode[] = [];
  const links: NetworkLink[] = [];
  const nodeById = new Map<string, NetworkNode>();

  const mkNode = (
    nodeId: string,
    serverId: string | undefined,
    label: string,
    type: NetworkNode['type'],
    parentId?: string,
  ): NetworkNode => {
    const runtime = serverId ? getRuntime(serverId) : undefined;
    const spec = serverId ? specById.get(serverId) : undefined;
    const node: NetworkNode = {
      id: nodeId,
      label,
      type,
      status: runtime?.status ?? 'online',
      x: 50,
      y: 50,
      parentId,
      health: runtime?.health ?? 100,
      tempC: runtime?.tempC ?? spec?.profile?.baseTemp,
      cpuPercent: runtime?.cpu ?? spec?.profile?.baseCpu,
    };
    if (spec?.ip) node.ip = spec.ip;
    nodesBeforeLayout.push(node);
    nodeById.set(nodeId, node);
    return node;
  };

  // 1. Spine (Internet -> Gateway -> Switch)
  mkNode('internet', undefined, 'Internet', 'internet');
  mkNode('gateway', 'gateway', 'Gateway', 'gateway', 'internet');
  mkNode('switch01', 'switch01', 'Switch01', 'switch', 'gateway');

  links.push({
    id: 'internet-gateway',
    source: 'internet',
    target: 'gateway',
    status: 'healthy',
    latencyMs: 12.4,
    throughputMbps: 940,
    jitterMs: 1.2,
    packetLoss: 0,
  });

  links.push({
    id: 'gateway-switch01',
    source: 'gateway',
    target: 'switch01',
    status: 'healthy',
    latencyMs: 0.2,
    throughputMbps: 1000,
    jitterMs: 0.05,
    packetLoss: 0,
  });

  // 2. Proxmox Hypervisor Nodes (pve0, pve1, pve2) -> attached to core switch
  for (const spec of SERVER_SPECS) {
    if (spec.role !== 'hypervisor') continue;

    mkNode(spec.id, spec.id, spec.name, 'hypervisor', 'switch01');
    links.push({
      id: `switch01-${spec.id}`,
      source: 'switch01',
      target: spec.id,
      status: 'healthy',
      latencyMs: 0.3,
      throughputMbps: 1000,
      jitterMs: 0.05,
      packetLoss: 0,
    });
  }

  // 3. Virtual Machines (docker01, docker02 under pve0; docker03, firewall01 under pve1; nas01, backup01 under pve2)
  for (const spec of SERVER_SPECS) {
    if (spec.role === 'hypervisor' || spec.role === 'gateway' || spec.role === 'switch') continue;

    const type = ROLE_TO_TYPE[spec.role];
    const parentNodeId = spec.parentId || 'switch01';

    mkNode(spec.id, spec.id, spec.name, type, parentNodeId);
    links.push({
      id: `${parentNodeId}-${spec.id}`,
      source: parentNodeId,
      target: spec.id,
      status: 'healthy',
      latencyMs: 0.1,
      throughputMbps: 10000,
      jitterMs: 0.02,
      packetLoss: 0,
    });

    // 4. Docker Containers attached directly to their parent Docker VM
    const containers = MOCK_SERVER_CONTAINERS[spec.id] || [];
    for (const c of containers) {
      const containerNodeId = `docker-${c.id}`;
      mkNode(containerNodeId, undefined, c.name, 'container', spec.id);
      
      const node = nodeById.get(containerNodeId);
      if (node) {
        node.ip = spec.ip;
        node.status = c.running ? 'online' : 'offline';
        node.health = c.running ? 100 : 0;
      }

      links.push({
        id: `${spec.id}-${containerNodeId}`,
        source: spec.id,
        target: containerNodeId,
        status: c.running ? 'healthy' : 'warning',
        latencyMs: 0.05,
        throughputMbps: 1000,
        jitterMs: 0.01,
        packetLoss: 0,
      });
    }
  }

  // Apply hierarchical layout algorithm to calculate relative positions
  const layoutNodes: LayoutNode[] = nodesBeforeLayout.map((n) => ({
    id: n.id,
    label: n.label,
    parentId: n.parentId,
  }));

  const layout = calculateHierarchicalLayout(layoutNodes, 100, 100);

  // Apply calculated positions to nodes
  const nodes = nodesBeforeLayout.map((node) => {
    const pos = layout.get(node.id);
    if (pos) {
      return {
        ...node,
        x: pos.x,
        y: pos.y,
      };
    }
    return node;
  });

  return { nodes, links };
}
