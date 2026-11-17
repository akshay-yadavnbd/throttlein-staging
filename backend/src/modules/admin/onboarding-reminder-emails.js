/** Email for a seller who stalled during onboarding, one per stage. Pure: the caller supplies the links. */
const { env } = require('../../config/env');

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Email clients cannot load localhost, so local runs use the live logo. */
function emailLogoUrl() {
  if (env.EMAIL_LOGO_URL) return env.EMAIL_LOGO_URL;
  const base = (env.FRONTEND_ORIGIN || '').replace(/\/$/, '');
  if (base && /^https?:\/\//i.test(base) && !/localhost|127\.0\.0\.1/.test(base))
    return `${base}/images/throttlein-logo.png`;
  return 'https://throttlein.com/images/throttlein-logo.png';
}

function shell(inner) {
  return `
  <div style="font-family:Segoe UI,Roboto,sans-serif;max-width:560px;margin:auto;background:#EFF1EA;padding:32px;border-radius:12px">
    <div style="background:#141414;padding:14px 18px;border-radius:8px;display:inline-block;line-height:0">
      <img src="${emailLogoUrl()}" alt="THROTTLEIN"
           width="180" height="auto"
           style="display:block;width:180px;height:auto;max-width:100%;border:0;outline:none;text-decoration:none" />
    </div>
    ${inner}
  </div>`;
}

function cta(href, label) {
  return `
    <a href="${href}"
       style="background:#141414;color:#FFFFFF;padding:12px 22px;text-decoration:none;border-radius:8px;font-weight:600;display:inline-block">
      ${escapeHtml(label)}
    </a>`;
}

const frontendUrl = (path = '/') => `${(env.FRONTEND_ORIGIN || 'http://localhost:3000').replace(/\/$/, '')}${path}`;

/** Never clicked the original verification link. Carries a fresh token. */
function remindUnverifiedHtml({ name, link }) {
  return shell(`
    <h2 style="margin:24px 0 8px;color:#141414;font-weight:600">Confirm your email to get started</h2>
    <p style="color:#3f3f44;line-height:1.55;margin:0 0 16px">
      Hi ${escapeHtml(name || 'there')}, you started creating a THROTTLEIN seller
      account but never confirmed your email address, so the account isn't active yet.
    </p>
    <p style="color:#3f3f44;line-height:1.55;margin:0 0 20px">
      Confirm your email and set a password below — it takes a minute, and your
      earlier link has since expired.
    </p>
    ${cta(link, 'Confirm email and set password')}
    <p style="font-size:12px;color:#6b6b73;line-height:1.5;margin:20px 0 0">
      If you didn't sign up for a seller account, you can ignore this email.
    </p>`);
}

/** Verified and able to log in, but never submitted any documents. */
function remindNoKycHtml({ name, storeName, link }) {
  return shell(`
    <h2 style="margin:24px 0 8px;color:#141414;font-weight:600">Finish setting up your store</h2>
    <p style="color:#3f3f44;line-height:1.55;margin:0 0 16px">
      Hi ${escapeHtml(name || 'there')}, your THROTTLEIN seller account
      ${storeName ? `for <strong>${escapeHtml(storeName)}</strong> ` : ''}is ready,
      but we haven't received your KYC documents yet — so your products can't go
      live and you can't start receiving orders.
    </p>
    <p style="color:#3f3f44;line-height:1.55;margin:0 0 16px">
      You'll need your GSTIN, PAN, a pickup address and your bank details.
      Most sellers finish in under ten minutes, and we review within 24-48 hours.
    </p>
    ${cta(link, 'Complete KYC')}
    <p style="font-size:12px;color:#6b6b73;line-height:1.5;margin:20px 0 0">
      Stuck on something? Reply to this email and we'll help.
    </p>`);
}

/** We rejected their documents and they haven't resubmitted. */
function remindKycRejectedHtml({ name, reason, link }) {
  const reasonBlock = reason
    ? `
    <p style="color:#3f3f44;line-height:1.55;margin:0 0 8px"><strong>What needs fixing:</strong></p>
    <div style="background:#FFFFFF;border-left:3px solid #141414;border-radius:6px;padding:14px 16px;margin:0 0 18px;color:#3f3f44;line-height:1.5">
      ${escapeHtml(reason)}
    </div>`
    : '';
  return shell(`
    <h2 style="margin:24px 0 8px;color:#141414;font-weight:600">Your KYC needs another look</h2>
    <p style="color:#3f3f44;line-height:1.55;margin:0 0 16px">
      Hi ${escapeHtml(name || 'there')}, we couldn't approve your KYC documents,
      and we haven't received an updated submission since.
    </p>
    ${reasonBlock}
    <p style="color:#3f3f44;line-height:1.55;margin:0 0 20px">
      Update the details and resubmit — we'll review again within 24-48 hours.
    </p>
    ${cta(link, 'Resubmit KYC')}
    <p style="font-size:12px;color:#6b6b73;line-height:1.5;margin:20px 0 0">
      If something isn't clear, reply to this email and we'll walk you through it.
    </p>`);
}

module.exports = { frontendUrl, remindUnverifiedHtml, remindNoKycHtml, remindKycRejectedHtml };
