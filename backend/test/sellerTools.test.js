/**
 * Seller tools (unit project): the rules behind settlements, the in-use
 * guard on seller media deletes, and admin onboarding reminders — each
 * against stubbed models, so nothing touches a database or sends mail.
 */
const assert = require('node:assert/strict');
const Settlement = require('../src/modules/payouts/settlement.model');
const Order = require('../src/modules/orders/order.model');
const SellerMedia = require('../src/modules/seller-media/seller-media.model');
const Product = require('../src/modules/products/product.model');
const User = require('../src/models/User');
const mail = require('../src/config/mail');
const upload = require('../src/middleware/upload');
const math = require('../src/modules/payouts/payout-math');
const payouts = require('../src/modules/payouts/payouts.service');
const media = require('../src/modules/seller-media/seller-media.service');

const SELLER = '507f1f77bcf86cd799439011';
const admin = { _id: '507f1f77bcf86cd799439099', email: 'ops@example.com' };
const lastWeekKey = () => math.weekBounds(new Date(math.weekBounds(new Date()).start.getTime() - 86400000)).key;
const lean = (rows) => ({ select: () => ({ lean: async () => rows }) });

/* ── settlements ──────────────────────────────────────────────────────── */

test('a settlement needs a finished week, no earlier settlement, deliveries and a UTR', async () => {
  const current = math.weekBounds(new Date()).key;
  await assert.rejects(payouts.pay(admin, { sellerId: SELLER, week: current, utr: 'X' }), /still in progress/);
  await assert.rejects(payouts.pay(admin, { sellerId: 'nope', week: lastWeekKey() }), /sellerId and week/);

  vi.spyOn(Settlement, 'exists').mockImplementation(async () => ({ _id: 's1' }));
  await assert.rejects(
    payouts.pay(admin, { sellerId: SELLER, week: lastWeekKey(), utr: 'X' }),
    (e) => e.status === 409,
  );

  vi.spyOn(Settlement, 'exists').mockImplementation(async () => null);
  vi.spyOn(Order, 'find').mockImplementation(() => lean([]));
  await assert.rejects(
    payouts.pay(admin, { sellerId: SELLER, week: lastWeekKey(), utr: 'X' }),
    /Nothing was delivered/,
  );
});

test('a courier charge on a parcel already inside a paid settlement cannot be changed', async () => {
  const order = { _id: 'o1', sellerShipments: [{ seller: SELLER, kind: 'forward' }], save: vi.fn() };
  vi.spyOn(Order, 'findOne').mockImplementation(async () => order);
  vi.spyOn(Settlement, 'exists').mockImplementation(async () => ({ _id: 's1' }));
  await assert.rejects(payouts.setCourierCharge('TIN-1001', SELLER, { total: 80 }), (e) => e.status === 409);
  assert.equal(order.save.mock.calls.length, 0);
  await assert.rejects(payouts.setCourierCharge('TIN-1001', SELLER, { total: -5 }), /courier charge in rupees/);
});

/* ── seller media ─────────────────────────────────────────────────────── */

test('an image a product still shows is never deleted: single delete answers IN_USE, bulk delete skips it', async () => {
  const del = vi.spyOn(upload, 'deleteKey').mockImplementation(async () => {});
  const used = { _id: 'm1', key: 'sellers/a/used.jpg', deleteOne: vi.fn() };
  const free = { _id: 'm2', key: 'sellers/a/free.jpg', deleteOne: vi.fn() };
  vi.spyOn(SellerMedia, 'findOne').mockImplementation(async (filter) => {
    assert.equal(filter.seller, SELLER, 'scoped to the seller');
    return used;
  });
  vi.spyOn(Product, 'find').mockImplementation((filter) => {
    assert.equal(filter.seller, SELLER, 'product lookups are scoped to the seller too');
    return lean([
      { _id: 'p1', name: 'Jacket', slug: 'jacket', images: [], colorImages: [{ color: 'Black', images: [used.key] }] },
    ]);
  });
  await assert.rejects(
    media.remove(SELLER, 'm1'),
    (e) => e.code === 'IN_USE' && e.details.products[0].name === 'Jacket',
  );
  assert.equal(used.deleteOne.mock.calls.length, 0);

  vi.spyOn(SellerMedia, 'find').mockImplementation(async () => [used, free]);
  const deleteMany = vi.spyOn(SellerMedia, 'deleteMany').mockImplementation(async () => ({ deletedCount: 1 }));
  const result = await media.bulkRemove(SELLER, ['m1', 'm2']);
  assert.deepEqual(result, {
    deleted: 1,
    blocked: [{ id: 'm1', key: used.key, productNames: ['Jacket'] }],
    requested: 2,
  });
  assert.deepEqual(
    del.mock.calls.map((c) => c[0]),
    [free.key],
  );
  assert.deepEqual(deleteMany.mock.calls[0][0]._id.$in, ['m2']);
});

/* ── onboarding reminders ─────────────────────────────────────────────── */

test('onboarding reminders: refused for a seller who is not stalled or was reminded today; sent and recorded otherwise', async () => {
  const reminders = require('../src/modules/admin/onboarding-reminders.service');
  const send = vi.spyOn(mail, 'sendMail').mockImplementation(async () => {});
  const seller = (fields) => ({
    role: 'seller',
    email: 's@example.com',
    name: 'Ravi',
    save: vi.fn(async () => {}),
    ...fields,
  });

  vi.spyOn(User, 'findOne').mockImplementation(async () => seller({ emailVerified: true, kyc: { status: 'pending' } }));
  await assert.rejects(reminders.sendReminder(SELLER), /awaiting your review/);

  const recent = seller({
    emailVerified: true,
    kyc: { status: 'not_started' },
    onboardingReminder: { lastSentAt: new Date(), count: 1 },
  });
  vi.spyOn(User, 'findOne').mockImplementation(async () => recent);
  await assert.rejects(reminders.sendReminder(SELLER), (e) => e.status === 429);
  assert.equal(send.mock.calls.length, 0);

  const out = await reminders.sendReminder(SELLER, { force: true });
  assert.equal(out.stage, 'no_kyc');
  assert.equal(send.mock.calls[0][0].to, 's@example.com');
  assert.equal(recent.onboardingReminder.count, 2);
  assert.deepEqual(recent.save.mock.calls[0][0], { validateBeforeSave: false });
});
