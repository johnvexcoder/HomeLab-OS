import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface ProgressRingProps {
  value: number; // 0..100
  size?: number;
  stroke?: number;
  color?: string;
  trackColor?: string;
  label?: string;
  sublabel?: string;
  className?: string;
}

export function toneColor(value: number): string {
  if (value >= 85) return '#EF4444';
  if (value >= 70) return '#F59E0B';
  return '#34D399';
}

export function ProgressRing({
  value,
  size = 132,
  stroke = 8,
  color,
  trackColor = 'var(--surface-border)',
  label,
  sublabel,
  className,
}: ProgressRingProps) {
  const [display, setDisplay] = useState(0);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const resolvedColor = color ?? toneColor(value);

  useEffect(() => {
    const target = value;
    const start = display;
    const startTime = performance.now();
    const duration = 900;

    let raf: number;
    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(start + (target - start) * eased);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  const offset = useMemo(
    () => circumference - (display / 100) * circumference,
    [circumference, display],
  );

  return (
    <div
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90" style={{ overflow: 'visible' }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={resolvedColor}
          strokeWidth={stroke}
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray="100 100"
          strokeDashoffset={offset / circumference * 100}
          style={{ filter: `drop-shadow(0 0 6px ${resolvedColor}66)` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-2xl font-bold tabular" style={{ color: resolvedColor }}>
          {Math.round(display)}
        </span>
        {label && <span className="text-[11px] font-medium uppercase tracking-wider text-text-secondary mt-1">{label}</span>}
        {sublabel && <span className="text-[10px] text-text-muted mt-0.5">{sublabel}</span>}
      </div>
    </div>
  );
}

export function ProgressBar({
  value,
  className,
  color,
  showValue = true,
  height = 6,
}: {
  value: number;
  className?: string;
  color?: string;
  showValue?: boolean;
  height?: number;
}) {
  const resolvedColor = color ?? toneColor(value);
  return (
    <div className={cn('w-full', className)}>
      <div
        className="w-full overflow-hidden rounded-full bg-surface-border/40"
        style={{ height }}
        role="progressbar"
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <motion.div
          className="h-full rounded-full transition-shadow"
          style={{ backgroundColor: resolvedColor, boxShadow: `inset 0 0 6px ${resolvedColor}33, 0 0 12px ${resolvedColor}44` }}
          initial={false}
          animate={{ width: `${Math.min(100, Math.max(0, value))}%` }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
      {showValue && (
        <div className="mt-1 text-right text-[11px] text-text-muted tabular">
          {Math.round(value)}%
        </div>
      )}
    </div>
  );
}
