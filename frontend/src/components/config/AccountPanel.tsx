import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Eye,
  EyeOff,
  KeyRound,
  Laptop,
  LifeBuoy,
  Mail,
  MessageCircleQuestion,
  MonitorSmartphone,
  ShieldCheck,
  ShieldOff,
} from 'lucide-react';
import { endpoints } from '@/api/endpoints';
import { useAuthStore } from '@/store/auth';
import { Section, Row, SaveBar, useSave, humanError } from './shared';
import { Input, Field } from '@/components/ui/forms';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { relativeTime } from '@/lib/utils';

export function AccountPanel() {
  const me = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const setSession = useAuthStore((s) => s.setSession);
  const queryClient = useQueryClient();

  const pwSave = useSave();
  const twoFaSave = useSave();
  const sessionSave = useSave();
  const recSave = useSave();

  /* Change password modal */
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [pwError, setPwError] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);

  /* 2FA modal */
  const [twoFaOpen, setTwoFaOpen] = useState(false);
  const [setupStep, setSetupStep] = useState<'idle' | 'password' | 'codes' | 'verify'>('idle');
  const [setupPassword, setSetupPassword] = useState('');
  const [setupSecret, setSetupSecret] = useState<string | null>(null);
  const [setupCodes, setSetupCodes] = useState<string[]>([]);
  const [setupCode, setSetupCode] = useState('');
  const [setupError, setSetupError] = useState<string | null>(null);
  const [showSetupPw, setShowSetupPw] = useState(false);

  /* Recovery modal */
  const [recOpen, setRecOpen] = useState(false);
  const [editingQuestions, setEditingQuestions] = useState(false);
  const [qDraft, setQDraft] = useState([{ question: '', answer: '' }, { question: '', answer: '' }, { question: '', answer: '' }]);
  const [emailDraft, setEmailDraft] = useState('');
  const [recPw, setRecPw] = useState('');
  const [recError, setRecError] = useState<string | null>(null);
  const [showRecPw, setShowRecPw] = useState(false);

  const { data } = useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: endpoints.auth.sessions,
  });

  const { data: recovery } = useQuery({
    queryKey: ['auth', 'recovery-status'],
    queryFn: endpoints.auth.recoveryStatus,
  });

  const twoFactorEnabled = me?.twoFactorEnabled ?? false;
  const sessions = data?.sessions ?? [];
  const questionsConfigured = recovery?.questionsConfigured ?? false;
  const recoveryEmail = recovery?.email ?? null;
  const emailOtpEnabled = recovery?.emailOtpEnabled ?? false;
  const smtpConfigured = recovery?.smtpConfigured ?? false;

  function invalidateRecovery() {
    void queryClient.invalidateQueries({ queryKey: ['auth', 'recovery-status'] });
  }

  /* ---------- Change password ---------- */

  function openPwModal() {
    setPwError(null);
    setShowPw(false);
    setPw({ currentPassword: '', newPassword: '', confirm: '' });
    setPwOpen(true);
  }

  async function changePassword() {
    setPwError(null);
    if (!pw.currentPassword) {
      setPwError('Enter your current password.');
      return;
    }
    if (!pw.newPassword) {
      setPwError('Enter a new password.');
      return;
    }
    if (pw.newPassword !== pw.confirm) {
      setPwError('New passwords do not match.');
      return;
    }
    await pwSave.run(async () => {
      try {
        await endpoints.auth.changePassword({ currentPassword: pw.currentPassword, newPassword: pw.newPassword });
        setPwOpen(false);
        setPw({ currentPassword: '', newPassword: '', confirm: '' });
      } catch (err) {
        setPwError(err instanceof Error ? humanError(err.message) : 'Failed');
        throw err;
      }
    });
  }

  /* ---------- Two-factor ---------- */

  function openTwoFaModal() {
    setSetupError(null);
    setSetupPassword('');
    setSetupCode('');
    setSetupStep('idle');
    setTwoFaOpen(true);
  }

  async function startSetup() {
    setSetupError(null);
    if (!setupPassword) {
      setSetupStep('password');
      return;
    }
    await twoFaSave.run(async () => {
      try {
        const result = await endpoints.auth.twoFactorSetup({ password: setupPassword });
        setSetupSecret(result.secret);
        setSetupCodes(result.recoveryCodes);
        setSetupStep('codes');
      } catch (err) {
        setSetupError(err instanceof Error ? humanError(err.message) : 'Failed');
        throw err;
      }
    });
  }

  async function verifySetup() {
    setSetupError(null);
    await twoFaSave.run(async () => {
      try {
        await endpoints.auth.twoFactorVerify({ code: setupCode });
        const session = await endpoints.auth.me();
        setSession(session);
        setTwoFaOpen(false);
        setSetupStep('idle');
        setSetupSecret(null);
        setSetupCodes([]);
        setSetupCode('');
        setSetupPassword('');
      } catch (err) {
        setSetupError(err instanceof Error ? humanError(err.message) : 'Failed');
        throw err;
      }
    });
  }

  async function disableTwoFactor() {
    setSetupError(null);
    if (!setupPassword) {
      setSetupStep('password');
      return;
    }
    await twoFaSave.run(async () => {
      try {
        await endpoints.auth.twoFactorDisable({ password: setupPassword });
        const session = await endpoints.auth.me();
        setSession(session);
        setTwoFaOpen(false);
        setSetupStep('idle');
        setSetupPassword('');
      } catch (err) {
        setSetupError(err instanceof Error ? humanError(err.message) : 'Failed');
        throw err;
      }
    });
  }

  /* ---------- Recovery ---------- */

  function openRecoveryModal() {
    setRecError(null);
    setRecPw('');
    setEmailDraft('');
    setEditingQuestions(false);
    setQDraft([{ question: '', answer: '' }, { question: '', answer: '' }, { question: '', answer: '' }]);
    setRecOpen(true);
  }

  async function saveQuestions() {
    setRecError(null);
    if (qDraft.some((q) => q.question.trim().length < 4 || q.answer.trim().length < 2)) {
      setRecError('Each question needs at least 4 characters and each answer at least 2.');
      return;
    }
    if (!recPw) {
      setRecError('Confirm your password to save security questions.');
      return;
    }
    await recSave.run(async () => {
      try {
        await endpoints.auth.securityQuestionsSetup({ password: recPw, questions: qDraft });
        setEditingQuestions(false);
        setRecPw('');
        invalidateRecovery();
      } catch (err) {
        setRecError(err instanceof Error ? humanError(err.message) : 'Failed');
        throw err;
      }
    });
  }

  async function clearQuestions() {
    setRecError(null);
    if (!recPw) {
      setRecError('Confirm your password to clear security questions.');
      return;
    }
    await recSave.run(async () => {
      try {
        await endpoints.auth.securityQuestionsClear({ password: recPw });
        setRecPw('');
        invalidateRecovery();
      } catch (err) {
        setRecError(err instanceof Error ? humanError(err.message) : 'Failed');
        throw err;
      }
    });
  }

  async function saveEmail() {
    setRecError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailDraft)) {
      setRecError('Enter a valid email address.');
      return;
    }
    if (!recPw) {
      setRecError('Confirm your password to save the recovery email.');
      return;
    }
    await recSave.run(async () => {
      try {
        await endpoints.auth.emailOtpEnable({ password: recPw, email: emailDraft });
        setEmailDraft('');
        setRecPw('');
        invalidateRecovery();
      } catch (err) {
        setRecError(err instanceof Error ? humanError(err.message) : 'Failed');
        throw err;
      }
    });
  }

  async function clearEmail() {
    setRecError(null);
    if (!recPw) {
      setRecError('Confirm your password to remove the recovery email.');
      return;
    }
    await recSave.run(async () => {
      try {
        await endpoints.auth.emailOtpDisable({ password: recPw });
        setRecPw('');
        invalidateRecovery();
      } catch (err) {
        setRecError(err instanceof Error ? humanError(err.message) : 'Failed');
        throw err;
      }
    });
  }

  async function terminateSession(id: string) {
    await sessionSave.run(async () => {
      await endpoints.auth.terminateSession(id);
      void queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] });
    });
  }

  const setupPwInput = (
    <Field label="Confirm your password" className="flex-1">
      <div className="relative">
        <Input
          type={showSetupPw ? 'text' : 'password'}
          value={setupPassword}
          onChange={(e) => setSetupPassword(e.target.value)}
          autoComplete="current-password"
          className="pr-10"
        />
        <button
          type="button"
          onClick={() => setShowSetupPw((v) => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted transition-colors hover:text-text-primary cursor-pointer"
          aria-label={showSetupPw ? 'Hide password' : 'Show password'}
        >
          {showSetupPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </Field>
  );

  return (
    <div className="flex flex-col gap-4">
      <Section
        title="Change password"
        subtitle="Rotate your account password"
        icon={<KeyRound className="h-4 w-4" />}
        action={<SaveBar busy={pwSave.busy} saved={pwSave.saved} error={pwSave.error} />}
      >
        <Row
          label="Account password"
          description="Rotate your password. Your active sessions stay valid."
        >
          <Button variant="outline" size="sm" onClick={openPwModal}>
            <KeyRound className="h-3.5 w-3.5" /> Change password
          </Button>
        </Row>
      </Section>

      <Section
        title="Two-factor authentication"
        subtitle={twoFactorEnabled ? 'Authenticator app verification is on' : 'Add an authenticator app for stronger sign-in'}
        icon={twoFactorEnabled ? <ShieldCheck className="h-4 w-4" /> : <ShieldOff className="h-4 w-4" />}
        action={<SaveBar busy={twoFaSave.busy} saved={twoFaSave.saved} error={twoFaSave.error} />}
      >
        <Row
          label={twoFactorEnabled ? '2FA is enabled' : '2FA is off'}
          description={
            twoFactorEnabled
              ? 'Sign-in requires an authenticator code.'
              : 'Anyone with the password can sign in. Enable 2FA to require a code too.'
          }
        >
          {twoFactorEnabled ? (
            <div className="flex items-center gap-2">
              <Badge tone="success" dot>enabled</Badge>
              <Button variant="ghost" size="sm" onClick={openTwoFaModal}>
                <ShieldOff className="h-3.5 w-3.5" /> Manage
              </Button>
            </div>
          ) : (
            <Button size="sm" onClick={openTwoFaModal}>
              <ShieldCheck className="h-3.5 w-3.5" /> Enable 2FA
            </Button>
          )}
        </Row>
      </Section>

      <Section
        title="Recovery"
        subtitle="Ways to regain access if you lose your password"
        icon={<LifeBuoy className="h-4 w-4" />}
        action={<SaveBar busy={recSave.busy} saved={recSave.saved} error={recSave.error} />}
      >
        <Row
          label="Security questions"
          description={
            questionsConfigured
              ? 'Three personal questions are configured. Always works — no internet required.'
              : 'Set three personal questions. Always works — no internet required.'
          }
        >
          {questionsConfigured ? <Badge tone="success" dot>3 configured</Badge> : <Badge tone="neutral">not set</Badge>}
        </Row>
        <Row
          label="Recovery email"
          description={
            recoveryEmail
              ? `Codes sent to ${recoveryEmail}${!smtpConfigured ? ' — SMTP not configured, email recovery currently unavailable.' : ''}`
              : 'Used for email verification codes when SMTP is configured.'
          }
        >
          {emailOtpEnabled ? <Badge tone="success" dot>enabled</Badge> : <Badge tone="neutral">not set</Badge>}
        </Row>
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={openRecoveryModal}>
            <LifeBuoy className="h-3.5 w-3.5" /> Manage recovery
          </Button>
        </div>
      </Section>

      <Section
        title="Active sessions"
        subtitle="Devices currently signed in as you"
        icon={<MonitorSmartphone className="h-4 w-4" />}
        action={<SaveBar busy={sessionSave.busy} saved={sessionSave.saved} error={sessionSave.error} />}
      >
        {sessions.length === 0 && (
          <div className="rounded-xl border border-dashed border-surface-border px-4 py-6 text-center text-sm text-text-muted">
            No other sessions found.
          </div>
        )}
        {sessions.map((session) => (
          <div key={session.id} className="flex items-center justify-between gap-3 rounded-xl border border-surface-border/70 bg-surface-input px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Laptop className="h-3.5 w-3.5 text-text-muted" />
                <span className="truncate text-sm font-medium text-text-primary">
                  {session.user_agent ? session.user_agent.slice(0, 60) : 'Unknown device'}
                </span>
                {session.revoked === 0 ? <Badge tone="success">active</Badge> : <Badge tone="neutral">revoked</Badge>}
              </div>
              <div className="mt-0.5 text-xs text-text-muted">
                {session.ip ?? 'local'} · last active {relativeTime(session.last_active_at)}
              </div>
            </div>
            {session.revoked === 0 && (
              <Button variant="ghost" size="sm" onClick={() => void terminateSession(session.id)}>
                Terminate
              </Button>
            )}
          </div>
        ))}
      </Section>

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={() => void logout()}>
          Sign out
        </Button>
        <Button
          variant="outline"
          onClick={async () => {
            await sessionSave.run(async () => {
              await endpoints.auth.terminateAll();
              void queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] });
            });
          }}
        >
          Sign out everywhere else
        </Button>
      </div>

      {/* ---------- Change password modal ---------- */}
      <Modal
        open={pwOpen}
        onClose={() => setPwOpen(false)}
        title="Change password"
        subtitle="Rotate your account password"
        icon={<KeyRound className="h-4 w-4" />}
        size="sm"
        busy={pwSave.busy}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setPwOpen(false)} disabled={pwSave.busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void changePassword()} disabled={pwSave.busy || !pw.currentPassword || !pw.newPassword}>
              {pwSave.busy ? 'Updating…' : 'Update password'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Current password">
            <div className="relative">
              <Input
                type={showPw ? 'text' : 'password'}
                value={pw.currentPassword}
                onChange={(e) => setPw((p) => ({ ...p, currentPassword: e.target.value }))}
                autoComplete="current-password"
                className="pr-10"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted transition-colors hover:text-text-primary cursor-pointer"
                aria-label={showPw ? 'Hide password' : 'Show password'}
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>
          <Field label="New password">
            <Input
              type={showPw ? 'text' : 'password'}
              value={pw.newPassword}
              onChange={(e) => setPw((p) => ({ ...p, newPassword: e.target.value }))}
              autoComplete="new-password"
              className="pr-10"
            />
          </Field>
          <Field label="Confirm new password">
            <Input
              type={showPw ? 'text' : 'password'}
              value={pw.confirm}
              onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))}
              autoComplete="new-password"
              className="pr-10"
            />
          </Field>
          {pwError && (
            <div className="rounded-xl border border-crit/25 bg-crit/10 px-4 py-2.5 text-xs text-crit">{pwError}</div>
          )}
        </div>
      </Modal>

      {/* ---------- 2FA modal ---------- */}
      <Modal
        open={twoFaOpen}
        onClose={() => setTwoFaOpen(false)}
        title={twoFactorEnabled ? 'Manage two-factor authentication' : 'Enable two-factor authentication'}
        subtitle={twoFactorEnabled ? 'Your authenticator app is active' : 'Add an authenticator app for stronger sign-in'}
        icon={twoFactorEnabled ? <ShieldCheck className="h-4 w-4" /> : <ShieldOff className="h-4 w-4" />}
        size="md"
        busy={twoFaSave.busy}
        footer={
          (setupStep === 'idle' || setupStep === 'password') && (
            <>
              <Button variant="ghost" size="sm" onClick={() => setTwoFaOpen(false)} disabled={twoFaSave.busy}>
                Close
              </Button>
              {setupStep === 'password' && twoFactorEnabled && (
                <Button variant="danger" size="sm" onClick={() => void disableTwoFactor()} disabled={twoFaSave.busy || !setupPassword}>
                  <ShieldOff className="h-3.5 w-3.5" /> Disable 2FA
                </Button>
              )}
              {setupStep === 'password' && !twoFactorEnabled && (
                <Button size="sm" onClick={() => void startSetup()} disabled={twoFaSave.busy || !setupPassword}>
                  Continue
                </Button>
              )}
            </>
          )
        }
      >
        <div className="flex flex-col gap-4">
          {setupStep === 'idle' && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-text-secondary">
                {twoFactorEnabled
                  ? 'Two-factor authentication is active on this account. Every sign-in asks for a code from your authenticator app.'
                  : 'Two-factor adds a second layer of protection. After enabling, every sign-in will ask for a 6-digit code from your authenticator app.'}
              </p>
              <div className="flex items-center gap-3 rounded-xl border border-surface-border/70 bg-surface-input px-4 py-3">
                <div className="flex-1">
                  <div className="text-sm font-medium text-text-primary">
                    {twoFactorEnabled ? 'Enabled' : 'Not enabled'}
                  </div>
                  <div className="text-xs text-text-muted">
                    {twoFactorEnabled ? 'Authenticator codes required at sign-in.' : 'Anyone with the password can sign in.'}
                  </div>
                </div>
                <Badge tone={twoFactorEnabled ? 'success' : 'neutral'} dot>{twoFactorEnabled ? 'active' : 'off'}</Badge>
              </div>
              {!twoFactorEnabled ? (
                <Button size="sm" onClick={() => setSetupStep('password')}>
                  <ShieldCheck className="h-3.5 w-3.5" /> Set up 2FA
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setSetupStep('password')}>
                  <ShieldOff className="h-3.5 w-3.5" /> Disable 2FA
                </Button>
              )}
            </div>
          )}

          {setupStep === 'password' && (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-text-secondary">
                {twoFactorEnabled
                  ? 'Enter your password to turn off two-factor authentication. This is a security-sensitive action.'
                  : 'Enter your password to generate your 2FA secret and recovery codes.'}
              </p>
              {setupPwInput}
              {setupError && (
                <div className="rounded-xl border border-crit/25 bg-crit/10 px-4 py-2.5 text-xs text-crit">{setupError}</div>
              )}
            </div>
          )}

          {setupStep === 'codes' && setupSecret && (
            <div className="flex flex-col gap-3">
              <div className="rounded-xl border border-accent/20 bg-accent/soft p-4">
                <div className="mb-2 text-sm font-semibold text-text-primary">Scan with your authenticator app</div>
                <p className="text-xs text-text-muted">
                  Add this secret to your authenticator (e.g. Google Authenticator, 1Password), then enter the 6-digit code below.
                </p>
                <div className="my-3 rounded-lg border border-surface-border bg-surface-input px-3 py-2 font-mono text-xs text-accent break-all">
                  {setupSecret}
                </div>
                <div className="mb-2 text-xs font-semibold text-warn">Recovery codes — save these somewhere safe</div>
                <div className="grid grid-cols-2 gap-1 font-mono text-[11px] text-text-secondary sm:grid-cols-3">
                  {setupCodes.map((code) => (
                    <div key={code} className="rounded bg-overlay/5 px-2 py-1">{code}</div>
                  ))}
                </div>
              </div>
              <Field label="6-digit code" hint="Enter the current code from your authenticator app">
                <Input
                  className="font-mono tracking-[0.3em]"
                  value={setupCode}
                  onChange={(e) => setSetupCode(e.target.value)}
                  inputMode="numeric"
                  placeholder="000000"
                />
              </Field>
              {setupError && (
                <div className="rounded-xl border border-crit/25 bg-crit/10 px-4 py-2.5 text-xs text-crit">{setupError}</div>
              )}
              <div className="flex justify-end">
                <Button size="sm" onClick={() => void verifySetup()} disabled={setupCode.length < 6 || twoFaSave.busy}>
                  {twoFaSave.busy ? 'Verifying…' : 'Verify & enable'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* ---------- Recovery modal ---------- */}
      <Modal
        open={recOpen}
        onClose={() => setRecOpen(false)}
        title="Recovery"
        subtitle="Ways to regain access if you lose your password"
        icon={<LifeBuoy className="h-4 w-4" />}
        size="lg"
        busy={recSave.busy}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setRecOpen(false)} disabled={recSave.busy}>
              Close
            </Button>
            {editingQuestions && (
              <Button size="sm" onClick={() => void saveQuestions()} disabled={recSave.busy || !recPw}>
                {recSave.busy ? 'Saving…' : 'Save questions'}
              </Button>
            )}
            {questionsConfigured && !editingQuestions && (
              <Button variant="danger" size="sm" onClick={() => void clearQuestions()} disabled={recSave.busy || !recPw}>
                Clear questions
              </Button>
            )}
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-surface-border/70 bg-surface-input p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <MessageCircleQuestion className="h-4 w-4 text-accent" />
                  <span className="text-sm font-medium text-text-primary">Security questions</span>
                  {questionsConfigured && <Badge tone="success" dot>3 configured</Badge>}
                </div>
                <p className="mt-0.5 text-xs text-text-muted">
                  Always works — even with no internet connection, purely local.
                </p>
              </div>
              <Button
                variant={questionsConfigured ? 'ghost' : 'outline'}
                size="sm"
                onClick={() => setEditingQuestions((v) => !v)}
                disabled={recSave.busy}
              >
                {questionsConfigured ? (editingQuestions ? 'Cancel' : 'Change') : 'Set up'}
              </Button>
            </div>

            {editingQuestions && (
              <div className="mt-3 flex flex-col gap-3 border-t border-surface-border/60 pt-3">
                {qDraft.map((q, i) => (
                  <div key={i} className="grid gap-2 sm:grid-cols-2">
                    <Field label={`Question ${i + 1}`}>
                      <Input
                        value={q.question}
                        onChange={(e) => setQDraft((d) => d.map((x, idx) => (idx === i ? { ...x, question: e.target.value } : x)))}
                        placeholder="e.g. What was your first pet's name?"
                      />
                    </Field>
                    <Field label={`Answer ${i + 1}`}>
                      <Input
                        value={q.answer}
                        onChange={(e) => setQDraft((d) => d.map((x, idx) => (idx === i ? { ...x, answer: e.target.value } : x)))}
                        placeholder="Answer"
                      />
                    </Field>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-surface-border/70 bg-surface-input p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-accent" />
                  <span className="text-sm font-medium text-text-primary">Recovery email</span>
                  {emailOtpEnabled && <Badge tone="success" dot>enabled</Badge>}
                </div>
                <p className="mt-0.5 text-xs text-text-muted">
                  {recoveryEmail ? `Codes sent to ${recoveryEmail}` : 'Used for email verification codes when SMTP is configured.'}
                  {!smtpConfigured && recoveryEmail && ' SMTP is not configured, so email recovery is currently unavailable.'}
                </p>
              </div>
              {emailOtpEnabled ? (
                <Button variant="ghost" size="sm" onClick={() => void clearEmail()} disabled={recSave.busy}>
                  Remove
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => void saveEmail()} disabled={!emailDraft.trim() || recSave.busy}>
                  Save
                </Button>
              )}
            </div>
            {!emailOtpEnabled && (
              <div className="mt-3 border-t border-surface-border/60 pt-3">
                <Field label="Email address" hint={smtpConfigured ? undefined : 'Set up SMTP in Security settings to enable email delivery.'}>
                  <Input
                    type="email"
                    value={emailDraft}
                    onChange={(e) => setEmailDraft(e.target.value)}
                    placeholder="you@example.com"
                  />
                </Field>
              </div>
            )}
          </div>

          <Field label="Confirm your password" hint="Every recovery change is password-protected">
            <div className="relative">
              <Input
                type={showRecPw ? 'text' : 'password'}
                value={recPw}
                onChange={(e) => setRecPw(e.target.value)}
                autoComplete="current-password"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowRecPw((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted transition-colors hover:text-text-primary cursor-pointer"
                aria-label={showRecPw ? 'Hide password' : 'Show password'}
              >
                {showRecPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>

          {recError && (
            <div className="rounded-xl border border-crit/25 bg-crit/10 px-4 py-2.5 text-xs text-crit">{recError}</div>
          )}
        </div>
      </Modal>
    </div>
  );
}
