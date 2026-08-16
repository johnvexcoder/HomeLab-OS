import type { NetworkLink, NetworkNode } from '@/types';

/**
 * Multi-hop traffic engine for the Network Map.
 *
 * Generates animated packets that travel through the REAL topology path — a
 * container's traffic rides every edge up to the Internet (outbound) and back
 * (inbound), never a fake direct container→internet shortcut. Events are
 * deterministic per node so packets stay organic but do not restart whenever
 * telemetry refetches.
 */

export interface TrafficEvent {
  id: string;
  /** Node ids in traversal order. Outbound: source → … → internet. Inbound: internet → … → source. */
  path: string[];
  direction: 'outbound' | 'inbound';
  /** SMIL begin offset (seconds). Negative = already in flight, desynced. */
  begin: number;
  /** Duration of one full traversal (ms). */
  dur: number;
  /** Number of packets rendered for this flow. */
  count: number;
}

/** Stable FNV-1a hash so per-node randomization is reproducible across refetches. */
function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic pseudo-random in [0, 1) for a seed. */
function seeded(seed: string, salt = 0): number {
  const n = hash(`${seed}::${salt}`);
  return (n % 1000) / 1000;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function adjacency(links: NetworkLink[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const link of links) {
    if (!adj.has(link.source)) adj.set(link.source, new Set());
    if (!adj.has(link.target)) adj.set(link.target, new Set());
    adj.get(link.source)!.add(link.target);
    adj.get(link.target)!.add(link.source);
  }
  return adj;
}

/** BFS shortest path between two nodes over the actual link graph. */
export function resolvePath(
  from: string,
  to: string,
  links: NetworkLink[],
  adj: Map<string, Set<string>> = adjacency(links),
): string[] | null {
  if (from === to) return [from];
  const prev = new Map<string, string>();
  const queue = [from];
  const seen = new Set<string>([from]);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const next of adj.get(cur) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      prev.set(next, cur);
      if (next === to) {
        const path = [next];
        let node = cur;
        while (node !== from) {
          path.unshift(node);
          node = prev.get(node)!;
        }
        path.unshift(from);
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

/** Nodes that actually generate outward traffic (everything except the spine). */
const SPINE_TYPES: ReadonlySet<string> = new Set(['internet', 'router', 'switch']);

function linkThroughput(links: NetworkLink[], a: string, b: string): number {
  const link = links.find(
    (l) => (l.source === a && l.target === b) || (l.source === b && l.target === a),
  );
  return link?.throughputMbps ?? 0;
}

function pathHasOfflineLink(path: string[], links: NetworkLink[]): boolean {
  for (let i = 0; i < path.length - 1; i++) {
    const link = links.find(
      (l) =>
        (l.source === path[i] && l.target === path[i + 1]) ||
        (l.source === path[i + 1] && l.target === path[i]),
    );
    if (link && (link.status === 'critical' || link.status === 'warning')) return true;
  }
  return false;
}

/**
 * Build all traffic events from the current topology.
 * Deterministic offsets keep the animation stable between telemetry refetches.
 */
export function generateTraffic(nodes: NetworkNode[], links: NetworkLink[]): TrafficEvent[] {
  const adj = adjacency(links);
  const events: TrafficEvent[] = [];
  const internet = nodes.find((n) => n.type === 'internet');
  if (!internet) return events;

  for (const node of nodes) {
    if (SPINE_TYPES.has(node.type)) continue;
    const path = resolvePath(node.id, internet.id, links, adj);
    if (!path || path.length < 2) continue;
    if (pathHasOfflineLink(path, links)) continue;

    const throughput = linkThroughput(links, node.id, path[1]) || 1;
    const intensity = clamp(throughput / 1000, 0.15, 1);

    // Faster + denser traffic for busier links; ~120–220ms per edge.
    const hopMs = 160 + seeded(node.id, 1) * 80;
    const dur = Math.round(path.length * hopMs);
    const cycleMs = Math.round(clamp(2200 - intensity * 1400, 600, 2200));
    const count = Math.max(1, Math.round(intensity * 5));

    const outbound: TrafficEvent = {
      id: `${node.id}::out`,
      path,
      direction: 'outbound',
      begin: -cycleMs * (0.1 + seeded(node.id, 2) * 0.9),
      dur,
      count,
    };
    const inbound: TrafficEvent = {
      id: `${node.id}::in`,
      path: [...path].reverse(),
      direction: 'inbound',
      begin: -cycleMs * (0.1 + seeded(node.id, 3) * 0.9),
      dur,
      count,
    };
    events.push(outbound, inbound);
  }

  return events;
}

/** Stable signature of the topology — used to avoid regenerating events on refetch. */
export function topologySignature(nodes: NetworkNode[], links: NetworkLink[]): string {
  const n = nodes
    .map((nd) => `${nd.id}:${nd.status}:${Math.round(nd.x * 10)}:${Math.round(nd.y * 10)}`)
    .sort()
    .join('|');
  const l = links
    .map((ln) => `${ln.source}-${ln.target}:${ln.status}`)
    .sort()
    .join('|');
  return `${n}#${l}`;
}
