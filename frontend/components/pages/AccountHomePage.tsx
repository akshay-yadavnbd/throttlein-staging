'use client';

/**
 * Customer account home (overview). The banner above (CustomerShell) already
 * says who is signed in and the four counts, so this page is about what to
 * do next:
 *  - a cart nudge when items are waiting to be checked out,
 *  - the latest order front and centre, with where it is on its way,
 *  - earlier orders, one line each,
 *  - the delivery address, account details and help, each one click from
 *    being changed.
 * Status words come from lib/orderStatusDisplay (customer view), the same
 * vocabulary as the orders list.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import CustomerShell from '@/components/common/CustomerShell';
import StatusChip from '@/components/ui/StatusChip';
import { Thumb, panelLinkClass, primaryButtonClass, secondaryButtonClass } from '@/components/common/AccountUI';
import { customerApi } from '@/lib/customerApi';
import { imageUrl, unwrap } from '@/lib/api';
import { getStoredCustomer, type CustomerUser } from '@/lib/customerAuth';
import { formatDate, formatDayMonth } from '@/lib/dates';
import { orderStatusToken, type StatusKey } from '@/lib/orderStatusDisplay';

type OrderItem = { name?: string; image?: string; quantity?: number };
type Order = {
  _id: string;
  orderNumber?: string;
  status: string;
  total?: number;
  createdAt?: string;
  items: OrderItem[];
  sellerShipments?: any[];
};
type CartLine = { product?: { name?: string; images?: string[] }; quantity?: number; availability?: { state?: string } };
type Address = {
  _id: string;
  label?: string;
  fullName?: string;
  phone?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  isDefault?: boolean;
};
type Overview = { orders: Order[]; cart: CartLine[]; addresses: Address[] };

const inr = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n || 0);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const isBuyable = (l: CartLine) => (l.availability?.state ?? 'ok') === 'ok';
const orderHref = (o: Order) => `/account/orders/${o.orderNumber || o._id}`;

export default function AccountHomePage() {
  const [data, setData] = useState<Overview | null>(null);
  const [failed, setFailed] = useState(false);
  const [user, setUser] = useState<CustomerUser | null>(null);

  useEffect(() => {
    Promise.all([customerApi.get('/orders', { params: { limit: 5 } }), customerApi.get('/cart'), customerApi.get('/addresses')])
      .then(([o, c, a]) => {
        setUser(getStoredCustomer());
        setData({
          orders: unwrap<{ items?: Order[] }>(o).items || [],
          cart: unwrap<any>(c).cart?.items || [],
          addresses: unwrap<any>(a).addresses || [],
        });
      })
      .catch(() => {
        setUser(getStoredCustomer());
        setFailed(true);
      });
  }, []);

  const ready = data?.cart.filter(isBuyable) || [];
  const readyUnits = ready.reduce((sum, l) => sum + (l.quantity || 1), 0);
  const defaultAddress = data?.addresses.find((a) => a.isDefault) || data?.addresses[0];
  const [latest, ...earlier] = data?.orders || [];
  const loading = !data && !failed;

  return (
    <CustomerShell>
      <h1 className="sr-only">Account overview</h1>
      {failed && (
        <div role="alert" className="mb-5 rounded-xl border border-[#f0d6d2] bg-[#fff6f4] px-4 py-3 text-[13px] text-[#8c3a2e]">
          Couldn’t load your account summary · refresh to try again
        </div>
      )}

      {/* CART NUDGE — the one thing worth doing next */}
      {ready.length > 0 && (
        <section className="mb-5 flex flex-wrap items-center gap-4 rounded-2xl border border-[#e3e7eb] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:p-5">
          <div className="flex -space-x-3">
            {ready.slice(0, 3).map((l, i) => (
              <span key={i} className="rounded-xl ring-2 ring-white">
                <Thumb src={l.product?.images?.[0]} alt="" size="sm" />
              </span>
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[#252c32]">{plural(readyUnits, 'item')} waiting in your cart</p>
            <p className="mt-0.5 truncate text-xs text-[#74808a]">
              {ready[0].product?.name}
              {ready.length > 1 ? ` and ${plural(ready.length - 1, 'more product')}` : ''}
            </p>
          </div>
          <Link href="/cart" className={`${primaryButtonClass} w-full sm:w-auto`}>
            Go to checkout
            <ArrowIcon />
          </Link>
        </section>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* ORDERS */}
        <div className="flex min-w-0 flex-col gap-5">
          {loading ? (
            <div className="rounded-2xl border border-[#e3e7eb] bg-white p-5" aria-busy="true" aria-label="Loading orders">
              <div className="h-3.5 w-28 animate-pulse rounded bg-[#f0f2f4]" />
              <div className="mt-5 flex gap-4">
                <div className="h-16 w-16 animate-pulse rounded-lg bg-[#f0f2f4]" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-2/3 animate-pulse rounded bg-[#f0f2f4]" />
                  <div className="h-3 w-1/3 animate-pulse rounded bg-[#f0f2f4]" />
                </div>
              </div>
              <div className="mt-6 h-2 w-full animate-pulse rounded bg-[#f0f2f4]" />
            </div>
          ) : latest ? (
            <LatestOrder order={latest} />
          ) : data ? (
            <section className="rounded-2xl border border-[#e3e7eb] bg-white px-6 py-12 text-center">
              <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-[#f3f4f2] text-[#59656f]">
                <ParcelIcon />
              </div>
              <p className="text-sm font-semibold text-[#252c32]">No orders yet</p>
              <p className="mx-auto mt-1 max-w-xs text-[13px] text-[#74808a]">Your orders show up here, with tracking, once you place one.</p>
              <Link href="/" className={`${primaryButtonClass} mt-4`}>
                Start shopping
              </Link>
            </section>
          ) : null}

          {earlier.length > 0 && (
            <section className="overflow-hidden rounded-2xl border border-[#e3e7eb] bg-white">
              <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-5">
                <h2 className="text-sm font-semibold text-[#252c32]">Earlier orders</h2>
                <Link href="/account/orders" className={panelLinkClass}>
                  View all
                </Link>
              </div>
              <ul>
                {earlier.slice(0, 4).map((o) => (
                  <OrderRow key={o._id} order={o} />
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* SIDE COLUMN */}
        <div className="flex min-w-0 flex-col gap-5">
          <SideCard title="Delivery address" action={<Link href="/account/addresses" className={panelLinkClass}>{defaultAddress ? 'Manage' : 'Add'}</Link>}>
            {loading ? (
              <div className="space-y-2" aria-busy="true">
                <div className="h-3 w-1/2 animate-pulse rounded bg-[#f0f2f4]" />
                <div className="h-3 w-5/6 animate-pulse rounded bg-[#f0f2f4]" />
              </div>
            ) : defaultAddress ? (
              <address className="not-italic text-[13px] leading-relaxed text-[#5d6871]">
                <span className="flex items-center gap-2">
                  <span className="font-semibold text-[#252c32]">{defaultAddress.fullName}</span>
                  {defaultAddress.label && (
                    <span className="rounded bg-[#eef0f2] px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-[#59656f]">
                      {defaultAddress.label}
                    </span>
                  )}
                </span>
                <span className="block">{[defaultAddress.line1, defaultAddress.line2].filter(Boolean).join(', ')}</span>
                <span className="block">
                  {[defaultAddress.city, defaultAddress.state].filter(Boolean).join(', ')} {defaultAddress.pincode}
                </span>
                {defaultAddress.phone && <span className="mt-1 block tabular-nums text-[#74808a]">{defaultAddress.phone}</span>}
              </address>
            ) : (
              <p className="text-[13px] text-[#74808a]">No address yet. Add one and checkout takes a tap.</p>
            )}
          </SideCard>

          <SideCard title="Account" action={<Link href="/account/profile" className={panelLinkClass}>Edit</Link>}>
            <dl className="grid gap-2 text-[13px]">
              <Detail label="Name" value={user?.name} />
              <Detail label="Email" value={user?.email} />
              <Detail label="Phone" value={user?.phone} />
            </dl>
            {user && !user.phone && (
              <Link
                href="/account/profile"
                className="mt-4 flex items-center gap-3 rounded-xl bg-[#f6f7f5] px-3 py-2.5 text-xs text-[#39434c] transition hover:bg-[#eef0ec]"
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white text-[#141414] shadow-sm">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5" aria-hidden>
                    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" strokeLinejoin="round" />
                  </svg>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-[#252c32]">Add your phone number</span>
                  Couriers call it about deliveries.
                </span>
                <ArrowIcon />
              </Link>
            )}
          </SideCard>

          <SideCard title="Need help?">
            <ul className="-mx-2 grid gap-0.5 text-[13px]">
              <HelpLink href="/account/orders" title="Track, return or cancel" text="Open an order to see its options" />
              <HelpLink href="/faqs" title="FAQs" text="Delivery, payments and returns" />
              <HelpLink href="/contact" title="Contact us" text="We reply within a working day" />
            </ul>
          </SideCard>
        </div>
      </div>
    </CustomerShell>
  );
}

/* ─── Latest order ─────────────────────────────────────────────────── */

const STEPS = ['Placed', 'Confirmed', 'Shipped', 'Delivered'] as const;

/** Where an order is on the happy path, or null when it left it (cancelled, returned, lost…). */
function stepOf(order: Order, key: StatusKey): number | null {
  const byKey: Partial<Record<StatusKey, number>> = {
    placed: 0,
    confirmed: 1,
    awaiting_pickup: 1,
    pickup_failed: 1,
    in_transit: 2,
    out_for_delivery: 2,
    delivery_failed: 2,
    delivered: 3,
  };
  if (key in byKey) return byKey[key]!;
  if (key === 'multiple') return ({ placed: 0, confirmed: 1, shipped: 2, delivered: 3 } as Record<string, number>)[order.status] ?? 0;
  return null;
}

function LatestOrder({ order }: { order: Order }) {
  const status = orderStatusToken(order as any, null, 'customer');
  const step = stepOf(order, status.key);
  const items = order.items || [];
  const units = items.reduce((s, i) => s + (i.quantity || 1), 0);

  return (
    <section className="overflow-hidden rounded-2xl border border-[#e3e7eb] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="flex items-center justify-between gap-3 border-b border-[#edf0f2] px-5 py-3.5">
        <h2 className="text-sm font-semibold text-[#252c32]">Latest order</h2>
        <StatusChip label={status.label} status={status.key} />
      </div>

      <div className="p-5">
        <div className="flex gap-4">
          <div className="flex shrink-0 -space-x-4">
            {items.slice(0, 3).map((it, i) => (
              <span key={i} className="rounded-xl ring-2 ring-white" style={{ zIndex: 3 - i }}>
                <OrderImage src={it.image} />
              </span>
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-sm font-semibold leading-snug text-[#252c32]">
              {items[0]?.name || 'Order'}
              {items.length > 1 && <span className="font-normal text-[#74808a]"> +{items.length - 1} more</span>}
            </p>
            <p className="mt-1 text-xs text-[#74808a]">
              <span className="tabular-nums">{order.orderNumber}</span>
              {order.createdAt && <> · {formatDate(order.createdAt)}</>} · {plural(units, 'item')}
            </p>
            {typeof order.total === 'number' && (
              <p className="mt-2 text-lg font-semibold tabular-nums tracking-[-0.02em] text-[#252c32]">₹{inr(order.total)}</p>
            )}
          </div>
        </div>

        {step !== null ? (
          <ol className="mt-6 grid grid-cols-4" aria-label="Order progress">
            {STEPS.map((label, i) => {
              const done = i <= step;
              return (
                <li key={label} className="relative flex flex-col items-center text-center" aria-current={i === step ? 'step' : undefined}>
                  {i > 0 && (
                    <span aria-hidden className={`absolute right-1/2 top-[7px] h-0.5 w-full ${i <= step ? 'bg-[#141414]' : 'bg-[#e3e7eb]'}`} />
                  )}
                  <span
                    aria-hidden
                    className={`relative grid h-4 w-4 place-items-center rounded-full ${
                      done ? 'bg-[#141414]' : 'border-2 border-[#d5dbe0] bg-white'
                    } ${i === step && step < 3 ? 'ring-4 ring-[#141414]/10' : ''}`}
                  >
                    {done && (
                      <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4" className="h-2.5 w-2.5">
                        <path d="m5 12 5 5 9-10" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  <span className={`mt-2 text-[11px] ${done ? 'font-semibold text-[#252c32]' : 'text-[#9aa3ab]'}`}>{label}</span>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="mt-5 rounded-lg bg-[#f6f7f9] px-3 py-2.5 text-xs text-[#5d6871]">
            {status.key === 'cancelled'
              ? 'This order was cancelled. Any payment made is refunded to the original method.'
              : 'Open the order to see what happened and what’s next.'}
          </p>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <Link href={orderHref(order)} className={primaryButtonClass}>
            {step !== null && step < 3 ? 'Track order' : 'View order'}
            <ArrowIcon />
          </Link>
          {status.key === 'delivered' && (
            <Link href={`${orderHref(order)}#review`} className={secondaryButtonClass}>
              Rate &amp; review
            </Link>
          )}
          <Link href="/account/orders" className={secondaryButtonClass}>
            All orders
          </Link>
        </div>
      </div>
    </section>
  );
}

function OrderImage({ src }: { src?: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className="grid h-16 w-16 place-items-center overflow-hidden rounded-xl border border-[#edf0f2] bg-[#f6f7f9]">
      {src && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl(src)}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setBroken(true)}
          // An image that failed before React attached onError (first paint) is caught here.
          ref={(el) => {
            if (el?.complete && el.naturalWidth === 0) setBroken(true);
          }}
        />
      ) : (
        <ParcelIcon />
      )}
    </div>
  );
}

/* ─── building blocks ─────────────────────────────────────────────── */

function OrderRow({ order }: { order: Order }) {
  const status = orderStatusToken(order as any, null, 'customer');
  const items = order.items || [];
  const first = items[0];
  const more = items.length - 1;
  return (
    <li className="border-t border-[#edf0f2]">
      <Link
        href={orderHref(order)}
        className="flex items-center gap-3 px-5 py-3.5 transition hover:bg-[#fafbfc] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#59656f]"
      >
        <Thumb src={first?.image} alt="" size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-[#252c32]">
            {first?.name || 'Order'}
            {more > 0 && <span className="font-normal text-[#74808a]"> +{more} more</span>}
          </p>
          <p className="mt-0.5 text-xs text-[#74808a]">
            <span className="tabular-nums">{order.orderNumber || 'Order'}</span>
            {order.createdAt && <> · {formatDayMonth(order.createdAt)}</>}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <StatusChip label={status.label} status={status.key} />
          {typeof order.total === 'number' && (
            <span className="text-[13px] font-semibold tabular-nums text-[#252c32]">₹{inr(order.total)}</span>
          )}
        </div>
      </Link>
    </li>
  );
}

function SideCard({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#e3e7eb] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-[#252c32]">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function HelpLink({ href, title, text }: { href: string; title: string; text: string }) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-[#f6f7f5] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#59656f]"
      >
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-[#252c32]">{title}</span>
          <span className="block truncate text-xs text-[#74808a]">{text}</span>
        </span>
        <ArrowIcon />
      </Link>
    </li>
  );
}

function Detail({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[#74808a]">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium text-[#252c32]">{value || '—'}</dd>
    </div>
  );
}

function ParcelIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-5 w-5 text-[#9aa3ab]" aria-hidden>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <path d="M3.3 7 12 12l8.7-5M12 22V12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5 shrink-0" aria-hidden>
      <path d="M5 12h14M13 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
