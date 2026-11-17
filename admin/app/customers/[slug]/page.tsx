'use client';

/**
 * Admin — customer (buyer) detail, in the workspace detail layout (same
 * family as the seller and order pages): identity header on every tab, then
 * Profile (contact, saved addresses, shopping activity) and Orders (every
 * order, each opening to its items and where it went, with a link to the
 * full order page).
 *
 * The default tab follows the work: a buyer with orders opens on Orders.
 * Deep link: `?tab=profile|orders`. Delete keeps past orders (sellers keep
 * their sales history) — the dialog says so.
 *
 * Backend: GET /api/admin/customers/:idOrSlug → { customer, orders, stats };
 * DELETE /api/admin/customers/:idOrSlug.
 */
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react';
import AdminButton from '@/components/AdminButton';
import { FilterTabs, StatusChip } from '@/components/ui';
import { api, imageUrl, unwrap } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/dates';
import { notifyError, notifySuccess, notifyWarning } from '@/lib/notify';
import { M } from '@/lib/messages';
import { orderStatusToken, paymentMethodLabel } from '@/lib/orderStatusDisplay';
import list from '@/components/WorkspaceList.module.css';
import modal from '@/components/AdminModal.module.css';
import shared from '@/app/sellers/[slug]/detail.module.css';
import styles from './detail.module.css';

type Address = { _id?: string; label?: string; fullName?: string; phone?: string; line1?: string; line2?: string; city?: string; state?: string; pincode?: string; country?: string; isDefault?: boolean };
type Customer = { _id: string; slug?: string; name: string; email: string; phone?: string; avatar?: string; status: string; createdAt: string; addresses?: Address[] };
type SellerInfo = { _id: string; slug?: string; name: string; storeName?: string };
type Item = { name: string; image?: string; brand?: string; category?: string; size?: string; price: number; quantity: number; subtotal: number; sellerInfo?: SellerInfo | null };
type Order = {
  _id: string; orderNumber: string; status: 'placed' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';
  paymentMethod: string; paymentStatus: string; total: number; createdAt: string; deliveredAt?: string; cancelledAt?: string;
  items: Item[]; shippingAddress?: { fullName?: string; line1?: string; city?: string; state?: string; pincode?: string };
  sellerShipments?: any[];
};
type Stats = { totalOrders: number; completedOrders: number; cancelledOrders: number; lifetimeSpend: number; totalUnits: number };
type Tab = 'profile' | 'orders';

const PAGE_SIZE = 15;
const inr = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n || 0);
const initials = (name: string) => (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();

export default function CustomerDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const router = useRouter();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<{ notFound: boolean; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  /* `null` until the admin picks a tab: a buyer with orders opens on Orders. */
  const [tabChoice, setTabChoice] = useState<Tab | null>(null);
  const activeTab = tabChoice ?? (orders.length > 0 ? 'orders' : 'profile');
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (t === 'profile' || t === 'orders') setTabChoice(t);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    api.get(`/admin/customers/${slug}`, { signal: controller.signal })
      .then((r) => {
        const data = unwrap<{ customer: Customer; orders?: Order[]; stats: Stats }>(r);
        setCustomer(data.customer); setOrders(data.orders || []); setStats(data.stats); setError(null);
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        const status = e?.response?.status;
        setError({ notFound: status === 404 || status === 400, message: e?.response?.status >= 500 || !e?.response ? 'This customer couldn’t be loaded right now.' : 'This customer couldn’t be loaded.' });
      });
    return () => controller.abort();
  }, [slug, attempt]);

  async function runDelete() {
    if (!customer) return;
    setDeleting(true);
    try {
      await api.delete(`/admin/customers/${slug}`);
      notifySuccess(M.customers.customerDeletedDetail(customer.name));
      router.replace('/customers');
    } catch (e: any) {
      notifyError(e, M.customers.couldntDeleteTheCustomer);
      setDeleting(false);
    }
  }

  if (!customer) {
    return (
      <div className={shared.page}>
        <BackToCustomers />
        {error ? (
          <section className={`${shared.panel} ${shared.state}`} role="alert">
            <h2>{error.notFound ? 'Customer not found' : 'Couldn’t load this customer'}</h2>
            <p>{error.notFound ? 'The link may be out of date, or the account was deleted.' : error.message}</p>
            {error.notFound
              ? <Link className={shared.darkAction} href="/customers">Go to customers</Link>
              : <button type="button" className={shared.darkAction} onClick={() => { setError(null); setAttempt((n) => n + 1); }}>Try again</button>}
          </section>
        ) : (
          <div className={shared.skeleton} role="status" aria-label="Loading customer">
            <span style={{ height: 92, marginBottom: 16 }} /><span style={{ height: 36, width: 260, maxWidth: '100%', marginBottom: 16 }} /><span style={{ height: 320 }} />
          </div>
        )}
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(orders.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const shown = orders.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  const onRowClick = (e: React.MouseEvent, id: string) => { if ((e.target as HTMLElement).closest('a,button')) return; toggle(id); };
  const addresses = customer.addresses || [];

  return (
    <div className={shared.page}>
      <BackToCustomers />

      {/* ── Identity, on every tab ── */}
      <section className={`${shared.panel} ${shared.summary}`} aria-labelledby="customer-heading">
        <span className={shared.avatar} aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {customer.avatar ? <img src={imageUrl(customer.avatar)} alt="" /> : initials(customer.name)}
        </span>
        <div className={shared.who}>
          <h1 id="customer-heading">
            {customer.name}
            {customer.status !== 'approved' && <StatusChip label={`Account ${customer.status}`} status={customer.status} />}
          </h1>
          <div className={shared.meta}>
            <span>{customer.email}</span>
            {customer.phone && <span>{customer.phone}</span>}
            <span>Customer since {formatDate(customer.createdAt)}</span>
            {stats && stats.totalOrders > 0 && <span>{stats.totalOrders} {stats.totalOrders === 1 ? 'order' : 'orders'} · ₹{inr(stats.lifetimeSpend)} spent</span>}
          </div>
        </div>
        <a className={shared.storeLink} href={`mailto:${customer.email}?subject=${encodeURIComponent('Your THROTTLEIN account')}`}><IconMail /> Email customer</a>
      </section>

      <FilterTabs
        ariaLabel="Customer sections"
        className={shared.tabs}
        onChange={(id) => setTabChoice(id as Tab)}
        tabs={[{ id: 'profile', label: 'Profile' }, { id: 'orders', label: 'Orders', count: orders.length }]}
        value={activeTab}
      />

      {activeTab === 'profile' ? (
        <>
          <div className={shared.grid}>
            <section className={`${shared.panel} ${shared.card}`} aria-labelledby="contact-heading">
              <h2 id="contact-heading" className={shared.cardTitle}>Contact</h2>
              <dl className={shared.fields}>
                <Field label="Name" value={customer.name} />
                <Field label="Email" value={customer.email} copy wide />
                <Field label="Phone" value={customer.phone || 'No phone on file'} copy={!!customer.phone} />
                <Field label="Joined" value={new Date(customer.createdAt).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })} />
              </dl>
            </section>

            <section className={`${shared.panel} ${shared.card}`} aria-labelledby="actions-heading">
              <h2 id="actions-heading" className={shared.cardTitle}>Account</h2>
              <div className={shared.actionList}>
                <div className={shared.actionRow}>
                  <div><strong>Delete customer</strong><span>Removes the account, addresses, cart and wishlist. Past orders stay with the sellers.</span></div>
                  <AdminButton variant="bordered" className="!border-[#f0c9c6] !text-[#b44848]" onPress={() => setDeleteOpen(true)}>Delete…</AdminButton>
                </div>
              </div>
            </section>
          </div>

          <section className={shared.panel} aria-labelledby="activity-heading" style={{ marginBottom: 20 }}>
            <h2 id="activity-heading" className={shared.metricsTitle}>Shopping activity <span className="font-normal text-[#8a939b]">· all time</span></h2>
            <dl className={shared.metrics}>
              {[
                { label: 'Orders', value: inr(stats?.totalOrders ?? 0) },
                { label: 'Delivered', value: inr(stats?.completedOrders ?? 0) },
                { label: 'Cancelled', value: inr(stats?.cancelledOrders ?? 0), warn: (stats?.cancelledOrders ?? 0) > 0 },
                { label: 'Units bought', value: inr(stats?.totalUnits ?? 0) },
                { label: 'Lifetime spend', value: `₹${inr(stats?.lifetimeSpend ?? 0)}` },
                { label: 'Saved addresses', value: inr(addresses.length) },
              ].map((s) => (
                <div key={s.label} className={shared.metric}><dt>{s.label}</dt><dd className={s.warn ? shared.warn : ''}>{s.value}</dd></div>
              ))}
            </dl>
          </section>

          <section className={`${shared.panel} ${shared.card}`} aria-labelledby="addresses-heading">
            <h2 id="addresses-heading" className={shared.cardTitle}>Saved addresses <span className="font-normal text-[#8a939b]">· {addresses.length}</span></h2>
            {addresses.length === 0 ? (
              <p className="text-[12px] text-[#74808a]">No saved addresses yet — they’re added at checkout or from the customer’s account.</p>
            ) : (
              <div className={styles.addresses}>
                {addresses.map((a, i) => (
                  <div key={a._id || i} className={styles.address}>
                    <div className={styles.addressHead}>{a.label || 'Address'}{a.isDefault && <span className={styles.default}>Default</span>}</div>
                    <strong>{a.fullName}</strong>
                    {a.phone && <small>{a.phone}</small>}
                    <div className="mt-1.5">
                      {a.line1}{a.line2 ? <><br />{a.line2}</> : null}<br />
                      {[a.city, a.state].filter(Boolean).join(', ')} {a.pincode}{a.country ? ` · ${a.country}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : (
        <section className={list.workspace} aria-labelledby="orders-heading">
          <div className={list.listHeader}>
            <div>
              <h2 id="orders-heading">Orders <span className={list.count}>{orders.length}</span></h2>
              <p>Every order this customer placed, newest first. Open one for its items; the order number goes to the full order page.</p>
            </div>
          </div>
          {orders.length === 0 ? (
            <div className={list.state}>
              <span className={list.stateIcon}><IconBag /></span>
              <h3>No orders yet</h3>
              <p>Orders show here as soon as this customer buys something.</p>
            </div>
          ) : (
            <>
              <div className={list.tableWrap}>
                <table className={list.table}>
                  <caption className="sr-only">Orders by {customer.name}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Order</th><th scope="col">Items</th><th scope="col">Payment</th><th scope="col">Status</th>
                      <th scope="col" className={list.money}>Total</th><th scope="col"><span className="sr-only">Details</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((o) => {
                      const t = orderStatusToken(o);
                      const units = o.items.reduce((s, it) => s + it.quantity, 0);
                      const isOpen = !!open[o._id];
                      return [
                        <tr key={o._id} onClick={(e) => onRowClick(e, o._id)} aria-expanded={isOpen}>
                          <td>
                            <Link className={list.primary} href={`/orders/${o.orderNumber}`}>{o.orderNumber}</Link>
                            <span className={list.sub} title={formatDateTime(o.createdAt)}>Placed {formatDate(o.createdAt)}{o.deliveredAt ? ` · delivered ${formatDate(o.deliveredAt)}` : ''}</span>
                          </td>
                          <td>{o.items.length} {o.items.length === 1 ? 'item' : 'items'}<span className={list.sub}>{units} {units === 1 ? 'unit' : 'units'}</span></td>
                          <td><StatusChip status={o.paymentStatus} /><span className={list.sub}>{paymentMethodLabel(o.paymentMethod)}</span></td>
                          <td><StatusChip status={t.key} label={t.label} hint={t.detail} /></td>
                          <td className={list.money}><strong>₹{inr(o.total)}</strong></td>
                          <td>
                            <div className={styles.rowEnd}>
                              <button type="button" className={styles.expand} aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} items in ${o.orderNumber}`} onClick={() => toggle(o._id)}><IconChevronDown /></button>
                              <Link className={list.openLink} href={`/orders/${o.orderNumber}`} aria-label={`Open order ${o.orderNumber}`} title="Open order"><IconArrow /></Link>
                            </div>
                          </td>
                        </tr>,
                        isOpen && (
                          <tr key={`${o._id}-body`} className={styles.orderRow}>
                            <td colSpan={6}><OrderBody order={o} /></td>
                          </tr>
                        ),
                      ];
                    })}
                  </tbody>
                </table>
              </div>
              <div className={list.cards}>
                {shown.map((o) => {
                  const t = orderStatusToken(o);
                  return (
                    <div key={o._id} className={list.card}>
                      <div className={list.cardTop}>
                        <div className="min-w-0"><Link className={list.primary} href={`/orders/${o.orderNumber}`}>{o.orderNumber}</Link><span className={list.sub}>Placed {formatDate(o.createdAt)} · {paymentMethodLabel(o.paymentMethod)}</span></div>
                        <StatusChip status={t.key} label={t.label} />
                      </div>
                      <dl className={list.cardGrid}>
                        <div><dt>Total</dt><dd><strong>₹{inr(o.total)}</strong></dd></div>
                        <div><dt>Items</dt><dd>{o.items.length}</dd></div>
                      </dl>
                      <div className={styles.cardItems}>
                        {o.items.map((it, i) => (
                          <div key={i} className={styles.item}>
                            <span className="min-w-0"><strong className="truncate">{it.name}</strong><small>{it.quantity} × ₹{inr(it.price)}</small></span>
                            <span>₹{inr(it.subtotal)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              {totalPages > 1 && (
                <div className={list.footer}>
                  <span>Page {safePage} of {totalPages}</span>
                  <div className={list.pager}>
                    <button type="button" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}><IconArrow flip /> Previous</button>
                    <button type="button" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>Next <IconArrow /></button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* Delete customer */}
      <Modal isOpen={deleteOpen} onClose={() => !deleting && setDeleteOpen(false)} placement="center" size="lg" hideCloseButton classNames={{ base: modal.modal, backdrop: modal.backdrop }}>
        <ModalContent>
          <ModalHeader className={modal.header}>
            <span className={`${modal.icon} ${modal.danger}`}><IconTrash /></span>
            <div className="min-w-0 flex-1">
              <div className={modal.eyebrow}>Delete customer</div>
              <div className={modal.title}>Delete {customer.name}?</div>
              <div className={modal.sub}>Permanent and can’t be undone.</div>
            </div>
            <button type="button" className={modal.close} onClick={() => setDeleteOpen(false)} disabled={deleting} aria-label="Close"><IconClose /></button>
          </ModalHeader>
          <ModalBody className={modal.body}>
            <div className={modal.effects}>
              <p>What happens</p>
              <ul>
                <li><IconCheck />Their account, saved addresses, cart and wishlist are removed.</li>
                <li><IconCheck />They can’t sign in any more; the email can be used for a new account.</li>
                <li><IconCheck />{(stats?.totalOrders ?? 0) > 0 ? `Their ${stats!.totalOrders} past ${stats!.totalOrders === 1 ? 'order stays' : 'orders stay'} so sellers keep their sales history; those orders will show “Deleted account”.` : 'There is no order history, so nothing else is affected.'}</li>
              </ul>
            </div>
          </ModalBody>
          <ModalFooter className={modal.footer}>
            <AdminButton variant="bordered" onPress={() => setDeleteOpen(false)} isDisabled={deleting}>Cancel</AdminButton>
            <AdminButton color="danger" onPress={runDelete} isLoading={deleting}>Delete permanently</AdminButton>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

/** Expanded order: items with seller links, and where it was sent. */
function OrderBody({ order }: { order: Order }) {
  const a = order.shippingAddress;
  return (
    <div className={styles.orderBody}>
      <div className={styles.items}>
        {order.items.map((it, i) => (
          <div key={i} className={styles.item}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {it.image ? <img className={styles.thumb} src={imageUrl(it.image)} alt="" /> : <span className={styles.thumb} aria-hidden />}
            <span className="min-w-0">
              <strong>{it.name}</strong>
              <small>
                {[it.brand, it.category, it.size && `Size ${it.size}`].filter(Boolean).join(' · ')}
                {it.sellerInfo && <> · sold by <Link href={`/sellers/${it.sellerInfo.slug || it.sellerInfo._id}`}>{it.sellerInfo.storeName || it.sellerInfo.name}</Link></>}
              </small>
            </span>
            <span><strong>₹{inr(it.subtotal)}</strong><small>{it.quantity} × ₹{inr(it.price)}</small></span>
          </div>
        ))}
      </div>
      <div className={styles.side}>
        <h4>Delivered to</h4>
        <p>{a ? <>{a.fullName && <><strong>{a.fullName}</strong><br /></>}{a.line1 && <>{a.line1}<br /></>}{[a.city, a.state].filter(Boolean).join(', ')} {a.pincode}</> : '—'}</p>
        <h4>Timeline</h4>
        <p>
          Placed {formatDateTime(order.createdAt)}
          {order.deliveredAt && <><br />Delivered {formatDateTime(order.deliveredAt)}</>}
          {order.cancelledAt && <><br />Cancelled {formatDateTime(order.cancelledAt)}</>}
        </p>
      </div>
    </div>
  );
}

function Field({ label, value, copy, wide }: { label: string; value: string; copy?: boolean; wide?: boolean }) {
  return (
    <div className={`${shared.field} ${wide ? shared.wide : ''}`}>
      <dt>{label}</dt>
      <dd>
        <span>{value}</span>
        {copy && (
          <button type="button" className={shared.copy} aria-label={`Copy ${label.toLowerCase()}`} title={`Copy ${label.toLowerCase()}`}
            onClick={() => navigator.clipboard.writeText(value).then(() => notifySuccess(M.customers.copied(label))).catch(() => notifyWarning(M.customers.copyFailedSelectTheTextManually))}>
            <IconCopy />
          </button>
        )}
      </dd>
    </div>
  );
}

function BackToCustomers() {
  return (
    <Link className={shared.back} href="/customers">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><line x1="19" y1="12" x2="5" y2="12" /><polyline points="11 18 5 12 11 6" /></svg>
      Back to customers
    </Link>
  );
}

const svg = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
function IconArrow({ flip }: { flip?: boolean }) { return <svg {...svg} width="14" height="14" style={flip ? { transform: 'scaleX(-1)' } : undefined}><line x1="5" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" /></svg>; }
function IconChevronDown() { return <svg {...svg}><polyline points="6 9 12 15 18 9" /></svg>; }
function IconClose() { return <svg {...svg} width="14" height="14"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>; }
function IconMail() { return <svg {...svg}><rect x="3" y="5" width="18" height="14" rx="2" /><polyline points="3 7 12 13 21 7" /></svg>; }
function IconCopy() { return <svg {...svg}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>; }
function IconCheck() { return <svg {...svg}><polyline points="20 6 9 17 4 12" /></svg>; }
function IconTrash() { return <svg {...svg}><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>; }
function IconBag() { return <svg {...svg}><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 0 1-8 0" /></svg>; }
