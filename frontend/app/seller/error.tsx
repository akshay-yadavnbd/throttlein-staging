'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { sellerUrl } from '@/lib/sellerUrl';
import { reloadIfRecoverable, reportClientError } from '@/lib/errorRecovery';

/**
 * Error boundary for the SELLER property.
 *
 * Without this file a throw anywhere under /seller/** bubbles to
 * `app/error.tsx`, which has two problems on this property:
 *
 *   1. It replaces the whole route, so SellerHeader and SellerFooter go
 *      with it — the visitor lands on an unbranded page that looks like
 *      it belongs to a different site.
 *   2. Its "Back to home" points at `/`. On seller.throttlein.com that
 *      happens to be the Seller Hub landing page, but the label reads as
 *      the storefront, and in local dev `/` really is the storefront.
 *
 * A segment-scoped boundary keeps the seller chrome (the layout renders
 * outside it) and sends people somewhere that exists.
 *
 * ── ON DIAGNOSING WHAT LANDED HERE ────────────────────────────────
 * `digest` is set by Next only for errors thrown while rendering on the
 * SERVER. If it's absent, the throw happened during client render or
 * hydration — which in development is most often a partially-applied
 * Turbopack module graph after an edit, and clears on a full reload. That
 * distinction is worth keeping in mind before hunting for a data bug: it
 * is the difference between "the API failed" and "HMR was mid-flight".
 */
export default function SellerError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Tagged so seller failures are greppable separately from the
    // storefront's — the two properties have different owners.
    // eslint-disable-next-line no-console
    console.error('[seller route error boundary]', {
      message: error?.message,
      digest: error?.digest,
      // Absent digest ⇒ client-side throw. See the note above.
      origin: error?.digest ? 'server' : 'client',
      path: typeof window !== 'undefined' ? window.location.pathname : '',
    });
    reportClientError(error, 'seller');
    reloadIfRecoverable(error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-6 py-16 bg-white">
      <div className="max-w-md text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-[#F3F4F2] mb-4">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-6 h-6 text-[#575757]"
            aria-hidden
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h1 className="font-poppins text-2xl font-semibold text-[#141414] mb-2">
          Something went wrong
        </h1>
        <p className="font-poppins text-sm text-[#575757] mb-6">
          We couldn&rsquo;t load this page. It&rsquo;s usually a one-off &mdash;
          try again, and if it keeps happening email{' '}
          <a
            href="mailto:support@throttlein.com"
            className="text-[#141414] font-semibold underline-offset-2 hover:underline"
          >
            support@throttlein.com
          </a>
          .
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl bg-black text-white text-sm font-semibold hover:bg-[#212121] transition"
          >
            Try again
          </button>
          {/* Seller Hub home, not the storefront root. */}
          <Link
            href={sellerUrl('/')}
            className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl border border-[#bdbdbd] text-[#212121] text-sm font-semibold hover:bg-[#f5f5f5] transition"
          >
            Back to Seller Hub
          </Link>
          <Link
            href={sellerUrl('/sell-online')}
            className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl text-[#575757] text-sm font-medium hover:text-[#141414] transition"
          >
            How selling works
          </Link>
        </div>
        {error?.digest && (
          <p className="mt-6 text-[11px] text-[#8a8a8a] font-mono">
            Reference: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
