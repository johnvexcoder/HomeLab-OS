import React from 'react';
import { cn } from '@/lib/utils';

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('flex flex-col gap-1.5', className)}>
      {label && <span className="text-xs font-semibold text-text-secondary">{label}</span>}
      {children}
      {hint && <span className="text-[11px] text-text-muted">{hint}</span>}
    </label>
  );
}

export function Input({
  className,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'w-full rounded-xl border border-surface-border bg-surface-input px-3.5 py-2 text-sm text-text-primary placeholder:text-text-muted input-focus transition-colors',
        className,
      )}
      {...rest}
    />
  );
}

export function TextArea({
  className,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'w-full rounded-xl border border-surface-border bg-surface-input px-3.5 py-2 text-sm text-text-primary placeholder:text-text-muted input-focus transition-colors',
        className,
      )}
      {...rest}
    />
  );
}

export function Select({
  className,
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'w-full appearance-none rounded-xl border border-surface-border bg-surface-input px-3.5 py-2 text-sm text-text-primary input-focus transition-colors cursor-pointer',
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled,
  label,
  description,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
  description?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex items-center gap-4 rounded-xl border border-surface-border/70 bg-surface-input px-4 py-3 text-left transition-colors disabled:opacity-50 disabled:pointer-events-none cursor-pointer',
        label || description
          ? 'w-full justify-between'
          : 'w-auto min-h-11 min-w-11 justify-end px-2 py-1 border-transparent bg-transparent',
        className,
      )}
    >
      {(label || description) && (
        <span className="min-w-0">
          {label && <span className="block text-sm font-medium text-text-primary">{label}</span>}
          {description && <span className="mt-0.5 block text-xs text-text-muted">{description}</span>}
        </span>
      )}
      <span
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors',
          checked ? 'border-accent/50 bg-accent/25' : 'border-surface-border bg-overlay/5',
        )}
      >
        <span
          className={cn(
            'inline-block h-[18px] w-[18px] transform rounded-full shadow transition-transform',
            checked ? 'translate-x-[22px] bg-accent' : 'translate-x-[3px] bg-text-muted',
          )}
        />
      </span>
    </button>
  );
}
