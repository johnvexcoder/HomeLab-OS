import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { BellRing, CheckCheck, Filter } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useNotifications } from '@/hooks/useNotifications';
import { useNotificationStore } from '@/store/notifications';
import { endpoints } from '@/api/endpoints';
import { SEVERITY_META } from '@/lib/constants';
import { relativeTime, cn } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Status';
import type { Severity } from '@/types';

type FilterId = Severity | 'all';

const FILTERS: Array<{ id: FilterId; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'critical', label: 'Critical' },
  { id: 'warning', label: 'Warning' },
  { id: 'success', label: 'Success' },
  { id: 'info', label: 'Info' },
];

export default function AlertsPage() {
  const { items, unread, refetch } = useNotifications(100);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const markRead = useNotificationStore((s) => s.markRead);
  const [filter, setFilter] = useState<FilterId>('all');
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [params, setParams] = useSearchParams();
  const highlightId = params.get('highlight');
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const visible = items.filter(
    (n) =>
      (filter === 'all' || n.severity === filter) &&
      (!showUnreadOnly || !n.read),
  );

  useEffect(() => {
    if (!highlightId) return;
    // Ensure the targeted alert is visible regardless of active filters.
    setFilter('all');
    setShowUnreadOnly(false);
    const n = items.find((x) => x.id === highlightId);
    if (n && !n.read) {
      markRead([n.id]);
      endpoints.notifications.read([n.id]).catch(() => undefined);
    }
    setFlashId(highlightId);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => {
      setFlashId(null);
      setParams({}, { replace: true });
    }, 4500);
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightId]);

  useEffect(() => {
    if (!flashId) return;
    rowRefs.current[flashId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [flashId, visible]);

  function handleMarkAll() {
    markAllRead();
    endpoints.notifications.readAll().then(() => refetch()).catch(() => undefined);
  }

  function handleMarkRead(n: (typeof items)[number]) {
    if (n.read) return;
    markRead([n.id]);
    endpoints.notifications.read([n.id]).catch(() => undefined);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="fluid-h1 font-display font-bold tracking-tight text-text-primary">Alerts</h1>
          <p className="mt-1 text-sm text-text-muted">
            {unread > 0 ? (
              <>
                <span className="text-warn">{unread} unread</span> · {items.length} total
              </>
            ) : (
              'All caught up'
            )}
          </p>
        </div>
        <button
          onClick={handleMarkAll}
          disabled={unread === 0}
          className="flex items-center gap-2 rounded-xl border border-surface-border px-4 py-2 text-sm font-semibold text-text-secondary transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
        >
          <CheckCheck className="h-4 w-4" /> Mark all read
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <div className="flex flex-wrap items-center gap-1 rounded-xl border border-surface-border bg-surface p-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                'flex min-h-11 items-center rounded-lg px-3 py-2 text-xs font-semibold transition-colors cursor-pointer',
                filter === f.id ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-primary',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-text-muted">
          <Filter className="h-3.5 w-3.5" />
          <input
            type="checkbox"
            checked={showUnreadOnly}
            onChange={(e) => setShowUnreadOnly(e.target.checked)}
            className="accent-accent"
          />
          Unread only
        </label>
      </div>

      {visible.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 py-16 text-text-muted">
          <BellRing className="h-10 w-10 opacity-30" />
          <span className="text-sm">No alerts match this filter</span>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((n, i) => (
            <motion.div
              key={n.id}
              ref={(el) => {
                rowRefs.current[n.id] = el;
              }}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: Math.min(i * 0.02, 0.4) }}
              onClick={() => handleMarkRead(n)}
              className={cn(
                'card flex cursor-pointer items-start gap-4 p-4 transition-all',
                !n.read && 'border-accent/25',
                n.read ? 'opacity-70' : 'opacity-100',
                flashId === n.id &&
                  'border-accent ring-2 ring-accent/40 shadow-[0_0_0_1px_rgba(52,211,153,0.4),0_0_24px_rgba(52,211,153,0.25)]',
              )}
            >
              <span
                className={cn(
                  'mt-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                  SEVERITY_META[n.severity].soft,
                )}
              >
                <span className={cn('h-2.5 w-2.5 rounded-full', SEVERITY_META[n.severity].dot)} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-text-primary">{n.title}</span>
                  <Badge tone={n.severity === 'critical' ? 'crit' : n.severity === 'warning' ? 'warn' : n.severity === 'success' ? 'success' : 'info'}>
                    {n.severity}
                  </Badge>
                  {n.serverId && <Badge tone="neutral">{n.serverId}</Badge>}
                  {!n.read && <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />}
                </div>
                <p className="mt-1 text-sm leading-relaxed text-text-secondary">{n.message}</p>
                <div className="mt-1.5 text-[11px] text-text-muted">{relativeTime(n.timestamp)}</div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
