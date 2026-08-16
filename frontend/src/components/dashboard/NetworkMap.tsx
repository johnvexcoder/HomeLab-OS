import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Globe, Network, RefreshCw, WifiOff, X, Radio } from 'lucide-react';
import { useNetwork } from '@/hooks/useQueries';
import { NETWORK_NODE_ICONS_FRONTEND } from '@/lib/constants';
import type { NetworkNode, NetworkLink } from '@/types';
import { Card, CardHeader } from '@/components/ui/Card';
import { formatMbps } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { generateTraffic, topologySignature, type TrafficEvent } from '@/lib/trafficEngine';

const VB_W = 800;
const VB_H = 340;

/**
 * Traffic direction colors:
 *  - INBOUND  (data arriving: Internet → service, downloads/requests) → cyan
 *  - OUTBOUND (data leaving:  service → Internet, uploads/responses)  → green
 */
const IN_COLOR = '#22D3EE';
const OUT_COLOR = 'var(--accent)';

/** Twin-cable split (viewBox units) between the inbound/outbound arcs. */
const CABLE_SPLIT = 7;

const LINK_COLOR = {
  healthy: 'var(--accent)',
  warning: '#F59E0B',
  critical: '#EF4444',
  unknown: '#6B7280',
} as const;

type LinkStatus = keyof typeof LINK_COLOR;

const NODE_STATUS_RING = {
  online: '#34D399',
  degraded: '#F59E0B',
  offline: '#EF4444',
} as const;

const NODE_TYPE_LABEL: Record<NetworkNode['type'], string> = {
  internet: 'Internet',
  router: 'Gateway',
  switch: 'Switch',
  hypervisor: 'Hypervisor',
  docker: 'Docker',
  container: 'Container',
  storage: 'Storage',
};

type ExternalState = 'reachable' | 'degraded' | 'unreachable';

function normalizeStatus(status: NetworkLink['status'] | undefined): LinkStatus {
  if (!status) return 'unknown';
  return status in LINK_COLOR ? (status as LinkStatus) : 'unknown';
}

const LINK_STATUS_LABEL: Record<LinkStatus, string> = {
  healthy: 'Healthy',
  warning: 'Degraded',
  critical: 'Offline',
  unknown: 'Unknown',
};

const NODE_STATUS_LABEL: Record<NetworkNode['status'], string> = {
  online: 'Online',
  degraded: 'Degraded',
  offline: 'Offline',
};

/** Cubic "S" cable routing (enterprise-style, no harsh diagonals). */
function cableCurve(
  src: NetworkNode,
  dst: NetworkNode,
  offset: number,
): { d: string; x1: number; y1: number; x2: number; y2: number; hx: number } {
  const x1 = (src.x / 100) * VB_W;
  const y1 = (src.y / 100) * VB_H;
  const x2 = (dst.x / 100) * VB_W;
  const y2 = (dst.y / 100) * VB_H;
  const hx = Math.min(Math.abs(x2 - x1) * 0.45, 110);
  return {
    d: `M ${x1} ${y1} C ${x1 + hx} ${y1 + offset}, ${x2 - hx} ${y2 + offset}, ${x2} ${y2}`,
    x1,
    y1,
    x2,
    y2,
    hx,
  };
}

export function NetworkMap() {
  const { topology, refetch, isLoading, error } = useNetwork();
  const nodes = topology?.nodes ?? [];
  const links = topology?.links ?? [];

  const [hoveredLink, setHoveredLink] = useState<NetworkLink | null>(null);
  const [selectedLink, setSelectedLink] = useState<NetworkLink | null>(null);
  const [hoveredNode, setHoveredNode] = useState<NetworkNode | null>(null);
  const [selectedNode, setSelectedNode] = useState<NetworkNode | null>(null);

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // Traffic events are keyed off a stable topology signature so packets do not
  // restart every time the 5s telemetry refetch produces fresh objects.
  const signature = useMemo(() => topologySignature(nodes, links), [nodes, links]);
  const trafficEvents = useMemo(() => generateTraffic(nodes, links), [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  const external = useMemo<ExternalState>(() => {
    const wan = links.find((l) => l.source === 'internet' || l.target === 'internet');
    if (!wan) return 'reachable';
    const st = normalizeStatus(wan.status);
    if (st === 'critical') return 'unreachable';
    if (st === 'warning') return 'degraded';
    return 'reachable';
  }, [links]);

  const externalMeta = {
    reachable: { label: 'External access: reachable', tone: 'text-emerald-400', dot: 'bg-emerald-400' },
    degraded: { label: 'External access: degraded', tone: 'text-warn', dot: 'bg-warn' },
    unreachable: { label: 'External access: unreachable', tone: 'text-crit', dot: 'bg-crit' },
  } as const;

  const totalTx = useMemo(() => links.reduce((a, l) => a + l.throughputMbps, 0), [links]);
  const aggregateLabel =
    totalTx >= 10
      ? totalTx.toLocaleString(undefined, { maximumFractionDigits: 0 })
      : totalTx.toLocaleString(undefined, { maximumFractionDigits: 1 });

  /** Curve midpoint (%) for tooltip anchoring. */
  const linkMid = (link: NetworkLink) => {
    const src = nodeById.get(link.source);
    const dst = nodeById.get(link.target);
    if (!src || !dst) return null;
    return {
      mx: (src.x + dst.x) / 2,
      my: (src.y + dst.y) / 2,
    };
  };

  const tooltip = hoveredLink ? linkMid(hoveredLink) : null;

  const selectLink = (link: NetworkLink) => {
    setSelectedLink(link);
    setSelectedNode(null);
  };
  const selectNode = (node: NetworkNode) => {
    setSelectedNode(node);
    setSelectedLink(null);
  };

  return (
    <Card className="h-full">
      <CardHeader
        title="Network Map"
        subtitle="Left-to-right topology · live traffic"
        icon={<Network className="h-[18px] w-[18px]" />}
        action={
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1 text-xs font-medium text-text-muted transition-colors hover:text-accent cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        }
      />

      <div className="relative overflow-hidden rounded-xl border border-surface-border bg-[#0B0B0B]">
        <div className="grid-backdrop absolute inset-0" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent to-black/30" />

        <div className="relative aspect-[800/540] w-full sm:aspect-[800/400]">
          {/* Link layer (base cables + traveling packets) */}
          <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
            <defs>
              <style>{`
                @keyframes net-cable-pulse {
                  0%, 100% { opacity: 1; }
                  50% { opacity: 0.4; }
                }
                @keyframes homelab-signal-warn {
                  0% { stroke-dashoffset: 0; }
                  32% { stroke-dashoffset: -45; }
                  72% { stroke-dashoffset: -45; }
                  100% { stroke-dashoffset: -100; }
                }
                .net-base { transition: stroke 600ms ease, stroke-opacity 600ms ease; }
                .net-glow { pointer-events: none; }
                .net-cable-pulse { animation: net-cable-pulse 4.5s ease-in-out infinite; }
                .link-active .net-base { stroke-opacity: 0.9; }
                .net-signal {
                  stroke-linecap: round;
                  transition: stroke 600ms ease, opacity 600ms ease;
                }
                .net-signal-warning { animation: homelab-signal-warn 5.5s ease-in-out infinite alternate; opacity: 0.75; }
                .net-packet { pointer-events: none; }
                @media (prefers-reduced-motion: reduce) {
                  .net-packet { display: none; }
                  .net-signal { animation: none !important; opacity: 0; }
                  .net-cable-pulse { animation: none !important; }
                }
              `}</style>
            </defs>
            {links.map((link, i) => {
              const src = nodeById.get(link.source);
              const dst = nodeById.get(link.target);
              if (!src || !dst) return null;
              return (
                <LinkLayer
                  key={link.id}
                  link={link}
                  src={src}
                  dst={dst}
                  index={i}
                  active={hoveredLink?.id === link.id || selectedLink?.id === link.id}
                  onHover={() => setHoveredLink(link)}
                  onLeave={() => setHoveredLink((h) => (h?.id === link.id ? null : h))}
                  onSelect={() => selectLink(link)}
                />
              );
            })}

            {/* Multi-hop + ambient traffic packets */}
            <TrafficLayer events={trafficEvents} nodeById={nodeById} />
          </svg>

          {/* Hover tooltip (link or node) */}
          {((hoveredLink && tooltip) || hoveredNode) && (
            <div
              className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-[120%]"
              style={{
                left: `${(hoveredNode?.x ?? tooltip!.mx)}%`,
                top: `${(hoveredNode ? hoveredNode.y + 6 : tooltip!.my)}%`,
              }}
            >
              <div className="w-[min(190px,calc(100vw-3rem))] rounded-lg border border-surface-border bg-black/85 p-2.5 shadow-xl backdrop-blur-sm">
                {hoveredNode ? (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{NETWORK_NODE_ICONS_FRONTEND[hoveredNode.type]}</span>
                      <div className="min-w-0">
                        <span className="block truncate text-[11px] font-semibold text-text-primary">{hoveredNode.label}</span>
                        <span className="block text-[10px] text-text-muted">{NODE_TYPE_LABEL[hoveredNode.type]}</span>
                      </div>
                      <span
                        className="ml-auto flex shrink-0 items-center gap-1.5 text-[10px] font-medium"
                        style={{ color: NODE_STATUS_RING[(hoveredNode.status || 'online') as keyof typeof NODE_STATUS_RING] }}
                      >
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: NODE_STATUS_RING[(hoveredNode.status || 'online') as keyof typeof NODE_STATUS_RING] }}
                        />
                        {NODE_STATUS_LABEL[hoveredNode.status]}
                      </span>
                    </div>
                    {hoveredNode.ip && (
                      <div className="mt-1.5 font-mono text-[10px] text-text-muted">{hoveredNode.ip}</div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-[11px] font-semibold text-text-primary">
                        {hoveredLink!.source} → {hoveredLink!.target}
                      </span>
                      <span
                        className="flex items-center gap-1.5 text-[10px] font-medium"
                        style={{ color: LINK_COLOR[normalizeStatus(hoveredLink!.status)] }}
                      >
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: LINK_COLOR[normalizeStatus(hoveredLink!.status)] }}
                        />
                        {LINK_STATUS_LABEL[normalizeStatus(hoveredLink!.status)]}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-3 text-[11px] text-text-muted">
                      <span className="flex items-center gap-1">
                        <Radio className="h-3 w-3" />
                        {hoveredLink!.latencyMs.toFixed(1)} ms
                      </span>
                      <span>{formatMbps(hoveredLink!.throughputMbps)}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Detail panel (node or connection, click) */}
          {(selectedNode || selectedLink) && (
            <div className="absolute inset-x-3 bottom-3 z-20 rounded-xl border border-surface-border bg-black/85 p-3 shadow-xl backdrop-blur-sm sm:inset-x-auto sm:right-3 sm:w-64">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-text-primary">
                  {selectedNode ? 'Device details' : 'Connection details'}
                </span>
                <button
                  onClick={() => {
                    setSelectedNode(null);
                    setSelectedLink(null);
                  }}
                  className="text-text-muted transition-colors hover:text-text-primary cursor-pointer"
                  aria-label="Close details"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              {selectedNode ? (
                <dl className="space-y-1.5 text-[11px]">
                  <DetailRow label="Name">
                    <span className="flex items-center gap-1.5">
                      <span>{NETWORK_NODE_ICONS_FRONTEND[selectedNode.type]}</span>
                      <span className="font-medium text-text-primary">{selectedNode.label}</span>
                    </span>
                  </DetailRow>
                  <DetailRow label="Type">{NODE_TYPE_LABEL[selectedNode.type]}</DetailRow>
                  <DetailRow label="ID">
                    <span className="font-mono">{selectedNode.id}</span>
                  </DetailRow>
                  <DetailRow label="Status">
                    <span
                      className="flex items-center gap-1.5 font-medium"
                      style={{ color: NODE_STATUS_RING[(selectedNode.status || 'online') as keyof typeof NODE_STATUS_RING] }}
                    >
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: NODE_STATUS_RING[(selectedNode.status || 'online') as keyof typeof NODE_STATUS_RING] }}
                      />
                      {NODE_STATUS_LABEL[selectedNode.status]}
                    </span>
                  </DetailRow>
                  {selectedNode.ip && <DetailRow label="IP address"><span className="font-mono">{selectedNode.ip}</span></DetailRow>}
                  <DetailRow label="Health">{Math.round(selectedNode.health)} / 100</DetailRow>
                  {selectedNode.parentId && (
                    <DetailRow label="Uplink">
                      <span className="font-mono">{nodeById.get(selectedNode.parentId)?.label ?? selectedNode.parentId}</span>
                    </DetailRow>
                  )}
                </dl>
              ) : (
                <dl className="space-y-1.5 text-[11px]">
                  <DetailRow label="Path">
                    <span className="font-mono">{selectedLink!.source} → {selectedLink!.target}</span>
                  </DetailRow>
                  <DetailRow label="Status">
                    <span className="flex items-center gap-1.5 font-medium" style={{ color: LINK_COLOR[normalizeStatus(selectedLink!.status)] }}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: LINK_COLOR[normalizeStatus(selectedLink!.status)] }} />
                      {LINK_STATUS_LABEL[normalizeStatus(selectedLink!.status)]}
                    </span>
                  </DetailRow>
                  <DetailRow label="Latency">{selectedLink!.latencyMs.toFixed(1)} ms</DetailRow>
                  <DetailRow label="Jitter">{selectedLink!.jitterMs.toFixed(1)} ms</DetailRow>
                  <DetailRow label="Packet loss">{selectedLink!.packetLoss.toFixed(1)}%</DetailRow>
                  <DetailRow label="Throughput">{formatMbps(selectedLink!.throughputMbps)}</DetailRow>
                </dl>
              )}
            </div>
          )}

          {/* Node layer (HTML for full styling freedom) */}
          {nodes.map((originalNode, i) => {
            const nodeStatus = (originalNode.status || 'online') as keyof typeof NODE_STATUS_RING;
            const nodeType = originalNode.type;
            const isInteractive = hoveredNode?.id === originalNode.id || selectedNode?.id === originalNode.id;

            return (
              <motion.button
                key={originalNode.id}
                type="button"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4, delay: i * 0.07, ease: [0.16, 1, 0.3, 1] }}
                className="absolute cursor-pointer border-none bg-transparent p-0 outline-none"
                style={{ left: `${originalNode.x}%`, top: `${originalNode.y}%` }}
                onMouseEnter={() => setHoveredNode(originalNode)}
                onMouseLeave={() => setHoveredNode((h) => (h?.id === originalNode.id ? null : h))}
                onClick={() => selectNode(originalNode)}
                aria-label={`${originalNode.label} — ${NODE_STATUS_LABEL[originalNode.status]}. Click for details`}
              >
                <div
                  className="-translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1 rounded-lg transition-all duration-200"
                  style={isInteractive ? { boxShadow: '0 0 0 2px ' + NODE_STATUS_RING[nodeStatus] + '55', background: 'rgba(0,0,0,0.25)' } : undefined}
                >
                  {nodeType === 'internet' ? (
                    <div className="relative flex flex-col items-center">
                      <motion.div
                        className="absolute inset-0 rounded-full border"
                        style={{ borderColor: `${NODE_STATUS_RING[nodeStatus]}66` }}
                        animate={{ scale: [1, 1.5], opacity: [0.7, 0] }}
                        transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut' }}
                      />
                      <div
                        className="relative flex h-11 w-11 items-center justify-center rounded-full border-2 bg-[#0F1522] shadow-card sm:h-14 sm:w-14 sm:text-2xl"
                        style={{
                          borderColor: NODE_STATUS_RING[nodeStatus],
                          boxShadow: `0 0 24px ${NODE_STATUS_RING[nodeStatus]}44`,
                        }}
                      >
                        <Globe className="h-5 w-5 sm:h-6 sm:w-6" style={{ color: NODE_STATUS_RING[nodeStatus] }} />
                        <span
                          className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-[#0B0B0B] animate-pulse"
                          style={{ backgroundColor: NODE_STATUS_RING[nodeStatus] }}
                        />
                      </div>
                      <div className="mt-1 rounded-md border border-surface-border bg-black/60 px-2 py-0.5 backdrop-blur-sm">
                        <span className="text-[10px] font-semibold text-text-primary">{originalNode.label}</span>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div
                        className="relative flex h-10 w-10 items-center justify-center rounded-2xl border bg-[#141414] shadow-card transition-all sm:h-12 sm:w-12 sm:text-xl"
                        style={{
                          borderColor: `${NODE_STATUS_RING[nodeStatus]}55`,
                          boxShadow: `0 0 16px ${NODE_STATUS_RING[nodeStatus]}${isInteractive ? '44' : '22'}`,
                        }}
                      >
                        <span>{NETWORK_NODE_ICONS_FRONTEND[nodeType]}</span>
                        <span
                          className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-[#0B0B0B] animate-pulse"
                          style={{ backgroundColor: NODE_STATUS_RING[nodeStatus] }}
                        />
                      </div>
                      <div className="rounded-md border border-surface-border bg-black/60 px-2 py-0.5 backdrop-blur-sm">
                        <span className="text-[10px] font-semibold text-text-primary">{originalNode.label}</span>
                      </div>
                    </>
                  )}
                  {originalNode.ip && <span className="font-mono text-[9px] text-text-muted">{originalNode.ip}</span>}
                </div>
              </motion.button>
            );
          })}

          {isLoading && nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-xs text-text-muted">Loading topology…</span>
            </div>
          )}

          {!isLoading && error && nodes.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
              <WifiOff className="h-8 w-8 text-warn/60" />
              <div className="text-sm text-text-secondary">Unable to load the network map</div>
              <p className="max-w-xs text-xs text-text-muted">
                The backend is unreachable. Make sure it is running, then try again.
              </p>
              <button
                type="button"
                onClick={() => void refetch()}
                className="flex items-center gap-1.5 rounded-xl border border-surface-border px-3.5 py-1.5 text-xs font-semibold text-text-secondary transition-colors hover:border-accent/40 hover:text-accent cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Retry
              </button>
            </div>
          )}

          {!isLoading && !error && nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-xs text-text-muted">No topology data available</span>
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-surface-border px-4 py-2.5">
          <span className="flex items-center gap-1.5 text-[11px] text-text-muted">
            <span className="flex gap-px">
              <span className="h-1.5 w-2 rounded-full" style={{ backgroundColor: IN_COLOR }} />
              <span className="h-1.5 w-2 rounded-full" style={{ backgroundColor: OUT_COLOR }} />
            </span>
            Down · Up
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-text-muted">
            <span className="h-1.5 w-4 rounded-full" style={{ backgroundColor: LINK_COLOR.warning }} />
            Degraded
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-text-muted">
            <span className="h-1.5 w-4 rounded-full" style={{ backgroundColor: LINK_COLOR.critical }} />
            Offline
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-text-muted">
            <span className={cn('h-1.5 w-1.5 rounded-full', externalMeta[external].dot)} />
            <span className={cn('font-medium', externalMeta[external].tone)}>{externalMeta[external].label}</span>
          </span>
          <span className="ml-auto font-mono text-[11px] text-text-muted">
            {aggregateLabel} Mb/s aggregate
          </span>
        </div>
      </div>
    </Card>
  );
}

function LinkLayer({
  link,
  src,
  dst,
  index,
  active,
  onHover,
  onLeave,
  onSelect,
}: {
  link: NetworkLink;
  src: NetworkNode;
  dst: NetworkNode;
  index: number;
  active: boolean;
  onHover: () => void;
  onLeave: () => void;
  onSelect: () => void;
}) {
  const inCurve = cableCurve(src, dst, -CABLE_SPLIT);
  const outCurve = cableCurve(dst, src, CABLE_SPLIT);

  const status = normalizeStatus(link.status);
  const inColor = status === 'healthy' ? IN_COLOR : LINK_COLOR[status];
  const outColor = status === 'healthy' ? OUT_COLOR : LINK_COLOR[status];

  // Activity-based appearance: busier links glow brighter, pulse and carry
  // more packets; idle links stay dim and calm.
  const intensity = Math.min(1, Math.max(0, link.throughputMbps / 1000));
  const baseWidth = 2 + intensity * 2.5;
  const baseOpacity = 0.22 + intensity * 0.45;
  const glowWidth = 6 + intensity * 10;
  const glowOpacity = 0.05 + intensity * 0.12;

  return (
    <g className={cn(active && 'link-active')}>
      {/* Invisible hit area for hover + click (wide stroke, covers both cables) */}
      <path
        d={inCurve.d}
        fill="none"
        stroke="transparent"
        strokeWidth="20"
        pointerEvents="stroke"
        className="cursor-pointer"
        onMouseEnter={onHover}
        onMouseLeave={onLeave}
        onClick={onSelect}
      />

      {/* Soft glow underlay — reads as energized cable */}
      <path
        d={inCurve.d}
        fill="none"
        stroke={inColor}
        strokeOpacity={glowOpacity}
        strokeWidth={glowWidth}
        strokeLinecap="round"
        className="net-glow"
        style={{ filter: `drop-shadow(0 0 ${2 + intensity * 6}px ${inColor})` }}
      />
      <path
        d={outCurve.d}
        fill="none"
        stroke={outColor}
        strokeOpacity={glowOpacity}
        strokeWidth={glowWidth}
        strokeLinecap="round"
        className="net-glow"
        style={{ filter: `drop-shadow(0 0 ${2 + intensity * 6}px ${outColor})` }}
      />

      {/* Base cables */}
      <path
        d={inCurve.d}
        fill="none"
        stroke={inColor}
        strokeOpacity={baseOpacity}
        strokeWidth={baseWidth}
        strokeLinecap="round"
        className={cn('net-base', status === 'healthy' && 'net-cable-pulse')}
        style={{ animationDelay: `${index * 0.37}s` }}
      />
      <path
        d={outCurve.d}
        fill="none"
        stroke={outColor}
        strokeOpacity={baseOpacity}
        strokeWidth={baseWidth}
        strokeLinecap="round"
        className={cn('net-base', status === 'healthy' && 'net-cable-pulse')}
        style={{ animationDelay: `${index * 0.37 + 0.5}s` }}
      />

      {/* Degraded links keep a slow, hesitant status pulse (not real traffic). */}
      {status === 'warning' && (
        <>
          <path
            d={inCurve.d}
            fill="none"
            stroke={inColor}
            strokeWidth="2.5"
            pathLength={100}
            strokeDasharray="5 95"
            className="net-signal net-signal-warning"
            style={{ filter: `drop-shadow(0 0 3px ${inColor})` }}
          />
          <path
            d={outCurve.d}
            fill="none"
            stroke={outColor}
            strokeWidth="2.5"
            pathLength={100}
            strokeDasharray="5 95"
            className="net-signal net-signal-warning"
            style={{ filter: `drop-shadow(0 0 3px ${outColor})` }}
          />
        </>
      )}
    </g>
  );
}

/**
 * Renders animated packets riding the real multi-hop path: outbound follows the
 * green (below) cables node→…→internet, inbound follows the cyan (above)
 * cables internet→…→node. Pure SVG animateMotion — zero JS timers per packet,
 * with spline easing so motion feels organic (never perfectly synchronized).
 */
function TrafficLayer({ events, nodeById }: { events: TrafficEvent[]; nodeById: Map<string, NetworkNode> }) {
  return (
    <g className="net-traffic">
      {events.map((ev) => {
        const d = buildPacketPath(ev.path, nodeById, ev.direction);
        if (!d) return null;
        const color = ev.direction === 'inbound' ? IN_COLOR : OUT_COLOR;
        const durS = ev.dur / 1000;
        const burst = ev.count >= 3;
        // Organic speed profile: gentle acceleration then deceleration, biased
        // per event so nothing moves in lockstep.
        const kt = `0;${(0.3 + ev.pace * 0.25).toFixed(3)};${(0.7 - ev.pace * 0.1).toFixed(3)};1`;
        const kp = '0;0.5;0.9;1';
        const ks = '0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1';
        return Array.from({ length: ev.count }).map((_, i) => {
          const stagger = (i * (ev.dur / ev.count)) / 1000;
          const isBurst = burst && i === ev.count - 1;
          return (
            <g
              key={`${ev.id}-${i}`}
              className="net-packet"
              style={{ filter: `drop-shadow(0 0 ${isBurst ? 5 : 2.5}px ${color})` }}
            >
              <circle r={isBurst ? 3.4 : 2.4} fill={color} />
              <animateMotion
                dur={`${durS}s`}
                begin={`${(ev.begin + stagger).toFixed(3)}s`}
                path={d}
                repeatCount="indefinite"
                calcMode="spline"
                keyTimes={kt}
                keyPoints={kp}
                keySplines={ks}
              />
            </g>
          );
        });
      })}
    </g>
  );
}

/**
 * Concatenates the per-hop cable curves for a traversal path so a packet moves
 * seamlessly across every edge (no teleporting). Inbound rides the upper arc,
 * outbound the lower arc — mirroring the base cables exactly.
 */
function buildPacketPath(
  path: string[],
  nodeById: Map<string, NetworkNode>,
  direction: 'outbound' | 'inbound',
): string | null {
  const points = path.map((id) => nodeById.get(id)).filter(Boolean) as NetworkNode[];
  if (points.length < 2) return null;

  const offset = direction === 'inbound' ? -CABLE_SPLIT : CABLE_SPLIT;
  let d = '';
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const { x1, y1, x2, y2, hx } = cableCurve(a, b, offset);
    if (i === 0) d += `M ${x1} ${y1}`;
    d += ` C ${x1 + hx} ${y1 + offset}, ${x2 - hx} ${y2 + offset}, ${x2} ${y2}`;
  }
  return d;
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-text-muted">{label}</dt>
      <dd className="font-medium text-text-primary tabular">{children}</dd>
    </div>
  );
}
