/**
 * KYC email templates. Pure string builders — the services send them.
 */
const { env } = require('../../config/env');

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Brand header used at the top of every KYC email. Uses the real PNG
 *  logo (Gmail strips SVG src refs; Outlook doesn't render them).
 *
 *  Logo URL resolution (defends against localhost-in-email):
 *    1. EMAIL_LOGO_URL env var — explicit override
 *    2. FRONTEND_ORIGIN if it's a real https URL (not localhost)
 *    3. Hardcoded production fallback — so dev-sent emails to real
 *       inboxes still render the logo */
function emailLogoUrl() {
  if (env.EMAIL_LOGO_URL) return env.EMAIL_LOGO_URL;
  const base = (env.FRONTEND_ORIGIN || '').replace(/\/$/, '');
  if (base && /^https?:\/\//i.test(base) && !/localhost|127\.0\.0\.1/.test(base)) {
    return `${base}/images/throttlein-logo.png`;
  }
  return 'https://throttlein.com/images/throttlein-logo.png';
}

function brandHeader() {
  const logoUrl = emailLogoUrl();
  return `
  <div style="background:#141414;padding:14px 18px;border-radius:8px;display:inline-block;line-height:0">
    <img src="${logoUrl}" alt="THROTTLEIN"
         width="180" height="auto"
         style="display:block;width:180px;height:auto;max-width:100%;border:0;outline:none;text-decoration:none" />
  </div>`;
}

const CARD =
  'font-family:Segoe UI,Roboto,sans-serif;max-width:560px;margin:auto;background:#EFF1EA;padding:32px;border-radius:12px';
const H2 = 'margin:24px 0 8px;color:#141414;font-weight:600';
const P = 'color:#3f3f44;line-height:1.55;margin:0 0 16px';
const BUTTON =
  'background:#141414;color:#FFFFFF;padding:12px 22px;text-decoration:none;border-radius:8px;font-weight:600;display:inline-block';

function dashboardLink(path = '/dashboard') {
  const base = (env.FRONTEND_ORIGIN || 'http://localhost:3000').replace(/\/$/, '');
  return `${base}${path}`;
}

function kycSubmittedHtml({ name }) {
  return `
  <div style="${CARD}">
    ${brandHeader()}
    <h2 style="${H2}">KYC submitted</h2>
    <p style="${P}">
      Hi ${escapeHtml(name)}, we received your KYC documents. Our team usually
      reviews submissions within <strong>24-48 hours</strong>. You'll get an email
      the moment we approve (or if anything needs your attention).
    </p>
    <p style="${P}">
      You can keep building your catalog meanwhile — products you add will go
      live as soon as your KYC is approved.
    </p>
  </div>`;
}

/**
 * "KYC ready for review" notification sent to the operations team.
 *
 * Deliberately partial about the sensitive fields: the bank account number
 * is masked to its last 4 and the uploaded documents are listed by
 * presence rather than linked, because those links are only meaningful to
 * a signed-in admin and email is not a place to widen exposure of a
 * seller's financial details.
 */
function kycSubmittedAdminHtml({ user, kyc }) {
  const adminBase = (env.ADMIN_ORIGIN || 'http://localhost:3001').replace(/\/$/, '');
  // The seller detail route is keyed by SLUG, not _id (admin/app/sellers/[slug]).
  // Older accounts can predate slugs, so fall back to the KYC queue rather
  // than emitting a link that 404s.
  const reviewUrl = user.slug ? `${adminBase}/sellers/${encodeURIComponent(user.slug)}` : `${adminBase}/kyc-pending`;
  const line = (label, value) =>
    value
      ? `<p style="margin:0 0 4px;color:#3f3f44"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`
      : '';

  const acct = String(kyc?.bankDetails?.accountNumber || '');
  const maskedAcct = acct ? `•••• ${acct.slice(-4)}` : '';
  const addr = kyc?.pickupAddress || {};
  const pickup = [addr.city, addr.state, addr.pincode].filter(Boolean).join(', ');

  const docs = [
    kyc?.gstCertificate ? 'GST certificate' : null,
    kyc?.panCard ? 'PAN card' : null,
    kyc?.bankDetails?.cancelledCheque ? 'Cancelled cheque' : null,
  ].filter(Boolean);

  return `
  <div style="${CARD}">
    ${brandHeader()}
    <h2 style="${H2}">KYC submitted for review</h2>
    <p style="${P}">
      <strong>${escapeHtml(user.storeName || user.name)}</strong> has submitted
      KYC documents and is waiting on approval.
    </p>
    <div style="background:#FFFFFF;border:1px solid #E5E5E5;border-radius:8px;padding:16px;margin:0 0 18px">
      ${line('Seller', user.name)}
      ${line('Store', user.storeName)}
      ${line('Email', user.email)}
      ${line('Phone', user.phone)}
      ${line('GSTIN', kyc?.gstin)}
      ${line('PAN', kyc?.pan)}
      ${line('Pickup', pickup)}
      ${line('Bank', kyc?.bankDetails?.bankName)}
      ${line('Account', maskedAcct)}
      ${line('Documents', docs.join(', '))}
    </div>
    <a href="${reviewUrl}" style="${BUTTON}">Review KYC</a>
    <p style="font-size:11px;color:#a1a1a8;line-height:1.5;margin:18px 0 0">
      You are receiving this because your address is on the THROTTLEIN
      seller-notification list (TEAM_NOTIFY_EMAILS). To change who gets
      these, ask an engineer to update that list.
    </p>
  </div>`;
}

/** KYC verified + account auto-activated in the same review — the normal
 *  path since single-step approval. The store is live NOW. */
function kycApprovedAndLiveHtml({ name, dashboardUrl }) {
  return `
  <div style="${CARD}">
    ${brandHeader()}
    <h2 style="${H2}">Your store is live</h2>
    <p style="${P}">
      Hi ${escapeHtml(name)}, we've reviewed your documents and everything checks out.
      Your KYC is verified and your account is now active — your store is open
      for business on THROTTLEIN.
    </p>
    <a href="${dashboardUrl}" style="${BUTTON};margin:8px 0 18px">Start listing products</a>
    <p style="color:#3f3f44;line-height:1.55;margin:18px 0 0">
      Products you publish now appear on the storefront immediately.
    </p>
  </div>`;
}

/** KYC verified but the account was NOT auto-activated (seller is
 *  suspended) — documents-only confirmation. */
function kycApprovedHtml({ name, dashboardUrl }) {
  return `
  <div style="${CARD}">
    ${brandHeader()}
    <h2 style="${H2}">Your KYC is verified</h2>
    <p style="${P}">
      Hi ${escapeHtml(name)}, we've reviewed your documents and everything checks out —
      your KYC is now verified. Your account isn't active at the moment; you'll get
      another email if and when it's reactivated.
    </p>
    <a href="${dashboardUrl}" style="${BUTTON};margin:8px 0 18px">Go to my dashboard</a>
    <p style="color:#3f3f44;line-height:1.55;margin:18px 0 0">
      Meanwhile you can prep your catalog — drafts you save now will publish
      automatically as soon as the account is activated.
    </p>
  </div>`;
}

/** Sent by the admin module when a seller account is activated by hand. */
function accountActivatedHtml({ name, dashboardUrl }) {
  return `
  <div style="${CARD}">
    ${brandHeader()}
    <h2 style="${H2}">You're live — start selling 🎉</h2>
    <p style="${P}">
      Hi ${escapeHtml(name)}, your THROTTLEIN store is now active. Customers can
      discover your products, place orders, and we'll route everything to your
      pickup address.
    </p>
    <a href="${dashboardUrl}" style="${BUTTON};margin:8px 0 18px">Go to my dashboard</a>
    <p style="color:#3f3f44;line-height:1.55;margin:18px 0 0">
      First steps: add your first product, set your stock, and watch orders come in.
    </p>
  </div>`;
}

function kycRejectedHtml({ name, reason, dashboardUrl }) {
  return `
  <div style="${CARD}">
    ${brandHeader()}
    <h2 style="${H2}">KYC needs attention</h2>
    <p style="${P}">
      Hi ${escapeHtml(name)}, we couldn't approve your KYC yet. Please review
      the note from our team below, update the relevant document, and resubmit.
    </p>
    <div style="background:#FEF2F2;border-left:3px solid #DC2626;padding:14px 16px;border-radius:6px;color:#7F1D1D;font-size:14px;line-height:1.5;margin:0 0 18px">
      <strong>What needs fixing</strong><br/>
      ${escapeHtml(reason)}
    </div>
    <a href="${dashboardUrl}" style="${BUTTON};margin:8px 0 18px">Update &amp; resubmit</a>
    <p style="font-size:12px;color:#717177;margin-top:18px">
      Need help? Reply to this email and our team will guide you.
    </p>
  </div>`;
}

/** The emailed pickup-confirmation code and what it confirms. */
function pickupOtpMail({ code, where, phone }) {
  return {
    subject: `Your THROTTLEIN pickup confirmation code: ${code}`,
    text:
      `Your pickup confirmation code is ${code}. It expires in 10 minutes.\n\n` +
      `You are confirming this pickup address:\n${where}\nContact phone: ${phone}\n\n` +
      `If these details are wrong, do not enter the code — update your pickup address first.\n` +
      `If you didn't request this, you can ignore this email.`,
    html:
      `<p>Your pickup confirmation code is:</p>` +
      `<p style="font-size:26px;font-weight:700;letter-spacing:5px;margin:12px 0">${code}</p>` +
      `<p style="color:#666">Expires in 10 minutes.</p>` +
      `<p>You are confirming this pickup address:</p>` +
      `<p style="background:#f6f6f6;padding:10px;border-radius:6px">${escapeHtml(where)}<br>Contact phone: <b>${escapeHtml(phone)}</b></p>` +
      `<p><b>If these details are wrong, don't enter the code</b> — update your pickup address first.</p>` +
      `<p style="color:#888;font-size:12px">If you didn't request this, you can ignore this email.</p>`,
  };
}

module.exports = {
  escapeHtml,
  dashboardLink,
  kycSubmittedHtml,
  kycSubmittedAdminHtml,
  kycApprovedAndLiveHtml,
  kycApprovedHtml,
  accountActivatedHtml,
  kycRejectedHtml,
  pickupOtpMail,
};
