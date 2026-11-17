/** Request schemas for the orders module (seller, customer and admin routes). */
const {
  z,
  objectId,
  orderRef,
  paging,
  boolish,
  optionalPositiveInt,
  optionalText,
  typeError,
} = require('../../validation/common');

/* ── params ───────────────────────────────────────────────────────────── */
const orderParams = z.object({ id: orderRef });
const requestParams = z.object({ id: orderRef, reqId: objectId });
const reqIdParams = z.object({ reqId: objectId });
const adminOrderParams = z.object({ idOrNumber: orderRef });

/* ── seller ───────────────────────────────────────────────────────────── */
const listQuery = paging({ maxLimit: 200 });
const ndrQuery = z.object({ page: paging().shape.page }).passthrough();

const updateStatus = z.object({
  status: z.enum(['confirmed'], {
    error: 'Only order confirmation can be set manually. Shipping and delivery are updated by the carrier.',
  }),
});

const courierId = optionalPositiveInt('courier_id must be a positive number.');

const ship = z.object({ courier_id: courierId, reschedulePickup: boolish.optional() }).passthrough();
const reschedulePickup = z.object({ courier_id: courierId }).passthrough();
const shipReplacement = z.object({ courier_id: courierId }).passthrough();
const hide = z.object({ hidden: boolish.optional() }).passthrough();

const ndrAction = z
  .object({
    action: z.enum(['re-attempt', 'return', 'fake-attempt'], {
      error: 'action must be one of: re-attempt, return, fake-attempt',
    }),
    comments: z.string().max(500, 'Comments must be at most 500 characters.').optional(),
    addressOverride: z.object({}).passthrough().optional(),
  })
  .passthrough();

const createReturn = z
  .object({
    items: z
      .array(z.object({ product: z.string().max(80) }).passthrough())
      .max(200)
      .optional(),
  })
  .passthrough();

const decline = z.object({
  reason: z
    .string(typeError('Please give the customer a reason (at least 5 characters).'))
    .trim()
    .min(5, 'Please give the customer a reason (at least 5 characters).')
    .max(1000, 'Reason must be at most 1000 characters.'),
});

const verifyReturn = z
  .object({
    ok: boolish.optional(),
    notes: z.string().max(500, 'Notes must be at most 500 characters.').optional(),
  })
  .passthrough();

/* ── customer ─────────────────────────────────────────────────────────── */
const addressId = z
  .string(typeError('Please pick a valid shipping address', 'Please pick a valid shipping address'))
  .trim()
  .min(1, 'Please pick a valid shipping address')
  .max(80, 'Please pick a valid shipping address');

const createOrder = z
  .object({
    addressId,
    paymentMethod: optionalText(20),
    notes: z.string().max(1000, 'Notes must be at most 1000 characters.').optional(),
    idempotencyKey: z.string().max(100, 'Invalid idempotency key').optional(),
    deliveryPicks: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const razorpayInit = z
  .object({
    addressId: z
      .string(typeError('addressId is required', 'addressId is required'))
      .trim()
      .min(1, 'addressId is required')
      .max(80, 'addressId is required'),
    notes: z.string().max(1000, 'Notes must be at most 1000 characters.').optional(),
    deliveryPicks: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const RAZORPAY_FIELDS_MESSAGE = 'Missing payment fields from Razorpay.';
const razorpayField = z
  .string(typeError(RAZORPAY_FIELDS_MESSAGE, RAZORPAY_FIELDS_MESSAGE))
  .min(1, RAZORPAY_FIELDS_MESSAGE)
  .max(200, RAZORPAY_FIELDS_MESSAGE);
const razorpayVerify = z
  .object({
    razorpay_order_id: razorpayField,
    razorpay_payment_id: razorpayField,
    razorpay_signature: razorpayField,
  })
  .passthrough();

const returnRequest = z
  .object({
    kind: z.preprocess(
      (v) => (typeof v === 'string' ? v.toLowerCase() : v),
      z.enum(['return', 'exchange'], { error: 'kind must be "return" or "exchange"' }),
    ),
    sellerId: optionalText(80),
    items: z.array(z.object({}).passthrough()).max(200).optional(),
    reason: z.string().max(1000, 'Reason must be at most 1000 characters.').optional(),
    reasonCode: z.string().max(50).optional(),
    desiredAction: z.string().max(500).optional(),
    attachments: z.array(z.object({}).passthrough()).max(6, 'At most 6 attachments.').optional(),
    refundUpi: z.string().max(100).optional(),
    refundBankName: z.string().max(100).optional(),
    refundAccountNo: z.string().max(30).optional(),
    refundIfsc: z.string().max(20).optional(),
  })
  .passthrough();

const invoiceQuery = z.object({ seller: optionalText(80) }).passthrough();
/** Multipart uploads: the files are the input; the body must only be an object. */
const anyBody = z.object({}).passthrough();

/* ── admin ────────────────────────────────────────────────────────────── */
const adminCancel = z
  .object({ reason: z.string().max(300, 'Reason must be at most 300 characters.').optional() })
  .passthrough();
const adminReschedule = z
  .object({
    sellerId: z
      .string(typeError('sellerId is required', 'sellerId is required'))
      .trim()
      .min(1, 'sellerId is required')
      .max(80, 'sellerId is required'),
  })
  .passthrough();
const refundProcess = z
  .object({
    reference: z.string().max(200, 'Reference must be at most 200 characters.').optional(),
    notes: z.string().max(500, 'Notes must be at most 500 characters.').optional(),
  })
  .passthrough();
const refundListQuery = z.object({ status: optionalText(20) }).passthrough();

module.exports = {
  orderParams,
  requestParams,
  reqIdParams,
  adminOrderParams,
  listQuery,
  ndrQuery,
  updateStatus,
  ship,
  reschedulePickup,
  shipReplacement,
  hide,
  ndrAction,
  createReturn,
  decline,
  verifyReturn,
  createOrder,
  razorpayInit,
  razorpayVerify,
  returnRequest,
  invoiceQuery,
  anyBody,
  adminCancel,
  adminReschedule,
  refundProcess,
  refundListQuery,
};
