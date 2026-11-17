const assert = require('node:assert/strict');
const { resolveSelections, round2 } = require('../src/modules/customers/delivery-quote.service');

const group = (over = {}) => ({
  sellerId: 's1',
  sellerName: 'Revv Gearz',
  customerPays: true,
  itemTotal: 1000,
  weightKg: 0.5,
  error: '',
  couriers: [
    { id: 1, name: 'Delhivery', rate: 80, etd: '3 days' },
    { id: 2, name: 'Bluedart', rate: 110, etd: '2 days' },
  ],
  ...over,
});

test('the customer’s pick is charged at the server’s rate, not the client’s', () => {
  const r = resolveSelections([group()], { s1: 2 });
  assert.equal(r.total, 110);
  assert.equal(r.selections[0].courierName, 'Bluedart');
  assert.equal(r.selections[0].chosen, true);
});

test('no pick (or a courier that vanished) falls back to the cheapest', () => {
  assert.equal(resolveSelections([group()], {}).total, 80);
  const stale = resolveSelections([group()], { s1: 999 });
  assert.equal(stale.total, 80);
  assert.equal(stale.selections[0].chosen, false);
});

test('a seller who absorbs delivery costs the customer nothing', () => {
  const r = resolveSelections([group({ customerPays: false, couriers: [] })], {});
  assert.equal(r.total, 0);
  assert.equal(r.selections.length, 0);
});

test('several sellers each contribute their own parcel’s rate', () => {
  const b = group({
    sellerId: 's2',
    sellerName: 'Moto Parts',
    couriers: [{ id: 5, name: 'Ekart', rate: 60, etd: '4 days' }],
  });
  const r = resolveSelections([group(), b], { s1: 2, s2: 5 });
  assert.equal(r.total, 170);
  assert.equal(r.selections.length, 2);
});

test('an unquotable seller stops the order with a readable reason', () => {
  const r = resolveSelections([group({ error: 'No courier delivers to your pincode from this seller.' })], {});
  assert.match(r.error, /Revv Gearz: No courier/);
  assert.equal(r.total, 0);
});

test('rounding stays at paise', () => {
  assert.equal(round2(123.716), 123.72);
  assert.equal(resolveSelections([group({ couriers: [{ id: 1, name: 'X', rate: 40.555 }] })], {}).total, 40.56);
});
