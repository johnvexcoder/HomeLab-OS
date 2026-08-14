import { motion, type HTMLMotionProps } from 'framer-motion';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'ghost' | 'outline' | 'danger' | 'warning';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-[#04120D] hover:bg-accent-hover shadow-glow',
  ghost: 'bg-transparent text-text-secondary hover:text-text-primary hover:bg-overlay/5',
  outline: 'border border-surface-border bg-transparent text-text-primary hover:border-accent/40 hover:text-accent',
  danger: 'bg-crit/15 text-crit border border-crit/30 hover:bg-crit/25',
  warning: 'bg-warn/15 text-warn border border-warn/30 hover:bg-warn/25',
};

interface ButtonProps extends HTMLMotionProps<'button'> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  children?: React.ReactNode;
}

export function Button({ variant = 'primary', size = 'md', icon, className, children, ...rest }: ButtonProps) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      whileHover={{ y: -1 }}
      transition={{ duration: 0.15 }}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors cursor-pointer disabled:opacity-50 disabled:pointer-events-none',
        size === 'sm' && 'px-3 py-1.5 text-xs',
        size === 'md' && 'px-4 py-2 text-sm',
        size === 'lg' && 'px-5 py-2.5 text-sm',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </motion.button>
  );
}
