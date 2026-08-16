import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Link, Pencil, Plus, Trash2, Zap } from 'lucide-react';
import { endpoints } from '@/api/endpoints';
import { Section, SaveBar, useSave } from './shared';
import { Field, Input, Select, Toggle, TextArea } from '@/components/ui/forms';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { quickActionIcon } from '@/lib/quickActionIcons';
import type { QuickAction } from '@/types';

const ICON_KEYS = [
  'server',
  'container',
  'activity',
  'terminal',
  'power',
  'refresh',
  'globe',
  'link',
  'database',
  'shield',
  'bell',
  'cpu',
  'folder',
  'mail',
  'monitor',
  'wifi',
  'zap',
  'github',
  'book',
  'settings',
  'router',
  'network',
  'layers',
  'rocket',
  'box',
  'lock',
  'external',
];

const DEFAULT_ACTIONS: QuickAction[] = [
  { id: 'proxmox', label: 'Open Proxmox', kind: 'open UI', keywords: 'proxmox pve hypervisor', href: 'https://pve.homelab.local:8006', icon: 'server', enabled: true },
  { id: 'docker', label: 'Open Docker', kind: 'open UI', keywords: 'docker portainer containers', href: 'https://portainer.homelab.local', icon: 'container', enabled: true },
  { id: 'uptime', label: 'Open Uptime Kuma', kind: 'open UI', keywords: 'uptime kuma status monitoring', href: 'https://uptime.homelab.local', icon: 'activity', enabled: true },
  { id: 'restart-docker', label: 'Restart Docker', kind: 'command', keywords: 'restart docker daemon', icon: 'refresh', enabled: true },
  { id: 'ssh', label: 'SSH', kind: 'command', keywords: 'ssh terminal shell session', icon: 'terminal', enabled: true },
  { id: 'wake', label: 'Wake Server', kind: 'command', keywords: 'wake on lan wol wake server', icon: 'power', enabled: true },
];

interface ModalState {
  mode: 'add' | 'edit';
  id: string;
}

function emptyAction(): QuickAction {
  return {
    id: `action-${Date.now().toString(36)}`,
    label: '',
    kind: 'open UI',
    keywords: '',
    href: 'https://',
    icon: 'globe',
    enabled: true,
  };
}

export function QuickActionsManager() {
  const save = useSave();
  const queryClient = useQueryClient();
  const [modal, setModal] = useState<ModalState | null>(null);
  const [draft, setDraft] = useState<QuickAction>(emptyAction());
  const [formError, setFormError] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ['admin', 'quick-actions'],
    queryFn: endpoints.admin.quickActions.list,
  });

  const actions = useMemo<QuickAction[]>(() => data ?? [], [data]);

  function setActions(next: QuickAction[]) {
    queryClient.setQueryData(['admin', 'quick-actions'], next);
  }

  function openAdd() {
    setFormError(null);
    setDraft(emptyAction());
    setModal({ mode: 'add', id: '' });
  }

  function openEdit(a: QuickAction) {
    setFormError(null);
    setDraft({ ...a });
    setModal({ mode: 'edit', id: a.id });
  }

  function move(id: string, dir: -1 | 1) {
    const idx = actions.findIndex((a) => a.id === id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= actions.length) return;
    const next = [...actions];
    const [item] = next.splice(idx, 1);
    next.splice(target, 0, item);
    setActions(next);
  }

  function remove(id: string) {
    setActions(actions.filter((x) => x.id !== id));
  }

  async function submit() {
    setFormError(null);
    if (!draft.label.trim()) {
      setFormError('Every action needs a label.');
      return;
    }
    if (draft.href && !/^https?:\/\//i.test(draft.href)) {
      setFormError('Links must start with http:// or https://');
      return;
    }

    let next: QuickAction[];
    if (modal?.mode === 'edit') {
      next = actions.map((a) => (a.id === draft.id ? { ...draft } : a));
    } else {
      next = [...actions, { ...draft }];
    }

    await save.run(async () => {
      await endpoints.admin.quickActions.save(next);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'quick-actions'] });
      await queryClient.invalidateQueries({ queryKey: ['quick-actions'] });
      setModal(null);
    });
  }

  async function reset() {
    await save.run(async () => {
      await endpoints.admin.quickActions.save(DEFAULT_ACTIONS);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'quick-actions'] });
      await queryClient.invalidateQueries({ queryKey: ['quick-actions'] });
    });
  }

  const modalAction = modal ? actions.find((a) => a.id === modal.id) : undefined;
  const editingAction = modal?.mode === 'edit' && modalAction ? modalAction : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">Quick Actions</h3>
          <p className="mt-0.5 text-xs text-text-muted">
            One-click buttons on the dashboard and entries in Ctrl+K search. Point links at your own DNS / hostnames.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => void reset()} disabled={save.busy}>
            Reset defaults
          </Button>
          <Button size="sm" onClick={openAdd} disabled={save.busy}>
            <Plus className="h-4 w-4" /> Add action
          </Button>
          <SaveBar busy={save.busy} saved={save.saved} error={save.error} />
        </div>
      </div>

      <Section
        title={`${actions.length} configured`}
        icon={<Zap className="h-4 w-4" />}
        subtitle="Changes apply to the dashboard and search instantly after saving"
        action={
          <Button size="sm" onClick={() => void save.run(async () => {
            await endpoints.admin.quickActions.save(actions);
            await queryClient.invalidateQueries({ queryKey: ['admin', 'quick-actions'] });
            await queryClient.invalidateQueries({ queryKey: ['quick-actions'] });
          })} disabled={save.busy || actions.length === 0}>
            Save changes
          </Button>
        }
      >
        {actions.length === 0 && (
          <p className="text-sm text-text-muted">No quick actions yet. Use “Add action” to create one.</p>
        )}

        {actions.map((a, i) => {
          const Icon = quickActionIcon(a.icon);
          return (
            <div key={a.id} className="rounded-xl border border-surface-border/70 bg-surface-input p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-text-primary">{a.label || 'Untitled action'}</span>
                      <Badge tone={a.enabled ? 'success' : 'neutral'}>{a.enabled ? 'enabled' : 'disabled'}</Badge>
                    </div>
                    <p className="truncate text-xs text-text-muted">{a.kind}{a.href ? ` · ${a.href}` : ''}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => move(a.id, -1)}
                    disabled={i === 0}
                    className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-overlay/5 hover:text-text-primary disabled:opacity-30 cursor-pointer"
                    aria-label="Move up"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(a.id, 1)}
                    disabled={i === actions.length - 1}
                    className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-overlay/5 hover:text-text-primary disabled:opacity-30 cursor-pointer"
                    aria-label="Move down"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => openEdit(a)}
                    className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-accent/10 hover:text-accent cursor-pointer"
                    aria-label={`Edit ${a.label}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(a.id)}
                    className="rounded-lg p-1.5 text-crit/70 transition-colors hover:bg-crit/10 hover:text-crit cursor-pointer"
                    aria-label={`Remove ${a.label}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </Section>

      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        title={modal?.mode === 'edit' ? 'Edit action' : 'Add action'}
        subtitle={modal?.mode === 'edit' ? editingAction?.label ?? 'Configure this action' : 'Create a new one-click action'}
        icon={<Zap className="h-4 w-4" />}
        size="lg"
        busy={save.busy}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setModal(null)} disabled={save.busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void submit()} disabled={save.busy}>
              {save.busy ? 'Saving…' : modal?.mode === 'edit' ? 'Save changes' : 'Add action'}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Label">
            <Input
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              placeholder="Open Jellyfin"
              autoFocus
            />
          </Field>
          <Field label="Type">
            <Select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
              <option value="open UI">open UI (opens link in new tab)</option>
              <option value="command">command (dashboard-managed action)</option>
            </Select>
          </Field>
          <Field label="Link (URL)" hint="Use your own DNS / hostname, e.g. https://jellyfin.homelab.local">
            <Input
              value={draft.href ?? ''}
              onChange={(e) => setDraft({ ...draft, href: e.target.value || undefined })}
              placeholder="https://…"
            />
          </Field>
          <Field label="Icon">
            <Select value={draft.icon} onChange={(e) => setDraft({ ...draft, icon: e.target.value })}>
              {ICON_KEYS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Search keywords" className="sm:col-span-2" hint="Comma / space separated — used by Ctrl+K and search">
            <TextArea
              rows={2}
              value={draft.keywords}
              onChange={(e) => setDraft({ ...draft, keywords: e.target.value })}
              placeholder="jellyfin media movies"
            />
          </Field>
          <div className="flex items-center justify-between rounded-xl border border-surface-border/70 bg-surface-input px-4 py-3 sm:col-span-2">
            <div className="flex items-center gap-2">
              <Link className="h-4 w-4 text-text-muted" />
              <span className="text-sm text-text-secondary">Show on dashboard</span>
            </div>
            <Toggle checked={draft.enabled} onChange={(v) => setDraft({ ...draft, enabled: v })} />
          </div>
        </div>

        {formError && (
          <div className="mt-4 rounded-xl border border-crit/25 bg-crit/10 px-4 py-2.5 text-xs text-crit">
            {formError}
          </div>
        )}
      </Modal>
    </div>
  );
}
