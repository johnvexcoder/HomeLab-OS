import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Cpu, HardDrive, MemoryStick, Thermometer, ArrowDown, ArrowUp, Layers, Server } from 'lucide-react';
import type { ServerRuntime } from '@/types';
import { ROLE_META, REACH_META, CAPABILITY_META, statusTextClass, statusDotClass, compactClusterLabel, getSecondaryRole } from '@/lib/constants';
import { formatUptime, formatBytes, formatMbps, pct, cn } from '@/lib/utils';
import { useTelemetryStore } from '@/store/telemetry';
import { useClusters } from '@/hooks/useQueries';
import { Sparkline } from '@/components/ui/Sparkline';
import { StatusDot } from '@/components/ui/Status';
import { Badge } from '@/components/ui/Badge';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';

export function ServerCard({ server, index }: { server: ServerRuntime; index: number }) {
  const sparklines = useTelemetryStore((s) => s.sparklines[server.spec.id]);
  const { clusters } = useClusters();
  const s = server.spec;
  const role = ROLE_META[s.role];
  const reach = REACH_META[server.reachability];
  const secondaryRole = getSecondaryRole(server as any, clusters);
  const cluster = s.clusterId ? clusters.find((c) => c.id === s.clusterId) : undefined;
  const clusterLabel = cluster ? compactClusterLabel(cluster.name) : undefined;

  const cpuPct = server.cpu;
  const ramPct = pct(server.ramUsedGb, s.ramTotalGb);
  const diskPct = pct(server.diskUsedGb, s.diskTotalGb);
  const tempAvailable = server.tempC > 0;
  const tempTone = tempAvailable && server.tempC >= 75 ? 'text-crit' : tempAvailable && server.tempC >= 60 ? 'text-warn' : 'text-text-primary';

  const row = (
    <div className="flex flex-col gap-3">
      {/* Identity + status header — grid keeps the status column from collapsing */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-surface-border bg-surface-elevated text-2xl">
            {s.logo}
            <span
              className={cn(
                'absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface-elevated',
                statusDotClass(server.status),
              )}
            />
          </div>
          <div className="min-w-0">
            <h3 className="truncate font-display text-base font-bold text-text-primary">{s.name}</h3>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge tone="neutral" size="sm">{role.label}</Badge>
              {secondaryRole && (
                <span className={`inline-flex items-center gap-1.5 rounded-full border font-medium tracking-wide px-2 py-0.5 text-[10px] ${secondaryRole.tone}`}>
                  {secondaryRole.label}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex min-w-20 shrink-0 flex-col items-end gap-1">
          <div className={cn('flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold', statusTextClass(server.status))}>
            <StatusDot status={server.status} />
            {server.status.toUpperCase()}
          </div>
          <div className={cn('flex items-center gap-1 whitespace-nowrap text-[11px]', reach.text)}>
            <span className={cn('h-1.5 w-1.5 rounded-full', reach.dot)} />
            {reach.label}
          </div>
        </div>
      </div>

      <p className="text-xs leading-relaxed text-text-secondary line-clamp-2">{s.description}</p>

      <div className="flex flex-wrap items-center gap-1.5">
        {(s.capabilities ?? []).map((cap) => (
          <span
            key={cap}
            className="whitespace-nowrap rounded-md border border-surface-border bg-surface-input px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-text-muted"
          >
            {CAPABILITY_META[cap]?.label ?? cap}
          </span>
        ))}
      </div>

      <div className="flex min-w-0 items-center gap-2 text-[11px]">
        <span className="shrink-0 font-mono font-medium text-text-secondary">{s.ip}</span>
        <span className="h-3 w-px shrink-0 bg-surface-border" />
        <span className="shrink-0 font-medium text-text-secondary">{s.location}</span>
        <span className="h-3 w-px shrink-0 bg-surface-border" />
        <span className="min-w-0 truncate text-text-muted">{s.hostname ?? s.id} · {s.os}</span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-xl border border-surface-border/70 bg-surface-input p-3">
        <MetricRow label="CPU" icon={Cpu} value={<AnimatedNumber value={cpuPct} decimals={0} suffix="%" className="text-text-primary" />} spark={sparklines?.cpu} color="var(--accent)" tone={cpuPct >= 85 ? 'crit' : cpuPct >= 70 ? 'warn' : 'good'} />
        <MetricRow label="Memory" icon={MemoryStick} value={<AnimatedNumber value={ramPct} decimals={0} suffix="%" className="text-text-primary" />} spark={sparklines?.ram} color="#60A5FA" tone={ramPct >= 85 ? 'crit' : ramPct >= 70 ? 'warn' : 'good'} />
        <MetricRow label="Storage" icon={HardDrive} value={<AnimatedNumber value={diskPct} decimals={0} suffix="%" className="text-text-primary" />} spark={sparklines?.disk} color="#F59E0B" tone={diskPct >= 85 ? 'crit' : diskPct >= 70 ? 'warn' : 'good'} />
        <MetricRow label="Temp" icon={Thermometer} value={tempAvailable ? <AnimatedNumber value={server.tempC} decimals={0} suffix="°C" className={tempTone} /> : <span className="text-xs text-text-muted">N/A</span>} spark={sparklines?.temp} color="#F97316" tone={tempTone} />
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <MiniMetric label="Uptime" value={formatUptime(server.uptimeSeconds)} />
        <MiniMetric label="Processes" value={<AnimatedNumber value={server.processes} />} />
        <MiniMetric
          label={s.profile.containers > 0 ? 'Containers' : 'Virtual Machines'}
          value={<AnimatedNumber value={s.profile.containers > 0 ? s.profile.containers : s.profile.vms} />}
        />
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-surface-border pt-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-muted">
          <span className="flex items-center gap-1 whitespace-nowrap"><ArrowDown className="h-3 w-3 text-success" />{formatMbps(server.netDownMbps)}</span>
          <span className="flex items-center gap-1 whitespace-nowrap"><ArrowUp className="h-3 w-3 text-info" />{formatMbps(server.netUpMbps)}</span>
          {s.role === 'docker' || s.parentId ? (
            <span className="flex items-center gap-1 whitespace-nowrap"><Layers className="h-3 w-3" />{s.profile.containers} CTs</span>
          ) : (
            <span className="flex items-center gap-1 whitespace-nowrap"><Layers className="h-3 w-3" />{s.profile.vms} VMs</span>
          )}
        </div>
        <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-accent">
          Details <ArrowUpRight className="h-3 w-3" />
        </span>
      </div>
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      transition={{ duration: 0.4, delay: index * 0.05, ease: [0.16, 1, 0.3, 1] }}
    >
      <Link to={`/servers/${s.id}`} className="card card-hover block h-full p-4 sm:p-5">
        {row}
      </Link>
    </motion.div>
  );
}

function MetricRow({
  label,
  icon: Icon,
  value,
  spark,
  color,
  tone,
}: {
  label: string;
  icon: typeof Cpu;
  value: React.ReactNode;
  spark?: number[];
  color: string;
  tone?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-text-muted">
          <Icon className="h-3 w-3" />
          {label}
        </span>
        <span className={cn('truncate text-xs font-semibold tabular', tone)}>{value}</span>
      </div>
      {/* Subtle glow keeps the spark readable on dark panels without going neon */}
      <div className="mt-1 overflow-visible" style={{ height: 28, filter: `drop-shadow(0 0 2px ${color.startsWith('#') ? `${color}55` : color})` }}>
        <Sparkline data={spark ?? []} color={color} height={28} width={120} id={`${label}-card`} />
      </div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-surface-border bg-surface-input px-2 py-1.5">
      <div className="text-xs font-semibold tabular text-text-primary">{value}</div>
      <div className="text-[9px] uppercase tracking-widest text-text-muted">{label}</div>
    </div>
  );
}
