/**
 * Razorpay service.
 *
 * Centralised wrapper around https://api.razorpay.com — every other piece of
 * the integration (order creation, signature verification, refunds, webhook
 * handling) imports from here so credentials + error shape live in one place.
 *
 * Env vars
 * --------
 *   RAZORPAY_KEY_ID            public-safe key id (rzp_test_… / rzp_live_…)
 *   RAZORPAY_KEY_SECRET        backend-only secret used for signing
 *   RAZORPAY_WEBHOOK_SECRET    optional — verified on inbound webhook events
 *
 * NEVER expose RAZORPAY_KEY_SECRET to the frontend. Use keyId() in API
 * responses where the checkout SDK needs the public key.
 */
const crypto = require('crypto');
const Razorpay = require('razorpay');
const { env } = require('../../config/env');

const KEY_ID = env.RAZORPAY_KEY_ID || '';
const KEY_SECRET = env.RAZORPAY_KEY_SECRET || '';

/**
 * Minimum order value (in ₹) for EMI.
 *
 * Card EMI is an arrangement between the CUSTOMER'S ISSUING BANK and
 * Razorpay — we don't set the floor, the banks do, and virtually all of
 * them reject EMI below ₹3,000. Offering it under that threshold means
 * the customer picks EMI, reaches the bank step, and gets a failure
 * they can't act on. So the tile is gated client-side AND the amount is
 * re-checked here, since the client value is only a hint.
 *
 * Override per-environment with EMI_MIN_AMOUNT if a no-cost/cardless
 * provider with a lower floor is enabled on the account.
 */
const EMI_MIN_AMOUNT = Number(env.EMI_MIN_AMOUNT || 3000);

/**
 * Interest rate (annual %) used ONLY for the indicative "from ₹X/month"
 * figure shown on the checkout tile. The real rate comes from the
 * customer's bank inside Razorpay's checkout and varies by issuer and
 * tenure — this is a display estimate, labelled as such in the UI.
 */
const EMI_INDICATIVE_RATE = Number(env.EMI_INDICATIVE_RATE || 14);

/** Longest tenure we quote the "from" price against (months). */
const EMI_MAX_TENURE = Number(env.EMI_MAX_TENURE || 12);

let client = null;
/**
 * Lazy-instantiate the Razorpay client. Throws a clear error if env vars
 * are missing so we don't fail with a cryptic "Authentication failed" from
 * Razorpay's API.
 */
function getClient() {
  if (client) return client;
  if (!KEY_ID || !KEY_SECRET) {
    throw new Error('Razorpay credentials missing. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in backend/.env.');
  }
  client = new Razorpay({ key_id: KEY_ID, key_secret: KEY_SECRET });
  // The locked SDK exposes its Axios instance here; it otherwise waits
  // indefinitely. Refund timeouts remain locked for reconciliation.
  /** @type {any} */ (client.api).rq.defaults.timeout = 20000;
  return client;
}

/** Public-safe key id — fine to return in API responses. */
function keyId() {
  return KEY_ID;
}

/**
 * Create a Razorpay order. Amount must be in paise (₹1 = 100).
 *
 * @param {object} args
 * @param {number} args.amount   - in paise (integer)
 * @param {string} args.currency - default INR
 * @param {string} args.receipt  - your own reference id (≤40 chars)
 * @param {object} [args.notes]  - free-form metadata stored on the order
 * @returns {Promise<object>}    - Razorpay order with .id, .amount, .currency, .status
 */
async function createOrder({ amount, currency = 'INR', receipt, notes = {} }) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('amount must be a positive number in paise');
  }
  // Auto-tag every order with the website source so the Razorpay
  // dashboard can filter revenue per-site. Each backend deployment
  // sets its own value in .env:
  //   PAYMENT_SOURCE_TAG=throttlein     (this site)
  //   PAYMENT_SOURCE_TAG=site-b         (the other site)
  // In the dashboard go to Transactions → Filters → "Notes" and
  // search by `source: throttlein` (or whichever tag) to see only
  // that site's revenue, and export filtered CSVs for reconciliation.
  // Falls back to 'unknown' so misconfigured environments are obvious
  // rather than silently merging into one bucket.
  const source = env.PAYMENT_SOURCE_TAG || 'unknown';
  const taggedNotes = { source, ...notes };
  return getClient().orders.create({
    amount: Math.round(amount),
    currency,
    receipt: String(receipt || '').slice(0, 40),
    notes: taggedNotes,
    payment_capture: 1, // auto-capture once authorised
  });
}

/**
 * Verify the checkout signature Razorpay returns to the frontend on a
 * successful payment. The frontend posts { razorpay_order_id,
 * razorpay_payment_id, razorpay_signature } to our verify endpoint; we
 * recompute HMAC-SHA256(orderId + '|' + paymentId, key_secret) and check it
 * matches. Constant-time comparison to avoid timing attacks.
 */
function verifyCheckoutSignature({ razorpay_order_id, razorpay_payment_id, razorpay_signature }) {
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return false;
  }
  if (!KEY_SECRET) return false;
  const expected = crypto
    .createHmac('sha256', KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');
  // Buffer.compare-style constant time check
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(razorpay_signature), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Verify inbound webhook signature (X-Razorpay-Signature header). Body must
 * be the RAW request body string — Express's json parser is destructive,
 * so the webhook route uses express.raw() and we hash that buffer.
 * @param {{ body: Buffer | string, signature: string, secret?: string }} args
 */
function verifyWebhookSignature({ body, signature, secret }) {
  const sec = secret || env.RAZORPAY_WEBHOOK_SECRET || '';
  if (!sec || !signature) return false;
  const expected = crypto.createHmac('sha256', sec).update(body).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(signature), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Issue a refund (full or partial) for a captured payment. amount is in
 * paise; omit for a full refund.
 */
async function refundPayment({ paymentId, amount, notes = {} }) {
  if (!paymentId) throw new Error('paymentId is required');
  // Same source-tag treatment as createOrder, so refund rows are also
  // filterable per-site in the dashboard.
  const source = env.PAYMENT_SOURCE_TAG || 'unknown';
  const opts = { notes: { source, ...notes } };
  if (amount != null) opts.amount = Math.round(amount);
  return getClient().payments.refund(paymentId, opts);
}

/** Fetch payment details by id — useful for reconciliation. */
async function getPayment(paymentId) {
  return getClient().payments.fetch(paymentId);
}

async function listPaymentRefunds(paymentId) {
  const result = [];
  for (let skip = 0; skip < 10000; skip += 100) {
    const page = await getClient().payments.fetchMultipleRefund(paymentId, { count: 100, skip });
    result.push(...(page.items || []));
    if ((page.items || []).length < 100) return result;
  }
  throw new Error('Refund history exceeds the reconciliation limit.');
}

/* ─────────────── EMI ─────────────── */

/** Is this order value eligible for EMI? `total` is in RUPEES. */
function emiEligible(total) {
  return Number(total) >= EMI_MIN_AMOUNT;
}

/**
 * Indicative monthly instalment at the longest tenure we quote — the
 * "EMI from ₹X/month" figure on the checkout tile.
 *
 * Standard reducing-balance amortisation:
 *   EMI = P·r·(1+r)^n / ((1+r)^n − 1),  r = annual/12/100
 *
 * Returns 0 when the amount isn't EMI-eligible, so callers can use the
 * value's truthiness as the gate.
 */
function emiMonthlyFrom(total, tenure = EMI_MAX_TENURE) {
  const p = Number(total);
  if (!emiEligible(p)) return 0;
  const r = EMI_INDICATIVE_RATE / 12 / 100;
  const n = Math.max(1, Number(tenure) || EMI_MAX_TENURE);
  if (r === 0) return Math.ceil(p / n);
  const factor = Math.pow(1 + r, n);
  return Math.ceil((p * r * factor) / (factor - 1));
}

/**
 * Normalise a Razorpay payment object into the instrument fields we
 * persist on the order.
 *
 * WHY WE STORE THIS
 * `paymentMethod: 'online'` is all the order carried before, so an EMI
 * purchase was indistinguishable from a UPI one — support couldn't
 * answer "which bank is billing me?" and refunds on EMI (where the
 * bank keeps charging instalments until the reversal lands) had no
 * paper trail. Razorpay knows all of it on the payment object; we just
 * have to ask.
 *
 * Shape of the EMI bits on a Razorpay payment:
 *   method: 'emi'
 *   bank:   'HDFC'
 *   emi_plan: { duration: 9, interest: 14, ... }   // not always present
 *   card:   { network, last4, issuer, type }
 */
function describePayment(p) {
  if (!p || typeof p !== 'object') return null;
  const out = {
    method: p.method || '',
    bank: p.bank || p.card?.issuer || '',
    wallet: p.wallet || '',
    vpa: p.vpa || '',
    cardLast4: p.card?.last4 || '',
    cardNetwork: p.card?.network || '',
  };
  if (p.method === 'emi') {
    // `emi_plan` is only expanded on some accounts/versions — fall back
    // to the top-level fields Razorpay always sends rather than
    // recording a blank EMI.
    const plan = p.emi_plan || {};
    out.emi = {
      tenureMonths: Number(plan.duration || p.emi?.duration || 0) || 0,
      interestRate: Number(plan.interest ?? p.emi?.interest ?? 0) || 0,
      issuer: p.bank || p.card?.issuer || '',
    };
  }
  return out;
}

/**
 * Gateway charge for a captured payment, in rupees. Razorpay reports
 * `fee` (paise, GST INCLUDED) and `tax` (paise, the GST part). Absent
 * until capture; null then, so callers can backfill later.
 */
function describeFee(p) {
  if (!p || typeof p !== 'object' || typeof p.fee !== 'number') return null;
  const fee = Math.round(p.fee) / 100;
  const tax = Math.round(p.tax || 0) / 100;
  return { fee, tax, total: fee, source: 'razorpay', capturedAt: new Date() };
}

module.exports = {
  describeFee,
  keyId,
  createOrder,
  verifyCheckoutSignature,
  verifyWebhookSignature,
  refundPayment,
  listPaymentRefunds,
  getPayment,
  emiEligible,
  emiMonthlyFrom,
  describePayment,
  EMI_MIN_AMOUNT,
  EMI_INDICATIVE_RATE,
  EMI_MAX_TENURE,
};
