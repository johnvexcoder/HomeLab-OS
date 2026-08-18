import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Cpu,
  MemoryStick,
  HardDrive,
  Thermometer,
  ArrowUp,
  ArrowDown,
  Layers,
  Activity,
  Clock,
  MapPin,
  Network as NetworkIcon,
  Server as ServerIcon,
} from 'lucide-react';
import { useTelemetry } from '@/hooks/useTelemetry';
import { useClusters } from '@/hooks/useQueries';
import type { HistoryRange, MetricKey } from '@/types';
import { MetricChart } from '@/components/charts/MetricChart';
import { HardwareTelemetry } from '@/components/hardware/HardwareTelemetry';
import { Badge } from '@/components/ui/Badge';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { ProgressBar, ProgressRing } from '@/components/ui/Progress';
import { Skeleton, StatusDot } from '@/components/ui/Status';
import { ROLE_META, REACH_META, CAPABILITY_META } from '@/lib/constants';
import { formatUptime, formatBytes, formatMbps, pct, cn } from '@/lib/utils';

const METRIC_GRAPHS: Array<{ key: MetricKey; label: string; icon: typeof Cpu; color: string }> = [
  { key: 'cpu', label: 'CPU', icon: Cpu, color: 'var(--accent)' },
  { key: 'ram', label: 'Memory', icon: MemoryStick, color: '#60A5FA' },
  { key: 'disk', label: 'Storage', icon: HardDrive, color: '#F59E0B' },
  { key: 'temp', label: 'Temperature', icon: Thermometer, color: '#F97316' },
  { key: 'netDown', label: 'Network', icon: NetworkIcon, color: '#34D399' },
];

export default function ServerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { servers, loading } = useTelemetry();
  const [range, setRange] = useState<HistoryRange>('1h');
  const { clusters } = useClusters();
  const server = servers.find((s) => s.spec.id === id);

  if (loading && !server) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-40" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  if (!server) {
    return (
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <div className="text-4xl">🛰️</div>
        <h1 className="font-display text-xl font-bold text-text-primary">Server not found</h1>
        <Link to="/servers" className="text-sm font-semibold text-accent hover:text-accent-hover">
          ← Back to servers
        </Link>
      </div>
    );
  }

  const s = server.spec;
  const role = ROLE_META[s.role];
  const reach = REACH_META[server.reachability];
  const ramPct = pct(server.ramUsedGb, s.ramTotalGb);
  const diskPct = pct(server.diskUsedGb, s.diskTotalGb);
  const cluster = s.clusterId ? clusters.find((c) => c.id === s.clusterId) : undefined;

  return (
    <div className="flex flex-col gap-6">
      {/* Breadcrumb */}
      <Link
        to="/servers"
        className="flex w-fit items-center gap-1.5 text-sm text-text-muted transition-colors hover:text-text-primary"
      >
        <ArrowLeft className="h-4 w-4" /> All servers
      </Link>

      {/* Header card — locked 2-col format on desktop */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className="card grid grid-cols-1 gap-6 p-6 md:grid-cols-[1fr_auto]"
      >
        {/* Left: info */}
        <div className="flex items-start gap-4">
          <div className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-surface-border bg-surface-elevated text-3xl">
            {s.logo}
            <span
              className={cn(
                'absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full border-2 border-surface-elevated',
                server.status === 'online' ? 'bg-success' : server.status === 'degraded' ? 'bg-warn' : 'bg-crit',
              )}
            />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="fluid-h1 font-display font-bold tracking-tight text-text-primary">{s.name}</h1>
              <Badge tone="neutral">{role.label}</Badge>
              {cluster ? (
                <Badge tone="info">
                  <ServerIcon className="h-3 w-3" />
                  {cluster.name}
                </Badge>
              ) : (
                <Badge tone="neutral">Standalone</Badge>
              )}
              <Badge tone={server.status === 'online' ? 'success' : server.status === 'degraded' ? 'warn' : 'crit'} dot>
                {server.status.toUpperCase()}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-text-secondary">{s.description}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
              <span className="flex items-center gap-1"><ServerIcon className="h-3.5 w-3.5" />{s.hostname ?? s.id}</span>
              <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{s.location}</span>
              <span className="flex items-center gap-1 font-mono"><NetworkIcon className="h-3.5 w-3.5" />{s.ip}</span>
              <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />Uptime {formatUptime(server.uptimeSeconds)}</span>
              <span className="flex items-center gap-1"><Activity className="h-3.5 w-3.5" />{s.cpuModel}</span>
              {s.serverId && <span className="font-mono text-[10px] text-text-muted/70">{s.serverId}</span>}
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {(s.capabilities ?? []).map((cap) => (
                <span
                  key={cap}
                  className="rounded-md border border-surface-border bg-surface-input px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-muted"
                >
                  {CAPABILITY_META[cap]?.label ?? cap}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Right: health ring + stats grid */}
        <div className="flex items-center gap-6">
          <div className="text-center">
            <div className="text-[10px] uppercase tracking-widest text-text-muted">Health</div>
            <ProgressRing value={server.health} size={84} stroke={7} label="" />
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2">
            <HeaderStat label="Status" value={server.status.toUpperCase()} tone={server.status === 'online' ? 'text-accent' : server.status === 'degraded' ? 'text-warn' : 'text-crit'} />
            <HeaderStat label="Reach" value={reach.label} tone={reach.text} />
            <HeaderStat label="Load" value={<><AnimatedNumber value={server.load} decimals={1} /></>} />
            <HeaderStat label="Processes" value={<AnimatedNumber value={server.processes} />} />
            <HeaderStat label="Containers" value={<AnimatedNumber value={s.profile.containers} />} />
            <HeaderStat label="VMs" value={<AnimatedNumber value={s.profile.vms} />} />
          </div>
        </div>
      </motion.div>

      {/* Live metric cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <LiveMetric label="CPU" icon={Cpu} value={server.cpu} unit="%" color="var(--accent)" />
        <LiveMetric label="Memory" icon={MemoryStick} value={ramPct} unit="%" color="#60A5FA" sub={`${formatBytes(server.ramUsedGb)} / ${formatBytes(s.ramTotalGb)}`} />
        <LiveMetric label="Storage" icon={HardDrive} value={diskPct} unit="%" color="#F59E0B" sub={`${formatBytes(server.diskUsedGb)} / ${formatBytes(s.diskTotalGb)}`} />
        <LiveMetric label="Temperature" icon={Thermometer} value={server.tempC} unit="°C" color="#F97316" />
      </div>

      {/* Per-metric line graphs */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {METRIC_GRAPHS.map((m) => {
          const Icon = m.icon;
          return (
            <motion.div
              key={m.key}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              className="card p-4"
            >
              <MetricChart server={server} metric={m.key} range={range} onRangeChange={setRange} height={180} />
            </motion.div>
          );
        })}
      </div>

      {/* Resource breakdown */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <ResourceCard label="CPU Utilization" value={server.cpu} unit="%" color="var(--accent)" detail={`${s.cpuCores} logical cores · ${formatUptime(server.uptimeSeconds)} uptime`} />
        <ResourceCard label="Memory Usage" value={ramPct} unit="%" color="#60A5FA" detail={`${formatBytes(server.ramUsedGb)} used of ${formatBytes(s.ramTotalGb)}`} />
        <ResourceCard label="Storage Usage" value={diskPct} unit="%" color="#F59E0B" detail={`${formatBytes(server.diskUsedGb)} used of ${formatBytes(s.diskTotalGb)}`} />
      </div>

      {/* Network throughput */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="card flex items-center justify-between gap-4 p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
              <ArrowDown className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-text-primary">Download</div>
              <div className="text-xs text-text-muted">Inbound throughput</div>
            </div>
          </div>
          <div className="font-display text-2xl font-bold tabular text-accent">
            <AnimatedNumber value={server.netDownMbps} />
            <span className="ml-1 text-sm font-normal text-text-muted">Mb/s</span>
          </div>
        </div>
        <div className="card flex items-center justify-between gap-4 p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-info/10 text-info">
              <ArrowUp className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-text-primary">Upload</div>
              <div className="text-xs text-text-muted">Outbound throughput</div>
            </div>
          </div>
          <div className="font-display text-2xl font-bold tabular text-info">
            <AnimatedNumber value={server.netUpMbps} />
            <span className="ml-1 text-sm font-normal text-text-muted">Mb/s</span>
          </div>
        </div>
      </div>

      {/* Hardware telemetry (optional sensors) */}
      <HardwareTelemetry sensors={server.sensors} />
    </div>
  );
}

function HeaderStat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-text-muted">{label}</div>
      <div className={cn('text-sm font-bold text-text-primary', tone)}>{value}</div>
    </div>
  );
}

function LiveMetric({
  label,
  icon: Icon,
  value,
  unit,
  color,
  sub,
}: {
  label: string;
  icon: typeof Cpu;
  value: number;
  unit: string;
  color: string;
  sub?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="card card-hover p-4"
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-text-muted">
          <Icon className="h-3.5 w-3.5" style={{ color }} /> {label}
        </span>
        <StatusDot status="online" pulse />
      </div>
      <div className="mt-2 font-display text-2xl font-bold tabular" style={{ color }}>
        <AnimatedNumber value={value} decimals={value < 10 ? 1 : 0} />
        <span className="ml-1 text-xs font-normal text-text-muted">{unit}</span>
      </div>
      {sub && <div className="mt-1 text-[11px] text-text-muted">{sub}</div>}
    </motion.div>
  );
}

function ResourceCard({
  label,
  value,
  unit,
  color,
  detail,
}: {
  label: string;
  value: number;
  unit: string;
  color: string;
  detail: string;
}) {
  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-text-primary">{label}</span>
        <span className="font-display text-lg font-bold tabular" style={{ color }}>
          {Math.round(value)}
          <span className="ml-0.5 text-xs font-normal text-text-muted">{unit}</span>
        </span>
      </div>
      <ProgressBar value={value} color={color} />
      <div className="mt-2 text-[11px] text-text-muted">{detail}</div>
    </div>
  );
}
