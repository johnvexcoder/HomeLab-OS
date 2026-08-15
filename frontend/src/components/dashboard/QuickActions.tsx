import { motion } from 'framer-motion';
import { Activity, ExternalLink } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/Card';
import { useQuery } from '@tanstack/react-query';
import { endpoints } from '@/api/endpoints';
import { quickActionIcon } from '@/lib/quickActionIcons';
import type { QuickAction } from '@/types';

const TONES = [
  'text-accent bg-accent/10',
  'text-info bg-info/10',
  'text-warn bg-warn/10',
  'text-text-secondary bg-overlay/5',
];

export function QuickActions() {
  const { data } = useQuery({
    queryKey: ['quick-actions'],
    queryFn: endpoints.quickActions.list,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const actions: QuickAction[] = data ?? [];

  return (
    <Card className="h-full">
      <CardHeader
        title="Quick Actions"
        subtitle="One-click operations"
        icon={<Activity className="h-[18px] w-[18px]" />}
      />
      {actions.length === 0 ? (
        <p className="px-1 text-sm text-text-muted">
          No quick actions configured. Add them under Configuration → Quick Actions.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {actions.map((action, i) => {
            const Icon = quickActionIcon(action.icon);
            const tone = TONES[i % TONES.length];
            const inner = (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.04 * i }}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.97 }}
                className="flex min-h-11 items-center gap-2.5 rounded-xl border border-surface-border bg-surface-elevated px-3 py-2.5 text-sm font-medium text-text-primary transition-colors hover:border-accent/30 hover:bg-surface-hover cursor-pointer"
              >
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone}`}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1 truncate">{action.label}</span>
                {action.href && <ExternalLink className="h-3.5 w-3.5 shrink-0 text-text-muted" />}
              </motion.div>
            );

            if (action.href) {
              return (
                <a key={action.id} href={action.href} target="_blank" rel="noreferrer" className="block">
                  {inner}
                </a>
              );
            }
            return (
              <button key={action.id} type="button" className="block w-full text-left" disabled>
                {inner}
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}
