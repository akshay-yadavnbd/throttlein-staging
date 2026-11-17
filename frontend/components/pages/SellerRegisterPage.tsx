'use client';

/**
 * Seller register page — `/seller/register`.
 *
 * Header and footer come from `app/seller/layout.tsx`. The page is the
 * same split card as the seller login: the warehouse photo with the
 * pitch (three benefits, three stats) on the left, the form on the
 * right. The form asks for the four basics (name, store name, email,
 * phone), validated with lib/authValidation, and POSTs /auth/register;
 * the verification email then takes the seller to /seller/verify to set
 * a password. The success state keeps Resend and "use a different
 * address".
 */

import { useState } from 'react';
import Link from 'next/link';
import { authCardClass, authFormClass, authHeadlineClass, authPanelClass } from '@/components/common/authFrame';
import Image from 'next/image';
import { Button } from '@heroui/react';
import Arrow from '@/components/common/Arrow';
import { FormField, FormInput, MailIcon, UserIcon, digitsOnlyKeyDown } from '@/components/common/FormField';
import { api, unwrap } from '@/lib/api';
import { sellerContentUrl } from '@/lib/sellerUrl';
import { notifyError, notifySuccess } from '@/lib/notify';
import { M } from '@/lib/messages';
import { phoneDigits, validateEmail, validateName, validatePhone } from '@/lib/authValidation';

const BENEFITS = [
  { title: 'Reach 10,000+ riders monthly', body: 'Discoverable across Shop by Bike, category rails and brand pages.' },
  { title: 'Zero listing fees, low commission', body: 'Pay only when you sell. Rates built for bike parts and gear.' },
  { title: 'Shipping built in', body: 'Labels, courier comparison and tracking, all from your dashboard.' },
];

const STATS = [
  { value: '2 min', label: 'to set up' },
  { value: '0%', label: 'listing fee' },
  { value: '₹0', label: 'setup cost' },
];

type Field = 'name' | 'storeName' | 'email' | 'phone';

const StoreIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 9l1.5-5h15L21 9" /><path d="M3 9h18v3a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z" /><path d="M5 14v6h14v-6" />
  </svg>
);

export default function SellerRegisterPage() {
  const [form, setForm] = useState<Record<Field, string>>({ name: '', storeName: '', email: '', phone: '' });
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const errors: Record<Field, string> = {
    name: validateName(form.name),
    storeName: form.storeName.trim().length < 2 ? 'Enter your store name.' : '',
    email: validateEmail(form.email),
    // Required here, unlike the customer form: the courier needs it.
    phone: !form.phone ? 'Enter your mobile number.' : validatePhone(form.phone),
  };
  // Format errors once a field is left with something in it; "required"
  // only after a submit attempt.
  const show = (f: Field) => (submitted || (touched[f] && form[f])) && errors[f] ? errors[f] : '';
  const touch = (f: Field) => () => setTouched((t) => ({ ...t, [f]: true }));
  const update = (k: Field, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    const firstInvalid = (Object.keys(errors) as Field[]).find((k) => errors[k]);
    if (firstInvalid) {
      (e.currentTarget as HTMLFormElement).querySelector<HTMLInputElement>(`[name="${firstInvalid}"]`)?.focus();
      return;
    }
    setLoading(true);
    try {
      const payload = { name: form.name.trim(), storeName: form.storeName.trim(), email: form.email.trim(), phone: form.phone };
      const data = unwrap<any>(await api.post('/auth/register', payload));
      setSentTo(data.email || payload.email);
      notifySuccess(M.sellerRegister.verificationLinkSent(data.email || payload.email));
    } catch (e: any) {
      notifyError(e, M.sellerRegister.couldntCreateTheAccount);
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    if (!sentTo) return;
    try {
      await api.post('/auth/resend-verification', { email: sentTo });
      notifySuccess(M.sellerRegister.sentAnotherLink);
    } catch (e: any) {
      notifyError(e, M.sellerRegister.couldntResend);
    }
  }

  /* No min-h-screen: under the seller layout's header + footer it painted
     a viewport-tall white band above the footer. */
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
              Sell on THROTTLEIN
            </div>
            <h1 className={`mt-3 ${authHeadlineClass}`}>
              Sell to riders
              <br />
              who care.
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

        {/* ── Form / success ──────────────────────────────────────── */}
        <section className={authFormClass}>
          {sentTo ? (
            <SuccessState sentTo={sentTo} onResend={resend} onChangeEmail={() => setSentTo(null)} />
          ) : (
            <>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9b9b9b]">Step 1 of 2</div>
              <h2 className="mt-2 text-2xl font-bold leading-tight text-brand-black">Create your seller account</h2>
              <p className="mt-1 text-sm text-[#6b6b6b]">We&rsquo;ll email you a link to verify your address and set a password.</p>

              <form onSubmit={submit} noValidate className="mt-7 flex flex-col gap-5">
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <FormField label="Full name" required error={show('name')}>
                    <FormInput
                      name="name"
                      autoFocus
                      autoComplete="name"
                      icon={<UserIcon />}
                      invalid={!!show('name')}
                      value={form.name}
                      onChange={(e) => update('name', e.target.value)}
                      onBlur={touch('name')}
                    />
                  </FormField>
                  <FormField label="Store name" required error={show('storeName')}>
                    <FormInput
                      name="storeName"
                      autoComplete="organization"
                      icon={<StoreIcon />}
                      invalid={!!show('storeName')}
                      value={form.storeName}
                      onChange={(e) => update('storeName', e.target.value)}
                      onBlur={touch('storeName')}
                    />
                  </FormField>
                </div>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <FormField label="Email address" required error={show('email')}>
                    <FormInput
                      name="email"
                      type="email"
                      autoComplete="email"
                      inputMode="email"
                      icon={<MailIcon />}
                      invalid={!!show('email')}
                      value={form.email}
                      onChange={(e) => update('email', e.target.value)}
                      onBlur={touch('email')}
                    />
                  </FormField>
                  <FormField label="Mobile number" required error={show('phone')} hint={show('phone') ? undefined : 'Couriers call this number for pickups'}>
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

                <Button
                  type="submit"
                  size="lg"
                  isLoading={loading}
                  className="group mt-1 h-11 rounded-[10px] bg-brand-black text-sm font-semibold text-white hover:bg-[#2b2b2b]"
                  endContent={!loading && <Arrow className="transition-transform group-hover:translate-x-0.5" />}
                >
                  Send verification link
                </Button>

                <p className="-mt-1 text-center text-[11px] leading-relaxed text-[#8a8a8a]">
                  By continuing you confirm you&rsquo;ve read the{' '}
                  <Link href={sellerContentUrl('/seller-privacy-policy')} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-black hover:underline">Privacy Policy</Link>
                  {' '}and agree to the{' '}
                  <Link href={sellerContentUrl('/seller-terms')} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-black hover:underline">Seller Terms</Link>.
                </p>
              </form>

              <div className="mt-7 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9b9b9b]">
                <span aria-hidden className="h-px flex-1 bg-[#e0e0e0]" />
                Already selling with us?
                <span aria-hidden className="h-px flex-1 bg-[#e0e0e0]" />
              </div>
              <Link
                href="/seller/login"
                className="mt-4 inline-flex h-11 items-center justify-center gap-2 rounded-[10px] border border-brand-black text-sm font-semibold text-brand-black transition hover:bg-brand-black hover:text-white"
              >
                Sign in
              </Link>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/* ───────────────────────── Success state ───────────────────────── */

function SuccessState({ sentTo, onResend, onChangeEmail }: { sentTo: string; onResend: () => void; onChangeEmail: () => void }) {
  return (
    <div>
      <span className="grid h-12 w-12 place-items-center rounded-full bg-brand-lime text-brand-black" aria-hidden>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
      </span>
      <div className="mt-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9b9b9b]">Step 1 of 2 done</div>
      <h2 className="mt-2 text-2xl font-bold leading-tight text-brand-black">Check your inbox</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-[#6b6b6b]">
        We sent a verification link to <strong className="break-all text-brand-black">{sentTo}</strong>. Open it to confirm your address and set your password. The link works for 48 hours.
      </p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Link
          href="/seller/login"
          className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-[10px] bg-brand-black px-5 text-sm font-semibold text-white transition hover:bg-[#2b2b2b]"
        >
          Back to sign in <Arrow />
        </Link>
        <button
          type="button"
          onClick={onResend}
          className="inline-flex h-11 flex-1 items-center justify-center rounded-[10px] border border-brand-black px-5 text-sm font-semibold text-brand-black transition hover:bg-brand-black hover:text-white"
        >
          Resend link
        </button>
      </div>
      <p className="mt-5 text-xs text-[#8a8a8a]">
        Didn&rsquo;t get it? Check your spam folder.{' '}
        Wrong email?{' '}
        <button type="button" onClick={onChangeEmail} className="font-semibold text-brand-black underline-offset-2 hover:underline">
          Use a different address
        </button>
        .
      </p>
    </div>
  );
}
