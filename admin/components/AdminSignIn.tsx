'use client';

/**
 * The admin sign-in screen, shared by /login (super-admins and staff) and
 * /staff/login (staff only — the address handed to new teammates). Same
 * POST /auth/login; the audience decides which roles may continue.
 *
 * Failures are explained inline under the form (and focus moves to the
 * field to fix); success goes to `?next=` when the person was sent here
 * from a page, else the dashboard. A visitor who is already signed in is
 * sent on without seeing the form.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Checkbox } from '@heroui/react';
import AdminInput from '@/components/AdminInput';
import AdminButton from '@/components/AdminButton';
import PasswordInput from '@/components/PasswordInput';
import AuthLayout, { AuthProblem, authStyles as styles } from '@/components/AuthLayout';
import { api, unwrap } from '@/lib/api';
import { getStoredAdmin, getStoredToken, pathAfterSignIn, setStoredAdmin } from '@/lib/auth';
import { apiMessage, errorReason, notifySuccess } from '@/lib/notify';
import { M } from '@/lib/messages';

type Audience = 'admin' | 'staff';
type Problem = {
  text: string;
  field?: 'email' | 'password';
  link?: { href: string; label: string };
};

const COPY: Record<Audience, { title: string; lead: string; emailLabel: string; emailHint: string }> = {
  admin: {
    title: 'Sign in',
    lead: 'The THROTTLEIN admin console, for super-admins and staff.',
    emailLabel: 'Email',
    emailHint: 'you@example.com',
  },
  staff: {
    title: 'Staff sign-in',
    lead: 'Use the work email your invite was sent to.',
    emailLabel: 'Work email',
    emailHint: 'you@throttlein.com',
  },
};

/** Why the sign-in failed, in words for the person, plus where to put the cursor. */
function problemFor(err: any): Problem {
  const status = Number(err?.response?.status) || 0;
  const code = err?.response?.data?.code;
  if (code === 'MISSING_FIELDS') return { text: M.login.enterEmailAndPassword, field: 'email' };
  if (code === 'INVALID_CREDENTIALS') return { text: M.login.emailAndPasswordDontMatch, field: 'password' };
  if (code === 'ACCOUNT_SUSPENDED') return { text: M.login.accountSuspended };
  if (status === 429) return { text: apiMessage(err) || M.login.tooManyAttempts };
  return { text: errorReason(err) };
}

export default function AdminSignIn({ audience }: { audience: Audience }) {
  const router = useRouter();
  const copy = COPY[audience];
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Default on so the admin stays signed in on their own machine; off keeps
  // the session in this tab only (shared / kiosk machines).
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [capsLock, setCapsLock] = useState(false);

  // Already signed in (another tab, or "Remember me"): skip the form.
  useEffect(() => {
    const user = getStoredAdmin();
    const allowed =
      audience === 'staff' ? user?.role === 'staff' : user?.role === 'superadmin' || user?.role === 'staff';
    if (getStoredToken() && allowed) router.replace(pathAfterSignIn());
  }, [audience, router]);

  const focus = (field?: Problem['field']) => {
    if (!field) return;
    const el = document.getElementById(`signin-${field}`) as HTMLInputElement | null;
    el?.focus();
    el?.select();
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      const missing: Problem = {
        text: M.login.enterEmailAndPassword,
        field: email.trim() ? 'password' : 'email',
      };
      setProblem(missing);
      focus(missing.field);
      return;
    }
    setLoading(true);
    setProblem(null);
    try {
      const data = unwrap<any>(await api.post('/auth/login', { email, password }));
      const role = data.user?.role;
      if (audience === 'staff' && role === 'superadmin') {
        setProblem({
          text: M.login.superadminUseMainSignIn,
          link: { href: '/login', label: 'Go to admin sign-in' },
        });
        return;
      }
      const allowed = audience === 'staff' ? role === 'staff' : role === 'superadmin' || role === 'staff';
      if (!allowed) {
        setProblem({
          text: audience === 'staff' ? M.staff.thisPageIsOnlyForInternalStaff : M.login.notAnAdminAccount,
        });
        return;
      }
      setStoredAdmin(data.token, data.user, remember);
      notifySuccess(M.login.welcome(data.user.name));
      router.replace(pathAfterSignIn());
    } catch (err: any) {
      const next = problemFor(err);
      setProblem(next);
      focus(next.field);
    } finally {
      setLoading(false);
    }
  }

  const trackCapsLock = (e: React.KeyboardEvent) => setCapsLock(e.getModifierState?.('CapsLock') ?? false);

  return (
    <AuthLayout>
      <h1 className={styles.title}>{copy.title}</h1>
      <p className={styles.lead}>{copy.lead}</p>

      <form onSubmit={handleSubmit} className={styles.form} noValidate>
        <AdminInput
          id="signin-email"
          type="email"
          label={copy.emailLabel}
          placeholder={copy.emailHint}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          autoFocus
          isReadOnly={loading}
          isInvalid={problem?.field === 'email'}
          classNames={{ inputWrapper: 'h-11 min-h-11' }}
        />
        <PasswordInput
          id="signin-password"
          label="Password"
          placeholder="Your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={trackCapsLock}
          onKeyUp={trackCapsLock}
          onBlur={() => setCapsLock(false)}
          autoComplete="current-password"
          isReadOnly={loading}
          isInvalid={problem?.field === 'password'}
          description={capsLock ? M.login.capsLockOn : undefined}
          classNames={{
            inputWrapper: 'h-11 min-h-11',
            description: capsLock ? 'text-[#9a6a12]' : '',
          }}
        />

        <div className={styles.row}>
          <Checkbox
            isSelected={remember}
            onValueChange={setRemember}
            isDisabled={loading}
            size="sm"
            classNames={{ label: 'text-[12px] text-[#46515a]' }}
          >
            Keep me signed in
          </Checkbox>
          <Link href="/forgot-password" className={styles.link}>
            Forgot password?
          </Link>
        </div>

        {problem && (
          <AuthProblem>
            {problem.text}
            {problem.link && (
              <>
                {' '}
                <Link href={problem.link.href} className={styles.link}>
                  {problem.link.label}
                </Link>
              </>
            )}
          </AuthProblem>
        )}

        <AdminButton type="submit" color="primary" isLoading={loading} className={styles.submit}>
          {loading ? 'Signing in…' : 'Sign in'}
        </AdminButton>
      </form>

      <p className={styles.footNote}>
        {audience === 'staff' ? (
          <>
            Super-admin?{' '}
            <Link href="/login" className={styles.link}>
              Use the admin sign-in
            </Link>
          </>
        ) : (
          'Access is limited to THROTTLEIN team accounts.'
        )}
      </p>
    </AuthLayout>
  );
}
