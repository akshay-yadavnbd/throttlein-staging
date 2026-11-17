const assert = require('node:assert/strict');
const { lineAvailability, buyable } = require('../src/modules/customers/cart-availability');

const product = (over = {}) => ({ name: 'Helmet', status: 'active', stock: 5, ...over });

test('a line with stock for the asked quantity is buyable', () => {
  const a = lineAvailability({ product: product(), quantity: 2 });
  assert.equal(a.state, 'ok');
  assert.ok(buyable(a));
});

test('sold out, unpublished and deleted products all read as unbuyable', () => {
  assert.equal(lineAvailability({ product: product({ stock: 0 }), quantity: 1 }).state, 'out_of_stock');
  assert.equal(lineAvailability({ product: product({ status: 'out_of_stock' }), quantity: 1 }).state, 'unavailable');
  assert.equal(lineAvailability({ product: null, quantity: 1 }).state, 'unavailable');
  assert.ok(!buyable(lineAvailability({ product: product({ stock: 0 }), quantity: 1 })));
});

test('fewer left than asked is flagged with the number remaining', () => {
  const a = lineAvailability({ product: product({ stock: 2 }), quantity: 3 });
  assert.equal(a.state, 'limited');
  assert.equal(a.stock, 2);
  assert.match(a.message, /Only 2 left/);
});

test('a sold-out size is unbuyable even when other sizes have stock', () => {
  const p = product({
    stock: 5,
    variants: [
      { size: 'S', stock: 0 },
      { size: 'M', stock: 5 },
    ],
  });
  assert.equal(lineAvailability({ product: p, size: 'S', quantity: 1 }).state, 'out_of_stock');
  assert.equal(lineAvailability({ product: p, size: 'M', quantity: 1 }).state, 'ok');
  assert.equal(lineAvailability({ product: p, size: 'XL', quantity: 1 }).state, 'unavailable');
});

test('a de-listed seller makes the line unavailable', () => {
  const p = product({ seller: { status: 'suspended', kyc: { status: 'approved' } } });
  assert.equal(lineAvailability({ product: p, quantity: 1 }).state, 'unavailable');
  const ok = product({ seller: { status: 'approved', kyc: { status: 'approved' } } });
  assert.equal(lineAvailability({ product: ok, quantity: 1 }).state, 'ok');
});

test('online checkout queries offers by seller ID when the cart seller is populated', async () => {
  const mongoose = require('mongoose');
  const SellerOffer = require('../src/modules/offers/seller-offer.model');
  const { loadController, response } = require('./helpers/controller');
  const sellerId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const addressId = new mongoose.Types.ObjectId();
  const seller = { _id: sellerId, status: 'approved', kyc: { status: 'approved' } };
  const address = { _id: addressId, fullName: 'Test Customer', state: 'Uttar Pradesh', pincode: '201306' };
  const user = { _id: userId, addresses: { id: (id) => (String(id) === String(addressId) ? address : null) } };
  const line = { product: product({ _id: new mongoose.Types.ObjectId(), seller, price: 9850 }), quantity: 1 };
  const originalFind = SellerOffer.find.bind(SellerOffer);
  let offerQueries = 0;
  vi.spyOn(SellerOffer, 'find').mockImplementation((filter) => {
    // Exercise real Mongoose casting without connecting to a database.
    const query = originalFind(filter);
    query.cast(SellerOffer);
    assert.deepEqual(filter.seller.$in.map(String), [String(sellerId)]);
    offerQueries++;
    return { lean: async () => [] };
  });
  let chargedAmount;
  const ctx = loadController({
    '../models/User': {
      findById: async () => user,
      find: () => ({ select: () => ({ lean: async () => [seller] }) }),
    },
    '../models/Cart': { findOne: () => ({ populate: async () => ({ items: [line] }) }) },
    // Checkout reads the cart rules and the delivery quote through the customers index; only the quote is stubbed.
    '../modules/customers': {
      ...require('../src/modules/customers'),
      deliveryQuote: { quoteCart: async () => [], resolveSelections: () => ({ selections: [], total: 0 }) },
    },
    '../models/CheckoutIntent': {
      create: async (data) => ({ ...data, _id: new mongoose.Types.ObjectId(), save: async () => {} }),
    },
    '../infrastructure/payments/razorpay': {
      createOrder: async ({ amount }) => {
        chargedAmount = amount;
        return { id: 'order_test', amount, currency: 'INR' };
      },
      keyId: () => 'test_key',
      emiEligible: () => true,
      emiMonthlyFrom: () => 885,
    },
  });
  const res = response();
  await ctx.exports.razorpayInit({ user, body: { addressId: String(addressId) } }, res);
  assert.equal(offerQueries, 1);
  assert.equal(chargedAmount, 985000);
  assert.equal(res.body.data.razorpayOrderId, 'order_test');
  assert.equal(res.body.data.amount, 985000);
});
