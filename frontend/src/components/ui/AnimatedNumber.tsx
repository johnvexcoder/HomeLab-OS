import { useEffect, useRef } from 'react';
import { motion, animate, useMotionValue, useTransform } from 'framer-motion';
import { cn } from '@/lib/utils';

interface AnimatedNumberProps {
  value: number;
  decimals?: number;
  className?: string;
  duration?: number;
  prefix?: string;
  suffix?: string;
}

export function AnimatedNumber({ value, decimals = 0, className, duration = 0.8, prefix = '', suffix = '' }: AnimatedNumberProps) {
  const motionValue = useMotionValue(value);
  const ref = useRef<HTMLSpanElement>(null);
  const rounded = useTransform(motionValue, (v) => v.toFixed(decimals));

  useEffect(() => {
    const controls = animate(motionValue, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
    });
    return controls.stop;
  }, [value, duration, motionValue]);

  return (
    <span className={cn('tabular', className)}>
      {prefix}
      <motion.span ref={ref}>{rounded}</motion.span>
      {suffix}
    </span>
  );
}
