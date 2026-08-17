import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, Cpu, HardDrive, HeartPulse, MemoryStick, Server, Thermometer, Timer } from 'lucide-react';
import { useTelemetry } from '@/hooks/useTelemetry';
import { Card, CardHeader } from '@/components/ui/Card';
import { Skeleton, StatusDot } from '@/components/ui/Status';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { ROLE_META, REACH_META, statusDotClass } from '@/lib/constants';
import { formatUptime, formatMbps, pct, pctClass, cn } from '@/lib/utils';
import type { ServerRuntime } from '@/types';

const BAR_COLOR = {
  good: 'bg-success',
  warn: 'bg-warn',
  crit: 'bg-crit',
} as const;

function HostRow({ server }: { server: ServerRuntime }) {
  const s = server.spec;
  const role = ROLE_META[s.role];
  const reach = REACH_META[server.reachability];

  const cpuTone = pctClass(server.cpu);
  const ramTone = pctClass(pct(server.ramUsedGb, s.ramTotalGb));
  const diskTone = pctClass(pct(server.diskUsedGb, s.diskTotalGb));
  const healthTone = pctClass(server.health);
  const tempAvailable = server.tempC > 0;

  return (
    <div className="card p-4 transition-colors duration-200 hover:border-surface-border/70">
      <div className="flex items-start gap-3">
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-surface-border bg-surface-elevated text-xl">
          {s.logo}
          <span
            className={cn('absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface-elevated', statusDotClass(server.status))}
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="truncate font-display text-sm font-bold text-text-primary">{s.name}</h3>
              <span className="shrink-0 rounded-md border border-surface-border bg-surface-input px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-text-muted">
                {role.label}
              </span>
            </div>
            <span
              className={cn(
                'flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold',
                server.status === 'online' ? 'text-success' : server.status === 'degraded' ? 'text-warn' : 'text-crit',
              )}
            >
              <StatusDot status={server.status} />
              {server.status.toUpperCase()}
            </span>
          </div>

          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
            <span className="truncate font-mono text-text-secondary">{s.ip}</span>
            <span className="h-3 w-px shrink-0 bg-surface-border" />
            <span className="flex shrink-0 items-center gap-1 text-text-muted">
              <span className={cn('h-1.5 w-1.5 rounded-full', reach.dot)} />
              {reach.label}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-x-4 gap-y-2">
        <MetricBar label="CPU" icon={<Cpu className="h-3 w-3" />} pct={server.cpu} tone={cpuTone} />
        <MetricBar label="RAM" icon={<MemoryStick className="h-3 w-3" />} pct={pct(server.ramUsedGb, s.ramTotalGb)} tone={ramTone} />
        <MetricBar label="DISK" icon={<HardDrive className="h-3 w-3" />} pct={pct(server.diskUsedGb, s.diskTotalGb)} tone={diskTone} />
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-surface-border pt-2 text-[11px] text-text-muted">
        {tempAvailable && (
          <span className="flex items-center gap-1 whitespace-nowrap">
            <Thermometer className="h-3 w-3" />
            <AnimatedNumber value={server.tempC} decimals={0} suffix="°C" />
          </span>
        )}
        <span className="flex items-center gap-1 whitespace-nowrap">
          <ArrowDown className="h-3 w-3 text-success" />
          {formatMbps(server.netDownMbps)}
        </span>
        <span className="flex items-center gap-1 whitespace-nowrap">
          <ArrowUp className="h-3 w-3 text-info" />
          {formatMbps(server.netUpMbps)}
        </span>
        <span className="flex items-center gap-1 whitespace-nowrap">
          <Timer className="h-3 w-3" />
          {formatUptime(server.uptimeSeconds)}
        </span>
        <span
          className={cn(
            'ml-auto flex items-center gap-1 whitespace-nowrap font-semibold',
            healthTone === 'crit' ? 'text-crit' : healthTone === 'warn' ? 'text-warn' : 'text-success',
          )}
        >
          <HeartPulse className="h-3 w-3" />
          <AnimatedNumber value={server.health} decimals={0} />
        </span>
      </div>
    </div>
  );
}

function MetricBar({ label, icon, pct: value, tone }: { label: string; icon: React.ReactNode; pct: number; tone: 'good' | 'warn' | 'crit' }) {
  const width = Math.min(100, Math.max(0, value));
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-1.5">
        <span className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-text-muted">
          {icon}
          {label}
        </span>
        <span className="truncate text-[11px] font-semibold tabular text-text-primary">
          <AnimatedNumber value={value} decimals={0} suffix="%" />
        </span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-active">
        <div className={cn('h-full rounded-full transition-[width] duration-500', BAR_COLOR[tone])} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

export function Hosts() {
  const { servers, loading } = useTelemetry();

  return (
    <Card padded={false} className="p-5">
      <CardHeader
        title="Hosts"
        subtitle={`${loading ? '…' : servers.length} devices across the fleet`}
        icon={<Server className="h-[18px] w-[18px]" />}
        action={
          <Link
            to="/servers"
            className="flex items-center gap-1 text-xs font-semibold text-accent transition-colors hover:text-accent-hover"
          >
            View all
          </Link>
        }
      />

      {loading && servers.length === 0 ? (
        <div className="flex flex-col gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {servers.map((server) => (
            <HostRow key={server.spec.id} server={server} />
          ))}
        </div>
      )}
    </Card>
  );
}
