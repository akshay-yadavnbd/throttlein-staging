const assert = require('node:assert/strict');
const { validate } = require('../src/middleware/validate');
const { AppError } = require('../src/errors/AppError');
const auth = require('../src/modules/auth/auth.schema');
const orders = require('../src/modules/orders/orders.schema');
const products = require('../src/modules/products/products.schema');
const blog = require('../src/modules/blog/blog.schema');

function run(mw, req) {
  return new Promise((resolve) => mw(req, {}, (err) => resolve(err)));
}

test('replaces body, query and params with the parsed values', async () => {
  const req = { body: { email: '  Vipin@Example.COM ', password: 'p'.repeat(12) }, params: { id: 'TIN-1' } };
  // Express 5 exposes query through a getter; the middleware must still be able to replace it.
  Object.defineProperty(req, 'query', { get: () => ({ page: '2', limit: '50', extra: 'kept' }), configurable: true });
  const err = await run(
    validate({
      body: auth.registerCustomer.pick({ email: true, password: true }),
      query: orders.listQuery,
      params: orders.orderParams,
    }),
    req,
  );
  assert.equal(err, undefined);
  assert.deepEqual(req.body, { email: 'vipin@example.com', password: 'p'.repeat(12) });
  assert.deepEqual(req.query, { page: 2, limit: 50, extra: 'kept' });
  assert.deepEqual(req.params, { id: 'TIN-1' });
});

test('a failure is one AppError with per-field issues and joined sentences', async () => {
  const err = await run(validate({ body: auth.registerSeller }), { body: { name: '', email: 'nope', phone: '12' } });
  assert.ok(err instanceof AppError);
  assert.equal(err.status, 400);
  assert.equal(err.code, 'VALIDATION_FAILED');
  const paths = err.details.issues.map((i) => i.path).sort();
  assert.deepEqual(paths, ['email', 'name', 'phone', 'storeName']);
  assert.match(err.message, /Your name is required/);
  assert.match(err.message, /Store Name is required/);
  assert.match(err.message, /valid email/);
});

test('the route may name the code and sentence the client already keys off', async () => {
  const err = await run(
    validate({ body: auth.login }, { code: 'MISSING_FIELDS', message: 'Please enter both your email and password.' }),
    { body: { email: 'a@b.co' } },
  );
  assert.equal(err.code, 'MISSING_FIELDS');
  assert.equal(err.status, 400);
  assert.equal(err.message, 'Please enter both your email and password.');
});

test('legacy shopName satisfies the store-name rule and passes through', async () => {
  const req = { body: { name: 'Sid', shopName: 'Revv', email: 'sid@example.com', phone: '+91 98765 43210' } };
  const err = await run(validate({ body: auth.registerSeller }), req);
  assert.equal(err, undefined);
  assert.equal(req.body.shopName, 'Revv');
});

test('order bodies coerce and bound their values', async () => {
  const req = { body: { courier_id: '12', reschedulePickup: 'true' } };
  assert.equal(await run(validate({ body: orders.ship }), req), undefined);
  assert.deepEqual(req.body, { courier_id: 12, reschedulePickup: true });
  const bad = await run(validate({ body: orders.updateStatus }), { body: { status: 'shipped' } });
  assert.match(bad.message, /Only order confirmation/);
  const noReason = await run(validate({ body: orders.decline }), { body: { reason: 'no' } });
  assert.match(noReason.message, /at least 5 characters/);
});

test('product queries keep unknown keys and reject malformed numbers', async () => {
  const req = { query: { q: ' helmet ', page: '3', minPrice: '100', fit: 'cruiser' } };
  assert.equal(await run(validate({ query: products.listPublicQuery }), req), undefined);
  assert.deepEqual(req.query, { q: 'helmet', page: 3, minPrice: 100, fit: 'cruiser' });
  const bad = await run(validate({ query: products.listPublicQuery }), { query: { limit: 'lots' } });
  assert.match(bad.message, /limit must be between 1 and 300/);
  const bulk = await run(validate({ body: products.bulkStatus }, { message: products.BULK_STATUS_MESSAGE }), {
    body: { ids: [], status: 'live' },
  });
  assert.equal(bulk.message, products.BULK_STATUS_MESSAGE);
  assert.equal(bulk.details.issues.length, 2);
});

// The largest page each real caller asks for. Tightening a cap below these empties a
// page without an error anyone sees (category pages, admin Blogs, the sitemaps).
test('list limits cover what the apps actually request', async () => {
  const ok = (schema, limit) => run(validate({ query: schema }), { query: { limit: String(limit) } });
  assert.equal(await ok(products.listPublicQuery, 300), undefined); // storefront CategoryPage
  assert.equal(await ok(blog.listQuery, 1000), undefined); // admin Blogs COUNTS_LIMIT
  assert.equal(await ok(blog.listQuery, 500), undefined); // sitemaps
  assert.equal(await ok(orders.listQuery, 200), undefined); // seller orders
  assert.ok((await ok(products.listPublicQuery, 301)) instanceof AppError);
});

test('legacy guards hand the error handler an AppError with its status', () => {
  const { requireRole, requirePermission, blockImpersonated } = require('../src/middleware/auth');
  const resolveSite = require('../src/middleware/resolveSite');
  const capture = (mw, req) => {
    let e;
    mw(req, {}, (err) => {
      e = err;
    });
    return e;
  };
  assert.equal(capture(requireRole('seller'), { user: { role: 'customer' } }).status, 403);
  assert.equal(capture(requirePermission('orders'), {}).status, 401);
  assert.equal(capture(blockImpersonated, { impersonation: { adminId: 'x' } }).status, 403);
  const site = capture(resolveSite, { query: { site: 'bogus' }, get: () => undefined });
  assert.equal(site.status, 400);
  assert.match(site.message, /Unknown site/);
});
