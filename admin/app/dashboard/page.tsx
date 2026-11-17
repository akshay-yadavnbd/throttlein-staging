'use client';

/**
 * Admin overview — the seller workspace's overview pattern (see
 * docs/seller-dashboard-redesign.md) applied to the marketplace:
 *
 *   1. Work first: a to-do list of the queues only an admin can clear
 *      (KYC, catalogue requests, refunds, failed courier bookings).
 *   2. Reporting second, for an explicitly labelled period (7 or 30 days,
 *      from the overview's daily series), with all-time figures in hints.
 *   3. Revenue/orders chart beside the seller pipeline and catalogue.
 *   4. Recent orders, then checkout failures.
 *
 * Loading, empty and failed states are distinct: a failed overview is an
 * error panel with retry — never zero-filled numbers that look real.
 *
 * Permission and site gating is unchanged from the previous dashboard:
 * marketplace panels need the main site AND the module permission
 * (`canPlatform`); Pages/Blogs use the site-scoped key (`canSite`); staff
 * and content-site dashboards keep their content cards (`showCms`).
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ResponsiveContainer, AreaChart, CartesianGrid, XAxis, YAxis, Tooltip, Area } from 'recharts';
import AdminSelect from '@/components/AdminSelect';
import CheckoutFailures from '@/components/CheckoutFailures';
import { StatusChip } from '@/components/ui';
import { api, imageUrl, unwrap, unwrapMeta, envelopeOrLegacy } from '@/lib/api';
import { getStoredAdmin, hasPermission, type AdminUser } from '@/lib/auth';
import { formatDayMonth } from '@/lib/dates';
import { MODULES_BY_KEY, permKeyFor } from '@/lib/modules';
import { orderStatusToken, paymentMethodLabel } from '@/lib/orderStatusDisplay';
import { SITES_BY_KEY } from '@/lib/site';
import { useActiveSite } from '@/lib/useActiveSite';
import styles from './dashboard.module.css';
import { apiMessage } from '@/lib/notify';

/* ── Types (overview response — backend adminController.dashboardOverview) ── */

type DayPoint = { date: string; orders: number; revenue: number; newSellers: number; newProducts: number };

type RecentOrder = {
  _id: string;
  orderNumber: string;
  status: 'placed' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';
  total: number;
  paymentMethod: string;
  createdAt: string;
  items?: { quantity: number }[];
  user?: { name?: string; email?: string };
};

type RecentProduct = {
  _id: string; name: string; price: number; stock: number; status: string; images?: string[];
  seller?: { _id: string; name: string; storeName?: string };
};

type SellerQueues = { signups: number; unverified: number; kycWaiting: number; live: number; suspended: number };

type Overview = {
  stats: {
    sellers: number;
    pendingSellers: number;
    sellerQueues?: SellerQueues;
    customers: number;
    totalProducts: number;
    activeProducts: number;
    outOfStockProducts: number;
    /** NET — the backend excludes cancelled and refunded orders. */
    totalOrders: number;
    totalRevenue: number;
    cancelledOrders: number;
    refundedOrders: number;
  };
  series: DayPoint[];
  recent: { orders: RecentOrder[]; products: RecentProduct[] };
};

type KycSeller = {
  _id: string; name?: string; storeName?: string; email?: string; createdAt?: string;
  kyc?: { submittedAt?: string };
};

type ModuleCounts = { pages: number | null; blogs: number | null; brands: number | null; categories: number | null };
type ModuleRecents = {
  pages: Array<{ _id: string; title: string; type: string; isPublished: boolean; updatedAt: string }>;
  blogs: Array<{ _id: string; title: string; status: string; updatedAt: string }>;
  brands: Array<{ _id: string; name: string; slug: string; logo?: string }>;
};

/** One admin work queue: null while loading, 'error' when it couldn't load. */
type QueueCount = number | null | 'error';
type QueueKey = 'kyc' | 'requests' | 'refunds' | 'pushes';

/* ── Helpers ─────────────────────────────────────────────────────────── */

const inr = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);

/** Short relative time: "2h", "3d". */
function ago(iso?: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d` : `${Math.round(days / 30)}mo`;
}

const QUEUES: { key: QueueKey; perm: string; label: string; hint: string; href: string }[] = [
  { key: 'kyc',      perm: 'kyc',            label: 'KYC to review',       hint: 'Check documents and approve',    href: '/kyc-pending' },
  { key: 'requests', perm: 'brand-requests', label: 'Catalogue requests',  hint: 'Approve new brands and categories', href: '/brand-requests' },
  { key: 'refunds',  perm: 'refunds',        label: 'Refunds to process',  hint: 'Pay customers back',             href: '/refunds' },
  { key: 'pushes',   perm: 'orders',         label: 'Courier bookings failed', hint: 'Retry the shipment push',    href: '/orders/failed-pushes' },
];

/* ── Page ────────────────────────────────────────────────────────────── */

export default function DashboardPage() {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [period, setPeriod] = useState<7 | 30>(30);
  const [chartView, setChartView] = useState<'revenue' | 'orders'>('revenue');
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [queues, setQueues] = useState<Record<QueueKey, QueueCount>>({ kyc: null, requests: null, refunds: null, pushes: null });
  const [kycWaiting, setKycWaiting] = useState<KycSeller[]>([]);
  const [counts, setCounts] = useState<ModuleCounts>({ pages: null, blogs: null, brands: null, categories: null });
  const [recents, setRecents] = useState<ModuleRecents>({ pages: [], blogs: [], brands: [] });
  const site = useActiveSite();

  useEffect(() => {
    // Read the browser session after mount (localStorage isn't available during SSR).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUser(getStoredAdmin());
  }, []);

  /* Permission helpers — unchanged semantics from the previous dashboard. */
  const can = (perm?: string) => hasPermission(user, perm);
  /** Marketplace-wide modules: one order book, one seller roster — main site only. */
  const canPlatform = (perm?: string) => site === 'main' && can(perm);
  /** Site-scoped modules resolve to 'seller-pages' etc. on the seller property. */
  const canSite = (key: string) => {
    const m = MODULES_BY_KEY[key];
    return can(m ? permKeyFor(m, site) : key);
  };
  /** Content cards: staff (whose modules may be CMS-only) and every content-site dashboard. */
  const showCms = user?.role !== 'superadmin' || site !== 'main';
  const showAuxActivity = showCms;

  /* Marketplace overview — main site only (a seller-only staffer would 403). */
  useEffect(() => {
    if (site !== 'main') return;
    let cancelled = false;
    api.get('/admin/overview')
      .then((r) => { if (!cancelled) { setData(unwrap<Overview>(r)); setError(null); } })
      .catch((e) => {
        if (cancelled) return;
        setData(null);
        setError(apiMessage(e) || 'The marketplace overview is unavailable right now.');
      });
    return () => { cancelled = true; };
  }, [site, attempt]);
  // Loading = asked, not yet answered. Retry clears the error in its click
  // handler, which puts the page back into this state.
  const loading = site === 'main' && data === null && error === null;
  const retry = () => { setError(null); setAttempt((n) => n + 1); };

  /* Work queues — each permission-gated and loaded independently, so one
     failing endpoint shows "Couldn't check" on its own card only. */
  useEffect(() => {
    if (!user || site !== 'main') return;
    let cancelled = false;
    const set = (key: QueueKey, value: QueueCount) => { if (!cancelled) setQueues((q) => ({ ...q, [key]: value })); };
    const has = (perm: string) => hasPermission(user, perm);
    if (has('kyc')) {
      api.get('/admin/kyc/pending')
        .then((r) => { const list = unwrap<{ sellers?: KycSeller[] }>(r).sellers || []; set('kyc', list.length); if (!cancelled) setKycWaiting(list); })
        .catch(() => set('kyc', 'error'));
    }
    if (has('brand-requests')) {
      api.get('/admin/brand-category-requests', { params: { status: 'pending' } })
        .then((r) => set('requests', (unwrap<{ items?: unknown[] }>(r).items || []).length))
        .catch(() => set('requests', 'error'));
    }
    if (has('refunds')) {
      api.get('/admin/refund-requests', { params: { status: 'requested' } })
        .then((r) => set('refunds', (unwrap<{ requests?: unknown[] }>(r).requests || []).length))
        .catch(() => set('refunds', 'error'));
    }
    if (has('orders')) {
      api.get('/admin/orders/failed-pushes', { params: { page: 1, limit: 1 } })
        .then((r) => set('pushes', Number(unwrapMeta<unknown, { totalItems: number }>(r).meta?.totalItems) || 0))
        .catch(() => set('pushes', 'error'));
    }
    return () => { cancelled = true; };
  }, [user, site, attempt]);

  /* Content counts + recents — silent on failure (the card shows "—"). */
  useEffect(() => {
    if (!user) return;
    const has = (perm: string) => hasPermission(user, perm);
    const siteKey = (key: string) => { const m = MODULES_BY_KEY[key]; return m ? permKeyFor(m, site) : key; };
    const cms = user.role !== 'superadmin' || site !== 'main';
    if (cms && has(siteKey('pages'))) {
      api.get('/pages', { params: { all: 1 } }).then(envelopeOrLegacy).then(({ data: d }) => {
        const items = d.items || [];
        setCounts((c) => ({ ...c, pages: d.count ?? items.length }));
        const sorted = [...items].sort((a: { updatedAt?: string }, b: { updatedAt?: string }) => Date.parse(b.updatedAt || '0') - Date.parse(a.updatedAt || '0'));
        setRecents((r) => ({ ...r, pages: sorted.slice(0, 5) }));
      }).catch(() => {});
    }
    if (cms && has(siteKey('blogs'))) {
      api.get('/admin/blog', { params: { limit: 5 } }).then((r) => {
        const { data: d, meta } = unwrapMeta<{ items?: any[] }, { totalItems: number }>(r);
        setCounts((c) => ({ ...c, blogs: meta?.totalItems ?? d.items?.length ?? 0 }));
        setRecents((r) => ({ ...r, blogs: (d.items || []).slice(0, 5) }));
      }).catch(() => {});
    }
    if (cms && site === 'main' && has('brands')) {
      api.get('/brands').then(envelopeOrLegacy).then(({ data: d }) => {
        const items = d.items || [];
        setCounts((c) => ({ ...c, brands: d.count ?? items.length }));
        const sorted = [...items].sort((a: { updatedAt?: string }, b: { updatedAt?: string }) => Date.parse(b.updatedAt || '0') - Date.parse(a.updatedAt || '0'));
        setRecents((r) => ({ ...r, brands: sorted.slice(0, 5) }));
      }).catch(() => {});
    }
    if (site === 'main' && has('categories')) {
      api.get('/categories').then(envelopeOrLegacy).then(({ data: d }) => setCounts((c) => ({ ...c, categories: (d.tree || []).length }))).catch(() => {});
    }
  }, [user, site]);

  const series = useMemo(() => (data?.series || []).slice(-period).map((d) => ({
    ...d,
    label: new Date(d.date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }),
    fullDate: new Date(d.date).toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' }),
  })), [data, period]);
  const totals = useMemo(() => series.reduce((sum, d) => ({
    revenue: sum.revenue + d.revenue, orders: sum.orders + d.orders,
    newSellers: sum.newSellers + d.newSellers, newProducts: sum.newProducts + d.newProducts,
  }), { revenue: 0, orders: 0, newSellers: 0, newProducts: 0 }), [series]);

  const visibleQueues = QUEUES.filter((q) => canPlatform(q.perm));
  const queueTotal = visibleQueues.reduce((sum, q) => sum + (typeof queues[q.key] === 'number' ? (queues[q.key] as number) : 0), 0);
  const queuesSettled = visibleQueues.every((q) => queues[q.key] !== null);

  const hasNoModules =
    user?.role === 'staff' &&
    !canPlatform('orders') && !canPlatform('sellers') && !canPlatform('customers') &&
    !canSite('pages') && !canSite('blogs') && !canPlatform('brands') && !canPlatform('categories');

  const firstName = user?.name?.trim().split(/\s+/)[0];
  const marketplace = site === 'main';
  const stats = data?.stats;
  const sq = stats?.sellerQueues;

  return (
    <div className={styles.dashboard}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{marketplace ? 'Your marketplace at a glance' : 'Content workspace'}</p>
          <h1>{marketplace ? 'Throttlein marketplace' : `${SITES_BY_KEY[site].label} site`}</h1>
          <p>{firstName ? `Welcome back, ${firstName}.` : 'Welcome back.'} {marketplace ? 'Here’s what needs you today.' : `Content for ${SITES_BY_KEY[site].host}.`}</p>
        </div>
        {canPlatform('orders') && <Link className={styles.primaryAction} href="/orders">Manage orders <Go /></Link>}
      </header>

      {!marketplace && (
        <p className={styles.note}>
          Marketplace metrics — revenue, orders and sellers — live on the Throttlein site. Switch sites in the sidebar to see them.
        </p>
      )}

      {/* ── 1. Work first ─────────────────────────────────────────── */}
      {marketplace && (visibleQueues.length > 0 || canPlatform('sellers')) && (
        <section aria-labelledby="todo-heading" className={styles.attention}>
          <div className={styles.attentionHead}>
            <h2 id="todo-heading">Your to-do list <span className={styles.taskBadge}>{queuesSettled ? queueTotal : '…'}</span></h2>
            {queuesSettled && queueTotal === 0 && <p>All caught up. Nothing is waiting on you.</p>}
          </div>
          <div className={styles.taskGrid}>
            {visibleQueues.map((q) => {
              const n = queues[q.key];
              const hot = typeof n === 'number' && n > 0;
              return (
                <Link
                  key={q.key}
                  href={q.href}
                  data-active={hot}
                  aria-label={typeof n === 'number' ? `${q.label}: ${n}` : q.label}
                  className={styles.task}
                >
                  <span>{n === null || n === 'error' ? '–' : n}</span>
                  <span>{q.label}</span>
                  <span>{n === null ? 'Checking…' : n === 'error' ? 'Couldn’t check — open to see' : hot ? q.hint : 'None right now'}</span>
                </Link>
              );
            })}
            {/* Context, not work: sign-ups are waiting on the seller. */}
            {canPlatform('sellers') && (
              <Link href="/sellers?stage=signups" className={`${styles.task} ${styles.infoTask}`} aria-label={`Sign-ups in progress: ${sq?.signups ?? 'unknown'}`}>
                <span>{sq ? sq.signups : '–'}</span>
                <span>{withTrailingArrow('Sign-ups in progress')}</span>
                <span>{sq && sq.unverified > 0 ? `${sq.unverified} never verified their email` : 'Waiting on the seller'}</span>
              </Link>
            )}
          </div>
        </section>
      )}

      {hasNoModules && (
        <section className={styles.panel}>
          <div className={styles.empty}>
            <h3>Nothing to summarise here</h3>
            <p>Your account doesn’t have a dashboard panel yet. Use the sidebar to open the sections you have access to.</p>
          </div>
        </section>
      )}

      {/* ── 2. Reporting ───────────────────────────────────────────── */}
      {marketplace && (loading ? <OverviewSkeleton /> : error ? (
        <section className={styles.error} role="alert">
          <IconAlert />
          <h2>We couldn’t load the marketplace overview</h2>
          <p>{error} No figures are shown rather than placeholder zeros.</p>
          <button type="button" onClick={retry}>Try again</button>
        </section>
      ) : stats && (
        <>
          {(canPlatform('orders') || canPlatform('sellers')) && (
            <div className={styles.sectionHeading}>
              <h2>Marketplace snapshot</h2>
              <div className={styles.period}>
                <span>Reporting period</span>
                <AdminSelect ariaLabel="Reporting period" value={String(period)} onChange={(v) => setPeriod(Number(v) as 7 | 30)} options={[{ value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }]} />
              </div>
            </div>
          )}
          <div className={styles.metrics}>
            {canPlatform('orders') && (
              <>
                <KpiCard featured label="Net revenue" value={`₹${inr(totals.revenue)}`} icon={<IconRupee />}
                  hint={`Last ${period} days · ₹${inr(stats.totalRevenue)} all time`} />
                <KpiCard label="Orders" value={inr(totals.orders)} icon={<IconBag />}
                  hint={`Last ${period} days · excludes cancelled & refunded`} />
                <KpiCard label="Average order value" value={`₹${inr(totals.orders ? Math.round(totals.revenue / totals.orders) : 0)}`} icon={<IconChart />}
                  hint={`Last ${period} days`} />
              </>
            )}
            {canPlatform('sellers') && (
              <KpiCard label="Live sellers" value={sq ? inr(sq.live) : '—'} icon={<IconUsers />} href="/sellers?stage=live"
                hint={`${inr(stats.sellers)} registered · ${inr(totals.newSellers)} joined in ${period} days`} />
            )}
            {canPlatform('customers') && !canPlatform('orders') && (
              <KpiCard label="Customers" value={inr(stats.customers || 0)} icon={<IconUsers />} href="/customers" hint="Registered buyers · all time" />
            )}
            {canPlatform('brands') && !canPlatform('sellers') && (
              <KpiCard label="Brands" value={counts.brands === null ? '—' : inr(counts.brands)} icon={<IconTag />} href="/brands" hint="Brand directory · all time" />
            )}
            {canPlatform('categories') && !canPlatform('sellers') && (
              <KpiCard label="Categories" value={counts.categories === null ? '—' : inr(counts.categories)} icon={<IconBox />} href="/categories" hint="Top-level catalogue tree" />
            )}
          </div>

          {(canPlatform('orders') || canPlatform('sellers')) && (
            <div className={`${styles.insights} ${canPlatform('orders') && canPlatform('sellers') ? '' : styles.insightsSolo}`}>
              {/* Chart and recent orders share the left column so it balances
                  the taller pipeline + catalogue column on the right. */}
              {canPlatform('orders') && (
                <div className={styles.column}>
                <section className={styles.panel} aria-labelledby="performance-heading">
                  <div className={styles.panelHeader}>
                    <div>
                      <h2 id="performance-heading">Marketplace performance</h2>
                      <p>Net revenue and orders over the last {period} days</p>
                    </div>
                    <div className={styles.segmented} role="group" aria-label="Chart metric">
                      <button type="button" aria-pressed={chartView === 'revenue'} onClick={() => setChartView('revenue')}>Revenue</button>
                      <button type="button" aria-pressed={chartView === 'orders'} onClick={() => setChartView('orders')}>Orders</button>
                    </div>
                  </div>
                  <div className={styles.chartTotal}>
                    <strong>{chartView === 'revenue' ? `₹${inr(totals.revenue)}` : inr(totals.orders)}</strong>
                    <span>{chartView === 'revenue' ? 'Net revenue' : 'Orders'} · last {period} days</span>
                  </div>
                  {totals.orders === 0 ? (
                    <div className={`${styles.empty} ${styles.emptyChart}`}>
                      <span className={styles.emptyIcon}><IconBag /></span>
                      <h3>No orders in this period</h3>
                      <p>The trend appears as customer orders come in.</p>
                      <Link href="/orders">Open orders <Go /></Link>
                    </div>
                  ) : (
                    <div className={styles.chart} role="img" aria-label={`${chartView === 'revenue' ? 'Daily net revenue' : 'Daily orders'} for the last ${period} days. Total ${chartView === 'revenue' ? `₹${inr(totals.revenue)}` : totals.orders}.`}>
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={series} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="adminRevenueFill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#96c827" stopOpacity={0.24} />
                              <stop offset="100%" stopColor="#96c827" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid stroke="#edf0f2" strokeDasharray="4 4" vertical={false} />
                          <XAxis dataKey="label" tick={{ fill: '#78828c', fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={30} />
                          <YAxis tick={{ fill: '#78828c', fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} width={70}
                            tickFormatter={(v: number) => (chartView === 'revenue' ? `₹${inr(v)}` : inr(v))} />
                          <Tooltip
                            contentStyle={{ border: '1px solid #e6e9ed', borderRadius: 10, fontSize: 12 }}
                            labelFormatter={(_l, p) => p?.[0]?.payload?.fullDate ?? ''}
                            formatter={(v) => [chartView === 'revenue' ? `₹${inr(Number(v))}` : inr(Number(v)), chartView === 'revenue' ? 'Net revenue' : 'Orders']}
                          />
                          <Area type="linear" dataKey={chartView} stroke="#6a9214" strokeWidth={2.5} fill="url(#adminRevenueFill)" activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                  <p className={styles.chartNote}>
                    Order totals across all sellers. Cancelled and refunded orders are excluded ({inr(stats.cancelledOrders)} cancelled · {inr(stats.refundedOrders)} refunded all time).
                  </p>
                </section>
                <RecentOrders orders={data?.recent.orders || []} />
                </div>
              )}

              {canPlatform('sellers') && (
                <div className={styles.side}>
                  <SellerPipeline queues={sq} kycWaiting={kycWaiting} canReview={canPlatform('kyc')} />
                  <CataloguePanel stats={stats} newProducts={totals.newProducts} period={period} />
                </div>
              )}
            </div>
          )}
        </>
      ))}

      {/* ── Content dashboards (staff and the seller site) ─────────────── */}
      {(showCms && (canSite('pages') || canSite('blogs'))) && (
        <div className={styles.metrics}>
          {canSite('pages') && <KpiCard label="Pages" value={counts.pages === null ? '—' : inr(counts.pages)} icon={<IconFile />} href="/pages" hint="Static, dynamic and prose pages" />}
          {canSite('blogs') && <KpiCard label="Blog posts" value={counts.blogs === null ? '—' : inr(counts.blogs)} icon={<IconBook />} href="/blogs" hint="Published and draft articles" />}
        </div>
      )}
      {(showAuxActivity && (canPlatform('sellers') || canPlatform('brands'))) || (showCms && (canSite('pages') || canSite('blogs'))) ? (
        <div className={styles.activityGrid}>
          {showAuxActivity && canPlatform('sellers') && (
            <ActivityPanel title="Recent products" href="/products" empty="No products yet." rows={(data?.recent.products || []).map((p) => ({
              key: p._id, title: p.name, thumb: p.images?.[0] ?? '',
              meta: `₹${inr(p.price)} · ${p.seller?.storeName || p.seller?.name || 'Unknown seller'}`,
              right: <StatusChip status={p.stock > 0 ? 'in_stock' : 'out_of_stock'} />,
            }))} />
          )}
          {showCms && canSite('pages') && (
            <ActivityPanel title="Recently edited pages" href="/pages" empty="No pages yet." rows={recents.pages.map((p) => ({
              key: p._id, title: p.title, meta: `${p.type} · edited ${ago(p.updatedAt)} ago`,
              right: <StatusChip status={p.isPublished ? 'published' : 'draft'} />,
            }))} />
          )}
          {showCms && canSite('blogs') && (
            <ActivityPanel title="Latest blog posts" href="/blogs" empty="No posts yet." rows={recents.blogs.map((p) => ({
              key: p._id, title: p.title, href: `/blogs/${p._id}`, meta: `Edited ${ago(p.updatedAt)} ago`,
              right: <StatusChip status={p.status} />,
            }))} />
          )}
          {showAuxActivity && canPlatform('brands') && (
            <ActivityPanel title="Recently added brands" href="/brands" empty="No brands yet." rows={recents.brands.map((b) => ({
              key: b._id, title: b.name, meta: b.slug, thumb: b.logo ?? '',
            }))} />
          )}
        </div>
      ) : null}

      {can('orders') && <CheckoutFailures compact />}
    </div>
  );
}

/* ── Pieces ──────────────────────────────────────────────────────────── */

function KpiCard({ label, value, hint, icon, featured, href }: {
  label: string; value: string; hint: string; icon: React.ReactNode; featured?: boolean; href?: string;
}) {
  return (
    <div className={`${styles.metric} ${featured ? styles.featuredMetric : ''}`}>
      <div className={styles.metricLabel}><p>{label}</p><span aria-hidden>{icon}</span></div>
      <p className={styles.metricValue}>{value}</p>
      {href
        ? <Link className={styles.metricHint} href={href}>{withTrailingArrow(hint)}</Link>
        : <p className={styles.metricHint}>{hint}</p>}
    </div>
  );
}

/**
 * Seller pipeline (UX audit A1): the actionable queue — KYC waiting for an
 * admin — leads with names; the other stages are context, each linking to
 * the seller list filtered to exactly that set.
 */
function SellerPipeline({ queues, kycWaiting, canReview }: { queues?: SellerQueues; kycWaiting: KycSeller[]; canReview: boolean }) {
  const waiting = queues ? queues.kycWaiting : kycWaiting.length;
  const shown = kycWaiting.slice(0, 3);
  return (
    <section className={styles.panel} aria-labelledby="pipeline-heading">
      <div className={styles.panelHeader}>
        <div><h2 id="pipeline-heading">Seller pipeline</h2><p>Where every seller stands right now.</p></div>
      </div>
      <div className={styles.bigNumber}>
        <strong>{waiting}</strong>
        <p>KYC submission{waiting === 1 ? '' : 's'} waiting for you</p>
      </div>
      {waiting === 0 ? (
        <p className={styles.clear}>All caught up — no KYC waiting.</p>
      ) : canReview && shown.length > 0 && (
        <div className={styles.people}>
          {shown.map((s) => (
            <Link key={s._id} href="/kyc-pending">
              <span>
                <strong>{s.storeName || s.name || s.email || 'Seller'}</strong>
                <small>{s.email}{s.kyc?.submittedAt ? ` · submitted ${ago(s.kyc.submittedAt)} ago` : ''}</small>
              </span>
              <Chevron />
            </Link>
          ))}
        </div>
      )}
      <dl className={styles.stockList}>
        <Link href="/sellers?stage=signups"><dt><i className={styles.warningDot} />Sign-ups in progress {queues && queues.unverified > 0 && <small>{queues.unverified} unverified</small>}</dt><dd>{queues ? queues.signups : '–'}</dd></Link>
        <Link href="/sellers?stage=live"><dt><i className={styles.goodDot} />Live</dt><dd>{queues ? queues.live : '–'}</dd></Link>
        <Link href="/sellers?stage=suspended"><dt><i className={styles.dangerDot} />Suspended</dt><dd>{queues ? queues.suspended : '–'}</dd></Link>
      </dl>
      <Link className={styles.panelLink} href={waiting > 0 ? '/kyc-pending' : '/sellers'}>
        {waiting > 0 ? `Review ${waiting > shown.length ? `all ${waiting}` : 'KYC'}` : 'Manage sellers'} <Go />
      </Link>
    </section>
  );
}

function CataloguePanel({ stats, newProducts, period }: { stats: Overview['stats']; newProducts: number; period: number }) {
  const total = stats.totalProducts;
  return (
    <section className={styles.panel} aria-labelledby="catalogue-heading">
      <div className={styles.panelHeader}>
        <div><h2 id="catalogue-heading">Catalogue</h2><p>Listings across all sellers.</p></div>
      </div>
      <div className={styles.bigNumber}>
        <strong>{inr(stats.activeProducts)}<span> / {inr(total)}</span></strong>
        <p>products active</p>
        <div className={styles.progress} role="progressbar" aria-label="Active products" aria-valuenow={stats.activeProducts} aria-valuemin={0} aria-valuemax={total || 1}>
          <span style={{ width: `${total ? (stats.activeProducts / total) * 100 : 0}%` }} />
        </div>
      </div>
      <dl className={styles.stockList}>
        <div><dt><i className={styles.dangerDot} />Out of stock</dt><dd>{inr(stats.outOfStockProducts)}</dd></div>
        <div><dt><i className={styles.goodDot} />Listed in the last {period} days</dt><dd>{inr(newProducts)}</dd></div>
      </dl>
      <Link className={styles.panelLink} href="/products">Browse products <Go /></Link>
    </section>
  );
}

function RecentOrders({ orders }: { orders: RecentOrder[] }) {
  return (
    <section className={styles.panel} aria-labelledby="recent-orders-heading">
      <div className={styles.panelHeader}>
        <div><h2 id="recent-orders-heading">Recent orders</h2><p>The latest orders across the marketplace, any status.</p></div>
        <Link href="/orders">View all orders <Go /></Link>
      </div>
      {orders.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}><IconBag /></span>
          <h3>No orders yet</h3>
          <p>Customer orders will appear here as they come in.</p>
        </div>
      ) : (
        <>
          <div className={styles.tableScroll}>
            <table className={styles.ordersTable}>
              <caption className="sr-only">Most recent marketplace orders</caption>
              <thead>
                <tr>
                  <th scope="col">Order</th><th scope="col">Customer</th><th scope="col">Status</th>
                  <th scope="col" className={styles.amount}>Amount</th><th scope="col"><span className="sr-only">Details</span></th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const status = orderStatusToken(o);
                  const units = (o.items || []).reduce((sum, it) => sum + (it.quantity || 0), 0);
                  const href = `/orders/${o.orderNumber || o._id}`;
                  return (
                    <tr key={o._id}>
                      <td><Link className={styles.orderLink} href={href}>{o.orderNumber || 'View order'}</Link><small>{formatDayMonth(o.createdAt)} · {units} {units === 1 ? 'item' : 'items'}</small></td>
                      <td>{o.user?.name || 'Deleted account'}{o.user?.email && <small>{o.user.email}</small>}</td>
                      <td><StatusChip label={status.label} status={status.key} /></td>
                      <td className={styles.amount}><strong>₹{inr(o.total || 0)}</strong><small>{paymentMethodLabel(o.paymentMethod)}</small></td>
                      <td>
                        <Link className={styles.detailLink} aria-label={`Open order ${o.orderNumber || o._id}`} title="Open order" href={href}>
                          <IconArrowRight />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className={styles.orderCards}>
            {orders.map((o) => (
              <Link key={o._id} href={`/orders/${o.orderNumber || o._id}`}>
                <div><strong>{o.orderNumber || 'Order'}</strong><small>{o.user?.name || 'Deleted account'} · {formatDayMonth(o.createdAt)}</small></div>
                <div><strong>₹{inr(o.total || 0)}</strong><small>{orderStatusToken(o).label}</small></div>
              </Link>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

type ActivityRowData = { key: string; title: string; meta?: string; right?: React.ReactNode; thumb?: string; href?: string };

function ActivityPanel({ title, href, empty, rows }: { title: string; href: string; empty: string; rows: ActivityRowData[] }) {
  const headingId = `activity-${href.replace(/\W+/g, '-')}`;
  return (
    <section className={styles.panel} aria-labelledby={headingId}>
      <div className={styles.panelHeader}>
        <div><h2 id={headingId}>{title}</h2></div>
        <Link href={href}>View all <Go /></Link>
      </div>
      {rows.length === 0 ? (
        <div className={styles.empty}><h3>{empty}</h3></div>
      ) : (
        <ul className={styles.activityList}>
          {rows.map((r) => {
            const body = (
              <>
                {r.thumb !== undefined && (r.thumb
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img alt="" src={imageUrl(r.thumb)} />
                  : <span aria-hidden className={styles.thumb} />)}
                <div><p>{r.title}</p>{r.meta && <small>{r.meta}</small>}</div>
                {r.right}
              </>
            );
            return <li key={r.key}>{r.href ? <Link href={r.href}>{body}</Link> : <div>{body}</div>}</li>;
          })}
        </ul>
      )}
    </section>
  );
}

function OverviewSkeleton() {
  return (
    <div role="status" aria-live="polite" className={styles.loading}>
      <span className="sr-only">Loading marketplace overview</span>
      <div aria-hidden="true">
        <div className={styles.sectionHeading}><span className={styles.skeletonBar} style={{ width: 150 }} /><span className={styles.skeletonBlock} style={{ width: 160 }} /></div>
        <div className={styles.metrics}>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className={styles.metric}>
              <span className={styles.skeletonBar} style={{ width: '55%' }} />
              <span className={styles.skeletonBlock} style={{ width: 100, margin: '20px 0 14px' }} />
              <span className={styles.skeletonBar} style={{ width: '80%' }} />
            </div>
          ))}
        </div>
        <div className={styles.panel} style={{ padding: 24, marginBottom: 24 }}>
          <span className={styles.skeletonBar} style={{ width: 180 }} />
          <span className={styles.skeletonBlock} style={{ height: 220, marginTop: 24 }} />
        </div>
      </div>
    </div>
  );
}

/* ── Icons (decorative) ─────────────────────────────────────────────── */

const svg = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
function IconRupee() { return <svg {...svg}><path d="M6 3h12M6 8h12M6 13l8.5 8M6 13h3a5 5 0 0 0 0-10" /></svg>; }
function IconBag() { return <svg {...svg}><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 0 1-8 0" /></svg>; }
function IconChart() { return <svg {...svg}><path d="M3 3v18h18" /><path d="m7 15 4-4 3 3 5-6" /></svg>; }
function IconUsers() { return <svg {...svg}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>; }
function IconBox() { return <svg {...svg}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><path d="M3.27 6.96 12 12.01l8.73-5.05M12 22.08V12" /></svg>; }
function IconTag() { return <svg {...svg}><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><circle cx="7" cy="7" r="1.5" /></svg>; }
function IconFile() { return <svg {...svg}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>; }
function IconBook() { return <svg {...svg}><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></svg>; }
/** Inline link arrow — replaces the ↗ / → text glyphs, which drew in the font's
 *  thin style (and ↗ reads as "external site"; these links all stay in the panel). */
function Go() { return <svg {...svg} className={styles.linkArrow}><line x1="5" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" /></svg>; }
/** Glues the arrow to the last word so a wrapping hint never leaves it alone on a new line. */
function withTrailingArrow(text: string) {
  const cut = text.lastIndexOf(' ');
  return <>{text.slice(0, cut + 1)}<span className="whitespace-nowrap">{text.slice(cut + 1)} <Go /></span></>;
}
function Chevron() { return <svg {...svg} className={styles.linkArrow}><polyline points="9 6 15 12 9 18" /></svg>; }
function IconArrowRight() { return <svg {...svg}><line x1="5" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" /></svg>; }
function IconAlert() { return <svg {...svg}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>; }
