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

interface HierarchyLevel {
  nodes: LayoutNode[];
  depth: number;
}

/**
 * Calculate the hierarchy depth of each node (distance from root).
 * Nodes with no parent have depth 0.
 */
function calculateDepths(
  nodes: LayoutNode[],
  nodeMap: Map<string, LayoutNode>,
): Map<string, number> {
  const depths = new Map<string, number>();

  function getDepth(nodeId: string): number {
    if (depths.has(nodeId)) return depths.get(nodeId)!;

    const node = nodeMap.get(nodeId);
    if (!node || !node.parentId) {
      depths.set(nodeId, 0);
      return 0;
    }

    const parentDepth = getDepth(node.parentId);
    const depth = parentDepth + 1;
    depths.set(nodeId, depth);
    return depth;
  }

  for (const node of nodes) {
    getDepth(node.id);
  }

  return depths;
}

/**
 * Group nodes by their hierarchy level.
 */
function groupByLevel(
  nodes: LayoutNode[],
  depths: Map<string, number>,
): HierarchyLevel[] {
  const levels = new Map<number, LayoutNode[]>();

  for (const node of nodes) {
    const depth = depths.get(node.id) ?? 0;
    if (!levels.has(depth)) levels.set(depth, []);
    levels.get(depth)!.push(node);
  }

  const sorted: HierarchyLevel[] = [];
  for (const [depth, nodes] of Array.from(levels.entries()).sort((a, b) => a[0] - b[0])) {
    sorted.push({ depth, nodes });
  }

  return sorted;
}

/**
 * Get children of a node.
 */
function getChildren(nodeId: string, nodeMap: Map<string, LayoutNode>): LayoutNode[] {
  const children: LayoutNode[] = [];
  for (const node of nodeMap.values()) {
    if (node.parentId === nodeId) {
      children.push(node);
    }
  }
  return children;
}

/**
 * Calculate positions for nodes in a hierarchical layout.
 * Uses a top-down, left-to-right strategy.
 *
 * @param nodes Array of nodes with parent relationships
 * @param canvasWidth Canvas width in percent (0-100)
 * @param canvasHeight Canvas height in percent (0-100)
 * @returns Map of node IDs to their x, y positions
 */
export function calculateHierarchicalLayout(
  nodes: LayoutNode[],
  canvasWidth: number = 100,
  canvasHeight: number = 100,
): Map<string, LayoutResult> {
  if (nodes.length === 0) return new Map();

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const depths = calculateDepths(nodes, nodeMap);
  const levels = groupByLevel(nodes, depths);

  const positions = new Map<string, LayoutResult>();

  // Layout parameters
  const levelHeight = canvasHeight / (levels.length + 1);
  const minHorizontalGap = 8; // Minimum percent gap between nodes
  const minVerticalGap = 12; // Minimum percent gap between levels
  const nodeWidth = 8; // Approximate node width in percent (icon + label)

  // Calculate y positions for each level
  const levelYPositions = new Map<number, number>();
  for (let i = 0; i < levels.length; i++) {
    const y = ((i + 1) / (levels.length + 1)) * canvasHeight;
    levelYPositions.set(levels[i].depth, y);
  }

  // Calculate x positions for nodes at each level
  for (const level of levels) {
    const nodeCount = level.nodes.length;

    if (nodeCount === 0) continue;

    // Calculate available horizontal space
    const totalNodeWidth = nodeCount * nodeWidth;
    const totalGapWidth = Math.max((canvasWidth - totalNodeWidth) / (nodeCount + 1), minHorizontalGap);
    const spacing = totalGapWidth + nodeWidth;

    // Calculate starting x position to center nodes
    const totalWidth = spacing * nodeCount - totalGapWidth;
    const startX = (canvasWidth - totalWidth) / 2;

    // Assign x positions to nodes, but also consider parent positions for better alignment
    for (let i = 0; i < nodeCount; i++) {
      const node = level.nodes[i];
      let x: number;

      if (node.parentId) {
        // Position child nodes relative to their parent
        const parent = nodeMap.get(node.parentId);
        if (parent && positions.has(node.parentId)) {
          const parentPos = positions.get(node.parentId)!;

          // Get siblings (children of same parent)
          const siblings = getChildren(node.parentId, nodeMap);
          const siblingIndex = siblings.findIndex((s) => s.id === node.id);
          const siblingCount = siblings.length;

          // Distribute siblings around parent
          if (siblingCount === 1) {
            x = parentPos.x;
          } else {
            const siblingSpacing = 12; // Spacing between siblings
            const totalSiblingWidth = siblingCount * nodeWidth + (siblingCount - 1) * siblingSpacing;
            const startXSibling = parentPos.x - totalSiblingWidth / 2;
            x = startXSibling + siblingIndex * (nodeWidth + siblingSpacing);
          }

          // Clamp x to canvas bounds
          x = Math.max(2, Math.min(x, canvasWidth - nodeWidth - 2));
        } else {
          x = startX + i * spacing;
        }
      } else {
        // Root nodes are distributed across the level
        x = startX + i * spacing;
      }

      const y = levelYPositions.get(level.depth) ?? 50;

      positions.set(node.id, { id: node.id, x, y });
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
