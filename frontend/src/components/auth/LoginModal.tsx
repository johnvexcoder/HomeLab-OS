import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Activity, KeyRound, Loader2, Lock, Mail, ShieldCheck, User } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth';
import { endpoints } from '@/api/endpoints';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/forms';
import { cn } from '@/lib/utils';
import type { TwoFactorMethod } from '@/types/auth';

const ERROR_MESSAGES: Record<string, string> = {
  missing_credentials: 'Enter both a username and a password.',
  invalid_credentials: 'Invalid username or password.',
  account_locked: 'Account temporarily locked — try again later.',
  too_many_attempts: 'Too many login attempts — try again later.',
  challenge_expired: 'That verification expired. Please sign in again.',
  invalid_2fa: 'That code was rejected. Check your authenticator app.',
  smtp_not_configured: 'Email verification is not available — the server has no SMTP configured.',
  email_send_failed: 'Could not send the verification email.',
  server_unreachable: 'Cannot reach the server. Make sure the backend is running.',
};

const METHOD_LABELS: Record<TwoFactorMethod, string> = {
  totp: 'Authenticator app',
  email: 'Email code',
  question: 'Security question',
};

export function LoginModal() {
  const login = useAuthStore((s) => s.login);
  const { data: health } = useQuery({ queryKey: ['health'], queryFn: endpoints.health, staleTime: 30_000 });
  const demoCredentials = health?.demoCredentials ?? false;

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [twoFactorToken, setTwoFactorToken] = useState<string | undefined>();
  const [twoFactorMethods, setTwoFactorMethods] = useState<TwoFactorMethod[]>([]);
  const [method, setMethod] = useState<TwoFactorMethod>('totp');
  const [question, setQuestion] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [resentAfter, setResentAfter] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!twoFactorMethods.length) return;
    setMethod(twoFactorMethods[0] === 'totp' ? 'totp' : twoFactorMethods[0]);
  }, [twoFactorMethods]);

  useEffect(() => {
    setQuestion(null);
    setCode('');
  }, [method, twoFactorToken]);

  async function prepareChallenge(m: TwoFactorMethod) {
    if (!twoFactorToken) return;
    setError(null);
    if (m === 'email') {
      setSending(true);
      try {
        const res = await endpoints.auth.twoFactorSendEmail({ twoFactorToken });
        setResentAfter(res.resentAfterSec);
      } catch (err) {
        setError(ERROR_MESSAGES[(err as { message?: string })?.message ?? ''] ?? 'Could not send the email code.');
      } finally {
        setSending(false);
      }
    } else if (m === 'question') {
      setSending(true);
      try {
        const res = await endpoints.auth.twoFactorQuestion({ twoFactorToken });
        setQuestion(res.question);
      } catch (err) {
        setError(ERROR_MESSAGES[(err as { message?: string })?.message ?? ''] ?? 'Could not load the security question.');
      } finally {
        setSending(false);
      }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await login(username, password, twoFactorToken, code, method);
      if (result.twoFactorRequired && result.twoFactorToken) {
        setTwoFactorToken(result.twoFactorToken);
        setTwoFactorMethods(result.twoFactorMethods ?? ['totp']);
        setError(null);
        return;
      }
      if (!result.ok) {
        setError(ERROR_MESSAGES[result.error ?? ''] ?? result.error ?? 'Sign-in failed.');
        return;
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md"
      >
        <div className="card p-5 sm:p-8">
          <div className="mb-8 flex flex-col items-center text-center">
            <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-accent/25 bg-accent/10">
              <Activity className="h-7 w-7 text-accent" strokeWidth={2.2} />
              <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-accent animate-glow-pulse" />
            </div>
            <h1 className="mt-4 fluid-h1 font-display font-bold tracking-tight text-text-primary">
              HomeLab <span className="text-accent">OS</span>
            </h1>
            <p className="mt-1 text-sm text-text-muted">Sign in to configure the dashboard</p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {!twoFactorToken ? (
              <>
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

                <Field label="Password">
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                    <Input
                      className="pl-10"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      placeholder="••••••••••"
                      required
                    />
                  </div>
                </Field>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 rounded-xl border border-info/20 bg-info/10 px-4 py-3 text-sm text-info">
                  <ShieldCheck className="h-4 w-4 shrink-0" />
                  <span>Two-factor verification required for <b>{username}</b></span>
                </div>

                {twoFactorMethods.length > 1 && (
                  <div className="flex flex-wrap gap-2">
                    {twoFactorMethods.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMethod(m)}
                        className={cn(
                          'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer',
                          method === m
                            ? 'border-accent/50 bg-accent/10 text-accent'
                            : 'border-surface-border/70 text-text-muted hover:text-text-primary',
                        )}
                      >
                        {METHOD_LABELS[m]}
                      </button>
                    ))}
                  </div>
                )}

                {method !== 'totp' && !question && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void prepareChallenge(method)}
                    disabled={sending}
                    className="self-start"
                  >
                    {sending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : method === 'email' ? (
                      <Mail className="h-4 w-4" />
                    ) : (
                      <KeyRound className="h-4 w-4" />
                    )}
                    {method === 'email'
                      ? (resentAfter ? `Resend email (${resentAfter}s)` : 'Send code to email')
                      : 'Show security question'}
                  </Button>
                )}

                {method === 'question' && question && (
                  <div className="rounded-xl border border-surface-border/70 bg-surface-input px-4 py-3 text-sm text-text-primary">
                    {question}
                  </div>
                )}

                <Field
                  label={method === 'question' ? 'Answer' : method === 'email' ? 'Email code' : 'Authenticator code'}
                  hint={
                    method === 'totp'
                      ? 'Six-digit code from your authenticator app or a recovery code'
                      : undefined
                  }
                >
                  <div className="relative">
                    <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                    <Input
                      className="pl-10 font-mono tracking-[0.3em]"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      inputMode={method === 'question' ? 'text' : 'numeric'}
                      placeholder={method === 'question' ? 'Your answer' : '000000'}
                      required
                      autoFocus
                    />
                  </div>
                </Field>
              </>
            )}

            {error && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-xl border border-crit/25 bg-crit/10 px-3.5 py-2.5 text-xs text-crit"
              >
                {error}
              </motion.p>
            )}

            <Button type="submit" size="lg" disabled={busy} className="w-full">
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Verifying…
                </>
              ) : twoFactorToken ? (
                method === 'question' ? 'Verify answer' : 'Verify code'
              ) : (
                'Sign in'
              )}
            </Button>
          </form>
        </div>

        <div className="mt-4 flex items-center justify-center">
          {demoCredentials ? (
            <span className="text-[11px] text-text-muted">Demo: admin / homelab-demo</span>
          ) : (
            <span className="text-[11px] text-text-muted">Forgot your password? Contact your administrator.</span>
          )}
        </div>
      </motion.div>
    </div>
  );
}
