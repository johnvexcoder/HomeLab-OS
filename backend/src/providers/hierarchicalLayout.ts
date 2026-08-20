/**
 * Hierarchical Layout Engine for Network Topology
 *
 * Generates compact positions for network nodes using a layered layout.
 * The topology flows Internet -> Hypervisor -> VMs/CTs -> Docker containers.
 *
 * Uses a leaf-weighted interval split so every subtree gets vertical space
 * proportional to the number of leaves it holds, with a minimum gap to
 * prevent overlaps.
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
 *
 * - x = depth column (each level gets its own column, left -> right)
 * - y = center of the subtree's vertical span (leaf-weighted splitting)
 *
 * The layout is compact: nodes fill the available space proportionally
 * with a small guaranteed gap between siblings.
 */
export function calculateHierarchicalLayout(
  nodes: LayoutNode[],
  canvasWidth: number = 100,
  canvasHeight: number = 100,
): Map<string, LayoutResult> {
  if (nodes.length === 0) return new Map();

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Build children map
  const childrenMap = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.parentId && nodeMap.has(node.parentId)) {
      const siblings = childrenMap.get(node.parentId) ?? [];
      siblings.push(node.id);
      childrenMap.set(node.parentId, siblings);
    }
  }

  // Calculate depth for each node
  const depths = new Map<string, number>();
  const visiting = new Set<string>();
  const getDepth = (nodeId: string): number => {
    if (depths.has(nodeId)) return depths.get(nodeId)!;
    if (visiting.has(nodeId)) { depths.set(nodeId, 0); return 0; }
    visiting.add(nodeId);
    const node = nodeMap.get(nodeId);
    if (!node) { depths.set(nodeId, 0); return 0; }
    const depth = node.parentId && nodeMap.has(node.parentId) ? getDepth(node.parentId) + 1 : 0;
    visiting.delete(nodeId);
    depths.set(nodeId, depth);
    return depth;
  };
  for (const node of nodes) getDepth(node.id);

  let maxDepth = 0;
  for (const d of depths.values()) if (d > maxDepth) maxDepth = d;

  // Count leaves per node
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

  // x position: each depth level gets its own column
  const padding = 8;
  const usableWidth = canvasWidth - 2 * padding;
  const xOf = (depth: number) => {
    if (maxDepth === 0) return canvasWidth / 2;
    return padding + ((depth) / maxDepth) * usableWidth;
  };

  // Minimum vertical gap between siblings (in canvas units)
  const minGap = 4;

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

  // Find root nodes (no parent, or parent not in graph)
  const roots = nodes.filter((n) => !(n.parentId && nodeMap.has(n.parentId)));
  let totalLeaves = 0;
  for (const root of roots) totalLeaves += leafCount.get(root.id) ?? 1;
  if (totalLeaves <= 0) totalLeaves = roots.length || 1;

  const paddingY = 5;
  const usableHeight = canvasHeight - 2 * paddingY;
  let cursorY = paddingY;

  for (const root of roots) {
    const span = (usableHeight * (leafCount.get(root.id) ?? 1)) / totalLeaves;
    assign(root.id, cursorY, cursorY + span, depths.get(root.id) ?? 0);
    cursorY += span;
  }

  return positions;
}

/**
 * Apply calculated positions to nodes.
 */
export function applyLayout<T extends LayoutNode & { x: number; y: number }>(
  nodes: T[],
  layout: Map<string, LayoutResult>,
): T[] {
  return nodes.map((node) => {
    const pos = layout.get(node.id);
    if (pos) {
      return { ...node, x: pos.x, y: pos.y };
    }
    return node;
  });
}
