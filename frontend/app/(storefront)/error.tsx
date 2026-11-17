'use client';

/**
 * Storefront segment error boundary.
 *
 * A throw inside a storefront PAGE lands here, inside the storefront
 * layout, so the navbar and footer stay up and the customer can still
 * search, open the cart or go anywhere else. (A throw inside the layout
 * itself — navbar, footer — escapes to app/error.tsx, which draws its
 * own logo bar.)
 */

import { useEffect } from 'react';
import ErrorPanel from '@/components/common/ErrorPanel';
import { reloadIfRecoverable, reportClientError } from '@/lib/errorRecovery';

export default function StorefrontError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[storefront route error boundary]', {
      message: error?.message,
      digest: error?.digest,
      origin: error?.digest ? 'server' : 'client',
      path: typeof window !== 'undefined' ? window.location.pathname : '',
    });
    reportClientError(error, 'storefront');
    reloadIfRecoverable(error);
  }, [error]);

  return (
    <div className="min-h-[60vh] bg-brand-cream">
      <ErrorPanel error={error} reset={reset} />
    </div>
  );
}
