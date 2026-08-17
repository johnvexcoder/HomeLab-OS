import { useNetwork } from '@/hooks/useQueries';
import { Card } from '@/components/ui/Card';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { StatusDot } from '@/components/ui/Status';
import { NETWORK_NODE_ICONS_FRONTEND } from '@/lib/constants';
import { formatMbps } from '@/lib/utils';

export function Hosts() {
  const { topology } = useNetwork();
  const links = topology?.links ?? [];
  const nodes = topology?.nodes ?? [];
  const totalDown = links.reduce((a, l) => a + l.throughputMbps, 0);

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary">Hosts</h3>
        <span className="text-xs text-text-muted">L2/L3 devices</span>
      </div>
      <div className="flex flex-col gap-2">
        {nodes.map((node) => (
          <div
            key={node.id}
            className="flex items-center gap-3 rounded-xl border border-surface-border/70 bg-surface-input px-3 py-2.5"
          >
            <span className="text-xl">{NETWORK_NODE_ICONS_FRONTEND[node.type]}</span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-text-primary">{node.label}</div>
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
