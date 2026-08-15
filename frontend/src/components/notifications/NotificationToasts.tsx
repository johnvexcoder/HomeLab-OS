import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { BellRing, CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';
import { useNotificationStore } from '@/store/notifications';
import { cn } from '@/lib/utils';
import { endpoints } from '@/api/endpoints';
import type { Notification } from '@/types';

const SEVERITY_ICON = {
  success: CheckCircle2,
  info: Info,
  warning: AlertTriangle,
  critical: XCircle,
} as const;

const SEVERITY_STYLE = {
  success: 'text-accent',
  info: 'text-info',
  warning: 'text-warn',
  critical: 'text-crit',
} as const;

const SEVERITY_BORDER = {
  success: 'border-accent/25',
  info: 'border-info/25',
  warning: 'border-warn/25',
  critical: 'border-crit/25',
} as const;

export function NotificationToasts() {
  const queue = useNotificationStore((s) => s.toastQueue);
  const dismiss = useNotificationStore((s) => s.dismissToast);
  const markRead = useNotificationStore((s) => s.markRead);
  const navigate = useNavigate();

  useEffect(() => {
    if (queue.length === 0) return;
    const ids = queue.map((n) => n.id);
    const t = setTimeout(() => {
      ids.forEach((id) => dismiss(id));
    }, 7000);
    return () => clearTimeout(t);
  }, [queue, dismiss]);

  function openToast(n: Notification) {
    dismiss(n.id);
    markRead([n.id]);
    endpoints.notifications.read([n.id]).catch(() => undefined);
    navigate(`/alerts?highlight=${encodeURIComponent(n.id)}`);
  }

  return (
    <div className="pointer-events-none fixed bottom-4 left-4 right-4 z-50 flex max-h-[calc(100dvh-2rem)] flex-col gap-3 sm:bottom-6 sm:left-auto sm:right-6 sm:w-[340px]">
      <AnimatePresence>
        {queue.map((n) => {
          const Icon = SEVERITY_ICON[n.severity];
          return (
            <motion.div
              key={n.id}
              layout
              initial={{ opacity: 0, x: 60, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 60, scale: 0.95 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              onClick={() => openToast(n)}
              className={cn(
                'pointer-events-auto flex cursor-pointer items-start gap-3 rounded-2xl border bg-surface-elevated/95 p-4 shadow-card backdrop-blur-xl transition-colors hover:border-accent/40',
                SEVERITY_BORDER[n.severity],
              )}
            >
              <Icon className={cn('mt-0.5 h-[18px] w-[18px] shrink-0', SEVERITY_STYLE[n.severity])} />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <BellRing className="h-3 w-3 shrink-0 text-text-muted" />
                  <span className="truncate text-[13px] font-semibold text-text-primary">{n.title}</span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-text-secondary line-clamp-2">{n.message}</p>
                <span className="mt-1.5 block text-[10px] font-semibold uppercase tracking-widest text-accent">
                  Open alerts →
                </span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  dismiss(n.id);
                }}
                className="shrink-0 text-text-muted transition-colors hover:text-text-primary cursor-pointer"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
