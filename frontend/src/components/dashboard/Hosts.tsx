import { useNetwork } from '@/hooks/useQueries';
import { Card } from '@/components/ui/Card';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { StatusDot } from '@/components/ui/Status';
import { NETWORK_NODE_ICONS_FRONTEND } from '@/lib/constants';
import { formatMbps } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { Power, AlertCircle } from 'lucide-react';

export function Hosts() {
  const { topology } = useNetwork();
  const links = topology?.links ?? [];
  const nodes = topology?.nodes ?? [];
  const totalDown = links.reduce((a, l) => a + l.throughputMbps, 0);

  return (
    <Card className="h-full">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary">Hosts</h3>
        <span className="text-xs text-text-muted">L2/L3 devices</span>
      </div>
      <div className="flex flex-col gap-2">
        {nodes.map((node) => (
          <div
            key={node.id}
            className={cn(
              'flex items-center gap-3 rounded-xl border border-surface-border/70 bg-surface-input px-3 py-2.5 transition-all',
              node.status === 'offline' && 'opacity-55 grayscale',
              node.status === 'degraded' && 'border-warn/40',
            )}
          >
            <span className="relative text-xl">
              {NETWORK_NODE_ICONS_FRONTEND[node.type]}
              {node.status === 'offline' && (
                <Power className="absolute -bottom-1 -right-1 h-3 w-3 rotate-90 stroke-crit fill-crit/20" />
              )}
              {node.status === 'degraded' && (
                <AlertCircle className="absolute -bottom-1 -right-1 h-3 w-3 stroke-warn fill-warn/20" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-text-primary">{node.label}</span>
                {node.status === 'offline' && (
                  <span className="text-xs font-medium text-crit">Offline</span>
                )}
                {node.status === 'degraded' && (
                  <span className="text-xs font-medium text-warn">Degraded</span>
                )}
              </div>
              <div className="text-[11px] text-text-muted">{node.ip ?? node.type}</div>
            </div>
            <StatusDot status={node.status} />
          </div>
        ))}
        {nodes.length === 0 && (
          <div className="py-6 text-center text-xs text-text-muted">No topology data</div>
        )}
      </div>
      <div className="mt-4 rounded-xl border border-surface-border/70 bg-surface-input p-3">
        <div className="text-[10px] uppercase tracking-widest text-text-muted">Aggregate throughput</div>
        <div className="mt-1 font-display text-2xl font-bold tabular text-accent">
          <AnimatedNumber value={totalDown} />
          <span className="ml-1 text-sm font-normal text-text-muted">Mb/s</span>
        </div>
      </div>
    </Card>
  );
}
