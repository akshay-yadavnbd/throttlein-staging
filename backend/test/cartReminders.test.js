/**
 * Abandoned-cart reminders — schedule, eligibility, email content and the
 * unsubscribe flow. Runs against an in-memory MongoDB; SMTP is stubbed, so
 * no real email is sent.
 *
 *   npm run test:integration   (vitest, integration project)
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = 'cart-reminder-test-secret-'.repeat(3);
process.env.DISABLE_S3 = 'true';
process.env.REDIS_DISABLED = 'true';
process.env.CART_REMINDER_DELAYS_MINUTES = '1440,4320,10080';
process.env.PUBLIC_API_URL = 'https://api.example.test/api';
process.env.FRONTEND_ORIGIN = 'https://shop.example.test';

const Cart = require('../src/modules/customers/cart.model');
const Order = require('../src/modules/orders/order.model');
const User = require('../src/models/User');
const Product = require('../src/modules/products/product.model');
const reminders = require('../src/modules/customers/cart-reminders.service');
const { markCartActivity, runCartReminderCycle, verifyUnsubscribeToken, _internals } = reminders;

const id = () => new mongoose.Types.ObjectId();
const MIN = 60000,
  HOUR = 60 * MIN;
let mongo, outbox;
const sendMail = async (msg) => {
  outbox.push(msg);
};
const run = (now, extra = {}) => runCartReminderCycle({ now, sendMail, imageUrl: (s) => s, ...extra });

async function user(fields = {}) {
  const row = {
    _id: id(),
    name: 'Asha Rider',
    email: `rider-${id()}@example.test`,
    role: 'customer',
    status: 'approved',
    ...fields,
  };
  await User.collection.insertOne(row);
  return row;
}
async function product(fields = {}) {
  const row = {
    _id: id(),
    name: 'Carbon Helmet',
    slug: 'helmet-' + id(),
    category: id(),
    seller: id(),
    price: 4999,
    stock: 5,
    status: 'active',
    images: ['https://cdn.example.test/h.png'],
    variants: [],
    ...fields,
  };
  await Product.collection.insertOne(row);
  return row;
}
/** A cart the shopper last edited at `at` — goes through markCartActivity like the real controller. */
async function cartFor(u, products, at) {
  const cart = new Cart({
    user: u._id,
    items: products.map((p) => ({ product: p._id, quantity: 1, snapshot: { name: p.name, price: p.price } })),
  });
  markCartActivity(cart, at);
  await cart.save();
  return cart;
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({
    binary: { downloadDir: path.join(os.tmpdir(), 'throttlein-mongo-binaries') },
    instance: { ip: '127.0.0.1' },
  });
  await mongoose.connect(mongo.getUri(), { dbName: 'throttlein_cart_reminder_test' });
  await Promise.all([Cart.init(), Order.init(), User.init(), Product.init()]);
});
afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});
beforeEach(async () => {
  outbox = [];
  await Promise.all([Cart.deleteMany({}), Order.deleteMany({}), User.deleteMany({}), Product.deleteMany({})]);
});

/* ─── pure logic ─────────────────────────────────────────────────── */

const THREE = [24 * HOUR, 72 * HOUR, 168 * HOUR];
const D1 = 24 * HOUR; // first reminder
test('delays come from env, sorted, and fall back to 24h, 3d, 7d', () => {
  assert.deepEqual(_internals.reminderDelaysMs(), THREE);
  const prev = process.env.CART_REMINDER_DELAYS_MINUTES;
  process.env.CART_REMINDER_DELAYS_MINUTES = '120, 30, junk';
  assert.deepEqual(_internals.reminderDelaysMs(), [30 * MIN, 120 * MIN]);
  process.env.CART_REMINDER_DELAYS_MINUTES = '';
  assert.deepEqual(_internals.reminderDelaysMs(), THREE);
  process.env.CART_REMINDER_DELAYS_MINUTES = prev;
});

test('cart activity schedules the first reminder; an empty bag schedules nothing', () => {
  const t0 = new Date('2026-10-23T10:00:00Z');
  const cart = { items: [{}], reminderStage: 2 };
  markCartActivity(cart, t0);
  assert.equal(cart.reminderStage, 0);
  assert.equal(cart.reminderNextAt.toISOString(), '2026-10-24T10:00:00.000Z');
  const empty = { items: [] };
  markCartActivity(empty, t0);
  assert.equal(empty.reminderNextAt, null);
});

test('unsubscribe tokens verify only for the user they were issued to', () => {
  const a = String(id()),
    b = String(id());
  const t = _internals.unsubscribeToken(a);
  assert.ok(verifyUnsubscribeToken(a, t));
  assert.ok(!verifyUnsubscribeToken(b, t));
  assert.ok(!verifyUnsubscribeToken(a, t.slice(0, -1) + (t.endsWith('A') ? 'B' : 'A')));
  assert.ok(!verifyUnsubscribeToken('not-an-id', t));
  assert.ok(!verifyUnsubscribeToken(a, undefined));
  assert.match(
    _internals.unsubscribeUrl(a),
    /^https:\/\/api\.example\.test\/api\/email\/unsubscribe\/cart-reminders\?u=/,
  );
});

test('email escapes product names and shows at most 3 lines', () => {
  const lines = Array.from({ length: 5 }, (_, i) => ({
    name: i ? `Item ${i}` : '<script>x</script>',
    image: '',
    options: 'L',
    quantity: 1,
    price: 100,
  }));
  const mail = _internals.buildReminderEmail({ name: 'A', lines, stage: 0, cartUrl: 'https://shop/cart' });
  assert.ok(!mail.html.includes('<script>'));
  assert.ok(mail.html.includes('&lt;script&gt;'));
  assert.ok(mail.html.includes('+ 2 more items'));
  assert.ok(mail.html.includes('₹500'));
  assert.ok(mail.text.includes('https://shop/cart'));
  assert.ok(!/remind me later/i.test(mail.html), 'remind-me-later removed');
  assert.ok(!/unsubscribe/i.test(mail.html), 'no unsubscribe link in the body');
  assert.ok(mail.html.includes('Your bag’s still holding these for you'), 'first-email heading');
  assert.ok(mail.html.includes('alt="THROTTLEIN"'), 'logo header present');
  assert.ok(mail.html.includes('/images/throttlein-logo.png'));
});

test('logo never points at localhost (email clients cannot load it)', () => {
  const prev = process.env.FRONTEND_ORIGIN;
  process.env.FRONTEND_ORIGIN = 'http://localhost:3000';
  assert.equal(_internals.brandLogoUrl(), 'https://throttlein.com/images/throttlein-logo.png');
  process.env.FRONTEND_ORIGIN = prev;
  assert.equal(_internals.brandLogoUrl(), 'https://shop.example.test/images/throttlein-logo.png');
});

/* ─── worker against MongoDB ─────────────────────────────────────── */

test('sends reminders at 24h, 3 days and 7 days, then stops', async () => {
  const t0 = new Date('2026-10-23T10:00:00Z');
  const u = await user(),
    p = await product();
  await cartFor(u, [p], t0);

  assert.deepEqual(await run(new Date(t0.getTime() + 2 * HOUR)), [], 'nothing after 1 hour any more');
  assert.deepEqual(await run(new Date(t0.getTime() + 23 * HOUR)), []);
  assert.equal(outbox.length, 0, 'nothing before 24h');

  const r1 = await run(new Date(t0.getTime() + 24 * HOUR + MIN));
  assert.equal(r1[0].result, 'sent');
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].to, u.email);
  assert.match(outbox[0].subject, /left something in your bag/);
  assert.ok(outbox[0].html.includes('Carbon Helmet'));
  assert.ok(outbox[0].html.includes('https://shop.example.test/cart'));
  assert.equal(outbox[0].headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');

  assert.deepEqual(await run(new Date(t0.getTime() + 71 * HOUR)), [], 'nothing between day 1 and day 3');
  await run(new Date(t0.getTime() + 72 * HOUR + MIN));
  assert.equal(outbox.length, 2);
  assert.match(outbox[1].subject, /Still thinking it over/);

  assert.deepEqual(await run(new Date(t0.getTime() + 167 * HOUR)), [], 'nothing between day 3 and day 7');
  await run(new Date(t0.getTime() + 168 * HOUR + MIN));
  assert.equal(outbox.length, 3);
  assert.match(outbox[2].subject, /Final call/);

  assert.deepEqual(await run(new Date(t0.getTime() + 30 * 24 * HOUR)), []);
  const cart = await Cart.findOne({ user: u._id });
  assert.equal(cart.reminderSentCount, 3);
  assert.equal(cart.reminderStage, 3);
  assert.equal(cart.reminderNextAt, null);
});

test('the final reminder always uses the "last reminder" copy', () => {
  const lines = [{ name: 'X', image: '', options: '', quantity: 1, price: 1 }];
  const b = (stage, isLast) => _internals.buildReminderEmail({ name: 'A', lines, stage, isLast, cartUrl: 'c' }).subject;
  assert.match(b(2, true), /Final call/);
  assert.match(b(4, true), /Final call/);
  assert.doesNotMatch(b(2, false), /Final call/);
  assert.doesNotMatch(b(0, true), /Final call/, 'a single-reminder setup still opens with the first email');
});

test('editing the cart restarts the clock', async () => {
  const t0 = new Date('2026-10-23T10:00:00Z');
  const u = await user(),
    p = await product(),
    q = await product({ name: 'Riding Gloves' });
  const cart = await cartFor(u, [p], t0);
  await run(new Date(t0.getTime() + D1 + MIN));
  assert.equal(outbox.length, 1);

  const t1 = new Date(t0.getTime() + 25 * HOUR);
  cart.items.push({ product: q._id, quantity: 1 });
  markCartActivity(cart, t1);
  await cart.save();

  assert.deepEqual(await run(new Date(t1.getTime() + 23 * HOUR)), []);
  await run(new Date(t1.getTime() + D1 + MIN));
  assert.equal(outbox.length, 2);
  assert.match(outbox[1].subject, /left something/, 'back to reminder 1');
  assert.ok(outbox[1].html.includes('Riding Gloves'));
});

test('no reminder after the shopper places an order', async () => {
  const t0 = new Date('2026-10-23T10:00:00Z');
  const u = await user(),
    p = await product();
  await cartFor(u, [p], t0);
  await Order.collection.insertOne({ _id: id(), user: u._id, createdAt: new Date(t0.getTime() + 10 * MIN) });
  const r = await run(new Date(t0.getTime() + D1 + MIN));
  assert.equal(r[0].reason, 'ordered');
  assert.equal(outbox.length, 0);
  assert.equal((await Cart.findOne({ user: u._id })).reminderNextAt, null);
});

test('opted-out, suspended and staff users are never emailed', async () => {
  const t0 = new Date('2026-10-23T10:00:00Z');
  const p = await product();
  await cartFor(await user({ cartRemindersOptOut: true }), [p], t0);
  await cartFor(await user({ status: 'suspended' }), [p], t0);
  await cartFor(await user({ role: 'staff' }), [p], t0);
  const r = await run(new Date(t0.getTime() + D1 + MIN));
  assert.equal(outbox.length, 0);
  assert.deepEqual(r.map((x) => x.reason).sort(), ['ineligible_user', 'ineligible_user', 'opted_out']);
});

test('out-of-stock or unpublished items are left out; an all-sold-out bag is skipped', async () => {
  const t0 = new Date('2026-10-23T10:00:00Z');
  const u = await user();
  const ok = await product({ name: 'In Stock Boots' });
  const gone = await product({ name: 'Sold Out Jacket', stock: 0 });
  const hidden = await product({ name: 'Unpublished Visor', status: 'draft' });
  await cartFor(u, [ok, gone, hidden], t0);
  await run(new Date(t0.getTime() + D1 + MIN));
  assert.equal(outbox.length, 1);
  assert.ok(outbox[0].html.includes('In Stock Boots'));
  assert.ok(!outbox[0].html.includes('Sold Out Jacket'));
  assert.ok(!outbox[0].html.includes('Unpublished Visor'));

  const u2 = await user();
  await cartFor(u2, [gone], t0);
  const r = await run(new Date(t0.getTime() + D1 + 2 * MIN));
  assert.equal(r[0].reason, 'nothing_buyable');
  assert.equal(outbox.length, 1);
});

test('SMTP failure retries later instead of skipping the reminder', async () => {
  const t0 = new Date('2026-10-23T10:00:00Z');
  const u = await user(),
    p = await product();
  await cartFor(u, [p], t0);
  const failing = async () => {
    throw new Error('smtp down');
  };
  const at = new Date(t0.getTime() + D1 + MIN);
  const r = await runCartReminderCycle({ now: at, sendMail: failing, imageUrl: (s) => s });
  assert.equal(r[0].result, 'failed');
  const cart = await Cart.findOne({ user: u._id });
  assert.equal(cart.reminderStage, 0);
  assert.ok(cart.reminderNextAt > at);
  await run(new Date(at.getTime() + 31 * MIN));
  assert.equal(outbox.length, 1);
});

test('a cart whose slot passed long ago (worker was off) is not emailed late', async () => {
  const t0 = new Date('2026-10-01T10:00:00Z');
  const u = await user(),
    p = await product();
  await cartFor(u, [p], t0);
  const r = await run(new Date('2026-10-20T10:00:00Z'));
  assert.equal(r[0].reason, 'stale');
  assert.equal(outbox.length, 0);
});

test('worker does not bump updatedAt (admin "inactive 24h" filter stays truthful)', async () => {
  const t0 = new Date('2026-10-23T10:00:00Z');
  const u = await user(),
    p = await product();
  const cart = await cartFor(u, [p], t0);
  const before = (await Cart.findById(cart._id)).updatedAt.getTime();
  await run(new Date(t0.getTime() + D1 + MIN));
  assert.equal((await Cart.findById(cart._id)).updatedAt.getTime(), before);
});

/* ─── unsubscribe routes ─────────────────────────────────────────── */

test('unsubscribe: GET only confirms, POST opts out and cancels pending reminders', async () => {
  const express = require('express');
  const app = express();
  app.use('/api/email', require('../src/modules/customers').routes.emailPreferences);
  const server = await new Promise((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/email/unsubscribe/cart-reminders`;
  try {
    const t0 = new Date('2026-10-23T10:00:00Z');
    const u = await user(),
      p = await product();
    await cartFor(u, [p], t0);
    const qs = `?u=${u._id}&t=${_internals.unsubscribeToken(u._id)}`;

    const bad = await fetch(`${base}?u=${u._id}&t=wrong`);
    assert.equal(bad.status, 400);

    const get = await fetch(base + qs);
    assert.equal(get.status, 200);
    assert.ok((await get.text()).includes('<form method="post"'));
    assert.equal((await User.findById(u._id)).cartRemindersOptOut, false, 'GET must not unsubscribe');

    const post = await fetch(base + qs, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
    });
    assert.equal(post.status, 200);
    assert.equal((await User.findById(u._id)).cartRemindersOptOut, true);
    assert.equal((await Cart.findOne({ user: u._id })).reminderNextAt, null);
    assert.deepEqual(await run(new Date(t0.getTime() + D1 + MIN)), []);
  } finally {
    server.close();
  }
});

test('unsubscribe stays available via the List-Unsubscribe header only', async () => {
  const t0 = new Date('2026-10-23T10:00:00Z');
  const u = await user(),
    p = await product();
  await cartFor(u, [p], t0);
  await run(new Date(t0.getTime() + D1 + MIN));
  const m = outbox[0];
  assert.ok(m.headers['List-Unsubscribe'].includes('/api/email/unsubscribe/cart-reminders?u=' + u._id));
  assert.ok(!/remind-later/.test(m.html + m.text));
});
