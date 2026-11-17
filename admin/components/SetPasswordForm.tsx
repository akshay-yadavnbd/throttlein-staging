'use client';

/**
 * Choose-a-password form, shared by the reset link
 * (`/reset-password/<token>`, mode="reset") and the staff invite link
 * (`/staff/set-password/<token>`, mode="invite"). Both post to
 * POST /auth/reset-password/:token, which checks the link, sets the
 * password and signs the person in.
 *
 * The rules mirror the backend (12+ characters, at most 72 UTF-8 bytes,
 * both fields equal) and are shown as a live checklist. A link that is
 * used, expired or mistyped is only found out on submit; the form then
 * switches to an "expired link" screen with the right next step.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AdminButton from '@/components/AdminButton';
import PasswordInput from '@/components/PasswordInput';
import AuthLayout, { AuthProblem, authStyles as styles } from '@/components/AuthLayout';
import { api, unwrap } from '@/lib/api';
import { setStoredAdmin } from '@/lib/auth';
import { errorReason, notifySuccess } from '@/lib/notify';
import { M } from '@/lib/messages';

type Mode = 'reset' | 'invite';
type Field = 'password' | 'confirm';

const MIN_CHARS = 12;
const MAX_BYTES = 72;
const bytes = (s: string) => new TextEncoder().encode(s).length;
/** The backend's answer for a used, expired or unknown link. */
const DEAD_LINK = /invalid or has expired/i;

const COPY: Record<Mode, { title: string; lead: string; submit: string; busy: string }> = {
  reset: {
    title: 'Choose a new password',
    lead: 'Pick a new password for your admin account. You’ll be signed in straight after.',
    submit: 'Update password and sign in',
    busy: 'Updating…',
  },
  invite: {
    title: 'Set your password',
    lead: 'You’ve been invited to the THROTTLEIN admin console. Choose a password to finish setting up your account.',
    submit: 'Set password and sign in',
    busy: 'Setting up…',
  },
};

export default function SetPasswordForm({ token, mode }: { token: string; mode: Mode }) {
  const router = useRouter();
  const copy = COPY[mode];
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState<{ text: string; field?: Field } | null>(null);
  const [deadLink, setDeadLink] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  const longEnough = password.length >= MIN_CHARS;
  const notTooLong = bytes(password) <= MAX_BYTES;
  const matches = confirm.length > 0 && confirm === password;

  const focus = (field?: Field) => {
    if (!field) return;
    const el = document.getElementById(`new-${field}`) as HTMLInputElement | null;
    el?.focus();
    el?.select();
  };
  const fail = (text: string, field?: Field) => {
    setProblem({ text, field });
    focus(field);
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!longEnough) return fail(M.resetPassword.passwordMustBeAtLeast12Characters, 'password');
    if (!notTooLong) return fail(M.resetPassword.passwordTooLong, 'password');
    if (!confirm) return fail(M.resetPassword.enterTheSamePasswordTwice, 'confirm');
    if (!matches) return fail(M.resetPassword.passwordsDoNotMatch, 'confirm');
    setSubmitting(true);
    setProblem(null);
    try {
      const data = unwrap<any>(
        await api.post(`/auth/reset-password/${encodeURIComponent(token)}`, { password, confirmPassword: confirm }),
      );
      const role = data?.user?.role;
      if (data?.token && (role === 'superadmin' || role === 'staff')) {
        setStoredAdmin(data.token, data.user);
        notifySuccess(
          mode === 'invite' ? M.staff.welcomeToTHROTTLEIN(data.user.name) : M.resetPassword.passwordUpdatedWelcomeBack,
        );
        router.replace('/dashboard');
      } else if (data?.user) {
        // A seller or customer reset through an admin-panel link: the
        // password is set, but this console is not theirs.
        setProblem({ text: M.resetPassword.notAnAdminAccount });
      } else {
        notifySuccess(M.resetPassword.passwordUpdatedPleaseSignIn);
        router.replace(mode === 'invite' ? '/staff/login' : '/login');
      }
    } catch (err: any) {
      const message = String(err?.response?.data?.message || '');
      if (Number(err?.response?.status) === 400 && DEAD_LINK.test(message)) setDeadLink(true);
      else fail(errorReason(err));
    } finally {
      setSubmitting(false);
    }
  }

  const trackCapsLock = (e: React.KeyboardEvent) => setCapsLock(e.getModifierState?.('CapsLock') ?? false);

  if (deadLink) {
    return (
      <AuthLayout>
        <span className={`${styles.statusIcon} ${styles.statusIconWarn}`} aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
            <path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
            <path d="M3 3l18 18" />
          </svg>
        </span>
        <h1 className={styles.title}>This link no longer works</h1>
        <p className={styles.lead}>
          {mode === 'invite'
            ? 'Invite links can be used once and last 7 days. Ask a super-admin to resend your invite from the Staff page.'
            : 'Reset links can be used once and last one hour, and asking again replaces the earlier link. Request a new one.'}
        </p>
        <div className={styles.form}>
          {mode === 'reset' ? (
            <AdminButton as={Link} href="/forgot-password" color="primary" className={styles.submit}>
              Request a new link
            </AdminButton>
          ) : (
            <AdminButton as={Link} href="/staff/login" color="primary" className={styles.submit}>
              Go to staff sign-in
            </AdminButton>
          )}
        </div>
        <p className={styles.footNote}>
          Already set a password?{' '}
          <Link href={mode === 'invite' ? '/staff/login' : '/login'} className={styles.link}>
            Sign in
          </Link>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1 className={styles.title}>{copy.title}</h1>
      <p className={styles.lead}>{copy.lead}</p>

      <form onSubmit={handleSubmit} className={styles.form} noValidate>
        <PasswordInput
          id="new-password"
          label="New password"
          placeholder="At least 12 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={trackCapsLock}
          onKeyUp={trackCapsLock}
          onBlur={() => setCapsLock(false)}
          autoComplete="new-password"
          autoFocus
          isReadOnly={submitting}
          isInvalid={problem?.field === 'password'}
          description={capsLock ? M.login.capsLockOn : undefined}
          classNames={{ inputWrapper: 'h-11 min-h-11', description: capsLock ? 'text-[#9a6a12]' : '' }}
        />
        <PasswordInput
          id="new-confirm"
          label="Confirm new password"
          placeholder="Type it again"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onKeyDown={trackCapsLock}
          onKeyUp={trackCapsLock}
          onBlur={() => setCapsLock(false)}
          autoComplete="new-password"
          isReadOnly={submitting}
          isInvalid={problem?.field === 'confirm'}
          classNames={{ inputWrapper: 'h-11 min-h-11' }}
        />

        <ul className={styles.checklist} aria-label="Password requirements">
          <li data-met={longEnough}>At least 12 characters</li>
          {!notTooLong && <li data-met={false}>At most 72 characters</li>}
          <li data-met={matches}>Both passwords match</li>
        </ul>

        {problem && <AuthProblem>{problem.text}</AuthProblem>}

        <AdminButton type="submit" color="primary" isLoading={submitting} className={styles.submit}>
          {submitting ? copy.busy : copy.submit}
        </AdminButton>
      </form>

      <p className={styles.footNote}>
        {mode === 'invite' ? (
          <>
            Next time, sign in at{' '}
            <Link href="/staff/login" className={styles.link}>
              staff sign-in
            </Link>
            .
          </>
        ) : (
          <>
            Remembered it?{' '}
            <Link href="/login" className={styles.link}>
              Back to sign in
            </Link>
          </>
        )}
      </p>
    </AuthLayout>
  );
}
