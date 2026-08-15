/**
 * Network path calculation for realistic traffic animation.
 *
 * Calculates the actual network path that traffic should follow through
 * the infrastructure hierarchy, ensuring traffic traverses from source to
 * destination through all intermediate parent nodes.
 */

import type { NetworkLink, NetworkNode } from '@/types';

interface PathLink {
  linkId: string;
  source: string;
  target: string;
  direction: 'forward' | 'backward';
}

/**
 * Find the path from source to target through the topology hierarchy.
 *
 * Example: If uptime-kuma (container) is inside debian01 (VM) which is on PVE0,
 * and the traffic destination is Internet:
 *
 * Path: uptime-kuma → debian01 → PVE0 → switch → router → internet
 *
 * @param sourceId Starting node ID
 * @param targetId Destination node ID
 * @param nodes All nodes in the topology
 * @param links All links in the topology
 * @returns Array of link IDs representing the path, or empty array if no path found
 */
export function findNetworkPath(
  sourceId: string,
  targetId: string,
  nodes: NetworkNode[],
  links: NetworkLink[],
): PathLink[] {
  if (sourceId === targetId) return [];

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const linkMap = new Map<string, NetworkLink>();
  const linksBySource = new Map<string, NetworkLink[]>();
  const linksByTarget = new Map<string, NetworkLink[]>();

  // Build efficient lookup maps
  for (const link of links) {
    linkMap.set(link.id, link);
    if (!linksBySource.has(link.source)) linksBySource.set(link.source, []);
    if (!linksByTarget.has(link.target)) linksByTarget.set(link.target, []);
    linksBySource.get(link.source)!.push(link);
    linksByTarget.get(link.target)!.push(link);
  }

  // Find common ancestor of source and target
  function getAncestors(nodeId: string): string[] {
    const ancestors: string[] = [];
    let current = nodeId;
    while (current) {
      ancestors.push(current);
      const node = nodeMap.get(current);
      if (!node || !node.parentId) break;
      current = node.parentId;
    }
    return ancestors;
  }

  const sourceAncestors = getAncestors(sourceId);
  const targetAncestors = getAncestors(targetId);

  // Find lowest common ancestor
  let commonAncestorIdx = -1;
  for (let i = sourceAncestors.length - 1; i >= 0; i--) {
    if (targetAncestors.includes(sourceAncestors[i])) {
      commonAncestorIdx = i;
      break;
    }
  }

  const path: PathLink[] = [];

  // Path from source to common ancestor
  for (let i = 0; i < commonAncestorIdx; i++) {
    const from = sourceAncestors[i];
    const to = sourceAncestors[i + 1];

    // Find direct link or through intermediaries
    const linksFromTo = linksBySource.get(from)?.filter((l) => l.target === to) ?? [];
    if (linksFromTo.length > 0) {
      path.push({
        linkId: linksFromTo[0].id,
        source: from,
        target: to,
        direction: 'forward',
      });
    }
  }

  // Path from common ancestor to target
  if (commonAncestorIdx >= 0) {
    const commonAncestor = sourceAncestors[commonAncestorIdx];
    const targetPathFromCommon: string[] = [];
    let current = targetId;
    while (current !== commonAncestor) {
      targetPathFromCommon.unshift(current);
      const node = nodeMap.get(current);
      if (!node?.parentId) break;
      current = node.parentId;
    }
    targetPathFromCommon.unshift(commonAncestor);

    for (let i = 0; i < targetPathFromCommon.length - 1; i++) {
      const from = targetPathFromCommon[i];
      const to = targetPathFromCommon[i + 1];

      const linksFromTo = linksBySource.get(from)?.filter((l) => l.target === to) ?? [];
      if (linksFromTo.length > 0) {
        path.push({
          linkId: linksFromTo[0].id,
          source: from,
          target: to,
          direction: 'forward',
        });
      }
    }
  }

  return path;
}

/**
 * Generate a realistic traffic event that follows an actual network path.
 */
export interface TrafficEvent {
  id: string;
  sourcePath: PathLink[];
  returnPath: PathLink[];
  direction: 'outbound' | 'inbound';
  startTime: number;
  intensity: number; // 0-1, affects how visible the traffic is
}

/**
 * Calculate traffic patterns based on topology.
 * Returns a list of traffic events that continuously flow through the network.
 *
 * Traffic is asynchronous and varies in intensity based on node types.
 */
export function generateTrafficEvents(
  nodes: NetworkNode[],
  links: NetworkLink[],
): TrafficEvent[] {
  const events: TrafficEvent[] = [];
  const eventId = (i: number) => `traffic-${i}`;
  const now = Date.now();

  // Generate traffic from various internal nodes toward external nodes
  let eventIdx = 0;

  // Find common destination endpoints
  const internet = nodes.find((n) => n.type === 'internet');
  const containerNodes = nodes.filter((n) => n.type === 'container' || n.type === 'docker');
  const hypervisors = nodes.filter((n) => n.type === 'hypervisor');

  if (internet) {
    // Create outbound traffic from various sources to internet
    const sources = [
      ...containerNodes.slice(0, 3),
      ...hypervisors.slice(0, 2),
      ...nodes.filter((n) => n.type === 'docker').slice(0, 2),
    ].filter((n) => n.id !== internet.id);

    for (const source of sources) {
      const outboundPath = findNetworkPath(source.id, internet.id, nodes, links);
      const inboundPath = findNetworkPath(internet.id, source.id, nodes, links);

      if (outboundPath.length > 0) {
        events.push({
          id: eventId(eventIdx++),
          sourcePath: outboundPath,
          returnPath: inboundPath,
          direction: 'outbound',
          startTime: now + Math.random() * 3000, // Stagger start times
          intensity: 0.4 + Math.random() * 0.6,
        });
      }
    }
  }

  // Create peer-to-peer traffic between compute nodes
  for (let i = 0; i < hypervisors.length && i < 2; i++) {
    for (let j = i + 1; j < hypervisors.length && j < i + 2; j++) {
      const path = findNetworkPath(hypervisors[i].id, hypervisors[j].id, nodes, links);
      const returnPath = findNetworkPath(hypervisors[j].id, hypervisors[i].id, nodes, links);

      if (path.length > 0) {
        events.push({
          id: eventId(eventIdx++),
          sourcePath: path,
          returnPath,
          direction: 'outbound',
          startTime: now + Math.random() * 5000,
          intensity: 0.3 + Math.random() * 0.5,
        });
      }
    }
  }

  return events;
}
