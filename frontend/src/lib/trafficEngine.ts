import type { NetworkLink, NetworkNode } from '@/types';

/**
 * Multi-hop traffic engine for the Network Map.
 *
 * Generates continuous packet streams along real topology paths.
 * Packets travel node → … → Internet (outbound) and Internet → … → node
 * (inbound) simultaneously. Packet density and speed scale with traffic volume.
 *
 * Bidirectional: outbound packets are cyan, inbound packets are green.
 * Both directions animate independently with organic timing.
 */

export interface TrafficEvent {
  id: string;
  /** Node ids in traversal order. */
  path: string[];
  direction: 'outbound' | 'inbound';
  /** SMIL begin offset (seconds). Negative = already in flight. */
  begin: number;
  /** Duration of one full traversal (ms). */
  dur: number;
  /** Number of packets rendered for this flow. */
  count: number;
  /** 0..1 organic speed-profile seed. */
  pace: number;
}

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seeded(seed: string, salt = 0): number {
  return (hash(`${seed}::${salt}`) % 1000) / 1000;
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

const SPINE_TYPES: ReadonlySet<string> = new Set(['internet', 'gateway', 'switch', 'bridge']);

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
 * Generate all traffic events for the current topology.
 *
 * Two layers:
 * 1. Per-source multi-hop flows — every leaf node generates outbound+inbound
 *    traffic along its real path to the Internet.
 * 2. Ambient per-link traffic — every cable generates its own bidirectional
 *    packets independent of the multi-hop flows.
 */
export function generateTraffic(nodes: NetworkNode[], links: NetworkLink[]): TrafficEvent[] {
  const adj = adjacency(links);
  const events: TrafficEvent[] = [];
  const internet = nodes.find((n) => n.type === 'internet');

  if (internet) {
    for (const node of nodes) {
      if (SPINE_TYPES.has(node.type)) continue;
      const path = resolvePath(node.id, internet.id, links, adj);
      if (!path || path.length < 2) continue;
      if (pathHasOfflineLink(path, links)) continue;

      const throughput = linkThroughput(links, node.id, path[1]) || 1;
      const intensity = clamp(throughput / 1000, 0.15, 1);

      const hopMs = 140 + seeded(node.id, 1) * 80;
      const dur = Math.round(path.length * hopMs);
      const cycleMs = Math.round(clamp(2000 - intensity * 1200, 500, 2000));
      const count = Math.max(2, Math.round(intensity * 5));

      events.push({
        id: `${node.id}::out`,
        path,
        direction: 'outbound',
        begin: -cycleMs * (0.1 + seeded(node.id, 2) * 0.9),
        dur,
        count,
        pace: seeded(node.id, 6),
      });
      events.push({
        id: `${node.id}::in`,
        path: [...path].reverse(),
        direction: 'inbound',
        begin: -cycleMs * (0.1 + seeded(node.id, 3) * 0.9),
        dur,
        count,
        pace: seeded(node.id, 7),
      });
    }
  }

  // Ambient per-link traffic
  for (const link of links) {
    if (link.status === 'critical') continue;
    const a = nodes.find((n) => n.id === link.source);
    const b = nodes.find((n) => n.id === link.target);
    if (!a || !b) continue;

    const intensity = clamp((link.throughputMbps || 0) / 1000, 0.1, 1);
    const hopMs = Math.round(clamp(320 - intensity * 180, 140, 320));
    const cycleMs = Math.round(clamp(2400 - intensity * 1400, 600, 2400));
    const count = Math.max(1, Math.round(intensity * 3));

    events.push(
      {
        id: `${link.id}::seg-ab`,
        path: [a.id, b.id],
        direction: 'inbound',
        begin: -cycleMs * seeded(link.id, 4),
        dur: hopMs,
        count,
        pace: seeded(link.id, 8),
      },
      {
        id: `${link.id}::seg-ba`,
        path: [b.id, a.id],
        direction: 'outbound',
        begin: -cycleMs * seeded(link.id, 5),
        dur: hopMs,
        count,
        pace: seeded(link.id, 9),
      },
    );
  }

  return events;
}

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
