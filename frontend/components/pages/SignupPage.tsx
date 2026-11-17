'use client';

/**
 * Customer sign-up page — `/signup`.
 *
 * The same split card as the sign-in page (components/pages/SigninPage):
 *  - Left (lg+): black brand panel with the lime emblem, a headline and
 *    four reasons to have an account. On phones it collapses to a short
 *    dark strip above the form.
 *  - Right: the form — name, email + phone, password + confirm — each
 *    validated on blur and on submit (lib/authValidation), with a live
 *    strength meter under the password, the Terms / Privacy line, one
 *    primary action and "Sign in" as a bordered secondary button.
 *
 * Registration logic (12-character minimum, confirm match, returnTo) is
 * unchanged; the checks here just catch mistakes before the request.
 */

import { safeReturnPath } from '@/lib/safeReturnPath';
import { useState } from 'react';
import Link from 'next/link';
import { authCardClass, authFormClass, authHeadlineClass, authPanelClass } from '@/components/common/authFrame';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@heroui/react';
import Arrow from '@/components/common/Arrow';
import { api, unwrap } from '@/lib/api';
import { setStoredCustomer } from '@/lib/customerAuth';
import { FormField, FormInput, FormPasswordInput, MailIcon, LockIcon, UserIcon, digitsOnlyKeyDown } from '@/components/common/FormField';
import { notifyError, notifySuccess, notifyWarning } from '@/lib/notify';
import { M } from '@/lib/messages';
import {
  PASSWORD_MIN, passwordStrength, phoneDigits, validateConfirm, validateEmail, validateName, validatePassword, validatePhone,
} from '@/lib/authValidation';

type Field = 'name' | 'email' | 'phone' | 'password' | 'confirmPassword';

export default function SignupPage() {
  const router = useRouter();
  const params = useSearchParams();
  const returnTo = safeReturnPath(params.get('returnTo'));

  const [form, setForm] = useState<Record<Field, string>>({
    name: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
  });
  // A format error shows once the person has left a field they typed in;
  // "this is required" only after the first submit attempt, so tabbing
  // past an empty field stays quiet.
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const errors: Record<Field, string> = {
    name: validateName(form.name),
    email: validateEmail(form.email),
    phone: validatePhone(form.phone),
    password: validatePassword(form.password),
    confirmPassword: validateConfirm(form.password, form.confirmPassword),
  };
  const show = (f: Field) => (submitted || (touched[f] && form[f])) && errors[f] ? errors[f] : '';
  const strength = passwordStrength(form.password);

  function update(k: Field, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }
  const touch = (k: Field) => () => setTouched((t) => ({ ...t, [k]: true }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    const firstInvalid = (Object.keys(errors) as Field[]).find((k) => errors[k]);
    if (firstInvalid) {
      (e.currentTarget as HTMLFormElement).querySelector<HTMLInputElement>(`[name="${firstInvalid}"]`)?.focus();
      notifyWarning(firstInvalid === 'confirmPassword' ? M.signup.passwordsDoNotMatch
        : firstInvalid === 'password' ? M.signup.passwordMustBeAtLeast12Characters
          : 'Check the highlighted fields.');
      return;
    }
    setLoading(true);
    try {
      const { confirmPassword, ...payload } = form;
      const data = unwrap<any>(await api.post('/auth/register-customer', {
        ...payload,
        name: payload.name.trim(),
        email: payload.email.trim(),
        phone: payload.phone.replace(/[\s\-().]/g, ''),
      }));
      setStoredCustomer(data.token, data.user);
      notifySuccess(M.signup.accountCreatedWelcome);
      router.replace(returnTo);
    } catch (e: any) {
      notifyError(e, M.signup.signUpFailed);
    } finally {
      setLoading(false);
    }
  }

  const signinHref = `/signin${returnTo !== '/account' ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`;

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
          <img
            src="/images/home-banner-img.webp"
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-24 -right-20 w-[360px] select-none opacity-[0.14] lg:-bottom-32 lg:-right-28 lg:w-[520px] lg:opacity-20"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-[0.05]"
            style={{ backgroundImage: 'repeating-linear-gradient(45deg, #fff 0 1px, transparent 1px 18px)' }}
          />

          <div className="relative">
            <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-brand-lime">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-brand-lime" />
              Join THROTTLEIN
            </div>
            <h1 className={`mt-4 ${authHeadlineClass}`}>
              Gear up for
              <br />
              your next ride.
            </h1>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/70 lg:text-[15px]">
              One free account to shop helmets, jackets, parts and more from brands you trust, delivered to your door.
            </p>
          </div>

          <ul className="relative mt-10 hidden flex-col gap-4 lg:flex">
            <ValueProp title="Authentic gear" body="Sold by verified sellers and authorised dealers." />
            <ValueProp title="Easy returns" body="A clear return window on most products, no hassle." />
            <ValueProp title="One account, everywhere" body="Wishlist, cart and orders sync across your devices." />
            <ValueProp title="Secure checkout" body="UPI, cards, net banking and cash on delivery." />
          </ul>

          <div className="relative mt-8 hidden items-center justify-between gap-4 text-[12px] text-white/55 lg:flex">
            <span>Already selling motorbike gear?</span>
            <Link
              href="/seller"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-white/85 transition hover:text-brand-lime"
            >
              Open a seller account <Arrow dir="up-right" />
            </Link>
          </div>
        </aside>

        {/* ── Form ────────────────────────────────────────────────── */}
        <section className={authFormClass}>
          <h2 className="text-2xl font-bold leading-tight text-brand-black">Create your account</h2>

          {/* Name full width, then email + phone, then the two password
              fields. Pairs collapse to one column on small screens.
              noValidate: the messages come from our checks, not the
              browser's generic bubbles. */}
          <form onSubmit={submit} noValidate className="mt-7 flex flex-col gap-5">
            <FormField label="Full name" required error={show('name')}>
              <FormInput
                name="name"
                required
                autoFocus
                autoComplete="name"
                icon={<UserIcon />}
                invalid={!!show('name')}
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                onBlur={touch('name')}
              />
            </FormField>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <FormField label="Email address" required error={show('email')}>
                <FormInput
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  inputMode="email"
                  icon={<MailIcon />}
                  invalid={!!show('email')}
                  value={form.email}
                  onChange={(e) => update('email', e.target.value)}
                  onBlur={touch('email')}
                />
              </FormField>
              <FormField label="Phone number" error={show('phone')} hint={show('phone') ? undefined : 'Optional · for delivery updates'}>
                {/* Digits only: letters are blocked at the keyboard, a
                    pasted "+91 …" is folded to its 10 digits, and the
                    value is capped at 10. (No maxLength: Chrome would
                    truncate a pasted "+91 98765 43210" before we clean it.) */}
                <FormInput
                  name="phone"
                  type="tel"
                  autoComplete="tel-national"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="98765 43210"
                  prefix="+91"
                  invalid={!!show('phone')}
                  value={form.phone}
                  onKeyDown={digitsOnlyKeyDown}
                  onChange={(e) => update('phone', phoneDigits(e.target.value))}
                  onBlur={touch('phone')}
                />
              </FormField>
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <FormField
                label="Password"
                required
                error={show('password')}
                hint={show('password') ? undefined : <StrengthHint value={form.password} score={strength.score} label={strength.label} />}
              >
                <FormPasswordInput
                  name="password"
                  required
                  autoComplete="new-password"
                  icon={<LockIcon />}
                  invalid={!!show('password')}
                  value={form.password}
                  onChange={(e) => update('password', e.target.value)}
                  onBlur={touch('password')}
                  minLength={PASSWORD_MIN}
                />
              </FormField>
              <FormField label="Confirm password" required error={show('confirmPassword')}>
                <FormPasswordInput
                  name="confirmPassword"
                  required
                  autoComplete="new-password"
                  icon={<LockIcon />}
                  invalid={!!show('confirmPassword')}
                  value={form.confirmPassword}
                  onChange={(e) => update('confirmPassword', e.target.value)}
                  onBlur={touch('confirmPassword')}
                />
              </FormField>
            </div>

            <Button
              type="submit"
              color="primary"
              size="lg"
              className="group mt-1 h-11 rounded-[10px] text-sm font-semibold"
              isLoading={loading}
              endContent={!loading && <Arrow className="transition-transform group-hover:translate-x-0.5" />}
            >
              Create account
            </Button>

            <p className="-mt-1 text-center text-[11px] leading-relaxed text-[#8a8a8a]">
              By creating an account you agree to our{' '}
              <Link href="/terms-and-conditions" className="font-semibold text-brand-black hover:underline">Terms</Link>
              {' '}and{' '}
              <Link href="/privacy-policy" className="font-semibold text-brand-black hover:underline">Privacy policy</Link>.
            </p>
          </form>

          <div className="mt-7 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9b9b9b]">
            <span aria-hidden="true" className="h-px flex-1 bg-[#e0e0e0]" />
            Already a member?
            <span aria-hidden="true" className="h-px flex-1 bg-[#e0e0e0]" />
          </div>
          <Link
            href={signinHref}
            className="mt-4 inline-flex h-11 items-center justify-center gap-2 rounded-[10px] border border-brand-black text-sm font-semibold text-brand-black transition hover:bg-brand-black hover:text-white"
          >
            Sign in
          </Link>
        </section>
      </div>
    </div>
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
