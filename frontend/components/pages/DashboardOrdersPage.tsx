'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import SellerSelect from '@/components/common/SellerSelect';
import { useRouter } from 'next/navigation';
import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, useDisclosure } from '@heroui/react';
import Button from '@/components/common/SellerButton';
import Arrow from '@/components/common/Arrow';
import toast from 'react-hot-toast';
import {
  EmptyState,
  ErrorState,
  TableSkeleton,
  RowActions,
  StatusChip,
  TablePagination,
  type DataTableColumn,
} from '@/components/ui';
import { api, unwrap } from '@/lib/api';
import { orderStatusToken, paymentMethodLabel, paymentStatusLabel, type StatusKey } from '@/lib/orderStatusDisplay';
import { useOrderPolling } from '@/lib/useOrderPolling';
import SellerOrdersTabs from '@/components/common/SellerOrdersTabs';
import { readListCache, writeListCache } from '@/lib/listCache';
import styles from './DashboardOrders.module.css';
import { notifyError, notifySuccess, apiMessage } from '@/lib/notify';
import { M } from '@/lib/messages';

/** Seller order workspace. Filtering uses the same shipment token as row actions. */

type Order = {
  _id: string;
  orderNumber: string;
  status: 'placed' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';
  paymentMethod: string;
  paymentStatus: string;
  myItemsSubtotal: number;
  items: { name: string; quantity: number }[];
  shippingAddress?: { fullName?: string; city?: string; state?: string };
  createdAt: string;
  fulfillmentHold?: string;
  /** This seller's shipment legs — the source of truth for dispatch. */
  sellerShipments?: any[];
};

type Bucket = 'cancelled' | 'to_ship' | 'shipping' | 'awaiting_pickup' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'issues' | 'all';

/* Which plain-language status keys land in which tab. Cancelled orders
   need nothing from the seller, so they appear only under All. */
const BUCKET_KEYS: Record<Exclude<Bucket, 'all' | 'shipping'>, StatusKey[]> = {
  cancelled: ['cancelled'],
  to_ship:   ['placed', 'confirmed'],
  awaiting_pickup: ['awaiting_pickup'],
  in_transit: ['in_transit'],
  out_for_delivery: ['out_for_delivery'],
  delivered: ['delivered'],
  issues:    ['pickup_failed', 'delivery_failed', 'shipping_error', 'returning', 'returned', 'lost', 'multiple'],
};
const BUCKETS: { id: Bucket; label: string }[] = [
  { id: 'all', label: 'All orders' },
  { id: 'to_ship',   label: 'To ship' },
  { id: 'awaiting_pickup', label: 'Awaiting pickup' },
  { id: 'in_transit', label: 'In transit' },
  { id: 'out_for_delivery', label: 'Out for delivery' },
  { id: 'delivered', label: 'Delivered' },
  { id: 'issues',    label: 'Issues' },
  { id: 'cancelled', label: 'Cancelled' },
];

const PERIODS = [
  { value: 'all', label: 'All time' },
  { value: '1',   label: 'Today' },
  { value: '7',   label: 'Last 7 days' },
  { value: '30',  label: 'Last 30 days' },
  { value: '90',  label: 'Last 90 days' },
];

const PAGE_SIZE = 15;

const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);

function bucketOf(key: StatusKey): Bucket {
  for (const b of Object.keys(BUCKET_KEYS) as Exclude<Bucket, 'all' | 'shipping'>[]) {
    if (BUCKET_KEYS[b].includes(key)) return b;
  }
  return 'all';
}

/** The one thing to do next on this row, by state. */
function primaryAction(o: Order, key: StatusKey): { label: string; href: string } {
  const detail = `/dashboard/orders/${o.orderNumber || o._id}`;
  if (o.fulfillmentHold) return { label: 'View', href: detail };
  switch (key) {
    case 'placed':          return { label: 'Confirm order', href: detail };
    case 'confirmed':       return { label: 'Ship order', href: detail };
    case 'pickup_failed':
    case 'shipping_error':  return { label: 'Book pickup again', href: detail };
    case 'delivery_failed': return { label: 'Resolve', href: '/dashboard/ndr' };
    case 'awaiting_pickup': return { label: 'View pickup', href: detail };
    case 'in_transit':
    case 'out_for_delivery': return { label: 'Track shipment', href: detail };
    default:                return { label: 'View', href: detail };
  }
}

export default function DashboardOrdersPage() {
  /* UX audit X5: paint the last-known list at once, refresh quietly. */
  const [cached] = useState(() => readListCache<Order[]>('seller-orders'));
  const [orders, setOrders] = useState<Order[]>(cached ?? []);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);
  const [manifestLoading, setManifestLoading] = useState(false);
  const router = useRouter();
  const [bucket, setBucket] = useState<Bucket>('all');
  const [q, setQ] = useState('');
  const [period, setPeriod] = useState('all');
  const [page, setPage] = useState(1);
  /** Order number whose row action is running, so only that row shows busy. */
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  /* Cancelling is irreversible from here, so it gets a real dialog rather
   * than window.confirm — which can't say which order in the product's own
   * voice, can't colour the destructive choice, and on some browsers is
   * suppressed entirely after a few uses. */
  const cancelModal = useDisclosure();
  const [cancelTarget, setCancelTarget] = useState<Order | null>(null);

  const load = useCallback(async (quiet = false, signal?: AbortSignal) => {
    try {
      // Max page the API allows; a seller's own list is small enough to
      // filter and page in the browser, which keeps the tabs instant.
      const data = unwrap<any>(await api.get('/seller/orders', { params: { limit: 200 }, signal }));
      setError(null);
      setOrders(data.items || []);
      writeListCache('seller-orders', data.items || []);
    } catch (e: any) {
      if (signal?.aborted) return;
      const message = apiMessage(e) || 'Couldn’t load orders';
      if (!quiet) { setError(message); notifyError(e, M.orders.couldntLoadOrders); }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    // Fetch initial data from the external order service after mounting.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(!!cached, controller.signal);
    /* Deep link from the dashboard's Action needed cards:
       /dashboard/orders?tab=issues. Read once on mount; no router state,
       so no Suspense boundary is needed for a static route. */
    const tab = new URLSearchParams(window.location.search).get('tab') as Bucket | null;
    if (tab && (tab === 'shipping' || BUCKETS.some((b) => b.id === tab))) {
      setBucket(tab);
    }
    return () => controller.abort();
  }, [cached, load]);
  useOrderPolling((signal) => load(true, signal), 'seller-orders');

  /* Derive once per fetch: the token drives the tab, the chip and the
     primary action, so all three always agree about a row. */
  const decorated = useMemo(
    () => orders.map((o) => { const token = orderStatusToken(o); return { o, token, bucket: bucketOf(token.key) }; }),
    [orders],
  );

  const inPeriod = useMemo(() => {
    if (period === 'all') return decorated;
    const from = new Date(); from.setHours(0, 0, 0, 0);
    from.setDate(from.getDate() - (Number(period) - 1));
    return decorated.filter(({ o }) => new Date(o.createdAt) >= from);
  }, [decorated, period]);

  const searched = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return inPeriod;
    return inPeriod.filter(({ o }) =>
      [o.orderNumber, o.shippingAddress?.fullName, o.shippingAddress?.city, o.shippingAddress?.state, ...o.items.map((i) => i.name)]
        .some((v) => String(v || '').toLowerCase().includes(needle)));
  }, [inPeriod, q]);

  const counts = useMemo(() => {
    const c: Record<Bucket, number> = { cancelled: 0, to_ship: 0, shipping: 0, awaiting_pickup: 0, in_transit: 0, out_for_delivery: 0, delivered: 0, issues: 0, all: searched.length };
    for (const d of searched) if (d.bucket !== 'all') c[d.bucket] += 1;
    c.shipping = c.awaiting_pickup + c.in_transit + c.out_for_delivery;
    return c;
  }, [searched]);

  const issueCount = inPeriod.filter(row => row.bucket === 'issues').length;

  const visible = useMemo(
    () => (bucket === 'all' ? searched : searched.filter((d) => bucket === 'shipping' ? ['awaiting_pickup', 'in_transit', 'out_for_delivery'].includes(d.bucket) : d.bucket === bucket)),
    [searched, bucket],
  );
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const activePage = Math.min(page, pages);
  const paginated = visible.slice((activePage - 1) * PAGE_SIZE, activePage * PAGE_SIZE);
  function clearFilters() { setBucket('all'); setQ(''); setPeriod('all'); setPage(1); }
  function chooseBucket(next: Bucket) { setBucket(next); setPage(1); }

  /**
   * Generate today's pickup sheet — a single PDF listing every parcel the
   * seller is handing to the courier today. Hand it over with the packages
   * and the courier signs / scans it as proof of pickup.
   */
  async function downloadTodayManifest() {
    setManifestLoading(true);
    try {
      const data = unwrap<any>(await api.get('/seller/manifests/today'));
      if (!data.ok) {
        // Info-level messages for the paths where Shiprocket has nothing
        // new to hand back — no red error toast, since neither is a bug.
        const message =
          data.reason === 'nothing-to-hand-over'
            ? 'Nothing to hand over — every labelled parcel has already been collected.'
            : data.reason === 'already-generated'
              ? "This pickup sheet was already generated. Open it from your Shiprocket dashboard."
              : data.message || "Couldn't generate the pickup sheet";
        toast(message, { icon: 'ℹ️' });
        return;
      }
      window.open(data.url, '_blank', 'noopener');
      notifySuccess(M.orders.pickupSheetReadyParcelS(data.count));
    } catch (e: any) {
      notifyError(e, M.orders.couldntGenerateThePickupSheet);
    } finally {
      setManifestLoading(false);
    }
  }

  type Row = (typeof decorated)[number];
  /** Ask first — the work happens in confirmCancel. */
  function cancelOrder(o: Order) {
    setCancelTarget(o);
    cancelModal.onOpen();
  }

  /** Cancel an order this seller hasn't confirmed yet. */
  async function confirmCancel() {
    const o = cancelTarget;
    if (!o) return;
    const ref = o.orderNumber || o._id;
    setRowBusy(ref);
    try {
      await api.post(`/seller/orders/${ref}/cancel-order`);
      cancelModal.onClose();
      setCancelTarget(null);
      notifySuccess(M.orders.cancelled(ref));
      await load(true);
    } catch (e: any) {
      notifyError(e, M.orders.couldntCancelThisOrder);
    } finally {
      setRowBusy(null);
    }
  }

  /** Hide a cancelled order from this seller's list only. */
  async function hideOrder(o: Order) {
    const ref = o.orderNumber || o._id;
    setRowBusy(ref);
    try {
      await api.post(`/seller/orders/${ref}/hide`, { hidden: true });
      notifySuccess(M.orders.removedFromYourList(ref));
      await load(true);
    } catch (e: any) {
      notifyError(e, M.orders.couldntRemoveThisOrder);
    } finally {
      setRowBusy(null);
    }
  }

  const columns: DataTableColumn<Row>[] = [
    {
      id: 'order',
      header: 'Order',
      isRowHeader: true,
      cell: ({ o }) => (
        <div className={styles.orderIdentity}>
          <Link className="font-medium text-foreground underline-offset-4 hover:underline" href={`/dashboard/orders/${o.orderNumber || o._id}`}>
            {o.orderNumber}
          </Link>
          <p className="truncate text-xs text-muted">
            {new Date(o.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
        </div>
      ),
    },
    {
      id: 'customer',
      header: 'Customer',
      cell: ({ o }) => {
        return (
          <div className={styles.customer}>
            <p className="truncate text-sm text-foreground">{o.shippingAddress?.fullName || '—'}</p>
            <p className="text-xs text-muted">{[o.shippingAddress?.city, o.shippingAddress?.state].filter(Boolean).join(', ') || '—'}</p>
          </div>
        );
      },
    },
    {
      id: 'items',
      header: 'Products',
      cell: ({ o }) => {
        const [first, ...rest] = o.items;
        if (!first) return <span className="text-muted">—</span>;
        return (
          <div className={styles.product}>
            <p title={first.name} className="truncate text-sm text-foreground">{first.name} <span className="text-muted">×{first.quantity}</span></p>
            {rest.length > 0 && <p className="text-xs text-muted">+{rest.length} more item{rest.length > 1 ? 's' : ''}</p>}
          </div>
        );
      },
    },
    {
      id: 'status',
      header: 'Status',
      /* HeroUI's Column.minWidth only binds on resizable tables, so the
         floor is on the cell: a two-word chip must never wrap. */
      cell: ({ token }) => <div className={styles.status}><StatusChip hint={token.detail} label={token.label} status={token.key} /></div>,
    },
    {
      id: 'subtotal',
      header: 'Amount',
      className: 'text-right',
      cell: ({ o }) => (
        <div className={styles.payment}>
          <p className="text-sm font-semibold tabular-nums text-foreground">₹{inr(o.myItemsSubtotal)}</p>
          <p className="text-xs text-muted">{paymentMethodLabel(o.paymentMethod)} · {paymentStatusLabel(o.paymentStatus)}</p>
        </div>
      ),
    },
    {
      id: 'actions',
      header: 'Next step',
      className: 'text-right',
      cell: ({ o, token }) => {
        const a = primaryAction(o, token.key);
        const ref = o.orderNumber || o._id;
        const items = [] as any[];
        /* Cancel is offered only before you accept the order — once
           confirmed, the customer has been told it's being prepared. */
        if (token.key === 'placed' && !o.fulfillmentHold) {
          items.push({
            key: 'cancel',
            label: 'Cancel order…',
            hint: o.paymentMethod === 'cod'
              ? 'Stock goes back to your inventory'
              : 'Stock goes back and a refund is raised',
            tone: 'danger',
            busy: rowBusy === ref,
            busyLabel: 'Cancelling…',
            onSelect: () => cancelOrder(o),
          });
        }
        /* Clearing a cancelled row is a view preference, so it never
           removes anything — admin and the customer keep the full order. */
        if (token.key === 'cancelled') {
          items.push({
            key: 'hide',
            label: 'Remove from my list',
            hint: 'Hides it here only — admin keeps the record',
            busy: rowBusy === ref,
            busyLabel: 'Removing…',
            onSelect: () => hideOrder(o),
          });
        }
        return (
          <RowActions
            className={styles.rowActions}
            ariaLabel={`Actions for ${o.orderNumber}`}
            primary={{ label: a.label, href: a.href }}
            items={items}
          />
        );
      },
    },
  ];

  const nothingAtAll = !loading && !error && orders.length === 0;
  const queueEmpty = bucket === 'to_ship' && !q.trim() && period === 'all';

  return (
    <>
      <div className={styles.page}>
        <h1 className="sr-only">Orders</h1>
      <div className="flex flex-wrap items-center justify-end gap-3 mb-5"><Button className={styles.printButton} isLoading={manifestLoading} onPress={downloadTodayManifest} startContent={<PickupSheetIcon />}>
            Print pickup sheet
          </Button></div>

        <SellerOrdersTabs active="orders" />

        {!loading && !error && issueCount > 0 && bucket !== 'issues' && <button className={styles.attentionBar} onClick={() => { setQ(''); chooseBucket('issues'); }} type="button">
          <span className={styles.attentionDot} aria-hidden />
          <span><strong>{issueCount} {issueCount === 1 ? 'shipment needs' : 'shipments need'} attention.</strong> Review pickup and delivery issues.</span>
          <span className={styles.attentionCta}>Review issues <Arrow /></span>
        </button>}

        <section className={styles.workspace} aria-label="Order list">
          <div className={styles.listHeader}>
            <div><h2>Your orders <span>{loading || error ? '—' : orders.length}</span></h2><p>Find an order or choose a stage to see what’s next.</p></div>
            <div className={styles.period}><span>Order date</span><SellerSelect ariaLabel="Order date" value={period} onChange={value => { setPeriod(value); setPage(1); }} options={PERIODS} /></div>
          </div>
          <div className={`seller-tab-row ${styles.stageFilters}`} role="group" aria-label="Filter orders by stage">
            {(bucket === 'shipping' ? [...BUCKETS.slice(0, 2), { id: 'shipping' as Bucket, label: 'Shipping' }, ...BUCKETS.slice(2)] : BUCKETS).map(stage => <button key={stage.id} type="button" aria-pressed={bucket === stage.id} onClick={() => chooseBucket(stage.id)}>
              {stage.label}<span>{loading || error ? '—' : counts[stage.id]}</span>
            </button>)}
          </div>
          <div className={styles.toolbar}>
            <label className={styles.search}>
              <svg aria-hidden width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="10.5" cy="10.5" r="7" /><path d="m16 16 5 5" /></svg>
              <span className="sr-only">Search orders</span>
              <input type="search" placeholder="Search order, customer, city or product…" value={q} onChange={event => { setQ(event.target.value); setPage(1); }} />
            </label>
            <div className={styles.results} aria-live="polite">{loading ? 'Loading orders…' : error ? 'Orders unavailable' : `${visible.length} ${visible.length === 1 ? 'order' : 'orders'}`}
              {(bucket !== 'all' || q || period !== 'all') && <button type="button" className={styles.clearFilters} onClick={clearFilters}>Clear filters <span aria-hidden>×</span></button>}
            </div>
          </div>

          {error ? <ErrorState title="We couldn’t load your orders" message={error} onRetry={() => { setLoading(true); setError(null); void load(); }} /> : loading ? <div role="status" aria-label="Loading orders"><TableSkeleton columns={6} rows={4} /></div> : visible.length === 0 ? <EmptyState
            title={nothingAtAll ? 'Ready for your first order' : queueEmpty ? 'Nothing to ship right now' : 'No orders match your filters'}
            description={nothingAtAll ? 'New customer orders will appear here. Keep your catalogue up to date so you’re ready.' : queueEmpty ? 'You’re caught up. Check another stage or view all your orders.' : 'Try a different search, shipment stage or date range.'}
            filtered={!nothingAtAll && !queueEmpty}
            action={nothingAtAll ? <Link className={styles.darkLink} href="/dashboard/products">Manage products <Arrow /></Link> : <button type="button" className={styles.darkLink} onClick={clearFilters}>Show all orders</button>}
          /> : <>
            <div className={styles.desktopTable}>
              <table className={styles.table}>
                <caption className="sr-only">Seller orders, {bucket.replaceAll('_', ' ')}, {PERIODS.find(option => option.value === period)?.label}</caption>
                <thead><tr>{columns.map(column => <th key={column.id} scope="col" className={column.className}>{column.header}</th>)}</tr></thead>
                <tbody>{paginated.map(row => <tr key={row.o._id} onClick={event => {
                  if ((event.target as HTMLElement).closest('a, button, input, [role="menuitem"]')) return;
                  const href = `/dashboard/orders/${row.o.orderNumber || row.o._id}`;
                  if (event.ctrlKey || event.metaKey) window.open(href, '_blank', 'noopener');
                  else router.push(href);
                }}>{columns.map(column => column.isRowHeader ? <th key={column.id} scope="row">{column.cell(row)}</th> : <td key={column.id} className={column.className}>{column.cell(row)}</td>)}</tr>)}</tbody>
              </table>
            </div>
            <div className={styles.mobileOrders}>
              {paginated.map(row => <article key={row.o._id} className={styles.mobileOrder} aria-label={`Order ${row.o.orderNumber}`}>
                <div className={styles.mobileTop}>{columns[0].cell(row)}<StatusChip hint={row.token.detail} label={row.token.label} status={row.token.key} /></div>
                <dl>{['items', 'customer', 'subtotal'].map(id => <div key={id}><dt>{id === 'items' ? 'Products' : id === 'customer' ? 'Customer' : 'Amount / payment'}</dt><dd>{columns.find(column => column.id === id)?.cell(row)}</dd></div>)}</dl>
                <div className={styles.mobileActions}>{columns.find(column => column.id === 'actions')?.cell(row)}</div>
              </article>)}
            </div>
            <footer className={styles.listFooter}>
              {pages > 1 ? <TablePagination noun="orders" onChange={setPage} page={activePage} pages={pages} pageSize={PAGE_SIZE} total={visible.length} /> : <p>Showing {visible.length} {visible.length === 1 ? 'order' : 'orders'}<span>{PERIODS.find(option => option.value === period)?.label}</span></p>}
            </footer>
          </>}
        </section>

      {/* Cancel confirmation. Names the order and spells out both
          consequences, because the seller cannot undo this from here. */}
      <Modal isOpen={cancelModal.isOpen} onOpenChange={cancelModal.onOpenChange} size="md">
        <ModalContent>
          {(close) => (
            <>
              <ModalHeader>
                <div className="font-bold">
                  Cancel {cancelTarget?.orderNumber || 'this order'}?
                </div>
              </ModalHeader>
              <ModalBody className="text-sm text-default-700">
                <p>
                  {cancelTarget?.shippingAddress?.fullName
                    ? `${cancelTarget.shippingAddress.fullName}’s order`
                    : 'This order'} will be cancelled and the customer told it can’t be fulfilled.
                </p>
                <ul className="mt-1 flex flex-col gap-1.5 text-[13px]">
                  <li className="flex gap-2">
                    <span aria-hidden className="text-default-400">•</span>
                    <span>Your stock goes back to inventory.</span>
                  </li>
                  {cancelTarget?.paymentMethod !== 'cod' && (
                    <li className="flex gap-2">
                      <span aria-hidden className="text-default-400">•</span>
                      <span>
                        A refund of <span className="font-semibold">₹{inr(cancelTarget?.myItemsSubtotal || 0)}</span> is raised with admin.
                      </span>
                    </li>
                  )}
                  <li className="flex gap-2">
                    <span aria-hidden className="text-default-400">•</span>
                    <span>You can’t undo this from the dashboard.</span>
                  </li>
                </ul>
              </ModalBody>
              <ModalFooter>
                <Button variant="light" onPress={close}>Keep order</Button>
                <Button
                  className="font-semibold"
                  color="danger"
                  isLoading={rowBusy === (cancelTarget?.orderNumber || cancelTarget?._id)}
                  onPress={confirmCancel}
                >
                  Cancel order
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
      </div>
    </>
  );
}

function PickupSheetIcon() {
  return <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></svg>;
}
