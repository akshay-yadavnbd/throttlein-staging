/**
 * The `{ data, meta }` success envelope on the admin endpoints that moved to
 * it (unit project). The admin screens behind them read the envelope through
 * lib/api.ts `unwrap`, so the two sides must agree on the shape.
 */
const assert = require('node:assert/strict');
const { loadModule, response } = require('./helpers/controller');

const staffRows = [
  { _id: 's1', name: 'Asha', email: 'asha@example.com', permissions: ['pages'], status: 'approved' },
  { _id: 's2', name: 'Ravi', email: 'ravi@example.com', permissions: [], status: 'suspended' },
];
const customerRows = [
  {
    _id: 'c1',
    name: 'Meera',
    email: 'meera@example.com',
    toObject() {
      return { _id: 'c1', name: 'Meera' };
    },
  },
];

/** A query chain that answers `rows` whatever the order of select / sort / skip / limit. */
function chain(rows) {
  const q = Promise.resolve(rows);
  for (const m of ['select', 'sort', 'skip', 'limit', 'lean', 'populate']) q[m] = () => q;
  return q;
}
const admin = loadModule('admin', {
  '../models/User': {
    find: (filter) => chain(filter.role === 'staff' ? staffRows : customerRows),
    countDocuments: async (filter) => (filter.role === 'customer' ? 41 : 0),
  },
  '../models/Order': { aggregate: async () => [{ _id: 'c1', orders: 3, spend: 4500 }] },
  '../models/PlatformSecurity': {
    loadWithHash: async () => ({
      masterKeyHash: 'hash',
      masterKeySetByEmail: 'owner@example.com',
      masterKeyRotations: 2,
    }),
    publicLoginEnabled: () => false,
  },
});

test('GET /admin/staff answers { data: { items }, meta } with paging meta for the whole list', async () => {
  const res = response();
  await admin.listStaff({}, res, (e) => {
    throw e;
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    data: { items: staffRows },
    meta: { page: 1, pageSize: 2, totalItems: 2, totalPages: 1 },
  });
  assert.equal('success' in res.body, false, 'the envelope carries no success flag');
});

test('GET /admin/customers pages through meta: totalItems from the count, not the page length', async () => {
  const res = response();
  await admin.listCustomers({ query: { page: '2', limit: '15', q: '' } }, res, (e) => {
    throw e;
  });
  // JSON round-trip: the module answers from its own VM realm, so prototypes differ.
  const body = JSON.parse(JSON.stringify(res.body));
  assert.deepEqual(body.meta, { page: 2, pageSize: 15, totalItems: 41, totalPages: 3 });
  assert.deepEqual(body.data.items, [{ _id: 'c1', name: 'Meera', orderCount: 3, lifetimeSpend: 4500 }]);
});

test('GET /admin/sellers/queues answers { data: { queues } } with every named queue', async () => {
  const res = response();
  await admin.sellerQueues({}, res, (e) => {
    throw e;
  });
  assert.deepEqual(Object.keys(res.body), ['data']);
  assert.deepEqual(Object.keys(res.body.data.queues), ['signups', 'unverified', 'kycWaiting', 'live', 'suspended']);
});

test('GET /admin/kyc/pending (sellers module) answers { data: { sellers } } with the OTP hash stripped', async () => {
  const pending = [
    {
      _id: 'k1',
      name: 'Nia',
      kyc: { status: 'pending', pickupSelfVerification: { otpHash: 'secret', sentToday: 2, verifiedAt: null } },
    },
  ];
  const sellers = loadModule('sellers', { '../models/User': { find: () => chain(pending) } });
  const res = response();
  await sellers.listPendingKyc({}, res, (e) => {
    throw e;
  });
  const body = JSON.parse(JSON.stringify(res.body));
  assert.deepEqual(Object.keys(body), ['data']);
  assert.equal(body.data.sellers[0].name, 'Nia');
  assert.equal('otpHash' in body.data.sellers[0].kyc.pickupSelfVerification, false);
  assert.ok(!JSON.stringify(body).includes('secret'));
});

test('GET /admin/security/master-key answers { data } with the status fields and never the hash', async () => {
  const res = response();
  await admin.getMasterKeyStatus({}, res, (e) => {
    throw e;
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(Object.keys(res.body), ['data']);
  assert.equal(res.body.data.configured, true);
  assert.equal(res.body.data.setByEmail, 'owner@example.com');
  assert.equal(res.body.data.rotations, 2);
  assert.equal(res.body.data.loginEnabled, false);
  assert.ok(!JSON.stringify(res.body).includes('hash'));
});

test('GET /admin/checkout-failures pages through meta', async () => {
  const CheckoutFailure = require('../src/modules/customers/checkout-failure.model');
  const rows = [{ _id: 'f1', step: 'payment_failed' }];
  vi.spyOn(CheckoutFailure, 'find').mockImplementation(() => chain(rows));
  vi.spyOn(CheckoutFailure, 'countDocuments').mockImplementation(async () => 26);
  const { listCheckoutFailures: list } = require('../src/modules/customers/customers.controller');
  const res = response();
  await list({ query: { page: '2', limit: '25' } }, res, (e) => {
    throw e;
  });
  assert.deepEqual(res.body, { data: { items: rows }, meta: { page: 2, pageSize: 25, totalItems: 26, totalPages: 2 } });
});

test('GET /admin/notifications answers { data: { events, recipients, alwaysNotified } }', async () => {
  const NotificationSettings = require('../src/modules/notifications/notification-settings.model');
  vi.spyOn(NotificationSettings, 'load').mockImplementation(async () => ({
    recipients: [{ _id: 'r1', email: 'ops@example.com' }],
  }));
  const { list } = require('../src/modules/notifications/notifications.controller');
  const res = response();
  await list({}, res, (e) => {
    throw e;
  });
  assert.deepEqual(Object.keys(res.body), ['data']);
  assert.deepEqual(res.body.data.recipients, [{ _id: 'r1', email: 'ops@example.com' }]);
  assert.ok(Array.isArray(res.body.data.events) && res.body.data.events.length > 0);
  assert.ok(Array.isArray(res.body.data.alwaysNotified));
});

test('GET /admin/blog (blog module) answers { data: { items }, meta } with totals from the count', async () => {
  const blog = loadModule('blog', {
    '../modules/blog/blog-post.model': {
      STATUSES: ['draft', 'published', 'scheduled', 'archived'],
      aggregate: async () => [{ _id: 'p1', title: 'Riding gear 101' }],
      populate: async () => {},
      countDocuments: async () => 30,
    },
  });
  const res = response();
  await blog.adminList({ site: 'main', query: { page: '2', limit: '25' } }, res, (e) => {
    throw e;
  });
  const body = JSON.parse(JSON.stringify(res.body));
  assert.deepEqual(body, {
    data: { items: [{ _id: 'p1', title: 'Riding gear 101' }] },
    meta: { page: 2, pageSize: 25, totalItems: 30, totalPages: 2 },
  });
});

test('CMS admin and public reads both answer { data } (the storefront proxy reads redirects through dataOf)', async () => {
  const rows = [{ _id: 'r1', source: '/old', destination: '/new', isActive: true }];
  const cms = loadModule('cms', { '../modules/cms/redirect.model': { find: () => chain(rows) } });
  const admin = response();
  await cms.adminRedirects({ site: 'main', query: {} }, admin, (e) => {
    throw e;
  });
  assert.deepEqual(JSON.parse(JSON.stringify(admin.body)), { data: { items: rows } });
  const pub = response();
  await cms.listRedirects({ site: 'main', query: {} }, pub, (e) => {
    throw e;
  });
  assert.deepEqual(JSON.parse(JSON.stringify(pub.body)), { data: { items: rows } });
});

/* ── media library (/api/admin/media; read by admin/app/media and MediaPicker) ── */
test('media library: list { data: { items }, meta }, folders { data: { folders } }, bulk delete { data: { deleted, requested } }, delete 204', async () => {
  const Media = require('../src/modules/media/media.model');
  const upload = require('../src/middleware/upload');
  const cascade = require('../src/utils/cascadeMediaDelete');
  vi.spyOn(cascade, 'cascadeMediaDelete').mockImplementation(async () => {});
  vi.spyOn(upload, 'deleteKey').mockImplementation(async () => {});
  vi.spyOn(upload, 'publicFileUrl').mockImplementation((key) => `https://cdn.example.com/${key}`);
  const doc = { _id: 'm1', key: 'banners/a.jpg', toObject: () => ({ _id: 'm1', key: 'banners/a.jpg' }) };
  vi.spyOn(Media, 'find').mockImplementation(() => {
    const q = Promise.resolve([doc]);
    q.sort = () => q;
    q.skip = () => q;
    q.limit = () => q;
    return q;
  });
  vi.spyOn(Media, 'countDocuments').mockImplementation(async () => 40);
  vi.spyOn(Media, 'distinct').mockImplementation(async () => ['pages', '', 'banners']);
  vi.spyOn(Media, 'deleteMany').mockImplementation(async () => ({ deletedCount: 1 }));
  vi.spyOn(Media, 'findById').mockImplementation(async () => ({ key: 'banners/a.jpg', deleteOne: async () => {} }));
  const c = require('../src/modules/media/media.controller');
  const fail = (e) => {
    throw e;
  };

  const list = response();
  await c.list({ query: { page: '2', limit: '36' } }, list, fail);
  assert.deepEqual(list.body.meta, { page: 2, pageSize: 36, totalItems: 40, totalPages: 2 });
  assert.deepEqual(
    list.body.data.items.map((i) => [i._id, i.url]),
    [['m1', 'https://cdn.example.com/banners/a.jpg']],
  );

  const folders = response();
  await c.folders({ query: {} }, folders, fail);
  assert.deepEqual(folders.body, { data: { folders: ['banners', 'pages'] } });

  const bulk = response();
  await c.bulkRemove({ body: { ids: ['m1', 'm2'] } }, bulk, fail);
  assert.deepEqual(bulk.body, { data: { deleted: 1, requested: 2 } });

  const one = response();
  one.end = vi.fn(() => one);
  await c.remove({ params: { id: 'm1' } }, one, fail);
  assert.equal(one.statusCode, 204);
  assert.equal(one.body, undefined);
});
