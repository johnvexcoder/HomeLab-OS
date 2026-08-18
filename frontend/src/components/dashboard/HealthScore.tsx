import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ShieldCheck, X, ArrowDown, ArrowUp } from 'lucide-react';
import { useTelemetry } from '@/hooks/useTelemetry';
import { useQuickStats, useStatsHistory } from '@/hooks/useQueries';
import { globalHealthFromServers } from '@/store/telemetry';
import { ProgressRing } from '@/components/ui/Progress';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { cn } from '@/lib/utils';
import type { StatsHistoryPoint } from '@/types';

export function HealthScore() {
  const { servers } = useTelemetry();
  const health = globalHealthFromServers(servers);
  const [open, setOpen] = useState(false);

  const statusTone =
    health.status === 'online' ? 'success' : health.status === 'degraded' ? 'warn' : 'crit';

  const contributors = useMemo(() => {
    return servers
      .map((s) => {
        const reasons: string[] = [];
        if (s.status === 'offline') reasons.push('server offline');
        else if (s.status === 'degraded') reasons.push('server degraded');
        else if (s.health < 90) reasons.push(`health ${Math.round(s.health)}%`);
        if (s.reachability === 'unreachable') reasons.push('unreachable');
        else if (s.reachability === 'degraded') reasons.push('elevated latency');
        if (s.tempC > 80) reasons.push(`temperature ${Math.round(s.tempC)}°C`);
        return { server: s, reasons };
      })
      .filter((c) => c.reasons.length > 0);
  }, [servers]);

  const warningCount = contributors.length;

  return (
    <Card hover className="flex h-full flex-col justify-between gap-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Infrastructure Health</h3>
            <p className="text-xs text-text-muted">
              <AnimatedNumber value={health.score} decimals={1} /> / 100
            </p>
          </div>
        </div>
        <Badge tone={statusTone} dot>
          {health.status.toUpperCase()}
        </Badge>
      </div>

      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-36 sm:min-h-44 items-center justify-center outline-none cursor-pointer transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-accent/50 rounded-lg"
        title="Click for details"
        aria-label="Infrastructure health breakdown - click for details"
      >
        <ProgressRing value={health.score} size={148} stroke={10} label="Health" sublabel="Score" />
      </button>

      <div className="grid grid-cols-3 gap-2">
        <MiniStat label="Online" value={health.onlineServers} total={health.totalServers} tone="text-accent" />
        <MiniStat label="Offline" value={health.offlineServers} tone="text-crit" />
        <MiniStat label="Warnings" value={warningCount} tone="text-warn" />
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 overflow-y-auto bg-black/70 px-4 py-4 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="my-auto w-full max-w-lg rounded-2xl border border-surface-border bg-surface-elevated p-4 shadow-card sm:p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-display text-lg font-bold text-text-primary">Infrastructure Health</h3>
                  <p className="text-sm text-text-muted">
                    <AnimatedNumber value={health.score} decimals={1} /> / 100 —{' '}
                    <span className="text-text-secondary">{health.status}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-overlay/5 hover:text-text-primary cursor-pointer"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mb-3 grid grid-cols-3 gap-2">
                <MiniStat label="Online" value={health.onlineServers} total={health.totalServers} tone="text-accent" />
                <MiniStat label="Offline" value={health.offlineServers} tone="text-crit" />
                <MiniStat label="Warnings" value={warningCount} tone="text-warn" />
              </div>

              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-text-muted">
                {warningCount === 0 ? 'All systems nominal' : 'Contributing to score'}
              </p>

              {warningCount === 0 ? (
                <p className="rounded-xl border border-surface-border/70 bg-surface-input px-4 py-3 text-sm text-text-secondary">
                  No warnings detected. Every monitored server is healthy.
                </p>
              ) : (
                <div className="flex max-h-64 flex-col gap-2 overflow-y-auto pr-1">
                  {contributors.map(({ server, reasons }) => (
                    <div
                      key={server.spec.id}
                      className="flex items-start gap-3 rounded-xl border border-surface-border/70 bg-surface-input px-4 py-3"
                    >
                      <span
                        className={cn(
                          'mt-1 h-2 w-2 shrink-0 rounded-full',
                          server.status === 'offline' ? 'bg-crit' : server.status === 'degraded' ? 'bg-warn' : 'bg-accent',
                        )}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-text-primary">{server.spec.name}</span>
                          <Badge tone={server.status === 'offline' ? 'crit' : server.status === 'degraded' ? 'warn' : 'accent'}>
                            {server.status}
                          </Badge>
                        </div>
                        <p className="mt-0.5 text-xs text-text-muted">{reasons.join(' · ')}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

function MiniStat({
  label,
  value,
  total,
  tone,
}: {
  label: string;
  value: number;
  total?: number;
  tone: string;
}) {
  return (
    <div className="rounded-xl border border-surface-border bg-surface-elevated p-3 text-center">
      <div className={cn('font-display text-xl font-bold tabular', tone)}>
        <AnimatedNumber value={value} />
        {total !== undefined && <span className="text-xs font-normal text-text-muted">/{total}</span>}
      </div>
      <div className="mt-0.5 text-[10px] uppercase tracking-widest text-text-muted">{label}</div>
    </div>
  );
}

function formatUptimeFromSec(totalSec: number): { days: number; hrs: number; mins: number } {
  const days = Math.floor(totalSec / 86400);
  const hrs = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  return { days, hrs, mins };
}

export function QuickStats() {
  const { stats } = useQuickStats();
  const { points } = useStatsHistory('15m');

  const sparklineOf = useMemo(() => {
    const keyByStatId: Record<string, (p: StatsHistoryPoint) => number> = {
      cpu: (p) => p.cpu,
      ram: (p) => p.mem,
      download: (p) => p.network,
      upload: (p) => p.network,
      containers: (p) => p.containers,
    };
    return (id: string) => keyByStatId[id];
  }, []);

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {stats.map((stat, i) => {
        const pick = sparklineOf(stat.id);
        const series = pick ? points.map(pick).slice(-24) : [];

        // Uptime: show Days | Hrs | Mins
        if (stat.id === 'uptime') {
          const { days, hrs, mins } = formatUptimeFromSec(stat.value);
          return (
            <motion.div
              key={stat.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.05 * i, ease: [0.16, 1, 0.3, 1] }}
              className="card card-hover flex items-center justify-between gap-3 p-4"
            >
              <div className="min-w-0 overflow-hidden">
                <div className="flex items-center gap-1.5 tabular">
                  <span className="font-display text-base font-bold text-text-primary sm:text-lg">{days}<span className="ml-0.5 text-[10px] font-normal text-text-muted">D</span></span>
                  <span className="text-text-muted">|</span>
                  <span className="font-display text-base font-bold text-text-primary sm:text-lg">{hrs}<span className="ml-0.5 text-[10px] font-normal text-text-muted">H</span></span>
                  <span className="text-text-muted">|</span>
                  <span className="font-display text-base font-bold text-text-primary sm:text-lg">{mins}<span className="ml-0.5 text-[10px] font-normal text-text-muted">M</span></span>
                </div>
                <div className="text-[11px] uppercase tracking-widest text-text-muted">{stat.label}</div>
              </div>
              {series.length >= 2 ? (
                <Sparkline series={series} className="shrink-0" />
              ) : null}
            </motion.div>
          );
        }

        // Download card: show arrow down icon
        if (stat.id === 'download') {
          return (
            <motion.div
              key={stat.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.05 * i, ease: [0.16, 1, 0.3, 1] }}
              className="card card-hover flex items-center justify-between gap-3 p-4"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <ArrowDown className="h-4 w-4 text-success" />
                  <div className="font-display text-xl font-bold tabular text-text-primary sm:text-2xl">
                    <AnimatedNumber value={stat.value} decimals={stat.value < 10 ? 1 : 0} />
                    <span className="ml-1 text-xs font-normal text-text-muted">{stat.unit}</span>
                  </div>
                </div>
                <div className="text-[11px] uppercase tracking-widest text-text-muted">{stat.label}</div>
              </div>
              {series.length >= 2 ? (
                <Sparkline series={series} className="shrink-0" />
              ) : null}
            </motion.div>
          );
        }

        // Upload card: show arrow up icon
        if (stat.id === 'upload') {
          return (
            <motion.div
              key={stat.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.05 * i, ease: [0.16, 1, 0.3, 1] }}
              className="card card-hover flex items-center justify-between gap-3 p-4"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <ArrowUp className="h-4 w-4 text-info" />
                  <div className="font-display text-xl font-bold tabular text-text-primary sm:text-2xl">
                    <AnimatedNumber value={stat.value} decimals={stat.value < 10 ? 1 : 0} />
                    <span className="ml-1 text-xs font-normal text-text-muted">{stat.unit}</span>
                  </div>
                </div>
                <div className="text-[11px] uppercase tracking-widest text-text-muted">{stat.label}</div>
              </div>
              {series.length >= 2 ? (
                <Sparkline series={series} className="shrink-0" />
              ) : null}
            </motion.div>
          );
        }

        // VMs & CTs split card
        if (stat.id === 'containers') {
          return (
            <motion.div
              key={stat.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.05 * i, ease: [0.16, 1, 0.3, 1] }}
              className="card card-hover flex items-center justify-between gap-3 p-4"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <div className="text-center">
                    <div className="font-display text-xl font-bold tabular text-text-primary sm:text-2xl">
                      <AnimatedNumber value={stat.value} />
                    </div>
                    <div className="text-[10px] uppercase tracking-widest text-text-muted">VMs</div>
                  </div>
                  <div className="h-8 w-px bg-surface-border" />
                  <div className="text-center">
                    <div className="font-display text-xl font-bold tabular text-text-primary sm:text-2xl">
                      <AnimatedNumber value={stat.value2 ?? 0} />
                    </div>
                    <div className="text-[10px] uppercase tracking-widest text-text-muted">CTs</div>
                  </div>
                </div>
              </div>
              {series.length >= 2 ? (
                <Sparkline series={series} className="shrink-0" />
              ) : null}
            </motion.div>
          );
        }

        // Default card
        return (
          <motion.div
            key={stat.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.05 * i, ease: [0.16, 1, 0.3, 1] }}
            className="card card-hover flex items-center justify-between gap-3 p-4"
          >
            <div className="min-w-0">
              <div className="font-display text-xl font-bold tabular text-text-primary sm:text-2xl">
                <AnimatedNumber value={stat.value} decimals={stat.value < 10 ? 1 : 0} />
                <span className="ml-1 text-xs font-normal text-text-muted">{stat.unit}</span>
              </div>
              <div className="text-[11px] uppercase tracking-widest text-text-muted">{stat.label}</div>
            </div>
            {series.length >= 2 ? (
              <Sparkline series={series} className="shrink-0" />
            ) : null}
          </motion.div>
        );
      })}
    </div>
  );
}

function Sparkline({ series, className }: { series: number[]; className?: string }) {
  const points = useMemo(() => {
    const min = Math.min(...series);
    const max = Math.max(...series);
    const span = max - min || 1;
    const w = 64;
    const h = 24;
    const step = series.length > 1 ? w / (series.length - 1) : 0;
    return series
      .map((v, i) => {
        const x = i * step;
        const y = h - 2 - ((v - min) / span) * (h - 4);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [series]);

  const last = series[series.length - 1];
  const first = series[0];
  const trendingUp = last >= first;

  return (
    <svg width="64" height="24" viewBox="0 0 64 24" fill="none" className={className} aria-hidden="true">
      <polyline
        points={points}
        stroke={trendingUp ? 'currentColor' : '#f43f5e'}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-accent"
      />
    </svg>
  );
}
