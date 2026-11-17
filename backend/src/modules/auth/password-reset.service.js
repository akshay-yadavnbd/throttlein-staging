/** Forgot / reset password. The forgot answer never reveals whether an account exists. */
const crypto = require('node:crypto');
const { signToken } = require('../../middleware/auth');
const { sendMail } = require('../../config/mail');
const { env } = require('../../config/env');
const { AppError } = require('../../errors/AppError');
const { logger } = require('../../utils/logger');
const repo = require('./auth.repository');
const { resetPasswordMail } = require('./auth-emails');
const { passwordOk, PASSWORD_RULE } = require('./account.service');

const SAFE_MESSAGE = 'If an account exists for that email, a reset link has been sent.';
const ADMIN_ROLES = new Set(['superadmin', 'staff']);

/** Admin / staff links point at the admin panel; sellers and customers at
 *  the storefront. Decided server-side so the client can't pick the origin. */
function resetUrlFor(user, token) {
  const base = ADMIN_ROLES.has(user.role)
    ? env.ADMIN_URL || env.ADMIN_ORIGIN || 'http://localhost:3001'
    : env.RESET_LINK_BASE || env.FRONTEND_ORIGIN || 'http://localhost:3000';
  return `${base.replace(/\/$/, '')}/reset-password/${token}`;
}

async function forgot(email) {
  if (!email) throw AppError.badRequest('Email is required.');
  const user = await repo.findByEmail(email);
  if (!user) return { message: SAFE_MESSAGE };

  const token = user.generateResetToken();
  await user.save({ validateBeforeSave: false });
  try {
    await sendMail({ to: user.email, ...resetPasswordMail({ name: user.name, resetUrl: resetUrlFor(user, token) }) });
  } catch (err) {
    // Roll back the token so the user can retry.
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save({ validateBeforeSave: false });
    // One structured line with everything needed to debug the SMTP setup.
    logger.error(
      {
        err,
        smtp: {
          command: err.command,
          response: err.response,
          responseCode: err.responseCode,
          host: env.SMTP_HOST,
          port: env.SMTP_PORT,
          secure: env.SMTP_SECURE,
          user: env.SMTP_USER,
        },
      },
      'SMTP send failed for password reset',
    );
    const detail = env.isProduction ? '' : ` [${err.code || 'ERR'}: ${err.message}]`;
    throw AppError.internal(`Could not send the reset email. Check SMTP configuration and try again.${detail}`, err);
  }
  return { message: SAFE_MESSAGE };
}

/** Sets the new password and signs the user in. */
async function reset(rawToken, { password, confirmPassword }) {
  if (!passwordOk(password)) throw AppError.badRequest(PASSWORD_RULE);
  if (confirmPassword !== undefined && password !== confirmPassword)
    throw AppError.badRequest('Passwords do not match.');
  const hashed = crypto
    .createHash('sha256')
    .update(String(rawToken || ''))
    .digest('hex');
  const user = await repo.findByResetToken(hashed);
  if (!user) throw AppError.badRequest('Reset link is invalid or has expired. Please request a new one.');
  user.password = password;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  await user.save();
  return { message: 'Password reset successfully.', token: signToken(user), user: user.toSafeJSON() };
}

module.exports = { forgot, reset, resetUrlFor };
