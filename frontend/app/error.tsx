'use client';

/**
 * Root error boundary. Next.js wraps every route segment in this
 * component — when a render or hydration error escapes the segment
 * boundaries (for the storefront, one inside the layout itself: navbar,
 * footer, providers), this UI takes over instead of the framework's
 * blank "Application error" screen.
 *
 * Because the layout that normally draws the navbar may be the thing
 * that failed, this page carries its own minimal logo bar, then the
 * same ErrorPanel the storefront segment boundary uses.
 */

import { useEffect } from 'react';
import Link from 'next/link';
import ErrorPanel from '@/components/common/ErrorPanel';
import { reloadIfRecoverable, reportClientError } from '@/lib/errorRecovery';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Quietly log so the error is recoverable from user reports. For
    // production builds Next.js masks the message server-side; only the
    // digest comes through.
    console.error('[route error boundary]', error);
    reportClientError(error, 'root');
    reloadIfRecoverable(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col bg-brand-cream">
      <header className="border-b border-[#e3e6de] bg-white">
        <div className="mx-auto flex h-[64px] max-w-[1440px] items-center justify-between px-4 sm:px-6">
          <Link href="/" aria-label="THROTTLEIN home" className="inline-flex items-center">
            <img src="/images/throttlein-logo.webp" alt="THROTTLEIN" className="h-7 w-auto" />
          </Link>
          <Link href="/products" className="text-sm font-medium text-[#212121] hover:underline">
            Browse products
          </Link>
        </div>
      </header>
      <div className="flex flex-1 items-center">
        <div className="w-full">
          <ErrorPanel error={error} reset={reset} />
        </div>
      </div>
    </div>
  );
}
