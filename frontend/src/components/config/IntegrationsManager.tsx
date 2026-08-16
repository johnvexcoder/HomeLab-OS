import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Cable, FlaskConical, Pencil, Plus, Trash2 } from 'lucide-react';
import { endpoints } from '@/api/endpoints';
import { Section, Row, SaveBar, useSave, humanError } from './shared';
import { Input, Field, Select, TextArea, Toggle } from '@/components/ui/forms';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal, ConfirmModal } from '@/components/ui/Modal';
import { relativeTime } from '@/lib/utils';
import type { IntegrationPublic } from '@/types/auth';

const KIND_LABEL: Record<string, string> = {
  uptime_kuma: 'Uptime Kuma',
  telegram: 'Telegram',
  email: 'Email (SMTP)',
  prometheus: 'Prometheus',
  ai_assistant: 'AI Assistant',
};

interface IntegrationForm {
  name: string;
  kind: string;
  config: string;
  secrets: Record<string, string>;
}

const EMPTY_FORM: IntegrationForm = { name: '', kind: 'uptime_kuma', config: '', secrets: {} };

type ModalState = { mode: 'create' } | { mode: 'edit'; integration: IntegrationPublic } | null;

export function IntegrationsManager() {
  const save = useSave();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [form, setForm] = useState<IntegrationForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<IntegrationPublic | null>(null);
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['admin', 'integrations'],
    queryFn: endpoints.admin.integrations.list,
  });

  const integrations = data?.integrations ?? [];
  const kinds = data?.kinds ?? {};
  const featureMap = data?.featureMap ?? {};

  function featureFor(kind: string): string {
    return (
      {
        uptime_kuma: 'uptime_kuma_integration',
        telegram: 'telegram_notifications',
        email: 'email_notifications',
        prometheus: 'prometheus_integration',
        ai_assistant: 'ai_assistant',
      }[kind] ?? ''
    );
  }

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'integrations'] });
  }

  function parseConfig(json: string): Record<string, unknown> {
    if (!json.trim()) return {};
    return JSON.parse(json) as Record<string, unknown>;
  }

  function openCreate() {
    setFormError(null);
    setForm(EMPTY_FORM);
    setModal({ mode: 'create' });
  }

  function openEdit(integration: IntegrationPublic) {
    setFormError(null);
    setForm({
      name: integration.name,
      kind: integration.kind,
      config: integration.config ? JSON.stringify(integration.config, null, 2) : '',
      secrets: {},
    });
    setModal({ mode: 'edit', integration });
  }

  async function saveModal() {
    if (!modal) return;
    setFormError(null);

    let parsed: Record<string, unknown>;
    try {
      parsed = parseConfig(form.config);
    } catch {
      setFormError('Config must be valid JSON.');
      return;
    }

    if (modal.mode === 'create') {
      await save.run(async () => {
        await endpoints.admin.integrations.create({
          name: form.name,
          kind: form.kind,
          enabled: true,
          config: parsed,
          secrets: form.secrets,
        });
        setModal(null);
        invalidate();
      });
    } else {
      await save.run(async () => {
        await endpoints.admin.integrations.update(modal.integration.id, {
          name: form.name,
          config: parsed,
          secrets: form.secrets,
        });
        setModal(null);
        invalidate();
      });
    }
  }

  async function toggleEnabled(integration: IntegrationPublic, next: boolean) {
    await save.run(async () => {
      await endpoints.admin.integrations.update(integration.id, { enabled: next });
      invalidate();
    });
  }

  async function test(id: string) {
    setBusyId(id);
    setTestResult(null);
    try {
      const result = await endpoints.admin.integrations.test(id);
      setTestResult({
        id,
        ok: result.ok,
        text: result.ok ? `OK · ${result.latencyMs}ms` : (result.error ?? 'failed'),
      });
    } catch (err) {
      setTestResult({ id, ok: false, text: err instanceof Error ? humanError(err.message) : 'failed' });
    } finally {
      setBusyId(null);
    }
  }

  async function remove() {
    if (!confirmDelete) return;
    await save.run(async () => {
      await endpoints.admin.integrations.remove(confirmDelete.id);
      setConfirmDelete(null);
      invalidate();
    });
  }

  function secretFieldsFor(kind: string): string[] {
    return kinds[kind]?.secretFields ?? [];
  }

  const modalKind = modal && modal.mode === 'edit' ? modal.integration.kind : form.kind;

  return (
    <div className="flex flex-col gap-4">
      <Section
        title="Integrations"
        subtitle="Status pages, messaging and external systems"
        icon={<Cable className="h-4 w-4" />}
        action={
          <div className="flex items-center gap-2">
            <SaveBar busy={save.busy || busyId !== null} saved={save.saved} error={save.error} />
            <Button variant="outline" size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" /> New
            </Button>
          </div>
        }
      >
        {integrations.length === 0 && (
          <div className="rounded-xl border border-dashed border-surface-border px-4 py-10 text-center text-sm text-text-muted">
            No integrations configured yet.
          </div>
        )}

        {integrations.map((integration) => {
          const testInfo = testResult?.id === integration.id ? testResult : null;
          return (
            <div key={integration.id} className="rounded-xl border border-surface-border/70 bg-surface-input">
              <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-overlay/5 text-text-secondary">
                    <FlaskConical className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium text-text-primary">{integration.name}</span>
                      <Badge tone="neutral">{KIND_LABEL[integration.kind] ?? integration.kind}</Badge>
                      {integration.configured ? <Badge tone="success">configured</Badge> : <Badge tone="warn">missing config</Badge>}
                      {!featureMap[featureFor(integration.kind)] && <Badge tone="warn">flag off</Badge>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                      <Badge tone={integration.status === 'ok' ? 'success' : integration.status === 'error' ? 'crit' : 'neutral'} dot>
                        {integration.status}
                      </Badge>
                      {integration.lastSuccessAt && <span>ok {relativeTime(integration.lastSuccessAt)}</span>}
                      {integration.lastErrorAt && <span className="text-crit">err {relativeTime(integration.lastErrorAt)}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                  <Toggle
                    checked={integration.enabled}
                    onChange={(next) => void toggleEnabled(integration, next)}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => void test(integration.id)} disabled={busyId === integration.id}>
                      <FlaskConical className="h-3.5 w-3.5" /> Test
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => openEdit(integration)}>
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => setConfirmDelete(integration)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>

              {testInfo && (
                <div className={`border-t border-surface-border/60 px-4 py-2 text-xs ${testInfo.ok ? 'text-accent' : 'text-crit'}`}>
                  {testInfo.ok ? '✓' : '✗'} {testInfo.text}
                </div>
              )}
            </div>
          );
        })}
      </Section>

      <Row
        label="Secret storage"
        description="Integration secrets are encrypted at rest with a server key and are never returned by the API."
      >
        <Badge tone="accent">encrypted</Badge>
      </Row>

      {/* New / Edit integration modal */}
      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        title={modal?.mode === 'edit' ? `Edit ${modal.integration.name}` : 'New integration'}
        subtitle="Connect a status page, messaging or external system"
        icon={<Cable className="h-4 w-4" />}
        size="lg"
        busy={save.busy}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setModal(null)} disabled={save.busy}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void saveModal()}
              disabled={save.busy || !form.name.trim()}
            >
              {save.busy ? 'Saving…' : modal?.mode === 'edit' ? 'Save changes' : 'Create'}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name">
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Production alerts"
              autoFocus
            />
          </Field>
          <Field label="Kind">
            <Select
              value={form.kind}
              onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value, secrets: {} }))}
              disabled={modal?.mode === 'edit'}
            >
              {Object.keys(kinds).map((kind) => (
                <option key={kind} value={kind}>{KIND_LABEL[kind] ?? kind}</option>
              ))}
            </Select>
          </Field>
          {secretFieldsFor(modalKind).map((field) => (
            <Field key={field} label={field} hint={modal?.mode === 'edit' ? 'Leave blank to keep the existing value' : undefined}>
              <Input
                type="password"
                value={form.secrets[field] ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, secrets: { ...f.secrets, [field]: e.target.value } }))}
                placeholder={`${field} secret`}
                autoComplete="off"
              />
            </Field>
          ))}
        </div>

        <Field label="Config (JSON)" className="mt-3" hint='e.g. {"url": "https://status.example.com", "chatId": "123"}'>
          <TextArea
            rows={4}
            value={form.config}
            onChange={(e) => setForm((f) => ({ ...f, config: e.target.value }))}
            className="font-mono text-xs"
          />
        </Field>

        {!featureMap[featureFor(modalKind)] && (
          <div className="mt-3 rounded-xl border border-warn/25 bg-warn/10 px-4 py-2.5 text-xs text-warn">
            The <b>{KIND_LABEL[modalKind] ?? modalKind}</b> feature flag is off — enable it in the Features tab first.
          </div>
        )}

        {formError && (
          <div className="mt-3 rounded-xl border border-crit/25 bg-crit/10 px-4 py-2.5 text-xs text-crit">{formError}</div>
        )}
      </Modal>

      {/* Delete integration confirmation */}
      <ConfirmModal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => void remove()}
        title={confirmDelete ? `Delete integration "${confirmDelete.name}"?` : 'Delete integration'}
        description={
          <>
            <b className="text-text-primary">{confirmDelete?.name}</b> ({KIND_LABEL[confirmDelete?.kind ?? ''] ?? confirmDelete?.kind})
            {' '}will be removed and its encrypted secrets discarded. This cannot be undone.
          </>
        }
        confirmLabel="Delete integration"
        busy={save.busy}
      />
    </div>
  );
}
