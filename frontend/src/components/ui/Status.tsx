import { cn } from '@/lib/utils';
import type { ServerStatus, Reachability, Severity } from '@/types';

export function StatusDot({
  status,
  className,
  pulse = true,
}: {
  status: ServerStatus;
  className?: string;
  pulse?: boolean;
}) {
  const color =
    status === 'online' ? 'bg-accent' : status === 'degraded' ? 'bg-warn' : 'bg-crit';

  return (
    <span className={cn('relative flex h-2.5 w-2.5', className)}>
      {pulse && (
        <span className={cn('absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping', color)} />
      )}
      <span className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', color)} />
    </span>
  );
}

export function ReachDot({ reachability }: { reachability: Reachability }) {
  const color =
    reachability === 'accessible' ? 'bg-accent' : reachability === 'degraded' ? 'bg-warn' : 'bg-crit';
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
