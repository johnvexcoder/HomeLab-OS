import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, CalendarClock, History, RotateCcw, Trash2, Camera } from 'lucide-react';
import { endpoints } from '@/api/endpoints';
import { Section, Row, SaveBar, useSave, humanError } from './shared';
import { Input, Field, Toggle } from '@/components/ui/forms';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ConfirmModal } from '@/components/ui/Modal';
import { relativeTime, cn } from '@/lib/utils';

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

type ConfirmAction =
  | { kind: 'restore-backup'; id: string; file: string }
  | { kind: 'delete-backup'; id: string; file: string }
  | { kind: 'restore-snapshot'; id: string; name: string }
  | { kind: 'delete-snapshot'; id: string; name: string }
  | null;

export function BackupsManager() {
  const save = useSave();
  const scheduleSave = useSave();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [snapshotName, setSnapshotName] = useState('');
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['admin', 'backups'],
    queryFn: endpoints.admin.backups.list,
    refetchInterval: 15_000,
  });

  const { data: snapshotsData } = useQuery({
    queryKey: ['admin', 'snapshots'],
    queryFn: endpoints.admin.snapshots.list,
  });

  const { data: settingsData } = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: endpoints.admin.settings.get,
  });

  const backups = data?.backups ?? [];
  const status = data?.status;
  const snapshots = snapshotsData?.snapshots ?? [];
  const settings = settingsData?.settings;

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'backups'] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'snapshots'] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'securityHealth'] });
  }

  async function createBackup() {
    setBusyId('new');
    await save.run(async () => {
      await endpoints.admin.backups.create();
      invalidate();
    });
    setBusyId(null);
  }

  async function restoreBackup(id: string) {
    setBusyId(id);
    await save.run(async () => {
      try {
        await endpoints.admin.backups.restore(id);
      } catch (err) {
        throw err;
      }
    });
    setBusyId(null);
  }

  async function deleteBackup(id: string) {
    setBusyId(id);
    await save.run(async () => {
      await endpoints.admin.backups.remove(id);
      invalidate();
    });
    setBusyId(null);
  }

  async function createSnapshot() {
    await save.run(async () => {
      await endpoints.admin.snapshots.create({ name: snapshotName || undefined });
      setSnapshotName('');
      invalidate();
    });
  }

  async function restoreSnapshot(id: string) {
    setBusyId(`snap-${id}`);
    await save.run(async () => {
      try {
        await endpoints.admin.snapshots.restore(id);
      } catch (err) {
        throw err;
      }
    });
    setBusyId(null);
  }

  async function deleteSnapshot(id: string) {
    setBusyId(`snap-${id}`);
    await save.run(async () => {
      await endpoints.admin.snapshots.remove(id);
      invalidate();
    });
    setBusyId(null);
  }

  async function runConfirmedAction() {
    if (!confirmAction) return;
    if (confirmAction.kind === 'restore-backup') {
      await restoreBackup(confirmAction.id);
    } else if (confirmAction.kind === 'delete-backup') {
      await deleteBackup(confirmAction.id);
    } else if (confirmAction.kind === 'restore-snapshot') {
      await restoreSnapshot(confirmAction.id);
    } else {
      await deleteSnapshot(confirmAction.id);
    }
    setConfirmAction(null);
    invalidate();
  }

  async function saveSchedule() {
    await scheduleSave.run(async () => {
      await endpoints.admin.settings.update({
        'backup.enabled': settings?.['backup.enabled'] === 'true',
        'backup.hour': Number.parseInt(settings?.['backup.hour'] ?? '3', 10) || 3,
        'backup.minute': Number.parseInt(settings?.['backup.minute'] ?? '0', 10) || 0,
        'backup.retentionDaily': Number.parseInt(settings?.['backup.retentionDaily'] ?? '7', 10) || 7,
        'backup.retentionWeekly': Number.parseInt(settings?.['backup.retentionWeekly'] ?? '4', 10) || 4,
        'backup.retentionMonthly': Number.parseInt(settings?.['backup.retentionMonthly'] ?? '12', 10) || 12,
      });
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Section
        title="Database backups"
        subtitle="Online SQLite snapshots with retention pruning"
        icon={<Archive className="h-4 w-4" />}
        action={
          <div className="flex items-center gap-2">
            <SaveBar busy={save.busy || busyId !== null} saved={save.saved} error={save.error} />
            <Button size="sm" onClick={() => void createBackup()} disabled={busyId === 'new'}>
              <Archive className="h-4 w-4" /> Backup now
            </Button>
          </div>
        }
      >
        {backups.length === 0 && (
          <div className="rounded-xl border border-dashed border-surface-border px-4 py-8 text-center text-sm text-text-muted">
            No backups yet. Run your first backup to get started.
          </div>
        )}
        {backups.map((backup) => (
          <div key={backup.id} className="flex items-center justify-between gap-3 rounded-xl border border-surface-border/70 bg-surface-input px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate font-mono text-xs text-text-primary">{backup.file}</span>
                <Badge tone={backup.status === 'ok' ? 'success' : 'crit'}>{backup.status}</Badge>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-text-muted">
                <Badge tone="neutral">{backup.type}</Badge>
                <span>{formatSize(backup.size)}</span>
                <span>·</span>
                <span>{relativeTime(backup.createdAt)}</span>
                {backup.note && <span>· {backup.note}</span>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmAction({ kind: 'restore-backup', id: backup.id, file: backup.file })}
                disabled={busyId === backup.id}
              >
                <RotateCcw className="h-3.5 w-3.5" /> Restore
              </Button>
              <Button variant="danger" size="sm" onClick={() => setConfirmAction({ kind: 'delete-backup', id: backup.id, file: backup.file })}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </Section>

      <Section
        title="Backup schedule"
        subtitle="Automatic daily/weekly/monthly backups"
        icon={<CalendarClock className="h-4 w-4" />}
        action={<SaveBar busy={scheduleSave.busy} saved={scheduleSave.saved} error={scheduleSave.error} />}
      >
        <Row label="Scheduled backups" description="Run daily, weekly (Sundays) and monthly (1st) backups">
          <Toggle
            checked={settings?.['backup.enabled'] === 'true'}
            onChange={() => void saveSchedule()}
          />
        </Row>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Field label="Hour" hint="Local 24h">
            <Input
              type="number"
              min={0}
              max={23}
              defaultValue={settings?.['backup.hour'] ?? status?.hour ?? 3}
              onBlur={(e) => {
                void endpoints.admin.settings
                  .update({ 'backup.hour': Number.parseInt(e.target.value, 10) || 3 })
                  .then(invalidate)
                  .catch(() => undefined);
              }}
            />
          </Field>
          <Field label="Minute" hint="Local">
            <Input
              type="number"
              min={0}
              max={59}
              defaultValue={settings?.['backup.minute'] ?? status?.minute ?? 0}
              onBlur={(e) => {
                void endpoints.admin.settings
                  .update({ 'backup.minute': Number.parseInt(e.target.value, 10) || 0 })
                  .then(invalidate)
                  .catch(() => undefined);
              }}
            />
          </Field>
          <Field label="Keep daily" hint="Retention">
            <Input
              type="number"
              min={1}
              defaultValue={settings?.['backup.retentionDaily'] ?? status?.retention.daily ?? 7}
              onBlur={(e) => {
                void endpoints.admin.settings
                  .update({ 'backup.retentionDaily': Number.parseInt(e.target.value, 10) || 7 })
                  .then(invalidate)
                  .catch(() => undefined);
              }}
            />
          </Field>
          <Field label="Keep weekly">
            <Input
              type="number"
              min={1}
              defaultValue={settings?.['backup.retentionWeekly'] ?? status?.retention.weekly ?? 4}
              onBlur={(e) => {
                void endpoints.admin.settings
                  .update({ 'backup.retentionWeekly': Number.parseInt(e.target.value, 10) || 4 })
                  .then(invalidate)
                  .catch(() => undefined);
              }}
            />
          </Field>
          <Field label="Keep monthly">
            <Input
              type="number"
              min={1}
              defaultValue={settings?.['backup.retentionMonthly'] ?? status?.retention.monthly ?? 12}
              onBlur={(e) => {
                void endpoints.admin.settings
                  .update({ 'backup.retentionMonthly': Number.parseInt(e.target.value, 10) || 12 })
                  .then(invalidate)
                  .catch(() => undefined);
              }}
            />
          </Field>
        </div>
        {status?.lastRun && (
          <div className="text-xs text-text-muted">Last scheduled run: <b className="text-text-secondary">{status.lastRun}</b></div>
        )}
      </Section>

      <Section
        title="Configuration snapshots"
        subtitle="Point-in-time copies of settings, features and integration configs"
        icon={<Camera className="h-4 w-4" />}
        action={
          <div className="flex items-center gap-2">
            <Input
              className="w-44"
              placeholder="Snapshot name"
              value={snapshotName}
              onChange={(e) => setSnapshotName(e.target.value)}
            />
            <Button size="sm" onClick={() => void createSnapshot()} disabled={busyId !== null}>
              <Camera className="h-4 w-4" /> Capture
            </Button>
          </div>
        }
      >
        {snapshots.length === 0 && (
          <div className="rounded-xl border border-dashed border-surface-border px-4 py-8 text-center text-sm text-text-muted">
            No configuration snapshots yet.
          </div>
        )}
        {snapshots.map((snapshot) => (
          <div
            key={snapshot.id}
            className={cn(
              'flex items-center justify-between gap-3 rounded-xl border border-surface-border/70 bg-surface-input px-4 py-3',
              busyId === `snap-${snapshot.id}` && 'opacity-50',
            )}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <History className="h-3.5 w-3.5 text-text-muted" />
                <span className="truncate text-sm font-medium text-text-primary">{snapshot.name}</span>
                {snapshot.note && <span className="truncate text-xs text-text-muted">— {snapshot.note}</span>}
              </div>
              <div className="mt-0.5 text-xs text-text-muted">
                {relativeTime(snapshot.createdAt)} · by {snapshot.createdBy ?? 'system'}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmAction({ kind: 'restore-snapshot', id: snapshot.id, name: snapshot.name })}>
                <RotateCcw className="h-3.5 w-3.5" /> Restore
              </Button>
              <Button variant="danger" size="sm" onClick={() => setConfirmAction({ kind: 'delete-snapshot', id: snapshot.id, name: snapshot.name })}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </Section>

      <ConfirmModal
        open={confirmAction !== null}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => void runConfirmedAction()}
        busy={save.busy}
        title={
          confirmAction?.kind === 'delete-backup'
            ? `Delete backup "${confirmAction.file}"?`
            : confirmAction?.kind === 'restore-backup'
              ? `Restore backup "${confirmAction.file}"?`
              : confirmAction?.kind === 'delete-snapshot'
                ? `Delete snapshot "${confirmAction.name}"?`
                : `Restore snapshot "${confirmAction?.name}"?`
        }
        confirmLabel={
          confirmAction?.kind === 'delete-backup' || confirmAction?.kind === 'delete-snapshot'
            ? 'Delete'
            : 'Restore'
        }
        tone={confirmAction?.kind === 'delete-backup' || confirmAction?.kind === 'delete-snapshot' ? 'danger' : 'warning'}
        description={
          confirmAction?.kind === 'restore-backup' ? (
            <>
              Restoring <b className="text-text-primary">{confirmAction.file}</b> replaces the current configuration
              with the backup contents. This cannot be undone.
            </>
          ) : confirmAction?.kind === 'delete-backup' ? (
            <>
              <b className="text-text-primary">{confirmAction.file}</b> will be permanently deleted. This cannot be undone.
            </>
          ) : confirmAction?.kind === 'restore-snapshot' ? (
            <>
              Restoring <b className="text-text-primary">{confirmAction.name}</b> replaces current settings with the
              snapshot's point-in-time state.
            </>
          ) : (
            <>
              <b className="text-text-primary">{confirmAction?.name}</b> will be permanently deleted. This cannot be undone.
            </>
          )
        }
      />
    </div>
  );
}
