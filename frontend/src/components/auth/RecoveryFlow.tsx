import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, CheckCircle2, KeyRound, Loader2, Mail, MessageCircleQuestion, ShieldCheck, User } from 'lucide-react';
import { endpoints } from '@/api/endpoints';
import { ApiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/forms';
import { cn } from '@/lib/utils';

type Step =
  | { name: 'username' }
  | { name: 'method'; token: string; methods: string[]; questions: string[]; emailMasked: string | null }
  | { name: 'questions'; token: string; methods: string[]; questions: string[]; emailMasked: string | null }
  | { name: 'email'; token: string; methods: string[]; questions: string[]; emailMasked: string | null }
  | { name: 'newpassword'; resetToken: string }
  | { name: 'done' };

const MESSAGES: Record<string, string> = {
  too_many_attempts: 'Too many recovery attempts — try again later.',
  too_many_requests: 'Too many requests — try again later.',
  challenge_expired: 'That session expired. Please start again.',
  invalid_answers: 'Those answers were not correct.',
  invalid_code: 'That code was not correct.',
  weak_password: 'That password does not meet the policy.',
  recovery_locked: 'Recovery locked after too many attempts.',
  smtp_not_configured: 'Email recovery is not configured on this server.',
  email_send_failed: 'Could not send the recovery email.',
  method_unavailable: 'That recovery method is not available.',
  server_unreachable: 'Cannot reach the server. Make sure the backend is running.',
};

export function RecoveryFlow({
  initialUsername,
  onExit,
  onRecovered,
}: {
  initialUsername: string;
  onExit: () => void;
  onRecovered: (username: string) => void;
}) {
  const [step, setStep] = useState<Step>({ name: 'username' });
  const [username, setUsername] = useState(initialUsername);
  const [answers, setAnswers] = useState(['', '', '']);
  const [code, setCode] = useState('');
  const [pw, setPw] = useState({ next: '', confirm: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    if (!username.trim()) return;
    setError(null);
    setBusy(true);
    try {
      const res = await endpoints.auth.recoveryStart({ username: username.trim() });
      if (!res.recoveryToken || res.methods.length === 0) {
        setError('This account has no recovery method configured. Contact an administrator to regain access.');
        return;
      }
      setStep({
        name: 'method',
        token: res.recoveryToken,
        methods: res.methods,
        questions: res.questions ?? [],
        emailMasked: res.emailMasked ?? null,
      });
    } catch (err) {
      setError(human(err));
    } finally {
      setBusy(false);
    }
  }

  async function answerQuestions() {
    const s = step;
    if (s.name !== 'questions') return;
    if (answers.some((a) => !a.trim())) {
      setError('Please answer all three questions.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await endpoints.auth.recoveryQuestions({ recoveryToken: s.token, answers });
      setStep({ name: 'newpassword', resetToken: res.resetToken });
    } catch (err) {
      setError(human(err));
      setStep({ name: 'method', token: s.token, methods: s.methods, questions: s.questions, emailMasked: s.emailMasked });
    } finally {
      setBusy(false);
    }
  }

  async function sendEmailCode() {
    const s = step;
    if (s.name !== 'email') return;
    setError(null);
    setBusy(true);
    try {
      const res = await endpoints.auth.recoveryEmail({ recoveryToken: s.token });
      setError(`Code sent — it expires in 10 minutes. Resend in ${res.resentAfterSec}s.`);
    } catch (err) {
      setError(human(err));
    } finally {
      setBusy(false);
    }
  }

  async function verifyEmailCode() {
    const s = step;
    if (s.name !== 'email') return;
    setError(null);
    setBusy(true);
    try {
      const res = await endpoints.auth.recoveryEmailVerify({ recoveryToken: s.token, code });
      setStep({ name: 'newpassword', resetToken: res.resetToken });
    } catch (err) {
      setError(human(err));
      setStep({ name: 'method', token: s.token, methods: s.methods, questions: s.questions, emailMasked: s.emailMasked });
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    const s = step;
    if (s.name !== 'newpassword') return;
    if (pw.next !== pw.confirm) {
      setError('New passwords do not match.');
      return;
    }
    if (pw.next.length < 8) {
      setError('Use at least 8 characters.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await endpoints.auth.recoveryReset({ resetToken: s.resetToken, newPassword: pw.next });
      setStep({ name: 'done' });
      onRecovered(username.trim());
    } catch (err) {
      setError(human(err));
    } finally {
      setBusy(false);
    }
  }

  const pickMethod = (method: string) => {
    const s = step;
    if (s.name !== 'method') return;
    if (method === 'questions') setStep({ name: 'questions', token: s.token, methods: s.methods, questions: s.questions, emailMasked: s.emailMasked });
    else if (method === 'email') setStep({ name: 'email', token: s.token, methods: s.methods, questions: s.questions, emailMasked: s.emailMasked });
  };

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={onExit}
        className="flex items-center gap-1.5 self-start text-xs text-text-muted transition-colors hover:text-text-primary cursor-pointer"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
      </button>

      <div className="flex items-center gap-2 rounded-xl border border-info/20 bg-info/10 px-4 py-3 text-sm text-info">
        <ShieldCheck className="h-4 w-4 shrink-0" />
        <span>Account recovery — regain access without your password</span>
      </div>

      {step.name === 'username' && (
        <div className="flex flex-col gap-3">
          <Field label="Username">
            <div className="relative">
              <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <Input
                className="pl-10"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                placeholder="admin"
                required
                autoFocus
              />
            </div>
          </Field>
          <p className="text-xs text-text-muted">
            We'll show the recovery options this account has configured — security questions work even offline, email needs SMTP.
          </p>
        </div>
      )}

      {step.name === 'method' && (
        <div className="flex flex-col gap-2">
          <div className="text-sm font-medium text-text-primary">Choose a recovery method</div>
          {step.methods.includes('questions') && (
            <MethodCard
              icon={<MessageCircleQuestion className="h-4 w-4" />}
              title="Answer security questions"
              description="Works without an internet connection — purely local."
              onClick={() => pickMethod('questions')}
            />
          )}
          {step.methods.includes('email') && (
            <MethodCard
              icon={<Mail className="h-4 w-4" />}
              title="Email verification code"
              description={`Send a code to ${step.emailMasked ?? 'your recovery email'}.`}
              onClick={() => pickMethod('email')}
            />
          )}
          {step.methods.length === 0 && (
            <p className="rounded-xl border border-surface-border/70 bg-surface-input px-4 py-3 text-sm text-text-muted">
              No recovery method is available for this account.
            </p>
          )}
        </div>
      )}

      {step.name === 'questions' && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
            <MessageCircleQuestion className="h-4 w-4 text-accent" /> Answer your security questions
          </div>
          {step.methods.length > 1 && (
            <button
              type="button"
              onClick={() => setStep({ name: 'method', token: step.token, methods: step.methods, questions: step.questions, emailMasked: step.emailMasked })}
              className="self-start text-xs text-text-muted transition-colors hover:text-text-primary cursor-pointer"
            >
              Use a different method
            </button>
          )}
          {step.questions.map((q, i) => (
            <Field key={`${q}-${i}`} label={q}>
              <Input
                value={answers[i]}
                onChange={(e) => setAnswers((a) => a.map((v, idx) => (idx === i ? e.target.value : v)))}
                autoComplete="off"
                autoFocus={i === 0}
              />
            </Field>
          ))}
          <p className="text-xs text-text-muted">Your answers must match exactly what you set up.</p>
        </div>
      )}

      {step.name === 'email' && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
            <Mail className="h-4 w-4 text-accent" /> Email verification
          </div>
          {step.methods.length > 1 && (
            <button
              type="button"
              onClick={() => setStep({ name: 'method', token: step.token, methods: step.methods, questions: step.questions, emailMasked: step.emailMasked })}
              className="self-start text-xs text-text-muted transition-colors hover:text-text-primary cursor-pointer"
            >
              Use a different method
            </button>
          )}
          <p className="text-xs text-text-muted">
            A 6-digit code will be sent to {step.emailMasked ?? 'your recovery email'}.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => void sendEmailCode()} disabled={busy} className="self-start">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Send code
          </Button>
          <Field label="Code">
            <Input
              className="font-mono tracking-[0.3em]"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              placeholder="000000"
            />
          </Field>
        </div>
      )}

      {step.name === 'newpassword' && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
            <KeyRound className="h-4 w-4 text-accent" /> Choose a new password
          </div>
          <Field label="New password">
            <Input
              type="password"
              value={pw.next}
              onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))}
              autoComplete="new-password"
            />
          </Field>
          <Field label="Confirm new password">
            <Input
              type="password"
              value={pw.confirm}
              onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))}
              autoComplete="new-password"
            />
          </Field>
          <p className="text-xs text-text-muted">
            Resetting revokes all sessions and disables 2FA on this account.
          </p>
        </div>
      )}

      {step.name === 'done' && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-accent/25 bg-accent/10 px-4 py-6 text-center">
          <CheckCircle2 className="h-8 w-8 text-accent" />
          <div className="text-sm font-semibold text-text-primary">Password reset complete</div>
          <p className="text-xs text-text-muted">
            Sign in with your new password. All other sessions were ended.
          </p>
          <Button size="sm" onClick={onExit}>
            Back to sign in
          </Button>
        </div>
      )}

      {error && (
        <motion.p
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            'rounded-xl border px-3.5 py-2.5 text-xs',
            step.name === 'email' && error.startsWith('Code sent')
              ? 'border-accent/25 bg-accent/10 text-accent'
              : 'border-crit/25 bg-crit/10 text-crit',
          )}
        >
          {error}
        </motion.p>
      )}

      {step.name === 'username' && (
        <Button type="button" size="lg" onClick={() => void start()} disabled={busy || !username.trim()} className="w-full">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Continue
        </Button>
      )}
      {step.name === 'questions' && (
        <Button type="button" size="lg" onClick={() => void answerQuestions()} disabled={busy} className="w-full">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Verify answers
        </Button>
      )}
      {step.name === 'email' && (
        <Button type="button" size="lg" onClick={() => void verifyEmailCode()} disabled={busy || code.length < 6} className="w-full">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Verify code
        </Button>
      )}
      {step.name === 'newpassword' && (
        <Button type="button" size="lg" onClick={() => void resetPassword()} disabled={busy || !pw.next || !pw.confirm} className="w-full">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Reset password
        </Button>
      )}
    </div>
  );
}

function MethodCard({
  icon,
  title,
  description,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-start gap-3 rounded-xl border border-surface-border/70 bg-surface-input px-4 py-3 text-left transition-colors hover:border-accent/40 hover:bg-accent/[0.03] cursor-pointer"
    >
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-text-primary">{title}</span>
        <span className="mt-0.5 block text-xs text-text-muted">{description}</span>
      </span>
    </button>
  );
}

function human(err: unknown): string {
  const code = err instanceof ApiError ? err.message : 'server_unreachable';
  return MESSAGES[code] ?? code;
}
