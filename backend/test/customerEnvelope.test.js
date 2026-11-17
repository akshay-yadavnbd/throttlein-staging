/**
 * The `{ data, meta }` success envelope on customer endpoints (unit project).
 * The storefront reads them through frontend/lib/api.ts `unwrap`.
 */
const assert = require('node:assert/strict');
const { response } = require('./helpers/controller');
const User = require('../src/models/User');

const customer = { user: { _id: 'customer-1' } };
const addresses = [{ _id: 'a1', label: 'Home', isDefault: true, city: 'Delhi' }];

test('GET /addresses answers { data: { addresses } } with no success flag', async () => {
  vi.spyOn(User, 'findById').mockImplementation(() => {
    const q = Promise.resolve({ addresses });
    q.select = () => q;
    q.lean = () => q;
    return q;
  });
  const { listAddresses: list } = require('../src/modules/customers/customers.controller');
  const res = response();
  await list(customer, res, (e) => {
    throw e;
  });
  assert.deepEqual(res.body, { data: { addresses } });
});

test('POST /checkout/failures answers 202 { data: { recorded } } (the browser ignores the body)', async () => {
  const CheckoutFailure = require('../src/modules/customers/checkout-failure.model');
  vi.spyOn(CheckoutFailure, 'create').mockImplementation(async () => {});
  const { reportCheckoutFailure: report } = require('../src/modules/customers/customers.controller');
  const res = response();
  await report({ ...customer, body: { step: 'address', message: 'No address selected' } }, res, (e) => {
    throw e;
  });
  assert.equal(res.statusCode, 202);
  assert.deepEqual(res.body, { data: { recorded: true } });
});

test('POST /contact answers 202 { data: { received } } — mail is best-effort, the page reads only the status', async () => {
  const mail = require('../src/config/mail');
  const sendMail = vi.spyOn(mail, 'sendMail').mockImplementation(async () => {});
  vi.spyOn(mail, 'readConfig').mockImplementation(() => ({
    user: 'support@example.com',
    from: 'THROTTLEIN <support@example.com>',
  }));
  const { submit } = require('../src/modules/contact/contact.controller');
  const res = response();
  await submit({ body: { fullName: 'Meera', email: 'meera@example.com', message: 'Hi' } }, res, (e) => {
    throw e;
  });
  assert.equal(res.statusCode, 202);
  assert.deepEqual(res.body, { data: { received: true } });
  assert.equal(sendMail.mock.calls.length, 2);
});

test('GET /sellers and /sellers/:id answer { data: { items } } and { data: { seller, products } }', async () => {
  const Product = require('../src/modules/products/product.model');
  const sellerDoc = { _id: '507f1f77bcf86cd799439011', storeName: 'Moto Hub' };
  vi.spyOn(User, 'find').mockImplementation(() => ({ select: () => ({ sort: async () => [sellerDoc] }) }));
  vi.spyOn(User, 'findOne').mockImplementation(() => ({ select: async () => sellerDoc }));
  vi.spyOn(Product, 'find').mockImplementation(() => ({ sort: async () => [{ _id: 'p1' }] }));
  delete require.cache[require.resolve('../src/routes/sellerRoutes')];
  const router = require('../src/routes/sellerRoutes');
  const handler = (routePath) => {
    const layer = router.stack.find((l) => l.route && l.route.path === routePath);
    return layer.route.stack[layer.route.stack.length - 1].handle;
  };
  const list = response();
  await handler('/')({ query: {} }, list, (e) => {
    throw e;
  });
  assert.deepEqual(list.body, { data: { items: [sellerDoc] } });
  const one = response();
  await handler('/:id')({ params: { id: sellerDoc._id } }, one, (e) => {
    throw e;
  });
  assert.deepEqual(one.body, { data: { seller: sellerDoc, products: [{ _id: 'p1' }] } });
});
