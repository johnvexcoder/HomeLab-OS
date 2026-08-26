import { useMemo } from 'react';
import { useNetwork } from '@/hooks/useQueries';
import { useTelemetryStore, selectServers } from '@/store/telemetry';
import { useShallow } from 'zustand/react/shallow';
import { Card } from '@/components/ui/Card';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { StatusDot } from '@/components/ui/Status';
import { NETWORK_NODE_ICONS_FRONTEND } from '@/lib/constants';
import { INFRA_ICON_COMPONENTS } from '@/lib/icons';
import { cn } from '@/lib/utils';
import type { NetworkNode } from '@/types';
import { Power, AlertCircle, ArrowDown, ArrowUp, Thermometer } from 'lucide-react';

export function Hosts({ className }: { className?: string }) {
  const { topology } = useNetwork();
  const servers = useTelemetryStore(useShallow(selectServers));
  const nodes = topology?.nodes ?? [];
  const totalDown = useMemo(() => Math.round(servers.reduce((a, s) => a + (s.netDownMbps || 0), 0) * 10) / 10, [servers]);
  const totalUp = useMemo(() => Math.round(servers.reduce((a, s) => a + (s.netUpMbps || 0), 0) * 10) / 10, [servers]);

  const count = nodes.length;
  const numCols = count <= 10 ? 1 : count <= 20 ? 2 : 3;

  // Chunk nodes into columns of up to 10 devices each
  const cols = useMemo(() => {
    if (count <= 10) return [nodes];
    if (count <= 20) {
      return [nodes.slice(0, 10), nodes.slice(10)];
    }
    return [nodes.slice(0, 10), nodes.slice(10, 20), nodes.slice(20)];
  }, [nodes, count]);

  return (
    <Card className={cn('flex h-full flex-col min-h-0', className)}>
      <div className="mb-3.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-text-primary">Hosts</h3>
          <span className="rounded-full bg-surface-border/60 px-2 py-0.5 text-[10px] font-mono text-text-muted">
            {count} {count === 1 ? 'device' : 'devices'}
          </span>
        </div>
        <span className="text-xs text-text-muted">L2/L3 topology inventory</span>
      </div>

      {/* Device List with responsive columns (1, 2, or 3 columns with max 10 per col) */}
      <div className={cn(
        'flex-1 min-h-0 overflow-y-auto pr-1',
        count > 10 ? 'scrollbar-thin' : 'overflow-y-hidden md:overflow-y-auto'
      )}>
        {count === 0 ? (
          <div className="py-8 text-center text-xs text-text-muted">No topology data</div>
        ) : count <= 10 ? (
          <div className="flex flex-col gap-2">
            {nodes.map((node) => (
              <HostItem key={node.id} node={node} />
            ))}
          </div>
        ) : (
          <div className={cn(
            'grid gap-2.5',
            numCols === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
          )}>
            {cols.map((colNodes, cIdx) => (
              <div key={`col-${cIdx}`} className="flex flex-col gap-2">
                {colNodes.map((node) => (
                  <HostItem key={node.id} node={node} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Aggregate throughput footer */}
      <div className="mt-3.5 shrink-0 rounded-xl border border-surface-border/70 bg-surface-input p-2.5 sm:p-3">
        <div className="text-[10px] uppercase tracking-widest text-text-muted">Aggregate throughput</div>
        <div className="mt-1 flex items-center gap-3">
          <div className="flex items-center gap-1">
            <ArrowDown className="h-3.5 w-3.5 text-success" />
            <span className="font-display text-base sm:text-lg font-bold tabular text-text-primary">
              <AnimatedNumber value={totalDown} />
            </span>
            <span className="text-xs text-text-muted">Mb/s</span>
          </div>
          <div className="flex items-center gap-1">
            <ArrowUp className="h-3.5 w-3.5 text-info" />
            <span className="font-display text-base sm:text-lg font-bold tabular text-text-primary">
              <AnimatedNumber value={totalUp} />
            </span>
            <span className="text-xs text-text-muted">Mb/s</span>
          </div>
        </div>
      </div>
    </Card>
  );
}

function HostItem({ node }: { node: NetworkNode }) {
  const IconComponent = INFRA_ICON_COMPONENTS[node.type];
  return (
    <div
      className={cn(
        'flex items-center gap-2.5 rounded-xl border border-surface-border/70 bg-surface-input px-2.5 py-2 transition-all',
        node.status === 'offline' && 'opacity-55 grayscale',
        node.status === 'degraded' && 'border-warn/40',
      )}
    >
      <span className="relative text-lg shrink-0">
        {IconComponent ? <IconComponent size={18} /> : NETWORK_NODE_ICONS_FRONTEND[node.type]}
        {node.status === 'offline' && (
          <Power className="absolute -bottom-1 -right-1 h-3 w-3 rotate-90 stroke-crit fill-crit/20" />
        )}
        {node.status === 'degraded' && (
          <AlertCircle className="absolute -bottom-1 -right-1 h-3 w-3 stroke-warn fill-warn/20" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs font-semibold text-text-primary">{node.label}</span>
          {node.status === 'offline' && (
            <span className="text-[10px] font-medium text-crit">Offline</span>
          )}
          {node.status === 'degraded' && (
            <span className="text-[10px] font-medium text-warn">Degraded</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
          <span className="truncate font-mono">{node.ip ?? node.type}</span>
          {node.tempC != null && node.tempC > 0 && (
            <span className="flex items-center gap-0.5 shrink-0">
              <Thermometer className="h-2.5 w-2.5" />{Math.round(node.tempC)}°C
            </span>
          )}
        </div>
      </div>
      <StatusDot status={node.status} />
    </div>
  );
}
