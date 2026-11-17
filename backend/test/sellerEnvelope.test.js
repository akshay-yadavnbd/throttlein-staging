/**
 * The `{ data, meta }` success envelope on seller-dashboard endpoints (unit
 * project). The seller dashboard (frontend/lib/api.ts `unwrap`) and the
 * chatbot (src/backend.js `fromEnvelope`) both read these shapes.
 */
const assert = require('node:assert/strict');
const { response } = require('./helpers/controller');
const SellerOffer = require('../src/modules/offers/seller-offer.model');
const Product = require('../src/modules/products/product.model');

/** A query chain that answers `rows` whatever the order of calls. */
function chain(rows) {
  const q = Promise.resolve(rows);
  for (const m of ['select', 'sort', 'skip', 'limit', 'lean', 'populate']) q[m] = () => q;
  return q;
}
const offerDoc = (id) => ({
  _id: id,
  title: 'Diwali 20% off',
  scope: 'all',
  toObject() {
    return { _id: id, title: 'Diwali 20% off', scope: 'all' };
  },
});
const seller = { user: { _id: 'seller-1' } };

beforeEach(() => {
  vi.spyOn(Product, 'countDocuments').mockImplementation(async () => 12);
});

test('GET /seller/offers pages through meta', async () => {
  vi.spyOn(SellerOffer, 'find').mockImplementation(() => chain([offerDoc('o1')]));
  vi.spyOn(SellerOffer, 'countDocuments').mockImplementation(async () => 31);
  const { list } = require('../src/modules/offers/offers.controller');
  const res = response();
  await list({ ...seller, query: { page: '2', limit: '30' } }, res, (e) => {
    throw e;
  });
  assert.deepEqual(res.body.meta, { page: 2, pageSize: 30, totalItems: 31, totalPages: 2 });
  assert.equal(res.body.data.items[0].title, 'Diwali 20% off');
  assert.equal(res.body.data.items[0].catalogSize, 12);
});

test('GET /seller/offers/:id answers { data: { offer } } — the key the edit form reads', async () => {
  vi.spyOn(SellerOffer, 'findOne').mockImplementation(async () => offerDoc('o1'));
  const { getOne } = require('../src/modules/offers/offers.controller');
  const res = response();
  await getOne({ ...seller, params: { id: 'o1' } }, res, (e) => {
    throw e;
  });
  assert.deepEqual(Object.keys(res.body), ['data']);
  assert.equal(res.body.data.offer._id, 'o1');
});

test('DELETE /seller/offers/:id answers 204 with no body', async () => {
  vi.spyOn(SellerOffer, 'deleteOne').mockImplementation(async () => ({ deletedCount: 1 }));
  const { remove } = require('../src/modules/offers/offers.controller');
  const res = {
    ...response(),
    end() {
      this.ended = true;
      return this;
    },
  };
  await remove({ ...seller, params: { id: 'o1' } }, res, (e) => {
    throw e;
  });
  assert.equal(res.statusCode, 204);
  assert.equal(res.body, undefined);
});
