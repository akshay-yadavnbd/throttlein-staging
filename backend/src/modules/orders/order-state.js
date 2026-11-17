/**
 * Order state rules — pure functions over an order document.
 *
 * Per-seller fulfilment + derived order state (audit A12): sellers act on
 * THEIR sellerShipments slice only, and the customer-facing order.status is
 * DERIVED from all forward slices:
 *
 *   cancelled  — every slice cancelled
 *   delivered  — every non-cancelled slice delivered (all parcels arrived)
 *   shipped    — at least one slice has physically shipped
 *   confirmed  — at least one seller acknowledged their slice
 *   placed     — otherwise
 *
 * COD is marked paid only when EVERYTHING is delivered — the customer pays
 * each courier per parcel, but order-level `paymentStatus` means "the
 * customer owes nothing further", which is only true at full delivery.
 */

const SLICE_SHIPPED_SET = new Set([
  'shipped',
  'out_for_delivery',
  'delivered',
  'undelivered',
  'rto_initiated',
  'rto_in_transit',
  'rto_delivered',
  'lost',
]);

/** Labelled, still with the seller. `awb` = label made, `pushed` = pickup
 *  booked, `failed` = the courier's attempt failed so it's back on them. */
const AWAITING_HANDOVER = new Set(['awb', 'pushed', 'failed']);

/** Slice states from which a forward parcel can no longer be dispatched. */
const UNDISPATCHABLE = new Set(['cancelled', 'returned', 'rto_initiated', 'rto_in_transit', 'rto_delivered', 'lost']);

const isForward = (slice) => (slice.kind || 'forward') === 'forward';

/** This seller's forward slice (first leg, not a replacement). */
function forwardSliceFor(order, sellerId) {
  const sid = String(sellerId);
  return (order.sellerShipments || []).find((s) => String(s.seller) === sid && isForward(s) && !s.returnOf) || null;
}

/** This seller's forward slice including replacement legs (which carry returnOf). */
function anyForwardSliceFor(order, sellerId) {
  const sid = String(sellerId);
  return (order.sellerShipments || []).find((s) => String(s.seller) === sid && isForward(s)) || null;
}

/** First slice of any kind this seller owns — what the legacy loader returned. */
function firstSliceFor(order, sellerId) {
  const sid = String(sellerId);
  return (order.sellerShipments || []).find((s) => String(s.seller) === sid) || null;
}

/** Recompute order.status / timestamps / COD paymentStatus from the slices. Mutates and returns the order. */
function deriveOrderAggregate(order) {
  if (order.status === 'cancelled') return order; // terminal — never resurrect
  const sellerIds = [...new Set((order.items || []).map((i) => i.seller && String(i.seller)).filter(Boolean))];
  if (!sellerIds.length) return order;
  const fwd = new Map();
  for (const vs of order.sellerShipments || []) {
    if (!isForward(vs)) continue;
    // Replacement legs carry returnOf — they don't gate first delivery.
    if (vs.returnOf) continue;
    fwd.set(String(vs.seller), vs);
  }
  const entries = sellerIds.map((id) => fwd.get(id) || null);
  const nonCancelled = entries.filter((e) => !(e && e.status === 'cancelled'));

  const now = new Date();
  if (nonCancelled.length === 0) {
    order.status = 'cancelled';
    order.cancelledAt = order.cancelledAt || now;
    return order;
  }
  const allDelivered = nonCancelled.every((e) => e && e.status === 'delivered');
  const anyShipped = entries.some((e) => e && SLICE_SHIPPED_SET.has(e.status));
  const anyConfirmed = entries.some((e) => e && e.confirmedAt);

  if (allDelivered) {
    order.status = 'delivered';
    order.deliveredAt = order.deliveredAt || now;
    if (order.paymentMethod === 'cod' && order.paymentStatus === 'pending') {
      order.paymentStatus = 'paid';
    }
  } else if (anyShipped) {
    order.status = 'shipped';
    order.shippedAt = order.shippedAt || now;
  } else if (anyConfirmed) {
    order.status = 'confirmed';
    order.confirmedAt = order.confirmedAt || now;
  } else {
    order.status = 'placed';
  }
  return order;
}

module.exports = {
  SLICE_SHIPPED_SET,
  AWAITING_HANDOVER,
  UNDISPATCHABLE,
  isForward,
  forwardSliceFor,
  anyForwardSliceFor,
  firstSliceFor,
  deriveOrderAggregate,
};
