'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Button from '@/components/common/SellerButton';
import Arrow from '@/components/common/Arrow';
import styles from './error.module.css';
import { reloadIfRecoverable, reportClientError } from '@/lib/errorRecovery';

/**
 * Error boundary for the seller DASHBOARD.
 *
 * Without this file a throw under /dashboard/** bubbles to `app/error.tsx`,
 * which replaces the whole route: the sidebar and account bar vanish and
 * "Back to home" sends the seller to the storefront. A segment-scoped
 * boundary keeps the workspace chrome (the layout renders outside it) and
 * offers the two things a seller actually wants here: try the page again,
 * or go back to a screen that works.
 *
 * `digest` is set by Next only for errors thrown while rendering on the
 * server. Without it the throw happened during client render, which in
 * development is most often a half-applied HMR update that a full reload
 * clears, so the page offers a reload as well.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [showDetail, setShowDetail] = useState(false);

  useEffect(() => {
    console.error('[dashboard route error boundary]', {
      message: error?.message,
      digest: error?.digest,
      origin: error?.digest ? 'server' : 'client',
      path: typeof window !== 'undefined' ? window.location.pathname : '',
    });
    reportClientError(error, 'dashboard');
    reloadIfRecoverable(error);
  }, [error]);

  const reference = error?.digest || '';
  const subject = encodeURIComponent(`Seller dashboard error${reference ? ` (ref ${reference})` : ''}`);
  const body = encodeURIComponent(
    `Hi,\n\nI hit "Something went wrong" on ${typeof window !== 'undefined' ? window.location.href : 'the seller dashboard'}.${reference ? `\nReference: ${reference}` : ''}\n\nWhat I was doing:\n`,
  );

  return (
    <div className={styles.wrap} role="alert">
      <div className={styles.panel}>
        <span className={styles.icon} aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <path d="M12 9v4M12 17h.01" />
          </svg>
        </span>
        <div className={styles.eyebrow}>This page hit a problem</div>
        <h1>Something went wrong</h1>
        <p>
          The rest of your workspace is fine. This is usually a one-off: try the page again first.
          If it keeps happening, reload the browser tab, and if that doesn&rsquo;t help, write to us and
          we&rsquo;ll look into it.
        </p>
        <div className={styles.actions}>
          <Button color="primary" onPress={() => reset()}>Try again</Button>
          <Button variant="bordered" onPress={() => window.location.reload()}>Reload the page</Button>
          <Link href="/dashboard" className={styles.link}>Back to overview <Arrow /></Link>
        </div>
        <div className={styles.foot}>
          <a href={`mailto:support@throttlein.com?subject=${subject}&body=${body}`} className={styles.link}>
            Email support
          </a>
          {reference && <span>Reference <code>{reference}</code></span>}
          {error?.message && (
            <button type="button" className={styles.link} onClick={() => setShowDetail((v) => !v)} aria-expanded={showDetail}>
              {showDetail ? 'Hide details' : 'Show details'}
            </button>
          )}
        </div>
        {showDetail && error?.message && (
          <pre className={styles.detail}>{error.message}</pre>
        )}
      </div>
    </div>
  );
}
