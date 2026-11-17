'use client';

/**
 * Admin — platform-wide orders feed, in the seller orders list's layout
 * (docs/seller-dashboard-redesign.md): one workspace panel holding the
 * header, status tabs WITH counts, the search/filter toolbar and the
 * table. Rows are clickable; at narrow panel widths they become cards.
 *
 * The "Deleted" tab lists admin-archived orders (`archived=true`); each
 * row's menu deletes (archives) or restores — see DeleteOrderDialog.
 *
 * Data contract unchanged — GET /api/admin/orders with q, status,
 * paymentStatus, from/to (IST days), page, limit; `statusCounts` (counts
 * per status under the other filters) feeds the tabs. CSV export sends
 * the same filters with format=csv.
 *
 * Loading states are distinct: a never-seen view shows a skeleton; a view
 * seen before paints from the list cache (UX audit X5); switching filters
 * keeps the previous rows dimmed with "Updating…" instead of blanking;
 * a failure shows an error panel with retry, never an empty table.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AdminButton from '@/components/AdminButton';
import AdminSelect from '@/components/AdminSelect';
import DeleteOrderDialog, { restoreOrder } from '@/components/DeleteOrderDialog';
import OrdersTabs from '@/components/OrdersTabs';
import { RowActions, StatusChip, type RowAction } from '@/components/ui';
import { api, unwrapMeta } from '@/lib/api';
import { formatDayMonth, formatTime, formatDateTime } from '@/lib/dates';
import { readListCache, writeListCache } from '@/lib/listCache';
import { orderStatusToken, paymentMethodLabel } from '@/lib/orderStatusDisplay';
import { useOrderPolling } from '@/lib/useOrderPolling';
import styles from '@/components/WorkspaceList.module.css';
import { notifyError, apiMessage } from '@/lib/notify';
import { M } from '@/lib/messages';

type Order = {
  _id: string;
  orderNumber: string;
  status: 'placed' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';
  paymentMethod: 'cod' | 'online';
  /** What they actually paid with, read back from Razorpay after capture. */
  paymentInstrument?: { method?: string; emi?: { tenureMonths?: number } };
  paymentStatus: 'pending' | 'paid' | 'failed' | 'refunded';
  total: number;
  createdAt: string;
  items?: { quantity?: number }[];
  user?: { name?: string; email?: string } | null;
  sellers: { _id: string; name: string; slug?: string }[];
  /** Per-seller shipments — the source of truth for the displayed status. */
  sellerShipments?: { seller?: string; kind?: string; returnOf?: string | null; status?: string; awbCode?: string; pickedUpAt?: string | null }[];
  /** Set when an admin deleted (archived) the order. */
  archivedAt?: string | null;
  archivedBy?: { name?: string } | null;
  archiveReason?: string;
};

type Result = { orders: Order[]; pages: number; total: number; statusCounts: Record<string, number>; archivedCount: number };

const STATUS_TABS = [
  { id: '', label: 'All', countKey: 'all' },
  { id: 'placed', label: 'Placed', countKey: 'placed' },
  { id: 'confirmed', label: 'Confirmed', countKey: 'confirmed' },
  { id: 'shipped', label: 'Shipped', countKey: 'shipped' },
  { id: 'delivered', label: 'Delivered', countKey: 'delivered' },
  { id: 'cancelled', label: 'Cancelled', countKey: 'cancelled' },
];
const PAYMENT_OPTIONS = [
  { value: '', label: 'All payments' },
  { value: 'pending', label: 'Payment pending' },
  { value: 'paid', label: 'Paid' },
  { value: 'failed', label: 'Payment failed' },
  { value: 'refunded', label: 'Refunded' },
];
/* Date presets (UX audit A4), resolved to IST calendar days. */
const PERIOD_OPTIONS = [
  { value: 'all', label: 'All time' },
  { value: '1', label: 'Today' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];
function periodRange(period: string): { from?: string; to?: string } {
  if (!period || period === 'all') return {};
  const days = Number(period);
  const ist = (d: Date) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
  const now = new Date();
  return { from: ist(new Date(now.getTime() - (days - 1) * 86400000)), to: ist(now) };
}

/* 15 per page, per product decision. */
const PAGE_SIZE = 15;
const inr = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n || 0);

function paidWith(o: Order) {
  // EMI is called out because it changes how the money arrives.
  if (o.paymentInstrument?.method === 'emi') {
    return `EMI${o.paymentInstrument.emi?.tenureMonths ? ` · ${o.paymentInstrument.emi.tenureMonths} months` : ''}`;
  }
  return paymentMethodLabel(o.paymentMethod);
}

export default function AdminOrdersPage() {
  const router = useRouter();
  const [query, setQuery] = useState('');      // what's typed
  const [q, setQ] = useState('');              // debounced, sent to the API
  const [status, setStatus] = useState('');
  /** The "Deleted" tab: admin-archived orders only (restorable). */
  const [archived, setArchived] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState('');
  const [period, setPeriod] = useState('all');
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lastShown, setLastShown] = useState<Result | null>(null);
  /** Status-tab counts of live orders — kept while the Deleted tab is open. */
  const [liveCounts, setLiveCounts] = useState<Record<string, number>>({});
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState<Order | null>(null);

  const params = { q: q.trim() || undefined, status: status || undefined, paymentStatus: paymentStatus || undefined, archived: archived ? 'true' : undefined, ...periodRange(period) };
  const key = `admin-orders:${page}:${archived ? 'deleted' : status}:${paymentStatus}:${period}:${q.trim()}`;

  // Debounce the search box; changing the search returns to page 1.
  useEffect(() => {
    const t = setTimeout(() => { setQ(query); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const request = (signal?: AbortSignal) =>
    api.get('/admin/orders', { signal, params: { ...params, page, limit: PAGE_SIZE } })
      .then((r): Result => {
        const { data, meta } = unwrapMeta<
          { items: Order[]; statusCounts: Record<string, number>; archivedCount: number },
          { totalItems: number; totalPages: number }
        >(r);
        return { orders: data.items || [], pages: meta?.totalPages || 1, total: meta?.totalItems || 0, statusCounts: data.statusCounts || {}, archivedCount: data.archivedCount || 0 };
      });
  const apply = (forKey: string, result: Result) => {
    setResults((r) => ({ ...r, [forKey]: result }));
    setErrors((e) => { const next = { ...e }; delete next[forKey]; return next; });
    setLastShown(result);
    if (!forKey.includes(':deleted:')) setLiveCounts(result.statusCounts);
    writeListCache(forKey, result);
  };

  useEffect(() => {
    const controller = new AbortController();
    request(controller.signal).then((r) => apply(key, r)).catch((e) => {
      if (controller.signal.aborted) return;
      setErrors((prev) => ({ ...prev, [key]: apiMessage(e) || 'The orders list is unavailable right now.' }));
    });
    return () => controller.abort();
    // `key` captures every input request() reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  // Quiet 15 s refresh of the current view (paused in hidden tabs).
  useOrderPolling((signal) => request(signal).then((r) => apply(key, r)), key);

  const current = results[key] ?? readListCache<Result>(key);
  const error = errors[key];
  const shown = current ?? lastShown;
  const updating = !current && !error && !!lastShown;
  const counts = archived ? liveCounts : shown?.statusCounts || {};
  const hasFilters = !!(q.trim() || status || archived || paymentStatus || period !== 'all');
  const total = current?.total ?? 0;
  const pages = current?.pages ?? 1;
  const from = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const to = Math.min(page * PAGE_SIZE, total);

  const choose = (setter: (v: string) => void) => (v: string) => { setter(v); setPage(1); };
  const chooseStatus = (v: string) => { setStatus(v); setArchived(false); setPage(1); };
  const showDeleted = () => { setStatus(''); setArchived(true); setPage(1); };
  const clearFilters = () => { setQuery(''); setQ(''); setStatus(''); setArchived(false); setPaymentStatus(''); setPeriod('all'); setPage(1); };
  const retry = () => { setErrors((e) => { const next = { ...e }; delete next[key]; return next; }); setAttempt((n) => n + 1); };
  /* After delete/restore, refetch this view now rather than on the next poll. */
  const refresh = () => { setResults((r) => { const next = { ...r }; delete next[key]; return next; }); setAttempt((n) => n + 1); };
  const menuFor = (o: Order): RowAction[] => o.archivedAt
    ? [{ key: 'restore', label: 'Restore order', hint: 'Back in every list, unchanged', onSelect: () => { void restoreOrder(o.orderNumber).then((ok) => ok && refresh()); } }]
    : [{ key: 'delete', label: 'Delete order…', hint: 'Hidden everywhere, restorable', tone: 'danger', onSelect: () => setDeleting(o) }];

  /* CSV of exactly what the filters show (UX audit A4). */
  async function exportCsv() {
    setExporting(true);
    try {
      const { data } = await api.get('/admin/orders', { responseType: 'blob', params: { ...params, format: 'csv' } });
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url; a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      notifyError(e, M.orders.couldntExportOrders);
    } finally {
      setExporting(false);
    }
  }

  const openOrder = (o: Order) => router.push(`/orders/${o.orderNumber}`);
  const onRowClick = (e: React.MouseEvent, o: Order) => {
    if ((e.target as HTMLElement).closest('a,button')) return;
    openOrder(o);
  };

  return (
    <div className={styles.page}>
      <OrdersTabs />

      <section className={styles.workspace} aria-labelledby="orders-heading">
        <div className={styles.listHeader}>
          <div>
            <h2 id="orders-heading">{archived ? 'Deleted orders' : 'All orders'} <span className={styles.count}>{archived ? shown?.archivedCount ?? '…' : counts.all ?? '…'}</span></h2>
            <p>{archived
              ? 'Hidden from every list, but kept — payments, refunds and payouts still run on them. Restore one to bring it back.'
              : 'Every customer order across all sellers. Refreshes every 15 seconds.'}</p>
          </div>
          <div className={styles.headerActions}>
            <div className={styles.labelled}>
              <span>Placed</span>
              <AdminSelect ariaLabel="Filter by date placed" value={period} onChange={choose(setPeriod)} options={PERIOD_OPTIONS} />
            </div>
            <AdminButton variant="bordered" onPress={exportCsv} isLoading={exporting} isDisabled={exporting || !total}>
              <IconDownload /> Export CSV{total ? ` (${inr(total)})` : ''}
            </AdminButton>
          </div>
        </div>

        <div className={styles.stageFilters} role="group" aria-label="Filter by order status">
          {STATUS_TABS.map((t) => (
            <button key={t.id || 'all'} type="button" aria-pressed={!archived && status === t.id} onClick={() => chooseStatus(t.id)}>
              {t.label}<span>{counts[t.countKey] ?? 0}</span>
            </button>
          ))}
          <button type="button" aria-pressed={archived} onClick={showDeleted} title="Orders an admin deleted — restorable">
            Deleted<span>{shown?.archivedCount ?? 0}</span>
          </button>
        </div>

        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            <label className={styles.search}>
              <IconSearch />
              <span className="sr-only">Search orders</span>
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search order number, customer name or email" />
              {query && <button type="button" className={styles.clearSearch} onClick={() => setQuery('')} aria-label="Clear search"><IconClose /></button>}
            </label>
            <AdminSelect ariaLabel="Filter by payment status" value={paymentStatus} onChange={choose(setPaymentStatus)} options={PAYMENT_OPTIONS} />
          </div>
          <div className={styles.results} aria-live="polite">
            {updating ? <span className={styles.updating}>Updating…</span> : current && <span>{total ? `Showing ${from}–${to} of ${inr(total)}` : 'No results'}</span>}
            {hasFilters && <button type="button" className={styles.clearFilters} onClick={clearFilters}><IconClose /> Clear filters</button>}
          </div>
        </div>

        {error && !shown ? (
          <div className={styles.state} role="alert">
            <span className={`${styles.stateIcon} ${styles.errorIcon}`}><IconAlert /></span>
            <h3>Couldn’t load orders</h3>
            <p>{error}</p>
            <button type="button" className={styles.stateAction} onClick={retry}>Try again</button>
          </div>
        ) : !shown ? (
          <div className={styles.skeleton} role="status" aria-label="Loading orders"><span /><span /><span /><span /><span /></div>
        ) : shown.orders.length === 0 && !updating ? (
          <div className={styles.state}>
            <span className={styles.stateIcon}><IconBag /></span>
            <h3>{archived ? 'No deleted orders' : hasFilters ? 'No orders match these filters' : 'No orders yet'}</h3>
            <p>{archived ? 'Orders you delete land here, and can be restored any time.' : hasFilters ? 'Try another status or date range, or clear the search.' : 'Customer orders will appear here as they come in.'}</p>
            {hasFilters && <button type="button" className={styles.stateLink} onClick={clearFilters}>Clear filters</button>}
          </div>
        ) : (
          <>
            {error && <p className="px-[22px] pb-3 text-[11px] text-[#a3413b]" role="status">Couldn’t refresh — showing the last loaded list. <button type="button" className="underline" onClick={retry}>Retry</button></p>}
            <div className={`${styles.tableWrap} ${updating ? styles.stale : ''}`} aria-busy={updating}>
              <table className={styles.table}>
                <caption className="sr-only">Marketplace orders, newest first</caption>
                <thead>
                  <tr>
                    <th scope="col">Order</th><th scope="col">Customer</th><th scope="col">Sellers</th>
                    <th scope="col">Payment</th><th scope="col">Status</th><th scope="col" className={styles.money}>Total</th>
                    <th scope="col"><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody>
                  {shown.orders.map((o) => {
                    const t = orderStatusToken(o);
                    const units = (o.items || []).reduce((s, it) => s + (it.quantity || 0), 0);
                    return (
                      <tr key={o._id} onClick={(e) => onRowClick(e, o)}>
                        <td>
                          <Link className={styles.primary} href={`/orders/${o.orderNumber}`}>{o.orderNumber}</Link>
                          <span className={styles.sub} title={formatDateTime(o.createdAt)}>{formatDayMonth(o.createdAt)}, {formatTime(o.createdAt)} · {units} {units === 1 ? 'item' : 'items'}</span>
                        </td>
                        <td>
                          <span className={styles.primary}>{o.user?.name || 'Deleted account'}</span>
                          {o.user?.email && <span className={styles.sub}>{o.user.email}</span>}
                        </td>
                        <td><SellerChips sellers={o.sellers} /></td>
                        <td><StatusChip status={o.paymentStatus} /><span className={styles.sub}>{paidWith(o)}</span></td>
                        <td>
                          <StatusChip status={t.key} label={t.label} hint={t.detail} />
                          {o.archivedAt && <span className={styles.sub} title={o.archiveReason || undefined}>Deleted {formatDayMonth(o.archivedAt)}{o.archivedBy?.name ? ` by ${o.archivedBy.name}` : ''}</span>}
                        </td>
                        <td className={styles.money}><strong>₹{inr(o.total)}</strong></td>
                        <td>
                          <div className="flex items-center justify-end gap-1.5">
                            <RowActions ariaLabel={`More actions for order ${o.orderNumber}`} items={menuFor(o)} />
                            <Link className={styles.openLink} href={`/orders/${o.orderNumber}`} aria-label={`Open order ${o.orderNumber}`} title="Open order"><IconArrow /></Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className={`${styles.cards} ${updating ? styles.stale : ''}`}>
              {shown.orders.map((o) => {
                const t = orderStatusToken(o);
                return (
                  <Link key={o._id} className={styles.card} href={`/orders/${o.orderNumber}`}>
                    <div className={styles.cardTop}>
                      <div>
                        <span className={styles.primary}>{o.orderNumber}</span>
                        <span className={styles.sub}>{formatDayMonth(o.createdAt)}, {formatTime(o.createdAt)}</span>
                      </div>
                      <StatusChip status={t.key} label={t.label} />
                    </div>
                    <dl className={styles.cardGrid}>
                      <div><dt>Customer</dt><dd>{o.user?.name || 'Deleted account'}</dd></div>
                      <div><dt>Total</dt><dd><strong>₹{inr(o.total)}</strong> · {paidWith(o)}</dd></div>
                      <div><dt>Sellers</dt><dd>{o.sellers.map((s) => s.name).join(', ') || '—'}</dd></div>
                      <div><dt>Payment</dt><dd><StatusChip status={o.paymentStatus} /></dd></div>
                    </dl>
                  </Link>
                );
              })}
            </div>
            {pages > 1 && (
              <div className={styles.footer}>
                <span>Page {page} of {pages}</span>
                <div className={styles.pager}>
                  <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><IconArrow flip /> Previous</button>
                  <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next <IconArrow /></button>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      <DeleteOrderDialog
        order={deleting && { orderNumber: deleting.orderNumber, total: deleting.total, status: deleting.status, paymentMethod: deleting.paymentMethod, paymentStatus: deleting.paymentStatus, customerName: deleting.user?.name }}
        onClose={() => setDeleting(null)}
        onDeleted={refresh}
      />
    </div>
  );
}

function SellerChips({ sellers }: { sellers: Order['sellers'] }) {
  if (!sellers?.length) return <span className={styles.sub}>—</span>;
  return (
    <div className={styles.chips}>
      {sellers.slice(0, 2).map((v) => (
        <Link key={v._id} className={styles.chip} href={`/sellers/${v.slug || v._id}`} title={v.name}>{v.name}</Link>
      ))}
      {sellers.length > 2 && <span className={styles.more}>+{sellers.length - 2} more</span>}
    </div>
  );
}

const svg = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
function IconArrow({ flip }: { flip?: boolean }) { return <svg {...svg} style={flip ? { transform: 'scaleX(-1)' } : undefined}><line x1="5" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" /></svg>; }
function IconSearch() { return <svg {...svg}><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>; }
function IconClose() { return <svg {...svg} width="12" height="12"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>; }
function IconDownload() { return <svg {...svg} width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>; }
function IconBag() { return <svg {...svg}><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 0 1-8 0" /></svg>; }
function IconAlert() { return <svg {...svg}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>; }
