// Carrier ingress and status regressions. Isolated dependencies; no live calls.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
process.env.REDIS_DISABLED = 'true';
process.env.SHIPROCKET_WEBHOOK_TOKEN = 'test-token-123';
const { applyShipmentEvent, sanitizeShipmentEvent, trackingToEvent } = require('../src/modules/orders/shipment-status');
const { authenticateShipmentWebhook } = require('../src/middleware/shipmentWebhookSecurity');
let db = [];
let pending;
let events = new Map();
const sync = {
  async enqueueShipmentEvent(body) {
    const key = JSON.stringify(body);
    if (events.has(key)) return events.get(key);
    pending = { _id: 'event', payload: sanitizeShipmentEvent(body), state: 'pending' };
    events.set(key, pending);
    return pending;
  },
  async processShipmentEvent() {
    const o = db.find((o) => o.sellerShipments.some((e) => e.channelOrderId === pending.payload.order_id));
    if (!o) return { matched: false, queued: true };
    const result = applyShipmentEvent(o.sellerShipments[0], pending.payload);
    await o.save();
    o.derived = (o.derived || 0) + 1;
    pending.state = 'completed';
    return { matched: true, ...result };
  },
};
const filename = path.resolve(__dirname, '../src/routes/webhookRoutes.js');
const localRequire = createRequire(filename);
const ctx = {
  module: { exports: {} },
  process,
  console,
  // The route takes the shipment inbox, the Razorpay handler and the status mapping from the orders index.
  require: (name) =>
    name === '../modules/orders'
      ? { ...sync, razorpayWebhook() {}, shipmentStatus: require('../src/modules/orders/shipment-status') }
      : name === 'express-async-handler'
        ? (fn) => fn
        : localRequire(name),
};
vm.runInNewContext(fs.readFileSync(filename, 'utf8'), ctx, { filename });
const hooks = ctx.module.exports;
const { handleShipmentWebhook } = hooks;
const { parseShiprocketDate, mapShipmentStatus } = hooks._internals;

function makeOrder(entry = {}) {
  const o = {
    sellerShipments: [
      { channelOrderId: 'TIN-2026-000123-A3F7B2', kind: 'forward', status: 'awb', scans: [], ...entry },
    ],
    saved: 0,
    async save() {
      this.saved++;
    },
  };
  db = [o];
  events = new Map();
  return o;
}
async function call(body, key = 'test-token-123') {
  const res = {
    code: 200,
    status(c) {
      this.code = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
  const req = { body, get: (h) => (h.toLowerCase() === 'x-api-key' ? key : undefined) };
  // Refusals are thrown AppErrors; mirror what the error layer would answer.
  try {
    await handleShipmentWebhook(req, res);
  } catch (e) {
    res.code = e.status;
    res.body = { ok: false, error: e.details?.reason || e.message };
  }
  return res;
}

const SAMPLE = {
  awb: '19041424751540',
  courier_name: 'Delhivery Surface',
  current_status: 'IN TRANSIT',
  current_status_id: 20,
  shipment_status: 'IN TRANSIT',
  shipment_status_id: 18,
  current_timestamp: '23 05 2023 11:43:52',
  order_id: 'TIN-2026-000123-A3F7B2',
  sr_order_id: 348456385,
  awb_assigned_date: '2023-05-19 11:59:16',
  pickup_scheduled_date: '2023-05-19 11:59:17',
  etd: '2023-05-23 15:40:19',
  scans: [
    {
      date: '2023-05-19 11:59:16',
      status: 'X-UCI',
      activity: 'Manifested - Manifest uploaded',
      location: 'Chomu',
      'sr-status': '5',
      'sr-status-label': 'MANIFEST GENERATED',
    },
    {
      date: '2023-05-19 15:32:17',
      status: 'X-PPOM',
      activity: 'In Transit - Shipment picked up',
      location: 'Chomu',
      'sr-status': '42',
      'sr-status-label': 'PICKED UP',
    },
    {
      date: '2023-05-20 15:23:38',
      status: 'X-IBD3F',
      activity: 'In Transit - Shipment Received at Facility',
      location: 'Jaipur',
      'sr-status': '18',
      'sr-status-label': 'IN TRANSIT',
    },
    {
      date: '2023-05-20 15:23:38',
      status: 'X-DWS',
      activity: 'In Transit - System weight captured',
      location: 'Jaipur',
      'sr-status': 'NA',
      'sr-status-label': 'NA',
    },
  ],
  is_return: 0,
  channel_id: 3422553,
  pod_status: 'OTP Based Delivery',
  pod: 'Not Available',
};

test('dates are read as IST, including the DD MM YYYY format', () => {
  assert.strictEqual(parseShiprocketDate('2023-05-19 11:59:16').toISOString(), '2023-05-19T06:29:16.000Z');
  assert.strictEqual(parseShiprocketDate('23 05 2023 11:43:52').toISOString(), '2023-05-23T06:13:52.000Z');
  assert.strictEqual(parseShiprocketDate('2023-05-19T06:29:16Z').toISOString(), '2023-05-19T06:29:16.000Z');
  assert.strictEqual(parseShiprocketDate('NA'), null);
  assert.strictEqual(parseShiprocketDate('garbage'), null);
});

test('status maps from labels; current_status_id is not trusted', () => {
  assert.strictEqual(mapShipmentStatus({ labels: ['IN TRANSIT'], shipmentStatusId: 18 }), 'shipped');
  assert.strictEqual(mapShipmentStatus({ labels: ['Out For Delivery'] }), 'out_for_delivery');
  assert.strictEqual(mapShipmentStatus({ labels: ['UNDELIVERED'] }), 'undelivered');
  assert.strictEqual(mapShipmentStatus({ labels: ['RTO IN TRANSIT'] }), 'rto_in_transit');
  assert.strictEqual(mapShipmentStatus({ labels: ['RTO DELIVERED'] }), 'rto_delivered');
  assert.strictEqual(mapShipmentStatus({ labels: ['Delivered'] }), 'delivered');
  assert.strictEqual(mapShipmentStatus({ labels: ['CANCELLATION REQUESTED'] }), null);
  assert.strictEqual(mapShipmentStatus({ labels: ['SOMETHING NEW'], shipmentStatusId: 7 }), 'delivered');
});

test('rejects a wrong token', async () => {
  makeOrder();
  const r = await call(SAMPLE, 'nope');
  assert.strictEqual(r.code, 401);
});

test('doc sample payload updates the matched slice', async () => {
  const o = makeOrder();
  const r = await call(SAMPLE);
  assert.strictEqual(r.code, 200);
  assert.strictEqual(r.body.status, 'shipped');
  assert.strictEqual(r.body.matched, true);
  const e = o.sellerShipments[0];
  assert.strictEqual(e.currentStatus, 'IN TRANSIT');
  assert.strictEqual(e.currentStatusId, 18);
  assert.strictEqual(e.awbCode, '19041424751540');
  assert.strictEqual(e.isReturn, false);
  assert.strictEqual(e.pod, undefined);
  assert.strictEqual(e.etd.toISOString(), '2023-05-23T10:10:19.000Z');
  assert.strictEqual(e.pickedUpAt.toISOString(), '2023-05-19T10:02:17.000Z');
  assert.strictEqual(e.scans.length, 4);
  assert.strictEqual(e.scans[3].statusId, undefined); // "NA"
  assert.strictEqual(o.saved, 1);
  assert.strictEqual(o.derived, 1);
});

test('replayed payload does not duplicate scans', async () => {
  const o = makeOrder();
  await call(SAMPLE);
  await call(SAMPLE);
  assert.strictEqual(o.sellerShipments[0].scans.length, 4);
});

test('late in-transit event does not demote a delivered slice', async () => {
  const o = makeOrder({ status: 'delivered' });
  const r = await call(SAMPLE);
  assert.strictEqual(r.body.status, 'delivered');
  assert.strictEqual(o.sellerShipments[0].status, 'delivered');
});

test('late manifest event does not pull a moving parcel back to awb', async () => {
  const o = makeOrder({ status: 'shipped' });
  await call({
    ...SAMPLE,
    current_status: 'MANIFEST GENERATED',
    shipment_status: 'MANIFEST GENERATED',
    shipment_status_id: 5,
    scans: [],
  });
  assert.strictEqual(o.sellerShipments[0].status, 'shipped');
});

test('delivered event stamps deliveredAt from event time', async () => {
  const o = makeOrder({ status: 'out_for_delivery' });
  await call({
    ...SAMPLE,
    current_status: 'DELIVERED',
    shipment_status: 'DELIVERED',
    shipment_status_id: 7,
    current_timestamp: '24 05 2023 14:00:00',
    scans: [],
  });
  const e = o.sellerShipments[0];
  assert.strictEqual(e.status, 'delivered');
  assert.strictEqual(e.deliveredAt.toISOString(), '2023-05-24T08:30:00.000Z');
});

test('return leg delivered becomes returned', async () => {
  const o = makeOrder({ kind: 'return', status: 'shipped' });
  await call({ ...SAMPLE, current_status: 'DELIVERED', shipment_status: 'DELIVERED', scans: [] });
  assert.strictEqual(o.sellerShipments[0].status, 'returned');
});

test('NDR increments counter', async () => {
  const o = makeOrder({ status: 'out_for_delivery' });
  await call({
    ...SAMPLE,
    current_status: 'UNDELIVERED',
    shipment_status: 'UNDELIVERED',
    ndr_reason: 'Customer not available',
    scans: [],
  });
  const e = o.sellerShipments[0];
  assert.strictEqual(e.status, 'undelivered');
  assert.strictEqual(e.ndrCount, 1);
  assert.strictEqual(e.ndrLastReason, 'Customer not available');
});

test('unmatched order (dashboard "Test Webhook") still answers 200', async () => {
  makeOrder();
  const r = await call({ ...SAMPLE, order_id: '1373900_150876814', awb: 'x' });
  assert.strictEqual(r.code, 200);
  assert.strictEqual(r.body.matched, false);
  assert.strictEqual(r.body.queued, true);
});

test('unparseable dates do not crash the handler', async () => {
  makeOrder();
  const r = await call({
    ...SAMPLE,
    current_timestamp: 'bad',
    etd: 'NA',
    scans: [{ date: 'NA', status: 'X', activity: 'y' }],
  });
  assert.strictEqual(r.code, 200);
});

test('stale carrier events preserve the exact label as well as the normalized status', () => {
  const e = { status: 'awb', scans: [] };
  applyShipmentEvent(e, {
    ...SAMPLE,
    current_status: 'DELIVERED',
    current_timestamp: '24 05 2023 14:00:00',
    scans: [],
  });
  applyShipmentEvent(e, SAMPLE);
  assert.strictEqual(e.status, 'delivered');
  assert.strictEqual(e.currentStatus, 'DELIVERED');
});
test('NDR equivalent webhook/tracking payloads and retries count one attempt', () => {
  const e = { status: 'awb', scans: [] };
  const ndr = { ...SAMPLE, current_status: 'UNDELIVERED', ndr_reason: 'Not available', scans: [] };
  applyShipmentEvent(e, ndr);
  applyShipmentEvent(e, ndr);
  applyShipmentEvent(e, { ...ndr, ndr_reason: undefined, activity: 'Another representation' });
  assert.strictEqual(e.ndrCount, 1);
  applyShipmentEvent(e, { ...ndr, current_timestamp: '24 05 2023 14:00:00' });
  assert.strictEqual(e.ndrCount, 2);
  applyShipmentEvent(e, ndr);
  assert.strictEqual(e.ndrCount, 2);
});
test('repeated snapshots without scans record one line per status change, not one per poll', () => {
  const e = { status: 'pushed', scans: [] };
  applyShipmentEvent(e, { current_status: 'NEW' });
  applyShipmentEvent(e, { current_status: 'NEW' });
  applyShipmentEvent(e, { current_status: 'NEW' });
  assert.strictEqual(e.scans.length, 1);
  applyShipmentEvent(e, { current_status: 'PICKUP SCHEDULED' });
  assert.strictEqual(e.scans.length, 2);
});
test('out for delivery is not delivered and RTO cannot become forward delivered', () => {
  const e = { status: 'awb', scans: [] };
  applyShipmentEvent(e, { current_status: 'OUT FOR DELIVERY' });
  assert.strictEqual(e.status, 'out_for_delivery');
  assert.strictEqual(e.deliveredAt, undefined);
  e.status = 'rto_delivered';
  e.currentStatus = 'RTO DELIVERED';
  applyShipmentEvent(e, { current_status: 'DELIVERED' });
  assert.strictEqual(e.status, 'rto_delivered');
  assert.strictEqual(e.currentStatus, 'RTO DELIVERED');
});
test('sanitizer drops secrets, bounds arrays and preserves boolean return flags', () => {
  const clean = sanitizeShipmentEvent({
    ...SAMPLE,
    email: 'private',
    token: 'secret',
    is_return: true,
    scans: Array.from({ length: 250 }, () => ({ status: 'X', email: 'private' })),
  });
  assert.strictEqual(clean.email, undefined);
  assert.strictEqual(clean.token, undefined);
  assert.strictEqual(clean.scans.length, 200);
  assert.strictEqual(clean.scans[0].email, undefined);
  const e = { status: 'awb', scans: [] };
  applyShipmentEvent(e, clean);
  assert.strictEqual(e.isReturn, true);
});
test('tracking uses the shared ingestion format and rejects empty responses', () => {
  const e = { status: 'awb', awbCode: 'test', scans: [] };
  applyShipmentEvent(
    e,
    trackingToEvent(
      {
        tracking_data: {
          track_status: 1,
          shipment_status: 18,
          shipment_track: [{ current_status: 'IN TRANSIT' }],
          shipment_track_activities: SAMPLE.scans,
        },
      },
      e,
    ),
  );
  assert.strictEqual(e.status, 'shipped');
  assert.strictEqual(e.currentStatus, 'IN TRANSIT');
  for (const data of [{}, { tracking_data: {} }, { tracking_data: { track_status: 0 } }])
    assert.throws(() => trackingToEvent(data, e));
});
test('webhook auth fails closed and mock bypass is never allowed in production', () => {
  const keys = ['SHIPROCKET_WEBHOOK_TOKEN', 'SHIPROCKET_MOCK_MODE', 'NODE_ENV'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  // The guard hands `next` an AppError (status on the error) or calls it clean.
  const run = () => {
    const out = { passed: 0, status: null };
    authenticateShipmentWebhook({ get: () => '' }, {}, (e) => {
      if (e) out.status = e.status;
      else out.passed++;
    });
    return out;
  };
  try {
    delete process.env.SHIPROCKET_WEBHOOK_TOKEN;
    delete process.env.SHIPROCKET_MOCK_MODE;
    process.env.NODE_ENV = 'development';
    assert.strictEqual(run().status, 503);
    process.env.SHIPROCKET_MOCK_MODE = 'true';
    assert.strictEqual(run().passed, 1);
    process.env.NODE_ENV = 'production';
    const prod = run();
    assert.strictEqual(prod.status, 503);
    assert.strictEqual(prod.passed, 0);
  } finally {
    for (const k of keys)
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
  }
});
test('persistence failure is not acknowledged; persisted ingestion failure is queued', async () => {
  const enqueue = sync.enqueueShipmentEvent,
    processEvent = sync.processShipmentEvent;
  try {
    sync.enqueueShipmentEvent = async () => {
      throw new Error('db offline');
    };
    // The route captured the functions at module load; load an isolated route for each failure.
    const reload = () => {
      const isolated = { ...ctx, module: { exports: {} } };
      vm.runInNewContext(fs.readFileSync(filename, 'utf8'), isolated, { filename });
      return isolated.module.exports.handleShipmentWebhook;
    };
    let handler = reload();
    await assert.rejects(
      handler(
        { body: SAMPLE, get: () => 'test-token-123' },
        {
          json() {
            assert.fail();
          },
        },
      ),
      /db offline/,
    );
    sync.enqueueShipmentEvent = async () => ({ _id: 'saved', state: 'pending' });
    sync.processShipmentEvent = async () => {
      throw new Error('busy');
    };
    handler = reload();
    let body;
    await handler(
      { body: SAMPLE, get: () => 'test-token-123' },
      {
        json(b) {
          body = b;
        },
      },
    );
    assert.strictEqual(body.queued, true);
  } finally {
    sync.enqueueShipmentEvent = enqueue;
    sync.processShipmentEvent = processEvent;
  }
});
