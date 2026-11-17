/**
 * Auth email templates and the brand header every transactional email
 * shares. Pure string builders; the services send them.
 */
const { env } = require('../../config/env');

/** Absolute URL of the THROTTLEIN brand PNG logo. Email clients can't
 *  reach `localhost`, so locally the logo points at the PUBLIC site.
 *    1. EMAIL_LOGO_URL — explicit override
 *    2. FRONTEND_ORIGIN + /images/throttlein-logo.png when it is a public https URL
 *    3. Hardcoded production fallback, so dev-sent emails render in real inboxes */
function brandLogoUrl() {
  if (env.EMAIL_LOGO_URL) return env.EMAIL_LOGO_URL;
  const base = (env.FRONTEND_ORIGIN || '').replace(/\/$/, '');
  if (base && /^https?:\/\//i.test(base) && !/localhost|127\.0\.0\.1/.test(base)) {
    return `${base}/images/throttlein-logo.png`;
  }
  return 'https://throttlein.com/images/throttlein-logo.png';
}

/** Inline-block brand header. Pixel sizes because email clients ignore most CSS. */
function brandHeaderHtml() {
  return `
    <div style="background:#141414;padding:14px 18px;border-radius:8px;display:inline-block;line-height:0">
      <img src="${brandLogoUrl()}" alt="THROTTLEIN"
           width="180" height="auto"
           style="display:block;width:180px;height:auto;max-width:100%;border:0;outline:none;text-decoration:none" />
    </div>`;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const CARD =
  'font-family:Segoe UI,Roboto,sans-serif;max-width:560px;margin:auto;background:#EFF1EA;padding:32px;border-radius:12px';
const BUTTON =
  'background:#141414;color:#FFFFFF;padding:12px 22px;text-decoration:none;border-radius:8px;font-weight:600;display:inline-block';

/** The link the seller clicks in the verification email. The onboarding
 *  reminder builds the exact same shape through this function. */
function buildVerifyUrl(token) {
  const base = (env.FRONTEND_ORIGIN || 'http://localhost:3000').replace(/\/$/, '');
  return `${base}/seller/verify/${token}`;
}

function verifyEmailHtml({ name, link }) {
  return `
  <div style="${CARD}">
    ${brandHeaderHtml()}
    <h2 style="margin:24px 0 8px;color:#141414">Confirm your email</h2>
    <p style="color:#3f3f44;line-height:1.55;margin:0 0 16px">
      Hi ${escapeHtml(name)}, thanks for signing up as a seller on THROTTLEIN.
      Click the button below to confirm your email and set your password.
    </p>
    <a href="${link}" style="${BUTTON};margin:8px 0 18px">Verify email &amp; set password</a>
    <p style="font-size:12px;color:#717177;line-height:1.5;margin:18px 0 0">
      This link expires in 48 hours. If you didn't sign up, you can safely ignore this email.
    </p>
    <p style="font-size:11px;color:#a1a1a8;line-height:1.5;margin:18px 0 0;word-break:break-all">
      Button not working? Paste this URL into your browser:<br/>${link}
    </p>
  </div>`;
}

/** "New seller signed up" for the operations team, with a link into the admin panel. */
function newSellerTeamHtml({ name, storeName, email, phone }) {
  const adminBase = (env.ADMIN_ORIGIN || 'http://localhost:3001').replace(/\/$/, '');
  const line = (label, value) =>
    value
      ? `<p style="margin:0 0 4px;color:#3f3f44"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`
      : '';
  return `
  <div style="${CARD}">
    ${brandHeaderHtml()}
    <h2 style="margin:24px 0 8px;color:#141414">New seller signed up</h2>
    <p style="color:#3f3f44;line-height:1.55;margin:0 0 16px">
      A new seller has just created an account on THROTTLEIN. Review their
      profile and KYC in the admin panel when they finish onboarding.
    </p>
    <div style="background:#FFFFFF;border:1px solid #E5E5E5;border-radius:8px;padding:16px;margin:0 0 18px">
      ${line('Name', name)}
      ${line('Store', storeName)}
      ${line('Email', email)}
      ${line('Phone', phone)}
    </div>
    <a href="${adminBase}/sellers" style="${BUTTON}">Open admin panel</a>
    <p style="font-size:11px;color:#a1a1a8;line-height:1.5;margin:18px 0 0">
      You are receiving this because your address is on the THROTTLEIN
      seller-notification list (TEAM_NOTIFY_EMAILS). To change who gets
      these, ask an engineer to update that list.
    </p>
  </div>`;
}

function resetPasswordMail({ name, resetUrl }) {
  return {
    subject: 'THROTTLEIN — Reset your password',
    html: `
    <div style="${CARD}">
      ${brandHeaderHtml()}
      <h2 style="margin-top:24px;color:#141414">Reset your password</h2>
      <p style="color:#141414;line-height:1.5">
        Hi ${escapeHtml(name || 'rider')},<br/><br/>
        We received a request to reset your THROTTLEIN password. Click the button
        below to choose a new one. This link is valid for <strong>60 minutes</strong>.
      </p>
      <p style="margin:28px 0">
        <a href="${resetUrl}" style="${BUTTON};padding:12px 24px;font-weight:bold">Reset password</a>
      </p>
      <p style="font-size:12px;color:#5b5b5b">
        Or paste this URL into your browser:<br/>
        <span style="word-break:break-all">${resetUrl}</span>
      </p>
      <hr style="border:none;border-top:1px solid #ddd;margin:24px 0"/>
      <p style="font-size:12px;color:#5b5b5b">
        Didn't request this? You can safely ignore this email — no changes have
        been made to your account.
      </p>
    </div>`,
    text:
      `THROTTLEIN — Reset your password\n\n` +
      `Hi ${name},\n\n` +
      `Click the link below to reset your password (valid 60 minutes):\n\n${resetUrl}\n\n` +
      `If you didn't request this, ignore this email.`,
  };
}

module.exports = {
  brandLogoUrl,
  brandHeaderHtml,
  escapeHtml,
  buildVerifyUrl,
  verifyEmailHtml,
  newSellerTeamHtml,
  resetPasswordMail,
};
