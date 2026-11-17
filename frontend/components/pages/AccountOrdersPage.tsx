'use client';

/**
 * Customer Orders page — `/account/orders`.
 *
 *  - Filter tabs (All / In progress / Delivered / Cancelled) with counts,
 *    and a search across order numbers and product names.
 *  - One row per order: first product's thumbnail and name (+N more), the
 *    order number, date, item count and payment method, the status chip
 *    and the total. Orders split into several parcels list each parcel.
 *  - Delivered orders get a "Rate & review" shortcut to the detail page.
 * Status words come from lib/orderStatusDisplay (customer view), the same
 * vocabulary as the overview and the order detail. The list refreshes
 * quietly while open (useOrderPolling).
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import CustomerShell from '@/components/common/CustomerShell';
import StatusChip from '@/components/ui/StatusChip';
import { AccountHeader, Thumb, primaryButtonClass, secondaryButtonClass } from '@/components/common/AccountUI';
import { customerApi } from '@/lib/customerApi';
import { unwrap } from '@/lib/api';
import { formatDate } from '@/lib/dates';
import { forwardSlices, orderStatusToken, paymentMethodLabel, shipmentDisplayStatus } from '@/lib/orderStatusDisplay';
import { useOrderPolling } from '@/lib/useOrderPolling';

type Order = {
  _id: string;
  orderNumber?: string;
  status: 'placed' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';
  paymentMethod?: string;
  total: number;
  items: { name: string; quantity: number; image?: string }[];
  sellerShipments?: any[];
  createdAt: string;
};
type Page = { items: Order[]; totalItems: number; totalPages: number };

const PAGE_SIZE = 50;
const inr = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);

type Tab = 'all' | 'progress' | 'delivered' | 'cancelled';
const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'progress', label: 'In progress' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'cancelled', label: 'Cancelled' },
];
const inTab = (o: Order, tab: Tab) =>
  tab === 'all' ||
  (tab === 'delivered' && o.status === 'delivered') ||
  (tab === 'cancelled' && o.status === 'cancelled') ||
  (tab === 'progress' && o.status !== 'delivered' && o.status !== 'cancelled');

async function fetchPage(page: number, signal?: AbortSignal): Promise<Page> {
  const res = await customerApi.get('/orders', { params: { page, limit: PAGE_SIZE }, signal });
  const items = unwrap<{ items?: Order[] }>(res).items || [];
  const meta = (res.data?.meta || {}) as { totalItems?: number; totalPages?: number };
  return { items, totalItems: meta.totalItems ?? items.length, totalPages: meta.totalPages ?? 1 };
}

/** Fresh first page over what is already loaded: updated rows in place, new orders on top. */
function mergeFresh(current: Order[], fresh: Order[]): Order[] {
  const byId = new Map(fresh.map((o) => [o._id, o]));
  const known = new Set(current.map((o) => o._id));
  return [...fresh.filter((o) => !known.has(o._id)), ...current.map((o) => byId.get(o._id) || o)];
}

export default function AccountOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [tab, setTab] = useState<Tab>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchPage(1)
      .then((p) => {
        setOrders(p.items);
        setTotal(p.totalItems);
        setPages(p.totalPages);
        setState('ready');
      })
      .catch(() => setState('failed'));
  }, []);

  useOrderPolling(async (signal) => {
    const p = await fetchPage(1, signal);
    setOrders((current) => mergeFresh(current, p.items));
    setTotal(p.totalItems);
  });

  async function loadMore() {
    setLoadingMore(true);
    try {
      const p = await fetchPage(page + 1);
      setOrders((current) => [...current, ...p.items.filter((o) => !current.some((c) => c._id === o._id))]);
      setPage(page + 1);
      setPages(p.totalPages);
    } finally {
      setLoadingMore(false);
    }
  }

  const counts = useMemo(() => {
    const out: Record<Tab, number> = { all: orders.length, progress: 0, delivered: 0, cancelled: 0 };
    for (const o of orders) {
      if (o.status === 'delivered') out.delivered++;
      else if (o.status === 'cancelled') out.cancelled++;
      else out.progress++;
    }
    return out;
  }, [orders]);

  const q = search.trim().toLowerCase();
  const shown = useMemo(
    () =>
      orders.filter(
        (o) =>
          inTab(o, tab) &&
          (!q ||
            (o.orderNumber || '').toLowerCase().includes(q) ||
            o.items.some((i) => (i.name || '').toLowerCase().includes(q))),
      ),
    [orders, tab, q],
  );

  const description =
    state !== 'ready' ? 'Track, review and reorder' : total === 0 ? 'Nothing ordered yet' : `${total} order${total === 1 ? '' : 's'} placed`;

  return (
    <CustomerShell>
      <AccountHeader title="Orders" description={description} />

      {state === 'ready' && orders.length > 0 && (
        <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div role="group" aria-label="Filter orders" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 [scrollbar-width:none]">
            {TABS.map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setTab(t.key)}
                  className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-3.5 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#59656f] ${
                    active ? 'border-[#191d21] bg-[#191d21] text-white' : 'border-[#e2e7eb] bg-white text-[#303942] hover:border-[#c9d1d8]'
                  }`}
                >
                  {t.label}
                  <span className={`tabular-nums ${active ? 'text-white/70' : 'text-[#9aa3ab]'}`}>{counts[t.key]}</span>
                </button>
              );
            })}
          </div>
          <label className="relative block md:max-w-sm xl:w-72 xl:shrink-0">
            <span className="sr-only">Search orders</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa3ab]" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Order number or product"
              className="h-10 w-full rounded-lg border border-[#e2e7eb] bg-white pl-9 pr-3 text-[13px] text-[#252c32] placeholder:text-[#9aa3ab] hover:border-[#c9d1d8] focus:border-[#59656f] focus:outline-none"
            />
          </label>
        </div>
      )}

      {state === 'loading' ? (
        <ul className="overflow-hidden rounded-2xl border border-[#e3e7eb] bg-white" aria-busy="true" aria-label="Loading orders">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center gap-4 border-t border-[#edf0f2] px-5 py-4 first:border-t-0">
              <div className="h-16 w-16 animate-pulse rounded-lg bg-[#f0f2f4]" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-1/2 animate-pulse rounded bg-[#f0f2f4]" />
                <div className="h-3 w-1/3 animate-pulse rounded bg-[#f0f2f4]" />
              </div>
            </li>
          ))}
        </ul>
      ) : state === 'failed' ? (
        <EmptyState
          title="Couldn't load your orders"
          text="Check your connection and try again."
          action={
            <button type="button" className={secondaryButtonClass} onClick={() => window.location.reload()}>
              Try again
            </button>
          }
        />
      ) : orders.length === 0 ? (
        <EmptyState
          title="No orders yet"
          text="Your orders will show up here once you check out."
          action={
            <Link href="/" className={primaryButtonClass}>
              Start shopping
            </Link>
          }
        />
      ) : shown.length === 0 ? (
        <EmptyState
          title={q ? 'No orders match that search' : 'No orders here'}
          text={q ? 'Try an order number or another product name.' : 'Try another filter.'}
          action={
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={() => {
                setSearch('');
                setTab('all');
              }}
            >
              Show all orders
            </button>
          }
        />
      ) : (
        <>
          <ul className="overflow-hidden rounded-2xl border border-[#e3e7eb] bg-white">
            {shown.map((o) => (
              <OrderRow key={o._id} order={o} />
            ))}
          </ul>
          {page < pages && (
            <div className="mt-4 flex justify-center">
              <button type="button" className={secondaryButtonClass} onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : 'Show older orders'}
              </button>
            </div>
          )}
        </>
      )}
    </CustomerShell>
  );
}

/* ─── One order ────────────────────────────────────────────────────── */

function OrderRow({ order }: { order: Order }) {
  const href = `/account/orders/${order.orderNumber || order._id}`;
  const status = orderStatusToken(order as any, null, 'customer');
  const first = order.items[0];
  const more = order.items.length - 1;
  const units = order.items.reduce((s, i) => s + (i.quantity || 0), 0);
  const parcels = forwardSlices(order as any);

  return (
    // The order number link stretches over the whole row; the review link sits above it.
    <li className="relative border-t border-[#edf0f2] px-5 py-4 transition first:border-t-0 hover:bg-[#fafbfc] focus-within:bg-[#fafbfc]">
      <div className="flex gap-4">
        <Thumb src={first?.image} alt="" size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-[#252c32]">
                {first?.name || 'Order'}
                {more > 0 && <span className="font-normal text-[#74808a]"> +{more} more</span>}
              </p>
              <p className="mt-1 text-xs text-[#74808a]">
                <Link
                  href={href}
                  className="font-medium tabular-nums text-[#39434c] after:absolute after:inset-0 focus-visible:outline-none"
                  aria-label={`Order ${order.orderNumber || ''}, ${status.label}`}
                >
                  {order.orderNumber || 'View order'}
                </Link>
                {' · '}
                {formatDate(order.createdAt)}
                {' · '}
                {units} item{units === 1 ? '' : 's'}
                {order.paymentMethod && <> · {paymentMethodLabel(order.paymentMethod)}</>}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-end sm:gap-1.5">
              <StatusChip label={status.label} status={status.key} />
              <span className="text-sm font-semibold tabular-nums text-[#252c32]">₹{inr(order.total)}</span>
            </div>
          </div>

          {parcels.length > 1 && (
            <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#5d6871]">
              {parcels.map((s: any, i: number) => (
                <li key={s._id || i}>
                  Parcel {i + 1}: <span className="font-medium text-[#39434c]">{shipmentDisplayStatus(s, 'customer')}</span>
                </li>
              ))}
            </ul>
          )}

          {order.status === 'delivered' && (
            <Link
              href={`${href}#review`}
              className="relative z-10 mt-2.5 inline-flex items-center gap-1.5 rounded text-xs font-semibold text-[#53632d] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#59656f]"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5" aria-hidden>
                <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" />
              </svg>
              Rate &amp; review
            </Link>
          )}
        </div>
      </div>
    </li>
  );
}

function EmptyState({ title, text, action }: { title: string; text: string; action: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-[#d5dbe0] bg-white px-6 py-12 text-center">
      <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-[#f3f4f2] text-[#59656f]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-5 w-5" aria-hidden>
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <path d="M3.3 7 12 12l8.7-5M12 22V12" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <p className="text-sm font-semibold text-[#252c32]">{title}</p>
      <p className="mx-auto mt-1 max-w-xs text-[13px] text-[#74808a]">{text}</p>
      <div className="mt-4 flex justify-center">{action}</div>
    </div>
  );
}
