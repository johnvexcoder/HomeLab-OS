/**
 * Hierarchical Topology Layout Engine for Network Map
 *
 * Computes node positions, cable paths, and sizing metrics for a clean,
 * production NOC infrastructure map layout.
 *
 * Flow: Internet → Gateway/Firewall → Hypervisor/Hosts → VMs/LXCs/Docker → Containers
 */

import type { NetworkLink, NetworkNode } from '@/types';

export interface LayoutMetrics {
  nodeWidth: number;
  nodeHeight: number;
  iconSize: number;
  fontSize: number;
}

export interface LayoutedNode {
  id: string;
  x: number;
  y: number;
  depth: number;
}

export interface CableLayout {
  dIn: string;
  dOut: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  mx: number;
  my: number;
}

export interface TopologyLayout {
  width: number;
  height: number;
  metrics: LayoutMetrics;
  nodes: Map<string, LayoutedNode>;
  cables: Map<string, CableLayout>;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Standard depth levels based on device role/type */
function getDefaultDepth(type: NetworkNode['type']): number {
  switch (type) {
    case 'internet': return 0;
    case 'gateway':
    case 'firewall': return 1;
    case 'hypervisor':
    case 'physical':
    case 'switch':
    case 'bridge':
    case 'nas':
    case 'storage': return 2;
    case 'vm':
    case 'lxc':
    case 'docker': return 3;
    case 'container':
    case 'podman':
    case 'kubernetes': default: return 4;
  }
}

const COLUMN_SPACING = 240; // horizontal gap between columns
const ROW_SPACING = 100;    // vertical gap between items in same column
const PADDING_X = 80;
const PADDING_Y = 80;
const NODE_WIDTH = 140;
const NODE_HEIGHT = 60;

export function computeTopologyLayout(
  nodes: NetworkNode[],
  links: NetworkLink[],
): TopologyLayout {
  if (nodes.length === 0) {
    return {
      width: 1,
      height: 1,
      metrics: { nodeWidth: NODE_WIDTH, nodeHeight: NODE_HEIGHT, iconSize: 20, fontSize: 11 },
      nodes: new Map(),
      cables: new Map(),
    };
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Build children map & parent map
  const childrenMap = new Map<string, string[]>();
  const parentMap = new Map<string, string>();

  for (const n of nodes) {
    if (n.parentId && nodeMap.has(n.parentId) && n.parentId !== n.id) {
      parentMap.set(n.id, n.parentId);
      if (!childrenMap.has(n.parentId)) childrenMap.set(n.parentId, []);
      childrenMap.get(n.parentId)!.push(n.id);
    }
  }

  // Also infer parent-child links from links if parentId wasn't explicit
  for (const link of links) {
    if (!nodeMap.has(link.source) || !nodeMap.has(link.target)) continue;
    const src = nodeMap.get(link.source)!;
    const tgt = nodeMap.get(link.target)!;
    const srcDefault = getDefaultDepth(src.type);
    const tgtDefault = getDefaultDepth(tgt.type);

    if (srcDefault < tgtDefault && !parentMap.has(tgt.id)) {
      parentMap.set(tgt.id, src.id);
      if (!childrenMap.has(src.id)) childrenMap.set(src.id, []);
      if (!childrenMap.get(src.id)!.includes(tgt.id)) {
        childrenMap.get(src.id)!.push(tgt.id);
      }
    }
  }

  // Calculate depths for each node
  const depths = new Map<string, number>();
  const calculateDepth = (node: NetworkNode): number => {
    if (depths.has(node.id)) return depths.get(node.id)!;
    
    let d = getDefaultDepth(node.type);
    const pId = parentMap.get(node.id);
    if (pId && nodeMap.has(pId)) {
      const pDepth = calculateDepth(nodeMap.get(pId)!);
      d = Math.max(d, pDepth + 1);
    }
    depths.set(node.id, d);
    return d;
  };

  for (const n of nodes) calculateDepth(n);

  // Group nodes by depth column
  const columns = new Map<number, NetworkNode[]>();
  for (const n of nodes) {
    const d = depths.get(n.id) ?? 0;
    if (!columns.has(d)) columns.set(d, []);
    columns.get(d)!.push(n);
  }

  // Sort depth columns
  const sortedDepths = [...columns.keys()].sort((a, b) => a - b);

  // Assign X and Y coordinates
  const positions = new Map<string, LayoutedNode>();
  
  // Find maximum column height to center shorter columns vertically
  let maxColHeight = 0;
  for (const d of sortedDepths) {
    const colNodes = columns.get(d) ?? [];
    const colH = colNodes.length * ROW_SPACING;
    if (colH > maxColHeight) maxColHeight = colH;
  }
  maxColHeight = Math.max(maxColHeight, ROW_SPACING * 3);

  // Layout each column
  sortedDepths.forEach((d, colIndex) => {
    const colNodes = columns.get(d) ?? [];
    const count = colNodes.length;
    const totalColH = (count - 1) * ROW_SPACING;
    const startY = PADDING_Y + (maxColHeight - totalColH) / 2;

    colNodes.forEach((n, idx) => {
      const x = PADDING_X + colIndex * COLUMN_SPACING;
      const y = startY + idx * ROW_SPACING;
      positions.set(n.id, {
        id: n.id,
        x: round1(x),
        y: round1(y),
        depth: d,
      });
    });
  });

  // Calculate total layout width and height
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of positions.values()) {
    minX = Math.min(minX, p.x - NODE_WIDTH / 2);
    maxX = Math.max(maxX, p.x + NODE_WIDTH / 2);
    minY = Math.min(minY, p.y - NODE_HEIGHT / 2);
    maxY = Math.max(maxY, p.y + NODE_HEIGHT / 2);
  }

  const layoutW = Math.max(100, maxX - minX + PADDING_X * 2);
  const layoutH = Math.max(100, maxY - minY + PADDING_Y * 2);

  // Center alignment offset
  const offsetX = PADDING_X - minX;
  const offsetY = PADDING_Y - minY;

  for (const p of positions.values()) {
    p.x = round1(p.x + offsetX);
    p.y = round1(p.y + offsetY);
  }

  // Calculate cable paths
  const cables = new Map<string, CableLayout>();
  for (const link of links) {
    const a = positions.get(link.source);
    const b = positions.get(link.target);
    if (!a || !b) continue;

    const dx = Math.abs(b.x - a.x);
    const hx = clamp(dx * 0.45, 40, 140);

    const dIn = `M ${a.x} ${a.y} C ${round1(a.x + hx)} ${a.y}, ${round1(b.x - hx)} ${b.y}, ${b.x} ${b.y}`;
    const dOut = `M ${a.x} ${a.y} C ${round1(a.x + hx)} ${a.y}, ${round1(b.x - hx)} ${b.y}, ${b.x} ${b.y}`;

    // Midpoint for cable tooltips / click
    const mx = round1((a.x + b.x) / 2);
    const my = round1((a.y + b.y) / 2);

    cables.set(link.id, {
      dIn,
      dOut,
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      mx,
      my,
    });
  }

  return {
    width: layoutW,
    height: layoutH,
    metrics: { nodeWidth: NODE_WIDTH, nodeHeight: NODE_HEIGHT, iconSize: 20, fontSize: 11 },
    nodes: positions,
    cables,
  };
}
