import { useNetwork } from '@/hooks/useQueries';
import { NetworkMap } from '@/components/dashboard/NetworkMap';
import { ProviderDiagnosticsBanner } from '@/components/provider/ProviderDiagnosticsBanner';
import { Card } from '@/components/ui/Card';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { StatusDot } from '@/components/ui/Status';
import { INFRA_ICON_COMPONENTS } from '@/lib/icons';
import { NETWORK_NODE_ICONS_FRONTEND } from '@/lib/constants';
import { formatMbps } from '@/lib/utils';
import { ArrowDown, ArrowUp } from 'lucide-react';

export default function NetworkPage() {
  const { topology } = useNetwork();

  const links = topology?.links ?? [];
  const totalDown = links.reduce((a, l) => a + (l.throughputMbps ?? 0), 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="fluid-h1 font-display font-bold tracking-tight text-text-primary">Network</h1>
        <p className="mt-1 text-sm text-text-muted">Topology, link health and throughput</p>
      </div>

      <ProviderDiagnosticsBanner />

      <NetworkMap />

      <div className="grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-3 lg:grid-cols-3">
        {/* Link table */}
        <Card className="md:col-span-2 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text-primary">Link Status</h3>
            <span className="text-xs text-text-muted">{links.length} links</span>
          </div>
          
          {/* Desktop table view */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-surface-border text-[10px] uppercase tracking-widest text-text-muted">
                  <th className="py-2 pr-4 font-medium">Link</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Latency</th>
                  <th className="py-2 pr-4 font-medium">Throughput</th>
                  <th className="py-2 pr-4 font-medium">Packet Loss</th>
                  <th className="py-2 font-medium">Jitter</th>
                </tr>
              </thead>
              <tbody>
                {links.map((l) => (
                  <tr key={l.id} className="border-b border-surface-border/50 text-text-secondary last:border-0">
                    <td className="py-2.5 pr-4 font-mono text-xs">{l.source} → {l.target}</td>
                    <td className="py-2.5 pr-4">
                      <span className="flex items-center gap-1.5 text-xs font-medium">
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: l.status === 'healthy' ? 'var(--accent)' : l.status === 'warning' ? '#F59E0B' : '#EF4444' }}
                        />
                        {l.status}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 tabular">
                      {l.latencyMs != null ? <><AnimatedNumber value={l.latencyMs} decimals={1} /> <span className="text-xs text-text-muted">ms</span></> : <span className="text-xs text-text-muted">N/A</span>}
                    </td>
                    <td className="py-2.5 pr-4 tabular">{l.throughputMbps != null ? formatMbps(l.throughputMbps) : 'N/A'}</td>
                    <td className="py-2.5 pr-4 tabular">{l.packetLoss != null ? l.packetLoss.toFixed(1) + '%' : 'N/A'}</td>
                    <td className="py-2.5 tabular">
                      {l.jitterMs != null ? <><AnimatedNumber value={l.jitterMs} decimals={1} /> <span className="text-xs text-text-muted">ms</span></> : <span className="text-xs text-text-muted">N/A</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile card view */}
          <div className="sm:hidden flex flex-col gap-3">
            {links.map((l) => (
              <div key={l.id} className="rounded-lg border border-surface-border bg-surface-input p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold text-text-primary">{l.source} → {l.target}</span>
                  <span className="flex items-center gap-1.5 text-xs font-medium">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: l.status === 'healthy' ? 'var(--accent)' : l.status === 'warning' ? '#F59E0B' : '#EF4444' }}
                    />
                    {l.status}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-text-muted">Latency</span>
                    <div className="font-mono font-semibold text-text-primary">
                      {l.latencyMs != null ? <><AnimatedNumber value={l.latencyMs} decimals={1} /> ms</> : 'N/A'}
                    </div>
                  </div>
                  <div>
                    <span className="text-text-muted">Throughput</span>
                    <div className="font-mono font-semibold text-text-primary">{l.throughputMbps != null ? formatMbps(l.throughputMbps) : 'N/A'}</div>
                  </div>
                  <div>
                    <span className="text-text-muted">Packet Loss</span>
                    <div className="font-mono font-semibold text-text-primary">{l.packetLoss != null ? l.packetLoss.toFixed(1) + '%' : 'N/A'}</div>
                  </div>
                  <div>
                    <span className="text-text-muted">Jitter</span>
                    <div className="font-mono font-semibold text-text-primary">
                      {l.jitterMs != null ? <><AnimatedNumber value={l.jitterMs} decimals={1} /> ms</> : 'N/A'}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Hosts */}
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text-primary">Hosts</h3>
            <span className="text-xs text-text-muted">L2/L3 devices</span>
          </div>
          <div className="flex flex-col gap-2">
            {(topology?.nodes ?? []).map((node) => {
              const IconComponent = INFRA_ICON_COMPONENTS[node.type];
              return (
                <div
                  key={node.id}
                  className="flex items-center gap-3 rounded-xl border border-surface-border/70 bg-surface-input px-3 py-2.5"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-surface-border bg-black/40">
                    {IconComponent ? <IconComponent size={18} /> : <span>{NETWORK_NODE_ICONS_FRONTEND[node.type] ?? '📦'}</span>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-text-primary">{node.label}</div>
                    <div className="text-[11px] text-text-muted">{node.ip ?? node.type}</div>
                  </div>
                  <StatusDot status={node.status} />
                </div>
              );
            })}
          </div>
          <div className="mt-4 rounded-xl border border-surface-border/70 bg-surface-input p-3">
            <div className="text-[10px] uppercase tracking-widest text-text-muted">Aggregate throughput</div>
            <div className="mt-1 flex items-center gap-3">
              <div className="flex items-center gap-1">
                <ArrowDown className="h-3.5 w-3.5 text-success" />
                <span className="font-display text-lg font-bold tabular text-accent">
                  <AnimatedNumber value={Math.round(totalDown * 0.6 * 10) / 10} />
                </span>
                <span className="text-xs text-text-muted">Mb/s</span>
              </div>
              <div className="flex items-center gap-1">
                <ArrowUp className="h-3.5 w-3.5 text-info" />
                <span className="font-display text-lg font-bold tabular text-accent">
                  <AnimatedNumber value={Math.round(totalDown * 0.4 * 10) / 10} />
                </span>
                <span className="text-xs text-text-muted">Mb/s</span>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
