import { useState } from 'react';
import { useTelemetry } from '@/hooks/useTelemetry';
import { useClusters } from '@/hooks/useQueries';
import { ServerCard } from '@/components/server/ServerCard';
import { ClusterCard } from '@/components/server/ClusterCard';
import { DockerProfileCards } from '@/components/dashboard/DockerProfileCard';
import { ProviderDiagnosticsBanner } from '@/components/provider/ProviderDiagnosticsBanner';
import { Skeleton } from '@/components/ui/Status';
import type { ServerRole } from '@/types';
import { cn } from '@/lib/utils';

const FILTERS: Array<{ id: ServerRole | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'hypervisor', label: 'Hypervisors' },
  { id: 'vm', label: 'VMs' },
  { id: 'lxc', label: 'LXC' },
  { id: 'docker', label: 'Containers' },
  { id: 'storage', label: 'Storage' },
  { id: 'gateway', label: 'Gateway' },
  { id: 'switch', label: 'Switches' },
];

export default function ServersPage() {
  const { servers, loading } = useTelemetry();
  const { clusters, isLoading: clustersLoading } = useClusters();
  const [filter, setFilter] = useState<ServerRole | 'all'>('all');

  const online = servers.filter((s) => s.status === 'online').length;
  const degraded = servers.filter((s) => s.status === 'degraded').length;
  const visible = filter === 'all' ? servers
    : filter === 'docker' ? servers.filter((s) => s.spec.profile.containers > 0)
    : servers.filter((s) => s.spec.role === filter);

  const clusteredIds = new Set(clusters.flatMap((c) => c.serverIds));
  const standalone = servers.filter((s) => !clusteredIds.has(s.spec.id));
  const clusteredServers = servers.filter((s) => clusteredIds.has(s.spec.id));
  const isClustered = clusters.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="fluid-h1 font-display font-bold tracking-tight text-text-primary">Servers</h1>
          <p className="mt-1 text-sm text-text-muted">
            {servers.length} hosts · <span className="text-accent">{online} online</span>
            {degraded > 0 && <> · <span className="text-warn">{degraded} degraded</span></>}
            {isClustered
              ? <> · <span className="text-info">{clusters.length} cluster{clusters.length === 1 ? '' : 's'}</span></>
              : <> · <span className="text-text-secondary">standalone</span></>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1 rounded-xl border border-surface-border bg-surface p-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                'flex min-h-11 items-center rounded-lg px-3 py-2 text-xs font-semibold transition-colors cursor-pointer',
                filter === f.id ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-primary',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <ProviderDiagnosticsBanner />

      {isClustered && (
        <div className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-text-muted">Clusters</h2>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {clusters.map((cluster, i) => (
              <ClusterCard key={cluster.id} cluster={cluster} index={i} />
            ))}
          </div>
        </div>
      )}

      {filter === 'all' && !isClustered && standalone.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-text-muted/60" />
          Standalone infrastructure — no clusters defined
        </div>
      )}

      {loading && servers.length === 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-80" />
          ))}
        </div>
      ) : filter === 'all' ? (
        <>
          {standalone.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-text-muted">Standalone Nodes</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {standalone.map((server, i) => (
                  <ServerCard key={server.spec.id} server={server} index={i} />
                ))}
                <DockerProfileCards />
              </div>
            </div>
          )}
          {clusteredServers.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-text-muted">Cluster Nodes</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {clusteredServers.map((server, i) => (
                  <ServerCard key={server.spec.id} server={server} index={i} />
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((server, i) => (
            <ServerCard key={server.spec.id} server={server} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
