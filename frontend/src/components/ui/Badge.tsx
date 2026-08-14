import { cn } from '@/lib/utils';

type BadgeTone = 'accent' | 'warn' | 'crit' | 'info' | 'neutral' | 'success';

const TONES: Record<BadgeTone, string> = {
  accent: 'bg-accent/10 text-accent border-accent/25',
  success: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',
  warn: 'bg-warn/10 text-warn border-warn/25',
  crit: 'bg-crit/10 text-crit border-crit/25',
  info: 'bg-info/10 text-info border-info/25',
  neutral: 'bg-overlay/5 text-text-secondary border-overlay/10',
};

export function Badge({
  tone = 'neutral',
  dot,
  size = 'md',
  className,
  children,
}: {
  tone?: BadgeTone;
  dot?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-medium tracking-wide',
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-0.5 text-[11px]',
        TONES[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />}
      {children}
    </span>
  );
}
