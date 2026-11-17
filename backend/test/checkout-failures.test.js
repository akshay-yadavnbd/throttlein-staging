const assert = require('node:assert/strict');
const Failure = require('../src/modules/customers/checkout-failure.model');
const Intent = require('../src/modules/orders/checkout-intent.model');
const { recordFailure, captureFailure, safeMessage } = require('../src/modules/customers/checkout-failures.service');
const controller = { report: require('../src/modules/customers/customers.controller').reportCheckoutFailure };
const { response } = require('./helpers/controller');
function invoke(fn, req, res) {
  return new Promise((resolve, reject) => {
    res.json = (body) => {
      res.body = body;
      resolve(body);
      return res;
    };
    fn(req, res, reject);
  });
}
test('checkout errors retain stage and user without persisting request payloads', async () => {
  let saved;
  vi.spyOn(Failure, 'create').mockImplementation(async (data) => {
    saved = data;
  });
  const err = Object.assign(new Error('Payment declined'), { status: 502 });
  let forwarded;
  await captureFailure(
    err,
    {
      user: { _id: 'user1' },
      path: '/orders/razorpay/init',
      checkoutStep: 'payment_init',
      body: { attemptId: 'attempt-1', razorpay_signature: 'never-store', card: 'never-store' },
    },
    response(),
    (e) => {
      forwarded = e;
    },
  );
  assert.equal(forwarded, err);
  assert.equal(saved.user, 'user1');
  assert.equal(saved.step, 'payment_init');
  assert.equal(saved.httpStatus, 502);
  assert.equal(saved.source, 'server');
  assert.doesNotMatch(JSON.stringify(saved), /never-store/);
});
test('telemetry persistence failure does not replace checkout error', async () => {
  vi.spyOn(Failure, 'create').mockImplementation(async () => {
    throw new Error('database down');
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const err = new Error('original');
  let forwarded;
  await captureFailure(err, { user: { _id: 'user1' }, path: '/orders', body: {} }, response(), (e) => {
    forwarded = e;
  });
  assert.equal(forwarded, err);
});
test('non-checkout errors and anonymous requests are not recorded', async () => {
  let calls = 0;
  vi.spyOn(Failure, 'create').mockImplementation(async () => {
    calls++;
  });
  for (const req of [{ path: '/orders' }, { path: '/wishlist', user: { _id: 'u' } }]) {
    await captureFailure(new Error('failed'), req, response(), () => {});
  }
  assert.equal(calls, 0);
});
test('redacts secrets and bounds errors', () => {
  const clean = safeMessage(
    'Bearer abc secret=xyz signature=123 user@example.com https://example.com?token=abc 1234567890123456 rzp_live_abc',
  );
  for (const value of ['Bearer abc', 'xyz', 'user@example.com', 'token=abc', '1234567890123456', 'rzp_live_abc'])
    assert.ok(!clean.includes(value));
  assert.equal(safeMessage('x'.repeat(1000)).length, 600);
});
test('browser reports use authenticated identity and cannot impersonate server events', async () => {
  let saved;
  vi.spyOn(Failure, 'create').mockImplementation(async (data) => {
    saved = data;
  });
  const res = response();
  await invoke(
    controller.report,
    {
      user: { _id: 'real-user' },
      body: {
        user: 'forged',
        source: 'server',
        step: 'sdk_load',
        message: 'Script failed',
        rawPayload: 'secret',
      },
    },
    res,
  );
  assert.equal(res.statusCode, 202);
  assert.equal(saved.user, 'real-user');
  assert.equal(saved.source, 'browser');
  assert.equal(saved.rawPayload, undefined);
});
test('browser cannot associate failures with another customer payment', async () => {
  let calls = 0;
  vi.spyOn(Intent, 'exists').mockImplementation(async (filter) => {
    assert.equal(filter.user, 'real-user');
    return null;
  });
  vi.spyOn(Failure, 'create').mockImplementation(async () => {
    calls++;
  });
  // Refusals are thrown AppErrors — `invoke` rejects with what the handler passed to next().
  await assert.rejects(
    invoke(
      controller.report,
      {
        user: { _id: 'real-user' },
        body: { step: 'payment_failed', message: 'Declined', razorpayOrderId: 'order_other' },
      },
      response(),
    ),
    (e) => e.status === 403,
  );
  assert.equal(calls, 0);
});
test('invalid steps and oversized reports are rejected', async () => {
  for (const body of [
    { step: 'invented', message: 'bad' },
    { step: 'sdk_load', message: 'x'.repeat(601) },
  ]) {
    await assert.rejects(invoke(controller.report, { user: { _id: 'u' }, body }, response()), (e) => e.status === 400);
  }
});
test('missing users and invalid stages are ignored by the recorder', async () => {
  let calls = 0;
  vi.spyOn(Failure, 'create').mockImplementation(async () => {
    calls++;
  });
  await recordFailure({ step: 'sdk_load' });
  await recordFailure({ user: 'u', step: 'wrong' });
  assert.equal(calls, 0);
});

test('failure feed permission rejects customers and staff without orders access', () => {
  const { requirePermission } = require('../src/middleware/auth');
  for (const user of [{ role: 'customer' }, { role: 'staff', permissions: [] }]) {
    const res = response();
    let error;
    requirePermission('orders')({ user }, res, (err) => {
      error = err;
    });
    assert.ok(error);
    assert.equal(error.status, 403);
  }
  let error;
  requirePermission('orders')({ user: { role: 'staff', permissions: ['orders'] } }, response(), (err) => {
    error = err;
  });
  assert.equal(error, undefined);
});
test('verified payment-failed webhooks record the checkout owner; invalid signatures do not', async () => {
  const { loadController } = require('./helpers/controller');
  const events = [];
  let valid = false;
  const ctx = loadController({
    '../infrastructure/payments/razorpay': { verifyWebhookSignature: () => valid },
    '../models/CheckoutIntent': { findOne: async () => ({ user: 'checkout-owner' }) },
    '../modules/customers': { recordCheckoutFailure: async (data) => events.push(data) },
  });
  const req = {
    headers: {},
    rawBody: Buffer.from(
      JSON.stringify({
        event: 'payment.failed',
        payload: {
          payment: {
            entity: {
              order_id: 'order_test',
              id: 'pay_test',
              error_description: 'Bank declined',
              error_code: 'BAD_REQUEST_ERROR',
            },
          },
        },
      }),
    ),
  };
  const denied = response();
  await ctx.exports.razorpayWebhook(req, denied);
  assert.equal(denied.statusCode, 400);
  assert.equal(events.length, 0);
  valid = true;
  await ctx.exports.razorpayWebhook(req, response());
  assert.equal(events[0].user, 'checkout-owner');
  assert.equal(events[0].source, 'webhook');
  assert.equal(events[0].step, 'payment_failed');
  assert.equal(events[0].message, 'Bank declined');
});
test('payment-failed webhooks keep the reason, not just the generic error code', async () => {
  const { loadController } = require('./helpers/controller');
  const events = [];
  const ctx = loadController({
    '../infrastructure/payments/razorpay': { verifyWebhookSignature: () => true },
    '../models/CheckoutIntent': { findOne: async () => ({ user: 'checkout-owner' }) },
    '../modules/customers': { recordCheckoutFailure: async (data) => events.push(data) },
  });
  for (const entity of [
    {
      method: 'upi',
      error_code: 'BAD_REQUEST_ERROR',
      error_reason: 'payment_timed_out',
      error_source: 'customer',
      error_description: 'Payment was unsuccessful as you could not complete it in time.',
    },
    {
      method: 'cardless_emi',
      error_code: 'BAD_REQUEST_ERROR',
      error_reason: null,
      error_source: null,
      error_description: 'Terminal not found.',
    },
  ]) {
    await ctx.exports.razorpayWebhook(
      {
        headers: {},
        rawBody: Buffer.from(
          JSON.stringify({
            event: 'payment.failed',
            payload: { payment: { entity: { order_id: 'order_test', id: 'pay_test', ...entity } } },
          }),
        ),
      },
      response(),
    );
  }
  assert.equal(events[0].code, 'payment_timed_out');
  assert.equal(events[0].paymentMethod, 'online');
  assert.equal(
    events[0].message,
    'Payment was unsuccessful as you could not complete it in time. (payment_timed_out, source: customer, method: upi)',
  );
  assert.equal(events[1].code, 'BAD_REQUEST_ERROR');
  assert.equal(events[1].paymentMethod, 'emi');
  assert.equal(events[1].message, 'Terminal not found. (method: cardless_emi)');
});
