import { Moon, Sun, Check, Palette } from 'lucide-react';
import { useTheme, ACCENTS, ACCENT_HEX, ACCENT_LABEL } from '@/store/theme';
import type { ThemeAccent, ThemeAppearance } from '@/store/theme';
import { Section } from './shared';
import { cn } from '@/lib/utils';

const APPEARANCES: Array<{ id: ThemeAppearance; label: string; description: string; icon: typeof Sun }> = [
  { id: 'dark', label: 'Dark', description: 'Default NOC look', icon: Moon },
  { id: 'light', label: 'Light', description: 'Bright, high contrast', icon: Sun },
];

export function ThemePanel() {
  const { appearance, accent, setAppearance, setAccent } = useTheme();

  return (
    <div className="flex flex-col gap-4">
      <Section
        title="Appearance"
        subtitle="Choose the dashboard colour scheme"
        icon={<Palette className="h-4 w-4" />}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {APPEARANCES.map((opt) => {
            const Icon = opt.icon;
            const active = appearance === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => setAppearance(opt.id)}
                className={cn(
                  'flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors cursor-pointer',
                  active
                    ? 'border-accent/50 bg-accent/10'
                    : 'border-surface-border/70 bg-surface-input hover:border-overlay/15',
                )}
              >
                <div
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-xl transition-colors',
                    active ? 'bg-accent text-white' : 'bg-overlay/5 text-text-muted',
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-text-primary">{opt.label}</div>
                  <div className="mt-0.5 text-xs text-text-muted">{opt.description}</div>
                </div>
                {active && <Check className="h-4 w-4 shrink-0 text-accent" />}
              </button>
            );
          })}
        </div>
      </Section>

      <Section
        title="Accent colour"
        subtitle="Used for highlights, charts and active states"
        icon={<Palette className="h-4 w-4" />}
      >
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {ACCENTS.map((a: ThemeAccent) => {
            const active = accent === a;
            return (
              <button
                key={a}
                onClick={() => setAccent(a)}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-xl border px-3 py-3 transition-colors cursor-pointer',
                  active ? 'border-accent/50 bg-accent/10' : 'border-surface-border/70 bg-surface-input hover:border-overlay/15',
                )}
              >
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-full transition-transform"
                  style={{ backgroundColor: ACCENT_HEX[a] }}
                >
                  {active && <Check className="h-4 w-4 text-white" />}
                </span>
                <span className={cn('text-xs font-medium', active ? 'text-accent' : 'text-text-secondary')}>
                  {ACCENT_LABEL[a]}
                </span>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-text-muted">
          Theme preference is stored locally and applies immediately across the dashboard.
        </p>
      </Section>
    </div>
  );
}
