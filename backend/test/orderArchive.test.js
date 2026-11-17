/**
 * Admin "Delete order" = archive (POST /api/admin/orders/:id/archive|restore).
 *
 * The contract: an archived order leaves every people-facing list (admin
 * orders + counts, the seller's list, the customer's list) but stays in the
 * database — the refund queue (money owed) still sees it, Restore brings it
 * back unchanged, and both directions are audit-logged.
 */
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { loadController, response } = require('./helpers/controller');
const Order = require('../src/modules/orders/order.model');
const User = require('../src/models/User');
const AdminAuditLog = require('../src/modules/admin/admin-audit-log.model');
const admin = require('../src/modules/admin');

let mongo;
const ids = {
  admin: new mongoose.Types.ObjectId(),
  seller: new mongoose.Types.ObjectId(),
  customer: new mongoose.Types.ObjectId(),
};

/** Runs an express-async-handler route; resolves with the response and any error passed to next(). */
async function call(handler, req) {
  const res = response();
  let err = null;
  await handler(req, res, (e) => {
    err = e;
  });
  return { res, err };
}
const adminReq = (extra = {}) => ({
  user: { _id: ids.admin, email: 'admin@example.com', role: 'superadmin' },
  ip: '127.0.0.1',
  headers: { 'user-agent': 'test' },
  params: {},
  query: {},
  body: {},
  ...extra,
});

function orderDoc(n, extra = {}) {
  return {
    orderNumber: `TIN-2026-${String(n).padStart(6, '0')}`,
    user: ids.customer,
    items: [
      {
        product: new mongoose.Types.ObjectId(),
        seller: ids.seller,
        name: 'Helmet',
        price: 1000,
        quantity: 1,
        subtotal: 1000,
      },
    ],
    shippingAddress: {
      fullName: 'C',
      phone: '9999999999',
      line1: 'x',
      city: 'Delhi',
      state: 'Delhi',
      pincode: '110001',
    },
    itemsTotal: 1000,
    total: 1000,
    status: 'placed',
    paymentMethod: 'cod',
    paymentStatus: 'pending',
    sellerShipments: [],
    returnRequests: [],
    createdAt: new Date(Date.now() - n * 1000),
    updatedAt: new Date(),
    ...extra,
  };
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({
    binary: { downloadDir: require('node:path').join(require('node:os').tmpdir(), 'throttlein-mongo-binaries') },
    instance: { ip: '127.0.0.1' },
  });
  await mongoose.connect(mongo.getUri(), { dbName: 'throttlein_order_archive_test' });
});
afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});
beforeEach(async () => {
  await Promise.all([Order.deleteMany({}), User.deleteMany({}), AdminAuditLog.deleteMany({})]);
  await User.collection.insertMany([
    { _id: ids.admin, name: 'Admin', email: 'admin@example.com', role: 'superadmin' },
    { _id: ids.seller, name: 'Seller', storeName: 'Acme', email: 'seller@example.com', role: 'seller', slug: 'acme' },
    { _id: ids.customer, name: 'Cust', email: 'cust@example.com', role: 'customer' },
  ]);
  await Order.collection.insertMany([
    orderDoc(1),
    orderDoc(2, {
      status: 'cancelled',
      paymentMethod: 'online',
      paymentStatus: 'paid',
      razorpayPaymentId: 'pay_1',
      returnRequests: [
        {
          seller: ids.seller,
          kind: 'cancellation',
          status: 'approved',
          items: [],
          refundStatus: 'requested',
          refundMethod: 'razorpay',
          refundAmount: 1000,
          refundRequestedAt: new Date(),
        },
      ],
    }),
  ]);
});

test('archive hides the order from admin, seller and customer lists, and restore brings it back', async () => {
  const { res, err } = await call(
    admin.archiveOrder,
    adminReq({ params: { idOrNumber: 'TIN-2026-000002' }, body: { reason: 'Test order' } }),
  );
  assert.equal(err, null);
  assert.ok(res.body.data.archivedAt, 'the envelope carries the archive stamp');
  const stored = await Order.findOne({ orderNumber: 'TIN-2026-000002' });
  assert.ok(stored.archivedAt, 'document is kept, only marked');
  assert.equal(stored.archiveReason, 'Test order');
  assert.equal(String(stored.archivedBy), String(ids.admin));

  // Admin list: hidden by default, counted, and listed under ?archived=true.
  // Admin list on the envelope: `{ data: { items, statusCounts, archivedCount }, meta }`.
  const live = (await call(admin.listAllOrders, adminReq())).res.body;
  assert.deepEqual(
    live.data.items.map((o) => o.orderNumber),
    ['TIN-2026-000001'],
  );
  assert.equal(live.data.statusCounts.all, 1);
  assert.equal(live.data.archivedCount, 1);
  assert.deepEqual(live.meta, { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 });
  const deleted = (await call(admin.listAllOrders, adminReq({ query: { archived: 'true' } }))).res.body;
  assert.deepEqual(
    deleted.data.items.map((o) => o.orderNumber),
    ['TIN-2026-000002'],
  );
  assert.equal(deleted.data.items[0].archivedBy.name, 'Admin');

  // Seller and customer lists.
  const c = loadController();
  const sellerList = await (async () => {
    const r = Object.assign(response(), { locals: {} });
    await c.exports.listSellerOrders({ user: { _id: ids.seller }, query: {} }, r, (e) => {
      throw e;
    });
    return r.body;
  })();
  assert.deepEqual(
    sellerList.data.items.map((o) => o.orderNumber),
    ['TIN-2026-000001'],
  );
  assert.equal(sellerList.meta.totalItems, 1, 'the seller list pages through meta');
  const customerList = await (async () => {
    const r = Object.assign(response(), { locals: {} });
    await c.exports.list({ user: { _id: ids.customer }, query: {} }, r, (e) => {
      throw e;
    });
    return r.body;
  })();
  assert.deepEqual(
    customerList.data.items.map((o) => o.orderNumber),
    ['TIN-2026-000001'],
  );
  assert.equal(customerList.meta.totalItems, 1, 'the customer list pages through meta');

  // Money owed is never hidden: the refund queue still has the archived order's refund.
  const refunds = await (async () => {
    const r = Object.assign(response(), { locals: {} });
    await c.exports.adminListRefundRequests({ query: { status: 'requested' } }, r, (e) => {
      throw e;
    });
    return r.body;
  })();
  // (Array.from: rows are built inside the controller's vm context, another realm.)
  assert.deepEqual(
    Array.from(refunds.data.requests, (x) => x.orderNumber),
    ['TIN-2026-000002'],
  );

  // Restore.
  const restored = await call(admin.restoreOrder, adminReq({ params: { idOrNumber: 'TIN-2026-000002' } }));
  assert.equal(restored.err, null);
  const back = await Order.findOne({ orderNumber: 'TIN-2026-000002' }).lean();
  assert.equal(back.archivedAt, null);
  assert.equal(back.archivedBy, undefined);
  assert.equal((await call(admin.listAllOrders, adminReq())).res.body.data.items.length, 2);

  const actions = (await AdminAuditLog.find().sort({ createdAt: 1 }).lean()).map((a) => [
    a.action,
    a.targetLabel,
    a.meta?.reason,
  ]);
  assert.deepEqual(actions, [
    ['order.archive', 'TIN-2026-000002', 'Test order'],
    ['order.restore', 'TIN-2026-000002', ''],
  ]);
});

test('archiving twice, restoring a live order, or an unknown number are refused', async () => {
  await call(admin.archiveOrder, adminReq({ params: { idOrNumber: 'TIN-2026-000001' } }));
  // Refusals are thrown AppErrors; the error layer turns `status` into the response code.
  const again = await call(admin.archiveOrder, adminReq({ params: { idOrNumber: 'TIN-2026-000001' } }));
  assert.equal(again.err.status, 409);
  assert.match(again.err.message, /already deleted/);
  const notDeleted = await call(admin.restoreOrder, adminReq({ params: { idOrNumber: 'TIN-2026-000002' } }));
  assert.equal(notDeleted.err.status, 409);
  const missing = await call(admin.archiveOrder, adminReq({ params: { idOrNumber: 'TIN-2026-999999' } }));
  assert.equal(missing.err.status, 404);
  assert.equal(await AdminAuditLog.countDocuments(), 1, 'only the successful archive is logged');
});
