/**
 * KYC field rules and wire hygiene — pure functions, no I/O.
 *
 * The messages here are shown verbatim in the seller dashboard, so they
 * stay as sentences the seller can act on.
 */

const GST_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const PIN_RE = /^[1-9][0-9]{5}$/;
// Indian IFSC: 4 letters + 0 + 6 alphanumerics. Always uppercase.
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
// Indian bank account numbers vary by bank but always 9–18 digits.
const ACC_NO_RE = /^[0-9]{9,18}$/;

const upper = (v) =>
  String(v || '')
    .toUpperCase()
    .trim();
const digitsOnly = (v) => String(v || '').replace(/\s+/g, '');
/** Last ten digits of a phone, as every pickup contact is stored. */
const phone10 = (v) =>
  String(v || '')
    .replace(/\D/g, '')
    .slice(-10);

/** Every problem with a full KYC submission, in form order. Empty when valid. */
function validateKycPayload(body) {
  const errs = [];
  const g = upper(body.gstin);
  const p = upper(body.pan);
  if (!g) errs.push('GSTIN is required');
  else if (!GST_RE.test(g)) errs.push('GSTIN format is invalid');
  if (!p) errs.push('PAN is required');
  else if (!PAN_RE.test(p)) errs.push('PAN format is invalid');

  if (!body.gstCertificate) errs.push('GST certificate file is required');
  if (!body.panCard) errs.push('PAN card file is required');

  // Pickup contact is mirrored from the user record on save — only the
  // postal fields are seller-entered here.
  const a = body.pickupAddress || {};
  if (!a.line1) errs.push('Pickup address line 1 is required');
  if (!a.city) errs.push('Pickup city is required');
  if (!a.state) errs.push('Pickup state is required');
  if (!a.pincode) errs.push('Pickup pincode is required');
  else if (!PIN_RE.test(String(a.pincode))) errs.push('Pickup pincode must be 6 digits');

  // Bank details — needed for seller payouts.
  const b = body.bankDetails || {};
  if (!b.accountHolder) errs.push('Account holder name is required');
  if (!b.accountNumber) errs.push('Bank account number is required');
  else if (!ACC_NO_RE.test(digitsOnly(b.accountNumber))) errs.push('Bank account number must be 9-18 digits');
  if (!b.ifsc) errs.push('IFSC code is required');
  else if (!IFSC_RE.test(upper(b.ifsc))) errs.push('IFSC format is invalid (e.g. HDFC0001234)');
  if (!b.bankName) errs.push('Bank name is required');
  // Cancelled cheque is required so admin can cross-check the account-holder
  // name + account number against what the seller typed.
  if (!b.cancelledCheque) errs.push('Cancelled cheque image is required');

  return errs;
}

/**
 * Strip the pending-OTP secret before any `kyc` subtree leaves the server.
 *
 * `otpHash` is a SHA-256 of a SIX-DIGIT code — a one-million-entry keyspace,
 * brute-forceable in milliseconds. Shipping it to a client would let the
 * seller derive their own pending code without opening the email, and would
 * expose it to admin too. Call this on every response that returns `kyc`.
 * Takes and returns a plain object (use `.toObject()` / `.lean()` first).
 */
function sanitizeKyc(kyc) {
  if (!kyc) return kyc;
  const sv = kyc.pickupSelfVerification;
  if (sv) {
    delete sv.otpHash;
    // The expiry is safe and useful (the UI shows "code pending"), but the
    // raw counters have no business on the wire beyond what the dedicated
    // status endpoint already exposes.
    delete sv.sentToday;
    delete sv.sentTodayDate;
  }
  return kyc;
}

/** Plain-object copy of a mongoose subdocument (or the object itself). */
const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);

module.exports = {
  GST_RE,
  PAN_RE,
  PIN_RE,
  IFSC_RE,
  ACC_NO_RE,
  upper,
  digitsOnly,
  phone10,
  plain,
  validateKycPayload,
  sanitizeKyc,
};
