import { motion } from 'framer-motion';
import { Link, useNavigate } from 'react-router-dom';
import { BellRing, ArrowRight, CheckCheck } from 'lucide-react';
import { useNotifications } from '@/hooks/useNotifications';
import { endpoints } from '@/api/endpoints';
import { useNotificationStore } from '@/store/notifications';
import { relativeTime, cn } from '@/lib/utils';
import { SEVERITY_META } from '@/lib/constants';
import { Card, CardHeader } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Status';

export function RecentAlerts({ limit = 12 }: { limit?: number }) {
  const { items, unread, refetch } = useNotifications(20);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const markRead = useNotificationStore((s) => s.markRead);
  const navigate = useNavigate();

  const alerts = items.slice(0, limit);

  function handleMarkAll() {
    markAllRead();
    endpoints.notifications.readAll().then(() => refetch()).catch(() => undefined);
  }

  function openAlert(n: (typeof items)[number]) {
    markRead([n.id]);
    endpoints.notifications.read([n.id]).catch(() => undefined);
    navigate(`/alerts?highlight=${encodeURIComponent(n.id)}`);
  }

  return (
    <Card className="flex h-full flex-col">
      <CardHeader
        title="Recent Alerts"
        subtitle={unread > 0 ? `${unread} unread` : 'All caught up'}
        icon={<BellRing className="h-[18px] w-[18px]" />}
        action={
          <button
            onClick={handleMarkAll}
            className="flex min-h-11 items-center gap-1 px-2 text-xs font-medium text-text-muted transition-colors hover:text-accent cursor-pointer"
          >
            <CheckCheck className="h-3.5 w-3.5" /> Read all
          </button>
        }
      />

      <div className="flex flex-1 flex-col">
        {alerts.length === 0 ? (
          <div className="flex flex-1 items-center justify-center py-8">
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <ul className="max-h-[340px] space-y-1 overflow-y-auto pr-1">
            {alerts.map((n, i) => (
              <motion.li
                key={n.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: i * 0.03 }}
                onClick={() => openAlert(n)}
                className={cn(
                  'flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-overlay/[0.03] cursor-pointer',
                  !n.read && 'bg-accent/[0.04]',
                )}
              >
                <span className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', SEVERITY_META[n.severity].dot)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] font-semibold text-text-primary">{n.title}</span>
                    <span className="shrink-0 text-[10px] text-text-muted">{relativeTime(n.timestamp)}</span>
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-xs text-text-secondary">{n.message}</p>
                </div>
                {!n.read && <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent animate-pulse" />}
              </motion.li>
            ))}
          </ul>
        )}

        <div className="mt-auto pt-3">
          <Link
            to="/alerts"
            className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-surface-border px-2 py-2 text-xs font-semibold text-text-secondary transition-colors hover:border-accent/40 hover:text-accent"
          >
            View all alerts <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </Card>
  );
}
