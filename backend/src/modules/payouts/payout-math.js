/**
 * Seller payouts: what a seller earns per delivered parcel, and how those
 * parcels roll up into weekly settlements.
 *
 * MONEY MODEL (product decision, 25 Sep 2026)
 *   seller net for a parcel = item total for that seller
 *                            − courier charge for that parcel (what Shiprocket bills us)
 *                            − gateway charge share (Razorpay fee+GST, split by item share)
 *                            − refunds already paid back to the customer for that seller's items
 *   No platform commission. The customer's ₹49 shipping fee (orders under
 *   ₹999) and the COD convenience fee stay with the platform — they are
 *   not the seller's.
 *
 * SETTLEMENT CYCLE
 *   A parcel becomes payable when its status is `delivered`. Parcels are
 *   grouped by the IST week (Monday 00:00 → next Monday) of `deliveredAt`
 *   and paid the following week by bank transfer; admin records the UTR
 *   on a Settlement document, which freezes the lines it paid.
 *
 * Everything that reads money is a pure function on plain order objects so
 * the same code runs in the seller page, the admin page and the tests.
 */
const IST_OFFSET_MIN = 330;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Monday 00:00 IST of the week containing `date`, and the next Monday. */
function weekBounds(date = new Date()) {
  const d = new Date(date.getTime() + IST_OFFSET_MIN * 60000); // shift to IST wall clock
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  const mondayUtcMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day) - IST_OFFSET_MIN * 60000;
  const start = new Date(mondayUtcMs);
  const end = new Date(mondayUtcMs + 7 * 86400000);
  return { start, end, key: weekKey(start) };
}

/** YYYY-MM-DD of the week's Monday in IST — the id used in URLs. */
function weekKey(start) {
  const d = new Date(start.getTime() + IST_OFFSET_MIN * 60000);
  return d.toISOString().slice(0, 10);
}

/** Parse a YYYY-MM-DD week key (any day of that week is accepted). */
function weekFromKey(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key || ''))) return null;
  const [y, m, d] = key.split('-').map(Number);
  const noonIst = new Date(Date.UTC(y, m - 1, d, 12) - IST_OFFSET_MIN * 60000);
  if (Number.isNaN(noonIst.getTime())) return null;
  return weekBounds(noonIst);
}

/** Courier charge from Shiprocket's AWB-assign payload, or null. */
function courierChargeFromAwb(awbData) {
  // Assign-AWB puts freight_charges at the top level; order detail nests it
  // under awb_data.charges. Empty strings mean "not billed yet", not zero.
  const c = awbData?.charges || awbData?.awb_data?.charges || {};
  const money = (v) => {
    if (v === '' || v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const freight =
    money(awbData?.freight_charges) ??
    money(awbData?.freight_charge) ??
    money(c.freight_charges) ??
    money(c.applied_weight_amount) ??
    money(awbData?.rate);
  if (freight === null || freight < 0) return null;
  const cod = money(awbData?.cod_charges) ?? money(awbData?.cod_charge) ?? money(c.cod_charges) ?? 0;
  return {
    freight: round2(freight),
    cod: round2(cod),
    total: round2(freight + cod),
    source: 'shiprocket-awb',
    capturedAt: new Date(),
  };
}

/** Courier charge from a serviceability rate row (the courier the seller picked). */
function courierChargeFromRate(row) {
  if (!row) return null;
  const freight = Number(row.rate ?? row.freight_charge);
  if (!Number.isFinite(freight) || freight < 0) return null;
  const cod = Number(row.cod_charges || 0) || 0;
  return {
    freight: round2(freight),
    cod: round2(cod),
    total: round2(freight + cod),
    source: 'shiprocket-rate',
    capturedAt: new Date(),
  };
}

/**
 * One seller's earnings on one order. Pure; `order` is a plain object.
 * Returns null when the seller has no forward parcel on the order.
 */
function sellerLine(order, sellerId) {
  const sid = String(sellerId);
  const items = (order.items || []).filter((i) => i.seller && String(i.seller) === sid);
  const slice = (order.sellerShipments || []).find(
    (s) => String(s.seller) === sid && (s.kind || 'forward') === 'forward' && !s.returnOf,
  );
  if (!slice) return null;
  const itemTotal = round2(items.reduce((s, i) => s + (i.subtotal || 0), 0));
  const orderItemsTotal =
    Number(order.itemsTotal) || (order.items || []).reduce((s, i) => s + (i.subtotal || 0), 0) || 1;
  const share = itemTotal / orderItemsTotal;
  const flags = [];

  const courier =
    slice.courierCharge && Number.isFinite(slice.courierCharge.total) ? round2(slice.courierCharge.total) : null;
  if (courier === null) flags.push('courier_charge_missing');

  /* Delivery the CUSTOMER paid for this parcel (seller has
   * deliveryPaidByCustomer on). It is credited back to the seller so it
   * cancels the courier's bill above: the seller neither gains nor loses
   * on shipping, and any gap between the quote and the real freight is
   * visible as a small +/- rather than hidden. */
  const paidLine = (order.delivery || []).find((d) => String(d.seller) === sid);
  const deliveryCollected = paidLine ? round2(paidLine.amount) : 0;

  let gateway = 0;
  if (order.paymentMethod === 'online') {
    if (order.gatewayFee && Number.isFinite(order.gatewayFee.total)) gateway = round2(order.gatewayFee.total * share);
    else flags.push('gateway_fee_missing');
  }

  const refunds = round2(
    (order.returnRequests || [])
      .filter((r) => String(r.seller) === sid && r.refundStatus === 'completed')
      .reduce((s, r) => s + (r.refundAmount || 0), 0),
  );

  const net = round2(itemTotal + deliveryCollected - (courier || 0) - gateway - refunds);
  return {
    orderId: order._id,
    orderNumber: order.orderNumber,
    paymentMethod: order.paymentMethod,
    deliveredAt: slice.deliveredAt || null,
    status: slice.status,
    courierName: slice.awbCourier || paidLine?.courierName || '',
    itemTotal,
    courierCharge: courier,
    deliveryCollected,
    gatewayCharge: gateway,
    refunds,
    net,
    flags,
  };
}

/** Sum lines into the totals every page shows. */
function totals(lines) {
  const t = {
    orders: lines.length,
    itemTotal: 0,
    courierCharge: 0,
    deliveryCollected: 0,
    gatewayCharge: 0,
    refunds: 0,
    net: 0,
    missing: 0,
  };
  for (const l of lines) {
    t.itemTotal += l.itemTotal;
    t.courierCharge += l.courierCharge || 0;
    t.deliveryCollected += l.deliveryCollected || 0;
    t.gatewayCharge += l.gatewayCharge;
    t.refunds += l.refunds;
    t.net += l.net;
    if (l.flags.length) t.missing += 1;
  }
  for (const k of ['itemTotal', 'courierCharge', 'deliveryCollected', 'gatewayCharge', 'refunds', 'net'])
    t[k] = round2(t[k]);
  return t;
}

/** Parcel statuses between "label printed" and "delivered" — the courier has
 *  billed (or will bill) these, but they don't belong to a week yet. */
const IN_TRANSIT_STATUSES = ['awb', 'shipped', 'out_for_delivery', 'undelivered'];

/** Mongo filter: this seller's forward parcels that are on their way. */
function inTransitFilter(sellerId) {
  return {
    sellerShipments: {
      $elemMatch: {
        seller: sellerId,
        status: { $in: IN_TRANSIT_STATUSES },
        awbCode: { $ne: '' },
        $or: [{ kind: 'forward' }, { kind: { $exists: false } }],
        returnOf: { $exists: false },
      },
    },
  };
}

/** Mongo filter: this seller's forward parcels delivered inside [start, end). */
function deliveredFilter(sellerId, start, end) {
  const elem = {
    seller: sellerId,
    status: 'delivered',
    $or: [{ kind: 'forward' }, { kind: { $exists: false } }],
    returnOf: { $exists: false },
  };
  if (start || end) elem.deliveredAt = { ...(start ? { $gte: start } : {}), ...(end ? { $lt: end } : {}) };
  return { sellerShipments: { $elemMatch: elem } };
}

module.exports = {
  weekBounds,
  weekKey,
  weekFromKey,
  courierChargeFromAwb,
  courierChargeFromRate,
  sellerLine,
  totals,
  deliveredFilter,
  inTransitFilter,
  IN_TRANSIT_STATUSES,
  round2,
};
