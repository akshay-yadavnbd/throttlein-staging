/**
 * The platform-wide order feed for staff: filters, CSV export, the
 * failed-push tile, one order's detail, and archive / restore.
 *
 * "Delete order" is an archive, not a hard delete (product decision): the
 * order leaves every people-facing list (Order.NOT_ARCHIVED) but the
 * document stays, so webhooks, refunds, settlements and tracking keep
 * working and Restore brings it back exactly as it was.
 */
const { AppError } = require('../../errors/AppError');
const users = require('./users.repository');
const orders = require('./order-feed.repository');
const security = require('./security.repository');
const { pageOf } = require('./sellers.service');

const EXPORT_CAP = 5000;

/** ?from=YYYY-MM-DD&to=YYYY-MM-DD — inclusive, in IST, the day everyone here lives in. */
function dayIST(v, endOfDay) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))) return null;
  const d = new Date(`${v}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The Mongo filter for the feed query (status, payment, dates, seller, search, archived). */
async function feedFilter(query) {
  const { status, paymentStatus, sellerId, q, from, to, archived } = query;
  /** @type {Record<string, any>} */
  const filter = String(archived) === 'true' ? { archivedAt: { $ne: null } } : { ...orders.NOT_ARCHIVED };
  if (status) filter.status = status;
  if (paymentStatus) filter.paymentStatus = paymentStatus;
  const fromAt = dayIST(from, false);
  const toAt = dayIST(to, true);
  if (fromAt || toAt) {
    filter.createdAt = {};
    if (fromAt) filter.createdAt.$gte = fromAt;
    if (toAt) filter.createdAt.$lte = toAt;
  }
  if (sellerId) {
    const v = await users.findSellerId(sellerId);
    if (v) filter['items.seller'] = v._id;
  }
  if (q) {
    const re = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const matching = await users.customersMatching(re);
    filter.$or = [{ orderNumber: re }, { user: { $in: matching.map((u) => u._id) } }];
  }
  return filter;
}

/** Seller display names for every seller id in a set of orders. */
async function sellerIndex(ids, fields) {
  const docs = await users.sellersByIds([...ids], fields);
  return new Map(docs.map((v) => [String(v._id), v]));
}

/** CSV of the CURRENT filter — every matching row (capped), one line per order. */
async function exportCsv(filter) {
  const rows = await orders.exportRows(filter, EXPORT_CAP);
  const ids = new Set();
  rows.forEach((o) => (o.items || []).forEach((it) => it.seller && ids.add(String(it.seller))));
  const sellers = await sellerIndex(ids, 'storeName name');
  const nameOf = (id) => {
    const v = sellers.get(id);
    return v ? v.storeName || v.name : null;
  };
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const ist = (d) => (d ? new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }) : '');
  const header = [
    'Order',
    'Placed (IST)',
    'Customer',
    'Email',
    'Sellers',
    'Items',
    'Total',
    'Payment method',
    'Payment status',
    'Status',
    'Tracking no(s)',
    'Delivered (IST)',
  ];
  const lines = rows.map((o) =>
    [
      o.orderNumber,
      ist(o.createdAt),
      o.user?.name,
      o.user?.email,
      [...new Set((o.items || []).map((it) => nameOf(String(it.seller))).filter(Boolean))].join(' | '),
      (o.items || []).map((it) => `${it.name} ×${it.quantity}`).join(' | '),
      o.total,
      o.paymentMethod,
      o.paymentStatus,
      o.status,
      (o.sellerShipments || [])
        .map((s) => s.awbCode)
        .filter(Boolean)
        .join(' | '),
      ist(o.deliveredAt),
    ]
      .map(esc)
      .join(','),
  );
  return {
    kind: /** @type {const} */ ('csv'),
    filename: `orders-${new Date().toISOString().slice(0, 10)}.csv`,
    body: '﻿' + [header.map(esc).join(','), ...lines].join('\r\n'),
  };
}

/** `{ kind: 'csv', filename, body }` for ?format=csv, else the page with status counts. */
async function list(query) {
  const filter = await feedFilter(query);
  if (String(query.format) === 'csv') return exportCsv(filter);

  const { page, limit, skip } = pageOf(query);
  // Per-status counts under every OTHER active filter drive the status tabs.
  const { status: _status, ...countFilter } = filter;
  const { archivedAt: _archived, ...baseFilter } = countFilter;
  const [rows, total, byStatus, archivedCount] = await Promise.all([
    orders.page(filter, { skip, limit }),
    orders.count(filter),
    orders.countByStatus(countFilter),
    orders.count({ ...baseFilter, archivedAt: { $ne: null } }),
  ]);
  const statusCounts = { all: 0 };
  for (const row of byStatus) {
    statusCounts[row._id || 'unknown'] = row.n;
    statusCounts.all += row.n;
  }

  const ids = new Set();
  rows.forEach((o) => (o.items || []).forEach((it) => it.seller && ids.add(String(it.seller))));
  const sellers = await sellerIndex(ids, 'storeName name slug');
  const enriched = rows.map((o) => {
    const sellerIds = [...new Set((o.items || []).map((it) => String(it.seller)).filter(Boolean))];
    const sellerRows = sellerIds
      .map((id) => {
        const v = sellers.get(id);
        return v ? { _id: id, name: v.storeName || v.name, slug: v.slug } : null;
      })
      .filter(Boolean);
    return { ...o, sellers: sellerRows };
  });
  return {
    kind: /** @type {const} */ ('page'),
    orders: enriched,
    total,
    statusCounts,
    archivedCount,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}

/**
 * Orders with at least one seller slice stuck in `failed` — the push to
 * Shiprocket at checkout blew up. Situational awareness only: sellers own
 * retries (POST /api/seller/orders/:id/retry-push).
 */
async function failedPushes(query) {
  const { page, limit, skip } = pageOf(query);
  const [rows, total] = await orders.failedPushPage({ skip, limit });
  const ids = new Set();
  rows.forEach((o) => (o.sellerShipments || []).forEach((s) => s.seller && ids.add(String(s.seller))));
  const sellers = await sellerIndex(ids, 'storeName name slug email phone');
  const enriched = rows.map((o) => ({
    ...o,
    failedSlices: (o.sellerShipments || [])
      .filter((s) => s.status === 'failed')
      .map((s) => {
        const v = sellers.get(String(s.seller));
        return {
          sellerId: String(s.seller),
          sellerName: v ? v.storeName || v.name : 'Unknown seller',
          sellerSlug: v?.slug,
          sellerEmail: v?.email,
          lastError: s.lastError || 'No error captured',
          updatedAt: s.updatedAt || o.updatedAt,
        };
      }),
  }));
  return { orders: enriched, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
}

/** One order with every seller it touches resolved to a chip. */
async function detail(ref) {
  const order = await orders.findByRef(ref);
  if (!order) throw AppError.notFound('Order not found');
  const ids = new Set();
  (order.items || []).forEach((it) => it.seller && ids.add(String(it.seller)));
  (order.sellerShipments || []).forEach((s) => s.seller && ids.add(String(s.seller)));
  (order.returnRequests || []).forEach((r) => r.seller && ids.add(String(r.seller)));
  const sellers = await users.sellersByIds([...ids], 'name storeName slug email phone', { lean: true });
  const sellerById = {};
  for (const v of sellers) {
    sellerById[String(v._id)] = {
      _id: v._id,
      name: v.storeName || v.name,
      slug: v.slug,
      email: v.email,
      phone: v.phone,
    };
  }
  return { order, sellerById };
}

/** Archive or restore; both directions are audited with a snapshot. */
async function setArchived(ref, archive, { reason: rawReason, ctx }) {
  const reason = String(rawReason || '')
    .trim()
    .slice(0, 300);
  const order = await orders.setArchived(ref, archive, { by: ctx.actor, reason });
  if (!order) {
    if (!(await orders.exists(ref))) throw AppError.notFound('Order not found');
    throw AppError.conflict(archive ? 'This order is already deleted.' : 'This order isn’t deleted.');
  }
  await security.audit({
    action: archive ? 'order.archive' : 'order.restore',
    ...ctx,
    target: order.user?._id,
    targetEmail: order.user?.email || '',
    targetLabel: order.orderNumber,
    meta: {
      orderId: order._id,
      reason,
      total: order.total,
      status: order.status,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
    },
  });
  return {
    archivedAt: order.archivedAt,
    message: archive
      ? `Order ${order.orderNumber} deleted. You can restore it from Deleted orders.`
      : `Order ${order.orderNumber} restored.`,
  };
}

module.exports = { list, failedPushes, detail, setArchived, dayIST };
