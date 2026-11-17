/**
 * Checkout: reserve stock and persist the order, and the Razorpay
 * init → verify flow. Pricing lives in checkout-pricing.service; the
 * provider webhook in razorpay-webhook.service.
 */
const crypto = require('node:crypto');
const { AppError } = require('../../errors/AppError');
const { logger } = require('../../utils/logger');
const razorpay = require('../../infrastructure/payments/razorpay');
const orders = require('./orders.repository');
const checkoutRepo = require('./checkout.repository');
const inventory = require('./inventory.repository');
const parties = require('./parties.repository');
const notifications = require('./order-notifications');
const { readDeliveryPicks, buildOrderPayload } = require('./checkout-pricing.service');

/**
 * Persist an order from a validated payload + payment fields. Reserves
 * stock, empties the cart and fires the lifecycle emails. Shared by COD
 * create, Razorpay verify and the payment webhook.
 *
 * Ordering (audit A07):
 *   - UNPAID (COD): reserve first — all lines or none — THEN create.
 *   - PAID (online): the money is already captured, so the order is created
 *     unconditionally; a reservation conflict is flagged on the order for
 *     operations instead of stranding a captured payment.
 * @param {{ user: any, addr: any, items: any[], itemsTotal: number, shippingFee: number, total: number,
 *   deliverySelections?: any[], paymentMethod: string, paymentStatus: string, notes?: string,
 *   razorpayOrderId?: string, razorpayPaymentId?: string, razorpaySignature?: string, paymentInstrument?: any,
 *   codCharge?: number, idempotencyKey?: string, checkoutIntent?: any }} args
 */
async function finalizeOrder({
  user,
  addr,
  items,
  itemsTotal,
  shippingFee,
  total,
  deliverySelections = [],
  paymentMethod,
  paymentStatus,
  notes = '',
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature,
  paymentInstrument,
  codCharge = 0,
  idempotencyKey = '',
  checkoutIntent = null,
}) {
  // COD orders pay an extra convenience fee (set per-seller), persisted as
  // `codFee` (audit A11) so downstream charge allocations can reconcile.
  const codFee = paymentMethod === 'cod' ? Number(codCharge) || 0 : 0;
  if (codFee > 0) total = (total || 0) + codFee;

  const paid = paymentStatus === 'paid';
  const orderDoc = {
    user: user._id,
    items,
    shippingAddress: {
      label: addr.label,
      fullName: addr.fullName,
      phone: addr.phone,
      line1: addr.line1,
      line2: addr.line2,
      city: addr.city,
      state: addr.state,
      pincode: addr.pincode,
      country: addr.country,
    },
    itemsTotal,
    shippingFee,
    // Per-seller delivery the customer paid for, with the courier they picked.
    delivery: (deliverySelections || []).map((d) => ({
      seller: d.sellerId || d.seller,
      amount: Number(d.rate ?? d.amount) || 0,
      courierId: d.courierId,
      courierName: d.courierName || '',
      etd: d.etd || '',
      chosen: d.chosen === true,
      quotedAt: new Date(),
    })),
    codFee,
    total,
    paymentMethod,
    paymentStatus,
    status: 'placed',
    notes,
    razorpayOrderId: razorpayOrderId || '',
    razorpayPaymentId: razorpayPaymentId || '',
    razorpaySignature: razorpaySignature || '',
    idempotencyKey: idempotencyKey || '',
    ...(checkoutIntent ? { checkoutIntent } : {}),
    ...(paymentInstrument ? { paymentInstrument } : {}),
    paidAt: paid ? new Date() : undefined,
  };

  let order;
  try {
    order = await orders.runInTransaction(async (session) => {
      const created = orders.newOrder(orderDoc);
      const rsv = await inventory.reserveStock(items, session);
      if (!rsv.ok) {
        if (!paid) throw AppError.conflict('An item just sold out. Refresh your cart.');
        await inventory.releaseStock(rsv.applied, session);
        created.inventoryReserved = false;
        created.fulfillmentHold =
          'Stock unavailable after payment. Cancel and refund or resolve inventory before dispatch.';
      } else {
        created.inventoryReserved = true;
        created.set('stockReservations', rsv.applied);
      }
      await created.save({ session });
      return created;
    });
  } catch (e) {
    if (e?.code === 11000) {
      const existing = await orders.findDuplicateOnCreate(paid, user._id, razorpayPaymentId, idempotencyKey);
      if (existing) return existing;
    }
    throw e;
  }

  // Lower the live cart by what was bought, line by line, without touching
  // anything added since the quote.
  try {
    for (const purchased of items) {
      const current = await checkoutRepo.cartForUser(user._id);
      if (!current) break;
      const line = current.items.find(
        (it) =>
          String(it.product) === String(purchased.product) &&
          (it.size || '') === (purchased.size || '') &&
          (it.color || '') === (purchased.color || ''),
      );
      if (!line) continue;
      const quantity = Math.max(0, line.quantity - purchased.quantity);
      if (quantity) await checkoutRepo.setCartLineQuantity(current._id, line, quantity);
      else await checkoutRepo.pullCartLine(current._id, line);
    }
  } catch (e) {
    logger.warn({ err: e }, 'order finalize: cart clear failed');
  }

  notifications
    .emailSellersForOrder(order, user.name)
    .catch((e) => logger.error({ err: e }, 'emailSellersForOrder error'));
  notifications
    .sendCustomerStatusEmail(order._id, 'placed')
    .catch((e) => logger.error({ err: e }, 'sendCustomerStatusEmail error'));
  notifications.notifyTeamOfOrder(order._id, 'placed').catch(() => {
    /* already logged */
  });
  // shippingPushPending was committed with the order. The worker resumes it
  // after a process restart and serializes it with cancellation/dispatch.
  return order;
}

/** COD order from the cart. `{ order, duplicate }`. */
async function placeCodOrder(user, body, headers) {
  const { addressId, paymentMethod = 'cod', notes = '' } = body;
  if (paymentMethod !== 'cod')
    throw AppError.badRequest('For online payments, use the Razorpay flow (/orders/razorpay/init).');
  // COD idempotency (audit A07): a retried request with the same key gets
  // the SAME order back. Key comes from the client (header or body).
  const rawKey = headers['idempotency-key'] || body?.idempotencyKey || '';
  if (typeof rawKey !== 'string' || rawKey.length > 100) throw AppError.badRequest('Invalid idempotency key');
  const idempotencyKey = rawKey ? crypto.createHash('sha256').update(`${user._id}:${rawKey}`).digest('hex') : '';
  if (idempotencyKey) {
    const existing = await orders.findByIdempotencyKey(user._id, idempotencyKey);
    if (existing) return { order: existing, duplicate: true };
  }
  const payload = await buildOrderPayload(user._id, addressId, { deliveryPicks: readDeliveryPicks(body), cod: true });
  // Server-side COD gate so a tampered client can't sneak a COD order past an opted-out seller.
  if (!payload.codEligible) {
    throw AppError.badRequest(
      'Cash on Delivery isn’t available for one or more items in your cart. ' +
        'Please switch to online payment or remove those items.',
    );
  }
  const order = await finalizeOrder({
    ...payload,
    paymentMethod: 'cod',
    paymentStatus: 'pending',
    notes,
    codCharge: payload.codChargeMax,
    idempotencyKey,
  });
  return { order, duplicate: false };
}

/**
 * Step 1 of the online flow: validate cart + address, persist the checkout
 * SNAPSHOT (audit A02/A06), create the Razorpay order. No DB order yet.
 */
async function initRazorpayCheckout(user, body, { onStep = (_step) => {} } = {}) {
  const addressId = body?.addressId;
  if (!addressId) throw AppError.badRequest('addressId is required');

  const payload = await buildOrderPayload(user._id, addressId, { deliveryPicks: readDeliveryPicks(body), cod: false });
  const { addr, total } = payload;
  const amountPaise = Math.round(total * 100);

  // From here a failure is the payment step, not cart validation
  // (the customers module's captureCheckoutFailure reads the step off the request).
  onStep('payment_init');
  const intent = await checkoutRepo.createIntent({
    user: user._id,
    shippingAddress: {
      label: addr.label,
      fullName: addr.fullName,
      phone: addr.phone,
      line1: addr.line1,
      line2: addr.line2,
      city: addr.city,
      state: addr.state,
      pincode: addr.pincode,
      country: addr.country,
    },
    items: payload.items,
    itemsTotal: payload.itemsTotal,
    shippingFee: payload.shippingFee,
    deliverySelections: payload.deliverySelections,
    total,
    amountPaise,
    currency: 'INR',
    notes: String(body?.notes || ''),
  });

  // Receipt = intent id — a stable, server-owned reference (≤ 40 chars).
  const receipt = `int-${intent._id}`;
  let rpOrder;
  try {
    rpOrder = await razorpay.createOrder({
      amount: amountPaise,
      currency: 'INR',
      receipt,
      notes: { userId: String(user._id), intentId: String(intent._id) },
    });
  } catch (e) {
    // Nothing was charged — drop the orphan intent so TTL isn't needed.
    await checkoutRepo.deleteIntent(intent._id).catch(() => {});
    logger.error({ err: e }, 'razorpay createOrder failed');
    throw AppError.upstream(`Couldn't initialise payment: ${e.message}`);
  }
  intent.razorpayOrderId = rpOrder.id;
  await intent.save();

  return {
    success: true,
    razorpayOrderId: rpOrder.id,
    amount: rpOrder.amount, // paise
    currency: rpOrder.currency,
    keyId: razorpay.keyId(), // public-safe, frontend needs it
    customer: { name: addr.fullName, email: user.email || '', contact: addr.phone || '' },
    receipt,
    // EMI availability for THIS cart total, computed server-side from the
    // same payload the charge is built from.
    emi: {
      eligible: razorpay.emiEligible(total),
      minAmount: razorpay.EMI_MIN_AMOUNT,
      monthlyFrom: razorpay.emiMonthlyFrom(total),
      maxTenure: razorpay.EMI_MAX_TENURE,
    },
  };
}

/** Shared payment↔intent assertions (browser verify + webhook). `res` is accepted for compatibility and unused. */
function assertPaymentMatchesIntent(payment, intent, expectedOrderId, _res) {
  if (!payment || payment.order_id !== expectedOrderId)
    throw AppError.badRequest('Payment does not belong to this checkout.');
  if (payment.status !== 'captured') {
    throw AppError.badRequest(
      `Payment not captured yet (${payment.status || 'unknown'}) · your order is created once it completes`,
    );
  }
  if (Number(payment.amount) !== Number(intent.amountPaise)) {
    throw AppError.badRequest('Payment amount does not match this checkout. Contact support with your payment id.');
  }
  if (String(payment.currency || 'INR') !== String(intent.currency || 'INR')) {
    throw AppError.badRequest('Payment currency does not match this checkout.');
  }
}

/**
 * Finalize an order from a CheckoutIntent exactly once (audit A02/A06).
 * The claim is atomic, so the browser verify and the webhook can race
 * safely: one finalizes, the other gets the completed intent's order back.
 */
async function finalizeIntent(intent, { razorpayPaymentId, razorpaySignature = '', paymentInstrument, gatewayFee }) {
  const claimed = await checkoutRepo.claimIntentForFinalize(intent._id);
  if (!claimed) {
    const fresh = await checkoutRepo.findIntentById(intent._id);
    if (fresh?.status === 'completed' && fresh.order) {
      const existing = await orders.findById(fresh.order);
      if (existing) return existing;
    }
    throw AppError.conflict('This payment is already being processed. Check your orders in a moment.');
  }

  try {
    const owner = await parties.customerContact(claimed.user);
    const items = claimed.items.map((it) => (typeof it.toObject === 'function' ? it.toObject() : it));
    const order = await finalizeOrder({
      user: owner || { _id: claimed.user, name: '' },
      addr: claimed.shippingAddress,
      items,
      itemsTotal: claimed.itemsTotal,
      shippingFee: claimed.shippingFee,
      deliverySelections: (claimed.deliverySelections || []).map((d) =>
        typeof d.toObject === 'function' ? d.toObject() : d,
      ),
      total: claimed.total,
      paymentMethod: 'online',
      paymentStatus: 'paid',
      notes: claimed.notes,
      razorpayOrderId: claimed.razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      ...(paymentInstrument ? { paymentInstrument } : {}),
      ...(gatewayFee ? { gatewayFee } : {}),
      checkoutIntent: claimed._id,
    });
    claimed.status = 'completed';
    claimed.order = order._id;
    claimed.expiresAt = undefined;
    await claimed.save();
    return order;
  } catch (e) {
    await checkoutRepo.releaseIntentClaim(claimed._id).catch(() => {});
    throw e;
  }
}

/**
 * Step 2 of the online flow: verify the checkout signature, bind the
 * captured payment to the intent it funds (owner, amount, currency,
 * provider order — audit A02), then create the order. `{ order, duplicate }`.
 */
async function verifyRazorpayCheckout(user, body, { onStep = (_step) => {} } = {}) {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body || {};
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    throw AppError.badRequest('Missing payment fields from Razorpay.');
  }
  if (!razorpay.verifyCheckoutSignature({ razorpay_order_id, razorpay_payment_id, razorpay_signature })) {
    throw AppError.badRequest('Payment signature invalid — payment was not verified.');
  }
  const intent = await checkoutRepo.findIntentByRazorpayOrder(razorpay_order_id);
  if (!intent) {
    throw AppError.badRequest('No checkout found for this payment · contact support with your payment id');
  }
  if (String(intent.user) !== String(user._id))
    throw AppError.forbidden('This payment belongs to a different account.');
  if (intent.status === 'completed' && intent.order) {
    const existing = await orders.findById(intent.order);
    if (existing) return { order: existing, duplicate: true };
  }

  // Provider state is REQUIRED — a signature alone doesn't say how much was captured.
  let payment;
  try {
    payment = await razorpay.getPayment(razorpay_payment_id);
  } catch (e) {
    throw AppError.upstream(`Couldn't confirm the payment with Razorpay: ${e.message}. Try again in a moment.`);
  }
  assertPaymentMatchesIntent(payment, intent, razorpay_order_id);

  onStep('order_finalize');
  const order = await finalizeIntent(intent, {
    razorpayPaymentId: razorpay_payment_id,
    razorpaySignature: razorpay_signature,
    paymentInstrument: razorpay.describePayment(payment) || undefined,
    gatewayFee: razorpay.describeFee(payment) || undefined,
  });
  return { order, duplicate: false };
}

module.exports = {
  readDeliveryPicks,
  buildOrderPayload,
  finalizeOrder,
  finalizeIntent,
  assertPaymentMatchesIntent,
  placeCodOrder,
  initRazorpayCheckout,
  verifyRazorpayCheckout,
};
