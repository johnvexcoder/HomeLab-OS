import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Section({
  title,
  subtitle,
  icon,
  action,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('card p-4 sm:p-5', className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-3">
          {icon && (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
              {icon}
            </div>
          )}
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-text-muted">{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

export function Row({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-surface-border/70 bg-surface-input px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="text-sm font-medium text-text-primary">{label}</div>
        {description && <div className="mt-0.5 text-xs text-text-muted">{description}</div>}
      </div>
      <div className="flex flex-wrap shrink-0 items-center justify-end gap-3">{children}</div>
    </div>
  );
}

export function SaveBar({
  busy,
  saved,
  error,
  className,
}: {
  busy?: boolean;
  saved?: boolean;
  error?: string | null;
  className?: string;
}) {
  return (
    <span className={cn('flex items-center gap-1.5 text-xs', className)}>
      {busy && (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
          <span className="text-text-muted">Saving…</span>
        </>
      )}
      {!busy && saved && (
        <motion.span
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex items-center gap-1.5 text-accent"
        >
          <Check className="h-3.5 w-3.5" />
          Saved
        </motion.span>
      )}
      {!busy && error && <span className="text-crit">{error}</span>}
    </span>
  );
}

export function useSave() {
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function run(fn: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await fn();
      setSaved(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setSaved(false), 2000);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { busy, saved, error, run };
}

/** Maps backend error codes to human-friendly text. */
export function humanError(code: string): string {
  const map: Record<string, string> = {
    csrf: 'CSRF check failed — refresh the page and try again.',
    forbidden: 'You do not have permission to do that.',
    unauthorized: 'Your session expired. Sign in again.',
    read_only: 'Blocked: the system is in read-only mode.',
    emergency_lock: 'Blocked: emergency lock is active.',
    safe_mode: 'Blocked: safe mode is active.',
    invalid_body: 'The request body was invalid.',
    weak_password: 'That password does not meet the policy. Use a longer or stronger one.',
    username_taken: 'That username is already taken.',
    invalid_username: 'Usernames: 3–32 characters, letters/numbers/._- only.',
    invalid_role: 'That role is not valid.',
    guest_is_not_a_user_role: 'Guest is not an assignable user role.',
    cannot_modify_self: 'You cannot modify your own account from here.',
    cannot_delete_self: 'You cannot delete your own account.',
    last_super_admin: 'The last super admin cannot be removed or demoted.',
    invalid_2fa: 'That code was rejected.',
    feature_disabled: 'Two-factor is disabled system-wide.',
    current_password_incorrect: 'The current password is incorrect.',
    'feature unsupported': 'That feature is not supported yet.',
  };
  return map[code] ?? code;
}
