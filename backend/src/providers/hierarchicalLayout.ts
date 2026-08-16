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
 * Calculate positions for nodes in a tidy left-to-right hierarchical layout.
 * The topology flows Internet → Gateway → Host → Services, exactly like an
 * enterprise network diagram:
 *
 * - x comes from depth: each level occupies its own column (left → right)
 * - y uses a leaf-weighted interval split so every subtree gets a vertical
 *   span proportional to the number of leaves it holds
 * - every node hands its own span to its children, split by leaf count
 * - y is the center of a node's span
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

  const xOf = (depth: number) => ((depth + 1) / (maxDepth + 2)) * canvasWidth;

  /** Children are split leaf-weighted, with a guaranteed vertical min-gap between them. */
  const minGap = 10;

  const assign = (nodeId: string, top: number, bottom: number, depth: number) => {
    positions.set(nodeId, {
      id: nodeId,
      x: xOf(depth),
      y: (top + bottom) / 2,
    });

    const kids = childrenMap.get(nodeId) ?? [];
    if (kids.length === 0) return;
    let total = 0;
    for (const kid of kids) total += leafCount.get(kid) ?? 1;
    if (total <= 0) return;

    const gaps = minGap * (kids.length - 1);
    const available = Math.max(0, bottom - top - gaps);
    let cursor = top;
    let first = true;
    for (const kid of kids) {
      if (!first) cursor += minGap;
      const span = (available * (leafCount.get(kid) ?? 1)) / total;
      assign(kid, cursor, cursor + span, depth + 1);
      cursor += span;
      first = false;
    }
  };

  const roots = nodes.filter((n) => !(n.parentId && nodeMap.has(n.parentId)));
  let totalLeaves = 0;
  for (const root of roots) totalLeaves += leafCount.get(root.id) ?? 1;
  if (totalLeaves <= 0) totalLeaves = roots.length || 1;

  let cursorY = 0;
  for (const root of roots) {
    const span = (canvasHeight * (leafCount.get(root.id) ?? 1)) / totalLeaves;
    assign(root.id, cursorY, cursorY + span, depths.get(root.id) ?? 0);
    cursorY += span;
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
