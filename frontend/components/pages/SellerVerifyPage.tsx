'use client';

/**
 * Seller verify page — `/seller/verify/<token>`, opened from the
 * registration email.
 *
 * Same split card as the seller login and register pages, under the
 * seller layout's chrome. Left: "One last step" with the three
 * onboarding milestones that follow. Right: the verification state and
 * the password form (shared inputs, lib/authValidation rules, strength
 * meter).
 *
 * State machine is unchanged:
 *   checking → ready → saving → done
 *                ↘ invalid (token expired / not found / network error)
 *
 * On success: stores token+user via setStoredUser, then router.replace
 * to /dashboard after a brief delay so the toast reads.
 */

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Spinner } from '@heroui/react';
import Arrow from '@/components/common/Arrow';
import { api, unwrap } from '@/lib/api';
import { setStoredUser } from '@/lib/auth';
import { FormField, FormPasswordInput, LockIcon } from '@/components/common/FormField';
import { notifyError, notifySuccess, apiMessage } from '@/lib/notify';
import { M } from '@/lib/messages';
import { PASSWORD_MIN, passwordStrength, validateConfirm, validatePassword } from '@/lib/authValidation';

type Stage = 'checking' | 'invalid' | 'ready' | 'saving' | 'done';

/** The three onboarding milestones after this one. */
const NEXT_STEPS = [
  { label: 'KYC verification', body: 'PAN, GST and bank details, so payouts can start.' },
  { label: 'List your first product', body: 'Photos, stock and pricing from the dashboard.' },
  { label: 'Start receiving orders', body: 'Confirm orders, print labels, get paid.' },
];

export default function SellerVerifyPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const router = useRouter();

  const [stage, setStage] = useState<Stage>('checking');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [preview, setPreview] = useState<{ name?: string; email?: string; storeName?: string } | null>(null);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState({ pw: false, cf: false });
  const [submitted, setSubmitted] = useState(false);

  const passwordError = validatePassword(password);
  const confirmError = validateConfirm(password, confirm);
  // Format errors once a field is left with something in it; "required"
  // only after a submit attempt.
  const showPasswordError = (submitted || (touched.pw && password)) ? passwordError : '';
  const showConfirmError = (submitted || (touched.cf && confirm)) ? confirmError : '';
  const strength = passwordStrength(password);

  // Validate the token on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = unwrap<any>(await api.get(`/auth/verify-email/${token}`, { timeout: 12000 }));
        if (cancelled) return;
        setPreview(data.user || null);
        setStage('ready');
      } catch (e: any) {
        if (cancelled) return;
        console.error('[verify-email]', {
          status: e?.response?.status,
          data: e?.response?.data,
          message: e?.message,
          code: e?.code,
        });
        // Server/network wording comes from apiMessage; a plain rejection
        // means the link itself is bad.
        setErrorMsg(apiMessage(e) || 'This link is invalid or has expired.');
        setStage('invalid');
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (passwordError || confirmError) {
      (e.currentTarget as HTMLFormElement).querySelector<HTMLInputElement>(passwordError ? '[name="password"]' : '[name="confirm"]')?.focus();
      return;
    }
    setStage('saving');
    try {
      const data = unwrap<any>(await api.post('/auth/set-password', { token, password }));
      setStoredUser(data.token, data.user);
      setStage('done');
      notifySuccess(M.sellerVerify.yourAccountIsReady);
      setTimeout(() => router.replace('/dashboard'), 700);
    } catch (e: any) {
      notifyError(e, M.sellerVerify.couldntSetPassword);
      setStage('ready');
    }
  }

  /* No min-h-screen: under the seller layout's header + footer it painted
     a viewport-tall white band above the footer. */
  return (
    <div className="bg-brand-cream px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto grid w-full max-w-[1040px] overflow-hidden rounded-2xl border border-[#dfe3d8] bg-white shadow-[0_24px_60px_-30px_rgba(20,20,20,0.35)] lg:grid-cols-[1fr_1fr]">
        {/* ── Brand panel ─────────────────────────────────────────── */}
        <aside className="relative flex flex-col justify-between overflow-hidden bg-brand-black p-7 text-white sm:p-9 lg:min-h-[560px] lg:p-12">
          <img
            src="/images/home-banner-img.webp"
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-24 -right-20 w-[340px] select-none opacity-[0.14] lg:-bottom-28 lg:-right-24 lg:w-[460px] lg:opacity-20"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.05]"
            style={{ backgroundImage: 'repeating-linear-gradient(45deg, #fff 0 1px, transparent 1px 18px)' }}
          />
          <div className="relative">
            <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-brand-lime">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand-lime" />
              Seller onboarding
            </div>
            <h1 className="mt-4 text-[28px] font-bold leading-[1.08] tracking-tight sm:text-4xl lg:text-[42px]">
              One last step
              <br />
              to your dashboard.
            </h1>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/70 lg:text-[15px]">
              Set a password for your seller account. Then KYC, your first product and your first order, in that order.
            </p>
          </div>
          <ol className="relative mt-8 hidden flex-col gap-4 lg:flex">
            {NEXT_STEPS.map((s, i) => (
              <li key={s.label} className="flex items-start gap-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/25 bg-white/10 text-[12px] font-bold text-white" aria-hidden>
                  {i + 2}
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-bold leading-tight">{s.label}</div>
                  <div className="mt-0.5 text-xs leading-relaxed text-white/70">{s.body}</div>
                </div>
              </li>
            ))}
          </ol>
          <div className="relative mt-8 hidden text-[12px] text-white/55 lg:block">
            Need help?{' '}
            <a href="mailto:info@throttlein.com" className="font-semibold text-white/85 transition hover:text-brand-lime">info@throttlein.com</a>
          </div>
        </aside>

        {/* ── State + form ────────────────────────────────────────── */}
        <section className="flex flex-col justify-center p-6 sm:p-10 lg:p-12">
          {stage === 'checking' && (
            <div className="flex flex-col items-center py-16 text-center">
              <Spinner size="md" />
              <div className="mt-4 text-sm text-[#6b6b6b]">Checking your link…</div>
            </div>
          )}

          {stage === 'invalid' && (
            <div>
              <span className="grid h-12 w-12 place-items-center rounded-full bg-[#fde3e3] text-[#a63737]" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
              </span>
              <div className="mt-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#a63737]">Link issue</div>
              <h2 className="mt-2 text-2xl font-bold leading-tight text-brand-black">This link no longer works</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-[#6b6b6b]">{errorMsg}</p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/seller/register"
                  className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-[10px] bg-brand-black px-5 text-sm font-semibold text-white transition hover:bg-[#2b2b2b]"
                >
                  Sign up again <Arrow />
                </Link>
                <Link
                  href="/seller/login"
                  className="inline-flex h-11 flex-1 items-center justify-center rounded-[10px] border border-brand-black px-5 text-sm font-semibold text-brand-black transition hover:bg-brand-black hover:text-white"
                >
                  Back to sign in
                </Link>
              </div>
            </div>
          )}

          {(stage === 'ready' || stage === 'saving') && (
            <>
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-[#d3e2ad] bg-[#f6f9ee] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#536635]">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3" aria-hidden><polyline points="20 6 9 17 4 12" /></svg>
                Email verified
              </div>
              <h2 className="mt-4 text-2xl font-bold leading-tight text-brand-black">Set your password</h2>
              {preview?.email && (
                <p className="mt-1.5 text-sm leading-relaxed text-[#6b6b6b]">
                  For <strong className="break-all text-brand-black">{preview.email}</strong>
                  {preview.storeName ? <> · <strong className="text-brand-black">{preview.storeName}</strong></> : null}
                </p>
              )}

              <form onSubmit={submit} noValidate className="mt-7 flex flex-col gap-5">
                <FormField
                  label="New password"
                  required
                  error={showPasswordError}
                  hint={showPasswordError ? undefined : <StrengthHint value={password} score={strength.score} label={strength.label} />}
                >
                  <FormPasswordInput
                    name="password"
                    required
                    autoFocus
                    autoComplete="new-password"
                    minLength={PASSWORD_MIN}
                    icon={<LockIcon />}
                    invalid={!!showPasswordError}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onBlur={() => setTouched((t) => ({ ...t, pw: true }))}
                  />
                </FormField>
                <FormField label="Confirm password" required error={showConfirmError}>
                  <FormPasswordInput
                    name="confirm"
                    required
                    autoComplete="new-password"
                    icon={<LockIcon />}
                    invalid={!!showConfirmError}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    onBlur={() => setTouched((t) => ({ ...t, cf: true }))}
                  />
                </FormField>
                <Button
                  type="submit"
                  size="lg"
                  isLoading={stage === 'saving'}
                  className="group h-11 rounded-[10px] bg-brand-black text-sm font-semibold text-white hover:bg-[#2b2b2b]"
                  endContent={stage !== 'saving' && <Arrow className="transition-transform group-hover:translate-x-0.5" />}
                >
                  Set password and continue
                </Button>
                <p className="text-center text-[11px] text-[#8a8a8a]">By continuing you agree to the THROTTLEIN seller terms.</p>
              </form>
            </>
          )}

          {stage === 'done' && (
            <div>
              <span className="grid h-12 w-12 place-items-center rounded-full bg-brand-lime text-brand-black" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><polyline points="20 6 9 17 4 12" /></svg>
              </span>
              <div className="mt-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#536635]">All set</div>
              <h2 className="mt-2 text-2xl font-bold leading-tight text-brand-black">You&rsquo;re in.</h2>
              <p className="mt-1.5 text-sm text-[#6b6b6b]">Taking you to your dashboard&hellip;</p>
            </div>
          )}
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
