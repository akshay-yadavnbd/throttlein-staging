'use client';

/**
 * Admin — single order detail, in the seller order detail layout
 * (docs/seller-dashboard-redesign.md): summary panel with the admin verbs,
 * then each seller's parcel (items, references, problem + fix, tracking)
 * beside a side column with customer, delivery address, payment and the
 * amount breakdown.
 *
 * Behaviour unchanged (UX audit A5): Cancel order (placed/confirmed only;
 * reuses the customer's cancellation core server-side), Process refund
 * (when a refund is requested/processing), per-seller Email seller and the
 * problem block's one fix (reschedule pickup / ask seller to ship / NDR).
 * Copy buttons on every reference an admin pastes elsewhere. "Delete order"
 * archives it (hidden from every list, restorable — see DeleteOrderDialog);
 * a deleted order still opens here with a Restore banner.
 *
 * Backend: GET /api/admin/orders/:idOrNumber (+ /cancel, /reschedule-pickup, /archive, /restore).
 */
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import DeleteOrderDialog, { restoreOrder } from '@/components/DeleteOrderDialog';
import OrderTrackerVertical, { buildSectionsForAdmin } from '@/components/OrderTrackerVertical';
import { StatusChip } from '@/components/ui';
import { api, unwrap } from '@/lib/api';
import { formatDateTime } from '@/lib/dates';
import { confirmDialog } from '@/lib/confirm';
import { orderStatusToken, paymentMethodLabel, shipmentProblem, shipmentStatusToken } from '@/lib/orderStatusDisplay';
import { useOrderPolling } from '@/lib/useOrderPolling';
import styles from './detail.module.css';
import { notifyError, notifySuccess, notifyWarning, apiMessage } from '@/lib/notify';
import { M } from '@/lib/messages';

const inr = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n || 0);

/** returnRequests[].kind in plain words — a 'cancellation' entry is the refund
 *  owed on a prepaid order cancelled before dispatch, not a parcel return. */
const KIND_LABEL: Record<string, string> = { return: 'Return', exchange: 'Exchange', cancellation: 'Cancellation refund' };
const when = (d?: string | null) => (d ? formatDateTime(d) : '—');

/**
 * How the customer paid. `paymentMethod` is only 'cod' | 'online'; the
 * instrument (read back from Razorpay) says which bank bills an EMI and
 * over how long — what support gets asked, and what makes an EMI refund
 * legible. Older orders fall back to the bare method.
 */
function paymentLabel(order: any): string {
  if (order?.paymentMethod === 'cod') return 'Cash on delivery';
  const pi = order?.paymentInstrument || {};
  if (pi.method === 'emi') {
    const bits = ['EMI'];
    if (pi.emi?.tenureMonths) bits.push(`${pi.emi.tenureMonths} months`);
    if (pi.emi?.issuer || pi.bank) bits.push(pi.emi?.issuer || pi.bank);
    return bits.join(' · ');
  }
  if (pi.method === 'card') return ['Card', pi.cardNetwork, pi.cardLast4 && `•••• ${pi.cardLast4}`].filter(Boolean).join(' · ');
  if (pi.method === 'upi') return pi.vpa ? `UPI · ${pi.vpa}` : 'UPI';
  if (pi.method === 'netbanking') return pi.bank ? `Netbanking · ${pi.bank}` : 'Netbanking';
  if (pi.method === 'wallet') return pi.wallet ? `Wallet · ${pi.wallet}` : 'Wallet';
  return paymentMethodLabel(order?.paymentMethod);
}

export default function AdminOrderDetailPage({ params }: { params: Promise<{ orderNumber: string }> }) {
  const { orderNumber: id } = use(params);
  const [order, setOrder] = useState<any>(null);
  const [sellerById, setSellerById] = useState<Record<string, any>>({});
  const [error, setError] = useState<{ notFound: boolean; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const apply = (data: any) => { setOrder(data.order); setSellerById(data.sellerById || {}); setError(null); };
  const reload = () => api.get(`/admin/orders/${id}`).then((r) => apply(unwrap<any>(r)));

  useEffect(() => {
    const controller = new AbortController();
    api.get(`/admin/orders/${id}`, { signal: controller.signal })
      .then((r) => apply(unwrap<any>(r)))
      .catch((e) => {
        if (controller.signal.aborted) return;
        const status = e?.response?.status;
        setError({ notFound: status === 404 || status === 400, message: apiMessage(e) || 'This order couldn’t be loaded right now.' });
      });
    return () => controller.abort();
  }, [id, attempt]);

  // Quiet 15 s refresh while open — courier scans and refunds keep moving.
  useOrderPolling(async (signal) => {
    apply(unwrap<any>(await api.get(`/admin/orders/${id}`, { signal })));
  }, id);

  async function cancelOrder() {
    const ok = await confirmDialog({
      title: `Cancel order ${order.orderNumber}?`,
      message: [
        'Every seller’s courier booking is cancelled, stock goes back on sale, and the customer is emailed.',
        order.paymentStatus === 'paid' ? 'This order was paid online — a refund will be raised in the Refund queue.' : '',
        'This cannot be undone.',
      ].filter(Boolean).join('\n'),
      confirmLabel: 'Cancel order',
      destructive: true,
    });
    if (!ok) return;
    setBusy('cancel');
    try {
      const data = unwrap<{ carrierCancellationPending?: boolean }>(await api.post(`/admin/orders/${id}/cancel`, {}));
      notifySuccess(M.orders.orderCancelled(!!data.carrierCancellationPending));
      await reload();
    } catch (e: any) {
      notifyError(e, M.orders.couldntCancelTheOrder);
    } finally {
      setBusy(null);
    }
  }

  async function reschedulePickup(sellerId: string, sellerName: string) {
    const ok = await confirmDialog({
      title: `Book the pickup again for ${sellerName}?`,
      message: 'Asks the courier to come on the next working day. The seller sees the new date on their order.',
      confirmLabel: 'Book pickup again',
    });
    if (!ok) return;
    setBusy(`pickup:${sellerId}`);
    try {
      const data = unwrap<{ already?: boolean; pickupDate?: string | null }>(await api.post(`/admin/orders/${id}/reschedule-pickup`, { sellerId }));
      notifySuccess(M.orders.pickupBooked(!!data.already, data.pickupDate ?? undefined));
      await reload();
    } catch (e: any) {
      notifyError(e, M.orders.couldntBookThePickup);
    } finally {
      setBusy(null);
    }
  }

  if (!order) {
    return (
      <div className={styles.page}>
        <BackToOrders />
        {error ? (
          <section className={`${styles.panel} ${styles.state}`} role="alert">
            <h2>{error.notFound ? 'Order not found' : 'Couldn’t load this order'}</h2>
            <p>{error.notFound ? `There’s no order “${decodeURIComponent(id)}”. Check the number, or find it from the orders list.` : error.message}</p>
            {error.notFound
              ? <Link className={styles.darkAction} href="/orders">Go to orders</Link>
              : <button type="button" className={styles.darkAction} onClick={() => { setError(null); setAttempt((n) => n + 1); }}>Try again</button>}
          </section>
        ) : <DetailSkeleton />}
      </div>
    );
  }

  const a = order.shippingAddress || {};
  const status = orderStatusToken(order);
  const totalSavings = (order.items || []).reduce((s: number, it: any) => (it.mrp > it.price ? s + (it.mrp - it.price) * it.quantity : s), 0);
  const canCancel = ['placed', 'confirmed'].includes(order.status);
  const pendingRefunds = (order.returnRequests || []).filter((r: any) => ['requested', 'processing'].includes(r.refundStatus));
  const refundable = pendingRefunds.length > 0;
  const pendingRefundAmount = pendingRefunds.reduce((s: number, r: any) => s + (Number(r.refundAmount) || 0), 0);
  const units = (order.items || []).reduce((s: number, it: any) => s + (it.quantity || 0), 0);

  // Items grouped per seller — one parcel each.
  const itemsBySeller: Record<string, any[]> = {};
  for (const it of order.items || []) {
    const k = String(it.seller || 'unknown');
    (itemsBySeller[k] ||= []).push(it);
  }

  return (
    <div className={styles.page}>
      <BackToOrders />

      {order.archivedAt && (
        <div role="status" className={styles.archived}>
          <IconTrash />
          <span>
            <strong>Deleted {when(order.archivedAt)}{order.archivedBy?.name ? ` by ${order.archivedBy.name}` : ''}.</strong>{' '}
            {order.archiveReason ? `“${order.archiveReason}” · ` : ''}Hidden from every order list; payments, refunds and payouts still run on it.
          </span>
          <button type="button" disabled={busy === 'restore'} onClick={async () => {
            setBusy('restore');
            if (await restoreOrder(order.orderNumber)) await reload().catch(() => {});
            setBusy(null);
          }}>{busy === 'restore' ? 'Restoring…' : 'Restore order'}</button>
        </div>
      )}

      {order.fulfillmentHold && (
        <div role="alert" className={styles.hold}>
          <IconAlert /><span><strong>Dispatch on hold.</strong> {order.fulfillmentHold}</span>
        </div>
      )}

      {/* ── Summary: identity, total, admin verbs ── */}
      <section className={`${styles.panel} ${styles.summary}`} aria-labelledby="order-heading">
        <div className={styles.summaryRow}>
          <div>
            <h1 id="order-heading">
              <span>{order.orderNumber}</span>
              <CopyButton label="Order number" value={order.orderNumber} />
              <StatusChip status={status.key} label={status.label} hint={status.detail} />
            </h1>
            <div className={styles.meta}>
              <span>Placed {when(order.createdAt)}</span>
              <span>{units} {units === 1 ? 'item' : 'items'} · {Object.keys(itemsBySeller).length} seller{Object.keys(itemsBySeller).length === 1 ? '' : 's'}</span>
              {order.deliveredAt && <span>Delivered {when(order.deliveredAt)}</span>}
              {order.cancelledAt && <span>Cancelled {when(order.cancelledAt)}</span>}
            </div>
          </div>
          <div className={styles.total}>
            <strong>₹{inr(order.total)}</strong>
            <span>Total · inclusive of all taxes</span>
          </div>
        </div>
        {(canCancel || refundable || !order.archivedAt) && (
          <div className={styles.actions}>
            {refundable && <Link className={styles.darkAction} href={`/refunds?q=${encodeURIComponent(order.orderNumber)}`}>Process refund <IconArrow /></Link>}
            {refundable && (
              <span className={styles.actionNote}>
                {pendingRefunds.length === 1 ? `${KIND_LABEL[pendingRefunds[0].kind] || 'Refund'}` : `${pendingRefunds.length} refunds`}
                {pendingRefundAmount > 0 ? ` · ₹${inr(pendingRefundAmount)}` : ''}
                {pendingRefunds.some((r: any) => r.refundStatus === 'processing') ? ' · being processed' : ' · waiting in the Refund queue'}
              </span>
            )}
            {canCancel && (
              <button type="button" className={styles.dangerAction} disabled={busy === 'cancel'} onClick={cancelOrder}>
                {busy === 'cancel' ? 'Cancelling…' : 'Cancel order…'}
              </button>
            )}
            {canCancel && <span className={styles.actionNote}>Cancelling releases stock and emails the customer.</span>}
            {!order.archivedAt && (
              <button type="button" className={styles.deleteAction} onClick={() => setDeleteOpen(true)}>
                <IconTrash /> Delete order…
              </button>
            )}
          </div>
        )}
      </section>

      <DeleteOrderDialog
        order={deleteOpen ? { orderNumber: order.orderNumber, total: order.total, status: order.status, paymentMethod: order.paymentMethod, paymentStatus: order.paymentStatus, customerName: order.user?.name } : null}
        onClose={() => setDeleteOpen(false)}
        onDeleted={() => { void reload(); }}
      />

      <div className={styles.columns}>
        {/* ── Seller parcels ── */}
        <div className={styles.mainColumn}>
          {Object.entries(itemsBySeller).map(([sellerId, items]) => (
            <SellerParcel
              key={sellerId}
              order={order}
              sellerId={sellerId}
              seller={sellerById[sellerId]}
              items={items}
              busy={busy}
              onReschedule={reschedulePickup}
            />
          ))}

          {(order.returnRequests || []).length > 0 && (
            <section className={`${styles.panel} ${styles.returns}`} aria-labelledby="returns-heading">
              <h2 id="returns-heading" className={styles.cardTitle}>Returns, exchanges &amp; refunds</h2>
              {order.returnRequests.map((r: any) => (
                <div key={r._id} className={styles.returnItem}>
                  <div className={styles.returnHead}>
                    <StatusChip status={r.status} label={`${KIND_LABEL[r.kind] || r.kind} · ${String(r.status).replace(/^\w/, (c: string) => c.toUpperCase())}`} />
                    {r.refundStatus && r.refundStatus !== 'not-requested' && <StatusChip status={r.refundStatus} label={`Refund · ${r.refundStatus}`} />}
                    <span>Requested {when(r.requestedAt)}</span>
                  </div>
                  {r.reason && <p><strong>Reason:</strong> {r.reasonCode && <span className="text-[#87919a]">({r.reasonCode})</span>} {r.reason}</p>}
                  {r.decisionReason && <p className={styles.declined}><strong>Declined:</strong> {r.decisionReason}</p>}
                  {r.refundAmount > 0 && (
                    <div className={styles.stack}>
                      <span className="text-[12px]">Refund <strong className="tabular-nums">₹{inr(r.refundAmount)}</strong></span>
                      {r.refundReference && <RefRow label="Reference" value={r.refundReference} />}
                    </div>
                  )}
                </div>
              ))}
            </section>
          )}
        </div>

        {/* ── Side column ── */}
        <aside className={styles.sideColumn}>
          <section className={`${styles.panel} ${styles.card}`} aria-labelledby="customer-heading">
            <h2 id="customer-heading" className={styles.cardTitle}>Customer</h2>
            <div className={styles.person}>{order.user?.name || a.fullName || 'Deleted account'}</div>
            {order.user?.email && <div className={styles.line}><span>{order.user.email}</span><CopyButton label="Email" value={order.user.email} /></div>}
            {order.user?.phone && <div className={styles.line}><span className="tabular-nums">{order.user.phone}</span><CopyButton label="Phone" value={order.user.phone} /></div>}
          </section>

          <section className={`${styles.panel} ${styles.card}`} aria-labelledby="shipto-heading">
            <h2 id="shipto-heading" className={styles.cardTitle}>Delivery address</h2>
            <div className={`${styles.person} flex flex-wrap items-center gap-2`}>{a.fullName}{a.label && <span className={styles.tag}>{a.label}</span>}</div>
            <div className={styles.address}>
              {[a.line1, a.line2].filter(Boolean).join(', ')}<br />
              {[a.city, a.state].filter(Boolean).join(', ')} {a.pincode}
            </div>
            {a.phone && <div className={styles.line}><span className="tabular-nums">{a.phone}</span><CopyButton label="Delivery phone" value={a.phone} /></div>}
          </section>

          <section className={`${styles.panel} ${styles.card}`} aria-labelledby="payment-heading">
            <h2 id="payment-heading" className={styles.cardTitle}>Payment</h2>
            <div className="flex flex-wrap items-center gap-2">
              <span className={styles.pill}>{paymentLabel(order)}</span>
              <StatusChip status={order.paymentStatus} />
            </div>
            {order.paymentInstrument?.method === 'emi' && order.paymentInstrument?.emi?.interestRate > 0 && (
              <div className={styles.line}>Bank interest {order.paymentInstrument.emi.interestRate}% p.a.</div>
            )}
            {(order.razorpayPaymentId || order.razorpayOrderId || order.refundIds?.length > 0) && (
              <div className={styles.stack}>
                {order.razorpayPaymentId && <RefRow label="Payment" value={order.razorpayPaymentId} />}
                {order.razorpayOrderId && <RefRow label="Gateway order" value={order.razorpayOrderId} />}
                {(order.refundIds || []).map((rid: string) => <RefRow key={rid} label="Refund" value={rid} />)}
              </div>
            )}
          </section>

          <section className={`${styles.panel} ${styles.card}`} aria-labelledby="amount-heading">
            <h2 id="amount-heading" className={styles.cardTitle}>Amount</h2>
            <dl className={styles.dl}>
              <div><dt>Items</dt><dd>₹{inr(order.itemsTotal)}</dd></div>
              <div><dt>Shipping</dt><dd>{order.shippingFee > 0 ? `₹${inr(order.shippingFee)}` : 'Free'}</dd></div>
              {order.codFee > 0 && <div><dt>Cash on delivery fee</dt><dd>₹{inr(order.codFee)}</dd></div>}
              {totalSavings > 0 && <div><dt>Customer saved</dt><dd className={styles.saved}>−₹{inr(totalSavings)}</dd></div>}
              <div className={styles.dlTotal}><dt>Total</dt><dd>₹{inr(order.total)}</dd></div>
            </dl>
          </section>

          {order.notes && (
            <section className={`${styles.panel} ${styles.card}`} aria-labelledby="notes-heading">
              <h2 id="notes-heading" className={styles.cardTitle}>Customer note</h2>
              <p className={styles.notes}>{order.notes}</p>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

/** One seller's parcel: items, shipment references, the problem and its fix, tracking. */
function SellerParcel({ order, sellerId, seller: v, items, busy, onReschedule }: {
  order: any; sellerId: string; seller: any; items: any[]; busy: string | null;
  onReschedule: (sellerId: string, sellerName: string) => void;
}) {
  const shipment = (order.sellerShipments || []).find((s: any) => String(s.seller) === sellerId && (s.kind || 'forward') === 'forward');
  /* Latest approved/completed return or exchange for this seller drives the
     reverse leg of the tracker. A cancellation refund counts while it's
     live — it shows as refund steps only (nothing travels back). */
  const sellerReturn = [...(order.returnRequests || [])]
    .filter((r: any) => String(r.seller) === sellerId && (r.kind === 'cancellation'
      ? !['declined', 'cancelled'].includes(r.status)
      : ['approved', 'completed'].includes(r.status)))
    .sort((x: any, y: any) => Date.parse(y.requestedAt) - Date.parse(x.requestedAt))[0];
  const returnShipment = sellerReturn
    ? (order.sellerShipments || []).find((s: any) => String(s.seller) === sellerId && (s.kind === 'return' || s.isReturn) && String(s.returnOf || s._id) === String(sellerReturn._id))
      || (order.sellerShipments || []).find((s: any) => String(s.seller) === sellerId && (s.kind === 'return' || s.isReturn))
    : undefined;
  const replacementShipment = sellerReturn?.replacementShipmentEntryId
    ? (order.sellerShipments || []).find((s: any) => String(s._id) === String(sellerReturn.replacementShipmentEntryId))
    : undefined;
  const sections = buildSectionsForAdmin({ order, forwardShipment: shipment, returnRequest: sellerReturn, returnShipment, replacementShipment, sellerName: v?.name });
  const slice = items.reduce((s, it) => s + (it.subtotal || it.price * it.quantity), 0);
  const who = v?.name || 'the seller';
  const problem = shipment ? shipmentProblem(shipment) : null;
  const shipToken = shipment ? shipmentStatusToken(shipment) : null;

  return (
    <section className={`${styles.panel} ${styles.shipment}`} aria-label={`Parcel from ${v?.name || 'unknown seller'}`}>
      <div className={styles.shipmentHead}>
        <div>
          <p className={styles.eyebrow}>Seller parcel</p>
          <div className={styles.sellerName}>
            {v ? <Link href={`/sellers/${v.slug || v._id}?tab=profile`}>{v.name}</Link> : 'Unknown seller'}
            {shipToken && <StatusChip status={shipToken.key} label={shipToken.label} hint={shipToken.detail} />}
          </div>
        </div>
        {v?.email && (
          <a className={styles.lightAction} href={`mailto:${v.email}?subject=${encodeURIComponent(`THROTTLEIN order ${order.orderNumber}`)}`}>
            <IconMail /> Email seller
          </a>
        )}
      </div>

      <div className={styles.shipmentBody}>
        <div className={styles.items}>
          {items.map((it: any, i: number) => (
            <div key={it._id || i} className={styles.itemRow}>
              {it.image
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={it.image} alt="" />
                : <span aria-hidden className={styles.itemThumb} />}
              <div className="min-w-0">
                <div className={styles.itemName}>{it.name}</div>
                <div className={styles.itemMeta}>{[it.brand, it.size && `Size ${it.size}`, it.color, `Qty ${it.quantity}`].filter(Boolean).join(' · ')}</div>
              </div>
              <div className={styles.itemPrice}>
                <strong>₹{inr(it.subtotal || it.price * it.quantity)}</strong>
                <p>₹{inr(it.price)} each{it.mrp > it.price && <s>₹{inr(it.mrp)}</s>}</p>
                {it.mrp > it.price && <p className={styles.off}>{Math.round(((it.mrp - it.price) / it.mrp) * 100)}% off</p>}
              </div>
            </div>
          ))}

          {shipment && (shipment.awbCode || shipment.shipmentId || problem) && (
            <div className={styles.refs}>
              {shipment.awbCode && <RefRow label="Tracking no." value={shipment.awbCode} />}
              {shipment.awbCourier && <span className={styles.refRow}><span>Courier</span><span>{shipment.awbCourier}</span></span>}
              {shipment.shipmentId && <RefRow label="Shipment" value={String(shipment.shipmentId)} />}
              {/* Problem block (UX audit S4): derived from the slice's current
                  state, and names the one action that fixes it. */}
              {problem && (
                <div className={styles.problem} role="status">
                  <strong>{problem.title}</strong>
                  {problem.detail && <span>— {problem.detail}</span>}
                  <span>
                    {problem.action === 'reschedule' ? (
                      <button type="button" className={styles.problemAction} disabled={busy === `pickup:${sellerId}`} onClick={() => onReschedule(sellerId, who)}>
                        {busy === `pickup:${sellerId}` ? 'Booking…' : 'Reschedule pickup'}
                      </button>
                    ) : problem.action === 'ship' && v?.email ? (
                      <a className={styles.problemAction} href={`mailto:${v.email}?subject=${encodeURIComponent(`THROTTLEIN order ${order.orderNumber} — please ship`)}`}>Ask {who} to ship</a>
                    ) : problem.action === 'ndr' ? (
                      <span>{who} decides under Delivery issues.</span>
                    ) : null}
                  </span>
                </div>
              )}
            </div>
          )}

          <div className={styles.subtotal}>
            <span>Seller subtotal</span>
            <strong>₹{inr(slice)}</strong>
          </div>
        </div>

        <div className={styles.tracker}>
          <OrderTrackerVertical sections={sections} title={`Tracking · ${v?.name || 'Seller'}`} />
        </div>
      </div>
    </section>
  );
}

function BackToOrders() {
  return (
    <Link className={styles.back} href="/orders">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <line x1="19" y1="12" x2="5" y2="12" /><polyline points="11 18 5 12 11 6" />
      </svg>
      Back to orders
    </Link>
  );
}

/** Copy-to-clipboard icon button with a brief tick on success. */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      className={`${styles.copy} ${copied ? styles.copied : ''}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          notifySuccess(M.orders.copied(label));
          setTimeout(() => setCopied(false), 1500);
        } catch {
          notifyWarning(M.orders.copyFailedSelectTheTextManually);
        }
      }}
    >
      {copied
        ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polyline points="20 6 9 17 4 12" /></svg>
        : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>}
    </button>
  );
}

/** Reference id (AWB, shipment, Razorpay ids) — label, value, copy. */
function RefRow({ label, value }: { label: string; value: string }) {
  return (
    <span className={styles.refRow}>
      <span>{label}</span>
      <span title={value}>{value}</span>
      <CopyButton label={label} value={value} />
    </span>
  );
}

function DetailSkeleton() {
  return (
    <div className={styles.skeleton} role="status" aria-label="Loading order">
      <span style={{ height: 120, marginBottom: 20 }} />
      <div className={styles.columns}>
        <div className={styles.mainColumn}><span style={{ height: 320 }} /></div>
        <div className={styles.sideColumn}><span style={{ height: 120 }} /><span style={{ height: 140 }} /><span style={{ height: 160 }} /></div>
      </div>
    </div>
  );
}

const svg = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
function IconArrow() { return <svg {...svg}><line x1="5" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" /></svg>; }
function IconTrash() { return <svg {...svg}><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>; }
function IconMail() { return <svg {...svg}><rect x="3" y="5" width="18" height="14" rx="2" /><polyline points="3 7 12 13 21 7" /></svg>; }
function IconAlert() { return <svg {...svg}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>; }
