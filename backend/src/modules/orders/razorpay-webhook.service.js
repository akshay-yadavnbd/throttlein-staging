/**
 * Provider-to-server payment events (audit A06). Finalizes `payment.captured`
 * from the intent snapshot so the order exists even when the browser never
 * comes back; records `payment.failed`; applies refund events. Returns
 * `{ status, body }` for the HTTP layer. Razorpay retries on non-2xx, which
 * is what we want for transient DB errors.
 */
const { logger } = require('../../utils/logger');
const razorpay = require('../../infrastructure/payments/razorpay');
const checkoutRepo = require('./checkout.repository');
const { finalizeIntent, assertPaymentMatchesIntent } = require('./checkout.service');
const { applyRazorpayRefund } = require('./refunds.service');

const recordFailure = (data) => require('../customers').recordCheckoutFailure(data);

async function handleRazorpayWebhook({ rawBody, signature }) {
  if (!rawBody || !razorpay.verifyWebhookSignature({ body: rawBody, signature })) {
    // Every event lands here while RAZORPAY_WEBHOOK_SECRET is unset or wrong — say so.
    logger.warn('razorpay webhook rejected: signature missing or invalid');
    return { status: 400, body: { ok: false, error: 'bad signature' } };
  }
  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    event = null;
  }
  if (!event) return { status: 400, body: { ok: false, error: 'bad payload' } };

  if (['refund.created', 'refund.processed', 'refund.failed'].includes(event.event)) {
    await applyRazorpayRefund(event.payload?.refund?.entity);
    return { status: 200, body: { ok: true } };
  }

  if (event.event === 'payment.failed') {
    const payment = event.payload?.payment?.entity;
    const intent = payment?.order_id && (await checkoutRepo.findIntentByRazorpayOrder(payment.order_id));
    // error_code is nearly always the generic BAD_REQUEST_ERROR; error_reason
    // and error_source say what happened.
    const detail = [
      payment.error_reason,
      payment.error_source && `source: ${payment.error_source}`,
      payment.method && `method: ${payment.method}`,
    ]
      .filter(Boolean)
      .join(', ');
    if (intent)
      await recordFailure({
        user: intent.user,
        step: 'payment_failed',
        source: 'webhook',
        message: `${payment.error_description || 'Payment failed'}${detail ? ` (${detail})` : ''}`,
        code: payment.error_reason || payment.error_code,
        paymentMethod: ['emi', 'cardless_emi'].includes(payment.method) ? 'emi' : 'online',
        razorpayOrderId: payment.order_id,
        razorpayPaymentId: payment.id,
      });
    return { status: 200, body: { ok: true } };
  }
  if (event.event !== 'payment.captured') {
    return { status: 200, body: { ok: true, ignored: event.event || 'unknown' } };
  }

  const payment = event.payload?.payment?.entity;
  const rpOrderId = payment?.order_id;
  if (!payment || !rpOrderId) return { status: 200, body: { ok: true, ignored: 'no payment entity' } };

  const intent = await checkoutRepo.findIntentByRazorpayOrder(rpOrderId);
  if (!intent) {
    logger.error(
      { paymentId: payment.id, razorpayOrderId: rpOrderId },
      'razorpay webhook: captured payment with no local intent',
    );
    return { status: 200, body: { ok: true, unmatched: true } };
  }
  if (intent.status === 'completed') return { status: 200, body: { ok: true, duplicate: true } };

  try {
    assertPaymentMatchesIntent(payment, intent, rpOrderId, null);
    const order = await finalizeIntent(intent, {
      razorpayPaymentId: payment.id,
      paymentInstrument: razorpay.describePayment(payment) || undefined,
      gatewayFee: razorpay.describeFee(payment) || undefined,
    });
    logger.info({ orderNumber: order.orderNumber, paymentId: payment.id }, 'razorpay webhook: order finalized');
    return { status: 200, body: { ok: true, order: order.orderNumber } };
  } catch (e) {
    await recordFailure({
      user: intent.user,
      step: 'order_finalize',
      source: 'webhook',
      message: e.message,
      razorpayOrderId: rpOrderId,
      razorpayPaymentId: payment.id,
      httpStatus: e.status || 500,
    });
    // 409 = the browser verify is mid-flight — acknowledge. Amount / currency
    // mismatches are permanent: acknowledge but log for humans.
    if (e.status === 409) return { status: 409, body: { ok: false, retry: true } };
    if (e.status === 400) {
      logger.error({ err: e, paymentId: payment.id }, 'razorpay webhook: payment/intent mismatch');
      return { status: 200, body: { ok: true, mismatch: true } };
    }
    logger.error({ err: e, paymentId: payment.id }, 'razorpay webhook: finalize failed');
    return { status: 500, body: { ok: false } };
  }
}

module.exports = { handleRazorpayWebhook };
