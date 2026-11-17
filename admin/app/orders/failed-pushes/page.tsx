'use client';

/**
 * Admin — shipping errors (orders with a seller parcel whose automatic
 * Shiprocket booking failed: bad pickup nickname, Shiprocket 4xx, network).
 *
 * Read-only by design: sellers own retries ("Retry push" in their
 * dashboard). This page tells the admin WHICH sellers are stuck and why,
 * with a one-click email to the seller.
 *
 * Same workspace layout as All orders (orders.module.css).
 * Backend: GET /api/admin/orders/failed-pushes (page, limit).
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import OrdersTabs from '@/components/OrdersTabs';
import { api, unwrapMeta } from '@/lib/api';
import { formatDateTime } from '@/lib/dates';
import { paymentMethodLabel } from '@/lib/orderStatusDisplay';
import styles from '@/components/WorkspaceList.module.css';
import { apiMessage } from '@/lib/notify';

type FailedSlice = { sellerId: string; sellerName: string; sellerSlug?: string; sellerEmail?: string; lastError: string; updatedAt: string };
type Order = {
  _id: string; orderNumber: string; status: string; paymentMethod: 'cod' | 'online'; total: number;
  createdAt: string; updatedAt: string; user?: { name?: string; email?: string } | null; failedSlices: FailedSlice[];
};
type Result = { orders: Order[]; pages: number; total: number };

const PAGE_SIZE = 25;
const inr = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n || 0);

function ago(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (Number.isNaN(mins)) return '';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

function emailHref(o: Order, f: FailedSlice) {
  const subject = `THROTTLEIN order ${o.orderNumber} — courier booking failed`;
  const body = `Hi ${f.sellerName},\n\nThe courier booking for your part of order ${o.orderNumber} failed:\n${f.lastError}\n\nPlease fix this and use "Retry push" on the order in your seller dashboard.\n\nThanks,\nTHROTTLEIN`;
  return `mailto:${f.sellerEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export default function AdminFailedPushesPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api.get('/admin/orders/failed-pushes', { signal: controller.signal, params: { page, limit: PAGE_SIZE } })
      .then((r) => {
        const { data, meta } = unwrapMeta<{ items: Order[] }, { totalItems: number; totalPages: number }>(r);
        setResult({ orders: data.items || [], pages: meta?.totalPages || 1, total: meta?.totalItems || 0 }); setError(null);
      })
      .catch((e) => { if (!controller.signal.aborted) setError(apiMessage(e) || 'The shipping errors list is unavailable right now.'); });
    return () => controller.abort();
  }, [page, attempt]);

  const retry = () => { setError(null); setAttempt((n) => n + 1); };
  const onRowClick = (e: React.MouseEvent, o: Order) => {
    if ((e.target as HTMLElement).closest('a,button')) return;
    router.push(`/orders/${o.orderNumber}`);
  };

  return (
    <div className={styles.page}>
      <OrdersTabs />

      <section className={styles.workspace} aria-labelledby="shipping-errors-heading">
        <div className={styles.listHeader}>
          <div>
            <h2 id="shipping-errors-heading">Shipping errors <span className={styles.count}>{result ? result.total : '…'}</span></h2>
            <p>Seller parcels whose courier booking failed. Sellers retry from their dashboard — email them the reason.</p>
          </div>
        </div>

        {error && !result ? (
          <div className={styles.state} role="alert">
            <span className={`${styles.stateIcon} ${styles.errorIcon}`}><IconAlert /></span>
            <h3>Couldn’t load shipping errors</h3>
            <p>{error}</p>
            <button type="button" className={styles.stateAction} onClick={retry}>Try again</button>
          </div>
        ) : !result ? (
          <div className={styles.skeleton} role="status" aria-label="Loading shipping errors"><span /><span /><span /></div>
        ) : result.orders.length === 0 ? (
          <div className={styles.state}>
            <span className={styles.stateIcon}><IconCheck /></span>
            <h3>No shipping errors</h3>
            <p>Every seller parcel reached the courier.</p>
          </div>
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <caption className="sr-only">Orders with a failed courier booking, most recent first</caption>
                <thead>
                  <tr>
                    <th scope="col">Order</th><th scope="col">Stuck seller</th><th scope="col">Reason</th>
                    <th scope="col">Customer</th><th scope="col" className={styles.money}>Total</th><th scope="col"><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody>
                  {result.orders.map((o) => (
                    <tr key={o._id} onClick={(e) => onRowClick(e, o)}>
                      <td>
                        <Link className={styles.primary} href={`/orders/${o.orderNumber}`}>{o.orderNumber}</Link>
                        <span className={styles.sub} title={formatDateTime(o.updatedAt)}>Failed {ago(o.failedSlices[0]?.updatedAt || o.updatedAt)}</span>
                      </td>
                      <td>
                        <div className={styles.chips}>
                          {o.failedSlices.map((f) => (
                            <Link key={f.sellerId} className={`${styles.chip} ${styles.dangerChip}`} href={`/sellers/${f.sellerSlug || f.sellerId}`} title={f.sellerName}>{f.sellerName}</Link>
                          ))}
                        </div>
                        {o.failedSlices.filter((f) => f.sellerEmail).map((f) => (
                          <a key={f.sellerId} className={styles.sub} href={emailHref(o, f)}>Email {o.failedSlices.length > 1 ? f.sellerName : 'seller'}</a>
                        ))}
                      </td>
                      <td>
                        {o.failedSlices.map((f) => (
                          <p key={f.sellerId} className={styles.reason} title={f.lastError}>{f.lastError}</p>
                        ))}
                      </td>
                      <td>
                        <span className={styles.primary}>{o.user?.name || 'Deleted account'}</span>
                        {o.user?.email && <span className={styles.sub}>{o.user.email}</span>}
                      </td>
                      <td className={styles.money}><strong>₹{inr(o.total)}</strong><span className={styles.sub}>{paymentMethodLabel(o.paymentMethod)}</span></td>
                      <td><Link className={styles.openLink} href={`/orders/${o.orderNumber}`} aria-label={`Open order ${o.orderNumber}`} title="Open order"><IconArrow /></Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={styles.cards}>
              {result.orders.map((o) => (
                <div key={o._id} className={styles.card}>
                  <div className={styles.cardTop}>
                    <div>
                      <Link className={styles.primary} href={`/orders/${o.orderNumber}`}>{o.orderNumber}</Link>
                      <span className={styles.sub}>Failed {ago(o.failedSlices[0]?.updatedAt || o.updatedAt)} · ₹{inr(o.total)}</span>
                    </div>
                    <Link className={styles.openLink} href={`/orders/${o.orderNumber}`} aria-label={`Open order ${o.orderNumber}`}><IconArrow /></Link>
                  </div>
                  {o.failedSlices.map((f) => (
                    <dl key={f.sellerId} className={styles.cardGrid}>
                      <div><dt>Stuck seller</dt><dd>{f.sellerName}{f.sellerEmail && <> · <a className="underline" href={emailHref(o, f)}>Email</a></>}</dd></div>
                      <div><dt>Reason</dt><dd className={styles.reason}>{f.lastError}</dd></div>
                    </dl>
                  ))}
                </div>
              ))}
            </div>
            {result.pages > 1 && (
              <div className={styles.footer}>
                <span>Page {page} of {result.pages}</span>
                <div className={styles.pager}>
                  <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><IconArrow flip /> Previous</button>
                  <button type="button" disabled={page >= result.pages} onClick={() => setPage((p) => p + 1)}>Next <IconArrow /></button>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

const svg = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
function IconArrow({ flip }: { flip?: boolean }) { return <svg {...svg} style={flip ? { transform: 'scaleX(-1)' } : undefined}><line x1="5" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" /></svg>; }
function IconCheck() { return <svg {...svg}><path d="M20 6 9 17l-5-5" /></svg>; }
function IconAlert() { return <svg {...svg}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>; }
