import { motion } from 'framer-motion';
import { useClock } from '@/hooks/useClock';
import { useAuthStore } from '@/store/auth';
import { formatClock, formatDate } from '@/lib/utils';

function greetingForHour(hour: number): string {
  if (hour < 5) return 'Burning the midnight oil';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function Greeting() {
  const now = useClock();
  const user = useAuthStore((s) => s.user);

  return (
    <div className="flex flex-col gap-1">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="flex items-end justify-between gap-4"
      >
        <div>
          <p className="text-sm font-medium text-text-muted">
            {greetingForHour(now.getHours())}
          </p>
          <h1 className="mt-1 fluid-h1 font-display font-bold tracking-tight text-text-primary">
            Welcome back, <span className="text-gradient">{user?.name || user?.username || 'Guest'}</span>
          </h1>
          <p className="mt-1.5 text-sm text-text-secondary">
            Your infrastructure is operational. Here’s what’s happening right now.
          </p>
        </div>
        <div className="hidden text-right md:block">
          <div className="font-display text-4xl font-bold tabular text-text-primary">
            {formatClock(now)}
          </div>
          <div className="mt-1 text-xs uppercase tracking-[0.18em] text-text-muted">
            {formatDate(now)}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
