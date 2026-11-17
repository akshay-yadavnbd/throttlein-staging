'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Arrow from '@/components/common/Arrow';
import SellerSelect from '@/components/common/SellerSelect';
import { Card, CardBody } from '@heroui/react';
import Button from '@/components/common/SellerButton';
import {
  ResponsiveContainer, AreaChart, CartesianGrid, XAxis, YAxis,
  Tooltip, Area,
} from 'recharts';
import { StatusChip } from '@/components/ui';
import { api, unwrap } from '@/lib/api';
import { getStoredUser } from '@/lib/auth';
import { startNewProductDraft } from '@/lib/productCreateDraft';
import { formatDayMonth } from '@/lib/dates';
import { useKycStatus } from '@/lib/kyc';
import { orderStatusToken, paymentMethodLabel } from '@/lib/orderStatusDisplay';
import { useSellerAttention, type SellerAttention } from '@/lib/useSellerAttention';
import styles from './DashboardHome.module.css';

/* ──────────────────────────────────────────────────────────────────────── */
/* Types                                                                    */
/* ──────────────────────────────────────────────────────────────────────── */

type Product = {
  _id: string;
  slug?: string;
  name: string;
  category?: string | { _id: string; name: string };
  price: number;
  stock: number;
  status: 'draft' | 'active' | 'rejected' | 'out_of_stock';
  isFeatured: boolean;
  images?: string[];
  listingImage?: string;
  createdAt: string;
};

type OrderItem = {
  name: string;
  price: number;
  quantity: number;
  subtotal: number;
};

type Order = {
  _id: string;
  orderNumber: string;
  status: 'placed' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';
  paymentMethod: string;
  paymentStatus: string;
  items: OrderItem[];
  myItemsSubtotal: number;
  shippingAddress?: { fullName?: string; city?: string; state?: string };
  createdAt: string;
  sellerShipments?: any[];
  fulfillmentHold?: string;
};

/* ──────────────────────────────────────────────────────────────────────── */
/* Helpers                                                                  */
/* ──────────────────────────────────────────────────────────────────────── */

const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);

function bucketByDay(orders: Order[], days: number) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const buckets: { date: Date; label: string; revenue: number; orders: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    buckets.push({
      date: d,
      label: d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }),
      revenue: 0,
      orders: 0,
    });
  }
  orders.forEach((o) => {
    if (o.status === 'cancelled') return;
    const created = new Date(o.createdAt);
    created.setHours(0, 0, 0, 0);
    const idx = buckets.findIndex((b) => b.date.getTime() === created.getTime());
    if (idx === -1) return;
    buckets[idx].revenue += o.myItemsSubtotal || 0;
    buckets[idx].orders += 1;
  });
  return buckets;
}
/* ──────────────────────────────────────────────────────────────────────── */
/* Page                                                                     */
/* ──────────────────────────────────────────────────────────────────────── */

export default function DashboardHomePage() {
  const [orderView, setOrderView] = useState<'all' | 'in_transit' | 'awaiting_pickup'>('all');
  const [period, setPeriod] = useState<7 | 30>(30);
  const [chartView, setChartView] = useState<'revenue' | 'orders'>('revenue');
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [me, setMe] = useState<{ name?: string; storeName?: string } | null>(null);
  const { kyc, accountStatus, loading: kycLoading } = useKycStatus();
  const attention = useSellerAttention();

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(false);
      const cachedUser = getStoredUser();
      if (cachedUser) setMe(cachedUser);
      try {
        const [, catalogue, sales] = await Promise.all([
          api.get('/auth/me').then((r) => {
            if (!cancelled) setMe(unwrap<{ user?: any }>(r).user || null);
          }), api.get('/products/mine'), api.get('/seller/orders'),
        ]);
        if (cancelled) return;
        setProducts(unwrap<{ items?: any[] }>(catalogue).items || []);
        setOrders(unwrap<{ items?: any[] }>(sales).items || []);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [attempt]);

  const chartData = useMemo(() => bucketByDay(orders, period), [orders, period]);
  const totals = useMemo(() => chartData.reduce((sum, day) => ({
    revenue: sum.revenue + day.revenue, orders: sum.orders + day.orders,
  }), { revenue: 0, orders: 0 }), [chartData]);
  const outOfStock = products.filter(p => p.stock === 0).length;
  const activeProducts = products.filter(p => p.status === 'active').length;
  const lowStock = products.filter(p => p.stock > 0 && p.stock <= 5);
  const inTransit = orders.filter(o => orderStatusToken(o).key === 'in_transit').length;
  const awaitingPickup = orders.filter(o => orderStatusToken(o).key === 'awaiting_pickup').length;
  const matchingOrders = orders.filter(o => orderView === 'all' || orderStatusToken(o).key === orderView);
  const recentOrders = [...matchingOrders].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 5);

  return (
    <>
      <div className={styles.dashboard}>
        <header className={styles.header}>
          {loading ? <div className={styles.headingSkeleton} aria-hidden="true"><span className={styles.skeletonBar} style={{width:180}} /><span className={styles.nameSkeleton} /><span className={styles.skeletonBar} style={{width:280,maxWidth:'100%'}} /></div> : <div><p className={styles.eyebrow}>YOUR BUSINESS AT A GLANCE</p><h1>{me?.storeName || me?.name || 'Store overview'}</h1><p>Welcome back. Let’s get your store moving.</p></div>}
          <Link className={styles.primaryAction} href="/dashboard/products/new" onNavigate={startNewProductDraft}><span aria-hidden>＋</span> Add product</Link>
        </header>
        {loading ? <OverviewSkeleton /> : error ? (
          <section className={styles.error} role="alert"><IconAlert /><h2>We couldn’t load your store overview</h2><p>Your store data is unavailable. Try again to get the latest numbers.</p><button type="button" onClick={() => setAttempt(value => value + 1)}>Try again</button></section>
        ) : <>
          {!kycLoading && <KycBanner status={kyc.status} reason={kyc.rejectionReason} accountStatus={accountStatus} />}
          <div className={styles.sectionHeading}>
            <h2>Store snapshot</h2>
            <div className={styles.period}><span>Sales period</span><SellerSelect ariaLabel="Sales period" value={String(period)} onChange={value => setPeriod(Number(value) as 7 | 30)} options={[{ value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }]} /></div>
          </div>
          <div className={styles.metrics}>
            <KpiCard label="Sales revenue" value={`₹${inr(totals.revenue)}`} hint={`Last ${period} days · excludes cancellations`} icon={<IconRupee />} featured />
            <KpiCard label="Orders received" value={inr(totals.orders)} hint={`Last ${period} days · excludes cancellations`} icon={<IconBag />} />
            <KpiCard label="Active products" value={inr(activeProducts)} hint={`${inr(products.length)} products in your catalogue`} icon={<IconBox />} />
            <KpiCard label="Out of stock" value={inr(outOfStock)} hint={outOfStock ? 'Restock to keep selling' : 'No products need restocking'} icon={<IconAlert />} href="/dashboard/products" />
          </div>
          <ActionNeeded attention={attention} inTransit={inTransit} onViewTransit={() => {
            setOrderView('in_transit');
            document.getElementById('latest-orders-heading')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }} />
          <div className={styles.insights}>
            <section className={styles.chartPanel} aria-labelledby="performance-heading">
              <div className={styles.panelHeader}><div><h2 id="performance-heading">Sales performance</h2><p>How your store is doing over the last {period} days</p></div><div className={styles.segmented} role="group" aria-label="Chart metric"><button type="button" aria-pressed={chartView === 'revenue'} onClick={() => setChartView('revenue')}>Revenue</button><button type="button" aria-pressed={chartView === 'orders'} onClick={() => setChartView('orders')}>Orders</button></div></div>
              <div className={styles.chartTotal}><strong>{chartView === 'revenue' ? `₹${inr(totals.revenue)}` : inr(totals.orders)}</strong><span>{chartView === 'revenue' ? 'Sales revenue' : 'Orders received'}</span></div>
              {totals.orders === 0 ? <div className={styles.emptyChart}><IconBag /><h3>No sales in this period yet</h3><p>Your sales trend will appear when orders start coming in.</p><Link href="/dashboard/products">Review your catalogue <Arrow /></Link></div> : <div className={styles.chart} role="img" aria-label={`${chartView === 'revenue' ? 'Daily sales revenue' : 'Daily order count'} for the last ${period} days. Total ${chartView === 'revenue' ? `₹${inr(totals.revenue)}` : totals.orders}.`}>
                <ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
                  <defs><linearGradient id="sellerRevenueFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#96c827" stopOpacity={0.24} /><stop offset="100%" stopColor="#96c827" stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid stroke="#edf0f2" strokeDasharray="4 4" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: '#78828c', fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={30} />
                  <YAxis tick={{ fill: '#78828c', fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} width={64} tickFormatter={(value: number) => chartView === 'revenue' ? `₹${inr(value)}` : inr(value)} />
                  <Tooltip contentStyle={{ border: '1px solid #e6e9ed', borderRadius: 10, fontSize: 12 }} formatter={(value) => [chartView === 'revenue' ? `₹${inr(Number(value))}` : inr(Number(value)), chartView === 'revenue' ? 'Revenue' : 'Orders']} />
                  <Area type="linear" dataKey={chartView} stroke="#6a9214" strokeWidth={2.5} fill="url(#sellerRevenueFill)" activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }} />
                </AreaChart></ResponsiveContainer>
              </div>}
              <p className={styles.chartNote}>Based on order subtotals. Cancelled orders are excluded.</p>
            </section>
            <section className={styles.inventoryPanel} aria-labelledby="inventory-heading">
              <div className={styles.panelHeader}><div><h2 id="inventory-heading">Catalogue health</h2><p>A little upkeep goes a long way.</p></div><span className={styles.inventoryIcon}><IconBox /></span></div>
              <div className={styles.inventorySummary}><strong>{activeProducts}<span> / {products.length}</span></strong><p>products active</p><div className={styles.progress} role="progressbar" aria-label="Active products" aria-valuenow={activeProducts} aria-valuemin={0} aria-valuemax={products.length || 1}><span style={{ width: `${products.length ? activeProducts / products.length * 100 : 0}%` }} /></div></div>
              <dl className={styles.stockList}><div><dt><i className={styles.warningDot} />Low stock <small>5 units or fewer</small></dt><dd>{lowStock.length}</dd></div><div><dt><i className={styles.dangerDot} />Out of stock</dt><dd>{outOfStock}</dd></div><div><dt><i />Drafts</dt><dd>{products.filter(p => p.status === 'draft').length}</dd></div></dl>
              <Link className={styles.inventoryLink} href="/dashboard/products">Manage catalogue <Arrow /></Link>
            </section>
          </div>
          <section className={styles.ordersPanel} aria-labelledby="latest-orders-heading">
            <div className={styles.panelHeader}><div><h2 id="latest-orders-heading">Recent orders</h2><p>Your latest activity, ready for the next step.</p></div><Link href="/dashboard/orders">View all orders <Arrow /></Link></div>
            <div className={styles.orderFilters} role="group" aria-label="Filter dashboard orders">
              {([{ key: 'all', label: 'All orders', count: orders.length }, { key: 'awaiting_pickup', label: 'Awaiting pickup', count: awaitingPickup }, { key: 'in_transit', label: 'In transit', count: inTransit }] as const).map(filter => <button key={filter.key} type="button" aria-pressed={orderView === filter.key} onClick={() => setOrderView(filter.key)}>{filter.label}<span>{filter.count}</span></button>)}
            </div>
            {recentOrders.length === 0 ? <div className={styles.emptyOrders}><span className={styles.emptyIcon}><IconBag /></span><h3>{orderView === 'all' ? 'Ready for your first order' : orderView === 'in_transit' ? 'No orders in transit' : 'No orders awaiting pickup'}</h3><p>{orderView === 'all' ? 'Keep your products up to date. New orders will appear here.' : 'You’re up to date. Orders matching this status will appear here.'}</p>{orderView === 'all' ? <Link href="/dashboard/products">Manage products <Arrow /></Link> : <button type="button" onClick={() => setOrderView('all')}>Show all orders</button>}</div> : <div className={styles.tableScroll}><table className={styles.ordersTable}>
              <caption className="sr-only">Most recent seller orders: {orderView.replaceAll('_', ' ')}</caption><thead><tr><th scope="col">Order</th><th scope="col">Customer</th><th scope="col">Status</th><th scope="col" className={styles.amount}>Amount</th><th scope="col"><span className="sr-only">Details</span></th></tr></thead>
              <tbody>{recentOrders.map(order => { const status = orderStatusToken(order); const units = order.items.reduce((sum, item) => sum + item.quantity, 0); return <tr key={order._id}><td><Link className={styles.orderLink} href={`/dashboard/orders/${order.orderNumber || order._id}`}>{order.orderNumber || 'View order'}</Link><small>{formatDayMonth(order.createdAt)} · {units} {units === 1 ? 'item' : 'items'}</small></td><td>{order.shippingAddress?.fullName || 'Customer'}<small>{[order.shippingAddress?.city, order.shippingAddress?.state].filter(Boolean).join(', ') || '—'}</small></td><td><StatusChip label={status.label} status={status.key} /></td><td className={styles.amount}><strong>₹{inr(order.myItemsSubtotal || 0)}</strong><small>{paymentMethodLabel(order.paymentMethod)}</small></td><td><Link className={styles.detailLink} aria-label={`Open order ${order.orderNumber || order._id}`} href={`/dashboard/orders/${order.orderNumber || order._id}`}><Arrow /></Link></td></tr>; })}</tbody>
            </table></div>}
            {matchingOrders.length > 5 && <p className={styles.listNote}>Showing 5 of {matchingOrders.length} orders. <Link href="/dashboard/orders">View all orders <Arrow /></Link></p>}
          </section>
        </>}
      </div>
    </>
  );
}

const ACTION_CARDS: { key: keyof Omit<SellerAttention, 'total'>; label: string; hint: string; href: string }[] = [
  { key: 'toShip',         label: 'To ship',          hint: 'Confirm and book the courier',   href: '/dashboard/orders?tab=to_ship' },
  { key: 'pickupFailed',   label: 'Pickup failed',    hint: 'Book the pickup again',          href: '/dashboard/orders?tab=issues' },
  { key: 'deliveryIssues', label: 'Delivery issues',  hint: 'Tell the courier what to do',    href: '/dashboard/ndr' },
  { key: 'returnsPending', label: 'Returns waiting',  hint: 'Approve or decline',             href: '/dashboard/return-requests' },
];

function ActionNeeded({ attention, inTransit, onViewTransit }: { attention: SellerAttention | null; inTransit: number; onViewTransit: () => void }) {
  return (
    <section aria-labelledby="action-needed" className={styles.attention}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground" id="action-needed">Your to-do list <span className={styles.taskBadge}>{attention ? attention.total : '…'}</span></h2>
        {attention && attention.total === 0 && (
          <p className="text-sm text-muted">All caught up. Nice work.</p>
        )}
      </div>
      <div className={styles.taskGrid}>
        {ACTION_CARDS.map((c) => {
          const n = attention ? attention[c.key] : null;
          const hot = (n ?? 0) > 0;
          return (
            <Link
              key={c.key}
              data-active={hot}
              data-urgent={hot && c.key !== 'toShip'}
              aria-label={n == null ? c.label : `${c.label}: ${n}`}
              className={`${styles.task} group flex flex-col rounded-2xl border p-4 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                hot
                  ? 'border-danger/30 bg-danger-soft hover:border-danger/60'
                  : 'border-border bg-surface hover:bg-surface-tertiary'
              }`}
              href={c.href}
            >
              <span className={`text-3xl font-semibold tabular-nums tracking-tight ${hot ? 'text-danger' : 'text-muted'}`}>
                {n == null ? '–' : n}
              </span>
              <span className={`mt-1 text-sm font-semibold ${hot ? 'text-foreground' : 'text-muted'}`}>{c.label}</span>
              <span className="mt-0.5 text-xs text-muted">{n == null ? 'Checking…' : hot ? c.hint : 'None right now'}</span>
            </Link>
          );
        })}
        <button type="button" className={`${styles.task} ${styles.transitTask}`} onClick={onViewTransit} aria-label={`View ${inTransit} in transit orders`}>
          <span>{inTransit}</span><span>In transit <Arrow /></span><span>On the way to customers</span>
        </button>
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/* KPI Card — modern, rich                                                  */
/* ──────────────────────────────────────────────────────────────────────── */

function KpiCard({ label, value, hint, icon, featured, href }: {
  label: string; value: string; hint: string; icon: React.ReactNode; featured?: boolean; href?: string;
}) {
  return <div className={`${styles.metric} ${featured ? styles.featuredMetric : ''}`}>
    <div className={styles.metricLabel}><p>{label}</p><span aria-hidden>{icon}</span></div>
    <p className={styles.metricValue}>{value}</p>
    {href ? <Link className={styles.metricHint} href={href}>{hint} <Arrow /></Link> : <p className={styles.metricHint}>{hint}</p>}
  </div>;
}

function IconRupee() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3h12" />
      <path d="M6 8h12" />
      <path d="M6 13l8.5 8" />
      <path d="M6 13h3a5 5 0 0 0 0-10" />
    </svg>
  );
}
function IconBag() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  );
}
function IconBox() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}
function IconAlert() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/* KYC banner — gates the dashboard experience by status                    */
/* ──────────────────────────────────────────────────────────────────────── */

function KycBanner({ status, reason, accountStatus }: { status: string; reason?: string; accountStatus?: string }) {
  // Hide only when KYC is approved AND the account is activated. If KYC is
  // approved but the account is still pending we surface an "awaiting
  // activation" banner — the seller needs to know they're still gated.
  if (status === 'approved' && accountStatus === 'approved') return null;
  // Derive effective state: KYC-approved-but-account-pending becomes its own
  // banner variant, otherwise we fall through to the KYC-status copy.
  const effective =
    status === 'approved' && accountStatus !== 'approved'
      ? (accountStatus === 'suspended' ? 'suspended' : 'awaiting_activation')
      : status;

  const config: any = ({
    awaiting_activation: {
      bg: 'bg-emerald-50 border-emerald-200',
      iconBg: 'bg-emerald-100 text-emerald-700',
      titleColor: 'text-emerald-900',
      bodyColor: 'text-emerald-800',
      title: 'KYC verified — store activation in progress',
      body: 'Our team is finalising your store activation. You\'ll be able to list products and receive orders as soon as it\'s done — usually within a few hours.',
      cta: 'View KYC',
      btnColor: 'success',
    },
    suspended: {
      bg: 'bg-rose-50 border-rose-200',
      iconBg: 'bg-rose-100 text-rose-700',
      titleColor: 'text-rose-900',
      bodyColor: 'text-rose-800',
      title: 'Account suspended',
      body: 'Listing is paused on this account. Reach out to support to learn what\'s required to reactivate.',
      cta: 'Contact support',
      btnColor: 'danger',
    },
    not_started: {
      bg: 'bg-amber-50 border-amber-200',
      iconBg: 'bg-amber-100 text-amber-700',
      titleColor: 'text-amber-900',
      bodyColor: 'text-amber-800',
      title: 'Complete your KYC to start selling',
      body: 'List products only after our team verifies your GST, PAN and pickup address. Takes 2 minutes.',
      cta: 'Complete KYC',
      btnColor: 'warning',
    },
    pending: {
      bg: 'bg-blue-50 border-blue-200',
      iconBg: 'bg-blue-100 text-blue-700',
      titleColor: 'text-blue-900',
      bodyColor: 'text-blue-800',
      title: 'KYC under review',
      body: 'Our team usually responds within 24-48 hours. We will email you the moment it is approved.',
      cta: 'View submission',
      btnColor: 'primary',
    },
    rejected: {
      bg: 'bg-rose-50 border-rose-200',
      iconBg: 'bg-rose-100 text-rose-700',
      titleColor: 'text-rose-900',
      bodyColor: 'text-rose-800',
      title: 'KYC rejected — update and resubmit',
      body: reason || 'Please update the relevant document and submit again.',
      cta: 'Update & resubmit',
      btnColor: 'danger',
    },
  } as Record<string, any>)[effective];

  if (!config) return null;

  return (
    <Card className={`mb-6 border ${config.bg}`}>
      <CardBody className="p-4 !flex-row items-start gap-3 flex-wrap sm:flex-nowrap">
        <div className={`w-10 h-10 rounded-xl ${config.iconBg} grid place-items-center shrink-0`}>
          <BannerIcon status={effective} />
        </div>
        <div className="flex-1 min-w-0">
          <div className={`font-semibold text-sm ${config.titleColor}`}>{config.title}</div>
          <div className={`text-xs mt-0.5 ${config.bodyColor} leading-relaxed`}>{config.body}</div>
        </div>
        <Button as={Link} href={effective === 'suspended' ? 'mailto:support@throttlein.in' : '/dashboard/kyc'} size="sm" color={config.btnColor} variant="flat" className="font-semibold whitespace-nowrap">{config.cta}</Button>
      </CardBody>
    </Card>
  );
}

function BannerIcon({ status }: { status: string }) {
  if (status === 'pending') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    );
  }
  if (status === 'awaiting_activation') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <polyline points="9 12 11 14 15 10" />
      </svg>
    );
  }
  if (status === 'suspended') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
      </svg>
    );
  }
  if (status === 'rejected') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    );
  }
  // not_started / default
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="12" y1="18" x2="12" y2="12" />
      <line x1="9" y1="15" x2="15" y2="15" />
    </svg>
  );
}



function OverviewSkeleton() {
  return <div role="status" aria-live="polite" className={styles.loadingSkeleton}>
    <span className="sr-only">Loading store overview</span>
    <div aria-hidden="true">
      <div className={styles.sectionHeading}><span className={styles.skeletonBar} style={{width:130}} /><span className={styles.nameSkeleton} style={{width:140}} /></div>
      <div className={styles.metrics}>{Array.from({length:4},(_,index) => <div key={index} className={styles.metric}><span className={styles.skeletonBar} style={{width:'55%'}} /><span className={styles.nameSkeleton} style={{width:90,margin:'20px 0 14px'}} /><span className={styles.skeletonBar} style={{width:'80%'}} /></div>)}</div>
      <div className={styles.attention}><span className={styles.skeletonBar} style={{width:150,marginBottom:20}} /><div className={styles.taskGrid}>{Array.from({length:5},(_,index) => <div key={index} className={styles.metric}><span className={styles.nameSkeleton} style={{width:40,marginBottom:12}} /><span className={styles.skeletonBar} /></div>)}</div></div>
      <div className={styles.chartPanel} style={{padding:24}}><span className={styles.skeletonBar} style={{width:180}} /><div className={styles.chartSkeleton} /></div>
    </div>
  </div>;
}
