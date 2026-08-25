import { useNetwork } from '@/hooks/useQueries';
import { Card } from '@/components/ui/Card';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { StatusDot } from '@/components/ui/Status';
import { NETWORK_NODE_ICONS_FRONTEND } from '@/lib/constants';
import { INFRA_ICON_COMPONENTS } from '@/lib/icons';
import { cn } from '@/lib/utils';
import { Power, AlertCircle, ArrowDown, ArrowUp, Thermometer } from 'lucide-react';

export function Hosts() {
  const { topology } = useNetwork();
  const links = topology?.links ?? [];
  const nodes = topology?.nodes ?? [];
  const totalThroughput = links.reduce((a, l) => a + (l.throughputMbps ?? 0), 0);
  const totalDown = Math.round(totalThroughput * 0.6 * 10) / 10;
  const totalUp = Math.round(totalThroughput * 0.4 * 10) / 10;

  return (
    <Card className="flex h-full flex-col">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary">Hosts</h3>
        <span className="text-xs text-text-muted">L2/L3 devices</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
        {nodes.map((node) => {
          const IconComponent = INFRA_ICON_COMPONENTS[node.type];
          return (
            <div
              key={node.id}
              className={cn(
                'flex items-center gap-3 rounded-xl border border-surface-border/70 bg-surface-input px-3 py-2.5 transition-all',
                node.status === 'offline' && 'opacity-55 grayscale',
                node.status === 'degraded' && 'border-warn/40',
              )}
            >
              <span className="relative text-xl">
                {IconComponent ? <IconComponent size={20} /> : NETWORK_NODE_ICONS_FRONTEND[node.type]}
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
                <div className="flex items-center gap-2 text-[11px] text-text-muted">
                  <span>{node.ip ?? node.type}</span>
                  {node.tempC != null && node.tempC > 0 && (
                    <span className="flex items-center gap-0.5">
                      <Thermometer className="h-2.5 w-2.5" />{Math.round(node.tempC)}°C
                    </span>
                  )}
                </div>
              </div>
              <StatusDot status={node.status} />
            </div>
          );
        })}
        {nodes.length === 0 && (
          <div className="py-6 text-center text-xs text-text-muted">No topology data</div>
        )}
      </div>
      <div className="mt-4 shrink-0 rounded-xl border border-surface-border/70 bg-surface-input p-3">
        <div className="text-[10px] uppercase tracking-widest text-text-muted">Aggregate throughput</div>
        <div className="mt-1 flex items-center gap-3">
          <div className="flex items-center gap-1">
            <ArrowDown className="h-3.5 w-3.5 text-success" />
            <span className="font-display text-lg font-bold tabular text-accent">
              <AnimatedNumber value={totalDown} />
            </span>
            <span className="text-xs text-text-muted">Mb/s</span>
          </div>
          <div className="flex items-center gap-1">
            <ArrowUp className="h-3.5 w-3.5 text-info" />
            <span className="font-display text-lg font-bold tabular text-accent">
              <AnimatedNumber value={totalUp} />
            </span>
            <span className="text-xs text-text-muted">Mb/s</span>
          </div>
        </div>
      </div>
    </Card>
  );
}
