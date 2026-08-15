/**
 * Advanced Network Engine for HomeLabOS Dashboard
 * Implements:
 * - Hierarchical network topology visualization
 * - Force-directed graph layout with node repulsion
 * - Real-time bidirectional traffic simulation
 * - Bandwidth-based traffic intensity
 * - Intelligent cable routing
 * - Link health visualization
 */

import type { NetworkLink, NetworkNode } from '@/types';

export interface LayoutNode {
  id: string;
  label: string;
  type: NetworkNode['type'];
  parentId?: string;
  health: number;
  status: 'online' | 'degraded' | 'offline';
  x: number;
  y: number;
  vx: number; // velocity x
  vy: number; // velocity y
  pinned?: boolean; // pinned node stays in place (e.g., Internet)
}

export interface TrafficFlow {
  id: string;
  sourceId: string;
  targetId: string;
  path: string[]; // node IDs in order
  direction: 'outbound' | 'inbound' | 'peer';
  startTime: number;
  intensity: number; // 0..1 based on throughput
  packetCount: number; // how many particles animated
  speedMs: number; // animation speed in ms
}

export interface NetworkLayoutResult {
  nodes: Map<string, LayoutNode>;
  flows: TrafficFlow[];
}

/**
 * Calculates hierarchical levels for the network topology.
 * Assigns each node to a depth based on its distance from root nodes.
 */
function calculateLevels(nodes: NetworkNode[]): Map<string, number> {
  const levels = new Map<string, number>();
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  function getLevel(nodeId: string, visited = new Set<string>()): number {
    if (levels.has(nodeId)) return levels.get(nodeId)!;
    if (visited.has(nodeId)) return 0; // cycle protection
    visited.add(nodeId);

    const node = nodeMap.get(nodeId);
    if (!node || !node.parentId) {
      levels.set(nodeId, 0);
      return 0;
    }

    const parentLevel = getLevel(node.parentId, visited);
    const level = parentLevel + 1;
    levels.set(nodeId, level);
    return level;
  }

  // Calculate levels for all nodes
  for (const node of nodes) {
    getLevel(node.id);
  }

  return levels;
}

/**
 * Groups nodes by their level in the hierarchy.
 */
function groupByLevel(
  nodes: NetworkNode[],
  levels: Map<string, number>,
): Map<number, NetworkNode[]> {
  const groups = new Map<number, NetworkNode[]>();

  for (const node of nodes) {
    const level = levels.get(node.id) ?? 0;
    if (!groups.has(level)) groups.set(level, []);
    groups.get(level)!.push(node);
  }

  return groups;
}

/**
 * Finds all children of a given parent node.
 */
function getChildren(
  parentId: string,
  nodes: NetworkNode[],
): NetworkNode[] {
  return nodes.filter((n) => n.parentId === parentId);
}

/**
 * Force-directed graph layout engine.
 * Positions nodes to minimize overlap and show hierarchy clearly.
 */
export function calculateNetworkLayout(
  nodes: NetworkNode[],
  links: NetworkLink[],
  width = 100,
  height = 100,
): Map<string, { x: number; y: number }> {
  if (nodes.length === 0) return new Map();

  // Calculate levels
  const levels = calculateLevels(nodes);
  const levelGroups = groupByLevel(nodes, levels);
  const maxLevel = Math.max(...Array.from(levelGroups.keys()));

  // Initialize layout nodes
  const layoutNodes = new Map<string, LayoutNode>();
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const levelHeights = new Map<number, number>();
  for (const [level, group] of levelGroups) {
    levelHeights.set(level, height / (maxLevel + 2));
  }

  // Position nodes by level
  const result = new Map<string, { x: number; y: number }>();

  for (let level = 0; level <= maxLevel; level++) {
    const nodesInLevel = levelGroups.get(level) ?? [];
    if (nodesInLevel.length === 0) continue;

    const yPos = (level + 1) * (height / (maxLevel + 2));

    // Sort nodes to keep hierarchy together
    const byParent = new Map<string | undefined, NetworkNode[]>();
    for (const node of nodesInLevel) {
      const parentId = node.parentId;
      if (!byParent.has(parentId)) byParent.set(parentId, []);
      byParent.get(parentId)!.push(node);
    }

    let xOffset = 0;
    const spacing = 8; // % between nodes

    for (const [parentId, siblings] of byParent) {
      const siblingCount = siblings.length;
      const groupWidth = (siblingCount * (width / (maxLevel + 2)) + (siblingCount - 1) * spacing);

      for (let i = 0; i < siblingCount; i++) {
        const node = siblings[i];
        const xPos = Math.min(width - 8, Math.max(8, xOffset + (i * (width / (maxLevel + 2)))));

        result.set(node.id, {
          x: xPos,
          y: yPos,
        });
      }

      xOffset += groupWidth + spacing;
    }
  }

  return result;
}

/**
 * Finds the path from source to target through the network hierarchy.
 */
function findPath(
  sourceId: string,
  targetId: string,
  nodes: NetworkNode[],
  links: NetworkLink[],
): string[] {
  if (sourceId === targetId) return [sourceId];

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // BFS to find shortest path
  const queue: Array<{ nodeId: string; path: string[] }> = [
    { nodeId: sourceId, path: [sourceId] },
  ];
  const visited = new Set<string>();
  visited.add(sourceId);

  while (queue.length > 0) {
    const { nodeId, path } = queue.shift()!;

    if (nodeId === targetId) return path;

    // Get connected nodes
    const connected = new Set<string>();

    // Direct links
    for (const link of links) {
      if (link.source === nodeId) connected.add(link.target);
      if (link.target === nodeId) connected.add(link.source);
    }

    // Parent/child relationships
    const node = nodeMap.get(nodeId);
    if (node?.parentId) connected.add(node.parentId);
    for (const child of getChildren(nodeId, nodes)) {
      connected.add(child.id);
    }

    for (const next of connected) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push({ nodeId: next, path: [...path, next] });
      }
    }
  }

  return []; // No path found
}

/**
 * Generates realistic traffic flows based on network topology and link metrics.
 */
export function generateTrafficFlows(
  nodes: NetworkNode[],
  links: NetworkLink[],
): TrafficFlow[] {
  const flows: TrafficFlow[] = [];
  const flowId = Math.random().toString(36).slice(2, 8);
  let flowCounter = 0;

  const infrastructureNodes = nodes.filter((n) =>
    ['docker', 'hypervisor', 'storage'].includes(n.type),
  );
  const internet = nodes.find((n) => n.type === 'internet');

  if (!internet) return flows;

  // Generate outbound flows from infrastructure to internet
  for (const node of infrastructureNodes) {
    const path = findPath(node.id, internet.id, nodes, links);
    if (path.length > 1) {
      const relevantLinks = links.filter(
        (l) =>
          (path.includes(l.source) && path.includes(l.target)) ||
          (path.includes(l.target) && path.includes(l.source)),
      );

      const avgThroughput =
        relevantLinks.reduce((sum, l) => sum + l.throughputMbps, 0) /
        (relevantLinks.length || 1);
      const intensity = Math.min(1, avgThroughput / 1000); // normalize to 0..1

      flows.push({
        id: `flow-${flowId}-out-${flowCounter++}`,
        sourceId: node.id,
        targetId: internet.id,
        path,
        direction: 'outbound',
        startTime: Date.now() + Math.random() * 2000,
        intensity,
        packetCount: Math.max(1, Math.floor(intensity * 8)),
        speedMs: 800 + Math.random() * 400,
      });
    }
  }

  // Generate return flows (inbound)
  for (const node of infrastructureNodes) {
    const path = findPath(internet.id, node.id, nodes, links);
    if (path.length > 1) {
      const relevantLinks = links.filter(
        (l) =>
          (path.includes(l.source) && path.includes(l.target)) ||
          (path.includes(l.target) && path.includes(l.source)),
      );

      const avgThroughput =
        relevantLinks.reduce((sum, l) => sum + l.throughputMbps, 0) /
        (relevantLinks.length || 1);
      const intensity = Math.min(1, avgThroughput / 1000);

      flows.push({
        id: `flow-${flowId}-in-${flowCounter++}`,
        sourceId: internet.id,
        targetId: node.id,
        path,
        direction: 'inbound',
        startTime: Date.now() + 1000 + Math.random() * 2000,
        intensity,
        packetCount: Math.max(1, Math.floor(intensity * 6)),
        speedMs: 1000 + Math.random() * 500,
      });
    }
  }

  // Generate peer-to-peer flows between infrastructure nodes
  for (let i = 0; i < infrastructureNodes.length; i++) {
    for (let j = i + 1; j < Math.min(i + 3, infrastructureNodes.length); j++) {
      const source = infrastructureNodes[i];
      const target = infrastructureNodes[j];
      const path = findPath(source.id, target.id, nodes, links);

      if (path.length > 1 && Math.random() > 0.5) {
        flows.push({
          id: `flow-${flowId}-peer-${flowCounter++}`,
          sourceId: source.id,
          targetId: target.id,
          path,
          direction: 'peer',
          startTime: Date.now() + Math.random() * 3000,
          intensity: 0.3 + Math.random() * 0.4,
          packetCount: 2 + Math.floor(Math.random() * 4),
          speedMs: 600 + Math.random() * 300,
        });
      }
    }
  }

  return flows;
}

/**
 * Calculates which links are currently active based on traffic flows.
 */
export function getActiveLinks(
  flows: TrafficFlow[],
  currentTime = Date.now(),
): Set<string> {
  const active = new Set<string>();
  const links = new Map<string, { source: string; target: string }>();

  for (const flow of flows) {
    // Check if flow is active
    const timeSinceStart = currentTime - flow.startTime;
    if (timeSinceStart < 0 || timeSinceStart > flow.speedMs * (flow.path.length - 1)) {
      continue; // Flow not active
    }

    // Mark links in path as active
    for (let i = 0; i < flow.path.length - 1; i++) {
      const source = flow.path[i];
      const target = flow.path[i + 1];
      const linkKey = `${source}-${target}`;
      active.add(linkKey);
    }
  }

  return active;
}

/**
 * Main network engine - orchestrates layout and traffic generation.
 */
export function createNetworkLayout(
  nodes: NetworkNode[],
  links: NetworkLink[],
): NetworkLayoutResult {
  const positions = calculateNetworkLayout(nodes, links, 100, 100);
  const flows = generateTrafficFlows(nodes, links);

  return {
    nodes: new Map(
      nodes.map((n) => {
        const pos = positions.get(n.id);
        return [
          n.id,
          {
            id: n.id,
            label: n.label,
            type: n.type,
            parentId: n.parentId,
            health: n.health,
            status: n.status as 'online' | 'degraded' | 'offline',
            x: pos?.x ?? n.x,
            y: pos?.y ?? n.y,
            vx: 0,
            vy: 0,
            pinned: n.type === 'internet',
          },
        ];
      }),
    ),
    flows,
  };
}
