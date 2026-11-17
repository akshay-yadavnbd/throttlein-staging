/** The admin "customer carts" feed: non-empty carts with their shopper, live prices and availability. */
const mongoose = require('mongoose');
const escapeRegExp = require('../../utils/escapeRegExp');
const carts = require('./admin-carts.repository');

const PAGE_SIZE = 25;

/** One cart → what the admin row shows. Prices are LIVE (variant price first); a removed size or colour is never "available". */
function cartSummary(cart) {
  const items = (cart.items || []).map((line) => {
    const product = line.product;
    const variant = product?.variants?.find(
      (v) => (!line.size || v.size === line.size) && (!line.color || v.color === line.color),
    );
    const missingVariant = Boolean(product?.variants?.length && (line.size || line.color) && !variant);
    const price =
      Number(variant?.price) > 0 ? Number(variant.price) : Number(product?.price ?? line.snapshot?.price) || 0;
    return {
      productId: product?._id || null,
      name: product?.name || line.snapshot?.name || 'Removed product',
      slug: product?.slug || line.snapshot?.slug || '',
      size: line.size || '',
      color: line.color || '',
      quantity: line.quantity,
      unitPrice: price,
      subtotal: price * line.quantity,
      available: Boolean(
        product &&
        !missingVariant &&
        product.status === 'active' &&
        Number(variant?.stock ?? product.stock) >= line.quantity,
      ),
    };
  });
  return {
    _id: cart._id,
    reference: `CART-${String(cart._id).toUpperCase()}`,
    user: cart.customer,
    createdAt: cart.createdAt,
    updatedAt: cart.updatedAt,
    items,
    quantity: items.reduce((sum, item) => sum + item.quantity, 0),
    estimatedValue: items.reduce((sum, item) => sum + item.subtotal, 0),
  };
}

/**
 * The aggregation for one page. Empty carts and carts of deleted users never
 * show; `inactive=24h` reads the stored `updatedAt` (the reminder worker
 * never bumps it); search matches name / email / phone literally, or a
 * `CART-<id>` reference.
 */
function pipeline(query = {}) {
  const page = Math.min(10000, Math.max(1, parseInt(query.page, 10) || 1));
  const match = { 'items.0': { $exists: true } };
  if (query.inactive === '24h') match.updatedAt = { $lte: new Date(Date.now() - 86400000) };
  /** @type {object[]} */
  const stages = [
    { $match: match },
    {
      $lookup: {
        from: 'users',
        localField: 'user',
        foreignField: '_id',
        pipeline: [{ $project: { name: 1, email: 1, phone: 1, slug: 1, status: 1 } }],
        as: 'customer',
      },
    },
    { $unwind: '$customer' },
  ];
  const search = String(query.q || '')
    .trim()
    .slice(0, 100);
  if (search) {
    const regex = new RegExp(escapeRegExp(search), 'i');
    /** @type {object[]} */
    const alternatives = ['customer.name', 'customer.email', 'customer.phone'].map((key) => ({ [key]: regex }));
    const id = search.replace(/^CART-/i, '');
    if (/^[a-f0-9]{24}$/i.test(id)) alternatives.push({ _id: new mongoose.Types.ObjectId(id) });
    stages.push({ $match: { $or: alternatives } });
  }
  stages.push({
    $facet: {
      rows: [{ $sort: { updatedAt: -1, _id: -1 } }, { $skip: (page - 1) * PAGE_SIZE }, { $limit: PAGE_SIZE }],
      count: [{ $count: 'total' }],
    },
  });
  return { stages, page, limit: PAGE_SIZE };
}

async function list(query) {
  const { stages, page, limit } = pipeline(query);
  const { rows, total } = await carts.page(stages);
  return { items: rows.map(cartSummary), page, limit, total };
}

module.exports = { list, _internals: { cartSummary, pipeline } };
