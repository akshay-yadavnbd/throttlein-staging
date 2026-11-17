'use client';

/**
 * Reset-password page — `/reset-password/[token]`, opened from the email.
 *
 * The same split card as the other auth pages (sign-in, sign-up, forgot
 * password): black brand panel with the password tips on the left, the
 * two password fields on the right, validated with lib/authValidation
 * (12-character minimum, confirm match) and a strength meter.
 *
 * The link serves customers and sellers alike, so the page cannot know
 * who is arriving. It carries a neutral logo bar, and once the server
 * answers it stores the session for the right property and sends the
 * person to their own home: /account for customers, /dashboard for
 * sellers. (Previously every reset stored a seller session and went to
 * the seller dashboard, which a customer cannot open.)
 */

import { use, useState } from 'react';
import Link from 'next/link';
import { authCardClass, authFormClass, authHeadlineClass, authPanelClass } from '@/components/common/authFrame';
import { useRouter } from 'next/navigation';
import { Button } from '@heroui/react';
import Arrow from '@/components/common/Arrow';
import { api, unwrap } from '@/lib/api';
import { setStoredUser } from '@/lib/auth';
import { setStoredCustomer } from '@/lib/customerAuth';
import { FormField, FormPasswordInput, LockIcon } from '@/components/common/FormField';
import { notifyError, notifySuccess, notifyWarning } from '@/lib/notify';
import { M } from '@/lib/messages';
import { PASSWORD_MIN, passwordStrength, validateConfirm, validatePassword } from '@/lib/authValidation';

export default function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const router = useRouter();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [touched, setTouched] = useState({ password: false, confirm: false });
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<'customer' | 'seller' | null>(null);

  const passwordError = validatePassword(password);
  const confirmError = validateConfirm(password, confirmPassword);
  // Format errors once the field is left with something in it; "required"
  // only after a submit attempt.
  const showPasswordError = (submitted || (touched.password && password)) ? passwordError : '';
  const showConfirmError = (submitted || (touched.confirm && confirmPassword)) ? confirmError : '';
  const strength = passwordStrength(password);
  const homeHref = done === 'customer' ? '/account' : '/dashboard';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (passwordError) {
      notifyWarning(M.resetPassword.passwordMustBeAtLeast12Characters);
      return;
    }
    if (confirmError) {
      notifyWarning(M.resetPassword.passwordsDoNotMatch);
      return;
    }
    setLoading(true);
    try {
      const data = unwrap<any>(await api.post(`/auth/reset-password/${token}`, {
        password,
        confirmPassword,
      }));
      const role: string = data?.user?.role || 'seller';
      const kind = role === 'customer' ? 'customer' : 'seller';
      if (data?.token && data?.user) {
        if (kind === 'customer') setStoredCustomer(data.token, data.user, true);
        else setStoredUser(data.token, data.user);
      }
      setDone(kind);
      notifySuccess(M.resetPassword.passwordUpdatedSigningYouIn);
      setTimeout(() => router.replace(kind === 'customer' ? '/account' : '/dashboard'), 1200);
    } catch (e: any) {
      notifyError(e, M.resetPassword.resetFailed);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-brand-cream">
      <header className="border-b border-[#e3e6de] bg-white">
        <div className="mx-auto flex h-[64px] max-w-[1440px] items-center justify-between px-4 sm:px-6">
          <Link href="/" aria-label="THROTTLEIN home" className="inline-flex items-center">
            <img src="/images/throttlein-logo.webp" alt="THROTTLEIN" className="h-7 w-auto" />
          </Link>
          <Link href="/signin" className="inline-flex items-center gap-1.5 text-sm font-medium text-[#212121] hover:underline">
            <Arrow dir="left" /> Back to sign in
          </Link>
        </div>
      </header>

      <div className="flex flex-1 items-center justify-center px-4 py-8 sm:px-6 sm:py-12">
        <div className={authCardClass}>
          {/* ── Brand panel ───────────────────────────────────────── */}
          <aside className={authPanelClass}>
            <img
              src="/images/home-banner-img.webp"
              alt=""
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-24 -right-20 w-[340px] select-none opacity-[0.14] lg:-bottom-28 lg:-right-24 lg:w-[460px] lg:opacity-20"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 opacity-[0.05]"
              style={{ backgroundImage: 'repeating-linear-gradient(45deg, #fff 0 1px, transparent 1px 18px)' }}
            />
            <div className="relative">
              <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-brand-lime">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-brand-lime" />
                Reset password
              </div>
              <h1 className={`mt-4 ${authHeadlineClass}`}>
                Set a new
                <br />
                password.
              </h1>
              <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/70 lg:text-[15px]">
                Pick something strong you&rsquo;ll remember. We sign you in the moment it&rsquo;s saved.
              </p>
            </div>
            <ul className="relative mt-8 hidden flex-col gap-3 lg:flex">
              <Tip>Use at least {PASSWORD_MIN} characters. Longer beats clever.</Tip>
              <Tip>Mix letters, numbers and a symbol.</Tip>
              <Tip>Don&rsquo;t reuse a password from another site.</Tip>
            </ul>
          </aside>

          {/* ── Form ──────────────────────────────────────────────── */}
          <section className={authFormClass}>
            {done ? (
              <div>
                <span className="grid h-12 w-12 place-items-center rounded-full bg-brand-lime text-brand-black" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><polyline points="20 6 9 17 4 12" /></svg>
                </span>
                <h2 className="mt-5 text-2xl font-bold leading-tight text-brand-black">Password updated</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-[#6b6b6b]">
                  You&rsquo;re signed in. Taking you to your {done === 'customer' ? 'account' : 'dashboard'}&hellip;
                </p>
                <Link
                  href={homeHref}
                  className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-[10px] bg-brand-black px-5 text-sm font-semibold text-white transition hover:bg-[#2b2b2b]"
                >
                  Continue <Arrow />
                </Link>
              </div>
            ) : (
              <>
                <h2 className="text-2xl font-bold leading-tight text-brand-black">Choose a new password</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-[#6b6b6b]">
                  At least {PASSWORD_MIN} characters. This link works once, for 60 minutes.
                </p>

                <form onSubmit={submit} noValidate className="mt-7 flex flex-col gap-5">
                  <FormField
                    label="New password"
                    required
                    error={showPasswordError}
                    hint={showPasswordError ? undefined : <StrengthHint value={password} score={strength.score} label={strength.label} />}
                  >
                    <FormPasswordInput
                      required
                      autoFocus
                      autoComplete="new-password"
                      minLength={PASSWORD_MIN}
                      icon={<LockIcon />}
                      invalid={!!showPasswordError}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onBlur={() => setTouched((t) => ({ ...t, password: true }))}
                    />
                  </FormField>
                  <FormField label="Confirm password" required error={showConfirmError}>
                    <FormPasswordInput
                      required
                      autoComplete="new-password"
                      icon={<LockIcon />}
                      invalid={!!showConfirmError}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      onBlur={() => setTouched((t) => ({ ...t, confirm: true }))}
                    />
                  </FormField>
                  <Button
                    type="submit"
                    color="primary"
                    size="lg"
                    isLoading={loading}
                    className="group h-11 rounded-[10px] text-sm font-semibold"
                    endContent={!loading && <Arrow className="transition-transform group-hover:translate-x-0.5" />}
                  >
                    Update password
                  </Button>
                  <p className="text-center text-sm text-[#6b6b6b]">
                    Link expired?{' '}
                    <Link href="/forgot-password" className="font-semibold text-brand-black underline-offset-2 hover:underline">
                      Request a new one
                    </Link>
                  </p>
                </form>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-sm text-white/75">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-lime text-brand-black" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3"><polyline points="20 6 9 17 4 12" /></svg>
      </span>
      <span className="pt-0.5">{children}</span>
    </li>
  );
}

/** The rule plus a three-segment meter once typing starts. */
function StrengthHint({ value, score, label }: { value: string; score: 0 | 1 | 2 | 3; label: string }) {
  if (!value) return <>At least {PASSWORD_MIN} characters. Longer is stronger.</>;
  const tone = score <= 1 ? 'bg-[#dc2626]' : score === 2 ? 'bg-[#b45309]' : 'bg-[#15803d]';
  const text = score <= 1 ? 'text-[#dc2626]' : score === 2 ? 'text-[#b45309]' : 'text-[#15803d]';
  const remaining = Math.max(0, PASSWORD_MIN - value.length);
  return (
    <span className="flex items-center gap-2">
      <span className="flex flex-1 gap-1" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <span key={n} className={`h-1 flex-1 rounded-full ${n <= score ? tone : 'bg-[#e5e5e5]'}`} />
        ))}
      </span>
      <span className={`shrink-0 font-medium ${text}`}>
        {remaining > 0 ? `${remaining} more character${remaining === 1 ? '' : 's'}` : label}
      </span>
    </span>
  );
}
