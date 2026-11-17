/**
 * Checkout failure telemetry: where a shopper's checkout broke, from the
 * browser, the server's own errors and Razorpay's payment-failed webhook.
 * Messages are scrubbed before they are stored, and recording never
 * replaces or masks the original error.
 */
const { AppError } = require('../../errors/AppError');
const { logger } = require('../../utils/logger');
const failures = require('./checkout-failures.repository');

const STEPS = [
  'address',
  'delivery',
  'checkout_validation',
  'payment_init',
  'sdk_load',
  'payment_window',
  'payment_failed',
  'payment_cancelled',
  'payment_verify',
  'order_finalize',
  'cod_order',
];
/** Steps a browser may report; server-only steps cannot be impersonated. */
const CLIENT_STEPS = [
  'address',
  'delivery',
  'sdk_load',
  'payment_window',
  'payment_failed',
  'payment_cancelled',
  'payment_verify',
  'payment_init',
  'cod_order',
];

const reference = (value) => (typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value) ? value : '');

/** Never persist URLs, credentials, email addresses, long numbers or raw payloads. */
function safeMessage(value) {
  let message = typeof value === 'string' ? value : 'Checkout could not be completed';
  message = message
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/\bBearer\s+\S+/gi, '[credential]')
    .replace(/\b(?:rzp_(?:live|test)_\w+|eyJ[\w.-]+)\b/g, '[credential]')
    .replace(/(?:password|secret|signature|token|authorization|key_secret)\s*[=:]\s*\S+/gi, '[credential]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email]')
    .replace(/\b\d{6,}\b/g, '[number]')
    .replace(/\b[a-f0-9]{32,}\b/gi, '[redacted]');
  return message.slice(0, 600) || 'Checkout could not be completed';
}

async function recordFailure(data) {
  if (!data.user || !STEPS.includes(data.step)) return;
  try {
    await failures.create({
      user: data.user,
      step: data.step,
      source: data.source,
      ...(data.source === 'webhook' && data.step === 'payment_failed' && reference(data.razorpayPaymentId)
        ? { eventKey: `failed:${reference(data.razorpayPaymentId)}` }
        : {}),
      message: safeMessage(data.message),
      code: reference(data.code),
      paymentMethod: ['online', 'emi', 'cod'].includes(data.paymentMethod) ? data.paymentMethod : 'online',
      attemptId: reference(data.attemptId),
      razorpayOrderId: reference(data.razorpayOrderId),
      razorpayPaymentId: reference(data.razorpayPaymentId),
      httpStatus: Number.isInteger(data.httpStatus) ? data.httpStatus : undefined,
    });
  } catch (err) {
    if (err.code !== 11000) logger.error('[checkout-failure] Unable to persist failure event');
  }
}

/** Error middleware after the authenticated checkout routes; always passes the original error on. */
async function captureFailure(err, req, res, next) {
  const steps = {
    '/orders': 'cod_order',
    '/orders/razorpay/init': 'checkout_validation',
    '/orders/razorpay/verify': 'payment_verify',
    '/cart/delivery-options': 'delivery',
  };
  const step = req.checkoutStep || steps[req.path];
  if (step && req.user) {
    await recordFailure({
      user: req.user._id,
      step,
      source: 'server',
      message: err.message,
      code: err.name,
      paymentMethod: req.path === '/orders' ? 'cod' : req.body?.paymentMethod,
      attemptId: req.body?.attemptId,
      razorpayOrderId: req.body?.razorpay_order_id,
      razorpayPaymentId: req.body?.razorpay_payment_id,
      httpStatus: Number(err.status || err.statusCode) || (res.statusCode >= 400 ? res.statusCode : 500),
    });
  }
  next(err);
}

/** A browser report: identity comes from the session, and a Razorpay order must belong to this account. */
async function report(user, body = {}) {
  if (!CLIENT_STEPS.includes(body.step) || typeof body.message !== 'string' || body.message.length > 600) {
    throw AppError.badRequest('Invalid checkout failure event');
  }
  const orderId = reference(body.razorpayOrderId);
  if (orderId && !(await failures.checkoutBelongsTo(orderId, user._id))) {
    throw AppError.forbidden('Checkout does not belong to this account');
  }
  await recordFailure({
    user: user._id,
    source: 'browser',
    step: body.step,
    message: body.message,
    code: body.code,
    paymentMethod: body.paymentMethod,
    attemptId: body.attemptId,
    razorpayOrderId: orderId,
  });
  return { recorded: true };
}

/** Admin feed, newest first, optionally one step. */
async function list(query) {
  const page = Math.min(10000, Math.max(1, parseInt(query.page, 10) || 1));
  const limit = Math.min(50, Math.max(1, parseInt(query.limit, 10) || 25));
  const filter = {};
  if (query.step) {
    if (!STEPS.includes(query.step)) throw AppError.badRequest('Invalid failure step');
    filter.step = query.step;
  }
  const [items, total] = await failures.page(filter, { skip: (page - 1) * limit, limit });
  return { items, page, limit, total };
}

module.exports = { STEPS, safeMessage, reference, recordFailure, captureFailure, report, list };
