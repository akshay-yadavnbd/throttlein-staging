'use client';

/**
 * Customer sign-in page — `/signin`.
 *
 * One card on the cream page background, split in two:
 *  - Left (lg+): black brand panel — the lime emblem bleeding off the
 *    corner, a welcome headline and three reasons to have an account.
 *    On phones it collapses to a short dark strip above the form so the
 *    identity is still there without pushing the fields below the fold.
 *  - Right: the form, with the same bordered inputs as every other auth
 *    form (components/common/FormField), one primary action, and
 *    "Create an account" as a real secondary button rather than a bare
 *    text link.
 *
 * Sign-in logic (customer-only accounts, remember-me storage, returnTo)
 * is unchanged.
 */

import { safeReturnPath } from '@/lib/safeReturnPath';
import { useState } from 'react';
import Link from 'next/link';
import { authCardClass, authFormClass, authHeadlineClass, authPanelClass } from '@/components/common/authFrame';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Checkbox } from '@heroui/react';
import Arrow from '@/components/common/Arrow';
import { api, unwrap } from '@/lib/api';
import { setStoredCustomer } from '@/lib/customerAuth';
import { FormField, FormInput, FormPasswordInput, MailIcon, LockIcon } from '@/components/common/FormField';
import { notifySuccess } from '@/lib/notify';
import { M } from '@/lib/messages';
import { validateEmail } from '@/lib/authValidation';

const ERROR_TITLE: Record<string, string> = {
  USER_NOT_FOUND: "We couldn't find that account",
  WRONG_PASSWORD: 'Incorrect password',
  ACCOUNT_SUSPENDED: 'Account suspended',
  WRONG_PORTAL: 'Wrong sign-in page',
  EMAIL_UNVERIFIED: 'Verify your email first',
  MISSING_FIELDS: 'Missing details',
};

export default function SigninPage() {
  const router = useRouter();
  const params = useSearchParams();
  const returnTo = safeReturnPath(params.get('returnTo'));

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Default to true — customers on their own device usually expect to
  // stay signed in. Unchecking falls back to sessionStorage so the
  // session ends when the tab closes (better for shared machines).
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  // Inline red banner keyed off backend `code`.
  const [loginError, setLoginError] = useState<{ code: string; message: string } | null>(null);
  // A format error shows once the field is left; "this is required" only
  // after a submit attempt, so tabbing past an empty field stays quiet.
  const [touched, setTouched] = useState({ email: false, password: false });
  const [submitted, setSubmitted] = useState(false);
  const emailError = validateEmail(email);
  const passwordError = password ? '' : 'Enter your password.';
  const showEmailError = (submitted || (touched.email && email)) ? emailError : '';
  const showPasswordError = submitted ? passwordError : '';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (emailError || passwordError) {
      (e.currentTarget as HTMLFormElement).querySelector<HTMLInputElement>(emailError ? '[name="email"]' : '[name="password"]')?.focus();
      return;
    }
    setLoading(true);
    setLoginError(null);
    try {
      const data = unwrap<any>(await api.post('/auth/login', { email, password }));
      // Only customer accounts may shop here — the /account pages refuse any
      // other role, so letting one in would leave a menu whose links all bounce.
      if (data.user.role !== 'customer') {
        setLoginError({
          code: 'WRONG_PORTAL',
          message: data.user.role === 'seller'
            ? 'That email belongs to a seller account. Use the seller sign-in instead.'
            : 'That email belongs to a Throttlein admin account. Use the admin panel, or sign in with a customer account.',
        });
        return;
      }
      setStoredCustomer(data.token, data.user, remember);
      notifySuccess(M.signin.welcome(data.user.name));
      router.replace(returnTo);
    } catch (e: any) {
      const resp = e?.response?.data;
      setLoginError({
        code: resp?.code || 'LOGIN_FAILED',
        message: resp?.message || 'Something went wrong. Please try again.',
      });
    } finally {
      setLoading(false);
    }
  }

  const signupHref = `/signup${returnTo !== '/account' ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`;
  // The banner names the one thing to do next, so the fix is one tap away.
  const errorAction = loginError?.code === 'USER_NOT_FOUND'
    ? { href: signupHref, label: 'Create an account' }
    : loginError?.code === 'WRONG_PASSWORD'
      ? { href: '/forgot-password', label: 'Reset your password' }
      : loginError?.code === 'WRONG_PORTAL'
        ? { href: '/seller/login', label: 'Go to seller sign-in' }
        : null;

  return (
    // Fills the viewport below the navbar using the header's REAL height
    // (--site-header-h, published by Navbar), so the card centres when
    // there is room and the page only scrolls when the card is genuinely
    // taller than the viewport. The old calc(100vh - 76px) guessed the
    // navbar height and overshot by ~20px, which showed a scrollbar on
    // every screen.
    <div
      className="flex items-center justify-center bg-brand-cream px-4 sm:px-6 py-8"
      style={{ minHeight: 'calc(100dvh - var(--site-header-h, 83px))' }}
    >
      <div className={authCardClass}>
        {/* ── Brand panel ─────────────────────────────────────────── */}
        <aside className={authPanelClass}>
          {/* The emblem, oversized and cropped by the corner — the same
              mark as the logo, used as texture rather than repeated as a
              badge beside the heading. */}
          <img
            src="/images/home-banner-img.webp"
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-24 -right-20 w-[360px] select-none opacity-[0.14] lg:-bottom-32 lg:-right-28 lg:w-[540px] lg:opacity-20"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-[0.05]"
            style={{ backgroundImage: 'repeating-linear-gradient(45deg, #fff 0 1px, transparent 1px 18px)' }}
          />

          <div className="relative">
            <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-brand-lime">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-brand-lime" />
              Welcome back
            </div>
            <h1 className={`mt-4 ${authHeadlineClass}`}>
              Gear up.
              <br />
              Sign in and ride on.
            </h1>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/70 lg:text-[15px]">
              Genuine parts, riding gear and accessories from the brands riders trust, delivered across India.
            </p>
          </div>

          <ul className="relative mt-10 hidden flex-col gap-4 lg:flex">
            <ValueProp title="Track every order" body="Live courier updates from dispatch to your door." />
            <ValueProp title="Faster checkout" body="Saved addresses and your bikes, ready at checkout." />
            <ValueProp title="Wishlist and cart in sync" body="Pick up on any device, right where you left off." />
          </ul>

          <div className="relative mt-8 hidden items-center justify-between gap-4 text-[12px] text-white/55 lg:flex">
            <span>Want to sell on THROTTLEIN?</span>
            <Link
              href="/seller"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-white/85 transition hover:text-brand-lime"
            >
              Seller hub <Arrow dir="up-right" />
            </Link>
          </div>
        </aside>

        {/* ── Form ────────────────────────────────────────────────── */}
        <section className={authFormClass}>
          <div className="flex items-center gap-3">
            <BrandMark />
            <div className="min-w-0">
              <h2 className="text-2xl font-bold leading-tight text-brand-black">Sign in</h2>
              <p className="mt-0.5 text-sm text-[#6b6b6b]">Use the email you shop with.</p>
            </div>
          </div>

          {loginError && (
            <div role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4">
              <div className="flex items-start gap-3">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-red-100 text-red-700">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
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

          {/* noValidate: the messages come from our checks, not the
              browser's generic bubbles. */}
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
                onBlur={() => setTouched((t) => ({ ...t, email: true }))}
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
                onBlur={() => setTouched((t) => ({ ...t, password: true }))}
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
              <Link href="/forgot-password" className="text-sm font-medium text-[#212121] underline decoration-[#BDBDBD] underline-offset-4 transition hover:decoration-[#141414]">
                Forgot password?
              </Link>
            </div>

            <Button
              type="submit"
              color="primary"
              size="lg"
              isLoading={loading}
              className="group h-11 rounded-[10px] text-sm font-semibold"
              endContent={!loading && <Arrow className="transition-transform group-hover:translate-x-0.5" />}
            >
              Sign in
            </Button>
          </form>

          <div className="mt-7 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9b9b9b]">
            <span aria-hidden="true" className="h-px flex-1 bg-[#e0e0e0]" />
            New here?
            <span aria-hidden="true" className="h-px flex-1 bg-[#e0e0e0]" />
          </div>
          <Link
            href={signupHref}
            className="mt-4 inline-flex h-11 items-center justify-center gap-2 rounded-[10px] border border-brand-black text-sm font-semibold text-brand-black transition hover:bg-brand-black hover:text-white"
          >
            Create an account
          </Link>
          <p className="mt-5 text-center text-[11px] text-[#8a8a8a]">
            Trouble signing in?{' '}
            <a href="mailto:support@throttlein.com" className="font-semibold text-[#212121] underline-offset-2 hover:underline">
              support@throttlein.com
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}

function ValueProp({ title, body }: { title: string; body: string }) {
  return (
    <li className="flex items-start gap-3">
      <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-lime text-brand-black">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <div className="min-w-0">
        <div className="text-sm font-bold leading-tight">{title}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-white/60">{body}</div>
      </div>
    </li>
  );
}

/** The lime emblem, small, beside the form heading. */
function BrandMark() {
  return (
    <svg width="40" height="40" viewBox="0 0 42 42" fill="none" aria-hidden="true" className="shrink-0">
      <circle cx="20.6158" cy="20.6158" r="20.6158" fill="#D5FA00" />
      <path fillRule="evenodd" clipRule="evenodd" d="M0.39155 16.5967L0.300983 17.0866C0.28687 17.1683 0.273172 17.2503 0.260027 17.3325C0.088906 18.4017 0 19.4984 0 20.6158C0 30.0847 6.38376 38.0627 15.0823 40.4805L15.7467 40.6538C17.3079 41.0318 18.9385 41.2316 20.6158 41.2316C30.5109 41.2316 38.7779 34.2596 40.773 24.9605C41.0735 23.5598 41.2316 22.1063 41.2316 20.6158C41.2316 11.3182 35.0768 3.45815 26.6193 0.887785C24.7197 0.310483 22.704 0 20.6158 0C10.6055 0 2.26143 7.13506 0.39155 16.5967ZM3.76396 18.4468C3.81321 18.06 3.87542 17.6775 3.95002 17.3C5.36633 10.1327 11.2963 4.58671 18.6509 3.73932C16.0362 5.02435 13.9771 6.45521 12.9001 7.71224L12.9741 7.67311C15.2749 6.43256 17.9282 5.72528 20.753 5.72528C26.9076 5.72528 31.7649 8.47482 34.6627 12.6697C34.6627 12.6697 39.5441 19.6774 35.9105 27.8427C35.7565 28.1886 35.6321 28.4905 35.535 28.7516C32.9191 33.537 28.0659 36.9254 22.3853 37.5136C24.5186 36.3438 26.192 35.0861 27.1153 33.9663L27.044 34.0054C24.8299 35.246 22.2766 35.9533 19.5581 35.9533C13.6353 35.9533 9.42467 33.4439 6.1722 29.0088C6.1722 29.0088 3.13128 24.4725 3.76396 18.4468Z" fill="#141414" />
      <path fillRule="evenodd" clipRule="evenodd" d="M31.7176 20.6166C31.7176 26.7475 26.7475 31.7176 20.6166 31.7176C14.4857 31.7176 9.51562 26.7475 9.51562 20.6166C9.51562 14.4857 14.4857 9.51562 20.6166 9.51562C26.7475 9.51562 31.7176 14.4857 31.7176 20.6166ZM22.7703 16.7424L20.6167 14.2234L18.4631 16.7424L15.1509 16.8556L15.7776 20.1099L13.801 22.77L16.736 24.3091L17.5834 27.5129L20.6167 26.1779L23.6499 27.5129L24.4973 24.3091L27.4323 22.77L25.4557 20.1099L26.0824 16.8556L22.7703 16.7424Z" fill="#141414" />
    </svg>
  );
}
