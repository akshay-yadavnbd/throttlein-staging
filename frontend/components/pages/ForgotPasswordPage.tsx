'use client';

/**
 * Forgot-password page — `/forgot-password`.
 *
 * Shared by customers (from /signin) and sellers (from /seller/login,
 * which links here with `?from=seller`). The storefront Navbar and
 * Footer hide themselves on this route, so the page brings its own
 * chrome: the seller marketing header and footer for the seller funnel,
 * and a minimal logo bar for customers so they are not dropped into the
 * seller property's navigation.
 *
 * The card itself is the same split layout as sign-in and sign-up: a
 * black brand panel on the left, the form on the right, and the "Back to
 * sign in" link always pointing at the sign-in page the person came from.
 */

import { useState } from 'react';
import Link from 'next/link';
import { authCardClass, authFormClass, authHeadlineClass, authPanelClass } from '@/components/common/authFrame';
import { useSearchParams } from 'next/navigation';
import { Button } from '@heroui/react';
import Arrow from '@/components/common/Arrow';
import { api } from '@/lib/api';
import MarketingHeader from '@/components/common/MarketingHeader';
import MarketingFooter from '@/components/common/MarketingFooter';
import { FormField, FormInput, MailIcon } from '@/components/common/FormField';
import { notifyError, notifyWarning } from '@/lib/notify';
import { M } from '@/lib/messages';
import { validateEmail } from '@/lib/authValidation';

export default function ForgotPasswordPage() {
  const params = useSearchParams();
  const fromSeller = params.get('from') === 'seller';
  const signinHref = fromSeller ? '/seller/login' : '/signin';

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [touched, setTouched] = useState(false);
  const emailError = validateEmail(email);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (emailError) {
      if (!email.trim()) notifyWarning(M.forgotPassword.pleaseEnterYourEmail);
      return;
    }
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email: email.trim() });
      setSent(true);
    } catch (e: any) {
      notifyError(e, M.forgotPassword.couldntSendResetEmail);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-brand-cream">
      {fromSeller ? (
        <MarketingHeader />
      ) : (
        <header className="border-b border-[#e3e6de] bg-white">
          <div className="mx-auto flex h-[64px] max-w-[1440px] items-center justify-between px-4 sm:px-6">
            <Link href="/" aria-label="THROTTLEIN home" className="inline-flex items-center">
              <img src="/images/throttlein-logo.webp" alt="THROTTLEIN" className="h-7 w-auto" />
            </Link>
            <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-[#212121] hover:underline">
              <Arrow dir="left" /> Back to the store
            </Link>
          </div>
        </header>
      )}

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
              <Link
                href={signinHref}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-xs font-medium text-white transition hover:bg-white/15"
              >
                <Arrow dir="left" /> Back to sign in
              </Link>
              <h1 className={`mt-6 ${authHeadlineClass}`}>
                Locked out?
                <br />
                It happens.
              </h1>
              <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/70 lg:text-[15px]">
                Drop your email and we&rsquo;ll send a reset link that works for the next 60 minutes.
              </p>
            </div>
            <div className="relative mt-8 hidden max-w-sm rounded-xl border border-white/15 bg-white/5 p-4 text-xs leading-relaxed text-white/70 lg:block">
              <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-lime">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-brand-lime" />
                Heads-up
              </div>
              For security we don&rsquo;t say whether an email is registered. If there is an account on file, the link lands in your inbox within a minute.
            </div>
          </aside>

          {/* ── Form ──────────────────────────────────────────────── */}
          <section className={authFormClass}>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9b9b9b]">Reset password</div>
            <h2 className="mt-2 text-2xl font-bold leading-tight text-brand-black">
              {sent ? 'Check your inbox' : 'Send a reset link'}
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-[#6b6b6b]">
              {sent
                ? <>If an account exists for <strong className="text-brand-black">{email}</strong>, a reset link is on its way. It works for 60 minutes.</>
                : 'Enter the email you signed up with and we’ll send you a link.'}
            </p>

            {sent ? (
              <div className="mt-7 flex flex-col gap-4">
                <div className="flex items-start gap-3 rounded-xl border border-[#d3e2ad] bg-[#f6f9ee] p-4">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-lime text-brand-black" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M4 4h16v16H4z" /><path d="m4 7 8 6 8-6" /></svg>
                  </span>
                  <p className="text-xs leading-relaxed text-[#3c4a2b]">
                    Didn&rsquo;t get it? Check your spam folder, or{' '}
                    <button type="button" onClick={() => setSent(false)} className="font-semibold text-brand-black underline underline-offset-2">
                      try a different email
                    </button>
                    .
                  </p>
                </div>
                <Link
                  href={signinHref}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-[10px] bg-brand-black text-sm font-semibold text-white transition hover:bg-[#2b2b2b]"
                >
                  Back to sign in <Arrow />
                </Link>
              </div>
            ) : (
              <form onSubmit={submit} noValidate className="mt-7 flex flex-col gap-5">
                <FormField label="Email address" required error={touched && email ? emailError : ''}>
                  <FormInput
                    type="email"
                    required
                    autoFocus
                    autoComplete="email"
                    inputMode="email"
                    icon={<MailIcon />}
                    invalid={touched && !!email && !!emailError}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onBlur={() => setTouched(true)}
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
                  Send reset link
                </Button>
                <p className="text-center text-sm text-[#6b6b6b]">
                  Remembered it?{' '}
                  <Link href={signinHref} className="font-semibold text-brand-black underline-offset-2 hover:underline">
                    Sign in
                  </Link>
                </p>
              </form>
            )}
          </section>
        </div>
      </div>

      {fromSeller && <MarketingFooter />}
    </div>
  );
}
