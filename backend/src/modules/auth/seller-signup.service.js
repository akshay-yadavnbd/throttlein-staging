/**
 * Email-first seller onboarding: register with no password, confirm the
 * email through a 48-hour link, set the password in the same step.
 */
const crypto = require('node:crypto');
const { sendMail } = require('../../config/mail');
const { AppError } = require('../../errors/AppError');
const { logger } = require('../../utils/logger');
const { notifyTeam } = require('../notifications');
const repo = require('./auth.repository');
const { buildVerifyUrl, verifyEmailHtml, newSellerTeamHtml } = require('./auth-emails');

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const INVALID_LINK = 'This verification link is invalid or has expired. Please request a new one.';

/** Send (or re-send) the verification email. */
async function dispatchVerificationEmail(user, token) {
  const link = buildVerifyUrl(token);
  await sendMail({
    to: user.email,
    subject: 'Confirm your THROTTLEIN seller account',
    html: verifyEmailHtml({ name: user.name, link }),
    text: `Hi ${user.name}, confirm your email and set your password: ${link}`,
  });
}

/** Tell the operations team. notifyTeam reaches the env-configured list and
 *  the addresses added under super-admin → Notifications, deduped. */
async function notifyTeamOfSignup(user, isNew = true) {
  await notifyTeam({
    event: 'sellerSignupKyc',
    notice: isNew
      ? {
          heading: 'New seller registration',
          rows: [
            { label: 'Store', value: user.storeName || 'Not provided' },
            { label: 'Seller', value: user.name || 'Not provided' },
            { label: 'Email verification', value: user.emailVerified ? 'Verified' : 'Pending' },
            { label: 'KYC', value: 'Not submitted' },
          ],
          adminPath: `/sellers/${encodeURIComponent(user.slug || String(user._id))}`,
          actionLabel: 'Open seller',
        }
      : undefined,
    subject: `New seller signup — ${user.storeName || user.name}`,
    html: newSellerTeamHtml({ name: user.name, storeName: user.storeName, email: user.email, phone: user.phone }),
    text:
      `A new seller has signed up on THROTTLEIN.\n\n` +
      `Name: ${user.name || '-'}\n` +
      `Store: ${user.storeName || '-'}\n` +
      `Email: ${user.email}\n` +
      `Phone: ${user.phone || '-'}\n`,
  });
}

/** Both mails are best-effort: an outage must never fail the signup. */
async function announce(user, isNew, token) {
  try {
    await dispatchVerificationEmail(user, token);
  } catch (e) {
    logger.error({ err: e }, 'verify-email send failed');
  }
  try {
    await notifyTeamOfSignup(user, isNew);
  } catch (e) {
    logger.error({ err: e }, 'admin-notify send failed');
  }
}

/**
 * Register a seller. `{ created: true }` for a new account; `{ created:
 * false }` when an unverified seller re-registers (a fresh link goes out
 * instead of an error — they probably lost the first email).
 */
async function register({ name, email, phone, storeName, shopName }) {
  const existing = await repo.findByEmail(email);
  if (existing) {
    if (existing.role !== 'seller') {
      const label = existing.role === 'customer' ? 'customer' : 'admin';
      throw AppError.conflict(
        `This email is already registered as a ${label} account. ` +
          (label === 'customer'
            ? 'Use the customer sign-in or register with a different email.'
            : 'Contact support if you think this is an error.'),
      );
    }
    if (!existing.emailVerified) {
      const token = existing.generateEmailVerifyToken();
      await existing.save({ validateBeforeSave: false });
      await announce(existing, false, token);
      return {
        created: false,
        pending: true,
        message: 'We sent a fresh verification link to your email.',
        email: existing.email,
      };
    }
    throw AppError.conflict('A seller account already exists with this email. Try signing in instead.');
  }

  // Account stays 'pending' until KYC is approved. No password yet — the
  // seller sets it after clicking the verify link.
  const user = repo.newUser({
    name,
    email,
    storeName: storeName || shopName,
    phone,
    role: 'seller',
    status: 'pending',
    emailVerified: false,
  });
  const token = user.generateEmailVerifyToken();
  await user.save({ validateBeforeSave: false });
  await announce(user, true, token);
  return {
    created: true,
    pending: true,
    message: 'Check your inbox to confirm your email and set your password.',
    email: user.email,
  };
}

/** Account preview for a live verification link. */
async function checkVerifyToken(raw) {
  const user = await repo.findByVerifyToken(sha256(raw || ''));
  if (!user) throw AppError.badRequest(INVALID_LINK);
  return { user: { name: user.name, email: user.email, storeName: user.storeName } };
}

/** Complete verification AND set the password in one step; signs the seller in. */
async function setPasswordAfterVerify({ token, password }, signToken) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token))
    throw AppError.badRequest('Verification token is required.');
  if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
    throw AppError.badRequest('Password must be at least 12 characters and at most 72 UTF-8 bytes.');
  }
  const user = await repo.findByVerifyToken(sha256(token));
  if (!user) throw AppError.badRequest(INVALID_LINK);
  user.password = password; // pre-save hook hashes
  user.emailVerified = true;
  user.emailVerifyToken = undefined;
  user.emailVerifyExpires = undefined;
  await user.save();
  return { token: signToken(user), user: user.toSafeJSON() };
}

/** Never reveals whether the email exists. */
async function resendVerification(email) {
  if (!email) throw AppError.badRequest('Email is required.');
  const message = 'If that account exists and is unverified, we sent a fresh link.';
  const user = await repo.findByEmail(email);
  if (!user || user.emailVerified) return { message };
  const token = user.generateEmailVerifyToken();
  await user.save({ validateBeforeSave: false });
  try {
    await dispatchVerificationEmail(user, token);
  } catch (e) {
    logger.error({ err: e }, 'verify-email resend failed');
    throw AppError.internal('Could not send the email right now. Please try again in a minute.');
  }
  return { message };
}

module.exports = { register, checkVerifyToken, setPasswordAfterVerify, resendVerification, dispatchVerificationEmail };
