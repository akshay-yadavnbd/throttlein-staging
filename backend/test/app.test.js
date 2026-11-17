/**
 * App assembly (src/app.js) without a database: the middleware chain, the
 * /api router, the 404 and the error envelope all answer over real HTTP.
 */
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../src/app');

async function withServer(fn) {
  const server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('health answers and carries a request id', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/health`, { headers: { 'X-Request-Id': 'trace-app-test-1' } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-request-id'), 'trace-app-test-1');
    assert.equal(res.headers.get('x-powered-by'), null);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'seller-management-api');
  });
});

test('an unknown path is a 404 envelope with the minted request id', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/nope`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.code, 'NOT_FOUND');
    assert.equal(body.requestId, res.headers.get('x-request-id'));
    assert.match(body.requestId, /^[0-9a-f-]{36}$/);
  });
});

test('route validation and malformed JSON both answer with the error envelope', async () => {
  await withServer(async (base) => {
    const bad = await fetch(`${base}/api/products?limit=lots`);
    assert.equal(bad.status, 400);
    const body = await bad.json();
    assert.equal(body.code, 'VALIDATION_FAILED');
    assert.equal(body.details.issues[0].path, 'limit');

    const json = await fetch(`${base}/api/products/bulk-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    assert.equal(json.status, 400);
    assert.equal((await json.json()).code, 'BAD_REQUEST');
  });
});

test('a blocked CORS origin is refused and an allowed one is reflected', async () => {
  await withServer(async (base) => {
    const ok = await fetch(`${base}/api/health`, { headers: { Origin: 'http://localhost:3000' } });
    assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:3000');
    const blocked = await fetch(`${base}/api/health`, { headers: { Origin: 'https://evil.example' } });
    assert.equal(blocked.status, 500);
    assert.equal(blocked.headers.get('access-control-allow-origin'), null);
  });
});

test('catalogue routes are mounted and guarded: private ones answer 401 without a token, never 404', async () => {
  const id = '507f1f77bcf86cd799439011';
  const privateRoutes = [
    ['GET', '/api/categories/admin'],
    ['POST', '/api/categories'],
    ['PUT', `/api/categories/${id}`],
    ['DELETE', `/api/categories/${id}`],
    ['POST', '/api/categories/upload-icon'],
    ['POST', '/api/brands'],
    ['PUT', `/api/brands/${id}`],
    ['DELETE', `/api/brands/${id}`],
    ['POST', '/api/brands/upload-logo'],
    ['POST', '/api/reviews'],
    ['GET', '/api/reviews/mine'],
    ['GET', '/api/reviews/eligibility'],
    ['DELETE', `/api/reviews/${id}`],
    ['POST', '/api/reviews/uploads/images'],
    ['GET', '/api/seller/brand-category-requests'],
    ['POST', '/api/seller/brand-category-requests'],
    ['PATCH', `/api/seller/brand-category-requests/${id}`],
    ['DELETE', `/api/seller/brand-category-requests/${id}`],
    ['GET', '/api/admin/brand-category-requests'],
    ['GET', `/api/admin/brand-category-requests/${id}`],
    ['POST', `/api/admin/brand-category-requests/${id}/approve`],
    ['POST', `/api/admin/brand-category-requests/${id}/reject`],
    ['DELETE', `/api/admin/brand-category-requests/${id}`],
  ];
  await withServer(async (base) => {
    for (const [method, url] of privateRoutes) {
      const res = await fetch(base + url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'GET' ? undefined : '{}',
      });
      assert.equal(res.status, 401, `${method} ${url}`);
    }
  });
});

test('customer routes are mounted and guarded; the public unsubscribe page rejects a bad link', async () => {
  const id = '507f1f77bcf86cd799439011';
  const privateRoutes = [
    ['GET', '/api/cart'],
    ['GET', '/api/cart/delivery-options'],
    ['POST', '/api/cart'],
    ['PUT', `/api/cart/${id}`],
    ['DELETE', `/api/cart/${id}`],
    ['DELETE', '/api/cart'],
    ['GET', '/api/wishlist'],
    ['POST', '/api/wishlist'],
    ['DELETE', `/api/wishlist/${id}`],
    ['POST', '/api/notify-me'],
    ['GET', '/api/addresses'],
    ['POST', '/api/addresses'],
    ['PUT', `/api/addresses/${id}`],
    ['PATCH', `/api/addresses/${id}/default`],
    ['DELETE', `/api/addresses/${id}`],
    ['POST', '/api/checkout/failures'],
    ['GET', '/api/admin/checkout-failures'],
    ['GET', '/api/admin/customer-carts'],
  ];
  await withServer(async (base) => {
    for (const [method, url] of privateRoutes) {
      const res = await fetch(base + url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'GET' ? undefined : '{}',
      });
      assert.equal(res.status, 401, `${method} ${url}`);
    }
    // The link is signed with JWT_SECRET (or CART_REMINDER_SECRET); the test env has neither.
    vi.stubEnv('JWT_SECRET', 'test-only-not-a-real-secret');
    try {
      const page = await fetch(`${base}/api/email/unsubscribe/cart-reminders?u=${id}&t=forged`);
      assert.equal(page.status, 400);
      assert.match(page.headers.get('content-type'), /text\/html/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

test('seller offer and offline-sale routes are mounted and need a signed-in seller', async () => {
  const id = '507f1f77bcf86cd799439011';
  const routes = [
    ['GET', '/api/seller/offers'],
    ['POST', '/api/seller/offers'],
    ['GET', `/api/seller/offers/${id}`],
    ['PUT', `/api/seller/offers/${id}`],
    ['PATCH', `/api/seller/offers/${id}/toggle`],
    ['DELETE', `/api/seller/offers/${id}`],
    ['GET', '/api/seller/offline-sales'],
    ['GET', '/api/seller/offline-sales/products-lookup'],
    ['POST', '/api/seller/offline-sales'],
    ['GET', `/api/seller/offline-sales/${id}`],
    ['GET', `/api/seller/offline-sales/${id}/invoice`],
    ['PATCH', `/api/seller/offline-sales/${id}`],
    ['DELETE', `/api/seller/offline-sales/${id}`],
  ];
  await withServer(async (base) => {
    for (const [method, url] of routes) {
      const res = await fetch(base + url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'GET' ? undefined : '{}',
      });
      assert.equal(res.status, 401, `${method} ${url}`);
    }
  });
});

test('seller media, payouts, notifications and the onboarding reminder are mounted and guarded', async () => {
  const id = '507f1f77bcf86cd799439011';
  const routes = [
    ['GET', '/api/seller/media'],
    ['POST', '/api/seller/media/upload'],
    ['POST', '/api/seller/media/bulk-delete'],
    ['POST', '/api/seller/media/presign'],
    ['DELETE', `/api/seller/media/${id}`],
    ['GET', '/api/seller/payouts'],
    ['GET', '/api/admin/settlements'],
    ['GET', '/api/admin/settlements/history'],
    ['GET', '/api/admin/settlements/in-transit'],
    ['POST', '/api/admin/settlements/pay'],
    ['PATCH', `/api/admin/orders/TIN-1001/shipments/${id}/courier-charge`],
    ['GET', '/api/admin/notifications'],
    ['POST', '/api/admin/notifications'],
    ['PATCH', `/api/admin/notifications/${id}`],
    ['DELETE', `/api/admin/notifications/${id}`],
    ['POST', `/api/admin/notifications/${id}/test`],
    ['POST', '/api/admin/sellers/some-seller/remind'],
  ];
  await withServer(async (base) => {
    for (const [method, url] of routes) {
      const res = await fetch(base + url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'GET' ? undefined : '{}',
      });
      assert.equal(res.status, 401, `${method} ${url}`);
    }
  });
});

test('media library, assistant chats and contact are mounted: private routes need a token, contact validates first', async () => {
  const id = '507f1f77bcf86cd799439011';
  const routes = [
    ['GET', '/api/admin/media'],
    ['GET', '/api/admin/media/folders'],
    ['POST', '/api/admin/media/upload'],
    ['POST', '/api/admin/media/bulk-delete'],
    ['DELETE', `/api/admin/media/${id}`],
    ['GET', '/api/assistant/conversations'],
    ['POST', '/api/assistant/conversations'],
    ['GET', `/api/assistant/conversations/${id}`],
    ['POST', `/api/assistant/conversations/${id}/messages`],
    ['PATCH', `/api/assistant/conversations/${id}`],
    ['DELETE', `/api/assistant/conversations/${id}`],
    ['POST', '/api/products/import-url'],
  ];
  await withServer(async (base) => {
    for (const [method, url] of routes) {
      const res = await fetch(base + url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'GET' ? undefined : '{}',
      });
      assert.equal(res.status, 401, `${method} ${url}`);
    }
    const contact = await fetch(`${base}/api/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(contact.status, 400);
    assert.match((await contact.json()).message, /Full name and email are required/);
  });
});
