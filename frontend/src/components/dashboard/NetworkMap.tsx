import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Globe, Network, RefreshCw, WifiOff, X, Radio, ChevronRight, ChevronDown, Cpu, Thermometer, HardDrive, Activity, ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import { useNetwork } from '@/hooks/useQueries';
import { NETWORK_NODE_ICONS_FRONTEND } from '@/lib/constants';
import { INFRA_ICON_COMPONENTS } from '@/lib/icons';
import type { NetworkNode, NetworkLink } from '@/types';
import { Card, CardHeader } from '@/components/ui/Card';
import { formatMbps } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { generateTraffic, topologySignature, type TrafficEvent } from '@/lib/trafficEngine';
import { computeTopologyLayout, type TopologyLayout, type LayoutedNode, type GroupBounds } from '@/lib/topologyLayout';

const IN_COLOR = '#22D3EE';
const OUT_COLOR = 'var(--accent)';

function clamp(v: number, min: number, max: number): number { return Math.min(max, Math.max(min, v)); }

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

const NODE_STATUS_LABEL: Record<string, string> = {
  online: 'Online',
  degraded: 'Degraded',
  offline: 'Offline',
};

const LINK_STATUS_LABEL: Record<LinkStatus, string> = {
  healthy: 'Healthy',
  warning: 'Degraded',
  critical: 'Offline',
  unknown: 'Unknown',
};

type ExternalState = 'reachable' | 'degraded' | 'unreachable';

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
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSize({ width: r.width, height: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, size };
}

export function NetworkMap() {
  const { topology, refetch, isLoading, error, isFetching } = useNetwork();
  const nodes = topology?.nodes ?? [];
  const links = topology?.links ?? [];
  const { ref, size } = useElementSize<HTMLDivElement>();

  const [hoveredLink, setHoveredLink] = useState<NetworkLink | null>(null);
  const [selectedLink, setSelectedLink] = useState<NetworkLink | null>(null);
  const [hoveredNode, setHoveredNode] = useState<NetworkNode | null>(null);
  const [selectedNode, setSelectedNode] = useState<NetworkNode | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // Node dragging state — stores user-positioned node overrides
  const [userPositions, setUserPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const dragRef = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null);

  const handleZoomIn = useCallback(() => setZoom((z) => Math.min(z * 1.25, 3)), []);
  const handleZoomOut = useCallback(() => setZoom((z) => Math.max(z / 1.25, 0.2)), []);
  const handleZoomReset = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    isPanning.current = true;
    panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [pan]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanning.current) return;
    const dx = e.clientX - panStart.current.x;
    const dy = e.clientY - panStart.current.y;
    setPan({ x: panStart.current.panX + dx, y: panStart.current.panY + dy });
  }, []);

  const onPointerUp = useCallback(() => { isPanning.current = false; }, []);

  const handleNodePointerDown = useCallback((e: React.PointerEvent, nodeId: string, origX: number, origY: number) => {
    e.stopPropagation();
    dragRef.current = { id: nodeId, startX: e.clientX, startY: e.clientY, origX, origY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handleNodePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = (e.clientX - dragRef.current.startX) / zoom;
    const dy = (e.clientY - dragRef.current.startY) / zoom;
    const newX = dragRef.current.origX + dx;
    const newY = dragRef.current.origY + dy;
    setUserPositions((prev) => {
      const next = new Map(prev);
      next.set(dragRef.current!.id, { x: newX, y: newY });
      return next;
    });
  }, [zoom]);

  const handleNodePointerUp = useCallback(() => { dragRef.current = null; }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((z) => clamp(z * delta, 0.2, 3));
  }, []);

  const toggleCollapse = (id: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const prevNodesRef = useRef<Map<string, NetworkNode['status']>>(new Map());

  useEffect(() => {
    const curr = new Map(nodes.map((n) => [n.id, n.status]));
    prevNodesRef.current = curr;
  }, [nodes]);

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const linkById = useMemo(() => new Map(links.map((l) => [l.id, l])), [links]);

  const signature = useMemo(() => topologySignature(nodes, links), [nodes, links]);
  const trafficEvents = useMemo(() => generateTraffic(nodes, links), [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  const endpointMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of links) {
      m.set(`${l.source}||${l.target}`, l.id);
      m.set(`${l.target}||${l.source}`, l.id);
    }
    return m;
  }, [links]);

  // Filter nodes: hide children of collapsed groups
  const visibleNodeIds = useMemo(() => {
    const hidden = new Set<string>();
    const children = new Map<string, string[]>();
    for (const n of nodes) {
      if (n.parentId && n.parentId !== n.id) {
        if (!children.has(n.parentId)) children.set(n.parentId, []);
        children.get(n.parentId)!.push(n.id);
      }
    }
    const collectDescendants = (parentId: string) => {
      for (const cid of children.get(parentId) ?? []) {
        hidden.add(cid);
        collectDescendants(cid);
      }
    };
    for (const gid of collapsedGroups) {
      collectDescendants(gid);
    }
    return new Set(nodes.filter((n) => !hidden.has(n.id)).map((n) => n.id));
  }, [nodes, collapsedGroups]);

  const visibleNodes = useMemo(() => nodes.filter((n) => visibleNodeIds.has(n.id)), [nodes, visibleNodeIds]);
  const visibleLinks = useMemo(
    () => links.filter((l) => visibleNodeIds.has(l.source) && visibleNodeIds.has(l.target)),
    [links, visibleNodeIds],
  );

  const layout: TopologyLayout | null = useMemo(
    () => (size.width > 0 && size.height > 0 ? computeTopologyLayout(visibleNodes, visibleLinks, size.width, size.height) : null),
    [visibleNodes, visibleLinks, size.width, size.height],
  );
  const { width, height, metrics, nodes: layoutNodes, cables, groups } = layout ?? {
    width: 0,
    height: 0,
    metrics: null,
    nodes: new Map<string, LayoutedNode>(),
    cables: new Map(),
    groups: [],
  };

  // Merge auto-layout positions with user-dragged overrides
  const finalPositions = useMemo(() => {
    if (userPositions.size === 0) return layoutNodes;
    const result = new Map(layoutNodes);
    for (const [id, pos] of userPositions) {
      const base = result.get(id);
      if (base) result.set(id, { ...base, x: pos.x, y: pos.y });
    }
    return result;
  }, [layoutNodes, userPositions]);

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

  const linkMid = (link: NetworkLink) => {
    const a = finalPositions.get(link.source);
    const b = finalPositions.get(link.target);
    if (!a || !b) return null;
    return { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  };

  const tooltip = hoveredLink ? linkMid(hoveredLink) : null;

  const selectLink = (link: NetworkLink) => { setSelectedLink(link); setSelectedNode(null); };
  const selectNode = (node: NetworkNode) => { setSelectedNode(node); setSelectedLink(null); };

  return (
    <Card className="h-full">
      <CardHeader
        title="Network Map"
        subtitle="Hierarchical topology · live traffic"
        icon={<Network className="h-[18px] w-[18px]" />}
        action={
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1 text-xs font-medium text-text-muted transition-colors hover:text-accent cursor-pointer"
            disabled={isFetching}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} /> Refresh
          </button>
        }
      />

      <div className="relative overflow-hidden rounded-xl border border-surface-border bg-[#0B0B0B]">
        <div className="grid-backdrop absolute inset-0" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent to-black/30" />

        <div
          ref={ref}
          className="relative w-full overflow-hidden"
          style={{ height: 480, cursor: isPanning.current ? 'grabbing' : 'grab' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        >
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="absolute inset-0 h-full w-full"
            style={{
              transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
              transformOrigin: 'center center',
              transition: isPanning.current ? 'none' : 'transform 0.15s ease-out',
            }}
          >
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
                .group-box { pointer-events: none; }
                .collapse-btn { cursor: pointer; }
                @media (prefers-reduced-motion: reduce) {
                  .net-packet { display: none; }
                  .net-signal { animation: none !important; opacity: 0; }
                  .net-cable-pulse { animation: none !important; }
                }
              `}</style>
            </defs>

            {/* Group bounding boxes */}
            {groups.map((g) => {
              const parent = nodeById.get(g.id);
              if (!parent || !visibleNodeIds.has(g.id)) return null;
              const hasChildren = nodes.some((n) => n.parentId === g.id && visibleNodeIds.has(n.id));
              if (!hasChildren) return null;
              const isCollapsed = collapsedGroups.has(g.id);
              return (
                <g key={`group-${g.id}`} className="group-box">
                  <rect
                    x={g.x}
                    y={g.y}
                    width={g.width}
                    height={g.height}
                    rx={8}
                    fill="rgba(255,255,255,0.02)"
                    stroke="rgba(255,255,255,0.06)"
                    strokeWidth={1}
                    strokeDasharray={isCollapsed ? '4 2' : 'none'}
                  />
                </g>
              );
            })}

            {/* Links */}
            {visibleLinks.map((link, i) => {
              const cab = cables.get(link.id);
              if (!cab) return null;
              return (
                <LinkLayer
                  key={link.id}
                  link={link}
                  cable={cab}
                  index={i}
                  active={hoveredLink?.id === link.id || selectedLink?.id === link.id}
                  onHover={() => setHoveredLink(link)}
                  onLeave={() => setHoveredLink((h) => (h?.id === link.id ? null : h))}
                  onSelect={() => selectLink(link)}
                />
              );
            })}

            {/* Traffic packets */}
            {layout && <TrafficLayer events={trafficEvents} layout={layout} endpointMap={endpointMap} />}
          </svg>

          {/* Hover tooltip */}
          {((hoveredLink && tooltip) || hoveredNode) && (
            <div
              className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-[120%]"
              style={{
                left: hoveredNode ? (finalPositions.get(hoveredNode.id)?.x ?? 0) : tooltip!.mx,
                top: (hoveredNode ? (finalPositions.get(hoveredNode.id)?.y ?? 0) + 8 : tooltip!.my) ?? 0,
              }}
            >
              <div className="w-[min(220px,calc(100vw-3rem))] rounded-lg border border-surface-border bg-black/85 p-2.5 shadow-xl backdrop-blur-sm">
                {hoveredNode ? (
                  <NodeTooltip node={hoveredNode} nodeById={nodeById} />
                ) : (
                  <LinkTooltip link={hoveredLink!} />
                )}
              </div>
            </div>
          )}

          {/* Detail panel (click) */}
          {(selectedNode || selectedLink) && (
            <div className="absolute inset-x-3 bottom-3 z-20 rounded-xl border border-surface-border bg-black/85 p-3 shadow-xl backdrop-blur-sm sm:inset-x-auto sm:right-3 sm:w-72">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-text-primary">
                  {selectedNode ? 'Device details' : 'Connection details'}
                </span>
                <button
                  onClick={() => { setSelectedNode(null); setSelectedLink(null); }}
                  className="text-text-muted transition-colors hover:text-text-primary cursor-pointer"
                  aria-label="Close details"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              {selectedNode ? (
                <NodeDetail node={selectedNode} nodeById={nodeById} nodes={nodes} links={links} collapsedGroups={collapsedGroups} toggleCollapse={toggleCollapse} />
              ) : (
                <LinkDetail link={selectedLink!} />
              )}
            </div>
          )}

          {/* Node layer */}
          {layout &&
            metrics &&
            visibleNodes.map((originalNode, i) => {
              const p = finalPositions.get(originalNode.id);
              if (!p) return null;
              const nodeStatus = (originalNode.status || 'online') as keyof typeof NODE_STATUS_RING;
              const isInteractive = hoveredNode?.id === originalNode.id || selectedNode?.id === originalNode.id;
              const isInternet = originalNode.type === 'internet';
              const box = isInternet ? Math.round(metrics.nodeSize * 1.125) : Math.round(metrics.nodeSize * 0.75);
              const hasCollapsedChildren = collapsedGroups.has(originalNode.id);
              const childCount = originalNode.childCount ?? nodes.filter((n) => n.parentId === originalNode.id).length;
              const IconComponent = INFRA_ICON_COMPONENTS[originalNode.type];

              return (
                <div
                  key={originalNode.id}
                  className="absolute"
                  style={{ left: p.x, top: p.y, transform: 'translate(-50%, -50%)' }}
                  onPointerDown={(e) => handleNodePointerDown(e, originalNode.id, p.x, p.y)}
                  onPointerMove={handleNodePointerMove}
                  onPointerUp={handleNodePointerUp}
                  onPointerCancel={handleNodePointerUp}
                >
                  <motion.button
                    type="button"
                    initial={{ opacity: 0, scale: 0.7 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.4, delay: Math.min(i * 0.035, 0.7), ease: [0.16, 1, 0.3, 1] }}
                    className="flex cursor-pointer flex-col items-center border-none bg-transparent p-0 outline-none"
                    style={{ maxWidth: Math.round(metrics.labelMaxWidth + 16) }}
                    onMouseEnter={() => setHoveredNode(originalNode)}
                    onMouseLeave={() => setHoveredNode((h) => (h?.id === originalNode.id ? null : h))}
                    onClick={() => selectNode(originalNode)}
                    aria-label={`${originalNode.label} — ${NODE_STATUS_LABEL[originalNode.status]}. Click for details`}
                  >
                    <div
                      className="flex flex-col items-center gap-0.5 rounded-lg transition-all duration-200"
                      style={isInteractive
                        ? { boxShadow: `0 0 0 2px ${NODE_STATUS_RING[nodeStatus]}55`, background: 'rgba(0,0,0,0.25)' }
                        : { boxShadow: 'none', background: 'rgba(0,0,0,0.25)' }}
                    >
                      {isInternet ? (
                        <div className="relative flex flex-col items-center">
                          <motion.div
                            className="absolute inset-0 rounded-full border"
                            style={{ borderColor: `${NODE_STATUS_RING[nodeStatus]}66` }}
                            animate={{ scale: [1, 1.5], opacity: [0.7, 0] }}
                            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut' }}
                          />
                          <div
                            className="relative flex items-center justify-center rounded-full border-2 bg-[#0F1522] shadow-card"
                            style={{
                              width: box,
                              height: box,
                              borderColor: NODE_STATUS_RING[nodeStatus],
                              boxShadow: `0 0 24px ${NODE_STATUS_RING[nodeStatus]}44`,
                            }}
                          >
                            <Globe className="h-[45%] w-[45%]" style={{ color: NODE_STATUS_RING[nodeStatus] }} />
                            <span
                              className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-[#0B0B0B]"
                              style={{ backgroundColor: NODE_STATUS_RING[nodeStatus] }}
                            />
                          </div>
                        </div>
                      ) : (
                        <>
                          <div
                            className="relative flex items-center justify-center rounded-xl border bg-[#141414] shadow-card"
                            style={{
                              width: box,
                              height: box,
                              fontSize: metrics.iconSize,
                              borderColor: `${NODE_STATUS_RING[nodeStatus]}55`,
                              boxShadow: `0 0 16px ${NODE_STATUS_RING[nodeStatus]}44`,
                            }}
                          >
                            <span>{IconComponent ? <IconComponent size={metrics.iconSize} /> : NETWORK_NODE_ICONS_FRONTEND[originalNode.type] ?? '📦'}</span>
                            <span
                              className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-[#0B0B0B]"
                              style={{ backgroundColor: NODE_STATUS_RING[nodeStatus] }}
                            />
                            {hasCollapsedChildren && (
                              <button
                                type="button"
                                className="collapse-btn absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border border-[#0B0B0B] bg-[#222] text-[8px] text-text-primary"
                                onClick={(e) => { e.stopPropagation(); toggleCollapse(originalNode.id); }}
                                title="Expand"
                              >
                                <ChevronRight className="h-2.5 w-2.5" />
                              </button>
                            )}
                            {childCount > 0 && !hasCollapsedChildren && (
                              <span className="absolute -bottom-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full border border-[#0B0B0B] bg-[#333] px-1 text-[8px] font-semibold text-text-primary">
                                {childCount}
                              </span>
                            )}
                          </div>
                          {metrics.labelVisible && (
                            <div
                              className="rounded-md border border-surface-border bg-black/60 px-1.5 py-0.5 backdrop-blur-sm"
                              style={{ maxWidth: Math.round(metrics.labelMaxWidth + 12) }}
                            >
                              <span
                                className="block truncate text-center font-semibold"
                                style={{
                                  fontSize: metrics.labelSize,
                                  lineHeight: 1.15,
                                  color: 'var(--color-text-primary)',
                                  opacity: 1,
                                }}
                                title={originalNode.label}
                              >
                                {originalNode.label}
                              </span>
                            </div>
                          )}
                          {metrics.ipVisible && originalNode.ip && (
                            <span className="font-mono text-text-muted" style={{ fontSize: metrics.ipSize }}>
                              {originalNode.ip}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </motion.button>
                </div>
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

        {/* Zoom controls */}
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-lg border border-surface-border bg-black/70 p-1 backdrop-blur-sm">
          <button onClick={handleZoomOut} className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-overlay/10 hover:text-text-primary cursor-pointer" title="Zoom out">
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-[3rem] text-center text-[10px] font-mono text-text-muted">{Math.round(zoom * 100)}%</span>
          <button onClick={handleZoomIn} className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-overlay/10 hover:text-text-primary cursor-pointer" title="Zoom in">
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button onClick={handleZoomReset} className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-overlay/10 hover:text-text-primary cursor-pointer" title="Reset view">
            <Maximize className="h-3.5 w-3.5" />
          </button>
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

// ─── Sub-components ───────────────────────────────────────────────

const NODE_TYPE_LABEL: Record<string, string> = {
  internet: 'Internet',
  gateway: 'Gateway',
  switch: 'Switch',
  bridge: 'Bridge',
  physical: 'Physical Server',
  hypervisor: 'Hypervisor',
  vm: 'Virtual Machine',
  lxc: 'LXC Container',
  container: 'Container',
  docker: 'Docker Engine',
  podman: 'Podman',
  kubernetes: 'Kubernetes',
  storage: 'Storage',
  nas: 'NAS',
  ups: 'UPS',
  firewall: 'Firewall',
  cloud: 'Cloud',
  laptop: 'Laptop',
  desktop: 'Desktop',
};

function NodeTooltip({ node, nodeById }: { node: NetworkNode; nodeById: Map<string, NetworkNode> }) {
  const statusColor = NODE_STATUS_RING[(node.status || 'online') as keyof typeof NODE_STATUS_RING];
  const role = NODE_TYPE_LABEL[node.type] ?? node.type;
  const IconComponent = INFRA_ICON_COMPONENTS[node.type];
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="text-sm">{IconComponent ? <IconComponent size={16} /> : NETWORK_NODE_ICONS_FRONTEND[node.type] ?? '📦'}</span>
        <div className="min-w-0">
          <span className="block truncate text-[11px] font-semibold text-text-primary">{node.label}</span>
          <span className="block text-[10px] text-text-muted">{role}</span>
        </div>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[10px] font-medium" style={{ color: statusColor }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: statusColor }} />
          {NODE_STATUS_LABEL[node.status]}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-muted">
        {node.ip && <span className="font-mono">{node.ip}</span>}
        {node.tempC != null && node.tempC > 0 && (
          <span className="flex items-center gap-0.5">
            <Thermometer className="h-2.5 w-2.5" />{Math.round(node.tempC)}°C
          </span>
        )}
        {node.cpuPercent != null && node.cpuPercent > 0 && (
          <span className="flex items-center gap-0.5">
            <Cpu className="h-2.5 w-2.5" />{node.cpuPercent.toFixed(1)}%
          </span>
        )}
        {node.childCount != null && node.childCount > 0 && (
          <span>{node.childCount} children</span>
        )}
      </div>
    </>
  );
}

function LinkTooltip({ link }: { link: NetworkLink }) {
  const status = normalizeStatus(link.status);
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[11px] font-semibold text-text-primary">
          {link.source} → {link.target}
        </span>
        <span className="flex items-center gap-1.5 text-[10px] font-medium" style={{ color: LINK_COLOR[status] }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: LINK_COLOR[status] }} />
          {LINK_STATUS_LABEL[status]}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-3 text-[11px] text-text-muted">
        <span className="flex items-center gap-1">
          <Radio className="h-3 w-3" />
          {link.latencyMs.toFixed(1)} ms
        </span>
        <span>{formatMbps(link.throughputMbps)}</span>
        {link.packetLoss > 0 && <span className="text-crit">{link.packetLoss.toFixed(1)}% loss</span>}
      </div>
    </>
  );
}

function NodeDetail({ node, nodeById, nodes, links, collapsedGroups, toggleCollapse }: {
  node: NetworkNode;
  nodeById: Map<string, NetworkNode>;
  nodes: NetworkNode[];
  links: NetworkLink[];
  collapsedGroups: Set<string>;
  toggleCollapse: (id: string) => void;
}) {
  const children = nodes.filter((n) => n.parentId === node.id);
  const isCollapsed = collapsedGroups.has(node.id);
  const statusColor = NODE_STATUS_RING[(node.status || 'online') as keyof typeof NODE_STATUS_RING];

  return (
    <div className="space-y-2">
      <dl className="space-y-1.5 text-[11px]">
        <DetailRow label="Name">
          <span className="flex items-center gap-1.5">
            {(() => { const IC = INFRA_ICON_COMPONENTS[node.type]; return IC ? <IC size={14} /> : <span>{NETWORK_NODE_ICONS_FRONTEND[node.type] ?? '📦'}</span>; })()}
            <span className="font-medium text-text-primary">{node.label}</span>
          </span>
        </DetailRow>
        <DetailRow label="Type">{NODE_TYPE_LABEL[node.type] ?? node.type}</DetailRow>
        <DetailRow label="ID"><span className="font-mono">{node.id}</span></DetailRow>
        <DetailRow label="Status">
          <span className="flex items-center gap-1.5 font-medium" style={{ color: statusColor }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: statusColor }} />
            {NODE_STATUS_LABEL[node.status]}
          </span>
        </DetailRow>
        {node.ip && <DetailRow label="IP address"><span className="font-mono">{node.ip}</span></DetailRow>}
        <DetailRow label="Health">{Math.round(node.health)} / 100</DetailRow>
        {node.tempC != null && node.tempC > 0 && <DetailRow label="Temperature">{Math.round(node.tempC)}°C</DetailRow>}
        {node.cpuPercent != null && node.cpuPercent > 0 && <DetailRow label="CPU">{node.cpuPercent.toFixed(1)}%</DetailRow>}
        {node.parentId && (
          <DetailRow label="Parent">
            <span className="font-mono">{nodeById.get(node.parentId)?.label ?? node.parentId}</span>
          </DetailRow>
        )}
      </dl>
      {children.length > 0 && (
        <div className="border-t border-surface-border pt-2">
          <button
            onClick={() => toggleCollapse(node.id)}
            className="flex w-full items-center gap-1.5 text-[11px] font-medium text-text-muted hover:text-text-primary cursor-pointer"
          >
            {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {children.length} child{children.length !== 1 ? 'ren' : ''}
          </button>
          <AnimatePresence>
            {!isCollapsed && (
              <motion.ul
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="mt-1 space-y-0.5 overflow-hidden text-[10px] text-text-muted"
              >
                {children.map((c) => {
                  const ChildIcon = INFRA_ICON_COMPONENTS[c.type];
                  return (
                    <li key={c.id} className="flex items-center gap-1.5">
                      {ChildIcon ? <ChildIcon size={12} /> : <span>{NETWORK_NODE_ICONS_FRONTEND[c.type] ?? '📦'}</span>}
                      <span className="truncate">{c.label}</span>
                      <span
                        className="ml-auto h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: NODE_STATUS_RING[(c.status || 'online') as keyof typeof NODE_STATUS_RING] }}
                      />
                    </li>
                  );
                })}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function LinkDetail({ link }: { link: NetworkLink }) {
  const status = normalizeStatus(link.status);
  return (
    <dl className="space-y-1.5 text-[11px]">
      <DetailRow label="Path">
        <span className="font-mono">{link.source} → {link.target}</span>
      </DetailRow>
      <DetailRow label="Status">
        <span className="flex items-center gap-1.5 font-medium" style={{ color: LINK_COLOR[status] }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: LINK_COLOR[status] }} />
          {LINK_STATUS_LABEL[status]}
        </span>
      </DetailRow>
      <DetailRow label="Latency">{link.latencyMs.toFixed(1)} ms</DetailRow>
      <DetailRow label="Jitter">{link.jitterMs.toFixed(1)} ms</DetailRow>
      <DetailRow label="Packet loss">{link.packetLoss.toFixed(1)}%</DetailRow>
      <DetailRow label="Throughput">{formatMbps(link.throughputMbps)}</DetailRow>
    </dl>
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

// ─── Link cable rendering ─────────────────────────────────────────

function LinkLayer({
  link, cable, index, active, onHover, onLeave, onSelect,
}: {
  link: NetworkLink;
  cable: { dIn: string; dOut: string };
  index: number;
  active: boolean;
  onHover: () => void;
  onLeave: () => void;
  onSelect: () => void;
}) {
  const inCurve = cable.dIn;
  const outCurve = cable.dOut;
  const status = normalizeStatus(link.status);
  const inColor = status === 'healthy' ? IN_COLOR : LINK_COLOR[status];
  const outColor = status === 'healthy' ? OUT_COLOR : LINK_COLOR[status];
  const isOffLink = status === 'critical';
  const curve2 = isOffLink ? inCurve : outCurve;

  const intensity = Math.min(1, Math.max(0, link.throughputMbps / 1000));
  const baseWidth = 2 + intensity * 2.5;
  const baseOpacity = isOffLink ? 0.15 : 0.22 + intensity * 0.45;
  const glowWidth = 6 + intensity * 10;
  const glowOpacity = isOffLink ? 0 : 0.05 + intensity * 0.12;

  return (
    <g className={cn(active && 'link-active')}>
      <path d={inCurve} fill="none" stroke="transparent" strokeWidth="20" pointerEvents="stroke" className="cursor-pointer" onMouseEnter={onHover} onMouseLeave={onLeave} onClick={onSelect} onPointerDown={(e) => e.stopPropagation()} />
      <path d={inCurve} fill="none" stroke={inColor} strokeOpacity={glowOpacity} strokeWidth={glowWidth} strokeLinecap="round" className="net-glow" style={{ filter: `drop-shadow(0 0 ${2 + intensity * 6}px ${inColor})` }} />
      {!isOffLink && (
        <path d={outCurve} fill="none" stroke={outColor} strokeOpacity={glowOpacity} strokeWidth={glowWidth} strokeLinecap="round" className="net-glow" style={{ filter: `drop-shadow(0 0 ${2 + intensity * 6}px ${outColor})` }} />
      )}
      <path d={inCurve} fill="none" stroke={inColor} strokeOpacity={baseOpacity} strokeWidth={baseWidth} strokeLinecap="round" className={cn('net-base', status === 'healthy' && 'net-cable-pulse')} style={{ animationDelay: `${index * 0.37}s` }} />
      <path d={curve2} fill="none" stroke={outColor} strokeOpacity={baseOpacity} strokeWidth={baseWidth} strokeLinecap="round" className={cn('net-base', status === 'healthy' && 'net-cable-pulse')} style={{ animationDelay: `${index * 0.37 + 0.5}s` }} />
      {status === 'warning' && (
        <>
          <path d={inCurve} fill="none" stroke={inColor} strokeWidth="2.5" pathLength={100} strokeDasharray="5 95" className="net-signal net-signal-warning" style={{ filter: `drop-shadow(0 0 3px ${inColor})` }} />
          <path d={outCurve} fill="none" stroke={outColor} strokeWidth="2.5" pathLength={100} strokeDasharray="5 95" className="net-signal net-signal-warning" style={{ filter: `drop-shadow(0 0 3px ${outColor})` }} />
        </>
      )}
    </g>
  );
}

// ─── Traffic packets ──────────────────────────────────────────────

function TrafficLayer({
  events, layout, endpointMap,
}: {
  events: TrafficEvent[];
  layout: TopologyLayout;
  endpointMap: Map<string, string>;
}) {
  return (
    <g className="net-traffic">
      {events.map((ev) => {
        const d = buildPacketPath(ev.path, ev.direction, layout, endpointMap);
        if (!d) return null;
        const color = ev.direction === 'inbound' ? IN_COLOR : OUT_COLOR;
        const durS = ev.dur / 1000;
        const burst = ev.count >= 3;
        const kt = `0;${(0.3 + ev.pace * 0.25).toFixed(3)};${(0.7 - ev.pace * 0.1).toFixed(3)};1`;
        const kp = '0;0.5;0.9;1';
        const ks = '0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1';
        return Array.from({ length: ev.count }).map((_, i) => {
          const stagger = (i * (ev.dur / ev.count)) / 1000;
          const isBurst = burst && i === ev.count - 1;
          return (
            <g key={`${ev.id}-${i}`} className="net-packet" style={{ filter: `drop-shadow(0 0 ${isBurst ? 5 : 2.5}px ${color})` }}>
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

function buildPacketPath(
  path: string[],
  direction: 'outbound' | 'inbound',
  layout: TopologyLayout,
  endpointMap: Map<string, string>,
): string | null {
  if (path.length < 2) return null;
  let d = '';
  for (let i = 0; i < path.length - 1; i++) {
    const a = layout.nodes.get(path[i]);
    const b = layout.nodes.get(path[i + 1]);
    if (!a || !b) return null;
    const cab = layout.cables.get(endpointMap.get(`${a.id}||${b.id}`) ?? '');
    if (!cab) return null;
    const forward = cab.x1 === a.x && cab.y1 === a.y;
    const [c1x, c1y, c2x, c2y] = direction === 'inbound' ? cab.cIn : cab.cOut;
    const [cx1, cy1, cx2, cy2] = forward ? [c1x, c1y, c2x, c2y] : [c2x, c2y, c1x, c1y];
    if (i === 0) d += `M ${a.x} ${a.y}`;
    d += ` C ${cx1} ${cy1}, ${cx2} ${cy2}, ${b.x} ${b.y}`;
  }
  return d;
}
