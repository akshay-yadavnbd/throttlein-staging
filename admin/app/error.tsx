'use client';

/**
 * Route error boundary. Next.js wraps every page in it — but not the root
 * layout, which is where the persistent AdminFrame lives. So when a page
 * throws while rendering, this panel replaces only the page: the sidebar,
 * header and badge polling stay usable and the admin can retry or move on.
 * Without it, one bad response blanked the entire panel.
 */

import { useEffect } from 'react';
import Link from 'next/link';

export default function ErrorBoundary({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error('[admin route error]', error);
  }, [error]);

  return (
    <div role="alert" className="mx-auto max-w-lg rounded-xl border border-[#e3e7eb] bg-white px-6 py-10 text-center">
      <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-[#fff0f0] text-[#b44848]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-6" aria-hidden>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <h1 className="text-base font-semibold text-[#252c32]">This page couldn&apos;t load</h1>
      <p className="mt-2 text-xs leading-5 text-[#66727c]">
        Something unexpected went wrong while showing this screen. Try again — if it keeps happening,
        the rest of the panel still works from the sidebar.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => retry()}
          className="min-h-9 rounded-[7px] bg-[#191d21] px-4 text-xs font-medium text-white transition hover:bg-[#30383f] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#59656f]"
        >
          Try again
        </button>
        <Link
          href="/dashboard"
          className="inline-flex min-h-9 items-center rounded-[7px] border border-[#dce2e7] px-4 text-xs font-medium text-[#303942] transition hover:bg-[#f6f7f9]"
        >
          Go to dashboard
        </Link>
      </div>
      {error?.digest && <p className="mt-6 font-mono text-[11px] text-[#87919a]">Reference: {error.digest}</p>}
    </div>
  );
}
