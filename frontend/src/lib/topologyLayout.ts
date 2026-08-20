/**
 * Hierarchical Topology Layout Engine
 *
 * Computes node positions, group bounding boxes, cable geometry, and
 * sizing metrics for a left-to-right infrastructure diagram.
 *
 * Hierarchy (BFS from Internet):
 *   Internet → Gateway → Switch → Physical Hosts → VMs/LXCs → Docker → Containers
 *
 * Key design: the layout EXPANDS to fit content rather than compressing
 * content to fit the viewport. The SVG viewBox adapts to the layout size.
 */

import type { NetworkLink, NetworkNode } from '@/types';

export interface LayoutMetrics {
  nodeSize: number;
  iconSize: number;
  labelSize: number;
  ipSize: number;
  labelMaxWidth: number;
  split: number;
  labelVisible: boolean;
  ipVisible: boolean;
}

export interface LayoutedNode {
  id: string;
  x: number;
  y: number;
  depth: number;
  siblingIndex: number;
  siblings: number;
  truncated: boolean;
}

export interface GroupBounds {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
}

export interface CableLayout {
  dIn: string;
  dOut: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  hx: number;
  cIn: [number, number, number, number];
  cOut: [number, number, number, number];
}

export interface TopologyLayout {
  width: number;
  height: number;
  metrics: LayoutMetrics;
  nodes: Map<string, LayoutedNode>;
  cables: Map<string, CableLayout>;
  groups: GroupBounds[];
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function estTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.55;
}

/** Fixed spacing constants — these determine the layout density */
const COLUMN_GAP = 180;       // horizontal gap between hierarchy levels
const ROW_GAP = 90;           // vertical gap between siblings
const SUBTREE_GAP = 120;      // gap between different parent subtrees
const PADDING = 60;           // outer padding
const NODE_SIZE = 48;         // fixed node box size
const LABEL_BLOCK = 28;       // space below node for label + IP
const GROUP_PAD = 20;         // padding inside group bounding box
const GROUP_HEADER = 18;      // extra height for group label

function labelSizeFor(): number { return 11; }
function ipSizeFor(): number { return 9; }

export function labelVisible(_nodeSize: number): boolean { return true; }
export function ipVisible(_nodeSize: number): boolean { return true; }

export function rowSpanOf(_nodeSize: number): number {
  return NODE_SIZE + LABEL_BLOCK;
}

export function computeTopologyLayout(
  nodes: NetworkNode[],
  links: NetworkLink[],
  _width: number,
  _height: number,
): TopologyLayout {
  const empty = (): TopologyLayout => ({
    width: _width,
    height: _height,
    metrics: {
      nodeSize: NODE_SIZE,
      iconSize: 22,
      labelSize: 11,
      ipSize: 9,
      labelMaxWidth: 120,
      split: 7,
      labelVisible: true,
      ipVisible: true,
    },
    nodes: new Map(),
    cables: new Map(),
    groups: [],
  });

  if (nodes.length === 0) return empty();

  // ---- 1. Build adjacency and BFS hierarchy from Internet root ----
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const adj = new Map<string, string[]>();
  for (const link of links) {
    if (!nodeById.has(link.source) || !nodeById.has(link.target)) continue;
    if (link.source === link.target) continue;
    if (!adj.has(link.source)) adj.set(link.source, []);
    if (!adj.has(link.target)) adj.set(link.target, []);
    adj.get(link.source)!.push(link.target);
    adj.get(link.target)!.push(link.source);
  }

  const parent = new Map<string, string>();
  const depth = new Map<string, number>();
  const children = new Map<string, string[]>();
  const seen = new Set<string>();
  const roots: string[] = [];

  const bfsFrom = (start: string, depthBase: number) => {
    seen.add(start);
    depth.set(start, depthBase);
    parent.set(start, start);
    const queue: string[] = [start];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const nb of adj.get(cur) ?? []) {
        if (seen.has(nb)) continue;
        seen.add(nb);
        parent.set(nb, cur);
        depth.set(nb, (depth.get(cur) ?? 0) + 1);
        if (!children.has(cur)) children.set(cur, []);
        children.get(cur)!.push(nb);
        queue.push(nb);
      }
    }
  };

  const preferred = nodes.find((n) => n.type === 'internet');
  if (preferred) {
    roots.push(preferred.id);
    bfsFrom(preferred.id, 0);
  }
  for (const n of nodes) {
    if (!seen.has(n.id)) {
      roots.push(n.id);
      bfsFrom(n.id, 0);
    }
  }

  // ---- 2. Compute subtree sizes (leaf-count weighted) ----
  const leafCount = new Map<string, number>();
  const countLeaves = (id: string): number => {
    const kids = children.get(id) ?? [];
    if (kids.length === 0) {
      leafCount.set(id, 1);
      return 1;
    }
    let total = 0;
    for (const kid of kids) total += countLeaves(kid);
    leafCount.set(id, total);
    return total;
  };
  for (const id of seen) countLeaves(id);

  // ---- 3. Compute max depth for column spacing ----
  let maxDepth = 0;
  for (const d of depth.values()) if (d > maxDepth) maxDepth = d;

  // ---- 4. Assign X positions (column-based) ----
  const columnX = (d: number): number => PADDING + d * COLUMN_GAP;

  // ---- 5. Assign Y positions (leaf-weighted interval splitting) ----
  const rowSpan = ROW_GAP;
  const positions = new Map<string, LayoutedNode>();

  const assignY = (id: string, top: number, bottom: number, d: number): void => {
    const kids = children.get(id) ?? [];
    const totalLeaves = leafCount.get(id) ?? 1;

    positions.set(id, {
      id,
      x: columnX(d),
      y: round1((top + bottom) / 2),
      depth: d,
      siblingIndex: -1,
      siblings: 1,
      truncated: false,
    });

    if (kids.length === 0) return;

    // Compute gap between children
    const totalGap = Math.max(0, kids.length - 1) * (rowSpan * 0.5);
    const available = Math.max(0, (bottom - top) - totalGap);

    let cursor = top;
    for (let i = 0; i < kids.length; i++) {
      if (i > 0) cursor += rowSpan * 0.5;
      const kidLeaves = leafCount.get(kids[i]) ?? 1;
      const span = (available * kidLeaves) / totalLeaves;
      assignY(kids[i], cursor, cursor + span, d + 1);
      cursor += span;
    }
  };

  // Find root subtrees and assign vertical space
  const rootTotalLeaves = roots.reduce((a, r) => a + (leafCount.get(r) ?? 1), 0);
  const totalHeight = Math.max(
    rootTotalLeaves * rowSpan + Math.max(0, roots.length - 1) * SUBTREE_GAP,
    rowSpan * 3,
  );

  let cursorY = PADDING;
  for (let i = 0; i < roots.length; i++) {
    if (i > 0) cursorY += SUBTREE_GAP;
    const rootLeaves = leafCount.get(roots[i]) ?? 1;
    const span = (totalHeight * rootLeaves) / rootTotalLeaves;
    assignY(roots[i], cursorY, cursorY + span, depth.get(roots[i]) ?? 0);
    cursorY += span;
  }

  // ---- 6. Set sibling indices ----
  for (const [, kids] of children) {
    for (let i = 0; i < kids.length; i++) {
      const p = positions.get(kids[i]);
      if (p) {
        p.siblingIndex = i;
        p.siblings = kids.length;
      }
    }
  }

  // ---- 7. Compute bounding box ----
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const halfNode = NODE_SIZE / 2;
  for (const p of positions.values()) {
    minX = Math.min(minX, p.x - halfNode);
    maxX = Math.max(maxX, p.x + halfNode);
    minY = Math.min(minY, p.y - rowSpan / 2);
    maxY = Math.max(maxY, p.y + rowSpan / 2);
  }

  const layoutW = Math.max(1, maxX - minX + PADDING * 2);
  const layoutH = Math.max(1, maxY - minY + PADDING * 2);
  const offsetX = PADDING - minX;
  const offsetY = PADDING - minY;

  // Shift all positions
  for (const p of positions.values()) {
    p.x = round1(p.x + offsetX);
    p.y = round1(p.y + offsetY);
  }

  // ---- 8. Group bounding boxes ----
  const groups: GroupBounds[] = [];
  const groupEntries: Array<{ id: string; depth: number; childIds: Set<string> }> = [];
  for (const [pid, kids] of children) {
    if (kids.length === 0) continue;
    const allDesc = new Set<string>();
    const collect = (nid: string) => {
      allDesc.add(nid);
      for (const k of children.get(nid) ?? []) collect(k);
    };
    for (const k of kids) collect(k);
    groupEntries.push({ id: pid, depth: depth.get(pid) ?? 0, childIds: allDesc });
  }
  groupEntries.sort((a, b) => b.depth - a.depth);

  for (const entry of groupEntries) {
    const nodesInGroup = [...entry.childIds].map((id) => positions.get(id)).filter(Boolean) as LayoutedNode[];
    if (nodesInGroup.length === 0) continue;

    let gMinX = Infinity, gMaxX = -Infinity, gMinY = Infinity, gMaxY = -Infinity;
    for (const n of nodesInGroup) {
      gMinX = Math.min(gMinX, n.x - halfNode);
      gMaxX = Math.max(gMaxX, n.x + halfNode);
      gMinY = Math.min(gMinY, n.y - rowSpan / 2);
      gMaxY = Math.max(gMaxY, n.y + rowSpan / 2);
    }

    const parentNode = nodeById.get(entry.id);
    groups.push({
      id: entry.id,
      label: parentNode?.label ?? entry.id,
      x: round1(gMinX - GROUP_PAD),
      y: round1(gMinY - GROUP_PAD - GROUP_HEADER),
      width: round1(gMaxX - gMinX + GROUP_PAD * 2),
      height: round1(gMaxY - gMinY + GROUP_PAD * 2 + GROUP_HEADER),
      depth: entry.depth,
    });
  }
  groups.sort((a, b) => a.depth - b.depth);

  // ---- 9. Metrics ----
  const metrics: LayoutMetrics = {
    nodeSize: NODE_SIZE,
    iconSize: 22,
    labelSize: labelSizeFor(),
    ipSize: ipSizeFor(),
    labelMaxWidth: 120,
    split: 7,
    labelVisible: true,
    ipVisible: true,
  };

  for (const p of positions.values()) {
    const node = nodeById.get(p.id);
    if (node && estTextWidth(node.label, metrics.labelSize) > metrics.labelMaxWidth) {
      p.truncated = true;
    }
  }

  // ---- 10. Cables (cubic Bezier with per-branch fan-out, twin arcs) ----
  const cables = new Map<string, CableLayout>();
  for (const link of links) {
    const a = positions.get(link.source);
    const b = positions.get(link.target);
    if (!a || !b) continue;

    const hx = clamp(Math.abs(a.x - b.x) * 0.4, 30, 120);
    const split = metrics.split;

    const parentOf = (id: string): string | undefined => {
      const par = parent.get(id);
      return par === id ? undefined : par;
    };
    const fanAt = (side: LayoutedNode): number => {
      const par = parentOf(side.id);
      if (par === undefined) return 0;
      const kids = children.get(par) ?? [];
      const idx = kids.indexOf(side.id);
      if (idx < 0) return 0;
      const n = Math.max(1, kids.length);
      return clamp((idx - (n - 1) / 2) * 18, -40, 40);
    };
    const srcFan = fanAt(a);
    const dstFan = fanAt(b);

    const dIn = `M ${a.x} ${a.y} C ${round1(a.x + hx)} ${round1(a.y + srcFan - split)}, ${round1(b.x - hx)} ${round1(b.y + dstFan - split)}, ${b.x} ${b.y}`;
    const dOut = `M ${a.x} ${a.y} C ${round1(a.x + hx)} ${round1(a.y + srcFan + split)}, ${round1(b.x - hx)} ${round1(b.y + dstFan + split)}, ${b.x} ${b.y}`;

    cables.set(link.id, {
      dIn,
      dOut,
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      hx,
      cIn: [round1(a.x + hx), round1(a.y + srcFan - split), round1(b.x - hx), round1(b.y + dstFan - split)],
      cOut: [round1(a.x + hx), round1(a.y + srcFan + split), round1(b.x - hx), round1(b.y + dstFan + split)],
    });
  }

  return { width: layoutW, height: layoutH, metrics, nodes: positions, cables, groups };
}
