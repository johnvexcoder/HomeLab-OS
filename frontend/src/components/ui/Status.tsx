import { cn } from '@/lib/utils';
import type { Severity } from '@/types';

export function StatusDot({
  status,
  className,
  pulse = true,
}: {
  status: string;
  className?: string;
  pulse?: boolean;
}) {
  const color =
    status === 'online' ? 'bg-success'
      : status === 'degraded' ? 'bg-warn'
        : status === 'offline' ? 'bg-crit'
          : 'bg-text-muted';

  return (
    <span className={cn('relative flex h-2.5 w-2.5', className)}>
      {pulse && (
        <span className={cn('absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping', color)} />
      )}
      <span className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', color)} />
    </span>
  );
}

export function ReachDot({ reachability }: { reachability: string }) {
  const color =
    reachability === 'accessible' ? 'bg-success'
      : reachability === 'degraded' ? 'bg-warn'
        : reachability === 'unreachable' ? 'bg-crit'
          : 'bg-text-muted';
  return <span className={cn('h-2 w-2 rounded-full', color)} />;
}

export function SeverityDot({ severity }: { severity: Severity }) {
  const color =
    severity === 'critical' ? 'bg-crit' : severity === 'warning' ? 'bg-warn' : severity === 'success' ? 'bg-accent' : 'bg-info';
  return <span className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', color)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-lg bg-surface-active/60',
        className,
      )}
    />
  );
}
