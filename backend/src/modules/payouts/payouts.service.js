/**
 * Seller payouts and admin settlements. Delivered parcels roll into IST
 * weeks; a finished week is "due" until the admin records the bank
 * transfer, which freezes its lines in a Settlement. The money maths
 * (per-line earnings, totals, week bounds) lives in payout-math.js.
 */
const mongoose = require('mongoose');
const { AppError } = require('../../errors/AppError');
const math = require('./payout-math');
const payouts = require('./payouts.repository');

const byNewestDelivery = (a, b) => new Date(b.deliveredAt).getTime() - new Date(a.deliveredAt).getTime();
const sumNet = (rows) => math.round2(rows.reduce((s, r) => s + r.totals.net, 0));

/** Route param may be a Mongo id or an order number (same rule as the orders module). */
function orderIdentityFilter(idOrNumber) {
  if (typeof idOrNumber !== 'string' || !idOrNumber.trim() || idOrNumber.length > 80)
    throw AppError.badRequest('Invalid order id');
  return mongoose.isValidObjectId(idOrNumber) ? { _id: idOrNumber } : { orderNumber: idOrNumber.toUpperCase() };
}

/** One seller's delivered lines in [start, end) (all time when both are null), newest delivery first. */
async function linesFor(sellerId, start, end) {
  const orders = await payouts.ordersFor(math.deliveredFilter(sellerId, start, end));
  return orders
    .map((o) => math.sellerLine(o, sellerId))
    .filter((l) => l && l.status === 'delivered')
    .sort(byNewestDelivery);
}

/** Lines grouped into IST weeks, newest first, each marked paid / in_progress / due. */
function weeksFrom(lines, settlements) {
  const byKey = new Map();
  for (const l of lines) {
    const w = math.weekBounds(new Date(l.deliveredAt));
    if (!byKey.has(w.key)) byKey.set(w.key, { weekKey: w.key, periodStart: w.start, periodEnd: w.end, lines: [] });
    byKey.get(w.key).lines.push(l);
  }
  const paid = new Map((settlements || []).map((s) => [s.weekKey, s]));
  const current = math.weekBounds(new Date()).key;
  return [...byKey.values()]
    .sort((a, b) => (a.weekKey < b.weekKey ? 1 : -1))
    .map((w) => {
      const s = paid.get(w.weekKey);
      return {
        ...w,
        totals: math.totals(w.lines),
        status: s ? 'paid' : w.weekKey === current ? 'in_progress' : 'due',
        settlement: s ? { amountPaid: s.amountPaid, utr: s.utr, paidAt: s.paidAt, note: s.note } : null,
      };
    });
}

/** Forward parcels of `orders` that pass `keep`, as payout lines grouped by seller id. */
function linesBySeller(orders, keep) {
  const bySeller = new Map();
  for (const o of orders) {
    for (const s of o.sellerShipments || []) {
      if ((s.kind || 'forward') !== 'forward' || s.returnOf || !keep(s)) continue;
      const line = math.sellerLine(o, s.seller);
      if (!line) continue;
      const key = String(s.seller);
      if (!bySeller.has(key)) bySeller.set(key, []);
      bySeller.get(key).push(line);
    }
  }
  return bySeller;
}

const sellerSummaryOf = (u, id) => ({ _id: id, name: u.storeName || u.name || 'Seller', email: u.email, slug: u.slug });

/* ── seller ───────────────────────────────────────────────────────────── */

/**
 * The seller's Payouts page in one call. Parcels still moving are shown so
 * the seller sees their charges as they happen; they join a settlement week
 * only once delivered.
 */
async function sellerSummary(sellerId) {
  const [lines, settlements, moving] = await Promise.all([
    linesFor(sellerId, null, null),
    payouts.settlementsOf(sellerId),
    payouts.ordersFor(math.inTransitFilter(sellerId), { newestFirst: true }),
  ]);
  const weeks = weeksFrom(lines, settlements);
  const inTransitLines = moving
    .map((o) => math.sellerLine(o, sellerId))
    .filter((l) => l && math.IN_TRANSIT_STATUSES.includes(l.status));
  return {
    inTransit: { lines: inTransitLines, totals: math.totals(inTransitLines) },
    thisWeek: weeks.find((w) => w.status === 'in_progress') || null,
    due: sumNet(weeks.filter((w) => w.status === 'due')),
    paidLifetime: math.round2(settlements.reduce((s, x) => s + (x.amountPaid || 0), 0)),
    weeks: weeks.map(({ lines: ls, ...w }) => ({ ...w, lines: ls })),
  };
}

/* ── admin ────────────────────────────────────────────────────────────── */

/** Every seller's week side by side; by default the last COMPLETE week (the one due now). */
async function adminWeek(weekKey) {
  const week =
    math.weekFromKey(weekKey) ||
    (() => {
      const cur = math.weekBounds(new Date());
      return math.weekBounds(new Date(cur.start.getTime() - 86400000));
    })();
  const orders = await payouts.deliveredInWeek(week.start, week.end);
  const bySeller = linesBySeller(
    orders,
    (s) => s.status === 'delivered' && s.deliveredAt >= week.start && s.deliveredAt < week.end,
  );
  const sellerIds = [...bySeller.keys()];
  const [sellers, settlements] = await Promise.all([
    payouts.sellersWithBank(sellerIds),
    payouts.settlementsForWeek(week.key, sellerIds),
  ]);
  const sMap = new Map(sellers.map((u) => [String(u._id), u]));
  const paid = new Map(settlements.map((x) => [String(x.seller), x]));
  const rows = sellerIds
    .map((id) => {
      const u = sMap.get(id) || /** @type {any} */ ({});
      const lines = bySeller.get(id).sort(byNewestDelivery);
      const st = paid.get(id);
      const bank = u.bankDetails || {};
      return {
        seller: {
          ...sellerSummaryOf(u, id),
          bank: bank.accountNumber
            ? {
                bankName: bank.bankName,
                accountHolder: bank.accountHolder,
                last4: String(bank.accountNumber).slice(-4),
                ifsc: bank.ifsc,
              }
            : null,
        },
        totals: math.totals(lines),
        lines,
        status: st ? 'paid' : 'due',
        settlement: st
          ? { amountPaid: st.amountPaid, utr: st.utr, paidAt: st.paidAt, paidByEmail: st.paidByEmail, note: st.note }
          : null,
      };
    })
    .sort((a, b) => b.totals.net - a.totals.net);
  const current = math.weekBounds(new Date());
  return {
    week: { weekKey: week.key, periodStart: week.start, periodEnd: week.end, inProgress: week.key === current.key },
    rows,
    totals: { sellers: rows.length, net: sumNet(rows), paid: rows.filter((r) => r.status === 'paid').length },
  };
}

/** Every seller's parcels on their way: charges are known, so the admin can check them before settlement. */
async function adminInTransit() {
  const orders = await payouts.inTransit(math.IN_TRANSIT_STATUSES);
  const bySeller = linesBySeller(orders, (s) => s.awbCode && math.IN_TRANSIT_STATUSES.includes(s.status));
  const sellerIds = [...bySeller.keys()];
  const sMap = new Map((await payouts.sellersBasic(sellerIds)).map((u) => [String(u._id), u]));
  const rows = sellerIds
    .map((id) => {
      const lines = bySeller.get(id);
      return { seller: sellerSummaryOf(sMap.get(id) || {}, id), totals: math.totals(lines), lines };
    })
    .sort((a, b) => b.totals.net - a.totals.net);
  return {
    rows,
    totals: { sellers: rows.length, orders: rows.reduce((s, r) => s + r.totals.orders, 0), net: sumNet(rows) },
  };
}

/** Record a finished week as paid: its lines are frozen in the Settlement. One settlement per seller per week. */
async function pay(admin, body = {}) {
  const { sellerId } = body;
  const week = math.weekFromKey(body.week);
  if (!mongoose.isValidObjectId(sellerId) || !week)
    throw AppError.badRequest('sellerId and week (YYYY-MM-DD) are required');
  if (week.key >= math.weekBounds(new Date()).key)
    throw AppError.badRequest('This week is still in progress — settle it after Sunday.');
  if (await payouts.isSettled(sellerId, week.key))
    throw AppError.conflict('This week is already marked paid for this seller.');
  const lines = await linesFor(sellerId, week.start, week.end);
  if (!lines.length) throw AppError.badRequest('Nothing was delivered for this seller in that week.');
  const t = math.totals(lines);
  const utr = String(body.utr || '')
    .trim()
    .slice(0, 60);
  if (!utr) throw AppError.badRequest('Enter the bank transfer reference (UTR).');
  const amountPaid = body.amountPaid != null ? math.round2(body.amountPaid) : t.net;
  if (!(amountPaid > 0)) throw AppError.badRequest('Amount paid must be more than zero.');
  const settlement = await payouts.createSettlement({
    seller: sellerId,
    weekKey: week.key,
    periodStart: week.start,
    periodEnd: week.end,
    lines: lines.map((l) => ({
      order: l.orderId,
      orderNumber: l.orderNumber,
      deliveredAt: l.deliveredAt,
      paymentMethod: l.paymentMethod,
      itemTotal: l.itemTotal,
      courierCharge: l.courierCharge || 0,
      gatewayCharge: l.gatewayCharge,
      refunds: l.refunds,
      net: l.net,
    })),
    orders: t.orders,
    itemTotal: t.itemTotal,
    courierCharge: t.courierCharge,
    gatewayCharge: t.gatewayCharge,
    refunds: t.refunds,
    net: t.net,
    amountPaid,
    utr,
    note: String(body.note || '').slice(0, 300),
    paidBy: admin._id,
    paidByEmail: admin.email || '',
  });
  return { settlement };
}

/** Paid settlements, newest first, optionally one seller's. */
async function history(sellerId) {
  return { items: await payouts.history(mongoose.isValidObjectId(sellerId) ? { seller: sellerId } : {}) };
}

/**
 * The admin fills in or corrects what the courier charged for a parcel
 * (parcels shipped before charges were captured, courier invoice fixes).
 * A parcel already inside a paid settlement is refused: that would rewrite history.
 */
async function setCourierCharge(idOrNumber, sellerId, body = {}) {
  const total = Number(body.total);
  if (!Number.isFinite(total) || total < 0 || total > 100000)
    throw AppError.badRequest('Enter the courier charge in rupees.');
  const order = await payouts.orderBy(orderIdentityFilter(idOrNumber));
  if (!order) throw AppError.notFound('Order not found');
  const entry = (order.sellerShipments || []).find(
    (s) => String(s.seller) === String(sellerId) && (s.kind || 'forward') === 'forward' && !s.returnOf,
  );
  if (!entry) throw AppError.notFound('No parcel for that seller on this order');
  if (await payouts.parcelSettled(entry.seller, order._id)) {
    throw AppError.conflict(
      'This parcel is already in a paid settlement; changing its charge now would rewrite history.',
    );
  }
  entry.courierCharge = {
    freight: math.round2(total),
    cod: 0,
    total: math.round2(total),
    source: 'manual',
    capturedAt: new Date(),
    note: String(body.note || '').slice(0, 200),
  };
  await order.save({ timestamps: false });
  return { courierCharge: entry.courierCharge, earnings: math.sellerLine(order.toObject(), entry.seller) };
}

module.exports = { sellerSummary, adminWeek, adminInTransit, pay, history, setCourierCharge };
