/**
 * Responsive Smart Graph Layout Engine for Network Topology Map
 *
 * Computes node positions, cable paths, and sizing metrics that automatically
 * adapt to container dimensions and aspect ratio (Desktop, Laptop, Tablet, Smartphone).
 *
 * Wide viewports (Desktop/Laptop): Left-to-right horizontal NOC flow.
 * Narrow viewports (Smartphone/Tablet): Top-to-bottom vertical flow.
 *
 * Guarantees zero node clipping, zero cable clipping, and balanced board utilization.
 */

import type { NetworkLink, NetworkNode } from '@/types';

export interface LayoutMetrics {
  nodeWidth: number;
  nodeHeight: number;
  iconSize: number;
  fontSize: number;
  isVertical: boolean;
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

export function computeTopologyLayout(
  nodes: NetworkNode[],
  links: NetworkLink[],
  containerWidth: number = 1000,
  containerHeight: number = 500,
): TopologyLayout {
  const w = Math.max(280, containerWidth);
  const h = Math.max(280, containerHeight);

  // Responsive mode: Vertical flow if tall/narrow viewport (Smartphones/Tablets)
  const isVertical = w < 640 || h > w * 1.15;

  // Responsive node sizing
  const nodeWidth = clamp(isVertical ? Math.min(w * 0.42, 130) : Math.min(w * 0.22, 140), 95, 145);
  const nodeHeight = clamp(isVertical ? 48 : 54, 42, 60);

  if (nodes.length === 0) {
    return {
      width: w,
      height: h,
      metrics: { nodeWidth, nodeHeight, iconSize: 18, fontSize: 11, isVertical },
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

  const padX = clamp(w * 0.08, 24, 60);
  const padY = clamp(h * 0.08, 24, 60);

  const positions = new Map<string, LayoutedNode>();

  if (!isVertical) {
    // ── Horizontal Layout (Desktop / Laptop / Wide Board) ──────────────
    const usableW = w - padX * 2 - nodeWidth;
    const colGap = numLevels > 1 ? usableW / (numLevels - 1) : 0;

    sortedDepths.forEach((d, colIndex) => {
      const colNodes = levels.get(d) ?? [];
      const count = colNodes.length;
      const x = padX + nodeWidth / 2 + colIndex * colGap;

      const usableH = h - padY * 2 - nodeHeight;
      const rowGap = count > 1 ? usableH / (count - 1) : 0;
      const startY = count > 1 ? padY + nodeHeight / 2 : h / 2;

      colNodes.forEach((n, idx) => {
        const y = count > 1 ? startY + idx * rowGap : startY;
        positions.set(n.id, {
          id: n.id,
          x: round1(clamp(x, nodeWidth / 2 + 12, w - nodeWidth / 2 - 12)),
          y: round1(clamp(y, nodeHeight / 2 + 12, h - nodeHeight / 2 - 12)),
          depth: d,
        });
      });
    });
  } else {
    // ── Vertical Layout (Smartphone / Tablet / Tall Board) ─────────────
    const usableH = h - padY * 2 - nodeHeight;
    const rowGap = numLevels > 1 ? usableH / (numLevels - 1) : 0;

    sortedDepths.forEach((d, rowIndex) => {
      const rowNodes = levels.get(d) ?? [];
      const count = rowNodes.length;
      const y = padY + nodeHeight / 2 + rowIndex * rowGap;

      const usableW = w - padX * 2 - nodeWidth;
      const colGap = count > 1 ? usableW / (count - 1) : 0;
      const startX = count > 1 ? padX + nodeWidth / 2 : w / 2;

      rowNodes.forEach((n, idx) => {
        const x = count > 1 ? startX + idx * colGap : startX;
        positions.set(n.id, {
          id: n.id,
          x: round1(clamp(x, nodeWidth / 2 + 12, w - nodeWidth / 2 - 12)),
          y: round1(clamp(y, nodeHeight / 2 + 12, h - nodeHeight / 2 - 12)),
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
      const hx = clamp(dx * 0.45, 30, 120);
      dIn = `M ${a.x} ${a.y} C ${round1(a.x + hx)} ${a.y}, ${round1(b.x - hx)} ${b.y}, ${b.x} ${b.y}`;
      dOut = `M ${a.x} ${a.y} C ${round1(a.x + hx)} ${a.y}, ${round1(b.x - hx)} ${b.y}, ${b.x} ${b.y}`;
    } else {
      // Smooth vertical Bezier curves for narrow mobile viewports
      const dy = Math.abs(b.y - a.y);
      const hy = clamp(dy * 0.45, 25, 100);
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
    width: w,
    height: h,
    metrics: { nodeWidth, nodeHeight, iconSize: 18, fontSize: 11, isVertical },
    nodes: positions,
    cables,
  };
}
