/**
 * Refunds. Sellers raise the request; admin holds the payment account and
 * is the only one who can issue money. Razorpay results (synchronous or
 * via webhook) are applied through one path so replays cannot regress.
 */
const { AppError } = require('../../errors/AppError');
const { logger } = require('../../utils/logger');
const razorpay = require('../../infrastructure/payments/razorpay');
const orders = require('./orders.repository');

/** Apply a verified provider result atomically. Replayed/late events cannot regress completion. */
async function applyRazorpayRefund(refund) {
  if (!refund?.id || !refund.payment_id || !['pending', 'processed', 'failed'].includes(refund.status)) {
    throw AppError.badRequest('Invalid refund result.');
  }
  const matched = await orders.findIdByRazorpayPayment(refund.payment_id);
  if (!matched) return null;
  return orders.withFulfillmentLock(matched._id, async () => {
    const order = await orders.findById(matched._id);
    const r = (order.returnRequests || []).find(
      (entry) =>
        entry.refundReference === refund.id ||
        (refund.notes?.refundRequestId && String(entry._id) === String(refund.notes.refundRequestId)),
    );
    if (!r || r.refundMethod !== 'razorpay' || Number(refund.amount) !== Math.round(Number(r.refundAmount) * 100)) {
      throw AppError.badRequest('Refund does not match its local obligation.');
    }
    // Old failed-attempt events must not overwrite a newer retry. Older
    // obligations without an attempt marker retain their legacy matching.
    if (r.refundAttemptId && refund.notes?.refundAttemptId !== r.refundAttemptId) return order;
    if (r.refundStatus === 'failed' && refund.status === 'pending') return order;
    if (r.refundReference && r.refundReference !== refund.id && r.refundStatus !== 'failed') {
      throw AppError.badRequest('Unexpected refund reference.');
    }
    const status = refund.status === 'processed' ? 'completed' : refund.status === 'failed' ? 'failed' : 'processing';
    const changes = { 'returnRequests.$.refundReference': refund.id, 'returnRequests.$.refundStatus': status };
    if (status === 'completed') {
      changes['returnRequests.$.refundCompletedAt'] = new Date();
      changes['returnRequests.$.status'] = 'completed';
    }
    await orders.applyRefundResult(order._id, r._id, changes, refund.id);
    await orders.recomputeRefundedPayment(order._id);
    return orders.findById(order._id);
  });
}

/**
 * Admin processes one refund request. Online → Razorpay refund against the
 * original payment; COD → the admin records the manual transfer reference.
 * Returns `{ status, body }` for the HTTP layer.
 */
async function processRefund(reqId, adminId, body) {
  const existing = await orders.findOrderByReturnRequest(reqId);
  const before = existing?.returnRequests?.id(reqId);
  if (!before) throw AppError.notFound('Refund request not found');
  const amount = Math.round(Number(before.refundAmount) * 100);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > Math.round(existing.total * 100)) {
    throw AppError.badRequest('Invalid refund amount');
  }
  const reference = String(body?.reference || '').trim();
  if (before.refundMethod !== 'razorpay' && !reference)
    throw AppError.badRequest('Supply the bank or UPI transaction reference.');
  if (before.refundMethod === 'razorpay' && !existing.razorpayPaymentId)
    throw AppError.badRequest('This order has no provider payment.');

  const order = await orders.claimRefundProcessing(existing, reqId, amount, { adminId, notes: body?.notes });
  if (!order) throw AppError.conflict('Refund is already processing or completed.');
  const r = order.returnRequests.id(reqId);
  if (r.refundMethod !== 'razorpay') {
    await orders.completeManualRefund(order._id, r._id, reference);
    await orders.recomputeRefundedPayment(order._id);
    return { status: 200, body: { ok: true, message: 'Manual refund recorded.' } };
  }
  try {
    const refund = await razorpay.refundPayment({
      paymentId: order.razorpayPaymentId,
      amount,
      notes: {
        reason: r.reasonCode,
        order: order.orderNumber,
        refundRequestId: String(r._id),
        refundAttemptId: r.refundAttemptId,
      },
    });
    const updated = await applyRazorpayRefund(refund);
    return {
      status: 200,
      body: {
        ok: true,
        refund: updated?.returnRequests?.id(r._id),
        message:
          refund.status === 'processed'
            ? 'Refund processed.'
            : refund.status === 'failed'
              ? 'The provider rejected this refund. Review it before retrying.'
              : 'Refund submitted; awaiting confirmation.',
      },
    };
  } catch (error) {
    // A timeout can happen AFTER the provider accepted the transfer. Never
    // make the operation retryable until reconciliation proves it failed.
    await orders.markRefundUncertain(order._id, r._id);
    logger.error({ err: error, requestId: String(r._id) }, 'refund: reconciliation required');
    return {
      status: 202,
      body: {
        ok: true,
        reconciliationRequired: true,
        message: 'Refund status is uncertain. Use Check provider status before retrying.',
      },
    };
  }
}

/** Admin asks the provider what happened to an uncertain refund. `{ status, body }`. */
async function reconcileRefund(reqId) {
  const order = await orders.findOrderByReturnRequest(reqId);
  const r = order?.returnRequests?.id(reqId);
  if (!r || r.refundMethod !== 'razorpay') throw AppError.notFound('Provider refund not found');
  const refunds = await razorpay.listPaymentRefunds(order.razorpayPaymentId);
  const matches = refunds.filter(
    (refund) =>
      (refund.id === r.refundReference || String(refund.notes?.refundRequestId || '') === String(r._id)) &&
      (!r.refundAttemptId || refund.notes?.refundAttemptId === r.refundAttemptId),
  );
  if (!matches.length) {
    return {
      status: 202,
      body: {
        ok: true,
        message: 'No matching refund is visible yet. The request remains locked to prevent a duplicate transfer.',
      },
    };
  }
  for (const refund of matches) await applyRazorpayRefund(refund);
  const fresh = await orders.findById(order._id);
  return {
    status: 200,
    body: { ok: true, refund: fresh.returnRequests.id(r._id), message: 'Provider status checked.' },
  };
}

/** How long an unconfirmed provider attempt stays locked before it may be released for a retry. */
const RELEASE_AFTER_MS = 60 * 60 * 1000;

const providerRefundsFor = async (order, r) =>
  (await razorpay.listPaymentRefunds(order.razorpayPaymentId)).filter(
    (refund) =>
      (refund.id === r.refundReference || String(refund.notes?.refundRequestId || '') === String(r._id)) &&
      (!r.refundAttemptId || refund.notes?.refundAttemptId === r.refundAttemptId),
  );

/**
 * Admin releases a refund whose provider call never answered, so it can be
 * sent again. Refused while the attempt is younger than RELEASE_AFTER_MS,
 * and never performed when Razorpay does have a record — that record is
 * applied instead, since the money has already moved. `{ status, body }`.
 */
async function releaseRefund(reqId, actor) {
  const order = await orders.findOrderByReturnRequest(reqId);
  const r = order?.returnRequests?.id(reqId);
  if (!r || r.refundMethod !== 'razorpay') throw AppError.notFound('Provider refund not found');
  if (r.refundStatus !== 'processing')
    throw AppError.conflict('Only a refund that is still processing can be released.');
  const attemptedAt = r.refundAttemptAt || r.refundRequestedAt;
  const ageMs = attemptedAt ? Date.now() - new Date(attemptedAt).getTime() : Infinity;
  if (ageMs < RELEASE_AFTER_MS) {
    const wait = Math.ceil((RELEASE_AFTER_MS - ageMs) / 60000);
    throw AppError.conflict(
      `Razorpay can still confirm this attempt. Try releasing it in ${wait} minute${wait === 1 ? '' : 's'}.`,
    );
  }
  const matches = await providerRefundsFor(order, r);
  if (matches.length) {
    for (const refund of matches) await applyRazorpayRefund(refund);
    const fresh = await orders.findById(order._id);
    return {
      status: 200,
      body: {
        ok: true,
        applied: true,
        refund: fresh.returnRequests.id(r._id),
        message: 'Razorpay had a record of this refund after all; its status is applied.',
      },
    };
  }
  const note = `Released on ${new Date().toISOString().slice(0, 16).replace('T', ' ')} by ${actor || 'admin'} — Razorpay had no record of the attempt.`;
  const updated = await orders.releaseRefundForRetry(order._id, r._id, note);
  if (!updated) throw AppError.conflict('This refund changed while you were looking at it. Reload and try again.');
  logger.info({ requestId: String(r._id), orderNumber: order.orderNumber, actor }, 'refund: released for retry');
  return { status: 200, body: { ok: true, released: true, refund: updated.returnRequests.id(r._id) } };
}

module.exports = { applyRazorpayRefund, processRefund, reconcileRefund, releaseRefund, RELEASE_AFTER_MS };
