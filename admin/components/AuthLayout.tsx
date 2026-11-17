'use client';

/**
 * The frame of every signed-out admin screen (sign-in, staff sign-in,
 * forgot password): a brand panel beside the form on wide screens, the
 * form alone on phones, and a Local / Staging chip so nobody mistakes a
 * test copy for the live panel (nothing shows on production).
 *
 * Children go in the form column. Shared form styles (title, lead, form,
 * problem, submit, link, footNote…) are exported as `authStyles`.
 */
import { useSyncExternalStore } from 'react';
import Wordmark from '@/components/Wordmark';
import styles from './AuthLayout.module.css';

export { styles as authStyles };

function environmentLabel(): string | null {
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost')) return 'Local';
  if (/(^|[.-])staging([.-]|$)/.test(host)) return 'Staging';
  return null;
}
const noSubscribe = () => () => {};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  // Read from the URL on the client only; the server render shows no chip.
  const environment = useSyncExternalStore(noSubscribe, environmentLabel, () => null);
  return (
    <div className={styles.page}>
      <aside className={styles.brand} aria-hidden="true">
        <Wordmark href={null} variant="dark" height={30} />
        <div className={styles.brandBody}>
          <p className={styles.eyebrow}>Admin console</p>
          <p className={styles.brandTitle}>Everything behind the storefront, in one place.</p>
          <ul className={styles.brandList}>
            <li>Orders, returns and refunds</li>
            <li>Sellers, KYC and payouts</li>
            <li>Catalogue, pages and content</li>
          </ul>
        </div>
        <p className={styles.brandFoot}>© {new Date().getFullYear()} THROTTLEIN</p>
      </aside>

      <main className={styles.formSide}>
        <div className={styles.formWrap}>
          <div className={styles.mobileMark}>
            <Wordmark href={null} variant="light" height={28} />
          </div>
          {environment && (
            <span className={styles.envChip} data-env={environment.toLowerCase()}>
              {environment}
            </span>
          )}
          {children}
        </div>
      </main>
    </div>
  );
}

/** The inline error/notice box under a form, announced to screen readers. */
export function AuthProblem({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.problem} role="alert">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5M12 16.5v.01" />
      </svg>
      <span>{children}</span>
    </div>
  );
}
