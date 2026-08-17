/**
 * Adaptive Topology Layout Engine
 *
 * Computes node positions, node/label sizing, and cable geometry for the
 * Network Map from the REAL rendering canvas (width/height in CSS pixels).
 * The layout is fully data-driven and reflows automatically whenever the
 * canvas, the node set, or the link set changes — nothing is hardcoded.
 *
 * Design:
 *  - Hierarchy is derived from the link graph (BFS spanning tree from the
 *    internet/root node) instead of per-provider parentId bookkeeping, so
 *    arbitrary topologies (nested hosts, Kubernetes clusters, VM groups,
 *    switches, storage arrays, …) just work without engine changes.
 *  - Nodes are grouped into depth columns (Internet → Gateway → Switch →
 *    Hosts → Services). Every parent fans its children out into a
 *    dynamically sized grid (columns grow with child count, then adapt to
 *    the available width/height aspect), with the parent vertically centered
 *    on its descendants.
 *  - Node icon/label sizing is a smooth continuous function of node count
 *    and available space: as infrastructure grows, icons, labels, and
 *    spacing tighten proportionally instead of jumping between fixed sizes.
 *  - Cables are cubic Béziers with per-branch fan-out offsets at the parent
 *    so each branch leaves its parent cleanly and sibling cables never cross.
 */

import type { NetworkLink, NetworkNode } from '@/types';

export interface CanvasSize {
  width: number;
  height: number;
}

export interface LayoutMetrics {
  /** Icon box diameter (canvas units ≈ CSS px). */
  nodeSize: number;
  /** Emoji icon font size. */
  iconSize: number;
  /** Node label font size. */
  labelSize: number;
  /** IP/sub-label font size. */
  ipSize: number;
  /** Max label width before truncation kicks in. */
  labelMaxWidth: number;
  /** Twin-cable split distance (upper/lower arcs). */
  split: number;
  /** Progressive LOD: node labels are drawn. */
  labelVisible: boolean;
  /** Progressive LOD: IP sub-label is drawn under the label. */
  ipVisible: boolean;
}

export interface LayoutedNode {
  id: string;
  /** Center x in canvas units. */
  x: number;
  /** Center y in canvas units. */
  y: number;
  depth: number;
  /** Index within its parent's child fan-out (used for cable fan-out). */
  siblingIndex: number;
  /** Number of siblings in its parent's fan-out. */
  siblings: number;
  /** True when the label is truncated to fit its cell. */
  truncated: boolean;
}

export interface CableLayout {
  /** Upper (inbound) twin arc, source → target. */
  dIn: string;
  /** Lower (outbound) twin arc, source → target. */
  dOut: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Horizontal control-pull distance. */
  hx: number;
  /** Control points of the upper arc (source → target). */
  cIn: [number, number, number, number];
  /** Control points of the lower arc (source → target). */
  cOut: [number, number, number, number];
}

export interface TopologyLayout {
  width: number;
  height: number;
  metrics: LayoutMetrics;
  nodes: Map<string, LayoutedNode>;
  cables: Map<string, CableLayout>;
}

const MAX_NODE = 46;
const MIN_NODE = 14;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Text-width estimate in canvas units (heuristic, no canvas dependency). */
function estTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.55;
}

/** Label font size for a given node size (smooth scale, with a readability floor). */
function labelSizeFor(nodeSize: number): number {
  return clamp(nodeSize * 0.24, 8, 12);
}

/** IP/sub-label font size for a given node size. */
function ipSizeFor(nodeSize: number): number {
  return clamp(nodeSize * 0.19, 7, 9.5);
}

/** Progressive level-of-detail: below these sizes the label / IP sub-label are dropped. */
export function labelVisible(nodeSize: number): boolean {
  return nodeSize >= 6;
}

export function ipVisible(nodeSize: number): boolean {
  return nodeSize >= 12;
}

/** Vertical footprint of the text block under a node (LOD-aware). */
function labelBlock(nodeSize: number): number {
  if (!labelVisible(nodeSize)) return 6;
  if (!ipVisible(nodeSize)) return labelSizeFor(nodeSize) + 6;
  return labelSizeFor(nodeSize) + ipSizeFor(nodeSize) + 8;
}

/**
 * Vertical span (row height) reserved for a single node. Covers the node box
 * plus its label block, so stacked nodes never overlap.
 */
export function rowSpanOf(nodeSize: number): number {
  return nodeSize + labelBlock(nodeSize);
}

/** Horizontal half-extent of a node box (label-aware). */
function nodeHalfBox(nodeSize: number): number {
  return labelVisible(nodeSize) ? nodeSize * 0.85 + 2 : nodeSize * 0.5 + 2;
}

/**
 * Desired number of grid columns for a child count, following a smooth
 * growth curve (≤6 → 1, ≤16 → 2, ≤36 → 3, ≤64 → 4, then (2k)² thresholds).
 * Column count is never hardcoded — it derives from the child count and is
 * later clamped by the available canvas width.
 */
export function desiredColumns(count: number): number {
  if (count <= 0) return 1;
  if (count <= 6) return 1;
  for (let k = 2; k <= 12; k++) {
    if (count <= (2 * k) ** 2) return k;
  }
  return 12;
}

export function computeTopologyLayout(
  nodes: NetworkNode[],
  links: NetworkLink[],
  width: number,
  height: number,
): TopologyLayout {
  const empty = (): TopologyLayout => ({
    width,
    height,
    metrics: {
      nodeSize: MAX_NODE,
      iconSize: 22,
      labelSize: 11,
      ipSize: 9,
      labelMaxWidth: 78,
      split: 7,
      labelVisible: true,
      ipVisible: true,
    },
    nodes: new Map(),
    cables: new Map(),
  });

  if (nodes.length === 0 || width <= 0 || height <= 0) return empty();

  // ---- 1. Hierarchy from the link graph (BFS spanning tree) ----
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const adj = new Map<string, string[]>();
  for (const link of links) {
    if (!nodeById.has(link.source) || !nodeById.has(link.target)) continue;
    if (link.source === link.target) continue;
    let s = adj.get(link.source);
    if (!s) {
      s = [];
      adj.set(link.source, s);
    }
    s.push(link.target);
    let t = adj.get(link.target);
    if (!t) {
      t = [];
      adj.set(link.target, t);
    }
    t.push(link.source);
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
        let sibs = children.get(cur);
        if (!sibs) {
          sibs = [];
          children.set(cur, sibs);
        }
        sibs.push(nb);
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

  const maxDepth = Math.max(0, ...depth.values());

  // ---- 2. Adaptive sizing loop (converges on node size that fits) ----
  const PAD_X = Math.min(28, width * 0.05);
  const PAD_Y = Math.min(24, height * 0.06);
  const usableW = Math.max(1, width - PAD_X * 2);
  const usableH = Math.max(1, height - PAD_Y * 2);

  const count = nodes.length;
  let nodeSize = clamp(
    46 * (1 - 0.16 * Math.log10(Math.max(1, count) / 8)),
    MIN_NODE,
    MAX_NODE,
  );

  const famCols = new Map<string, number>();
  const spanCache = new Map<string, number>();

  // Vertical span of a subtree: family rows × tallest child cell. Drives the
  // greedy column growth below (and the final vertical split).
  const cellH = Math.max(nodeSize * 2, rowSpanOf(nodeSize));
  const spanOf = (id: string): number => {
    const cached = spanCache.get(id);
    if (cached !== undefined) return cached;
    const kids = children.get(id) ?? [];
    if (kids.length === 0) return cellH;
    let worst = 0;
    for (const kid of kids) worst = Math.max(worst, spanOf(kid));
    const rows = Math.ceil(kids.length / (famCols.get(id) ?? 1));
    const v = rows * worst;
    spanCache.set(id, v);
    return v;
  };

  const totalV = (): number => {
    let t = 0;
    for (const r of roots) t += spanOf(r);
    t += Math.max(0, roots.length - 1) * nodeSize * 0.9;
    return t;
  };

  /**
   * Full layout for the current node size: family column counts, greedy
   * vertical reduction, bottom-up subtree extents + per-family column
   * spacing, and a top-down pass that fans each family out centered on its
   * parent. Returns center-x per node (roots at x = 0) and the bounding
   * box so the caller can check horizontal fit.
   */
  const layoutOnce = (): {
    cellW: number;
    minX: number;
    maxX: number;
    px: Map<string, number>;
  } => {
    const cellW = nodeSize * 1.8;
    const maxByW = Math.max(1, Math.floor(usableW / cellW));

    famCols.clear();
    for (const [pid, kids] of children) {
      famCols.set(pid, Math.min(desiredColumns(kids.length), maxByW));
    }
    spanCache.clear();

    // Bottom-up: subtree half-width from a node's center, and the column
    // spacing its family needs so adjacent sibling subtrees never overlap.
    // Children fan out to the RIGHT of their parent (spine-style), so a
    // parent node never collides with its own fan-out.
    const extentCache = new Map<string, number>();
    const spacingMap = new Map<string, number>();
    const halfBox = nodeHalfBox(nodeSize); // label-aware node half-width
    // Gap between a parent's center and its children's first column. Large
    // enough that the parent box and the first child box never overlap.
    const gap = Math.max(nodeSize * 1.2, halfBox * 2 + 2);

    const subtreeExtent = (id: string): number => {
      const cached = extentCache.get(id);
      if (cached !== undefined) return cached;
      const kids = children.get(id) ?? [];
      if (kids.length === 0) {
        extentCache.set(id, halfBox);
        return halfBox;
      }
      for (const kid of kids) subtreeExtent(kid);
      const cols = famCols.get(id) ?? 1;
      let sp = cellW;
      for (let i = 0; i < kids.length; i++) {
        if ((i + 1) % cols === 0) continue; // row end: no horizontal neighbor
        const need = extentCache.get(kids[i])! + halfBox + nodeSize * 0.2;
        if (need > sp) sp = need;
      }
      spacingMap.set(id, sp);
      let childMax = 0;
      for (const kid of kids) childMax = Math.max(childMax, extentCache.get(kid)!);
      const e = gap + (cols - 1) * sp + childMax;
      extentCache.set(id, e);
      return e;
    };

    const px = new Map<string, number>();
    let minX = 0;
    let maxX = 0;
    const computeXY = (): void => {
      extentCache.clear();
      spacingMap.clear();
      for (const r of roots) subtreeExtent(r);
      px.clear();
      for (const r of roots) px.set(r, 0);
      for (const r of roots) {
        const queue = [r];
        while (queue.length > 0) {
          const cur = queue.shift()!;
          const cols = famCols.get(cur) ?? 1;
          const sp = spacingMap.get(cur) ?? cellW;
          const kids = children.get(cur) ?? [];
          kids.forEach((kid, i) => {
            px.set(kid, px.get(cur)! + gap + (i % cols) * sp);
            queue.push(kid);
          });
        }
      }
      minX = Infinity;
      maxX = -Infinity;
      for (const v of px.values()) {
        if (v - halfBox < minX) minX = v - halfBox;
        if (v + halfBox > maxX) maxX = v + halfBox;
      }
      if (!Number.isFinite(minX)) {
        minX = 0;
        maxX = 0;
      }
    };
    computeXY();

    // Greedy column growth: whenever the vertical demand exceeds the canvas,
    // widen the family whose extra columns free the most height, spreading
    // dense topologies horizontally instead of shrinking nodes toward zero.
    // Each step jumps straight to the column count that sheds one row (some
    // adjacent column counts don't change the row count, e.g. 64/9) and is
    // capped by the family's horizontal budget. Deepest families are widened
    // first (a deep column costs the least added width), which keeps dense
    // trees balanced instead of flattening them into one huge row.
    let guard = 0;
    while (totalV() > usableH && guard++ < 150) {
      if (Math.max(1, maxX - minX) >= usableW) break; // horizontal budget used up
      let bestPid: string | null = null;
      let bestNewCols = 0;
      let bestScore = -1;
      for (const [pid, kids] of children) {
        const cols = famCols.get(pid) ?? 1;
        const c = kids.length;
        const rows = Math.ceil(c / cols);
        if (rows <= 1) continue;
        const newCols = Math.ceil(c / (rows - 1));
        if (newCols <= cols || newCols > maxByW) continue;
        const sp = spacingMap.get(pid) ?? cellW;
        const budgetCols = Math.max(cols, Math.floor(usableW / Math.max(1, sp)) + 1);
        if (newCols > budgetCols) continue;
        let cellSpan = 0;
        for (const kid of kids) cellSpan = Math.max(cellSpan, spanOf(kid));
        const score = (depth.get(pid) ?? 0) * 1000 + cellSpan;
        if (score > bestScore) {
          bestScore = score;
          bestPid = pid;
          bestNewCols = newCols;
        }
      }
      if (bestPid == null) break;
      famCols.set(bestPid, bestNewCols);
      spanCache.clear();
      computeXY();
    }

    return { cellW, minX, maxX, px };
  };

  for (let iter = 0; iter < 12; iter++) {
    const { minX, maxX } = layoutOnce();
    const extentW = Math.max(1, maxX - minX);
    let scale = 1;
    if (extentW > usableW) scale = Math.min(scale, usableW / extentW);
    if (totalV() > usableH) scale = Math.min(scale, usableH / totalV());
    if (scale < 1) {
      nodeSize = Math.max(2, nodeSize * scale);
      continue;
    }
    break;
  }

  // ---- 3. Final node positions (parent-centered fan-out + vertical split) ----
  const { minX, maxX, px } = layoutOnce();
  const extentW = Math.max(1, maxX - minX);
  const shiftX = PAD_X - minX + Math.max(0, (usableW - extentW) / 2);

  const positions = new Map<string, LayoutedNode>();
  for (const n of nodes) {
    const par = parent.get(n.id);
    const isRoot = par === n.id || par === undefined;
    const sibs = isRoot ? [] : children.get(par!) ?? [];
    const idx = isRoot ? -1 : Math.max(0, sibs.indexOf(n.id));
    positions.set(n.id, {
      id: n.id,
      x: round1((px.get(n.id) ?? 0) + shiftX),
      y: 0,
      depth: depth.get(n.id) ?? 0,
      siblingIndex: idx,
      siblings: idx >= 0 ? Math.max(1, sibs.length) : 1,
      truncated: false,
    });
  }

  const assignY = (id: string, top: number, bottom: number) => {
    const p = positions.get(id);
    if (!p) return;
    p.y = round1((top + bottom) / 2);
    const kids = children.get(id) ?? [];
    if (kids.length === 0) return;
    const cols = famCols.get(id) ?? 1;
    const rows = Math.ceil(kids.length / cols);
    const rowH = (bottom - top) / rows;
    kids.forEach((kid, i) => {
      const row = Math.floor(i / cols);
      assignY(kid, top + row * rowH, top + (row + 1) * rowH);
    });
  };

  const rootGap = nodeSize * 0.9;
  const rootSpans = roots.map(spanOf);
  const sumSpans = rootSpans.reduce((a, b) => a + b, 0);
  const totalGap = Math.max(0, roots.length - 1) * rootGap;
  const fillV = Math.min(usableH / Math.max(1, sumSpans + totalGap), 1.3);
  const groupV = (sumSpans + totalGap) * fillV;
  const offsetY = Math.max(0, (usableH - groupV) / 2);
  let yCursor = PAD_Y + offsetY;
  roots.forEach((r, i) => {
    if (i > 0) yCursor += rootGap * fillV;
    const sp = rootSpans[i] * fillV;
    assignY(r, yCursor, yCursor + sp);
    yCursor += sp;
  });

  // ---- 5. Metrics (smooth font scaling + truncation) ----
  const metrics: LayoutMetrics = {
    nodeSize: round1(nodeSize),
    iconSize: round1(clamp(nodeSize * 0.52, 10, 26)),
    labelSize: round1(labelSizeFor(nodeSize)),
    ipSize: round1(ipSizeFor(nodeSize)),
    labelMaxWidth: round1(nodeSize * 1.7),
    split: round1(Math.max(3, nodeSize * 0.15)),
    labelVisible: labelVisible(nodeSize),
    ipVisible: ipVisible(nodeSize),
  };
  for (const p of positions.values()) {
    const node = nodeById.get(p.id);
    if (!metrics.labelVisible || (node && estTextWidth(node.label, metrics.labelSize) > metrics.labelMaxWidth)) {
      p.truncated = true;
    }
  }

  // ---- 6. Cables (cubic Bézier, per-branch fan-out, twin arcs) ----
  const cables = new Map<string, CableLayout>();
  for (const link of links) {
    const a = positions.get(link.source);
    const b = positions.get(link.target);
    if (!a || !b) continue;

    const hx = Math.min(Math.abs(a.x - b.x) * 0.45, nodeSize * 1.6);
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
      return clamp((idx - (n - 1) / 2) * nodeSize * 0.26, -nodeSize * 0.6, nodeSize * 0.6);
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

  return {
    width,
    height,
    metrics,
    nodes: positions,
    cables,
  };
}
