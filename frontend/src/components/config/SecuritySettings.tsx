import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Fingerprint, Shield, ShieldCheck, Timer } from 'lucide-react';
import { endpoints } from '@/api/endpoints';
import { Section, Row, SaveBar, useSave, humanError } from './shared';
import { Toggle, Input, Field } from '@/components/ui/forms';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { relativeTime } from '@/lib/utils';

interface SecurityForm {
  sessionTimeoutMinutes: string;
  absoluteSessionHours: string;
  maxLoginAttempts: string;
  lockoutMinutes: string;
  loginRateLimitPerMinute: string;
  passwordPolicyMinLength: string;
}

export function SecuritySettings() {
  const save = useSave();

  const { data } = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: endpoints.admin.settings.get,
  });

  const { data: health } = useQuery({
    queryKey: ['admin', 'securityHealth'],
    queryFn: endpoints.admin.securityHealth,
    refetchInterval: 30_000,
  });

  const settings = data?.settings;

  const [form, setForm] = useState<SecurityForm>({
    sessionTimeoutMinutes: '60',
    absoluteSessionHours: '168',
    maxLoginAttempts: '5',
    lockoutMinutes: '15',
    loginRateLimitPerMinute: '10',
    passwordPolicyMinLength: '10',
  });

  useEffect(() => {
    if (!settings) return;
    setForm({
      sessionTimeoutMinutes: settings['security.sessionTimeoutMinutes'] ?? '60',
      absoluteSessionHours: settings['security.absoluteSessionHours'] ?? '168',
      maxLoginAttempts: settings['security.maxLoginAttempts'] ?? '5',
      lockoutMinutes: settings['security.lockoutMinutes'] ?? '15',
      loginRateLimitPerMinute: settings['security.loginRateLimitPerMinute'] ?? '10',
      passwordPolicyMinLength: settings['security.passwordPolicyMinLength'] ?? '10',
    });
  }, [settings]);

  function num(key: keyof SecurityForm): number {
    const parsed = Number.parseInt(form[key], 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const requireSymbol = settings?.['security.passwordPolicyRequireSymbol'] === 'true';
  const twoFactorEnabled = settings?.['security.twoFactorEnabled'] === 'true';
  const auditEnabled = settings?.['security.auditEnabled'] === 'true';
  const csrfProtection = settings?.['security.csrfProtection'] === 'true';

  async function saveAll() {
    await save.run(async () => {
      await endpoints.admin.settings.update({
        'security.sessionTimeoutMinutes': num('sessionTimeoutMinutes'),
        'security.absoluteSessionHours': num('absoluteSessionHours'),
        'security.maxLoginAttempts': num('maxLoginAttempts'),
        'security.lockoutMinutes': num('lockoutMinutes'),
        'security.loginRateLimitPerMinute': num('loginRateLimitPerMinute'),
        'security.passwordPolicyMinLength': num('passwordPolicyMinLength'),
      });
    });
  }

  async function toggle(key: string, next: boolean) {
    await save.run(async () => {
      await endpoints.admin.settings.update({ [key]: next });
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Section
          title="Sessions & login"
          subtitle="Timeouts, attempts and rate limiting"
          icon={<Timer className="h-4 w-4" />}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Session timeout (min)" hint="Idle timeout per session">
              <Input
                type="number"
                min={5}
                value={form.sessionTimeoutMinutes}
                onChange={(e) => setForm((f) => ({ ...f, sessionTimeoutMinutes: e.target.value }))}
              />
            </Field>
            <Field label="Absolute max (hrs)" hint="Hard session expiry">
              <Input
                type="number"
                min={1}
                value={form.absoluteSessionHours}
                onChange={(e) => setForm((f) => ({ ...f, absoluteSessionHours: e.target.value }))}
              />
            </Field>
            <Field label="Max login attempts" hint="Before account lockout">
              <Input
                type="number"
                min={2}
                value={form.maxLoginAttempts}
                onChange={(e) => setForm((f) => ({ ...f, maxLoginAttempts: e.target.value }))}
              />
            </Field>
            <Field label="Lockout (min)" hint="Lockout duration">
              <Input
                type="number"
                min={1}
                value={form.lockoutMinutes}
                onChange={(e) => setForm((f) => ({ ...f, lockoutMinutes: e.target.value }))}
              />
            </Field>
            <Field label="Login rate (per min)" hint="Per-IP login cap" className="col-span-2">
              <Input
                type="number"
                min={5}
                value={form.loginRateLimitPerMinute}
                onChange={(e) => setForm((f) => ({ ...f, loginRateLimitPerMinute: e.target.value }))}
              />
            </Field>
          </div>
        </Section>

        <Section
          title="Password policy"
          subtitle="Requirements for new passwords"
          icon={<Shield className="h-4 w-4" />}
        >
          <Field label="Minimum length" hint="Enforced on creation and change">
            <Input
              type="number"
              min={8}
              value={form.passwordPolicyMinLength}
              onChange={(e) => setForm((f) => ({ ...f, passwordPolicyMinLength: e.target.value }))}
            />
          </Field>
          <Toggle
            label="Require a symbol"
            description="Passwords must contain at least one special character"
            checked={requireSymbol}
            onChange={(next) => void toggle('security.passwordPolicyRequireSymbol', next)}
          />
        </Section>

        <Section
          title="Security toggles"
          subtitle="System-wide security switches"
          icon={<ShieldCheck className="h-4 w-4" />}
        >
          <Toggle
            label="Two-factor auth"
            description="Allow authenticator-app 2FA on this server. Enrolled users must enter a code at sign-in; each user turns it on from their Account tab."
            checked={twoFactorEnabled}
            onChange={(next) => void toggle('security.twoFactorEnabled', next)}
          />
          <Toggle
            label="Audit log"
            description="Record security and management events"
            checked={auditEnabled}
            onChange={(next) => void toggle('security.auditEnabled', next)}
          />
          <Toggle
            label="CSRF protection"
            description="Double-submit token on every mutation"
            checked={csrfProtection}
            onChange={(next) => void toggle('security.csrfProtection', next)}
          />
        </Section>
      </div>

      <div className="flex items-center justify-end gap-3">
        <SaveBar busy={save.busy} saved={save.saved} error={save.error} />
        <Button onClick={() => void saveAll()} disabled={save.busy}>
          Save session & policy
        </Button>
      </div>

      {health && (
        <Section
          title="Security health"
          subtitle="Current posture at a glance"
          icon={<ShieldCheck className="h-4 w-4" />}
        >
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: 'Users', value: String(health.users) },
              { label: 'Admins', value: String(health.admins) },
              { label: 'Active sessions', value: String(health.sessions) },
              { label: '2FA adoption', value: `${health.twoFactorAdoption}%` },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-surface-border/70 bg-surface-input px-4 py-3">
                <div className="text-[11px] uppercase tracking-wider text-text-muted">{item.label}</div>
                <div className="mt-1 font-display text-xl font-bold tabular text-text-primary">{item.value}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
            <span>
              Guest access: <b className={health.guestAccess ? 'text-accent' : ''}>{health.guestAccess ? 'enabled' : 'disabled'}</b>
            </span>
            <span className="h-3 w-px bg-surface-border" />
            <span>
              Last backup: <b>{health.lastBackup ? relativeTime(health.lastBackup.createdAt) : 'never'}</b>
            </span>
            <span className="h-3 w-px bg-surface-border" />
            <Badge tone={health.modes.readOnly ? 'warn' : 'success'}>
              {health.modes.readOnly ? 'read-only' : 'writable'}
            </Badge>
          </div>
        </Section>
      )}

      <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
        <Fingerprint className="h-3.5 w-3.5" />
        Passwords are hashed with scrypt; sessions are revocable server-side.
      </div>
      {save.error && <div className="text-xs text-crit">{humanError(save.error)}</div>}
    </div>
  );
}
