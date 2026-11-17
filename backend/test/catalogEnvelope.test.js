/**
 * The `{ data }` success envelope on the shared catalogue endpoints
 * (categories, brands, the public product list and detail, public reviews),
 * read by the storefront, the admin and the chatbot.
 * The two web apps read them through `envelopeOrLegacy` / `dataOf` in their
 * lib/api.ts, which also accept the older bare bodies, so either side can
 * deploy first. The chatbot flattens every answer in backend.js `fromEnvelope`.
 */
const assert = require('node:assert/strict');
const { response } = require('./helpers/controller');
const Brand = require('../src/modules/catalog/brand.model');
const Category = require('../src/modules/catalog/category.model');
const redisCache = require('../src/utils/redisCache');

const fail = (e) => {
  throw e;
};
const sorted = (rows) => {
  const q = Promise.resolve(rows);
  q.sort = () => q;
  return q;
};
const categoryDoc = (fields) => ({ ...fields, toObject: () => ({ ...fields }) });

/** The controllers destructure their helpers at require time, so spies go in first. */
function fresh(rel) {
  delete require.cache[require.resolve(rel)];
  return require(rel);
}

test('GET /brands answers { data: { items, count } } with no success flag', async () => {
  const items = [{ _id: 'b1', name: 'Rynox', slug: 'rynox' }];
  vi.spyOn(Brand, 'find').mockImplementation(() => sorted(items));
  const { listBrands: list } = fresh('../src/modules/catalog/catalog.controller');
  const res = response();
  await list({ query: {} }, res, fail);
  assert.deepEqual(res.body, { data: { items, count: 1 } });
});

test('DELETE /brands/:id answers 204 with no body', async () => {
  const deleteOne = vi.fn(async () => {});
  vi.spyOn(Brand, 'findById').mockImplementation(async () => ({ _id: 'b1', deleteOne }));
  const { removeBrand: remove } = fresh('../src/modules/catalog/catalog.controller');
  const res = response();
  res.end = vi.fn(() => res);
  await remove({ params: { id: 'b1' } }, res, fail);
  assert.equal(res.statusCode, 204);
  assert.equal(res.end.mock.calls.length, 1);
  assert.equal(res.body, undefined);
  assert.equal(deleteOne.mock.calls.length, 1);
});

test('GET /categories answers { data: { tree, count } }, cached without a success flag under a v2 key', async () => {
  const keys = [];
  vi.spyOn(redisCache, 'getOrSetCache').mockImplementation(async (key, _ttl, fetchFn) => {
    keys.push(key);
    return fetchFn();
  });
  vi.spyOn(Category, 'find').mockImplementation(() =>
    sorted([
      categoryDoc({ _id: 'c1', name: 'Helmets', order: 0, parent: null }),
      categoryDoc({ _id: 'c2', name: 'Full face', order: 0, parent: 'c1' }),
    ]),
  );
  const { categoryTree: listTree } = fresh('../src/modules/catalog/catalog.controller');
  const res = response();
  await listTree({ query: {} }, res, fail);
  assert.deepEqual(Object.keys(res.body), ['data']);
  assert.equal(res.body.data.count, 2);
  assert.equal(res.body.data.success, undefined);
  assert.deepEqual(
    res.body.data.tree.map((n) => [n.name, n.children.map((c) => c.name)]),
    [['Helmets', ['Full face']]],
  );
  // A pre-envelope payload cached under the old key would come back without
  // its wrapper's meaning; the v2 key makes sure it is never read.
  assert.match(keys[0], /^categories:tree:v2:/);
});

test('GET /categories/admin answers { data: { tree, flat, count } }', async () => {
  const docs = [categoryDoc({ _id: 'c1', name: 'Helmets', order: 0, parent: null })];
  vi.spyOn(Category, 'find').mockImplementation(() => sorted(docs));
  const { categoryAdminList: listAll } = fresh('../src/modules/catalog/catalog.controller');
  const res = response();
  await listAll({ query: {} }, res, fail);
  assert.deepEqual(Object.keys(res.body), ['data']);
  assert.deepEqual(Object.keys(res.body.data).sort(), ['count', 'flat', 'tree']);
  assert.equal(res.body.data.flat, docs);
});

/* ── public catalogue: product list, detail, shipping rate, reviews ─────── */
const storefront = require('../src/modules/products/storefront.service');
const Product = require('../src/modules/products/product.model');
const Review = require('../src/modules/catalog/review.model');

test('GET /products answers { data: { items, correctedQuery }, meta: paging }', async () => {
  vi.spyOn(storefront, 'listPublic').mockImplementation(async () => ({
    items: [{ _id: 'p1' }],
    page: 2,
    limit: 24,
    total: 30,
    pages: 2,
    query: 'helmt',
    correctedQuery: 'helmet',
  }));
  const { listPublic } = fresh('../src/modules/products/storefront.controller');
  const res = response();
  await listPublic({ query: {} }, res, fail);
  assert.deepEqual(res.body, {
    data: { items: [{ _id: 'p1' }], query: 'helmt', correctedQuery: 'helmet' },
    meta: { page: 2, pageSize: 24, totalItems: 30, totalPages: 2 },
  });
});

test('GET /products/:id answers { data: { product } }; shipping rate keeps its domain ok flag inside data', async () => {
  vi.spyOn(storefront, 'publicProduct').mockImplementation(async () => ({ _id: 'p1', name: 'Jacket' }));
  vi.spyOn(storefront, 'shippingRate').mockImplementation(async () => ({ ok: false, reason: 'unserviceable' }));
  const c = fresh('../src/modules/products/storefront.controller');
  const one = response();
  await c.getOne({ params: { id: 'jacket' } }, one, fail);
  assert.deepEqual(one.body, { data: { product: { _id: 'p1', name: 'Jacket' } } });
  const rate = response();
  await c.shippingRate({ params: { id: 'p1' }, query: { pincode: '110001' } }, rate, fail);
  assert.deepEqual(rate.body, { data: { ok: false, reason: 'unserviceable' } });
});

test('GET /products/:slug/reviews answers { data: { reviews, total, distribution, average } }', async () => {
  vi.spyOn(Product, 'findOne').mockImplementation(() => ({ select: async () => ({ _id: 'p1', rating: 4.5 }) }));
  const rows = [{ rating: 5 }, { rating: 4 }];
  vi.spyOn(Review, 'find').mockImplementation(() => {
    const q = { sort: () => q, limit: () => q, populate: () => q, lean: async () => rows };
    return q;
  });
  const { productReviews: listForProduct } = fresh('../src/modules/catalog/catalog.controller');
  const res = response();
  await listForProduct({ params: { slug: 'jacket' } }, res, fail);
  assert.deepEqual(res.body, {
    data: { reviews: rows, total: 2, distribution: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 1 }, average: 4.5 },
  });
});

/* ── seller catalogue: own list, writes, bulk status, media, import ─────── */
const catalogService = require('../src/modules/products/catalog.service');
const productsRepo = require('../src/modules/products/products.repository');
const mediaService = require('../src/modules/products/media.service');
const importService = require('../src/modules/products/import.service');
const urlImport = require('../src/modules/products/url-extract');

const seller = { user: { _id: 'seller-1', role: 'seller' } };

test('seller writes: POST /products 201 { data: { product } }, PUT { data: { product } }, DELETE 204, bulk status { data: { updated, skipped } }', async () => {
  vi.spyOn(catalogService, 'createProduct').mockImplementation(async () => ({ _id: 'p1', name: 'Gloves', images: [] }));
  vi.spyOn(catalogService, 'updateProduct').mockImplementation(async () => ({
    _id: 'p1',
    name: 'Gloves II',
    images: [],
  }));
  vi.spyOn(catalogService, 'removeProduct').mockImplementation(async () => {});
  vi.spyOn(catalogService, 'bulkSetStatus').mockImplementation(async () => ({ updated: 2, skipped: 1 }));
  const c = fresh('../src/modules/products/seller-catalog.controller');

  const created = response();
  await c.create({ ...seller, body: {} }, created, fail);
  assert.equal(created.statusCode, 201);
  assert.deepEqual(Object.keys(created.body), ['data']);
  assert.equal(created.body.data.product.name, 'Gloves');

  const updated = response();
  await c.update({ ...seller, params: { id: 'p1' }, body: {} }, updated, fail);
  assert.equal(updated.body.data.product.name, 'Gloves II');

  const removed = response();
  removed.end = vi.fn(() => removed);
  await c.remove({ ...seller, params: { id: 'p1' } }, removed, fail);
  assert.equal(removed.statusCode, 204);
  assert.equal(removed.body, undefined);

  const bulk = response();
  await c.bulkStatus({ ...seller, body: { ids: ['p1', 'p2', 'p3'], status: 'draft' } }, bulk, fail);
  assert.deepEqual(bulk.body, { data: { updated: 2, skipped: 1 } });
});

test('GET /products/mine answers { data: { items } }', async () => {
  vi.spyOn(productsRepo, 'listForSeller').mockImplementation(async () => []);
  const { listMine } = fresh('../src/modules/products/seller-catalog.controller');
  const res = response();
  await listMine(seller, res, fail);
  assert.deepEqual(res.body, { data: { items: [] } });
});

test('GET /products/mine/:id opens the seller’s own product whatever its verification state', async () => {
  // The public lookup 404s until the seller's KYC is approved; this one must not.
  const doc = { _id: 'p1', seller: 'seller-1', status: 'draft', images: ['a.jpg'] };
  vi.spyOn(productsRepo, 'findByIdOrSlug').mockImplementation(async () => doc);
  vi.spyOn(productsRepo, 'populateRefs').mockImplementation(async (p) => p);
  const { getMine } = fresh('../src/modules/products/seller-catalog.controller');
  const res = response();
  await getMine({ ...seller, params: { id: 'p1' } }, res, fail);
  assert.deepEqual(res.body, { data: { product: { ...doc, listingImage: 'a.jpg' } } });
});

test('GET /products/mine/:id answers not found for another seller’s product', async () => {
  vi.spyOn(productsRepo, 'findByIdOrSlug').mockImplementation(async () => ({ _id: 'p2', seller: 'seller-2' }));
  await assert.rejects(catalogService.getOwnProduct(seller.user, 'p2'), { status: 404 });
});

test('seller media and bulk import answer the envelope', async () => {
  vi.spyOn(mediaService, 'mediaRows').mockImplementation(async () => [{ url: 'a.jpg' }]);
  vi.spyOn(mediaService, 'bulkRemoveMedia').mockImplementation(async () => ({ removed: 1, blocked: [] }));
  vi.spyOn(importService, 'importBulk').mockImplementation(async () => ({
    summary: { total: 1, created: 1, updated: 0, failed: 0 },
    results: [],
  }));
  const m = fresh('../src/modules/products/seller-media.controller');
  const list = response();
  await m.listMedia(seller, list, fail);
  assert.deepEqual(list.body, { data: { items: [{ url: 'a.jpg' }], total: 1 } });
  const removed = response();
  await m.bulkRemoveMedia(
    { ...seller, body: { items: [{ productId: 'p1', kind: 'main', key: 'a.jpg' }] } },
    removed,
    fail,
  );
  assert.deepEqual(removed.body, { data: { removed: 1, blocked: [], requested: 1 } });

  const { importBulk } = fresh('../src/modules/products/import-export.controller');
  const imported = response();
  await importBulk({ ...seller, files: {} }, imported, fail);
  assert.deepEqual(imported.body, { data: { summary: { total: 1, created: 1, updated: 0, failed: 0 }, results: [] } });
});

test('POST /products/import-url answers { data: { draft, images, sourceUrl } }', async () => {
  vi.stubEnv('GROQ_API_KEY', 'test-only-not-a-real-key');
  vi.spyOn(urlImport, 'importProductUrl').mockImplementation(async () => ({
    draft: { name: 'Jacket' },
    images: [],
    sourceUrl: 'https://example.com/p',
  }));
  const { fromUrl } = fresh('../src/modules/products/url-import.controller');
  const res = response();
  try {
    await fromUrl({ ...seller, body: { url: 'https://example.com/p', confirmRights: true } }, res, fail);
  } finally {
    vi.unstubAllEnvs();
  }
  assert.deepEqual(res.body, { data: { draft: { name: 'Jacket' }, images: [], sourceUrl: 'https://example.com/p' } });
});

/* ── public CMS + blog reads (storefront SSR reads them through dataOf) ──── */
test('GET /blog answers { data: { items }, meta } with the service page size; other public blog reads answer { data }', async () => {
  const pub = require('../src/modules/blog/public-blog.service');
  vi.spyOn(pub, 'list').mockImplementation(async () => ({
    items: [{ _id: 'b1' }],
    page: 1,
    limit: 12,
    total: 13,
    pages: 2,
  }));
  vi.spyOn(pub, 'featured').mockImplementation(async () => ({ post: null }));
  const c = fresh('../src/modules/blog/blog.controller');
  const list = response();
  await c.listPublic({ site: 'main', query: {} }, list, fail);
  assert.deepEqual(list.body, {
    data: { items: [{ _id: 'b1' }] },
    meta: { page: 1, pageSize: 12, totalItems: 13, totalPages: 2 },
  });
  const hero = response();
  await c.getFeatured({ site: 'main', query: {} }, hero, fail);
  assert.deepEqual(hero.body, { data: { post: null } });
});

test('public CMS reads answer { data } with no success flag', async () => {
  const home = require('../src/modules/cms/home.service');
  const site = require('../src/modules/cms/site-content.service');
  vi.spyOn(home, 'getSellerCta').mockImplementation(async () => ({ cta: { title: 'Sell with us' } }));
  vi.spyOn(site, 'faqPublic').mockImplementation(async () => ({ items: [{ title: 'Orders', faqs: [] }] }));
  const c = fresh('../src/modules/cms/cms.controller');
  const cta = response();
  await c.getSellerCta({ query: { active: '1' } }, cta, fail);
  assert.deepEqual(cta.body, { data: { cta: { title: 'Sell with us' } } });
  const faqs = response();
  await c.listFaqs({ site: 'main', query: {} }, faqs, fail);
  assert.deepEqual(faqs.body, { data: { items: [{ title: 'Orders', faqs: [] }] } });
});
