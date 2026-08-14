import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { KeyRound, Lock, ShieldOff, Users } from 'lucide-react';
import { endpoints } from '@/api/endpoints';
import { useAuthStore } from '@/store/auth';
import { Section, Row, SaveBar, useSave, humanError } from './shared';
import { Toggle, Input, Field } from '@/components/ui/forms';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/lib/utils';

const GUEST_SCOPES = [
  { id: 'serverStatus', label: 'Server status' },
  { id: 'serviceStatus', label: 'Service status' },
  { id: 'containers', label: 'Containers' },
  { id: 'vms', label: 'VMs' },
  { id: 'cpu', label: 'CPU usage' },
  { id: 'ram', label: 'RAM usage' },
  { id: 'storage', label: 'Storage usage' },
  { id: 'uptime', label: 'Uptime' },
  { id: 'ipAddresses', label: 'IP addresses' },
  { id: 'logs', label: 'Logs' },
  { id: 'notifications', label: 'Notifications' },
];

export function AccessSettings() {
  const user = useAuthStore((s) => s.user);
  const modes = useAuthStore((s) => s.modes);
  const setSession = useAuthStore((s) => s.setSession);
  const isSuper = user?.role === 'SUPER_ADMIN';

  const save = useSave();
  const safeSave = useSave();
  const lockSave = useSave();
  const unlockSave = useSave();

  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlockOpen, setUnlockOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: endpoints.admin.settings.get,
  });

  const settings = data?.settings;

  const guestEnabled = settings?.['access.guest.enabled'] === 'true';
  const readOnly = settings?.['security.readOnly'] === 'true';

  const scopes = useMemo(() => {
    const raw = settings?.['access.guest.scopes'];
    if (!raw) return [];
    try {
      return JSON.parse(raw) as string[];
    } catch {
      return [];
    }
  }, [settings]);

  async function saveGuest() {
    await save.run(async () => {
      await endpoints.admin.settings.update({
        'access.guest.enabled': guestEnabled,
        'access.guest.scopes': scopes,
      });
    });
  }

  async function toggleReadOnly() {
    await save.run(async () => {
      await endpoints.admin.settings.update({ 'security.readOnly': !readOnly });
    });
  }

  async function toggleSafeMode() {
    const next = !modes?.safeMode;
    await safeSave.run(async () => {
      await endpoints.admin.emergency.safeMode(next);
      const me = await endpoints.auth.me();
      setSession(me);
    });
  }

  async function lock() {
    await lockSave.run(async () => {
      await endpoints.admin.emergency.lock();
      const me = await endpoints.auth.me();
      setSession(me);
    });
  }

  async function unlock() {
    setUnlockError(null);
    await unlockSave.run(async () => {
      try {
        await endpoints.admin.emergency.unlock(unlockPassword);
        setUnlockPassword('');
        const me = await endpoints.auth.me();
        setSession(me);
      } catch (err) {
        setUnlockError(err instanceof Error ? humanError(err.message) : 'Unlock failed');
        throw err;
      }
    });
  }

  const inLock = modes?.emergencyLock === true;

  return (
    <div className="flex flex-col gap-4">
      <Section
        title="Guest access"
        subtitle="Public, read-only access for unauthenticated visitors"
        icon={<Users className="h-4 w-4" />}
        action={<SaveBar busy={save.busy} saved={save.saved} error={save.error} />}
      >
        <Toggle
          label="Enable guest mode"
          description="Anonymous visitors can view the dashboard without signing in. Only the scopes below are exposed."
          checked={guestEnabled}
          onChange={() => void saveGuest()}
        />

        <div className={cn('rounded-xl border border-surface-border/70 bg-surface-input p-4', !guestEnabled && 'opacity-50 pointer-events-none')}>
          <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Guest scopes
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {GUEST_SCOPES.map((scope) => {
              const checked = scopes.includes(scope.id);
              return (
                <label
                  key={scope.id}
                  className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-text-secondary transition-colors hover:bg-overlay/5"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-accent"
                    checked={checked}
                    onChange={() => {
                      const next = checked ? scopes.filter((s) => s !== scope.id) : [...scopes, scope.id];
                      void save.run(async () => {
                        await endpoints.admin.settings.update({ 'access.guest.scopes': next });
                      });
                    }}
                  />
                  {scope.label}
                </label>
              );
            })}
          </div>
          <div className="mt-2 text-[11px] text-text-muted">
            Each scope maps to a read-only permission. Guests never get operational or management access.
          </div>
        </div>
      </Section>

      <Section
        title="System modes"
        subtitle="Global lockdown and maintenance controls"
        icon={<ShieldOff className="h-4 w-4" />}
      >
        <Row
          label="Read-only mode"
          description="Blocks every mutating API call system-wide (except login, logout and password changes)."
        >
          <Toggle checked={readOnly} onChange={() => void toggleReadOnly()} />
        </Row>

        <Row
          label="Safe mode"
          description="Keeps monitoring and dashboards up but blocks all mutations."
        >
          <Toggle
            checked={modes?.safeMode ?? false}
            onChange={() => void toggleSafeMode()}
            disabled={inLock}
          />
        </Row>
        <div className="flex items-center justify-end">
          <SaveBar busy={safeSave.busy} saved={safeSave.saved} error={safeSave.error} />
        </div>

        {inLock ? (
          <div className="rounded-xl border border-crit/25 bg-crit/10 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-crit">
              <Lock className="h-4 w-4" /> Emergency lock is active
            </div>
            <p className="mt-1 text-xs text-text-muted">
              All sessions have been revoked and every API mutation is blocked until a super admin unlocks.
            </p>
            {isSuper ? (
              <div className="mt-3 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-text-muted">Confirm your password to unlock the system.</span>
                  <Button variant="outline" size="sm" onClick={() => { setUnlockError(null); setUnlockPassword(''); setUnlockOpen(true); }} disabled={unlockSave.busy}>
                    <Lock className="h-3.5 w-3.5" /> Unlock
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-2 text-xs text-crit">
                Only a super admin can unlock. Ask a super admin for help.
              </div>
            )}
            {unlockError && <div className="mt-2 text-xs text-crit">{unlockError}</div>}
            <SaveBar busy={unlockSave.busy} error={unlockSave.error} className="mt-2" />
          </div>
        ) : (
          <Row
            label="Emergency lock"
            description="Instantly revokes all sessions and blocks all mutations until a super admin unlocks."
          >
            {isSuper ? (
              <Button variant="danger" size="sm" onClick={() => void lock()} disabled={lockSave.busy}>
                <Lock className="h-3.5 w-3.5" /> Lock system
              </Button>
            ) : (
              <Badge tone="neutral">Super admin only</Badge>
            )}
          </Row>
        )}

        <div className="flex items-center gap-2 text-xs text-text-muted">
          <KeyRound className="h-3.5 w-3.5" />
          {readOnly
            ? 'Mutations are blocked by read-only mode.'
            : modes?.safeMode
              ? 'Mutations are blocked by safe mode.'
              : 'System is fully operational.'}
        </div>
      </Section>

      {/* Emergency unlock modal */}
      <Modal
        open={unlockOpen}
        onClose={() => setUnlockOpen(false)}
        title="Unlock system"
        subtitle="Confirm your super-admin password to end the emergency lock"
        icon={<Lock className="h-4 w-4" />}
        size="sm"
        busy={unlockSave.busy}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setUnlockOpen(false)} disabled={unlockSave.busy}>
              Cancel
            </Button>
            <Button variant="outline" size="sm" onClick={() => void unlock()} disabled={!unlockPassword || unlockSave.busy}>
              <Lock className="h-3.5 w-3.5" /> Unlock
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Your password">
            <Input
              type="password"
              value={unlockPassword}
              onChange={(e) => setUnlockPassword(e.target.value)}
              placeholder="Confirm password to unlock"
              autoComplete="current-password"
              autoFocus
            />
          </Field>
          <p className="text-xs text-text-muted">
            Unlocking revokes the emergency lock and re-enables mutations system-wide. This action is recorded in the audit log.
          </p>
          {unlockError && (
            <div className="rounded-xl border border-crit/25 bg-crit/10 px-4 py-2.5 text-xs text-crit">{unlockError}</div>
          )}
        </div>
      </Modal>
    </div>
  );
}
