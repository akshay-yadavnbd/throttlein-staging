'use client';

/**
 * Contact Us page — `/contact`
 *
 * Layout:
 *   1. Breadcrumb strip (shared), then a hero: the riding photo with a
 *      dark left-to-right gradient, eyebrow + "Contact Us" headline +
 *      tagline, and two facts (reply time, phone hours).
 *   2. Two-column body:
 *      - LEFT: the message form — name, email + phone, what it's about
 *        (chips), message, one black "Send message" button. Fields use
 *        the shared FormField inputs and lib/authValidation, so they
 *        look and validate like the auth forms. Posts to /api/contact,
 *        which emails the support inbox and a confirmation to the sender.
 *      - RIGHT (sticky on lg): the direct channels — call, email, visit —
 *        and the social links.
 *   3. "Quick answers" strip: FAQs, order tracking, selling.
 *
 * Header + footer come from the storefront layout.
 */

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { API_URL } from '@/lib/api';
import Breadcrumbs from '@/components/common/Breadcrumbs';
import Arrow from '@/components/common/Arrow';
import { FormField, FormInput, FormTextarea, MailIcon, UserIcon, digitsOnlyKeyDown } from '@/components/common/FormField';
import { phoneDigits, validateEmail, validateName, validatePhone } from '@/lib/authValidation';

const PHONE_DISPLAY = '+91-9599888940';
const PHONE_TEL = '+919599888940';
const EMAIL = 'info@throttlein.com';
const ADDRESS = 'TS 1201, Office Tower, Galaxy Blue Sapphire Plaza, Sector 4, Greater Noida, Uttar Pradesh 201016';
// THROTTLEIN's own Google Maps listing, by its place URL. An address
// search used to open a results list with every business in the plaza;
// this opens that one pin.
const MAPS_URL = 'https://www.google.com/maps/place/Throttlein/@28.6072697,77.4328687,17z/data=!3m1!4b1!4m6!3m5!1s0x390cef197410e6af:0x86da936ca34a34f8!8m2!3d28.6072697!4d77.4354436!16s%2Fg%2F11zcr4wlfm';

const TOPICS = ['An order', 'Return or refund', 'Payment', 'Seller account', 'Something else'] as const;
type Topic = (typeof TOPICS)[number];

type Field = 'fullName' | 'email' | 'phone' | 'message';
type FormState = Record<Field, string>;
const EMPTY_FORM: FormState = { fullName: '', email: '', phone: '', message: '' };

export default function ContactPage() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [topic, setTopic] = useState<Topic | ''>('');
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'success'; message: string }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  const errors: FormState = {
    fullName: validateName(form.fullName),
    email: validateEmail(form.email),
    phone: validatePhone(form.phone),
    message: form.message.trim().length < 10 ? 'Tell us a little more (at least 10 characters).' : '',
  };
  // Format errors once a field is left with something in it; "required"
  // only after a submit attempt.
  const show = (f: Field) => (submitted || (touched[f] && form[f])) && errors[f] ? errors[f] : '';
  const touch = (f: Field) => () => setTouched((t) => ({ ...t, [f]: true }));

  function patch(key: Field, value: string) {
    setForm((s) => ({ ...s, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    const firstInvalid = (Object.keys(errors) as Field[]).find((k) => errors[k]);
    if (firstInvalid) {
      (e.currentTarget as HTMLFormElement).querySelector<HTMLElement>(`[name="${firstInvalid}"]`)?.focus();
      return;
    }
    setSubmitting(true);
    setStatus({ kind: 'idle' });
    try {
      const r = await fetch(`${API_URL}/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: form.fullName.trim(),
          email: form.email.trim(),
          phone: form.phone.replace(/[\s\-().]/g, ''),
          // The topic travels at the top of the message: the endpoint
          // has no field for it, and support reads it first anyway.
          message: (topic ? `Topic: ${topic}\n\n` : '') + form.message.trim(),
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => null);
        throw new Error(d?.message || `Request failed (${r.status})`);
      }
      setStatus({
        kind: 'success',
        message: "Thanks — your message is on its way. We'll reply within 24 business hours, and a copy is in your inbox.",
      });
      setForm(EMPTY_FORM);
      setTopic('');
      setTouched({});
      setSubmitted(false);
    } catch (err: any) {
      setStatus({ kind: 'error', message: err?.message || 'Could not send. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-white text-[#141414]">
      <Breadcrumbs items={[{ label: 'Contact Us' }]} />

      {/* ─── Hero ─────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-brand-black text-white">
        <Image
          src="/contact/hero-banner.webp"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-[70%_center]"
        />
        <div
          aria-hidden
          className="absolute inset-0"
          style={{ backgroundImage: 'linear-gradient(90deg, rgba(20,20,20,0.96) 0%, rgba(20,20,20,0.85) 38%, rgba(20,20,20,0.45) 62%, rgba(20,20,20,0.15) 100%)' }}
        />
        <div className="container relative py-14 sm:py-16 lg:py-20">
          <div className="max-w-xl">
            <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-brand-lime">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand-lime" />
              Support
            </div>
            <h1 className="mt-3 text-[34px] font-bold leading-[1.08] tracking-tight sm:text-5xl">Contact Us</h1>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-white/75 sm:text-base">
              Orders, returns, payments, seller accounts: tell us what&rsquo;s up and a real person will get back to you.
            </p>
            <div className="mt-6 flex flex-wrap gap-2.5">
              <Fact>Replies within 24 business hours</Fact>
              <Fact>Phones Mon–Fri, 9 AM–6 PM IST</Fact>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Form + direct channels ───────────────────────────── */}
      <section className="container py-10 lg:py-14">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-8">
          <div className="rounded-2xl border border-[#e5e5e5] bg-white p-6 sm:p-8">
            <h2 className="text-xl font-bold leading-tight">Send us a message</h2>
            <p className="mt-1 text-sm text-[#6b6b6b]">Name and email are all we need to reply. Add an order number if you have one.</p>

            <form onSubmit={onSubmit} noValidate className="mt-6 flex flex-col gap-5">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <FormField label="Full name" required error={show('fullName')}>
                  <FormInput
                    name="fullName"
                    autoComplete="name"
                    icon={<UserIcon />}
                    invalid={!!show('fullName')}
                    value={form.fullName}
                    onChange={(e) => patch('fullName', e.target.value)}
                    onBlur={touch('fullName')}
                  />
                </FormField>
                <FormField label="Email address" required error={show('email')}>
                  <FormInput
                    name="email"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    icon={<MailIcon />}
                    invalid={!!show('email')}
                    value={form.email}
                    onChange={(e) => patch('email', e.target.value)}
                    onBlur={touch('email')}
                  />
                </FormField>
              </div>

              <FormField label="Phone number" error={show('phone')} hint={show('phone') ? undefined : 'Optional · only if you’d like a call back'}>
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
                  onChange={(e) => patch('phone', phoneDigits(e.target.value))}
                  onBlur={touch('phone')}
                />
              </FormField>

              {/* Topic chips: one tap to tell support where to route it. */}
              <div className="flex flex-col gap-2">
                <span className="text-sm font-semibold text-[#000]">What is it about?</span>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Topic">
                  {TOPICS.map((t) => {
                    const on = topic === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setTopic(on ? '' : t)}
                        className={`h-9 rounded-full border px-3.5 text-[13px] font-medium transition ${on ? 'border-brand-black bg-brand-black text-white' : 'border-[#d6d6d6] bg-white text-[#212121] hover:border-[#141414]'}`}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>
              </div>

              <FormField label="Message" required error={show('message')}>
                <FormTextarea
                  name="message"
                  rows={6}
                  placeholder="What happened, and how can we help? Include an order number if you have one."
                  invalid={!!show('message')}
                  value={form.message}
                  onChange={(e) => patch('message', e.target.value)}
                  onBlur={touch('message')}
                  className="min-h-[150px] resize-y"
                />
              </FormField>

              {status.kind === 'success' && (
                <div role="status" className="flex items-start gap-3 rounded-xl border border-[#d3e2ad] bg-[#f6f9ee] p-4">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-lime text-brand-black" aria-hidden>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><polyline points="20 6 9 17 4 12" /></svg>
                  </span>
                  <p className="text-sm leading-relaxed text-[#3c4a2b]">{status.message}</p>
                </div>
              )}
              {status.kind === 'error' && (
                <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-red-100 text-red-700" aria-hidden>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
                  </span>
                  <p className="text-sm leading-relaxed text-red-900">{status.message}</p>
                </div>
              )}

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="submit"
                  disabled={submitting}
                  className="group inline-flex h-11 items-center justify-center gap-2 rounded-[10px] bg-brand-black px-6 text-sm font-semibold text-white transition hover:bg-[#2b2b2b] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? 'Sending…' : 'Send message'}
                  {!submitting && <Arrow className="transition-transform group-hover:translate-x-0.5" />}
                </button>
                <p className="text-xs leading-relaxed text-[#8a8a8a]">
                  You&rsquo;ll get a confirmation email straight away.
                </p>
              </div>
            </form>
          </div>

          <aside className="flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
            <Channel
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" /></svg>}
              title="Call us"
              body="Monday to Friday, 9 AM to 6 PM IST."
            >
              <a href={`tel:${PHONE_TEL}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-black underline-offset-4 hover:underline">
                {PHONE_DISPLAY}
              </a>
            </Channel>
            <Channel
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>}
              title="Email us"
              body="For anything that needs attachments or a paper trail."
            >
              <a href={`mailto:${EMAIL}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-black underline-offset-4 hover:underline">
                {EMAIL}
              </a>
            </Channel>
            <Channel
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" /></svg>}
              title="Visit us"
              body={ADDRESS}
            >
              <a href={MAPS_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-black underline-offset-4 hover:underline">
                Open in Maps <Arrow dir="up-right" />
              </a>
            </Channel>

            <div className="flex items-center justify-between gap-4 rounded-2xl border border-[#e5e5e5] bg-[#fafafa] px-5 py-4">
              <span className="text-sm font-semibold">Follow us</span>
              <div className="flex items-center gap-1">
                <SocialLink href="https://www.instagram.com/throttlein_india" label="Instagram"><InstagramIcon /></SocialLink>
                <SocialLink href="https://www.facebook.com/throttleinmarketplace/" label="Facebook"><FacebookIcon /></SocialLink>
                <SocialLink href="https://www.linkedin.com/company/throttlein/" label="LinkedIn"><LinkedInIcon /></SocialLink>
              </div>
            </div>
          </aside>
        </div>
      </section>

      {/* ─── Quick answers ────────────────────────────────────── */}
      <section className="container pb-14 lg:pb-20">
        <div className="rounded-2xl bg-brand-cream p-6 sm:p-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold leading-tight">Looking for a quick answer?</h2>
              <p className="mt-1 text-sm text-[#6b6b6b]">Most questions are already covered here.</p>
            </div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <QuickLink href="/faqs" title="Read the FAQs" body="Shipping times, returns, payments and more." />
            <QuickLink href="/account" title="Track an order" body="Sign in to see live courier updates for every order." />
            <QuickLink href="/seller" title="Sell on THROTTLEIN" body="Open a seller account or get help with an existing one." external />
          </div>
        </div>
      </section>
    </div>
  );
}

/* ─── Small UI pieces ─── */

function Fact({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-medium text-white/90 backdrop-blur-sm">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand-lime" />
      {children}
    </span>
  );
}

function Channel({ icon, title, body, children }: { icon: React.ReactNode; title: string; body: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 rounded-2xl border border-[#e5e5e5] bg-white p-5">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-cream text-brand-black [&>svg]:h-5 [&>svg]:w-5" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold leading-tight">{title}</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-[#6b6b6b]">{body}</p>
        <div className="mt-2.5">{children}</div>
      </div>
    </div>
  );
}

function QuickLink({ href, title, body, external }: { href: string; title: string; body: string; external?: boolean }) {
  return (
    <Link
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      className="group flex flex-col gap-1 rounded-xl border border-[#e3e6de] bg-white p-4 transition hover:border-brand-black"
    >
      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-black">
        {title} <Arrow dir={external ? 'up-right' : 'right'} className="transition-transform group-hover:translate-x-0.5" />
      </span>
      <span className="text-xs leading-relaxed text-[#6b6b6b]">{body}</span>
    </Link>
  );
}

function SocialLink({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="grid h-9 w-9 place-items-center rounded-lg text-[#141414] transition hover:bg-white hover:shadow-sm"
    >
      {children}
    </a>
  );
}

/* ─── Icons ─── */

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden>
      <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5.02 3.66 9.18 8.44 9.94v-7.03H7.9V12.06h2.54V9.85c0-2.51 1.49-3.9 3.78-3.9 1.1 0 2.24.2 2.24.2v2.47h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.77l-.44 2.91h-2.33V22c4.78-.76 8.43-4.92 8.43-9.94z" />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-[18px] w-[18px]" aria-hidden>
      <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14zM8.337 18.339V9.674H5.671v8.665h2.666zm-1.333-9.86a1.553 1.553 0 1 0 0-3.105 1.553 1.553 0 0 0 0 3.105zm12.001 9.86v-4.749c0-2.473-1.32-3.624-3.082-3.624-1.422 0-2.058.782-2.413 1.331v-1.143h-2.667c.035.751 0 8.665 0 8.665h2.667v-4.838c0-.24.018-.479.088-.65.193-.479.632-.975 1.369-.975.96 0 1.347.73 1.347 1.804v4.659h2.667z" />
    </svg>
  );
}
