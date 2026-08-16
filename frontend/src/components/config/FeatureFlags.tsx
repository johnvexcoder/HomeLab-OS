import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Blocks, Cpu, Plug, Send, Sparkles } from 'lucide-react';
import { endpoints } from '@/api/endpoints';
import { Section, SaveBar, useSave } from './shared';
import { Toggle } from '@/components/ui/forms';
import { Badge } from '@/components/ui/Badge';
import type { FeatureStatus } from '@/types/auth';

const GROUP_META = {
  infrastructure: { label: 'Infrastructure', icon: Cpu },
  integrations: { label: 'Integrations', icon: Plug },
  notifications: { label: 'Notifications', icon: Send },
  platform: { label: 'Platform', icon: Sparkles },
} as const;

export function FeatureFlags() {
  const save = useSave();
  const [busyId, setBusyId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['admin', 'features'],
    queryFn: endpoints.admin.features.list,
  });

  const grouped = useMemo(() => {
    const out: Record<string, FeatureStatus[]> = {};
    for (const f of data?.features ?? []) {
      (out[f.group] ??= []).push(f);
    }
    return out;
  }, [data]);

  async function toggle(feature: FeatureStatus) {
    setBusyId(feature.id);
    await save.run(async () => {
      await endpoints.admin.features.set(feature.id, !feature.enabled);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'features'] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });
    });
    setBusyId(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">Feature flags</h3>
          <p className="mt-0.5 text-xs text-text-muted">Enable or disable capabilities of the dashboard</p>
        </div>
        <SaveBar busy={save.busy || busyId !== null} saved={save.saved} error={save.error} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Object.entries(GROUP_META).map(([group, meta]) => {
          const features = grouped[group] ?? [];
          if (features.length === 0) return null;
          const Icon = meta.icon;
          return (
            <Section key={group} title={meta.label} icon={<Icon className="h-4 w-4" />} subtitle={`${features.length} capabilities`}>
              {features.map((feature) => (
                <div key={feature.id} className="flex flex-col gap-3 rounded-xl border border-surface-border/70 bg-surface-input px-4 py-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-text-primary">{feature.label}</span>
                      {!feature.supported && <Badge tone="warn" className="shrink-0">unsupported</Badge>}
                      {feature.enabled && <Badge tone="success" className="shrink-0">on</Badge>}
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-text-muted">{feature.description}</p>
                  </div>
                  <Toggle
                    checked={feature.enabled}
                    onChange={() => void toggle(feature)}
                    disabled={!feature.supported}
                    className="shrink-0 sm:ml-2"
                  />
                </div>
              ))}
            </Section>
          );
        })}
      </div>

      <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
        <Blocks className="h-3.5 w-3.5" />
        Flags are enforced server-side — hiding a toggle is never a security control.
      </div>
    </div>
  );
}
