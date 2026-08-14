import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Globe, Network, RefreshCw, WifiOff, X, Radio } from 'lucide-react';
import { useNetwork } from '@/hooks/useQueries';
import { NETWORK_NODE_ICONS_FRONTEND } from '@/lib/constants';
import type { NetworkNode, NetworkLink } from '@/types';
import { Card, CardHeader } from '@/components/ui/Card';
import { formatMbps } from '@/lib/utils';
import { cn } from '@/lib/utils';

const VB_W = 800;
const VB_H = 340;

/** Inbound (data arriving) rides the active accent, outbound (data leaving) rides cyan. */
const IN_COLOR = 'var(--accent)';
const OUT_COLOR = '#22D3EE';

/**
 * Cable appearance is driven by link status. Healthy keeps the green/cyan
 * inbound-outbound identity; degraded, offline and unknown collapse both
 * cables to a single status color so the eye reads state at a glance.
 */
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

export function NetworkMap() {
  const { topology, refetch, isLoading, error } = useNetwork();
  const nodes = topology?.nodes ?? [];
  const links = topology?.links ?? [];

  const [hovered, setHovered] = useState<NetworkLink | null>(null);
  const [selected, setSelected] = useState<NetworkLink | null>(null);

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

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

  const totalTx = useMemo(
    () => links.reduce((a, l) => a + l.throughputMbps, 0),
    [links],
  );

  /** Approximate curve midpoint (percent coords) for tooltip anchoring. */
  const midpoint = (link: NetworkLink) => {
    const src = nodeById.get(link.source);
    const dst = nodeById.get(link.target);
    if (!src || !dst) return null;
    return {
      mx: (src.x + dst.x) / 2,
      my: (src.y + dst.y) / 2 + Math.abs(dst.x - src.x) * 0.08,
    };
  };

  const hoverMid = hovered ? midpoint(hovered) : null;

  return (
    <Card className="h-full">
      <CardHeader
        title="Network Map"
        subtitle="Live traffic in & out"
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

        <div className="relative aspect-[800/340] w-full">
          {/* Link layer (base cable + traveling signal) */}
          <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
            <defs>
              <style>{`
                @keyframes homelab-signal {
                  from { stroke-dashoffset: 0; }
                  to { stroke-dashoffset: -100; }
                }
                @keyframes homelab-signal-warn {
                  0% { stroke-dashoffset: 0; }
                  32% { stroke-dashoffset: -45; }
                  72% { stroke-dashoffset: -45; }
                  100% { stroke-dashoffset: -100; }
                }
                .net-signal {
                  stroke-linecap: round;
                  transition: stroke 600ms ease, opacity 600ms ease;
                }
                /* healthy: fast ping-pong, travels to endpoint then reverses */
                .net-signal-healthy { animation: homelab-signal 2.2s ease-in-out infinite alternate; }
                /* degraded: slow, hesitant, with dwell pauses */
                .net-signal-warning { animation: homelab-signal-warn 5.5s ease-in-out infinite alternate; opacity: 0.75; }
                /* offline / unknown: cable stays visible, signal hidden */
                .net-signal-critical { opacity: 0; }
                .net-signal-unknown { opacity: 0; }
                .net-base { transition: stroke 600ms ease, stroke-opacity 600ms ease; }
                .link-active .net-base { stroke-opacity: 0.65; }
                @media (prefers-reduced-motion: reduce) {
                  .net-signal { animation: none !important; opacity: 0; }
                }
              `}</style>
            </defs>
            {links.map((link) => {
              const src = nodeById.get(link.source);
              const dst = nodeById.get(link.target);
              if (!src || !dst) return null;
              return (
                <LinkLayer
                  key={link.id}
                  link={link}
                  src={src}
                  dst={dst}
                  active={hovered?.id === link.id || selected?.id === link.id}
                  onHover={() => setHovered(link)}
                  onLeave={() => setHovered((h) => (h?.id === link.id ? null : h))}
                  onSelect={() => setSelected(link)}
                />
              );
            })}
          </svg>

          {/* Hover tooltip */}
          {hovered && hoverMid && (
            <div
              className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-[120%]"
              style={{ left: `${hoverMid.mx}%`, top: `${hoverMid.my}%` }}
            >
              <div className="min-w-[190px] rounded-lg border border-surface-border bg-black/85 p-2.5 shadow-xl backdrop-blur-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[11px] font-semibold text-text-primary">
                    {hovered.source} → {hovered.target}
                  </span>
                  <span
                    className="flex items-center gap-1.5 text-[10px] font-medium"
                    style={{ color: LINK_COLOR[normalizeStatus(hovered.status)] }}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: LINK_COLOR[normalizeStatus(hovered.status)] }}
                    />
                    {LINK_STATUS_LABEL[normalizeStatus(hovered.status)]}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-3 text-[11px] text-text-muted">
                  <span className="flex items-center gap-1">
                    <Radio className="h-3 w-3" />
                    {hovered.latencyMs.toFixed(1)} ms
                  </span>
                  <span>{formatMbps(hovered.throughputMbps)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Connection detail panel (click) */}
          {selected && (
            <div className="absolute bottom-3 right-3 z-20 w-60 rounded-xl border border-surface-border bg-black/85 p-3 shadow-xl backdrop-blur-sm">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-text-primary">Connection details</span>
                <button
                  onClick={() => setSelected(null)}
                  className="text-text-muted transition-colors hover:text-text-primary cursor-pointer"
                  aria-label="Close connection details"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <dl className="space-y-1.5 text-[11px]">
                <DetailRow label="Path">
                  <span className="font-mono">{selected.source} → {selected.target}</span>
                </DetailRow>
                <DetailRow label="Status">
                  <span className="flex items-center gap-1.5 font-medium" style={{ color: LINK_COLOR[normalizeStatus(selected.status)] }}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: LINK_COLOR[normalizeStatus(selected.status)] }} />
                    {LINK_STATUS_LABEL[normalizeStatus(selected.status)]}
                  </span>
                </DetailRow>
                <DetailRow label="Latency">{selected.latencyMs.toFixed(1)} ms</DetailRow>
                <DetailRow label="Jitter">{selected.jitterMs.toFixed(1)} ms</DetailRow>
                <DetailRow label="Packet loss">{selected.packetLoss.toFixed(1)}%</DetailRow>
                <DetailRow label="Throughput">{formatMbps(selected.throughputMbps)}</DetailRow>
              </dl>
            </div>
          )}

          {/* Node layer (HTML for full styling freedom) */}
          {nodes.map((node, i) => (
            <motion.div
              key={node.id}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, delay: i * 0.07, ease: [0.16, 1, 0.3, 1] }}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${node.x}%`, top: `${node.y}%` }}
            >
              <div className="flex flex-col items-center gap-1">
                {node.type === 'internet' ? (
                  <div className="relative flex flex-col items-center">
                    <motion.div
                      className="absolute inset-0 rounded-full border"
                      style={{ borderColor: `${NODE_STATUS_RING[node.status]}66` }}
                      animate={{ scale: [1, 1.5], opacity: [0.7, 0] }}
                      transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut' }}
                    />
                    <div
                      className="relative flex h-14 w-14 items-center justify-center rounded-full border-2 bg-[#0F1522] text-2xl shadow-card"
                      style={{
                        borderColor: NODE_STATUS_RING[node.status],
                        boxShadow: `0 0 24px ${NODE_STATUS_RING[node.status]}44`,
                      }}
                    >
                      <Globe className="h-6 w-6" style={{ color: NODE_STATUS_RING[node.status] }} />
                      <span
                        className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-[#0B0B0B] animate-pulse"
                        style={{ backgroundColor: NODE_STATUS_RING[node.status] }}
                      />
                    </div>
                    <div className="mt-1 rounded-md border border-surface-border bg-black/60 px-2 py-0.5 backdrop-blur-sm">
                      <span className="text-[10px] font-semibold text-text-primary">{node.label}</span>
                    </div>
                  </div>
                ) : (
                  <>
                    <div
                      className="flex h-12 w-12 items-center justify-center rounded-2xl border bg-[#141414] text-xl shadow-card transition-all"
                      style={{ borderColor: `${NODE_STATUS_RING[node.status]}55`, boxShadow: `0 0 16px ${NODE_STATUS_RING[node.status]}22` }}
                    >
                      <span>{NETWORK_NODE_ICONS_FRONTEND[node.type]}</span>
                      <span
                        className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-[#0B0B0B] animate-pulse"
                        style={{ backgroundColor: NODE_STATUS_RING[node.status] }}
                      />
                    </div>
                    <div className="rounded-md border border-surface-border bg-black/60 px-2 py-0.5 backdrop-blur-sm">
                      <span className="text-[10px] font-semibold text-text-primary">{node.label}</span>
                    </div>
                  </>
                )}
                {node.ip && <span className="font-mono text-[9px] text-text-muted">{node.ip}</span>}
              </div>
            </motion.div>
          ))}

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
            Healthy
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
            {totalTx.toLocaleString(undefined, { maximumFractionDigits: 0 })} Mb/s aggregate
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
  active,
  onHover,
  onLeave,
  onSelect,
}: {
  link: NetworkLink;
  src: NetworkNode;
  dst: NetworkNode;
  active: boolean;
  onHover: () => void;
  onLeave: () => void;
  onSelect: () => void;
}) {
  const x1 = (src.x / 100) * VB_W;
  const y1 = (src.y / 100) * VB_H;
  const x2 = (dst.x / 100) * VB_W;
  const y2 = (dst.y / 100) * VB_H;

  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2 + Math.abs(x2 - x1) * 0.12;

  // Twin cables: inbound rides above the centerline, outbound below.
  const dIn = `M ${x1} ${y1} Q ${mx} ${my - 7} ${x2} ${y2}`;
  const dOut = `M ${x2} ${y2} Q ${mx} ${my + 7} ${x1} ${y1}`;

  const status = normalizeStatus(link.status);
  const inColor = status === 'healthy' ? IN_COLOR : LINK_COLOR[status];
  const outColor = status === 'healthy' ? OUT_COLOR : LINK_COLOR[status];

  return (
    <g className={cn(active && 'link-active')}>
      {/* Invisible hit area for hover + click (wide stroke, covers both cables) */}
      <path
        d={dIn}
        fill="none"
        stroke="transparent"
        strokeWidth="20"
        pointerEvents="stroke"
        className="cursor-pointer"
        onMouseEnter={onHover}
        onMouseLeave={onLeave}
        onClick={onSelect}
      />

      {/* Base cables */}
      <path d={dIn} fill="none" stroke={inColor} strokeOpacity="0.28" strokeWidth="2" strokeLinecap="round" className="net-base" />
      <path d={dOut} fill="none" stroke={outColor} strokeOpacity="0.28" strokeWidth="2" strokeLinecap="round" className="net-base" />

      {/* Traveling signal: one pulse per cable that reaches the endpoint, then reverses */}
      <path
        d={dIn}
        fill="none"
        stroke={inColor}
        strokeWidth="2.5"
        pathLength={100}
        strokeDasharray="5 95"
        className={cn('net-signal', `net-signal-${status}`)}
        style={{ filter: `drop-shadow(0 0 3px ${inColor})` }}
      />
      <path
        d={dOut}
        fill="none"
        stroke={outColor}
        strokeWidth="2.5"
        pathLength={100}
        strokeDasharray="5 95"
        className={cn('net-signal', `net-signal-${status}`)}
        style={{ filter: `drop-shadow(0 0 3px ${outColor})` }}
      />
    </g>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-text-muted">{label}</dt>
      <dd className="font-medium text-text-primary tabular">{children}</dd>
    </div>
  );
}
