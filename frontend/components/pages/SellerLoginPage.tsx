'use client';

/**
 * Seller login page — `/seller/login`.
 *
 * Header and footer come from `app/seller/layout.tsx` (the seller
 * property's own chrome). This page is one split card on the cream
 * background, like the storefront auth pages:
 *  - Left (lg+): the warehouse photo with a dark gradient, "Reach
 *    10,000+ riders monthly", three things the portal does and three
 *    quick stats. On phones it is a short photo strip above the form.
 *  - Right: the form, with the shared FormField inputs, inline
 *    validation (lib/authValidation), a styled "Keep me signed in"
 *    checkbox, one black Sign in button and "Create a seller account"
 *    as a bordered secondary button.
 *
 * Functionality preserved: POST /auth/login, role check (rejects
 * customer accounts), master-key sessions, the unverified-account banner
 * with resend, and the forgot-password link.
 */

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { authCardClass, authFormClass, authHeadlineClass, authPanelClass } from '@/components/common/authFrame';
import { useRouter } from 'next/navigation';
import { Button, Checkbox } from '@heroui/react';
import Arrow from '@/components/common/Arrow';
import { api, unwrap } from '@/lib/api';
import { markMasterKeySession, setStoredUser } from '@/lib/auth';
import { FormField, FormInput, FormPasswordInput, MailIcon, LockIcon } from '@/components/common/FormField';
import { notifyError, notifySuccess } from '@/lib/notify';
import { M } from '@/lib/messages';
import { validateEmail } from '@/lib/authValidation';

const BENEFITS = [
  { title: 'Live orders dashboard', body: 'Confirm, ship and track every order with one-click courier selection.' },
  { title: 'Revenue at a glance', body: '30-day revenue, best sellers and stock alerts, refreshed for you.' },
  { title: 'Shipping built in', body: 'Labels, pickups and tracking for your buyers, all from one screen.' },
];

const STATS = [
  { value: '2 min', label: 'to list a product' },
  { value: '48 h', label: 'order SLA' },
  { value: '₹0', label: 'listing fee' },
];

const ERROR_TITLE: Record<string, string> = {
  USER_NOT_FOUND: "We couldn't find that account",
  WRONG_PASSWORD: 'Incorrect password',
  ACCOUNT_SUSPENDED: 'Account suspended',
  WRONG_PORTAL: 'Wrong sign-in page',
  MISSING_FIELDS: 'Missing details',
};

export default function SellerLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Default true — sellers usually want to stay signed in on their
  // own machine. Unchecking moves the token into sessionStorage so it
  // dies with the tab.
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [unverified, setUnverified] = useState<{ email: string; msg: string } | null>(null);
  const [resending, setResending] = useState(false);
  // Inline error banner — keyed off backend `code` so the copy + CTA
  // match the actual failure instead of a generic "Invalid credentials".
  const [loginError, setLoginError] = useState<{ code: string; message: string } | null>(null);
  // A format error shows once the field is left with something in it;
  // "this is required" only after a submit attempt.
  const [touched, setTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const emailError = validateEmail(email);
  const passwordError = password ? '' : 'Enter your password.';
  const showEmailError = (submitted || (touched && email)) ? emailError : '';
  const showPasswordError = submitted ? passwordError : '';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (emailError || passwordError) {
      (e.currentTarget as HTMLFormElement).querySelector<HTMLInputElement>(emailError ? '[name="email"]' : '[name="password"]')?.focus();
      return;
    }
    setLoading(true);
    setUnverified(null);
    setLoginError(null);
    try {
      const data = unwrap<any>(await api.post('/auth/login', { email, password }));
      if (data.user.role === 'customer') {
        setLoginError({
          code: 'WRONG_PORTAL',
          message: 'That email belongs to a customer account. Use the customer sign-in instead.',
        });
        return;
      }
      /* A master-access-key sign-in comes back flagged. It is a
       * 30-minute audited session with password / email / payout writes
       * blocked server-side, so it must never be remembered on disk and
       * the dashboard needs its "signed in as" banner — same treatment
       * as the admin panel's hand-off. */
      if (data.masterKey) {
        setStoredUser(data.token, data.user, false);
        markMasterKeySession({
          sellerName: data.user.storeName || data.user.name || 'this seller',
          sellerEmail: data.user.email || email,
          expiresInMinutes: data.expiresInMinutes || 30,
        });
        notifySuccess(M.sellerLogin.openedWithTheMasterKey(data.user.storeName || data.user.name));
        router.replace('/dashboard');
        return;
      }

      setStoredUser(data.token, data.user, remember);
      notifySuccess(M.sellerLogin.welcomeBack(data.user.name));
      router.replace('/dashboard');
    } catch (e: any) {
      const resp = e?.response?.data;
      // The error envelope carries the account facts under `details`.
      if (resp?.code === 'EMAIL_UNVERIFIED' || resp?.details?.unverified || resp?.unverified) {
        // Amber banner keeps its own resend-verification action.
        setUnverified({
          email: resp.details?.email || resp.email || email,
          msg: resp.message || 'Please verify your email to activate your account.',
        });
      } else {
        setLoginError({
          code: resp?.code || 'LOGIN_FAILED',
          message: resp?.message || 'Something went wrong. Please try again.',
        });
      }
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    if (!unverified) return;
    setResending(true);
    try {
      await api.post('/auth/resend-verification', { email: unverified.email });
      notifySuccess(M.sellerLogin.verificationLinkSentCheckYourInbox);
    } catch (e: any) {
      notifyError(e, M.sellerLogin.couldntResend);
    } finally {
      setResending(false);
    }
  }

  const errorAction = loginError?.code === 'USER_NOT_FOUND'
    ? { href: '/seller/register', label: 'Create a seller account' }
    : loginError?.code === 'WRONG_PASSWORD'
      ? { href: '/forgot-password?from=seller', label: 'Reset your password' }
      : loginError?.code === 'WRONG_PORTAL'
        ? { href: '/signin', label: 'Go to customer sign-in' }
        : null;

  /* No min-h-screen here: the page renders under the seller layout's
     header + footer, and a full viewport of height painted a white band
     between the form and the footer. */
  return (
    <div className="bg-brand-cream px-4 py-8 sm:px-6 sm:py-12">
      <div className={authCardClass}>
        {/* ── Photo panel ─────────────────────────────────────────── */}
        <aside className={`min-h-[220px] ${authPanelClass}`}>
          <Image
            src="/images/figma-sell/seller-signin.webp"
            alt=""
            fill
            sizes="(max-width: 1024px) 100vw, 50vw"
            className="object-cover object-[60%_center]"
            priority
          />
          <div
            aria-hidden
            className="absolute inset-0"
            style={{ backgroundImage: 'linear-gradient(180deg, rgba(20,20,20,0.35) 0%, rgba(20,20,20,0.55) 45%, rgba(20,20,20,0.92) 100%)' }}
          />
          <div className="relative">
            <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-brand-lime">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand-lime" />
              Seller portal
            </div>
            <h1 className={`mt-3 ${authHeadlineClass}`}>
              Reach <span className="text-brand-lime">10,000+</span>
              <br />
              riders monthly.
            </h1>
          </div>
          <div className="relative hidden lg:block">
            <ul className="flex flex-col gap-4">
              {BENEFITS.map((b) => (
                <li key={b.title} className="flex items-start gap-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-lime text-brand-black" aria-hidden>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5"><polyline points="20 6 9 17 4 12" /></svg>
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-bold leading-tight">{b.title}</div>
                    <div className="mt-0.5 text-xs leading-relaxed text-white/70">{b.body}</div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-8 grid grid-cols-3 gap-3 border-t border-white/15 pt-6">
              {STATS.map((s) => (
                <div key={s.label}>
                  <div className="text-2xl font-bold leading-none text-white">{s.value}</div>
                  <div className="mt-1.5 text-[11px] uppercase tracking-[0.12em] text-white/60">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* ── Form ────────────────────────────────────────────────── */}
        <section className={authFormClass}>
          <h2 className="text-2xl font-bold leading-tight text-brand-black">Seller sign in</h2>
          <p className="mt-1 text-sm text-[#6b6b6b]">Use the email and password you set when you verified your account.</p>

          {/* Red banner: each failure gets its own headline and the one
              thing to do next. */}
          {loginError && (
            <div role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4">
              <div className="flex items-start gap-3">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-red-100 text-red-700">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-red-900">{ERROR_TITLE[loginError.code] || 'Sign in failed'}</div>
                  <div className="mt-0.5 text-xs leading-relaxed text-red-800">{loginError.message}</div>
                  {errorAction && (
                    <Link href={errorAction.href} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-red-900 underline underline-offset-2">
                      {errorAction.label} <Arrow />
                    </Link>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Unverified-account banner, with resend. */}
          {unverified && (
            <div role="alert" className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-start gap-3">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-700">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-amber-900">Verify your email first</div>
                  <div className="mt-0.5 text-xs leading-relaxed text-amber-800">{unverified.msg}</div>
                  <div className="mt-1 break-all text-xs text-amber-800">
                    Sent to <span className="font-semibold">{unverified.email}</span>
                  </div>
                  <button
                    type="button"
                    onClick={resend}
                    disabled={resending}
                    className="mt-3 inline-flex h-9 items-center rounded-lg border border-amber-300 bg-white px-3 text-xs font-semibold text-amber-900 transition hover:bg-amber-100 disabled:opacity-60"
                  >
                    {resending ? 'Sending…' : 'Resend verification link'}
                  </button>
                </div>
              </div>
            </div>
          )}

          <form onSubmit={submit} noValidate className="mt-7 flex flex-col gap-5">
            <FormField label="Email address" required error={showEmailError}>
              <FormInput
                name="email"
                type="email"
                required
                autoFocus
                autoComplete="email"
                inputMode="email"
                icon={<MailIcon />}
                invalid={!!showEmailError}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setTouched(true)}
              />
            </FormField>
            <FormField label="Password" required error={showPasswordError}>
              <FormPasswordInput
                name="password"
                required
                autoComplete="current-password"
                icon={<LockIcon />}
                invalid={!!showPasswordError}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </FormField>

            <div className="-mt-1 flex items-center justify-between gap-4">
              <Checkbox
                isSelected={remember}
                onValueChange={setRemember}
                size="sm"
                classNames={{
                  base: 'm-0 p-0 gap-0 max-w-full',
                  wrapper: 'mr-2 h-[18px] w-[18px] rounded-[5px] border border-[#BDBDBD] bg-white shadow-none before:hidden after:rounded-[4px] after:bg-brand-black group-data-[hover=true]:border-[#141414] group-data-[selected=true]:border-brand-black',
                  icon: 'h-3 w-3 text-brand-lime',
                  label: 'text-sm text-[#212121]',
                }}
              >
                Keep me signed in
              </Checkbox>
              <Link href="/forgot-password?from=seller" className="text-sm font-medium text-[#212121] underline decoration-[#BDBDBD] underline-offset-4 transition hover:decoration-[#141414]">
                Forgot password?
              </Link>
            </div>

            <Button
              type="submit"
              size="lg"
              isLoading={loading}
              className="group h-11 rounded-[10px] bg-brand-black text-sm font-semibold text-white hover:bg-[#2b2b2b]"
              endContent={!loading && <Arrow className="transition-transform group-hover:translate-x-0.5" />}
            >
              Sign in
            </Button>
          </form>

          <div className="mt-7 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9b9b9b]">
            <span aria-hidden className="h-px flex-1 bg-[#e0e0e0]" />
            New here?
            <span aria-hidden className="h-px flex-1 bg-[#e0e0e0]" />
          </div>
          <Link
            href="/seller/register"
            className="mt-4 inline-flex h-11 items-center justify-center gap-2 rounded-[10px] border border-brand-black text-sm font-semibold text-brand-black transition hover:bg-brand-black hover:text-white"
          >
            Create a seller account
          </Link>
          <p className="mt-5 text-center text-[11px] text-[#8a8a8a]">
            Here to shop?{' '}
            <Link href="/signin" className="font-semibold text-[#212121] underline-offset-2 hover:underline">
              Customer sign-in
            </Link>
          </p>
        </section>
      </div>
    </div>
  );
}
