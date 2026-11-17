'use client';

/**
 * ErrorPanel — the storefront's "something went wrong" card, shared by
 * the segment boundary (app/(storefront)/error.tsx, which keeps the
 * navbar and footer) and the root boundary (app/error.tsx, which has
 * to draw its own logo bar because the layout itself failed).
 *
 * One card: warning icon, eyebrow, headline, plain next steps (Try
 * again, Back to home, Browse products), an Email support link whose
 * subject and body already carry the page URL and the error reference,
 * the reference itself when Next provides one, and a Show details
 * toggle for the message.
 */

import { useState } from 'react';
import Link from 'next/link';
import Arrow from '@/components/common/Arrow';

export default function ErrorPanel({
  error,
  reset,
  title = 'Something went wrong',
  eyebrow = 'This page hit a problem',
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
  eyebrow?: string;
}) {
  const [showDetail, setShowDetail] = useState(false);
  const reference = error?.digest || '';
  const href = typeof window !== 'undefined' ? window.location.href : 'the site';
  const subject = encodeURIComponent(`Website error${reference ? ` (ref ${reference})` : ''}`);
  const body = encodeURIComponent(
    `Hi,\n\nI hit "Something went wrong" on ${href}.${reference ? `\nReference: ${reference}` : ''}\n\nWhat I was doing:\n`,
  );

  return (
    <div className="flex items-center justify-center px-4 py-12 sm:px-6 sm:py-16">
      <div role="alert" className="w-full max-w-[560px] rounded-2xl border border-[#dfe3d8] bg-white p-7 text-center shadow-[0_24px_60px_-30px_rgba(20,20,20,0.35)] sm:p-9">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#fde3e3] text-[#a63737]" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <path d="M12 9v4M12 17h.01" />
          </svg>
        </span>
        <div className="mt-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8a8a8a]">{eyebrow}</div>
        <h1 className="mt-2 text-[26px] font-bold leading-tight tracking-tight text-brand-black sm:text-3xl">{title}</h1>
        <p className="mx-auto mt-3 max-w-[420px] text-sm leading-relaxed text-[#6b6b6b]">
          Nothing you did caused this. It&rsquo;s usually a one-off: try the page again first, and if it keeps
          happening, reload the tab or write to us.
        </p>

        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={() => reset()}
            className="group inline-flex h-11 items-center justify-center gap-2 rounded-[10px] bg-brand-black px-5 text-sm font-semibold text-white transition hover:bg-[#2b2b2b]"
          >
            Try again
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 transition-transform group-hover:rotate-45" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" />
            </svg>
          </button>
          <Link
            href="/"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-[10px] border border-brand-black px-5 text-sm font-semibold text-brand-black transition hover:bg-brand-black hover:text-white"
          >
            Back to home
          </Link>
          <Link
            href="/products"
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-[10px] px-4 text-sm font-semibold text-[#39434c] transition hover:text-brand-black hover:underline"
          >
            Browse products <Arrow />
          </Link>
        </div>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 border-t border-[#eee] pt-5 text-xs text-[#8a8a8a]">
          <a href={`mailto:support@throttlein.com?subject=${subject}&body=${body}`} className="font-medium text-[#39434c] hover:text-brand-black hover:underline">
            Email support
          </a>
          {reference && (
            <span>
              Reference <code className="rounded bg-[#f1f4f6] px-1.5 py-0.5 font-mono text-[11px] text-[#46525c]">{reference}</code>
            </span>
          )}
          {error?.message && (
            <button
              type="button"
              onClick={() => setShowDetail((v) => !v)}
              aria-expanded={showDetail}
              className="font-medium text-[#39434c] hover:text-brand-black hover:underline"
            >
              {showDetail ? 'Hide details' : 'Show details'}
            </button>
          )}
        </div>
        {showDetail && error?.message && (
          <pre className="mt-4 max-h-40 overflow-auto rounded-lg border border-[#e3e7eb] bg-[#fafbfc] p-3 text-left font-mono text-[11px] leading-relaxed text-[#55616b] whitespace-pre-wrap break-words">
            {error.message}
          </pre>
        )}
      </div>
    </div>
  );
}
