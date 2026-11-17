/**
 * Multi-site guard tests (unit project).
 *
 * Covers the three pieces that decide which property a request touches
 * and whether the caller may touch it:
 *   - config/sites.js     → permission-key derivation
 *   - middleware/resolveSite.js → site resolution + its precedence order
 *   - middleware/auth.js  → requireSitePermission
 *
 * No database and no HTTP server: the middleware is invoked directly
 * with hand-built req/res doubles. Mongoose and jsonwebtoken are
 * stubbed out below because auth.js pulls in the User model
 * transitively and loading the ORM dwarfs the runtime of the suite.
 */
process.env.JWT_SECRET = 'test';
process.env.SELLER_ORIGIN = 'https://seller.throttlein.com';
const assert = require('assert');
const Module = require('module');
const path = require('path');
const SRC = path.resolve(__dirname, '../src');

// Stub the heavy deps auth.js pulls in transitively (mongoose via the
// User model). We're testing the guard logic, not the ORM — and loading
// mongoose off the mounted filesystem takes longer than the whole suite.
const origResolve = Module._resolveFilename;
const STUBS = {
  jsonwebtoken: { sign: () => 'tok', verify: () => ({}) },
  'express-async-handler': (fn) => fn,
  [SRC + '/models/User']: { findById: async () => null },
};
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === 'jsonwebtoken' || request === 'express-async-handler') return request;
  if (request === '../models/User' && parent?.filename?.includes('/middleware/')) {
    return SRC + '/models/User';
  }
  return origResolve.call(this, request, parent, ...rest);
};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (STUBS[request] !== undefined) return STUBS[request];
  if (request === '../models/User' && parent?.filename?.includes('/middleware/')) {
    return STUBS[SRC + '/models/User'];
  }
  return origLoad.call(this, request, parent, isMain);
};

const { permissionKeyFor, isSite, normalizeSite } = require(SRC + '/config/sites');
const resolveSite = require(SRC + '/middleware/resolveSite');
const { requireSitePermission } = require(SRC + '/middleware/auth');

describe('permissionKeyFor', () => {
  test('main keeps the unprefixed key', () => assert.equal(permissionKeyFor('pages', 'main'), 'pages'));
  test('seller gets a prefix', () => assert.equal(permissionKeyFor('pages', 'seller'), 'seller-pages'));
  test('blogs likewise', () => assert.equal(permissionKeyFor('blogs', 'seller'), 'seller-blogs'));
  test('missing site defaults to main', () => assert.equal(permissionKeyFor('pages', undefined), 'pages'));
  test('rejects unknown site', () => assert.equal(isSite('sellers'), false));
  test('normalizes unknown to main', () => assert.equal(normalizeSite('bogus'), 'main'));
});

function run(req) {
  const r = {
    status() {
      return this;
    },
  };
  let err = null;
  resolveSite(req, r, (e) => {
    err = e || null;
  });
  return { err, site: req.site };
}
const mkreq = (o = {}) => ({
  query: o.query || {},
  body: o.body || {},
  headers: o.headers || {},
  get(h) {
    const k = Object.keys(this.headers).find((x) => x.toLowerCase() === h.toLowerCase());
    return k ? this.headers[k] : undefined;
  },
});

describe('resolveSite', () => {
  test('defaults to main', () => assert.equal(run(mkreq()).site, 'main'));
  test('?site=seller wins', () => assert.equal(run(mkreq({ query: { site: 'seller' } })).site, 'seller'));
  test('body.site works', () => assert.equal(run(mkreq({ body: { site: 'seller' } })).site, 'seller'));
  test('X-Admin-Site works', () => assert.equal(run(mkreq({ headers: { 'X-Admin-Site': 'seller' } })).site, 'seller'));
  test('X-Site works', () => assert.equal(run(mkreq({ headers: { 'X-Site': 'seller' } })).site, 'seller'));
  test('query beats header', () =>
    assert.equal(run(mkreq({ query: { site: 'main' }, headers: { 'X-Admin-Site': 'seller' } })).site, 'main'));
  test('Origin sniff -> seller', () =>
    assert.equal(run(mkreq({ headers: { Origin: 'https://seller.throttlein.com' } })).site, 'seller'));
  test('Origin main -> main', () =>
    assert.equal(run(mkreq({ headers: { Origin: 'https://throttlein.com' } })).site, 'main'));
  test('bogus site is a 400, not a silent fallback', () => {
    const { err } = run(mkreq({ query: { site: 'bogus' } }));
    assert.ok(err && /Unknown site/.test(err.message), 'expected an error');
  });
});

describe('requireSitePermission', () => {
  // Guards hand the error handler an AppError carrying its own status; the
  // handler (not the guard) writes it to the response.
  function guard(user, site, base = 'pages') {
    const req = { user, site };
    let error = null,
      passed = false;
    requireSitePermission(base)(req, {}, (e) => {
      if (e) error = e;
      else passed = true;
    });
    return { passed, error, statusCode: error ? error.status : 200 };
  }
  const staff = (...perms) => ({ role: 'staff', permissions: perms });

  test('superadmin passes on main', () => assert.ok(guard({ role: 'superadmin' }, 'main').passed));
  test('superadmin passes on seller', () => assert.ok(guard({ role: 'superadmin' }, 'seller').passed));
  test('pages-only staff passes on main', () => assert.ok(guard(staff('pages'), 'main').passed));
  test('pages-only staff BLOCKED on seller', () => {
    const r = guard(staff('pages'), 'seller');
    assert.ok(!r.passed && r.statusCode === 403, `expected 403, got ${r.statusCode}`);
  });
  test('seller-pages staff passes on seller', () => assert.ok(guard(staff('seller-pages'), 'seller').passed));
  test('seller-pages staff BLOCKED on main', () => {
    const r = guard(staff('seller-pages'), 'main');
    assert.ok(!r.passed && r.statusCode === 403, `expected 403, got ${r.statusCode}`);
  });
  test('both keys -> both sites', () => {
    assert.ok(guard(staff('pages', 'seller-pages'), 'main').passed);
    assert.ok(guard(staff('pages', 'seller-pages'), 'seller').passed);
  });
  test('a seller role cannot reach admin endpoints', () => {
    const r = guard({ role: 'seller', permissions: ['pages'] }, 'main');
    assert.ok(!r.passed && r.statusCode === 403);
  });
  test('blogs key does not grant pages', () => assert.ok(!guard(staff('seller-blogs'), 'seller', 'pages').passed));
});
