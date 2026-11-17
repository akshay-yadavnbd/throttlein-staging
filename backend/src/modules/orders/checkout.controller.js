/**
 * Placing an order: COD create, the Razorpay init → verify pair, and the
 * Razorpay webhook. `req.checkoutStep` is read by the customers module (captureCheckoutFailure)
 * to label a failure with the step it happened in.
 */
const asyncHandler = require('express-async-handler');
const { sendData, sendCreated } = require('../../utils/apiResponse');
const checkout = require('./checkout.service');
const { handleRazorpayWebhook } = require('./razorpay-webhook.service');

/** POST /api/orders — COD. Online payments go through /orders/razorpay/*. */
exports.create = asyncHandler(async (req, res) => {
  const { order, duplicate } = await checkout.placeCodOrder(req.user, req.body, req.headers);
  if (duplicate) return sendData(res, { order, duplicate: true });
  sendCreated(res, { order });
});

/** POST /api/orders/razorpay/init  { addressId, notes?, deliveryPicks? } */
exports.razorpayInit = asyncHandler(async (req, res) => {
  sendData(
    res,
    await checkout.initRazorpayCheckout(req.user, req.body, {
      onStep: (step) => {
        req.checkoutStep = step;
      },
    }),
  );
});

/** POST /api/orders/razorpay/verify  { razorpay_order_id, razorpay_payment_id, razorpay_signature } */
exports.razorpayVerify = asyncHandler(async (req, res) => {
  const { order, duplicate } = await checkout.verifyRazorpayCheckout(req.user, req.body, {
    onStep: (step) => {
      req.checkoutStep = step;
    },
  });
  if (duplicate) return sendData(res, { order, duplicate: true });
  sendCreated(res, { order });
});

/** POST /api/hooks/razorpay — provider events; always answers quickly. */
exports.razorpayWebhook = asyncHandler(async (req, res) => {
  const raw = req.rawBody || (Buffer.isBuffer(req.body) ? req.body : null);
  const { status, body } = await handleRazorpayWebhook({
    rawBody: raw,
    signature: req.headers['x-razorpay-signature'],
  });
  res.status(status).json(body);
});
