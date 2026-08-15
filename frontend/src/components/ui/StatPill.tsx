import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/Status';

export function StatPill({
  label,
  value,
  unit,
  className,
}: {
  label: string;
  value?: string;
  unit?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-0.5', className)}>
      <span className="text-[10px] uppercase tracking-widest text-text-muted">{label}</span>
      {value !== undefined ? (
        <span className="break-words font-display text-lg font-semibold tabular">
          {value}
          {unit && <span className="text-xs font-normal text-text-muted ml-1">{unit}</span>}
        </span>
      ) : (
        <Skeleton className="h-5 w-14" />
      )}
    </div>
  );
}
