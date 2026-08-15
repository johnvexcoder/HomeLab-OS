import { ServerCog, Server, Radio } from 'lucide-react';
import type { ClusterInfo } from '@/types';
import { Card } from '@/components/ui/Card';
import { ProgressRing } from '@/components/ui/Progress';
import { Badge } from '@/components/ui/Badge';

export function ClusterCard({ cluster, index }: { cluster: ClusterInfo; index: number }) {
  const statusTone = cluster.status === 'online' ? 'success' : cluster.status === 'degraded' ? 'warn' : 'crit';

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-surface-border bg-surface-elevated text-accent">
            <ServerCog className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="min-w-0 truncate font-display text-sm font-bold text-text-primary">{cluster.name}</h3>
              <Badge tone={statusTone} dot>{cluster.status.toUpperCase()}</Badge>
            </div>
            <p className="mt-0.5 text-xs text-text-muted">
              {cluster.serverIds.length} node{cluster.serverIds.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>
        <ProgressRing value={cluster.health} size={56} stroke={5} label="" />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-muted">
        <span className="flex items-center gap-1"><Server className="h-3 w-3 text-accent" />{cluster.online} online</span>
        {cluster.degraded > 0 && <span className="flex items-center gap-1 text-warn"><Radio className="h-3 w-3" />{cluster.degraded} degraded</span>}
        {cluster.offline > 0 && <span className="flex items-center gap-1 text-crit"><Radio className="h-3 w-3" />{cluster.offline} offline</span>}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {cluster.serverIds.map((id) => (
          <span key={id} className="rounded-md border border-surface-border bg-surface-input px-2 py-0.5 font-mono text-[10px] text-text-muted">
            {id}
          </span>
        ))}
      </div>
    </Card>
  );
}
