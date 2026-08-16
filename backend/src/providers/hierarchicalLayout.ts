/**
 * Hierarchical Layout Engine for Network Topology
 *
 * Generates positions for network nodes using a layered/hierarchical graph layout.
 * Nodes are organized by their depth in the parent-child hierarchy, with automatic
 * spacing to prevent overlaps and use available canvas space intelligently.
 */

export interface LayoutNode {
  id: string;
  parentId?: string;
  label: string;
}

export interface LayoutResult {
  id: string;
  x: number;
  y: number;
}

/**
 * Calculate positions for nodes in a tidy hierarchical tree layout.
 * Uses a leaf-weighted interval split so every subtree gets a horizontal span
 * proportional to the number of leaves it holds:
 *
 * - each root fills a slice of the full canvas width (weighted by its leaves)
 * - every node hands its own span to its children, split by leaf count
 * - x is the center of a node's span, y comes from its depth (top → bottom)
 *
 * This guarantees children never leave their parent's column (no cross-parent
 * collisions), keeps nodes of one subtree visually grouped, and automatically
 * rearranges everything whenever nodes are added or removed — no hardcoded
 * coordinates anywhere.
 */
export function calculateHierarchicalLayout(
  nodes: LayoutNode[],
  canvasWidth: number = 100,
  canvasHeight: number = 100,
): Map<string, LayoutResult> {
  if (nodes.length === 0) return new Map();

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const childrenMap = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.parentId && nodeMap.has(node.parentId)) {
      const siblings = childrenMap.get(node.parentId) ?? [];
      siblings.push(node.id);
      childrenMap.set(node.parentId, siblings);
    }
  }

  const depths = new Map<string, number>();
  const visiting = new Set<string>();
  const getDepth = (nodeId: string): number => {
    if (depths.has(nodeId)) return depths.get(nodeId)!;
    if (visiting.has(nodeId)) {
      depths.set(nodeId, 0);
      return 0;
    }
    visiting.add(nodeId);
    const node = nodeMap.get(nodeId)!;
    const depth =
      node.parentId && nodeMap.has(node.parentId) ? getDepth(node.parentId) + 1 : 0;
    visiting.delete(nodeId);
    depths.set(nodeId, depth);
    return depth;
  };
  for (const node of nodes) getDepth(node.id);

  let maxDepth = 0;
  for (const d of depths.values()) if (d > maxDepth) maxDepth = d;

  const leafCount = new Map<string, number>();
  const countLeaves = (nodeId: string): number => {
    const kids = childrenMap.get(nodeId) ?? [];
    if (kids.length === 0) return 1;
    let total = 0;
    for (const kid of kids) total += countLeaves(kid);
    leafCount.set(nodeId, total);
    return total;
  };
  for (const node of nodes) if (!leafCount.has(node.id)) countLeaves(node.id);

  const positions = new Map<string, LayoutResult>();

  const yOf = (depth: number) => ((depth + 1) / (maxDepth + 2)) * canvasHeight;

  const assign = (nodeId: string, start: number, end: number, depth: number) => {
    positions.set(nodeId, {
      id: nodeId,
      x: (start + end) / 2,
      y: yOf(depth),
    });

    const kids = childrenMap.get(nodeId) ?? [];
    if (kids.length === 0) return;
    let total = 0;
    for (const kid of kids) total += leafCount.get(kid) ?? 1;
    if (total <= 0) return;

    let cursor = start;
    for (const kid of kids) {
      const span = ((end - start) * (leafCount.get(kid) ?? 1)) / total;
      assign(kid, cursor, cursor + span, depth + 1);
      cursor += span;
    }
  };

  const roots = nodes.filter((n) => !(n.parentId && nodeMap.has(n.parentId)));
  let totalLeaves = 0;
  for (const root of roots) totalLeaves += leafCount.get(root.id) ?? 1;
  if (totalLeaves <= 0) totalLeaves = roots.length || 1;

  let cursor = 0;
  for (const root of roots) {
    const span = (canvasWidth * (leafCount.get(root.id) ?? 1)) / totalLeaves;
    assign(root.id, cursor, cursor + span, depths.get(root.id) ?? 0);
    cursor += span;
  }

  // Guarantee a minimum horizontal gap between neighbours on the same level so
  // icons + labels never collide, even in dense subtrees.
  const minGap = 8;
  const halfNode = 4;
  const levels = new Map<number, string[]>();
  for (const node of nodes) {
    const depth = depths.get(node.id) ?? 0;
    const row = levels.get(depth) ?? [];
    row.push(node.id);
    levels.set(depth, row);
  }
  for (const row of levels.values()) {
    row.sort((a, b) => (positions.get(a)!.x ?? 0) - (positions.get(b)!.x ?? 0));
    let prevRight = -Infinity;
    for (const nodeId of row) {
      const pos = positions.get(nodeId)!;
      const minCenter = prevRight + halfNode + minGap;
      if (pos.x < minCenter) pos.x = Math.min(minCenter, canvasWidth - halfNode);
      prevRight = pos.x + halfNode;
    }
    for (const nodeId of row) {
      positions.get(nodeId)!.x = Math.max(halfNode, Math.min(positions.get(nodeId)!.x, canvasWidth - halfNode));
    }
  }

  return positions;
}

/**
 * Apply calculated positions to nodes.
 * Converts layout positions to node x/y coordinates.
 */
export function applyLayout<T extends LayoutNode & { x: number; y: number }>(
  nodes: T[],
  layout: Map<string, LayoutResult>,
): T[] {
  return nodes.map((node) => {
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
}
