import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Network,
  RefreshCw,
  WifiOff,
  X,
  Cpu,
  Thermometer,
  HardDrive,
  ArrowUpRight,
  Layers,
} from 'lucide-react';
import { useNetwork } from '@/hooks/useQueries';
import { useTelemetryStore, selectServers } from '@/store/telemetry';
import { useShallow } from 'zustand/react/shallow';
import { NETWORK_NODE_ICONS_FRONTEND } from '@/lib/constants';
import { INFRA_ICON_COMPONENTS } from '@/lib/icons';
import type { NetworkNode, NetworkLink, ServerRuntime } from '@/types';
import { Card, CardHeader } from '@/components/ui/Card';
import { cn, formatMbps } from '@/lib/utils';
import { computeTopologyLayout, type TopologyLayout, type CableLayout } from '@/lib/topologyLayout';

const IN_COLOR = '#22D3EE';
const OUT_COLOR = 'var(--accent)';

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

const STATUS_COLOR = {
  online: '#10B981',
  degraded: '#F59E0B',
  offline: '#EF4444',
  unknown: '#6B7280',
} as const;

const STATUS_LABEL: Record<string, string> = {
  online: 'Online',
  degraded: 'Degraded',
  offline: 'Offline',
};

const LINK_COLOR = {
  healthy: '#10B981',
  warning: '#F59E0B',
  critical: '#EF4444',
  unknown: '#6B7280',
} as const;

type LinkStatus = keyof typeof LINK_COLOR;

function normalizeStatus(status: NetworkLink['status'] | undefined): LinkStatus {
  if (!status) return 'unknown';
  return status in LINK_COLOR ? (status as LinkStatus) : 'unknown';
}

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      setSize({ width: r.width, height: r.height });
    }
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]?.contentRect;
      if (entry && entry.width > 0 && entry.height > 0) {
        setSize({ width: entry.width, height: entry.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, size };
}

export function NetworkMap() {
  const { topology, refetch, isLoading, error, isFetching } = useNetwork();
  const servers = useTelemetryStore(useShallow(selectServers));

  const nodes = useMemo(() => topology?.nodes ?? [], [topology]);
  const links = useMemo(() => topology?.links ?? [], [topology]);
  const { ref: containerRef, size: containerSize } = useElementSize<HTMLDivElement>();

  const [hoveredNode, setHoveredNode] = useState<NetworkNode | null>(null);
  const [selectedNode, setSelectedNode] = useState<NetworkNode | null>(null);
  const [hoveredLink, setHoveredLink] = useState<NetworkLink | null>(null);
  const [selectedLink, setSelectedLink] = useState<NetworkLink | null>(null);

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // Lookup full telemetry ServerRuntime for a node
  const serverByNodeId = useMemo(() => {
    const m = new Map<string, ServerRuntime>();
    for (const n of nodes) {
      const match = servers.find(
        (s) =>
          s.spec.id === n.id ||
          s.spec.hostname === n.label ||
          (n.ip && s.spec.ip === n.ip),
      );
      if (match) m.set(n.id, match);
    }
    return m;
  }, [nodes, servers]);

  // ── Layout computation ─────────────────────────────────────────
  const layout: TopologyLayout = useMemo(
    () => computeTopologyLayout(nodes, links),
    [nodes, links],
  );

  const { width: layoutW, height: layoutH, nodes: finalPositions, cables } = layout;

  // ── Automatic centering scale ──────────────────────────────────
  const zoom = useMemo(() => {
    if (containerSize.width === 0 || containerSize.height === 0 || layoutW === 0 || layoutH === 0) {
      return 1;
    }
    const padX = 60;
    const padY = 50;
    const scaleX = (containerSize.width - padX * 2) / layoutW;
    const scaleY = (containerSize.height - padY * 2) / layoutH;
    return Math.min(Math.max(Math.min(scaleX, scaleY), 0.25), 1.15);
  }, [containerSize, layoutW, layoutH]);

  const totalTx = useMemo(() => links.reduce((a, l) => a + l.throughputMbps, 0), [links]);

  return (
    <Card className="h-full">
      <CardHeader
        title="Network Map"
        subtitle="Live NOC infrastructure topology & traffic"
        icon={<Network className="h-[18px] w-[18px]" />}
        action={
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 text-xs font-medium text-text-muted transition-colors hover:text-accent cursor-pointer"
            disabled={isFetching}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} /> Refresh
          </button>
        }
      />

      <div className="relative overflow-hidden rounded-xl border border-surface-border bg-[#090C15]">
        <div className="grid-backdrop absolute inset-0" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent to-black/40" />

        <div
          ref={containerRef}
          className="relative w-full overflow-hidden"
          style={{ height: 500 }}
        >
          {/* ═══════════════════════════════════════════════════════════
              PERFECTLY CENTERED TOPOLOGY CANVAS
              ═══════════════════════════════════════════════════════════ */}
          {nodes.length > 0 && (
            <div
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                transform: `translate(-50%, -50%) scale(${zoom})`,
                transformOrigin: 'center center',
              }}
            >
              <div
                style={{
                  position: 'relative',
                  width: layoutW,
                  height: layoutH,
                }}
              >
                {/* ── SVG Layer (Cables & Light Pulses) ─────────────── */}
                <svg
                  width={layoutW}
                  height={layoutH}
                  style={{ position: 'absolute', top: 0, left: 0 }}
                >
                  <defs>
                    <style>{`
                      @keyframes net-cable-pulse {
                        0%, 100% { opacity: 1; }
                        50% { opacity: 0.35; }
                      }
                      .net-base { transition: stroke 400ms ease, stroke-opacity 400ms ease; }
                      .net-cable-pulse { animation: net-cable-pulse 4s ease-in-out infinite; }
                    `}</style>
                  </defs>

                  {/* Connection Cables */}
                  {links.map((link) => {
                    const cab = cables.get(link.id);
                    if (!cab) return null;
                    const isHovered = hoveredLink?.id === link.id;
                    const isSelected = selectedLink?.id === link.id;

                    return (
                      <CableLayer
                        key={link.id}
                        link={link}
                        cable={cab}
                        hovered={isHovered}
                        selected={isSelected}
                        onHover={() => setHoveredLink(link)}
                        onUnhover={() => setHoveredLink((h) => (h?.id === link.id ? null : h))}
                        onClick={() => {
                          setSelectedLink(link);
                          setSelectedNode(null);
                        }}
                      />
                    );
                  })}

                  {/* Animated Moving Light Packets (Back & Forth) */}
                  <MovingLightPackets links={links} cables={cables} />
                </svg>

                {/* ── HTML Layer (Device Cards) ──────────────────── */}
                {nodes.map((node) => {
                  const p = finalPositions.get(node.id);
                  if (!p) return null;

                  const isHovered = hoveredNode?.id === node.id;
                  const isSelected = selectedNode?.id === node.id;
                  const statusColor = STATUS_COLOR[node.status] ?? STATUS_COLOR.online;
                  const IconComponent = INFRA_ICON_COMPONENTS[node.type];
                  const server = serverByNodeId.get(node.id);

                  return (
                    <div
                      key={node.id}
                      className="absolute"
                      style={{ left: p.x, top: p.y, transform: 'translate(-50%, -50%)' }}
                    >
                      <motion.button
                        type="button"
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.3, ease: 'easeOut' }}
                        className={cn(
                          'group flex cursor-pointer items-center gap-2.5 rounded-xl border bg-[#111625]/90 px-3 py-2 text-left shadow-lg backdrop-blur-md transition-all duration-200 select-none outline-none',
                          isHovered || isSelected
                            ? 'border-accent ring-2 ring-accent/30 shadow-accent/20 translate-y-[-2px]'
                            : 'border-surface-border hover:border-surface-border/80 hover:bg-[#161C2E]',
                        )}
                        style={{
                          boxShadow: isHovered || isSelected ? `0 0 20px ${statusColor}33` : undefined,
                        }}
                        onMouseEnter={() => setHoveredNode(node)}
                        onMouseLeave={() => setHoveredNode((h) => (h?.id === node.id ? null : h))}
                        onClick={() => {
                          setSelectedNode(node);
                          setSelectedLink(null);
                        }}
                      >
                        {/* Node Icon Box */}
                        <div
                          className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-surface-border bg-black/40"
                          style={{ borderColor: `${statusColor}44` }}
                        >
                          {IconComponent ? (
                            <IconComponent size={20} />
                          ) : (
                            <span className="text-base">{NETWORK_NODE_ICONS_FRONTEND[node.type] ?? '📦'}</span>
                          )}
                          {/* Status Indicator Dot */}
                          <span
                            className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-[#090C15]"
                            style={{ backgroundColor: statusColor }}
                          />
                        </div>

                        {/* Node Text Label & IP */}
                        <div className="min-w-0 flex-1 pr-1">
                          <div className="truncate text-xs font-semibold text-text-primary group-hover:text-accent">
                            {node.label}
                          </div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-text-muted">
                            <span className="truncate font-mono">{node.ip ?? (server?.spec.ip || node.type)}</span>
                          </div>
                        </div>
                      </motion.button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════
              BASIC HOVER TOOLTIP (NEAR HOVERED DEVICE / CABLE)
              ═══════════════════════════════════════════════════════════ */}

          {/* Device Hover Basic Tooltip */}
          {hoveredNode && !selectedNode && !selectedLink && (
            (() => {
              const p = finalPositions.get(hoveredNode.id);
              if (!p) return null;

              // Convert centered layout pos to container px
              const cx = containerSize.width / 2;
              const cy = containerSize.height / 2;
              const screenX = cx + (p.x - layoutW / 2) * zoom;
              const screenY = cy + (p.y - layoutH / 2) * zoom;

              const server = serverByNodeId.get(hoveredNode.id);
              return (
                <div
                  className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-[125%]"
                  style={{ left: screenX, top: screenY }}
                >
                  <div className="w-56 rounded-xl border border-surface-border bg-black/90 p-3 shadow-2xl backdrop-blur-md">
                    <NodeHoverTooltip node={hoveredNode} server={server} />
                  </div>
                </div>
              );
            })()
          )}

          {/* Cable Hover Basic Tooltip */}
          {hoveredLink && !hoveredNode && !selectedNode && !selectedLink && (
            (() => {
              const cab = cables.get(hoveredLink.id);
              if (!cab) return null;

              const cx = containerSize.width / 2;
              const cy = containerSize.height / 2;
              const screenX = cx + (cab.mx - layoutW / 2) * zoom;
              const screenY = cy + (cab.my - layoutH / 2) * zoom;

              const srcNode = nodeById.get(hoveredLink.source);
              const tgtNode = nodeById.get(hoveredLink.target);
              return (
                <div
                  className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-[125%]"
                  style={{ left: screenX, top: screenY }}
                >
                  <div className="w-60 rounded-xl border border-surface-border bg-black/90 p-3 shadow-2xl backdrop-blur-md">
                    <CableHoverTooltip link={hoveredLink} srcNode={srcNode} tgtNode={tgtNode} />
                  </div>
                </div>
              );
            })()
          )}

          {/* ═══════════════════════════════════════════════════════════
              CLICK DETAILS CARD — ALWAYS AT LOWER RIGHT SIDE
              ═══════════════════════════════════════════════════════════ */}

          {/* Selected Device Complete Details Panel */}
          {selectedNode && (
            <AnimatePresence>
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                className="absolute bottom-3 right-3 z-30 w-80 rounded-xl border border-surface-border bg-[#0E1322]/95 p-4 shadow-2xl backdrop-blur-md"
              >
                <div className="mb-3 flex items-center justify-between border-b border-surface-border pb-2.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-text-muted">
                    Complete Device Details
                  </span>
                  <button
                    onClick={() => setSelectedNode(null)}
                    className="rounded-lg p-1 text-text-muted transition-colors hover:bg-surface-elevated hover:text-text-primary cursor-pointer"
                    aria-label="Close details"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <NodeDetailPanel
                  node={selectedNode}
                  server={serverByNodeId.get(selectedNode.id)}
                  nodeById={nodeById}
                />
              </motion.div>
            </AnimatePresence>
          )}

          {/* Selected Connection Complete Details Panel */}
          {selectedLink && (
            <AnimatePresence>
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                className="absolute bottom-3 right-3 z-30 w-80 rounded-xl border border-surface-border bg-[#0E1322]/95 p-4 shadow-2xl backdrop-blur-md"
              >
                <div className="mb-3 flex items-center justify-between border-b border-surface-border pb-2.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-text-muted">
                    Connection Details
                  </span>
                  <button
                    onClick={() => setSelectedLink(null)}
                    className="rounded-lg p-1 text-text-muted transition-colors hover:bg-surface-elevated hover:text-text-primary cursor-pointer"
                    aria-label="Close details"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <CableDetailPanel
                  link={selectedLink}
                  srcNode={nodeById.get(selectedLink.source)}
                  tgtNode={nodeById.get(selectedLink.target)}
                />
              </motion.div>
            </AnimatePresence>
          )}

          {/* Loading Indicator */}
          {isLoading && nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-xs text-text-muted">Loading NOC topology…</span>
            </div>
          )}

          {/* Error Banner */}
          {!isLoading && error && nodes.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
              <WifiOff className="h-8 w-8 text-warn/60" />
              <div className="text-sm font-semibold text-text-secondary">Unable to load Network Map</div>
              <p className="max-w-xs text-xs text-text-muted">
                The backend service is unreachable. Please check backend status and retry.
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

          {/* Empty Topology Banner */}
          {!isLoading && !error && nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-xs text-text-muted">No network topology nodes discovered</span>
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-surface-border bg-black/40 px-4 py-2.5">
          <span className="flex items-center gap-1.5 text-[11px] text-text-muted">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            Online
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-text-muted">
            <span className="h-2 w-2 rounded-full bg-warn" />
            Warning / Degraded
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-text-muted">
            <span className="h-2 w-2 rounded-full bg-crit" />
            Offline / Unreachable
          </span>
          <span className="ml-auto font-mono text-[11px] text-text-muted">
            {totalTx.toLocaleString(undefined, { maximumFractionDigits: 1 })} Mb/s aggregate throughput
          </span>
        </div>
      </div>
    </Card>
  );
}

// ─── Moving Light Packets Effect (Back & Forth Flow) ────────────────

function MovingLightPackets({
  links,
  cables,
}: {
  links: NetworkLink[];
  cables: Map<string, CableLayout>;
}) {
  return (
    <g className="pointer-events-none">
      {links.map((link) => {
        const cab = cables.get(link.id);
        if (!cab) return null;
        const st = normalizeStatus(link.status);
        if (st === 'critical') return null; // No flow if link is down

        const isWarning = st === 'warning';
        const colorIn = isWarning ? '#F59E0B' : IN_COLOR;
        const colorOut = isWarning ? '#F59E0B' : OUT_COLOR;

        // Speed is proportional to link throughput
        const dur1 = `${clamp(3.5 - link.throughputMbps / 500, 1.2, 4.5).toFixed(1)}s`;
        const dur2 = `${clamp(4.0 - link.throughputMbps / 500, 1.5, 5.0).toFixed(1)}s`;

        return (
          <g key={`light-flow-${link.id}`}>
            {/* Forward light packet (Source → Target) */}
            <g style={{ filter: `drop-shadow(0 0 5px ${colorIn})` }}>
              <circle r={3} fill={colorIn}>
                <animateMotion
                  path={cab.dIn}
                  dur={dur1}
                  repeatCount="indefinite"
                  calcMode="linear"
                />
              </circle>
            </g>

            {/* Backward light packet (Target → Source) */}
            <g style={{ filter: `drop-shadow(0 0 5px ${colorOut})` }}>
              <circle r={2.5} fill={colorOut}>
                <animateMotion
                  path={cab.dIn}
                  dur={dur2}
                  keyPoints="1;0"
                  keyTimes="0;1"
                  repeatCount="indefinite"
                  calcMode="linear"
                />
              </circle>
            </g>
          </g>
        );
      })}
    </g>
  );
}

// ─── Tooltips & Side Panels ─────────────────────────────────────────

function NodeHoverTooltip({ node, server }: { node: NetworkNode; server?: ServerRuntime }) {
  const statusColor = STATUS_COLOR[node.status] ?? STATUS_COLOR.online;
  const IconComponent = INFRA_ICON_COMPONENTS[node.type];

  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center justify-between gap-2 border-b border-surface-border/60 pb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0">{IconComponent ? <IconComponent size={16} /> : '📦'}</span>
          <span className="truncate font-semibold text-text-primary">{node.label}</span>
        </div>
        <span
          className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
          style={{ backgroundColor: `${statusColor}22`, color: statusColor }}
        >
          {STATUS_LABEL[node.status] ?? node.status}
        </span>
      </div>

      <div className="space-y-1 text-[11px] text-text-muted">
        <div className="flex justify-between">
          <span>Role</span>
          <span className="font-medium text-text-secondary capitalize">{node.type}</span>
        </div>
        <div className="flex justify-between">
          <span>IP Address</span>
          <span className="font-mono text-text-primary">{node.ip ?? server?.spec.ip ?? '–'}</span>
        </div>
        {server && (
          <>
            <div className="flex justify-between">
              <span>CPU Usage</span>
              <span className="font-mono text-text-primary">{Math.round(server.cpu)}%</span>
            </div>
            {server.tempC > 0 && (
              <div className="flex justify-between">
                <span>Temperature</span>
                <span className="font-mono text-text-primary">{Math.round(server.tempC)}°C</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function CableHoverTooltip({ link, srcNode, tgtNode }: { link: NetworkLink; srcNode?: NetworkNode; tgtNode?: NetworkNode }) {
  const st = normalizeStatus(link.status);
  const color = LINK_COLOR[st];

  return (
    <div className="space-y-1.5 text-xs">
      <div className="flex items-center justify-between gap-2 border-b border-surface-border/60 pb-1.5">
        <span className="truncate font-semibold text-text-primary">
          {srcNode?.label ?? link.source} → {tgtNode?.label ?? link.target}
        </span>
        <span
          className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
          style={{ backgroundColor: `${color}22`, color }}
        >
          {st}
        </span>
      </div>

      <div className="space-y-1 text-[11px] text-text-muted">
        <div className="flex justify-between">
          <span>Throughput</span>
          <span className="font-mono font-semibold text-text-primary">{formatMbps(link.throughputMbps)}</span>
        </div>
        <div className="flex justify-between">
          <span>Latency</span>
          <span className="font-mono text-text-primary">{link.latencyMs.toFixed(1)} ms</span>
        </div>
        {link.jitterMs > 0 && (
          <div className="flex justify-between">
            <span>Jitter</span>
            <span className="font-mono text-text-primary">{link.jitterMs.toFixed(1)} ms</span>
          </div>
        )}
        {link.packetLoss > 0 && (
          <div className="flex justify-between">
            <span>Packet Loss</span>
            <span className="font-mono text-text-primary">{(link.packetLoss * 100).toFixed(1)}%</span>
          </div>
        )}
      </div>
    </div>
  );
}

function NodeDetailPanel({ node, server, nodeById }: { node: NetworkNode; server?: ServerRuntime; nodeById: Map<string, NetworkNode> }) {
  const statusColor = STATUS_COLOR[node.status] ?? STATUS_COLOR.online;
  const IconComponent = INFRA_ICON_COMPONENTS[node.type];
  const parentNode = node.parentId ? nodeById.get(node.parentId) : undefined;

  return (
    <div className="space-y-3 text-xs">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border bg-surface-input"
          style={{ borderColor: `${statusColor}55` }}
        >
          {IconComponent ? <IconComponent size={22} /> : <span>{NETWORK_NODE_ICONS_FRONTEND[node.type] ?? '📦'}</span>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-text-primary">{node.label}</div>
          <div className="flex items-center gap-2 text-[11px] text-text-muted">
            <span className="capitalize">{node.type}</span>
            <span className="h-1 w-1 rounded-full bg-surface-border" />
            <span className="font-mono">{node.ip ?? server?.spec.ip ?? 'No IP'}</span>
          </div>
        </div>
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
          style={{ backgroundColor: `${statusColor}22`, color: statusColor }}
        >
          {STATUS_LABEL[node.status] ?? node.status}
        </span>
      </div>

      {/* Overview Grid */}
      <div className="grid grid-cols-2 gap-2 rounded-xl border border-surface-border/70 bg-surface-input/50 p-2.5 text-[11px]">
        <div>
          <span className="text-text-muted">Parent Host</span>
          <div className="mt-0.5 font-medium text-text-primary truncate">{parentNode?.label ?? 'None (Root)'}</div>
        </div>
        <div>
          <span className="text-text-muted">Health Score</span>
          <div className="mt-0.5 font-medium text-text-primary">{Math.round(node.health)} / 100</div>
        </div>
      </div>

      {/* Real Live Metrics (if server exists) */}
      {server && (
        <div className="space-y-2 rounded-xl border border-surface-border/70 bg-surface-input/50 p-2.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Live Metrics</div>
          <MetricBar icon={<Cpu className="h-3 w-3 text-info" />} label="CPU" value={Math.round(server.cpu)} unit="%" color="bg-info" />
          <MetricBar
            icon={<Layers className="h-3 w-3 text-accent" />}
            label="RAM"
            value={server.spec.ramTotalGb > 0 ? Math.round((server.ramUsedGb / server.spec.ramTotalGb) * 100) : 0}
            unit={`% (${server.ramUsedGb.toFixed(1)} / ${server.spec.ramTotalGb.toFixed(1)} GB)`}
            color="bg-accent"
          />
          <MetricBar
            icon={<HardDrive className="h-3 w-3 text-warn" />}
            label="Disk"
            value={server.spec.diskTotalGb > 0 ? Math.round((server.diskUsedGb / server.spec.diskTotalGb) * 100) : 0}
            unit={`% (${server.diskUsedGb.toFixed(1)} / ${server.spec.diskTotalGb.toFixed(1)} GB)`}
            color="bg-warn"
          />
          {server.tempC > 0 && (
            <div className="flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1 text-text-muted"><Thermometer className="h-3 w-3 text-warn" /> Temp</span>
              <span className="font-mono font-semibold text-text-primary">{Math.round(server.tempC)}°C</span>
            </div>
          )}
        </div>
      )}

      {/* Containers / Services on host */}
      {(() => {
        const containers = (server as any)?.containers as Array<{ id: string; name: string; running: boolean }> | undefined;
        if (!containers || containers.length === 0) return null;
        const runningCount = containers.filter((c) => c.running).length;
        return (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-text-muted">
              <span>Containers ({containers.length})</span>
              <span className="text-emerald-400">{runningCount} running</span>
            </div>
            <div className="max-h-28 overflow-y-auto space-y-1 pr-1 text-[11px]">
              {containers.map((c) => (
                <div key={c.id} className="flex items-center justify-between rounded-lg border border-surface-border/50 bg-surface-input px-2 py-1">
                  <span className="truncate font-medium text-text-primary">{c.name}</span>
                  <span className={cn('h-1.5 w-1.5 rounded-full', c.running ? 'bg-emerald-400' : 'bg-crit')} />
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Action link */}
      {server && (
        <div className="pt-1">
          <Link
            to={`/servers/${server.spec.id}`}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-accent/40 bg-accent/10 py-2 text-xs font-semibold text-accent transition-colors hover:bg-accent/20"
          >
            <span>View Server Details</span>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}
    </div>
  );
}

function MetricBar({ icon, label, value, unit, color }: { icon: React.ReactNode; label: string; value: number; unit: string; color: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="flex items-center gap-1 text-text-muted">{icon} {label}</span>
        <span className="font-mono font-semibold text-text-primary">{unit}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-border">
        <div className={cn('h-full rounded-full transition-all duration-300', color)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
    </div>
  );
}

function CableDetailPanel({ link, srcNode, tgtNode }: { link: NetworkLink; srcNode?: NetworkNode; tgtNode?: NetworkNode }) {
  const st = normalizeStatus(link.status);
  const color = LINK_COLOR[st];

  return (
    <div className="space-y-3 text-xs">
      <div className="rounded-xl border border-surface-border/70 bg-surface-input/50 p-2.5">
        <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Endpoints</div>
        <div className="mt-2 flex items-center justify-between font-semibold text-text-primary">
          <span>{srcNode?.label ?? link.source}</span>
          <span className="text-text-muted">→</span>
          <span>{tgtNode?.label ?? link.target}</span>
        </div>
      </div>

      <dl className="space-y-2 text-[11px]">
        <div className="flex items-center justify-between border-b border-surface-border/50 pb-1.5">
          <span className="text-text-muted">Connection Status</span>
          <span className="font-bold uppercase tracking-wider" style={{ color }}>{st}</span>
        </div>
        <div className="flex items-center justify-between border-b border-surface-border/50 pb-1.5">
          <span className="text-text-muted">Throughput</span>
          <span className="font-mono font-bold text-text-primary">{formatMbps(link.throughputMbps)}</span>
        </div>
        <div className="flex items-center justify-between border-b border-surface-border/50 pb-1.5">
          <span className="text-text-muted">Latency</span>
          <span className="font-mono text-text-primary">{link.latencyMs.toFixed(1)} ms</span>
        </div>
        <div className="flex items-center justify-between border-b border-surface-border/50 pb-1.5">
          <span className="text-text-muted">Jitter</span>
          <span className="font-mono text-text-primary">{link.jitterMs.toFixed(1)} ms</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-text-muted">Packet Loss</span>
          <span className="font-mono text-text-primary">{(link.packetLoss * 100).toFixed(1)}%</span>
        </div>
      </dl>
    </div>
  );
}

// ─── Cable rendering ───────────────────────────────────────────────

function CableLayer({
  link,
  cable,
  hovered,
  selected,
  onHover,
  onUnhover,
  onClick,
}: {
  link: NetworkLink;
  cable: { dIn: string; dOut: string; mx: number; my: number };
  hovered?: boolean;
  selected?: boolean;
  onHover?: () => void;
  onUnhover?: () => void;
  onClick?: () => void;
}) {
  const st = normalizeStatus(link.status);
  const strokeColor = LINK_COLOR[st];
  const isOffLink = st === 'critical';

  const baseWidth = hovered || selected ? 3.5 : 2;
  const baseOpacity = isOffLink ? 0.2 : hovered || selected ? 0.9 : 0.45;

  return (
    <g>
      {/* Background glow path */}
      {(hovered || selected) && (
        <path
          d={cable.dIn}
          fill="none"
          stroke={strokeColor}
          strokeOpacity={0.25}
          strokeWidth={10}
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 8px ${strokeColor})` }}
        />
      )}

      {/* Cable line */}
      <path
        d={cable.dIn}
        fill="none"
        stroke={strokeColor}
        strokeOpacity={baseOpacity}
        strokeWidth={baseWidth}
        strokeLinecap="round"
        className={cn('net-base', st === 'healthy' && 'net-cable-pulse')}
      />

      {/* Invisible wide hit target for hover/click */}
      <path
        d={cable.dIn}
        fill="none"
        stroke="transparent"
        strokeWidth={16}
        strokeLinecap="round"
        className="cursor-pointer pointer-events-auto"
        onMouseEnter={onHover}
        onMouseLeave={onUnhover}
        onClick={onClick}
      />
    </g>
  );
}
