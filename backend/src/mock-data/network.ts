import type { NetworkLink, NetworkNode, ServerRuntime, ServerSpec } from '../types';
import { SERVER_SPECS } from './servers';
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
 * Fixed infrastructure spine (internet + the node hosting the gateway role and
 * the switch role). Everything else is derived at runtime from the fleet model:
 * server nodes, their children (VMs/CTs) and the links between them — so the
 * topology stays correct as servers are added/removed, instead of hand-drawn.
 */
const SPINE: Array<{ id: string; label: string; type: NetworkNode['type'] }> = [
  { id: 'internet', label: 'Internet', type: 'internet' },
  { id: 'gateway', label: 'Gateway', type: 'gateway' },
  { id: 'switch', label: 'Switch', type: 'switch' },
];

/** Maps a fleet role onto the network-node type (gateway/switch reuse the spine). */
const ROLE_TO_TYPE: Record<ServerSpec['role'], NetworkNode['type']> = {
  hypervisor: 'hypervisor',
  docker: 'docker',
  vm: 'vm',
  lxc: 'lxc',
  storage: 'storage',
  gateway: 'gateway',
  switch: 'switch',
  network: 'gateway',
  server: 'container',
};

/** Server id hosting the gateway/switch spine roles. */
export const NODE_TO_SERVER: Record<string, string> = {
  gateway: 'gateway',
  switch: 'switch01',
};

const LINK_BASE: Record<string, { latencyMs: number; throughputMbps: number; jitterMs: number; packetLoss: number }> = {
  'internet-gateway': { latencyMs: 12, throughputMbps: 940, jitterMs: 2, packetLoss: 0 },
  'gateway-switch': { latencyMs: 0.3, throughputMbps: 1000, jitterMs: 0.1, packetLoss: 0 },
  uplink: { latencyMs: 0.4, throughputMbps: 940, jitterMs: 0.2, packetLoss: 0 },
  virtual: { latencyMs: 0.1, throughputMbps: 2500, jitterMs: 0.05, packetLoss: 0 },
  peer: { latencyMs: 0.6, throughputMbps: 10000, jitterMs: 0.2, packetLoss: 0 },
};

/**
 * Build the full topology from the fleet model. Uses hierarchical layout algorithm
 * to automatically calculate node positions based on the infrastructure hierarchy.
 * `getRuntime` resolves a server id to its live runtime (status/health/ip).
 * Links follow relationships: a node links to its `parentId` when one exists,
 * otherwise to the switch.
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
      x: 50, // Temporary, will be calculated by layout algorithm
      y: 50, // Temporary, will be calculated by layout algorithm
      parentId,
      health: runtime?.health ?? 100,
    };
    if (spec?.ip) node.ip = spec.ip;
    nodesBeforeLayout.push(node);
    nodeById.set(nodeId, node);
    return node;
  };

  const mkLink = (
    id: string,
    source: string,
    target: string,
    kind: keyof typeof LINK_BASE,
  ): NetworkLink => {
    const base = LINK_BASE[id] ?? LINK_BASE[kind];
    return {
      id,
      source,
      target,
      status: 'healthy',
      ...base,
    };
  };

  // Spine (internet + gateway/switch hosts when they exist in the fleet).
  for (const spine of SPINE) {
    const serverId = NODE_TO_SERVER[spine.id];
    const spec = serverId ? specById.get(serverId) : undefined;
    mkNode(spine.id, serverId, spec?.name ?? spine.label, spine.type);
  }

  // Fleet nodes + their relationships.
  for (const spec of SERVER_SPECS) {
    if (spec.role === 'gateway' || spec.role === 'switch') continue;

    const type = ROLE_TO_TYPE[spec.role];
    mkNode(spec.id, spec.id, spec.name, type, spec.parentId);

    // Uplink: to parent (relationship) when present, else straight to the switch.
    const parentIsServer = spec.parentId ? specById.has(spec.parentId) : false;
    const uplinkSource = parentIsServer ? (spec.parentId as string) : 'switch';
    const kind = parentIsServer ? 'peer' : 'uplink';
    links.push({ id: `${spec.id}-uplink`, source: uplinkSource, target: spec.id, status: 'healthy', ...LINK_BASE[kind] });

    // VMs/CTs: compute nodes expose a child workload node.
    if (spec.role === 'hypervisor' || spec.role === 'docker') {
      mkNode(`${spec.id}-containers`, undefined, 'VMs & CTs', 'container', spec.id);
      links.push({ 
        id: `${spec.id}-containers`, 
        source: spec.id, 
        target: `${spec.id}-containers`, 
        status: 'healthy', 
        ...LINK_BASE.virtual 
      });
    }
  }

  // Spine links.
  links.push({ ...mkLink('internet-gateway', 'internet', 'gateway', 'internet-router') });
  links.push({ ...mkLink('gateway-switch', 'gateway', 'switch', 'router-switch') });

  // Apply hierarchical layout algorithm to calculate positions
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
