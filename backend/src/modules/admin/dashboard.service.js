/**
 * The admin home: headline counts and the 30-day pulse. Stats cover the
 * WHOLE marketplace. Revenue excludes cancelled orders and fully refunded
 * ones, so the headline tracks real net GMV.
 */
const users = require('./users.repository');
const products = require('./products.repository');
const orders = require('./order-feed.repository');
const { queueCounts } = require('./sellers.service');

const DAYS = 30;

async function stats() {
  const [sellers, productCount, activeProducts, pendingSellers, sellerQueues] = await Promise.all([
    users.countSellers(),
    products.count(),
    products.count({ status: 'active' }),
    users.countSellers({ status: 'pending' }),
    queueCounts(),
  ]);
  return { stats: { sellers, products: productCount, activeProducts, pendingSellers, sellerQueues } };
}

/** Daily buckets, oldest → newest, and a function placing a date in them. */
function dailyBuckets(today) {
  const buckets = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    buckets.push({ date: d.toISOString(), orders: 0, revenue: 0, newSellers: 0, newProducts: 0 });
  }
  const indexOf = (date) => {
    const day = new Date(date);
    day.setHours(0, 0, 0, 0);
    const idx = DAYS - 1 - Math.round((today.getTime() - day.getTime()) / 86400000);
    return idx >= 0 && idx < DAYS ? idx : -1;
  };
  return { buckets, indexOf };
}

async function overview() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const since = new Date(today);
  since.setDate(since.getDate() - (DAYS - 1));
  const NET_REVENUE_FILTER = {
    status: { $ne: 'cancelled' },
    paymentStatus: { $ne: 'refunded' },
    ...orders.NOT_ARCHIVED,
  };

  const [
    sellers,
    pendingSellers,
    customers,
    totalProducts,
    activeProducts,
    outOfStockProducts,
    netOrdersAgg,
    cancelledOrders,
    refundedOrders,
    recentSellers,
    recentOrders,
    recentProducts,
    ordersInRange,
    sellersInRange,
    productsInRange,
    sellerQueues,
  ] = await Promise.all([
    users.countSellers(),
    users.countSellers({ status: 'pending' }),
    users.countCustomers(),
    products.count(),
    products.count({ status: 'active' }),
    products.count({ stock: 0 }),
    orders.summary(NET_REVENUE_FILTER),
    orders.count({ status: 'cancelled', ...orders.NOT_ARCHIVED }),
    orders.count({ paymentStatus: 'refunded', ...orders.NOT_ARCHIVED }),
    users.recentSellers(),
    orders.recent(),
    products.recent(),
    orders.createdSince(NET_REVENUE_FILTER, since),
    users.sellersCreatedSince(since),
    products.createdSince(since),
    queueCounts(),
  ]);

  const { buckets, indexOf } = dailyBuckets(today);
  for (const o of ordersInRange) {
    const i = indexOf(o.createdAt);
    if (i < 0) continue;
    buckets[i].orders += 1;
    buckets[i].revenue += o.total || 0;
  }
  for (const v of sellersInRange) {
    const i = indexOf(v.createdAt);
    if (i >= 0) buckets[i].newSellers += 1;
  }
  for (const p of productsInRange) {
    const i = indexOf(p.createdAt);
    if (i >= 0) buckets[i].newProducts += 1;
  }

  const { count: totalOrders = 0, revenue: totalRevenue = 0 } = netOrdersAgg[0] || {};
  return {
    stats: {
      sellers,
      pendingSellers,
      sellerQueues,
      customers,
      totalProducts,
      activeProducts,
      outOfStockProducts,
      totalOrders,
      totalRevenue,
      cancelledOrders,
      refundedOrders,
    },
    series: buckets,
    recent: { sellers: recentSellers, orders: recentOrders.map((o) => o.toObject()), products: recentProducts },
  };
}

module.exports = { stats, overview };
