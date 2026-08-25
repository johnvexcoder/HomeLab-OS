/**
 * Responsive Smart Graph Layout & Node Presentation Engine for Network Topology Map
 *
 * Separates topology graph positioning from node presentation modes:
 * - FULL (Desktop >= 1024px): Full card (Icon, Name, IP, Status)
 * - COMPACT (Tablet 600px-1023px): Compact card (Icon, Name, IP, Status)
 * - MINIMAL (Smartphone < 600px): Minimal card (Icon, Name, Status — IP hidden from card, accessible via click/hover)
 *
 * Prevents node overlapping, guarantees safe boarder margins, and avoids huge stretched nodes.
 */

import type { NetworkLink, NetworkNode } from '@/types';

export type PresentationMode = 'full' | 'compact' | 'minimal';

export interface LayoutMetrics {
  nodeWidth: number;
  nodeHeight: number;
  iconSize: number;
  fontSize: number;
  isVertical: boolean;
  mode: PresentationMode;
  showIpOnNode: boolean;
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

/** Resolve node presentation mode and fixed card dimensions */
export function getPresentationMode(w: number, h: number): {
  mode: PresentationMode;
  nodeWidth: number;
  nodeHeight: number;
  iconSize: number;
  fontSize: number;
  showIpOnNode: boolean;
  isVertical: boolean;
} {
  const isVertical = w < 600 || h > w * 1.2;

  if (w < 600) {
    // Smartphone / Narrow Viewport -> MINIMAL mode
    return {
      mode: 'minimal',
      nodeWidth: 88,
      nodeHeight: 44,
      iconSize: 18,
      fontSize: 10,
      showIpOnNode: false,
      isVertical: true,
    };
  }

  if (w < 1024) {
    // Tablet / Medium Viewport -> COMPACT mode
    return {
      mode: 'compact',
      nodeWidth: 115,
      nodeHeight: 48,
      iconSize: 18,
      fontSize: 11,
      showIpOnNode: true,
      isVertical,
    };
  }

  // Desktop / Large Viewport -> FULL mode
  return {
    mode: 'full',
    nodeWidth: 138,
    nodeHeight: 52,
    iconSize: 20,
    fontSize: 11,
    showIpOnNode: true,
    isVertical: false,
  };
}

export function computeTopologyLayout(
  nodes: NetworkNode[],
  links: NetworkLink[],
  containerWidth: number = 1000,
  containerHeight: number = 500,
): TopologyLayout {
  const w = Math.max(280, containerWidth);
  const h = Math.max(280, containerHeight);

  const { mode, nodeWidth, nodeHeight, iconSize, fontSize, showIpOnNode, isVertical } = getPresentationMode(w, h);

  if (nodes.length === 0) {
    return {
      width: w,
      height: h,
      metrics: { nodeWidth, nodeHeight, iconSize, fontSize, isVertical, mode, showIpOnNode },
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

  // Infer parent-child connections from links
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

  // Group nodes by depth level
  const levels = new Map<number, NetworkNode[]>();
  for (const n of nodes) {
    const d = depths.get(n.id) ?? 0;
    if (!levels.has(d)) levels.set(d, []);
    levels.get(d)!.push(n);
  }

  const sortedDepths = [...levels.keys()].sort((a, b) => a - b);
  const numLevels = Math.max(1, sortedDepths.length);

  const padX = 50;
  const padY = 50;

  let requiredW = w;
  let requiredH = h;
  const positions = new Map<string, LayoutedNode>();

  if (!isVertical) {
    // ── Horizontal Layout (Desktop / Laptop) ──────────────────────────
    const colGap = 180;
    const rowGap = 45;
    
    const maxNodesInCol = Math.max(1, ...Array.from(levels.values()).map(arr => arr.length));
    
    requiredW = Math.max(w, padX * 2 + nodeWidth + (numLevels > 1 ? numLevels - 1 : 0) * colGap);
    requiredH = Math.max(h, padY * 2 + maxNodesInCol * nodeHeight + (maxNodesInCol > 1 ? maxNodesInCol - 1 : 0) * rowGap);

    sortedDepths.forEach((d, colIndex) => {
      const colNodes = levels.get(d) ?? [];
      const count = colNodes.length;
      const x = padX + nodeWidth / 2 + colIndex * colGap;

      const totalColH = count * nodeHeight + (count > 1 ? count - 1 : 0) * rowGap;
      const startY = (requiredH - totalColH) / 2 + nodeHeight / 2;

      colNodes.forEach((n, idx) => {
        const y = startY + idx * (nodeHeight + rowGap);
        positions.set(n.id, {
          id: n.id,
          x: round1(x),
          y: round1(y),
          depth: d,
        });
      });
    });
  } else {
    // ── Vertical Layout (Smartphone / Tablet) ─────────────────────────
    const rowGap = 80;
    const colGap = 35;
    
    const maxNodesInRow = Math.max(1, ...Array.from(levels.values()).map(arr => arr.length));
    
    requiredH = Math.max(h, padY * 2 + nodeHeight + (numLevels > 1 ? numLevels - 1 : 0) * rowGap);
    requiredW = Math.max(w, padX * 2 + maxNodesInRow * nodeWidth + (maxNodesInRow > 1 ? maxNodesInRow - 1 : 0) * colGap);

    sortedDepths.forEach((d, rowIndex) => {
      const rowNodes = levels.get(d) ?? [];
      const count = rowNodes.length;
      const y = padY + nodeHeight / 2 + rowIndex * (nodeHeight + rowGap);

      const totalRowW = count * nodeWidth + (count > 1 ? count - 1 : 0) * colGap;
      const startX = (requiredW - totalRowW) / 2 + nodeWidth / 2;

      rowNodes.forEach((n, idx) => {
        const x = startX + idx * (nodeWidth + colGap);
        positions.set(n.id, {
          id: n.id,
          x: round1(x),
          y: round1(y),
          depth: d,
        });
      });
    });
  }

  // Calculate cable paths
  const cables = new Map<string, CableLayout>();
  for (const link of links) {
    const a = positions.get(link.source);
    const b = positions.get(link.target);
    if (!a || !b) continue;

    let dIn = '';
    let dOut = '';

    if (!isVertical) {
      // Smooth horizontal Bezier curves
      const dx = Math.abs(b.x - a.x);
      const hx = clamp(dx * 0.45, 25, 110);
      dIn = `M ${a.x} ${a.y} C ${round1(a.x + hx)} ${a.y}, ${round1(b.x - hx)} ${b.y}, ${b.x} ${b.y}`;
      dOut = `M ${a.x} ${a.y} C ${round1(a.x + hx)} ${a.y}, ${round1(b.x - hx)} ${b.y}, ${b.x} ${b.y}`;
    } else {
      // Smooth vertical Bezier curves for narrow viewports
      const dy = Math.abs(b.y - a.y);
      const hy = clamp(dy * 0.45, 20, 80);
      dIn = `M ${a.x} ${a.y} C ${a.x} ${round1(a.y + hy)}, ${b.x} ${round1(b.y - hy)}, ${b.x} ${b.y}`;
      dOut = `M ${a.x} ${a.y} C ${a.x} ${round1(a.y + hy)}, ${b.x} ${round1(b.y - hy)}, ${b.x} ${b.y}`;
    }

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
    width: requiredW,
    height: requiredH,
    metrics: { nodeWidth, nodeHeight, iconSize, fontSize, isVertical, mode, showIpOnNode },
    nodes: positions,
    cables,
  };
}
