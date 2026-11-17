/** Customers (buyers) as staff see them: list with spend, profile with history, delete. */
const escapeRegExp = require('../../utils/escapeRegExp');
const { AppError } = require('../../errors/AppError');
const users = require('./users.repository');
const orders = require('./order-feed.repository');
const cleanup = require('./cleanup.repository');
const { pageOf } = require('./sellers.service');

/** Paginated list with search, each row carrying order count + lifetime spend. */
async function list(query) {
  const filter = { role: 'customer' };
  if (query.q) {
    const re = new RegExp(escapeRegExp(query.q), 'i');
    filter.$or = [{ name: re }, { email: re }, { phone: re }];
  }
  const { page, limit, skip } = pageOf(query);
  const [items, total] = await users.customerPage(filter, { skip, limit });
  const agg = await orders.spendByCustomer(items.map((c) => c._id));
  const stats = new Map(agg.map((a) => [a._id.toString(), a]));
  const enriched = items.map((c) => {
    const s = stats.get(c._id.toString()) || { orders: 0, spend: 0 };
    return { ...c.toObject(), orderCount: s.orders, lifetimeSpend: s.spend };
  });
  return { items: enriched, total, page, limit };
}

/** Full profile + order history with each line's seller resolved. */
async function detail(idOrSlug) {
  const customer = await users.findCustomerByIdOrSlug(idOrSlug, { fields: users.CUSTOMER_FIELDS });
  if (!customer) throw AppError.notFound('Customer not found.');

  const history = await orders.forCustomer(customer._id);
  const sellerIds = [...new Set(history.flatMap((o) => o.items.map((it) => it.seller?.toString()).filter(Boolean)))];
  const sellers = await users.sellersByIds(sellerIds, 'name storeName slug email');
  const sellerMap = new Map(sellers.map((v) => [v._id.toString(), v]));

  const ordersEnriched = history.map((o) => {
    const obj = o.toObject();
    obj.items = obj.items.map((it) => {
      const v = it.seller ? sellerMap.get(it.seller.toString()) : null;
      return {
        ...it,
        sellerInfo: v ? { _id: v._id, slug: v.slug, name: v.name, storeName: v.storeName, email: v.email } : null,
      };
    });
    return obj;
  });

  const live = ordersEnriched.filter((o) => o.status !== 'cancelled');
  const stats = {
    totalOrders: ordersEnriched.length,
    completedOrders: ordersEnriched.filter((o) => o.status === 'delivered').length,
    cancelledOrders: ordersEnriched.filter((o) => o.status === 'cancelled').length,
    lifetimeSpend: live.reduce((s, o) => s + (o.total || 0), 0),
    totalUnits: live.reduce((s, o) => s + o.items.reduce((a, i) => a + (i.quantity || 0), 0), 0),
  };
  return { customer, orders: ordersEnriched, stats };
}

/**
 * Hard-delete a customer with their cart and wishlist. Orders they placed
 * stay — sellers keep their sales history; the order's `user` ref dangles
 * and the UI handles that.
 */
async function remove(idOrSlug) {
  const customer = await users.findCustomerByIdOrSlug(idOrSlug);
  if (!customer) throw AppError.notFound('Customer not found');
  const ordersAffected = await orders.count({ user: customer._id });
  await Promise.all([
    cleanup.deleteCart(customer._id),
    cleanup.deleteWishlist(customer._id),
    users.deleteUser(customer._id),
  ]);
  return {
    message: 'Customer deleted.',
    summary: {
      ordersAffected,
      note: ordersAffected
        ? `${ordersAffected} historical order(s) remain — sellers still see them in their sales history, but the customer reference no longer resolves.`
        : 'No order history to worry about.',
    },
  };
}

module.exports = { list, detail, remove };
