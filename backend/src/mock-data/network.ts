import type { NetworkLink, NetworkNode, ServerRuntime, ServerSpec } from '../types';
import { SERVER_SPECS } from './servers';

export const NETWORK_NODE_ICONS: Record<NetworkNode['type'], string> = {
  internet: '🌐',
  router: '🛡️',
  switch: '🔀',
  hypervisor: '🟩',
  docker: '🐳',
  container: '📦',
  storage: '🗄️',
};

/**
 * Fixed infrastructure spine (internet + the node hosting the gateway role and
 * the switch role). Everything else is derived at runtime from the fleet model:
 * server nodes, their children (VMs/CTs) and the links between them — so the
 * topology stays correct as servers are added/removed, instead of hand-drawn.
 */
const SPINE: Array<{ id: string; label: string; type: NetworkNode['type']; x: number; y: number }> = [
  { id: 'internet', label: 'Internet', type: 'internet', x: 8, y: 50 },
  { id: 'router', label: 'Gateway', type: 'router', x: 26, y: 50 },
  { id: 'switch', label: 'Switch01', type: 'switch', x: 44, y: 50 },
];

/** Maps a fleet role onto the network-node type (gateway/switch reuse the spine). */
const ROLE_TO_TYPE: Record<ServerSpec['role'], NetworkNode['type']> = {
  hypervisor: 'hypervisor',
  docker: 'docker',
  storage: 'storage',
  gateway: 'router',
  switch: 'switch',
  network: 'router',
};

/** Server id hosting the gateway/switch spine roles. */
export const NODE_TO_SERVER: Record<string, string> = {
  router: 'gateway',
  switch: 'switch01',
};

/** Deterministic layout slots so a growing fleet stays readable. */
const COMPUTE_X = [60, 78];
const COMPUTE_TOP = 24;
const COMPUTE_BOTTOM = 78;
const STORAGE_XY = { x: 88, y: 24 };

const LINK_BASE: Record<string, { latencyMs: number; throughputMbps: number; jitterMs: number; packetLoss: number }> = {
  'internet-router': { latencyMs: 12, throughputMbps: 940, jitterMs: 2, packetLoss: 0 },
  'router-switch': { latencyMs: 0.3, throughputMbps: 1000, jitterMs: 0.1, packetLoss: 0 },
  uplink: { latencyMs: 0.4, throughputMbps: 940, jitterMs: 0.2, packetLoss: 0 },
  virtual: { latencyMs: 0.1, throughputMbps: 2500, jitterMs: 0.05, packetLoss: 0 },
  peer: { latencyMs: 0.6, throughputMbps: 10000, jitterMs: 0.2, packetLoss: 0 },
};

/**
 * Build the full topology from the fleet model. `getRuntime` resolves a server
 * id to its live runtime (status/health/ip) so node appearance tracks reality.
 * Links follow relationships: a node links to its `parentId` when one exists,
 * otherwise to the switch; compute nodes expose a VMs/CTs child node.
 */
export function buildTopology(
  getRuntime: (serverId: string) => ServerRuntime | undefined,
): { nodes: NetworkNode[]; links: NetworkLink[] } {
  const specById = new Map(SERVER_SPECS.map((s) => [s.id, s]));
  const nodes: NetworkNode[] = [];
  const links: NetworkLink[] = [];
  const nodeById = new Map<string, NetworkNode>();

  const mkNode = (
    nodeId: string,
    serverId: string | undefined,
    label: string,
    type: NetworkNode['type'],
    x: number,
    y: number,
    parentId?: string,
  ): NetworkNode => {
    const runtime = serverId ? getRuntime(serverId) : undefined;
    const spec = serverId ? specById.get(serverId) : undefined;
    const node: NetworkNode = {
      id: nodeId,
      label,
      type,
      status: runtime?.status ?? 'online',
      x,
      y,
      parentId,
      health: runtime?.health ?? 100,
    };
    if (spec?.ip) node.ip = spec.ip;
    nodes.push(node);
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
    mkNode(spine.id, serverId, spec?.name ?? spine.label, spine.type, spine.x, spine.y);
  }

  // Fleet nodes + their relationships.
  let computeIdx = 0;
  const computeY = [COMPUTE_TOP, COMPUTE_BOTTOM];
  for (const spec of SERVER_SPECS) {
    if (spec.role === 'gateway' || spec.role === 'switch') continue;

    const type = ROLE_TO_TYPE[spec.role];
    let x: number;
    let y: number;
    if (spec.role === 'storage') {
      x = STORAGE_XY.x;
      y = STORAGE_XY.y;
    } else {
      const slot = COMPUTE_X[computeIdx % COMPUTE_X.length];
      const row = Math.floor(computeIdx / COMPUTE_X.length) % 2;
      x = slot;
      y = computeY[row];
      computeIdx++;
    }

    mkNode(spec.id, spec.id, spec.name, type, x, y, spec.parentId);

    // Uplink: to parent (relationship) when present, else straight to the switch.
    const parentIsServer = spec.parentId ? specById.has(spec.parentId) : false;
    const uplinkSource = parentIsServer ? (spec.parentId as string) : 'switch';
    const kind = parentIsServer ? 'peer' : 'uplink';
    links.push({ id: `${spec.id}-uplink`, source: uplinkSource, target: spec.id, status: 'healthy', ...LINK_BASE[kind] });

    // VMs/CTs: compute nodes expose a child workload node.
    if (spec.role === 'hypervisor' || spec.role === 'docker') {
      const child = mkNode(`${spec.id}-containers`, undefined, 'VMs & CTs', 'container', x + 5, y + 16, spec.id);
      links.push({ id: `${spec.id}-containers`, source: spec.id, target: child.id, status: 'healthy', ...LINK_BASE.virtual });
    }
  }

  // Spine links.
  links.push({ ...mkLink('internet-router', 'internet', 'router', 'internet-router') });
  links.push({ ...mkLink('router-switch', 'router', 'switch', 'router-switch') });

  return { nodes, links };
}
