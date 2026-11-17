const assert = require('node:assert/strict');
const {
  weekBounds,
  weekFromKey,
  sellerLine,
  totals,
  courierChargeFromAwb,
  courierChargeFromRate,
  inTransitFilter,
  IN_TRANSIT_STATUSES,
} = require('../src/modules/payouts/payout-math');

test('weeks run Monday 00:00 IST to the next Monday, keyed by the Monday', () => {
  // Wed 24 Sep 2026 10:00 IST = 04:30Z
  const w = weekBounds(new Date('2026-09-24T04:30:00Z'));
  assert.equal(w.key, '2026-09-21');
  assert.equal(w.start.toISOString(), '2026-09-20T18:30:00.000Z'); // Mon 00:00 IST
  assert.equal(w.end.toISOString(), '2026-09-27T18:30:00.000Z');
  // Sunday 23:30 IST still belongs to the same week; Monday 00:30 IST to the next.
  assert.equal(weekBounds(new Date('2026-09-27T18:00:00Z')).key, '2026-09-21');
  assert.equal(weekBounds(new Date('2026-09-27T19:00:00Z')).key, '2026-09-28');
  assert.equal(weekFromKey('2026-09-23').key, '2026-09-21');
  assert.equal(weekFromKey('nope'), null);
});

const A = 'aaaaaaaaaaaaaaaaaaaaaaaa',
  B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const order = {
  _id: 'o1',
  orderNumber: 'TIN-1',
  paymentMethod: 'online',
  itemsTotal: 4000,
  gatewayFee: { fee: 94.4, tax: 14.4, total: 94.4 },
  items: [
    { seller: A, subtotal: 3000 },
    { seller: B, subtotal: 1000 },
  ],
  sellerShipments: [
    {
      seller: A,
      kind: 'forward',
      status: 'delivered',
      deliveredAt: new Date('2026-09-22T05:00:00Z'),
      awbCourier: 'Delhivery',
      courierCharge: { total: 85 },
    },
    { seller: B, kind: 'forward', status: 'delivered', deliveredAt: new Date('2026-09-22T05:00:00Z') },
  ],
  returnRequests: [
    { seller: A, refundStatus: 'completed', refundAmount: 500 },
    { seller: B, refundStatus: 'requested', refundAmount: 1000 },
  ],
};

test('seller net = items − courier − gateway share − completed refunds', () => {
  const a = sellerLine(order, A);
  assert.equal(a.itemTotal, 3000);
  assert.equal(a.courierCharge, 85);
  assert.equal(a.gatewayCharge, 70.8); // 94.4 × 3000/4000
  assert.equal(a.refunds, 500);
  assert.equal(a.net, 3000 - 85 - 70.8 - 500);
  assert.deepEqual(a.flags, []);
  const b = sellerLine(order, B);
  assert.equal(b.courierCharge, null);
  assert.deepEqual(b.flags, ['courier_charge_missing']);
  assert.equal(b.gatewayCharge, 23.6);
  assert.equal(b.refunds, 0); // requested, not completed
  assert.equal(b.net, 1000 - 23.6);
  const t = totals([a, b]);
  assert.equal(t.orders, 2);
  assert.equal(t.missing, 1);
  assert.equal(t.net, a.net + b.net);
});

test('COD orders carry no gateway charge; missing Razorpay fee is flagged on online orders', () => {
  const cod = sellerLine({ ...order, paymentMethod: 'cod', gatewayFee: undefined }, A);
  assert.equal(cod.gatewayCharge, 0);
  assert.deepEqual(cod.flags, []);
  const online = sellerLine({ ...order, gatewayFee: undefined }, A);
  assert.equal(online.gatewayCharge, 0);
  assert.deepEqual(online.flags, ['gateway_fee_missing']);
});

test('courier charge is read from the AWB payload, else from the rate row', () => {
  assert.deepEqual(
    { ...courierChargeFromAwb({ freight_charges: '72.5', cod_charges: 35 }), capturedAt: null },
    { freight: 72.5, cod: 35, total: 107.5, source: 'shiprocket-awb', capturedAt: null },
  );
  assert.equal(courierChargeFromAwb({ awb_code: 'X' }), null);
  assert.equal(courierChargeFromRate({ rate: 80, cod_charges: 0 }).total, 80);
  assert.equal(courierChargeFromRate(undefined), null);
});

test('in-transit parcels are those with an AWB between shipped and delivered', () => {
  const f = inTransitFilter('abc').sellerShipments.$elemMatch;
  assert.deepEqual(f.status.$in, ['awb', 'shipped', 'out_for_delivery', 'undelivered']);
  assert.deepEqual(f.awbCode, { $ne: '' });
  assert.ok(!IN_TRANSIT_STATUSES.includes('delivered') && !IN_TRANSIT_STATUSES.includes('cancelled'));
});

test('delivery the customer paid is credited back, cancelling the courier bill', () => {
  const order = {
    _id: 'o1',
    orderNumber: 'TIN-1',
    paymentMethod: 'online',
    itemsTotal: 1000,
    items: [{ seller: 's1', subtotal: 1000 }],
    sellerShipments: [
      { seller: 's1', kind: 'forward', status: 'delivered', awbCourier: 'Delhivery', courierCharge: { total: 123.72 } },
    ],
    delivery: [{ seller: 's1', amount: 123.72, courierName: 'Delhivery' }],
    gatewayFee: { total: 23.6 },
  };
  const line = sellerLine(order, 's1');
  assert.equal(line.deliveryCollected, 123.72);
  // items − gateway; the courier charge and the collected delivery cancel.
  assert.equal(line.net, 976.4);

  // Same order without the customer paying: the courier bill comes off.
  const absorbed = sellerLine({ ...order, delivery: [] }, 's1');
  assert.equal(absorbed.deliveryCollected, 0);
  assert.equal(absorbed.net, 852.68);
});
