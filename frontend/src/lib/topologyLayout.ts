/**
 * Responsive Smart Graph Layout & Node Presentation Engine for Network Topology Map
 *
 * Separates topology graph positioning from node presentation modes:
 * - FULL (Desktop >= 1024px): Full card (Icon, Name, IP, Status)
 * - COMPACT (Tablet 600px-1023px): Compact card (Icon, Name, IP, Status)
 * - MINIMAL (Smartphone < 600px): Minimal card (Icon, Name, Status)
 *
 * Guarantees well-proportioned layout that fills the board without
 * microscopic shrinking, massive empty gaps, or overlapping devices.
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
  const isVertical = w < 600;

  if (w < 600) {
    // Smartphone / Narrow Viewport -> MINIMAL mode
    return {
      mode: 'minimal',
      nodeWidth: 96,
      nodeHeight: 40,
      iconSize: 16,
      fontSize: 10,
      showIpOnNode: false,
      isVertical: true,
    };
  }

  if (w < 1024) {
    // Tablet / Medium Viewport -> COMPACT mode
    return {
      mode: 'compact',
      nodeWidth: 120,
      nodeHeight: 46,
      iconSize: 18,
      fontSize: 11,
      showIpOnNode: true,
      isVertical: false,
    };
  }

  // Desktop / Large Viewport -> FULL mode
  return {
    mode: 'full',
    nodeWidth: 142,
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
  const w = Math.max(300, containerWidth);
  const h = Math.max(400, containerHeight);

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

  // Build parent-child relationships
  const parentMap = new Map<string, string>();
  for (const n of nodes) {
    if (n.parentId && nodeMap.has(n.parentId) && n.parentId !== n.id) {
      parentMap.set(n.id, n.parentId);
    }
  }

  // Infer parent-child connections from links if parentId was omitted
  for (const link of links) {
    if (!nodeMap.has(link.source) || !nodeMap.has(link.target)) continue;
    const src = nodeMap.get(link.source)!;
    const tgt = nodeMap.get(link.target)!;
    const srcDefault = getDefaultDepth(src.type);
    const tgtDefault = getDefaultDepth(tgt.type);

    if (srcDefault < tgtDefault && !parentMap.has(tgt.id)) {
      parentMap.set(tgt.id, src.id);
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

  const positions = new Map<string, LayoutedNode>();

  if (!isVertical) {
    // ══════════════════════════════════════════════════════════════════════
    // DESKTOP & LAPTOP HORIZONTAL LAYOUT (Fills 100% of card naturally)
    // ══════════════════════════════════════════════════════════════════════
    const padX = clamp(w * 0.05, 35, 60);
    const padY = 30;
    const usableW = w - padX * 2 - nodeWidth;
    const colStep = numLevels > 1 ? usableW / (numLevels - 1) : 0;

    sortedDepths.forEach((d, colIndex) => {
      const colNodes = levels.get(d) ?? [];
      const count = colNodes.length;
      const baseX = padX + nodeWidth / 2 + colIndex * colStep;

      if (count <= 5) {
        // Single vertical stack centered nicely in board height
        const totalHeight = count * nodeHeight + (count > 1 ? (count - 1) * 20 : 0);
        const startY = Math.max(padY + nodeHeight / 2, (h - totalHeight) / 2 + nodeHeight / 2);
        const stepY = count > 1 ? (totalHeight - nodeHeight) / (count - 1) : 0;

        colNodes.forEach((n, idx) => {
          const y = count > 1 ? startY + idx * stepY : h / 2;
          positions.set(n.id, { id: n.id, x: round1(baseX), y: round1(y), depth: d });
        });
      } else {
        // High density column (e.g. 6-12 containers): arrange into 2 staggered sub-columns
        // so it never forces huge canvas expansion and never squashes zoom!
        const rows = Math.ceil(count / 2);
        const totalHeight = rows * nodeHeight + (rows > 1 ? (rows - 1) * 16 : 0);
        const startY = Math.max(padY + nodeHeight / 2, (h - totalHeight) / 2 + nodeHeight / 2);
        const stepY = rows > 1 ? (totalHeight - nodeHeight) / (rows - 1) : 0;
        const subColOffset = nodeWidth * 0.58;

        colNodes.forEach((n, idx) => {
          const r = Math.floor(idx / 2);
          const c = idx % 2; // 0 = left sub-col, 1 = right sub-col
          const x = c === 0 ? baseX - subColOffset : baseX + subColOffset;
          const y = rows > 1 ? startY + r * stepY : h / 2;
          positions.set(n.id, { id: n.id, x: round1(x), y: round1(y), depth: d });
        });
      }
    });
  } else {
    // ══════════════════════════════════════════════════════════════════════
    // SMARTPHONE VERTICAL LAYOUT (Clean top-to-bottom natural hierarchy)
    // ══════════════════════════════════════════════════════════════════════
    const padY = 25;
    const padX = 15;
    const usableH = h - padY * 2 - nodeHeight;
    const rowStep = numLevels > 1 ? usableH / (numLevels - 1) : 0;

    sortedDepths.forEach((d, rowIndex) => {
      const rowNodes = levels.get(d) ?? [];
      const count = rowNodes.length;
      const baseY = padY + nodeHeight / 2 + rowIndex * rowStep;

      if (count <= 2) {
        // 1 or 2 nodes centered horizontally
        const totalW = count * nodeWidth + (count > 1 ? 16 : 0);
        const startX = (w - totalW) / 2 + nodeWidth / 2;
        const stepX = count > 1 ? nodeWidth + 16 : 0;

        rowNodes.forEach((n, idx) => {
          const x = count > 1 ? startX + idx * stepX : w / 2;
          positions.set(n.id, { id: n.id, x: round1(x), y: round1(baseY), depth: d });
        });
      } else {
        // Multi-node row on mobile (e.g. 3-6 containers): 2 compact sub-rows
        const cols = Math.ceil(count / 2);
        const totalW = cols * nodeWidth + (cols > 1 ? (cols - 1) * 8 : 0);
        const startX = Math.max(padX + nodeWidth / 2, (w - totalW) / 2 + nodeWidth / 2);
        const stepX = cols > 1 ? (totalW - nodeWidth) / (cols - 1) : 0;
        const subRowOffset = nodeHeight * 0.55;

        rowNodes.forEach((n, idx) => {
          const colIdx = Math.floor(idx / 2);
          const rowSub = idx % 2; // 0 = upper, 1 = lower
          const x = cols > 1 ? startX + colIdx * stepX : w / 2;
          const y = rowSub === 0 ? baseY - subRowOffset : baseY + subRowOffset;
          positions.set(n.id, { id: n.id, x: round1(x), y: round1(y), depth: d });
        });
      }
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // PRECISE BEZIER CABLE COMPUTATION (Connects 100% of nodes & containers)
  // ══════════════════════════════════════════════════════════════════════
  const cables = new Map<string, CableLayout>();

  for (const link of links) {
    const a = positions.get(link.source);
    const b = positions.get(link.target);
    if (!a || !b) continue;

    let dIn = '';

    if (!isVertical) {
      // Horizontal mode
      if (Math.abs(b.x - a.x) > 10) {
        const dx = Math.abs(b.x - a.x);
        const dir = b.x > a.x ? 1 : -1;
        const hx = clamp(dx * 0.5, 20, 100);
        dIn = `M ${a.x} ${a.y} C ${round1(a.x + dir * hx)} ${a.y}, ${round1(b.x - dir * hx)} ${b.y}, ${b.x} ${b.y}`;
      } else {
        // Same column / sub-column: arc gently out
        const dy = b.y - a.y;
        dIn = `M ${a.x} ${a.y} C ${round1(a.x + 35)} ${round1(a.y + dy * 0.3)}, ${round1(b.x + 35)} ${round1(b.y - dy * 0.3)}, ${b.x} ${b.y}`;
      }
    } else {
      // Vertical mode (mobile)
      if (Math.abs(b.y - a.y) > 10) {
        const dy = Math.abs(b.y - a.y);
        const dir = b.y > a.y ? 1 : -1;
        const hy = clamp(dy * 0.5, 15, 60);
        dIn = `M ${a.x} ${a.y} C ${a.x} ${round1(a.y + dir * hy)}, ${b.x} ${round1(b.y - dir * hy)}, ${b.x} ${b.y}`;
      } else {
        // Same row: arc gently down
        const dx = b.x - a.x;
        dIn = `M ${a.x} ${a.y} C ${round1(a.x + dx * 0.3)} ${round1(a.y + 25)}, ${round1(b.x - dx * 0.3)} ${round1(b.y + 25)}, ${b.x} ${b.y}`;
      }
    }

    const mx = round1((a.x + b.x) / 2);
    const my = round1((a.y + b.y) / 2);

    cables.set(link.id, {
      dIn,
      dOut: dIn,
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      mx,
      my,
    });
  }

  return {
    width: w,
    height: h,
    metrics: { nodeWidth, nodeHeight, iconSize, fontSize, isVertical, mode, showIpOnNode },
    nodes: positions,
    cables,
  };
}
