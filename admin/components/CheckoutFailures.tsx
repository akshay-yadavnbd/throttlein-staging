'use client';

/**
 * Checkout & payment failures — recorded by the browser, the server and the
 * Razorpay webhook (backend services/checkoutFailures.js), kept 90 days.
 *
 * `compact` is the dashboard panel (5 rows, link to the full list); the full
 * view adds a step filter and paging. Both poll every 30 s; a refresh keeps
 * the current rows on screen instead of blanking the list.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AdminSelect from '@/components/AdminSelect';
import { api, unwrapMeta } from '@/lib/api';
import { formatDateTime, formatTime, formatDayMonth } from '@/lib/dates';
import styles from './CheckoutFailures.module.css';
import { notifySuccess, notifyWarning } from '@/lib/notify';
import { M } from '@/lib/messages';

type Tone = 'neutral' | 'warning' | 'danger';

/** What each step means, and how worried to be about it:
 *  danger  — the payment failed, or money may have moved without an order;
 *  warning — something on our side or in the payment flow broke;
 *  neutral — the customer chose to stop. */
const STEPS: Record<string, { label: string; tone: Tone }> = {
  address:             { label: 'Shipping address',          tone: 'warning' },
  delivery:            { label: 'Delivery quote',            tone: 'warning' },
  checkout_validation: { label: 'Cart validation',           tone: 'warning' },
  payment_init:        { label: 'Payment setup',             tone: 'warning' },
  sdk_load:            { label: 'Payment window didn’t load', tone: 'warning' },
  payment_window:      { label: 'Payment window error',      tone: 'warning' },
  payment_failed:      { label: 'Payment failed',            tone: 'danger' },
  payment_cancelled:   { label: 'Customer cancelled',        tone: 'neutral' },
  payment_verify:      { label: 'Payment check failed',      tone: 'danger' },
  order_finalize:      { label: 'Order not created after payment', tone: 'danger' },
  cod_order:           { label: 'COD order failed',          tone: 'warning' },
};

const SOURCE: Record<string, string> = { browser: 'Reported by the browser', server: 'Server', webhook: 'Razorpay webhook' };

type Failure = {
  _id: string; createdAt: string; user?: { name?: string; email?: string };
  step: string; source: string; message: string; code?: string; paymentMethod: string;
  razorpayOrderId?: string; razorpayPaymentId?: string; attemptId?: string; httpStatus?: number;
};

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (Number.isNaN(mins)) return '';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function copy(value: string, what: string) {
  navigator.clipboard?.writeText(value)
    .then(() => notifySuccess(M.checkoutFailures.copied(what)))
    .catch(() => notifyWarning(M.checkoutFailures.couldntCopySelectItInstead));
}

export default function CheckoutFailures({ compact = false }: { compact?: boolean }) {
  const [rows, setRows] = useState<Failure[] | null>(null);
  const [step, setStep] = useState('');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [revision, setRevision] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const { data, meta } = unwrapMeta<{ items?: any[] }, { totalItems: number; totalPages: number }>(
          await api.get('/admin/checkout-failures', { params: { page, step: step || undefined, limit: compact ? 5 : 25 } }),
        );
        if (!active) return;
        setRows(data.items || []); setPages(meta?.totalPages || 1); setTotal(meta?.totalItems || 0);
        setError(false); setUpdatedAt(new Date());
      } catch {
        if (active) setError(true);
      } finally {
        if (active) setRefreshing(false);
      }
    }
    void load();
    const interval = setInterval(load, 30000);
    return () => { active = false; clearInterval(interval); };
  }, [page, step, compact, revision]);

  const refresh = () => { setRefreshing(true); setRevision((n) => n + 1); };
  const firstLoad = rows === null && !error;

  return (
    <section className={styles.panel} aria-labelledby={compact ? 'failures-heading-compact' : 'failures-heading'}>
      <div className={styles.header}>
        <div>
          <h2 id={compact ? 'failures-heading-compact' : 'failures-heading'}>Checkout &amp; payment failures</h2>
          <p>
            {firstLoad ? 'Loading…' : `${total} event${total === 1 ? '' : 's'} in the last 90 days`}
            {updatedAt && ` · updated ${formatTime(updatedAt)}`}
            {' · '}includes retries that later succeeded
          </p>
        </div>
        <div className={styles.actions}>
          {compact && <Link className={styles.viewAll} href="/orders/checkout-failures">View all <svg {...svg} className={styles.linkArrow}><line x1="5" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" /></svg></Link>}
          <button
            type="button"
            className={`${styles.iconButton} ${refreshing ? styles.spinning : ''}`}
            onClick={refresh}
            disabled={refreshing}
            aria-label="Refresh failures"
            title="Refresh"
          >
            <IconRefresh />
          </button>
        </div>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.legend} aria-hidden>
          <span><i className={styles.dangerDot} />Payment failed or order missing</span>
          <span><i className={styles.warningDot} />Technical issue</span>
          <span><i className={styles.neutralDot} />Customer stopped</span>
        </div>
        {!compact && (
          <AdminSelect
            ariaLabel="Failure step"
            value={step}
            onChange={(v) => { setStep(v); setPage(1); setRefreshing(true); }}
            options={[{ value: '', label: 'All steps' }, ...Object.entries(STEPS).map(([value, s]) => ({ value, label: s.label }))]}
          />
        )}
      </div>

      {error && rows === null ? (
        <div className={styles.error} role="alert">
          <h3>Couldn’t load checkout failures</h3>
          <p>The list is unavailable right now. It retries every 30 seconds, or try now.</p>
          <button type="button" onClick={refresh}>Try again</button>
        </div>
      ) : firstLoad ? (
        <div className={styles.loading} role="status" aria-label="Loading failures"><span /><span /><span /></div>
      ) : rows && rows.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}><IconCheck /></span>
          <h3>{step ? 'No failures at this step' : 'No checkout failures'}</h3>
          <p>{step ? 'Nothing recorded for this step in the last 90 days.' : 'Every checkout in the last 90 days went through, or the customer finished on a retry.'}</p>
        </div>
      ) : rows && (
        <>
          {error && <p className="px-[22px] pb-3 text-[11px] text-[#a3413b]" role="status">Couldn’t refresh — showing the last loaded list.</p>}
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <caption className="sr-only">Checkout and payment failures, newest first</caption>
              <thead>
                <tr><th scope="col">When</th><th scope="col">Customer</th><th scope="col">What failed</th><th scope="col">Details</th><th scope="col">Reference</th></tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row._id}>
                    <td className={styles.when}>
                      <strong title={formatDateTime(row.createdAt)}>{ago(row.createdAt)}</strong>
                      <span className={styles.muted}>{formatDayMonth(row.createdAt)}, {formatTime(row.createdAt)}</span>
                    </td>
                    <td>
                      <span className={styles.customer}>{row.user?.name || 'Deleted account'}</span>
                      {row.user?.email && <span className={styles.muted}>{row.user.email}</span>}
                    </td>
                    <td>
                      <StepChip step={row.step} />
                      <span className={styles.muted}>{paymentLabel(row.paymentMethod)} · {SOURCE[row.source] || row.source}{row.httpStatus ? ` · HTTP ${row.httpStatus}` : ''}</span>
                    </td>
                    <td>
                      <p className={styles.message}>{row.message}</p>
                      {row.code && <span className={styles.muted}>{row.code}</span>}
                    </td>
                    <td><References row={row} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.cards}>
            {rows.map((row) => (
              <article key={row._id} className={styles.card}>
                <div className={styles.cardTop}>
                  <div>
                    <span className={styles.customer}>{row.user?.name || 'Deleted account'}</span>
                    <span className={styles.muted} title={formatDateTime(row.createdAt)}>{ago(row.createdAt)} · {paymentLabel(row.paymentMethod)}</span>
                  </div>
                  <StepChip step={row.step} />
                </div>
                <p className={styles.message}>{row.message}</p>
                <References row={row} />
              </article>
            ))}
          </div>
          {!compact && (
            <div className={styles.footer}>
              <span>Page {page} of {pages}</span>
              <div className={styles.pager}>
                <button type="button" disabled={page <= 1 || refreshing} onClick={() => { setRefreshing(true); setPage((p) => p - 1); }}>Previous</button>
                <button type="button" disabled={page >= pages || refreshing} onClick={() => { setRefreshing(true); setPage((p) => p + 1); }}>Next</button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function StepChip({ step }: { step: string }) {
  const meta = STEPS[step] || { label: step, tone: 'warning' as Tone };
  return <span className={`${styles.step} ${styles[meta.tone]}`}><i aria-hidden />{meta.label}</span>;
}

function References({ row }: { row: Failure }) {
  const refs = [
    row.razorpayOrderId && { label: 'Order', value: row.razorpayOrderId, what: 'Gateway order id' },
    row.razorpayPaymentId && { label: 'Payment', value: row.razorpayPaymentId, what: 'Payment id' },
  ].filter(Boolean) as { label: string; value: string; what: string }[];
  if (!refs.length) return <span className={styles.muted} title={row.attemptId ? `Attempt ${row.attemptId}` : undefined}>—</span>;
  return (
    <div className={styles.refs} title={row.attemptId ? `Attempt ${row.attemptId}` : undefined}>
      {refs.map((r) => (
        <span key={r.label} className={styles.ref}>
          <span>{r.label}</span>
          <code>{r.value}</code>
          <button type="button" className={styles.copy} onClick={() => copy(r.value, r.what)} aria-label={`Copy ${r.what} ${r.value}`}>
            <IconCopy />
          </button>
        </span>
      ))}
    </div>
  );
}

function paymentLabel(method?: string) {
  if (method === 'cod') return 'Cash on delivery';
  if (method === 'emi') return 'EMI';
  return 'Online';
}

const svg = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
function IconRefresh() { return <svg {...svg}><path d="M21 12a9 9 0 1 1-2.64-6.36" /><polyline points="21 3 21 9 15 9" /></svg>; }
function IconCopy() { return <svg {...svg}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></svg>; }
function IconCheck() { return <svg {...svg}><path d="M20 6 9 17l-5-5" /></svg>; }
