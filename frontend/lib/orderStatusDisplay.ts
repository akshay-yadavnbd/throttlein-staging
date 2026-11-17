/**
 * ONE definition of "what status should we show for this order".
 *
 * WHY THIS EXISTS
 * `order.status` is a cached aggregate across every seller on the order,
 * and orders created under the old flow were flipped to `shipped` the
 * moment a shipping label was generated. Booking a courier is not
 * dispatch: the carrier still reports PICKUP SCHEDULED and the parcel is
 * physically with the seller. The shipment knows the truth — an AWB
 * means the label exists, and only the courier's own pickup scan means
 * the parcel actually left.
 *
 * This lived inline in four different views (seller list, seller detail,
 * admin list, admin detail) and they promptly disagreed with each other
 * about the same order. Every view now calls this.
 *
 * MIRRORED between `admin/lib/` and `frontend/lib/` — the two apps have
 * separate Docker build contexts and cannot import across each other, so
 * the pair is kept byte-identical and enforced by
 * `scripts/check-theme-sync.js`. Edit BOTH copies.
 */

export type ShipmentSlice = {
  seller?: string;
  kind?: string;
  returnOf?: string | null;
  status?: string;
  awbCode?: string;
  pickedUpAt?: string | null;
  pickupBookedAt?: string | null;
  pickupScheduledAt?: string | null;
  pickupError?: string;
  /** Last failure recorded by our side (push, label, cancel). */
  lastError?: string;
  currentStatus?: string;
  statusEventAt?: string | null;
  trackingSyncedAt?: string | null;
  deliveredAt?: string | null;
  confirmedAt?: string | null;
  etd?: string | null;
  _id?: string;
};

export type OrderForStatus = {
  status: string;
  sellerShipments?: ShipmentSlice[];
};

/** Slice statuses that mean the parcel has genuinely left the seller. */
export const SHIPPED_SLICE_STATUSES: ReadonlySet<string> = new Set([
  'shipped',
  'out_for_delivery',
  'delivered',
  'undelivered',
  'rto_initiated',
  'rto_in_transit',
  'rto_delivered',
  'lost',
]);

/** Label shown between "confirmed" and "shipped". */
export const PICKUP_SCHEDULED = 'Awaiting pickup';

/**
 * The order's FORWARD shipment legs — the ones that carry goods to the
 * customer. Return legs (`kind: 'return'`) and replacement legs (which
 * carry `returnOf`) are excluded: neither says anything about whether
 * the original parcel has been dispatched.
 *
 * Pass `sellerId` on seller-facing views to consider only that seller's
 * slice; omit it on admin views to consider the whole order.
 */
export function forwardSlices(
  order: OrderForStatus | null | undefined,
  sellerId?: string | null,
): ShipmentSlice[] {
  const all = order?.sellerShipments || [];
  return all.filter(
    (s) =>
      (s.kind || 'forward') === 'forward' &&
      !s.returnOf &&
      (!sellerId || String(s.seller) === String(sellerId)),
  );
}

/** Has this slice physically left the seller? */
export function sliceHasShipped(s: ShipmentSlice | null | undefined): boolean {
  if (!s) return false;
  return !!s.pickedUpAt || SHIPPED_SLICE_STATUSES.has(String(s.status));
}

/**
 * Who is looking. Sellers and admins need the courier-booking detail
 * ("Pickup scheduled", "PICKUP EXCEPTION", "AWB assigned") because they act
 * on it. Customers do not: for them a parcel is simply Placed → Confirmed
 * until the courier's own pickup scan, after which the carrier's exact
 * labels take over ("IN TRANSIT", "OUT FOR DELIVERY", "DELIVERED" …).
 */
export type StatusPerspective = 'ops' | 'customer';

/* ── ONE STATUS VOCABULARY ────────────────────────────────────────────
 * UX audit X1: the same parcel showed as `NEW`, `New`, `In Transit`,
 * `PICKUP EXCEPTION` on different screens, all in grey. Every screen now
 * derives a StatusToken from the slice and renders its `label`; the
 * courier's own wording travels alongside as `detail` for people who need
 * it (sellers, admins) and is never the headline. Keys are stable ids that
 * StatusChip colours; labels are the only words a user sees.
 */
export type StatusKey =
  | 'placed' | 'confirmed' | 'awaiting_pickup' | 'pickup_failed'
  | 'in_transit' | 'out_for_delivery' | 'delivery_failed' | 'delivered'
  | 'returning' | 'returned' | 'cancelled' | 'lost' | 'shipping_error' | 'multiple';

export type StatusTone = 'neutral' | 'positive' | 'attention' | 'negative' | 'info';

export type StatusToken = {
  key: StatusKey;
  /** Plain English, sentence case. The only text a user reads. */
  label: string;
  /** Courier's own wording when it adds information ("Pickup Exception"). */
  detail?: string;
};

export const STATUS_LABEL: Record<StatusKey, string> = {
  placed: 'Placed',
  confirmed: 'Confirmed',
  awaiting_pickup: 'Awaiting pickup',
  pickup_failed: 'Pickup failed',
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
  delivery_failed: 'Delivery failed',
  delivered: 'Delivered',
  returning: 'Returning to seller',
  returned: 'Returned',
  cancelled: 'Cancelled',
  lost: 'Lost',
  shipping_error: 'Shipping error',
  multiple: 'Multiple shipments',
};

/** Colour meaning per key — mirrored in components/ui/StatusChip. */
export const STATUS_KEY_TONE: Record<StatusKey, StatusTone> = {
  placed: 'neutral',
  confirmed: 'attention',
  awaiting_pickup: 'attention',
  pickup_failed: 'negative',
  in_transit: 'info',
  out_for_delivery: 'info',
  delivery_failed: 'negative',
  delivered: 'positive',
  returning: 'negative',
  returned: 'negative',
  cancelled: 'negative',
  lost: 'negative',
  shipping_error: 'negative',
  multiple: 'neutral',
};

/** HeroUI v2 `Chip color` for pages still on v2 (seller dashboard). */
export function statusChipColor(key: StatusKey): 'default' | 'primary' | 'success' | 'warning' | 'danger' {
  const tone = STATUS_KEY_TONE[key];
  return tone === 'positive' ? 'success' : tone === 'attention' ? 'warning'
    : tone === 'negative' ? 'danger' : tone === 'info' ? 'primary' : 'default';
}

function titleCase(v: string): string {
  return v.toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\b(Rto|Awb|Ndr|Ofd|Otp|Cod|Pod)\b/g, (m) => m.toUpperCase());
}

/** The status of one parcel, as a token. */
export function shipmentStatusToken(s: ShipmentSlice, perspective: StatusPerspective = 'ops'): StatusToken {
  const raw = String(s.currentStatus || '').trim();
  const norm = raw.toUpperCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  const st = s.status || '';
  const withDetail = (key: StatusKey): StatusToken => {
    const label = STATUS_LABEL[key];
    // Only surface the courier's wording when it says something the label
    // does not (e.g. "Pickup Exception" under "Pickup failed").
    const detail = raw && norm !== label.toUpperCase() ? titleCase(raw) : undefined;
    return detail ? { key, label, detail } : { key, label };
  };

  if (st === 'cancelled') return { key: 'cancelled', label: STATUS_LABEL.cancelled };

  if (perspective === 'customer' && !sliceHasShipped(s)) {
    // Courier booking, label generation and pickup attempts are the
    // seller's business — the customer sees only that the seller accepted.
    const key: StatusKey = s.confirmedAt || s.awbCode ? 'confirmed' : 'placed';
    return { key, label: STATUS_LABEL[key] };
  }

  if (st === 'delivered') return withDetail('delivered');
  if (st === 'returned' || st === 'rto_delivered') return withDetail('returned');
  if (st === 'rto_initiated' || st === 'rto_in_transit') return withDetail('returning');
  if (st === 'lost') return withDetail('lost');
  if (st === 'undelivered') return withDetail('delivery_failed');
  if (st === 'out_for_delivery') return withDetail('out_for_delivery');
  if (st === 'shipped' || s.pickedUpAt) return withDetail('in_transit');
  if (st === 'failed') return withDetail('shipping_error');

  // Label exists, parcel still with the seller.
  if (s.awbCode) {
    if (/PICKUP (EXCEPTION|ERROR|FAILED|CANCELLED)|NOT PICKED/.test(norm)) return withDetail('pickup_failed');
    if (s.pickupError) return { key: 'shipping_error', label: STATUS_LABEL.shipping_error, detail: 'Pickup booking failed' };
    return withDetail('awaiting_pickup');
  }
  if (s.confirmedAt) return { key: 'confirmed', label: STATUS_LABEL.confirmed };
  return { key: 'placed', label: STATUS_LABEL.placed };
}

/** The status of a whole order (or one seller's part of it), as a token. */
export function orderStatusToken(
  order: OrderForStatus | null | undefined,
  sellerId?: string | null,
  perspective: StatusPerspective = 'ops',
): StatusToken {
  if (!order) return { key: 'placed', label: '' };
  const slices = forwardSlices(order, sellerId);
  if (!slices.length) {
    const map: Record<string, StatusKey> = { placed: 'placed', confirmed: 'confirmed', shipped: 'in_transit', delivered: 'delivered', cancelled: 'cancelled' };
    const key = map[order.status] || 'placed';
    return { key, label: STATUS_LABEL[key] };
  }
  const tokens = slices.map((s) => shipmentStatusToken(s, perspective));
  const keys = [...new Set(tokens.map((t) => t.key))];
  if (keys.length === 1) {
    const details = [...new Set(tokens.map((t) => t.detail).filter(Boolean))] as string[];
    return details.length ? { key: keys[0], label: STATUS_LABEL[keys[0]], detail: details.join(' · ') } : { key: keys[0], label: STATUS_LABEL[keys[0]] };
  }
  return { key: 'multiple', label: STATUS_LABEL.multiple, detail: tokens.map((t) => t.label).join(' · ') };
}

/** Plain label for a whole order. Prefer orderStatusToken when you also want colour or detail. */
export function orderDisplayStatus(
  order: OrderForStatus | null | undefined,
  sellerId?: string | null,
  perspective: StatusPerspective = 'ops',
): string {
  return orderStatusToken(order, sellerId, perspective).label;
}

/** Plain label for one parcel. Prefer shipmentStatusToken when you also want colour or detail. */
export function shipmentDisplayStatus(s: ShipmentSlice, perspective: StatusPerspective = 'ops'): string {
  return shipmentStatusToken(s, perspective).label;
}

/** Derive a parcel's lifecycle without borrowing other sellers' timestamps. */
export function orderForShipment<T extends OrderForStatus>(order: T, s?: ShipmentSlice | null): T {
  if (!s) return order;
  const status = s.status === 'cancelled' ? 'cancelled' : s.status === 'delivered' ? 'delivered' :
    sliceHasShipped(s) ? 'shipped' : s.confirmedAt ? 'confirmed' : 'placed';
  return { ...order, status, confirmedAt: s.confirmedAt || null,
    shippedAt: s.pickedUpAt || null, deliveredAt: s.deliveredAt || null };
}

/* ── Problems (UX audit S4) ─────────────────────────────────────────────
 * An error used to be whatever string happened to be left in `lastError`,
 * printed in red with no way out — and it stayed there after the problem
 * was gone ("AWB failed: already assigned" under a parcel that had a label
 * and a courier). A problem is now derived from the slice's CURRENT state,
 * so a stale string is never shown, and each kind names the one action
 * that resolves it. Views render the block; they do not invent the copy.
 */
export type ProblemAction = 'ship' | 'reschedule' | 'ndr' | 'support';
export type ShipmentProblem = {
  kind: 'push_failed' | 'label_failed' | 'pickup_booking_failed' | 'pickup_failed' | 'delivery_failed' | 'lost';
  /** Plain-language headline. */
  title: string;
  /** The cause, in the courier's/our words, when there is one. */
  detail?: string;
  /** The one thing that fixes it. */
  action: ProblemAction;
  actionLabel: string;
};

const cleanError = (v?: string) => String(v || '').replace(/^AWB failed:\s*/i, '').trim();

export function shipmentProblem(s: ShipmentSlice | null | undefined): ShipmentProblem | null {
  if (!s) return null;
  const st = s.status || '';
  if (st === 'cancelled' || st === 'delivered' || st === 'returned' || st === 'rto_delivered') return null;
  if (st === 'lost') {
    return { kind: 'lost', title: 'The courier has marked this parcel lost', action: 'support', actionLabel: 'Contact support' };
  }
  if (st === 'undelivered') {
    return { kind: 'delivery_failed', title: 'The courier could not deliver', detail: s.currentStatus ? titleCase(s.currentStatus) : undefined,
      action: 'ndr', actionLabel: 'Choose what happens next' };
  }
  // Once the parcel has moved, anything older is history — not a problem.
  if (sliceHasShipped(s) || s.pickedUpAt) return null;
  if (st === 'failed') {
    return { kind: 'push_failed', title: 'This order never reached the courier', detail: cleanError(s.lastError) || undefined,
      action: 'ship', actionLabel: 'Ship order' };
  }
  if (!s.awbCode) {
    // Pushed, but the label step failed and we still have no tracking no.
    if (/^AWB failed:/i.test(String(s.lastError || ''))) {
      return { kind: 'label_failed', title: 'The shipping label could not be generated', detail: cleanError(s.lastError),
        action: 'ship', actionLabel: 'Ship order' };
    }
    return null; // nothing booked yet — that's a to-do, not an error
  }
  const norm = String(s.currentStatus || '').toUpperCase();
  if (/PICKUP (EXCEPTION|ERROR|FAILED|CANCELLED)|NOT PICKED/.test(norm)) {
    return { kind: 'pickup_failed', title: 'The courier did not collect the parcel', detail: titleCase(s.currentStatus || ''),
      action: 'reschedule', actionLabel: 'Book pickup again' };
  }
  if (s.pickupError) {
    return { kind: 'pickup_booking_failed', title: 'The label is ready but the pickup was not booked', detail: cleanError(s.pickupError),
      action: 'reschedule', actionLabel: 'Book pickup again' };
  }
  // A label exists: an old "AWB failed" (or any other pre-label error) is stale.
  return null;
}

/* ── Payment vocabulary (UX audit W7) ──────────────────────────────────
 * The same order was labelled "ONLINE · paid", "Prepaid", "COD", "cod"
 * and "Paid" depending on the screen. One word per idea, everywhere:
 *   method  → Online · Cash on delivery
 *   status  → Paid · Pending · Failed · Refunded
 * Never print the raw enum or upper-case it. */
export function paymentMethodLabel(method?: string | null): string {
  if (method === 'cod') return 'Cash on delivery';
  if (method === 'online') return 'Online';
  return method || '—';
}

export function paymentStatusLabel(status?: string | null): string {
  switch (status) {
    case 'paid': return 'Paid';
    case 'pending': return 'Pending';
    case 'failed': return 'Failed';
    case 'refunded': return 'Refunded';
    default: return status || '—';
  }
}

/** How a refund is (or will be) sent back, for the Refunds queue. */
export function refundMethodLabel(refundMethod?: string | null, paymentMethod?: string | null): string {
  if (refundMethod === 'razorpay') return 'Online (Razorpay)';
  if (refundMethod === 'manual') return 'Bank transfer';
  return paymentMethod === 'cod' ? 'Bank transfer' : paymentMethodLabel(paymentMethod);
}
