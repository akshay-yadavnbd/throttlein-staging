/**
 * Seller self-confirmation of pickup details — fully self-serve from the
 * dashboard, no admin, no Shiprocket. A 6-digit code goes to the seller's
 * registered email; entering it records that THE SELLER confirmed these
 * pickup details.
 *
 * WHAT THIS DOES AND DOESN'T PROVE
 * It proves the seller controls their registered email and has confirmed
 * the pickup address + phone are correct. It does NOT prove the phone is
 * reachable — that needs an SMS/voice channel, and none is configured. The
 * UI is worded accordingly; do not relabel this as "phone verified". It is
 * also independent of Shiprocket's own `phone_verified` flag (see
 * pickup-sync.service.js).
 */
const crypto = require('node:crypto');
const { sendMail } = require('../../config/mail');
const { AppError } = require('../../errors/AppError');
const repo = require('./sellers.repository');
const { phone10 } = require('./kyc-rules');
const { pickupOtpMail } = require('./kyc-emails');

const OTP_TTL_MS = 10 * 60 * 1000; // code valid for 10 minutes
const OTP_RESEND_MS = 60 * 1000; // 60s between sends
const OTP_MAX_ATTEMPTS = 5; // wrong guesses per code
const OTP_MAX_PER_DAY = 8; // sends per seller per day

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const todayKey = () => new Date().toISOString().slice(0, 10);
const maskEmail = (email) => String(email || '').replace(/^(.{2}).*(@.*)$/, '$1***$2');

/** Stable fingerprint of the pickup details being confirmed, so that editing
 *  any of them invalidates a previous confirmation. */
function addressKeyOf(addr = {}) {
  return sha256(
    [addr.line1, addr.line2, addr.city, addr.state, addr.pincode]
      .map((v) =>
        String(v || '')
          .trim()
          .toLowerCase(),
      )
      .join('|'),
  );
}

/** True when a stored confirmation still matches the CURRENT pickup details. */
function selfVerificationValid(kyc) {
  const sv = kyc?.pickupSelfVerification;
  if (!sv?.verifiedAt) return false;
  /** @type {PostalAddress} */
  const addr = kyc?.pickupAddress || {};
  return sv.verifiedPhone === phone10(addr.contactPhone) && sv.verifiedAddressKey === addressKeyOf(addr);
}

async function loadSeller(id) {
  const seller = await repo.findById(id);
  if (!seller) throw AppError.notFound('Seller not found');
  return seller;
}

/**
 * Email a fresh code. Rate limited three ways — a cooldown between sends, a
 * daily cap, and a per-code attempt limit on the verify side — so this can't
 * spam an inbox or be brute-forced.
 */
async function sendOtp(sellerId) {
  const seller = await loadSeller(sellerId);
  /** @type {PostalAddress} */
  const addr = seller.kyc?.pickupAddress || {};
  if (!addr.line1 || !addr.pincode) throw AppError.badRequest('Add your pickup address first, then confirm it.');
  const to = seller.email;
  if (!to) throw AppError.badRequest('No email on your account to send the code to.');

  seller.kyc.pickupSelfVerification = seller.kyc.pickupSelfVerification || /** @type {any} */ ({});
  const sv = seller.kyc.pickupSelfVerification;

  // Cooldown — report the exact wait so the UI can count down.
  const sinceLast = sv.lastSentAt ? Date.now() - new Date(sv.lastSentAt).getTime() : Infinity;
  if (sinceLast < OTP_RESEND_MS) {
    const wait = Math.ceil((OTP_RESEND_MS - sinceLast) / 1000);
    throw AppError.rateLimited(`Please wait ${wait}s before requesting another code.`);
  }

  // Daily cap, reset when the date rolls over.
  const today = todayKey();
  if (sv.sentTodayDate !== today) {
    sv.sentTodayDate = today;
    sv.sentToday = 0;
  }
  if (sv.sentToday >= OTP_MAX_PER_DAY) {
    throw AppError.rateLimited('Too many codes requested today. Please try again tomorrow or contact support.');
  }

  // crypto.randomInt, not Math.random — this is a security token.
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  sv.otpHash = sha256(code);
  sv.otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);
  sv.attempts = 0;
  sv.lastSentAt = new Date();
  sv.sentToday += 1;
  sv.method = 'email';
  await seller.save({ validateBeforeSave: false });

  const where = [addr.line1, addr.line2, addr.city, addr.state, addr.pincode].filter(Boolean).join(', ');
  try {
    await sendMail({ to, ...pickupOtpMail({ code, where, phone: phone10(addr.contactPhone) }) });
  } catch (e) {
    // Don't leave a live code behind if delivery failed — otherwise the seller
    // is locked out by the cooldown with no code to show for it.
    sv.otpHash = '';
    sv.otpExpiresAt = undefined;
    sv.lastSentAt = undefined;
    sv.sentToday = Math.max(0, sv.sentToday - 1);
    await seller.save({ validateBeforeSave: false });
    throw AppError.upstream(`Could not send the email: ${e.message}`);
  }

  return {
    ok: true,
    // Masked so the response can't be used to harvest the full address.
    sentTo: maskEmail(to),
    expiresInSec: Math.floor(OTP_TTL_MS / 1000),
  };
}

/** Confirm the code and record what was confirmed. */
async function verifyOtp(sellerId, otpInput) {
  const otp = String(otpInput || '').trim();
  const seller = await loadSeller(sellerId);
  const sv = seller.kyc?.pickupSelfVerification;
  if (!sv?.otpHash) throw AppError.badRequest('No code pending. Request a new one.');

  const burn = async () => {
    sv.otpHash = '';
    await seller.save({ validateBeforeSave: false });
  };
  if (!sv.otpExpiresAt || new Date(sv.otpExpiresAt).getTime() < Date.now()) {
    await burn();
    throw AppError.badRequest('That code has expired. Request a new one.');
  }
  if ((sv.attempts || 0) >= OTP_MAX_ATTEMPTS) {
    await burn();
    throw AppError.rateLimited('Too many incorrect attempts. Request a new code.');
  }

  // Length-check first: timingSafeEqual throws on mismatched buffer lengths.
  const expected = Buffer.from(sv.otpHash, 'hex');
  const given = Buffer.from(sha256(otp), 'hex');
  const match = expected.length === given.length && crypto.timingSafeEqual(expected, given);
  if (!match) {
    sv.attempts = (sv.attempts || 0) + 1;
    await seller.save({ validateBeforeSave: false });
    const left = Math.max(0, OTP_MAX_ATTEMPTS - sv.attempts);
    throw AppError.badRequest(`Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.`);
  }

  /** @type {PostalAddress} */
  const addr = seller.kyc.pickupAddress || {};
  sv.verifiedAt = new Date();
  sv.verifiedPhone = phone10(addr.contactPhone);
  sv.verifiedAddressKey = addressKeyOf(addr);
  sv.method = 'email';
  // Burn the code so it can't be replayed.
  sv.otpHash = '';
  sv.otpExpiresAt = undefined;
  sv.attempts = 0;
  await seller.save({ validateBeforeSave: false });
  return { ok: true, verifiedAt: sv.verifiedAt, message: 'Pickup details confirmed.' };
}

/** Current confirmation state, for the dashboard card. */
async function status(sellerId) {
  const seller = await repo.findContactAndKyc(sellerId);
  if (!seller) throw AppError.notFound('Seller not found');
  /** @type {{ verifiedAt?: Date, method?: string, otpHash?: string, otpExpiresAt?: Date, attempts?: number }} */
  const sv = seller.kyc?.pickupSelfVerification || {};
  /** @type {PostalAddress} */
  const addr = seller.kyc?.pickupAddress || {};
  const valid = selfVerificationValid(seller.kyc);
  return {
    ok: true,
    verified: valid,
    // Distinguishes "never confirmed" from "confirmed, then details changed" —
    // the second needs a different nudge in the UI.
    staleAfterEdit: !!sv.verifiedAt && !valid,
    verifiedAt: sv.verifiedAt || null,
    method: sv.method || '',
    email: maskEmail(seller.email),
    phone: phone10(addr.contactPhone),
    otpPending: !!sv.otpHash && !!sv.otpExpiresAt && new Date(sv.otpExpiresAt).getTime() > Date.now(),
    attemptsLeft: Math.max(0, OTP_MAX_ATTEMPTS - (sv.attempts || 0)),
  };
}

module.exports = { sendOtp, verifyOtp, status, selfVerificationValid, addressKeyOf, OTP_MAX_ATTEMPTS };
