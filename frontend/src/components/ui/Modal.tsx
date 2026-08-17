import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

const SIZES = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-3xl',
} as const;

type ModalSize = keyof typeof SIZES;

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: ModalSize;
  busy?: boolean;
  /** Optional aria label for screen readers (falls back to title). */
  labelledBy?: string;
  className?: string;
}

/**
 * Centered popup dialog with backdrop, entrance animation, Escape-to-close,
 * focus trapping and scrollable content. Rendered in a portal on top of the app.
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  icon,
  children,
  footer,
  size = 'md',
  busy,
  labelledBy,
  className,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    lastFocus.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const initial = panel?.querySelector<HTMLElement>('input, select, textarea');
    (initial ?? panel)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;

      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        last.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === last) {
        first.focus();
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      lastFocus.current?.focus();
    };
  }, [open]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 overflow-y-auto bg-black/70 px-4 py-4 backdrop-blur-sm sm:py-6"
          onClick={() => {
            if (!busy) onClose();
          }}
        >
          <div className="flex min-h-full items-center justify-center">
            <motion.div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={labelledBy}
              aria-label={labelledBy ? undefined : title}
              tabIndex={-1}
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className={cn(
                'my-auto w-full overflow-hidden rounded-2xl border border-surface-border bg-surface-elevated shadow-card outline-none',
                SIZES[size],
                className,
              )}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 border-b border-surface-border px-4 py-4 sm:px-5">
                <div className="flex min-w-0 items-start gap-3">
                  {icon && (
                    <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
                      {icon}
                    </div>
                  )}
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
                    {subtitle && <p className="mt-0.5 text-xs text-text-muted">{subtitle}</p>}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                  className="flex min-h-12 min-w-12 h-12 w-12 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-overlay/5 hover:text-text-primary disabled:opacity-50 cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent/50"
                  aria-label="Close modal"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="max-h-[calc(100dvh-12rem)] overflow-y-auto px-4 py-4 sm:max-h-[70dvh] sm:px-5">
                {children}
              </div>

              {footer && (
                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-surface-border px-4 py-4 sm:px-5">
                  {footer}
                </div>
              )}
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

interface ConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'warning';
  busy?: boolean;
}

/** Destructive-action confirmation dialog with an explicit warning state. */
export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  tone = 'danger',
  busy,
}: ConfirmModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      busy={busy}
      icon={
        <div
          className={cn(
            'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
            tone === 'danger' ? 'bg-crit/10 text-crit' : 'bg-warn/10 text-warn',
          )}
        >
          <AlertTriangle className="h-4 w-4" />
        </div>
      }
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'warning'}
            size="sm"
            onClick={() => void onConfirm()}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-text-secondary">{description}</div>
    </Modal>
  );
}
