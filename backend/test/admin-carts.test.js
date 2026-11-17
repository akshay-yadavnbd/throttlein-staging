const assert = require('node:assert/strict');
const { cartSummary, pipeline } = require('../src/modules/customers/admin-carts.service')._internals;
test('cart summary keeps stable references, variants, quantities and safe contact fields', () => {
  const cart = cartSummary({
    _id: 'abc123',
    customer: { name: 'Buyer', email: 'buyer@example.test' },
    items: [
      {
        product: {
          _id: 'p1',
          name: 'Jacket',
          price: 100,
          status: 'active',
          stock: 10,
          variants: [{ size: 'XL', color: 'Black', price: 120, stock: 3 }],
        },
        size: 'XL',
        color: 'Black',
        quantity: 2,
      },
    ],
  });
  assert.equal(cart.reference, 'CART-ABC123');
  assert.equal(cart.estimatedValue, 240);
  assert.equal(cart.quantity, 2);
  assert.equal(cart.items[0].unitPrice, 120);
  assert.equal(cart.items[0].available, true);
});
test('deleted products retain snapshot names and are marked unavailable', () => {
  const cart = cartSummary({
    _id: 'a',
    items: [{ product: null, snapshot: { name: 'Deleted jacket', price: 90 }, quantity: 1 }],
  });
  assert.equal(cart.items[0].name, 'Deleted jacket');
  assert.equal(cart.items[0].available, false);
  assert.equal(cart.estimatedValue, 90);
});
test('list excludes empty carts and deleted users, and uses bounded pagination', () => {
  const { stages, page, limit } = pipeline({ page: '-2' });
  assert.equal(page, 1);
  assert.equal(limit, 25);
  assert.deepEqual(stages[0], { $match: { 'items.0': { $exists: true } } });
  assert.deepEqual(stages[2], { $unwind: '$customer' });
  assert.equal(stages[1].$lookup.pipeline[0].$project.password, undefined);
  assert.equal(pipeline({ page: '999999' }).page, 10000);
});
test('search treats regex operators literally and supports cart reference IDs', () => {
  const search = pipeline({ q: 'a.*' }).stages[3].$match.$or[0]['customer.name'];
  assert.ok(search.test('a.*'));
  assert.ok(!search.test('anything'));
  const refs = pipeline({ q: 'CART-507F1F77BCF86CD799439011' }).stages[3].$match.$or;
  assert.equal(String(refs.at(-1)._id), '507f1f77bcf86cd799439011');
});
test('24 hour filter reflects stored cart updates rather than assumed abandonment', () => {
  const date = pipeline({ inactive: '24h' }).stages[0].$match.updatedAt.$lte;
  assert.ok(Math.abs(Date.now() - date.getTime() - 86400000) < 1000);
});
test('cart feed requires customer permission', () => {
  const { requirePermission } = require('../src/middleware/auth');
  for (const user of [{ role: 'customer' }, { role: 'staff', permissions: ['orders'] }]) {
    let error;
    requirePermission('customers')({ user }, {}, (err) => {
      error = err;
    });
    assert.ok(error);
    assert.equal(error.status, 403);
  }
});
test('removed size or color cannot be shown as available', () => {
  const cart = cartSummary({
    _id: 'a',
    items: [
      {
        product: { name: 'Jacket', status: 'active', price: 10, stock: 10, variants: [{ size: 'S', stock: 10 }] },
        size: 'XL',
        quantity: 1,
      },
    ],
  });
  assert.equal(cart.items[0].available, false);
});
