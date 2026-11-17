/**
 * Load the orders module's shipment sync / worker with stubs. The tests key
 * their stubs by role: '../modules/orders' is the orders graph under test
 * (lock, aggregate, dispatch), './shipmentSync' the sync service, and
 * '../infrastructure/shipping/shiprocket' the carrier; ALIASES maps the files'
 * own requires onto those keys.
 */
const SHIPPING_FILES = { shipmentSync: 'shipment-sync.service.js', shipmentWorker: 'shipment-worker.service.js' };
const ALIASES = {
  './orders.repository': '../modules/orders',
  './order-state': '../modules/orders',
  './dispatch.service': '../modules/orders',
  './shipment-sync.service': './shipmentSync',
  '../../infrastructure/shipping/shiprocket': '../infrastructure/shipping/shiprocket',
};
function loadShippingService(name, overrides = {}) {
  const fs = require('node:fs'),
    path = require('node:path'),
    vm = require('node:vm');
  const filename = path.resolve(__dirname, '../src/modules/orders', SHIPPING_FILES[name]);
  const realRequire = require('node:module').createRequire(filename);
  const pick = (key) =>
    Object.hasOwn(overrides, key)
      ? overrides[key]
      : Object.hasOwn(overrides, ALIASES[key] || '')
        ? overrides[ALIASES[key]]
        : realRequire(key);
  const ctx = { module: { exports: {} }, console, process, setInterval, clearInterval, require: pick };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), ctx, { filename });
  return ctx.module.exports;
}
test('unmatched carrier events survive and apply when the shipment becomes available', async () => {
  const c = controller(),
    sync = loadShippingService('shipmentSync', { '../modules/orders': c.exports });
  const body = { order_id: 'CHANNEL-A', current_status: 'OUT FOR DELIVERY', current_timestamp: '24 09 2026 10:00:00' };
  const [a, b] = await Promise.all([sync.enqueueShipmentEvent(body), sync.enqueueShipmentEvent(body)]);
  assert.equal(String(a._id), String(b._id));
  assert.equal(await ShipmentEvent.countDocuments(), 1);
  assert.equal((await sync.processShipmentEvent(a._id)).queued, true);
  let event = await ShipmentEvent.findById(a._id);
  assert.equal(event.state, 'pending');
  assert.equal(event.expiresAt, undefined);
  const p = await product(),
    order = await checkout(c, [item(p)]);
  order.sellerShipments = [{ seller: sellerA, channelOrderId: 'CHANNEL-A', status: 'awb' }];
  await order.save();
  await ShipmentEvent.updateOne({ _id: a._id }, { $set: { nextAttemptAt: new Date(0) } });
  await sync.processShipmentEvent(a._id);
  const fresh = await Order.findById(order._id);
  event = await ShipmentEvent.findById(a._id);
  assert.equal(fresh.sellerShipments[0].currentStatus, 'OUT FOR DELIVERY');
  assert.equal(fresh.sellerShipments[0].status, 'out_for_delivery');
  assert.equal(fresh.status, 'shipped');
  assert.equal(event.state, 'completed');
  assert.ok(event.expiresAt);
  assert.equal(await sync.processShipmentEvent(a._id), null);
});
test('a crashed inbox lease can be reclaimed and concurrent consumers apply one NDR', async () => {
  const c = controller(),
    sync = loadShippingService('shipmentSync', { '../modules/orders': c.exports });
  const p = await product(),
    order = await checkout(c, [item(p)]);
  order.sellerShipments = [{ seller: sellerA, awbCode: 'AWB-A', status: 'shipped' }];
  await order.save();
  const event = await sync.enqueueShipmentEvent({
    awb: 'AWB-A',
    current_status: 'UNDELIVERED',
    current_timestamp: '24 09 2026 10:00:00',
  });
  await ShipmentEvent.updateOne(
    { _id: event._id },
    { $set: { state: 'processing', leaseToken: 'crashed', leaseUntil: new Date(0) } },
  );
  await Promise.all([sync.processShipmentEvent(event._id), sync.processShipmentEvent(event._id)]);
  const fresh = await Order.findById(order._id);
  assert.equal(fresh.sellerShipments[0].ndrCount, 1);
  assert.equal((await ShipmentEvent.findById(event._id)).state, 'completed');
});
test('a webhook waits for the fulfillment lock instead of overwriting an in-flight seller action', async () => {
  const c = controller(),
    sync = loadShippingService('shipmentSync', { '../modules/orders': c.exports });
  const p = await product(),
    order = await checkout(c, [item(p)]);
  order.sellerShipments = [{ seller: sellerA, awbCode: 'LOCKED', status: 'awb' }];
  await order.save();
  const event = await sync.enqueueShipmentEvent({ awb: 'LOCKED', current_status: 'IN TRANSIT' });
  await c.exports.withFulfillmentLock(order._id, async () => {
    assert.equal((await sync.processShipmentEvent(event._id)).queued, true);
    assert.equal((await Order.findById(order._id)).sellerShipments[0].status, 'awb');
  });
  await ShipmentEvent.updateOne({ _id: event._id }, { $set: { nextAttemptAt: new Date(0) } });
  await sync.processShipmentEvent(event._id);
  assert.equal((await Order.findById(order._id)).sellerShipments[0].status, 'shipped');
});
test('carrier events that never match are dead-lettered instead of retrying forever', async () => {
  const c = controller(),
    sync = loadShippingService('shipmentSync', { '../modules/orders': c.exports });
  // Shiprocket's own "Test Webhook" sample — no order will ever exist for it.
  const event = await sync.enqueueShipmentEvent({
    awb: '123456',
    order_id: 'dummpy shiprocket order id 123',
    current_status: 'DELIVERED',
  });
  await ShipmentEvent.updateOne(
    { _id: event._id },
    { $set: { attempts: sync.MAX_ATTEMPTS - 1, nextAttemptAt: new Date(0) } },
  );
  const result = await sync.processShipmentEvent(event._id);
  assert.equal(result.dead, true);
  const fresh = await ShipmentEvent.findById(event._id);
  assert.equal(fresh.state, 'dead');
  assert.ok(fresh.expiresAt);
  assert.match(fresh.lastError, /Gave up/);
  assert.equal(await sync.processShipmentEvent(event._id), null);
});
test('lock contention does not consume dead-letter attempts', async () => {
  const c = controller(),
    sync = loadShippingService('shipmentSync', { '../modules/orders': c.exports });
  const p = await product(),
    order = await checkout(c, [item(p)]);
  order.sellerShipments = [{ seller: sellerA, awbCode: 'BUSY', status: 'awb' }];
  await order.save();
  const event = await sync.enqueueShipmentEvent({ awb: 'BUSY', current_status: 'IN TRANSIT' });
  await c.exports.withFulfillmentLock(order._id, async () => {
    for (let i = 0; i < 3; i++) {
      await ShipmentEvent.updateOne({ _id: event._id }, { $set: { nextAttemptAt: new Date(0) } });
      assert.equal((await sync.processShipmentEvent(event._id)).queued, true);
    }
  });
  const fresh = await ShipmentEvent.findById(event._id);
  assert.equal(fresh.attempts, 0);
  assert.equal(fresh.state, 'pending');
  assert.equal(fresh.lastError, 'Fulfilment busy');
});
test('proof of delivery survives payload sanitisation and is stored on the slice', async () => {
  const c = controller(),
    sync = loadShippingService('shipmentSync', { '../modules/orders': c.exports });
  const p = await product(),
    order = await checkout(c, [item(p)]);
  order.sellerShipments = [{ seller: sellerA, awbCode: 'POD-1', status: 'out_for_delivery' }];
  await order.save();
  const event = await sync.enqueueShipmentEvent({
    awb: 'POD-1',
    current_status: 'DELIVERED',
    current_timestamp: '24 09 2026 12:00:00',
    pod: 'https://example.test/pod/POD-1.jpg',
    pod_status: 'OTP Based Delivery',
    billing_customer_name: 'must not be stored',
  });
  assert.equal(event.payload.pod, 'https://example.test/pod/POD-1.jpg');
  assert.equal(event.payload.billing_customer_name, undefined);
  await sync.processShipmentEvent(event._id);
  const fresh = await Order.findById(order._id);
  assert.equal(fresh.sellerShipments[0].pod, 'https://example.test/pod/POD-1.jpg');
  assert.equal(fresh.sellerShipments[0].status, 'delivered');
});
test('an AWB assigned from the Shiprocket panel is discovered from order details and shown everywhere', async () => {
  const c = controller();
  // Mirrors the live case: our backend pushed the order (pushed, no AWB), then
  // the admin assigned Delhivery + scheduled pickup inside Shiprocket's panel.
  // Exact shape captured from the live account on 24 Sep 2026: `shipments` is a
  // single object, dates come in three different formats, status_code is the
  // ORDER code list (35 = PICKUP EXCEPTION) and must not be read as a shipment id.
  const shiprocket = {
    async getOrder(id) {
      assert.equal(id, '1602362118');
      return {
        data: {
          id: 1602362118,
          channel_order_id: 'TIN-2026-000019-8C7315',
          status: 'PICKUP EXCEPTION',
          status_code: 35,
          etd_date: '26-09-2026 20:01:50',
          awb_data: { awb: '1091402613664' },
          shipments: {
            id: 1598578182,
            awb: '1091402613664',
            awb_assign_date: '2026-09-22 17:01:40',
            etd: '26 Sep 2026',
            courier: 'Delhivery Air',
            courier_id: 10,
            status: 'PICKUP EXCEPTION',
            pickup_scheduled_date: '23-Sep-2026',
            pod: null,
            updated_at: '24th Sep 2026 22:42 PM',
          },
        },
      };
    },
    async trackByAwb() {
      throw new Error('must not be called for a slice without AWB');
    },
  };
  const worker = loadShippingService('shipmentWorker', {
    '../modules/orders': c.exports,
    './shipmentSync': loadShippingService('shipmentSync', {
      '../modules/orders': c.exports,
      '../infrastructure/shipping/shiprocket': shiprocket,
    }),
  });
  const p = await product(),
    order = await checkout(c, [item(p)]);
  order.sellerShipments = [
    {
      seller: sellerA,
      channelOrderId: 'TIN-2026-000019-8C7315',
      shiprocketOrderId: '1602362118',
      shipmentId: '1598578182',
      status: 'pushed',
    },
  ];
  order.shippingPushPending = false;
  order.trackingNextAt = new Date(0);
  await order.save();
  await worker.runShipmentCycle();
  const fresh = await Order.findById(order._id),
    e = fresh.sellerShipments[0];
  assert.equal(e.awbCode, '1091402613664');
  assert.equal(e.awbCourier, 'Delhivery Air');
  assert.equal(e.awbCourierId, 10);
  assert.equal(e.currentStatus, 'PICKUP EXCEPTION');
  assert.equal(e.status, 'awb');
  assert.ok(e.confirmedAt);
  assert.equal(e.currentStatusId, undefined, 'order status_code must not be stored as a shipment status id');
  assert.equal(e.statusEventAt.toISOString(), '2026-09-22T11:31:40.000Z', 'awb_assign_date, read as IST');
  assert.equal(e.pickupScheduledAt.toISOString(), '2026-09-22T18:30:00.000Z', '23-Sep-2026 midnight IST');
  assert.equal(e.etd.toISOString(), '2026-09-26T14:31:50.000Z', 'etd_date preferred over bare-day etd');
  assert.equal(fresh.status, 'confirmed');
  assert.ok(
    fresh.trackingNextAt > new Date(Date.now() + 4 * 60000),
    'now on the tracking cadence, not the 30-min unbooked backoff',
  );
});
test('pickup lifecycle labels update an awb slice without lowering its status', async () => {
  const c = controller(),
    sync = loadShippingService('shipmentSync', { '../modules/orders': c.exports });
  const p = await product(),
    order = await checkout(c, [item(p)]);
  order.sellerShipments = [{ seller: sellerA, awbCode: 'AWB-P', status: 'awb', confirmedAt: new Date() }];
  await order.save();
  for (const [label, ts] of [
    ['PICKUP SCHEDULED', '22 09 2026 17:01:00'],
    ['PICKUP EXCEPTION', '22 09 2026 19:30:00'],
    ['PICKUP RESCHEDULED', '23 09 2026 09:00:00'],
  ]) {
    const ev = await sync.enqueueShipmentEvent({ awb: 'AWB-P', current_status: label, current_timestamp: ts });
    const r = await sync.processShipmentEvent(ev._id);
    assert.equal(r.accepted, true, label + ' must be accepted');
    const e = (await Order.findById(order._id)).sellerShipments[0];
    assert.equal(e.currentStatus, label);
    assert.equal(e.status, 'awb');
  }
  const ev = await sync.enqueueShipmentEvent({
    awb: 'AWB-P',
    current_status: 'PICKED UP',
    current_timestamp: '23 09 2026 14:00:00',
  });
  await sync.processShipmentEvent(ev._id);
  assert.equal((await Order.findById(order._id)).sellerShipments[0].status, 'shipped');
});
test('an order still NEW on Shiprocket backs off to the 30-minute check', async () => {
  const c = controller();
  const shiprocket = {
    async getOrder() {
      return { data: { id: 5, status: 'NEW', shipments: [] } };
    },
  };
  const worker = loadShippingService('shipmentWorker', {
    '../modules/orders': c.exports,
    './shipmentSync': loadShippingService('shipmentSync', {
      '../modules/orders': c.exports,
      '../infrastructure/shipping/shiprocket': shiprocket,
    }),
  });
  const p = await product(),
    order = await checkout(c, [item(p)]);
  order.sellerShipments = [{ seller: sellerA, shiprocketOrderId: '5', status: 'pushed' }];
  order.shippingPushPending = false;
  order.trackingNextAt = new Date(0);
  await order.save();
  await worker.runShipmentCycle();
  const fresh = await Order.findById(order._id);
  assert.equal(fresh.sellerShipments[0].awbCode, '');
  assert.equal(fresh.sellerShipments[0].status, 'pushed');
  assert.ok(fresh.trackingNextAt > new Date(Date.now() + 25 * 60000));
});
test('seller "ship" adopts an AWB that was already assigned from the Shiprocket panel', async () => {
  const calls = [];
  const shiprocket = {
    async generateAwb() {
      calls.push('awb');
      return {
        awb_assign_status: 0,
        response: {
          data: { awb_assign_error: 'AWB is already assigned with awb - 1091402613664 and status - PICKUP GENERATED' },
        },
      };
    },
    async schedulePickup() {
      calls.push('pickup');
      throw new Error('Pickup has already been generated for this shipment');
    },
    async getOrder() {
      calls.push('detail');
      return {
        data: {
          id: 1602362118,
          status: 'PICKUP EXCEPTION',
          shipments: { id: 1598578182, awb: '1091402613664', courier: 'Delhivery Air', courier_id: 10 },
        },
      };
    },
  };
  const c = loadController({ '../infrastructure/shipping/shiprocket': shiprocket });
  const p = await product(),
    order = await checkout(c, [item(p)]);
  order.sellerShipments = [
    {
      seller: sellerA,
      kind: 'forward',
      status: 'pushed',
      shiprocketOrderId: '1602362118',
      shipmentId: '1598578182',
      lastError: 'AWB failed: AWB is already assigned with awb - 1091402613664 and status - PICKUP GENERATED',
    },
  ];
  order.shippingPushPending = false;
  await order.save();
  const res = response();
  await c.exports.sellerShipOrder({ ...request(order, sellerA), body: {} }, res);
  assert.equal(res.statusCode, 200);
  const e = (await Order.findById(order._id)).sellerShipments[0];
  assert.equal(e.awbCode, '1091402613664');
  assert.equal(e.awbCourier, 'Delhivery Air');
  assert.equal(e.awbCourierId, 10);
  assert.equal(e.status, 'awb');
  assert.ok(e.pickupBookedAt);
  assert.equal(e.pickupError, '');
  assert.equal(e.lastError, '');
  assert.deepEqual(calls, ['awb', 'detail', 'pickup']);
});
test('a stale "AWB failed" error is cleared once the carrier confirms the label', async () => {
  const c = controller(),
    sync = loadShippingService('shipmentSync', { '../modules/orders': c.exports });
  const p = await product(),
    order = await checkout(c, [item(p)]);
  order.sellerShipments = [
    {
      seller: sellerA,
      channelOrderId: 'STALE-1',
      status: 'pushed',
      lastError: 'AWB failed: AWB is already assigned with awb - 555 and status - PICKUP GENERATED',
      pickupError: 'courier did not come',
    },
  ];
  await order.save();
  const ev = await sync.enqueueShipmentEvent({
    order_id: 'STALE-1',
    awb: '555',
    current_status: 'PICKUP SCHEDULED',
    current_timestamp: '23 09 2026 10:00:00',
  });
  await sync.processShipmentEvent(ev._id);
  const e = (await Order.findById(order._id)).sellerShipments[0];
  assert.equal(e.awbCode, '555');
  assert.equal(e.lastError, '', 'AWB error cleared');
  assert.equal(e.pickupError, 'courier did not come', 'unrelated pickup error kept');
});
test('sellers can confirm their own order but cannot self-assert shipping or delivery', async () => {
  const c = controller(),
    p = await product(),
    order = await checkout(c, [item(p)]);
  for (const status of ['shipped', 'delivered']) {
    const req = { ...request(order, sellerA), body: { status } },
      res = response();
    // Refusals are thrown as AppError carrying the status the error layer answers with.
    await assert.rejects(
      c.exports.updateSellerOrderStatus(req, res),
      (e) => /updated by the carrier/.test(e.message) && e.status === 400,
    );
  }
  await c.exports.updateSellerOrderStatus({ ...request(order, sellerA), body: { status: 'confirmed' } }, response());
  assert.ok((await Order.findById(order._id)).sellerShipments[0].confirmedAt);
});
test('tracking refresh persists exact status and split sellers retain independent lifecycles', async () => {
  const c = controller(),
    a = await product(),
    b = await product(1, sellerB),
    order = await checkout(c, [item(a), item(b)]);
  order.sellerShipments = [
    { seller: sellerA, awbCode: 'A', status: 'awb' },
    { seller: sellerB, awbCode: 'B', status: 'awb' },
  ];
  await order.save();
  const sync = loadShippingService('shipmentSync', {
    '../modules/orders': c.exports,
    '../infrastructure/shipping/shiprocket': {
      trackByAwb: async () => ({
        tracking_data: {
          track_status: 1,
          shipment_status: 7,
          shipment_track: [{ current_status: 'DELIVERED', delivered_date: '2026-09-24 14:00:00' }],
        },
      }),
    },
  });
  await sync.refreshShipment(order._id, order.sellerShipments[0]);
  const fresh = await Order.findById(order._id);
  assert.equal(fresh.status, 'shipped');
  assert.equal(fresh.paymentStatus, 'pending');
  assert.equal(fresh.sellerShipments[0].currentStatus, 'DELIVERED');
  const seller = c.sellerOrderDto(fresh, sellerB);
  assert.equal(seller.status, 'placed');
  assert.equal(seller.deliveredAt, undefined);
  assert.equal(seller.sellerShipments.length, 1);
});
test('durable dispatch resumes checkout, preserves confirmation and writes reference before carrier create', async () => {
  const c = controller(),
    p = await product(),
    order = await checkout(c, [item(p)]);
  const confirmed = new Date('2026-09-24T08:00:00Z');
  order.sellerShipments = [{ seller: sellerA, status: 'queued', confirmedAt: confirmed }];
  await order.save();
  const sliceId = String(order.sellerShipments[0]._id);
  let calls = 0;
  const dispatch = loadController({
    '../models/User': {
      find: () => ({ select: async () => [{ _id: sellerA, slug: 'test-pickup' }] }),
      findById: () => ({ select: async () => ({ email: 'test@example.invalid' }) }),
    },
    '../infrastructure/shipping/shiprocket': {
      createOrder: async (payload) => {
        calls++;
        const saved = await Order.findById(order._id);
        assert.equal(saved.sellerShipments[0].channelOrderId, payload.order_id);
        assert.ok(saved.sellerShipments[0].pushAttemptedAt);
        return { order_id: 'provider-order', shipment_id: 'provider-shipment' };
      },
    },
  });
  const worker = loadShippingService('shipmentWorker', {
    '../modules/orders': dispatch.exports,
    './shipmentSync': {
      processShipmentEvent: async () => null,
      refreshShipment: async () => assert.fail('No AWB yet'),
    },
  });
  await worker.runShipmentCycle();
  await worker.runShipmentCycle();
  const fresh = await Order.findById(order._id);
  assert.equal(calls, 1);
  assert.equal(fresh.shippingPushPending, false);
  assert.equal(String(fresh.sellerShipments[0]._id), sliceId);
  assert.equal(fresh.sellerShipments[0].confirmedAt.toISOString(), confirmed.toISOString());
  assert.equal(fresh.sellerShipments[0].shipmentId, 'provider-shipment');
});
test('uncertain external creates are held for reconciliation rather than duplicated', async () => {
  const c = controller(),
    p = await product(),
    order = await checkout(c, [item(p)]);
  order.sellerShipments = [
    { seller: sellerA, status: 'queued', channelOrderId: 'KNOWN-REFERENCE', pushAttemptedAt: new Date() },
  ];
  await order.save();
  const res = response();
  await assert.rejects(
    c.exports.sellerRetryPush(request(order, sellerA), res),
    (e) => /awaiting reconciliation/.test(e.message) && e.status === 409,
  );
  assert.equal((await Order.findById(order._id)).sellerShipments[0].channelOrderId, 'KNOWN-REFERENCE');
});
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { loadController, response } = require('./helpers/controller');
const Product = require('../src/modules/products/product.model');
const Order = require('../src/modules/orders/order.model');
const Cart = require('../src/modules/customers/cart.model');
const CheckoutIntent = require('../src/modules/orders/checkout-intent.model');
const PrivateUpload = require('../src/models/PrivateUpload');
const ShipmentEvent = require('../src/modules/orders/shipment-event.model');
const { ownedPrivateKey } = require('../src/utils/privateFiles');
process.env.JWT_SECRET = 'isolated-test-secret-'.repeat(4);
process.env.DISABLE_S3 = 'true';
process.env.REDIS_DISABLED = 'true';
let mongo;
const id = () => new mongoose.Types.ObjectId();
const customer = id(),
  sellerA = id(),
  sellerB = id();
const address = {
  fullName: 'Test Buyer',
  phone: '9999999999',
  line1: 'Test Road',
  city: 'Delhi',
  state: 'Delhi',
  pincode: '110001',
};
const controller = () => loadController();
const request = (order, user = customer) => ({
  params: { id: order.orderNumber },
  user: { _id: user },
  headers: {},
  body: {},
});
async function product(stock = 1, seller = sellerA, variants = []) {
  const row = {
    _id: id(),
    name: 'Test helmet',
    slug: 'test-' + id(),
    category: id(),
    seller,
    price: 100,
    stock,
    variants,
  };
  await Product.collection.insertOne(row);
  return row;
}
function item(p, quantity = 1) {
  return {
    product: p._id,
    seller: p.seller,
    name: p.name,
    quantity,
    price: 100,
    subtotal: 100 * quantity,
    size: '',
    color: '',
  };
}
async function checkout(c, items, options = {}) {
  const total = items.reduce((n, it) => n + it.subtotal, 0);
  return c.finalizeOrder({
    user: { _id: customer, name: 'Buyer' },
    addr: address,
    items,
    itemsTotal: total,
    shippingFee: 0,
    total,
    paymentMethod: 'cod',
    paymentStatus: 'pending',
    idempotencyKey: 'test-' + id(),
    ...options,
  });
}
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({
    binary: { downloadDir: require('node:path').join(require('node:os').tmpdir(), 'throttlein-mongo-binaries') },
    replSet: { count: 1 },
    instanceOpts: [{ ip: '127.0.0.1' }],
  });
  await mongoose.connect(mongo.getUri(), { dbName: 'throttlein_security_test' });
  require('../src/models/Counter');
  await Promise.all([
    Product.init(),
    Order.init(),
    Cart.init(),
    CheckoutIntent.init(),
    PrivateUpload.init(),
    ShipmentEvent.init(),
  ]);
});
afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});
beforeEach(async () => {
  await Promise.all([
    Product.deleteMany({}),
    Order.deleteMany({}),
    Cart.deleteMany({}),
    CheckoutIntent.deleteMany({}),
    PrivateUpload.deleteMany({}),
    ShipmentEvent.deleteMany({}),
  ]);
});

test('two simultaneous last-unit purchases create one order and no negative stock', async () => {
  const p = await product(1),
    c = controller();
  const attempts = await Promise.allSettled([checkout(c, [item(p)]), checkout(c, [item(p)])]);
  assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(await Order.countDocuments(), 1);
  assert.equal((await Product.findById(p._id)).stock, 0);
});
test('failed multi-line COD checkout rolls all earlier reservations back', async () => {
  const a = await product(1),
    b = await product(0);
  const c = controller();
  await assert.rejects(checkout(c, [item(a), item(b)]), /sold out/);
  assert.equal((await Product.findById(a._id)).stock, 1);
  assert.equal(await Order.countDocuments(), 0);
});
test('duplicate COD requests return the same order and reserve stock only once', async () => {
  const p = await product(3),
    c = controller();
  const [a, b] = await Promise.all([
    checkout(c, [item(p)], { idempotencyKey: 'same' }),
    checkout(c, [item(p)], { idempotencyKey: 'same' }),
  ]);
  assert.equal(String(a._id), String(b._id));
  assert.equal((await Product.findById(p._id)).stock, 2);
});
test('aggregate and exact variant stock change together', async () => {
  const p = await product(1, sellerA, [
    { size: 'M', color: 'Black', stock: 1 },
    { size: 'L', color: 'Black', stock: 0 },
  ]);
  const c = controller();
  await checkout(c, [{ ...item(p), size: 'M', color: 'Black' }]);
  const stored = await Product.findById(p._id);
  assert.equal(stored.stock, 0);
  assert.equal(stored.variants[0].stock, 0);
  assert.equal(stored.variants[1].stock, 0);
});
test('paid stock conflict is held and cancellation cannot create unreserved inventory', async () => {
  const p = await product(0),
    c = controller();
  const order = await checkout(c, [item(p)], {
    paymentMethod: 'online',
    paymentStatus: 'paid',
    razorpayPaymentId: 'pay_conflict',
  });
  assert.equal(order.inventoryReserved, false);
  assert.ok(order.fulfillmentHold);
  await c.restoreCancelledStock(order._id);
  assert.equal((await Product.findById(p._id)).stock, 0);
});
test('mixed seller and whole-order cancellations restore each unit once under concurrency', async () => {
  const a = await product(1),
    b = await product(1, sellerB),
    c = controller();
  const order = await checkout(c, [item(a), item(b)], {
    paymentMethod: 'online',
    paymentStatus: 'paid',
    razorpayPaymentId: 'pay_mix',
  });
  order.sellerShipments = [
    { seller: sellerA, kind: 'forward', status: 'cancelled' },
    { seller: sellerB, kind: 'forward', status: 'pushed' },
  ];
  await order.save();
  await c.restoreCancelledStock(order._id, sellerA);
  await Promise.all([c.restoreCancelledStock(order._id), c.restoreCancelledStock(order._id)]);
  assert.equal((await Product.findById(a._id)).stock, 1);
  assert.equal((await Product.findById(b._id)).stock, 1);
  const fresh = await Order.findById(order._id);
  assert.equal(
    fresh.returnRequests.reduce((n, r) => n + r.refundAmount, 0),
    200,
  );
});
test('payment finalization preserves unrelated cart additions', async () => {
  const a = await product(2),
    b = await product(1);
  await Cart.create({
    user: customer,
    items: [
      { product: a._id, quantity: 2 },
      { product: b._id, quantity: 1 },
    ],
  });
  await checkout(controller(), [item(a)], {
    paymentMethod: 'online',
    paymentStatus: 'paid',
    razorpayPaymentId: 'pay_cart',
  });
  const cart = await Cart.findOne({ user: customer });
  assert.equal(cart.items.length, 2);
  assert.equal(cart.items.find((i) => String(i.product) === String(a._id)).quantity, 1);
});
async function refundOrder() {
  const p = await product(2),
    order = await checkout(controller(), [item(p, 2)], {
      paymentMethod: 'online',
      paymentStatus: 'paid',
      razorpayPaymentId: 'pay_refund',
    });
  order.returnRequests = [
    {
      seller: sellerA,
      kind: 'return',
      status: 'approved',
      refundStatus: 'requested',
      refundMethod: 'razorpay',
      refundAmount: 100,
    },
    {
      seller: sellerA,
      kind: 'return',
      status: 'approved',
      refundStatus: 'requested',
      refundMethod: 'razorpay',
      refundAmount: 100,
    },
  ];
  await order.save();
  return order;
}
test('concurrent admin calls issue one refund; webhook completes pending refunds without regression', async () => {
  const order = await refundOrder();
  const rid = order.returnRequests[0]._id;
  let calls = 0;
  const refund = {
    id: 'rfnd_1',
    payment_id: 'pay_refund',
    amount: 10000,
    status: 'pending',
    notes: { refundRequestId: String(rid) },
  };
  const c = loadController({
    '../infrastructure/payments/razorpay': {
      refundPayment: async ({ notes }) => {
        calls++;
        refund.notes = notes;
        return refund;
      },
      verifyWebhookSignature: () => true,
    },
  });
  const req = { params: { reqId: rid }, user: { _id: id() }, body: {} };
  const results = await Promise.allSettled([
    c.exports.adminProcessRefund(req, response()),
    c.exports.adminProcessRefund(req, response()),
  ]);
  assert.equal(calls, 1);
  assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
  assert.equal((await Order.findById(order._id)).returnRequests.id(rid).refundStatus, 'processing');
  const event = { event: 'refund.processed', payload: { refund: { entity: { ...refund, status: 'processed' } } } };
  await c.exports.razorpayWebhook({ headers: {}, rawBody: Buffer.from(JSON.stringify(event)) }, response());
  await c.applyRazorpayRefund({ ...refund, status: 'pending' });
  let fresh = await Order.findById(order._id);
  assert.equal(fresh.returnRequests.id(rid).refundStatus, 'completed');
  assert.equal(fresh.paymentStatus, 'paid');
  await c.applyRazorpayRefund({
    ...refund,
    id: 'rfnd_2',
    status: 'processed',
    notes: { refundRequestId: String(order.returnRequests[1]._id) },
  });
  fresh = await Order.findById(order._id);
  assert.equal(fresh.paymentStatus, 'refunded');
});
test('uncertain refund stays locked against retries until reconciled', async () => {
  const order = await refundOrder(),
    rid = order.returnRequests[0]._id;
  let attemptNotes;
  const c = loadController({
    '../infrastructure/payments/razorpay': {
      refundPayment: async ({ notes }) => {
        attemptNotes = notes;
        throw new Error('timeout');
      },
      listPaymentRefunds: async () => [
        { id: 'rfnd_timeout', payment_id: 'pay_refund', amount: 10000, status: 'processed', notes: attemptNotes },
      ],
    },
  });
  const req = { params: { reqId: rid }, user: { _id: id() }, body: {} };
  const res = response();
  await c.exports.adminProcessRefund(req, res);
  assert.equal(res.statusCode, 202);
  await assert.rejects(c.exports.adminProcessRefund(req, response()), /already processing/);
  await c.exports.adminReconcileRefund(req, response());
  assert.equal((await Order.findById(order._id)).returnRequests.id(rid).refundStatus, 'completed');
});
test('an unconfirmed refund attempt is released for retry only after the grace period, and only when Razorpay has no record', async () => {
  const order = await refundOrder(),
    rid = order.returnRequests[0]._id;
  const c = loadController({
    '../infrastructure/payments/razorpay': {
      refundPayment: async () => {
        throw new Error('timeout');
      },
      listPaymentRefunds: async () => [],
    },
  });
  const req = { params: { reqId: rid }, user: { _id: id(), email: 'ops@example.test' }, body: {} };
  await c.exports.adminProcessRefund(req, response());
  let r = (await Order.findById(order._id)).returnRequests.id(rid);
  assert.equal(r.refundStatus, 'processing');
  assert.ok(r.refundAttemptAt, 'the attempt time is recorded');
  await assert.rejects(
    c.exports.adminReleaseRefund(req, response()),
    (e) => e.status === 409 && /minutes?/.test(e.message),
  );
  await Order.updateOne(
    { _id: order._id, 'returnRequests._id': rid },
    { $set: { 'returnRequests.$.refundAttemptAt': new Date(Date.now() - 2 * 3600000) } },
  );
  const res = response();
  await c.exports.adminReleaseRefund(req, res);
  assert.equal(res.body.data.released, true); // admin verbs answer the { data } envelope
  r = (await Order.findById(order._id)).returnRequests.id(rid);
  assert.equal(r.refundStatus, 'requested');
  assert.equal(r.refundAttemptId, '');
  assert.match(r.refundNotes, /Released .* by ops@example.test/);
  // Released, it goes through the normal process path again.
  const retry = loadController({
    '../infrastructure/payments/razorpay': {
      refundPayment: async ({ notes }) => ({
        id: 'rfnd_retry',
        payment_id: 'pay_refund',
        amount: 10000,
        status: 'processed',
        notes,
      }),
    },
  });
  await retry.exports.adminProcessRefund(req, response());
  assert.equal((await Order.findById(order._id)).returnRequests.id(rid).refundStatus, 'completed');
});
test('releasing an attempt Razorpay DID record applies that record instead of re-queuing', async () => {
  const order = await refundOrder(),
    rid = order.returnRequests[0]._id;
  let attemptNotes;
  const c = loadController({
    '../infrastructure/payments/razorpay': {
      refundPayment: async ({ notes }) => {
        attemptNotes = notes;
        throw new Error('timeout');
      },
      listPaymentRefunds: async () => [
        { id: 'rfnd_late', payment_id: 'pay_refund', amount: 10000, status: 'processed', notes: attemptNotes },
      ],
    },
  });
  const req = { params: { reqId: rid }, user: { _id: id() }, body: {} };
  await c.exports.adminProcessRefund(req, response());
  await Order.updateOne(
    { _id: order._id, 'returnRequests._id': rid },
    { $set: { 'returnRequests.$.refundAttemptAt': new Date(Date.now() - 2 * 3600000) } },
  );
  const res = response();
  await c.exports.adminReleaseRefund(req, res);
  assert.equal(res.body.data.applied, true);
  const r = (await Order.findById(order._id)).returnRequests.id(rid);
  assert.equal(r.refundStatus, 'completed');
  assert.equal(r.refundReference, 'rfnd_late');
});
test('private file references cannot borrow another account upload', async () => {
  const key = '/private-uploads/owned.png';
  await PrivateUpload.create({ key, owner: sellerA, purpose: 'kyc' });
  assert.equal(await ownedPrivateKey(key, sellerA, 'kyc'), key);
  await assert.rejects(ownedPrivateKey(key, sellerB, 'kyc'), /unauthorized/);
});

test('different refund requests cannot exceed the captured order total concurrently', async () => {
  const order = await refundOrder();
  order.returnRequests.forEach((r) => {
    r.refundAmount = 150;
  });
  await order.save();
  let calls = 0;
  const c = loadController({
    '../infrastructure/payments/razorpay': {
      refundPayment: async ({ notes, amount }) => {
        calls++;
        return { id: 'rfnd_budget', payment_id: 'pay_refund', amount, status: 'pending', notes };
      },
    },
  });
  const outcomes = await Promise.allSettled(
    order.returnRequests.map((r) =>
      c.exports.adminProcessRefund({ params: { reqId: r._id }, user: { _id: id() }, body: {} }, response()),
    ),
  );
  assert.equal(calls, 1);
  assert.equal(outcomes.filter((r) => r.status === 'rejected').length, 1);
});

test('fulfilment lock excludes a simultaneous dispatch or cancellation', async () => {
  const p = await product(),
    order = await checkout(controller(), [item(p)]),
    c = controller();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const first = c.exports.withFulfillmentLock(order._id, async () => {
    started();
    await gate;
  });
  await ready;
  await assert.rejects(
    c.exports.withFulfillmentLock(order._id, async () => {}),
    /Another fulfilment/,
  );
  release();
  await first;
  await c.exports.withFulfillmentLock(order._id, async () => {});
});

test('a failed carrier cancellation can be retried without duplicate stock or refunds', async () => {
  const p = await product(),
    order = await checkout(controller(), [item(p)], {
      paymentMethod: 'online',
      paymentStatus: 'paid',
      razorpayPaymentId: 'pay_cancel_retry',
    });
  order.sellerShipments = [{ seller: sellerA, kind: 'forward', status: 'awb', awbCode: 'TEST-AWB' }];
  await order.save();
  let attempts = 0;
  const c = loadController({
    '../infrastructure/shipping/shiprocket': {
      cancelShipmentByAwb: async () => {
        if (++attempts === 1) throw new Error('Temporary carrier failure');
      },
    },
  });
  const first = response();
  await c.exports.cancel(request(order), first);
  assert.equal(first.body.data.carrierCancellationPending, true);
  assert.equal((await Product.findById(p._id)).stock, 0);
  assert.equal((await Order.findById(order._id)).returnRequests.length, 0);
  await c.exports.cancel(request(order), response());
  await c.exports.cancel(request(order), response());
  assert.equal(attempts, 2);
  assert.equal((await Product.findById(p._id)).stock, 1);
  assert.equal((await Order.findById(order._id)).returnRequests.length, 1);
});

test('a cancelled seller slice cannot dispatch while other sellers remain active', async () => {
  const a = await product(),
    b = await product(1, sellerB);
  const order = await checkout(controller(), [item(a), item(b)]);
  order.status = 'confirmed';
  order.sellerShipments = [
    { seller: sellerA, status: 'cancelled', shipmentId: 'A' },
    { seller: sellerB, status: 'pushed', shipmentId: 'B' },
  ];
  await order.save();
  await assert.rejects(
    controller().exports.sellerShipOrder(request(order, sellerA), response()),
    /no longer be dispatched/,
  );
  await assert.rejects(
    controller().exports.sellerRetryPush(request(order, sellerA), response()),
    /cannot be recreated/,
  );
});

test('return verification rolls stock back on a failed save and retries exactly once', async () => {
  const p = await product(1, sellerA, [{ size: 'M', color: 'Black', stock: 1 }]);
  const order = await checkout(controller(), [{ ...item(p), size: 'M', color: 'Black' }]);
  const retId = id();
  order.sellerShipments = [{ _id: retId, seller: sellerA, kind: 'return', status: 'returned' }];
  order.returnRequests = [
    {
      seller: sellerA,
      kind: 'return',
      status: 'approved',
      returnShipmentEntryId: retId,
      items: [
        {
          product: p._id,
          orderItemId: order.items[0]._id,
          name: p.name,
          size: 'M',
          color: 'Black',
          price: 100,
          quantity: 1,
        },
      ],
    },
  ];
  await order.save();
  const req = {
    ...request(order, sellerA),
    params: { id: order.orderNumber, reqId: order.returnRequests[0]._id },
    body: { ok: true },
  };
  const c = controller(),
    originalSave = Order.prototype.save;
  try {
    Order.prototype.save = async function (options) {
      if (options?.session) throw new Error('Injected write failure');
      return originalSave.call(this, options);
    };
    await assert.rejects(c.exports.sellerVerifyReturn(req, response()), /Injected write failure/);
  } finally {
    Order.prototype.save = originalSave;
  }
  assert.equal((await Product.findById(p._id)).stock, 0);
  assert.equal((await Order.findById(order._id)).sellerShipments.id(retId).restockedAt, undefined);
  await c.exports.sellerVerifyReturn(req, response());
  await c.exports.sellerVerifyReturn(req, response());
  const stored = await Product.findById(p._id),
    fresh = await Order.findById(order._id);
  assert.equal(stored.stock, 1);
  assert.equal(stored.variants[0].stock, 1);
  assert.equal(fresh.items[0].returnedQuantity, 1);
  assert.equal(fresh.returnRequests[0].refundAmount, 100);
});

test('startup removes legacy payment-snapshot expiration without deleting records', async () => {
  await CheckoutIntent.collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  const inserted = await CheckoutIntent.collection.insertOne({
    expiresAt: new Date(Date.now() + 86400000),
    status: 'pending',
  });
  await require('../src/utils/retainCheckoutIntents')();
  assert.equal(
    (await CheckoutIntent.collection.indexes()).some((i) => i.expireAfterSeconds !== undefined),
    false,
  );
  assert.ok(await CheckoutIntent.findById(inserted.insertedId));
  assert.equal((await CheckoutIntent.findById(inserted.insertedId)).expiresAt, undefined);
});

test('captured payments must match snapshot amount, currency, provider order, and owner', async () => {
  const c = controller();
  const intent = { amountPaise: 10000, currency: 'INR' };
  const captured = { amount: 10000, currency: 'INR', order_id: 'order_expected', status: 'captured' };
  assert.doesNotThrow(() => c.assertPaymentMatchesIntent(captured, intent, 'order_expected'));
  for (const patch of [{ amount: 100 }, { currency: 'USD' }, { order_id: 'order_foreign' }, { status: 'authorized' }]) {
    assert.throws(() => c.assertPaymentMatchesIntent({ ...captured, ...patch }, intent, 'order_expected'));
  }
  await CheckoutIntent.collection.insertOne({
    user: sellerB,
    razorpayOrderId: 'order_foreign_user',
    status: 'pending',
  });
  const handler = loadController({ '../infrastructure/payments/razorpay': { verifyCheckoutSignature: () => true } });
  const res = response();
  await assert.rejects(
    handler.exports.razorpayVerify(
      {
        user: { _id: customer },
        body: { razorpay_order_id: 'order_foreign_user', razorpay_payment_id: 'pay_test', razorpay_signature: 'test' },
      },
      res,
    ),
    (e) => /different account/.test(e.message) && e.status === 403,
  );
});

test('real multipart requests reject disguised files and save KYC outside public storage', async () => {
  const express = require('express'),
    fs = require('node:fs/promises'),
    os = require('node:os'),
    path = require('node:path');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'throttlein-upload-test-'));
  const oldPrivate = process.env.PRIVATE_UPLOAD_DIR;
  process.env.PRIVATE_UPLOAD_DIR = temp;
  const upload = require('../src/middleware/upload');
  const { validateRequest } = require('../src/middleware/requestSecurity');
  const app = express();
  app.use(express.json(), validateRequest);
  app.post('/probe', (_req, res) => res.json({ ok: true }));
  app.post(
    '/upload',
    (req, _res, next) => {
      req.user = { _id: customer };
      req._uploadPrefix = 'sellers/test/kyc';
      next();
    },
    upload.single('file'),
    (req, res) => res.json({ key: upload.fileToUrl(req.file) }),
  );
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ message: err.message }));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const injection = await fetch(`${base}/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"email":{"$ne":null}}',
    });
    assert.equal(injection.status, 400);
    const bad = new FormData();
    bad.append('file', new Blob(['<script>alert(1)</script>'], { type: 'image/png' }), 'photo.png');
    const denied = await fetch(`${base}/upload`, { method: 'POST', body: bad });
    assert.equal(denied.status, 400);
    assert.equal((await fs.readdir(temp)).length, 0);
    const good = new FormData();
    good.append(
      'file',
      new Blob([Buffer.from('89504e470d0a1a0a0000000000000000', 'hex')], { type: 'image/png' }),
      'photo.png',
    );
    const accepted = await fetch(`${base}/upload`, { method: 'POST', body: good });
    assert.equal(accepted.status, 200);
    const { key } = await accepted.json();
    assert.match(key, /^\/private-uploads\//);
    assert.ok(await PrivateUpload.exists({ key, owner: customer, purpose: 'kyc' }));
    assert.equal((await fs.readdir(temp)).length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (oldPrivate === undefined) delete process.env.PRIVATE_UPLOAD_DIR;
    else process.env.PRIVATE_UPLOAD_DIR = oldPrivate;
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('a retry after a confirmed failed refund ignores late events from the old attempt', async () => {
  const order = await refundOrder(),
    rid = order.returnRequests[0]._id;
  const attempts = [];
  const c = loadController({
    '../infrastructure/payments/razorpay': {
      refundPayment: async ({ notes }) => {
        const refund = {
          id: `refund_attempt_${attempts.length}`,
          payment_id: 'pay_refund',
          amount: 10000,
          status: attempts.length ? 'pending' : 'failed',
          notes,
        };
        attempts.push(refund);
        return refund;
      },
    },
  });
  const req = { params: { reqId: rid }, user: { _id: id() }, body: {} };
  await c.exports.adminProcessRefund(req, response());
  assert.equal((await Order.findById(order._id)).returnRequests.id(rid).refundStatus, 'failed');
  await c.exports.adminProcessRefund(req, response());
  await c.applyRazorpayRefund(attempts[0]);
  let fresh = await Order.findById(order._id);
  assert.equal(fresh.returnRequests.id(rid).refundReference, attempts[1].id);
  assert.equal(fresh.returnRequests.id(rid).refundStatus, 'processing');
  await c.applyRazorpayRefund({ ...attempts[1], status: 'processed' });
  fresh = await Order.findById(order._id);
  assert.equal(fresh.returnRequests.id(rid).refundStatus, 'completed');
});

test('attention counts cover to-ship, failed pickup, delivery issues and pending returns for one seller only', async () => {
  const c = controller(),
    p = await product(9);
  const toShip = await checkout(c, [item(p)]);
  toShip.sellerShipments = [{ seller: sellerA, status: 'queued' }];
  await toShip.save();
  const failed = await checkout(c, [item(p)]);
  failed.sellerShipments = [{ seller: sellerA, awbCode: 'AWB-F', status: 'awb', currentStatus: 'PICKUP EXCEPTION' }];
  await failed.save();
  const undelivered = await checkout(c, [item(p)]);
  undelivered.sellerShipments = [{ seller: sellerA, awbCode: 'AWB-U', status: 'undelivered' }];
  await undelivered.save();
  const someoneElse = await checkout(c, [item(p)]);
  someoneElse.sellerShipments = [
    { seller: sellerB, status: 'queued' },
    { seller: sellerA, awbCode: 'AWB-OK', status: 'in_transit' },
  ];
  await someoneElse.save();
  const returned = await checkout(c, [item(p)]);
  returned.status = 'delivered';
  returned.returnRequests = [
    { seller: sellerA, kind: 'return', status: 'pending', items: [] },
    { seller: sellerA, kind: 'return', status: 'approved', items: [] },
    { seller: sellerB, kind: 'return', status: 'pending', items: [] },
  ];
  await returned.save();
  const res = response();
  await c.exports.sellerAttentionCounts({ user: { _id: sellerA }, query: {} }, res);
  assert.deepEqual({ ...res.body.data.counts }, { toShip: 1, pickupFailed: 1, deliveryIssues: 1, returnsPending: 1 });
  assert.equal(res.body.data.total, 4);
});

test('seller queues name one pipeline: sign-ups, KYC waiting, live, suspended — and the list filter agrees', async () => {
  const User = require('../src/models/User');
  const { sellerQueueCounts, SELLER_QUEUE_FILTERS } = require('../src/utils/sellerOnboarding');
  const mk = (i, extra) => ({
    name: 's' + i,
    email: `s${i}@x.test`,
    role: 'seller',
    password: 'x'.repeat(12),
    slug: 's' + i,
    ...extra,
  });
  await User.collection.insertMany([
    mk(1, { status: 'pending', emailVerified: false }), // signup (unverified)
    mk(2, { status: 'pending', emailVerified: true, kyc: { status: 'not_started' } }), // signup
    mk(3, { status: 'pending', emailVerified: true, kyc: { status: 'rejected' } }), // signup
    mk(4, { status: 'pending', emailVerified: true, kyc: { status: 'pending' } }), // kyc waiting
    mk(5, { status: 'approved', emailVerified: true, kyc: { status: 'approved' } }), // live
    mk(6, { status: 'suspended', emailVerified: true, kyc: { status: 'approved' } }), // suspended
  ]);
  const q = await sellerQueueCounts(User);
  assert.deepEqual({ ...q }, { signups: 3, unverified: 1, kycWaiting: 1, live: 1, suspended: 1 });
  // A seller is never in two queues, and the queues cover everyone.
  const all = await User.countDocuments({ role: 'seller' });
  assert.equal(q.signups + q.kycWaiting + q.live + q.suspended, all);
  assert.equal(await User.countDocuments(SELLER_QUEUE_FILTERS.kycWaiting), 1);
  await User.deleteMany({ role: 'seller' });
});
