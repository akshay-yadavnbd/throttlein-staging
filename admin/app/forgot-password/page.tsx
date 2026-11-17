'use client';

/**
 * Admin / staff forgot-password page — `/forgot-password`.
 *
 * Enter email → backend mails a reset link. Backend's
 * `/auth/forgot-password` decides the target URL based on the user's
 * role: superadmin/staff get links pointing at this admin panel,
 * customers/sellers get links pointing at the storefront. So we just
 * post the email; no `client=admin` hint needed.
 *
 * To prevent account enumeration, the backend always returns the
 * same "if an account exists…" answer — the sent screen mirrors that
 * wording. A link works for one hour, and each new request replaces the
 * previous link; the backend allows 5 requests per email per 15 minutes,
 * so "Resend" waits a minute between sends.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import AdminInput from '@/components/AdminInput';
import AdminButton from '@/components/AdminButton';
import AuthLayout, { AuthProblem, authStyles as styles } from '@/components/AuthLayout';
import { api } from '@/lib/api';
import { apiMessage, errorReason } from '@/lib/notify';
import { M } from '@/lib/messages';

const RESEND_AFTER_S = 60;
const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [resentNote, setResentNote] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  // Tick once a second while the resend wait is running.
  useEffect(() => {
    if (!resendAt) return;
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= resendAt) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
  }, [resendAt]);
  const waitS = Math.max(0, Math.ceil((resendAt - now) / 1000));

  const focusEmail = () => document.getElementById('reset-email')?.focus();

  async function send(address: string) {
    setLoading(true);
    setProblem(null);
    try {
      await api.post('/auth/forgot-password', { email: address });
      return true;
    } catch (err: any) {
      setProblem(Number(err?.response?.status) === 429 ? apiMessage(err) || M.forgotPassword.tooManyRequests : errorReason(err));
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const address = email.trim();
    if (!address || !looksLikeEmail(address)) {
      setProblem(address ? M.forgotPassword.enterAValidEmail : M.forgotPassword.enterYourEmail);
      focusEmail();
      return;
    }
    if (await send(address)) {
      setSentTo(address);
      setResentNote(false);
      setNow(Date.now());
      setResendAt(Date.now() + RESEND_AFTER_S * 1000);
    } else {
      focusEmail();
    }
  }

  async function resend() {
    if (!sentTo || waitS > 0) return;
    if (await send(sentTo)) {
      setResentNote(true);
      setNow(Date.now());
      setResendAt(Date.now() + RESEND_AFTER_S * 1000);
    }
  }

  function changeEmail() {
    setSentTo(null);
    setProblem(null);
    setResentNote(false);
    setResendAt(0);
  }

  return (
    <AuthLayout>
      {sentTo ? (
        <>
          <span className={styles.statusIcon} aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="m4 7 8 6 8-6" />
            </svg>
          </span>
          <h1 className={styles.title}>Check your email</h1>
          {/* Same "fail closed" wording the backend uses — never reveal
              whether an account exists for the given email. */}
          <p className={styles.lead}>
            If an admin account exists for <strong className={styles.strong}>{sentTo}</strong>, a reset link is on its
            way. It works for one hour.
          </p>
          <ul className={styles.tips}>
            <li>Not in your inbox? Check the spam or promotions folder.</li>
            <li>Asking again sends a new link, and earlier links stop working.</li>
          </ul>

          <div className={styles.form}>
            {problem && <AuthProblem>{problem}</AuthProblem>}
            {resentNote && !problem && (
              <p className={styles.notice} role="status">
                {M.forgotPassword.sentAgain}
              </p>
            )}
            <AdminButton
              color="primary"
              className={styles.submit}
              onPress={resend}
              isLoading={loading}
              isDisabled={waitS > 0}
            >
              {waitS > 0 ? `Resend link in ${waitS}s` : 'Resend link'}
            </AdminButton>
            <button type="button" className={styles.textButton} onClick={changeEmail}>
              Use a different email
            </button>
          </div>
        </>
      ) : (
        <>
          <h1 className={styles.title}>Reset your password</h1>
          <p className={styles.lead}>
            Enter the email you sign in with. We’ll send a link to choose a new password.
          </p>
          <form onSubmit={handleSubmit} className={styles.form} noValidate>
            <AdminInput
              id="reset-email"
              type="email"
              label="Email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoFocus
              isReadOnly={loading}
              isInvalid={!!problem}
              classNames={{ inputWrapper: 'h-11 min-h-11' }}
            />
            {problem && <AuthProblem>{problem}</AuthProblem>}
            <AdminButton type="submit" color="primary" isLoading={loading} className={styles.submit}>
              {loading ? 'Sending…' : 'Send reset link'}
            </AdminButton>
          </form>
        </>
      )}

      <p className={styles.footNote}>
        Remembered it?{' '}
        <Link href="/login" className={styles.link}>
          Back to sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
