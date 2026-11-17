/**
 * Abandoned-cart reminder email: copy, HTML / text, and the signed
 * unsubscribe link it carries. No database access.
 */
const crypto = require('crypto');
const mongoose = require('mongoose');
const { env } = require('../../config/env');

/* ── links ────────────────────────────────────────────────────────────── */

function tokenSecret() {
  const s = env.CART_REMINDER_SECRET || env.JWT_SECRET;
  if (!s) throw new Error('CART_REMINDER_SECRET or JWT_SECRET must be set');
  return s;
}

function actionToken(purpose, userId) {
  return crypto
    .createHmac('sha256', tokenSecret())
    .update(`cart-reminder-${purpose}:${String(userId)}`)
    .digest('base64url');
}
const unsubscribeToken = (userId) => actionToken('unsubscribe', userId);

function verifyToken(purpose, userId, token) {
  if (!mongoose.isValidObjectId(userId) || typeof token !== 'string' || !token) return false;
  const expected = Buffer.from(actionToken(purpose, userId));
  const given = Buffer.from(token);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}
const verifyUnsubscribeToken = (userId, token) => verifyToken('unsubscribe', userId, token);

/** Backend origin that serves /api/email/unsubscribe. '' when unknown in production. */
function apiOrigin() {
  const explicit = env.PUBLIC_API_URL;
  if (explicit)
    return String(explicit)
      .replace(/\/api\/?$/i, '')
      .replace(/\/+$/, '');
  if (env.isProduction) return '';
  return `http://localhost:${env.PORT || 5000}`;
}

const frontendOrigin = () => (env.FRONTEND_ORIGIN || 'http://localhost:3000').replace(/\/$/, '');

function unsubscribeUrl(userId) {
  const base = apiOrigin();
  if (!base) return '';
  return `${base}/api/email/unsubscribe/cart-reminders?u=${encodeURIComponent(String(userId))}&t=${encodeURIComponent(unsubscribeToken(userId))}`;
}

/* ── email ────────────────────────────────────────────────────────────── */

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Same logo + dark header box as the other THROTTLEIN emails. Email clients can't load localhost, so local runs use the live logo. */
function brandLogoUrl() {
  if (env.EMAIL_LOGO_URL) return env.EMAIL_LOGO_URL;
  const base = frontendOrigin();
  if (/^https?:\/\//i.test(base) && !/localhost|127\.0\.0\.1/.test(base)) return `${base}/images/throttlein-logo.png`;
  return 'https://throttlein.com/images/throttlein-logo.png';
}

function brandHeaderHtml() {
  return `<a href="${escapeHtml(frontendOrigin())}" style="background:#141414;padding:14px 18px;border-radius:8px;display:inline-block;line-height:0;text-decoration:none">
      <img src="${escapeHtml(brandLogoUrl())}" alt="THROTTLEIN" width="180" style="display:block;width:180px;height:auto;max-width:100%;border:0;outline:none;text-decoration:none" />
    </a>`;
}

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

function defaultImageUrl(raw) {
  if (!raw) return '';
  let url = raw;
  try {
    url = require('../../middleware/upload').publicFileUrl(raw) || raw;
  } catch {
    /* keep raw */
  }
  if (url.startsWith('/uploads/')) return apiOrigin() ? `${apiOrigin()}${url}` : '';
  if (url.startsWith('/images/')) return `${frontendOrigin()}${url}`;
  return /^https?:\/\//i.test(url) ? url : '';
}

/** Populated cart line → what the email shows. Price is the LIVE price (variant first). */
function emailLine(line, imageUrl = defaultImageUrl) {
  const p = line.product || {};
  const variant = Array.isArray(p.variants)
    ? p.variants.find((v) => (!line.size || v.size === line.size) && (!line.color || v.color === line.color))
    : null;
  const price = Number(variant?.price) > 0 ? Number(variant.price) : Number(p.price ?? line.snapshot?.price) || 0;
  return {
    name: p.name || line.snapshot?.name || 'Item in your bag',
    image: imageUrl((Array.isArray(p.images) && p.images[0]) || line.snapshot?.image || ''),
    options: [line.size, line.color].filter(Boolean).join(' / '),
    quantity: Number(line.quantity) || 1,
    price,
  };
}

// Copy for each reminder in order. The FINAL reminder always uses LAST_COPY,
// however many delays are configured, so "last reminder" is never sent early.
const COPY = [
  {
    subject: 'You left something in your bag',
    heading: 'Your bag’s still holding these for you',
    body: 'You added these to your THROTTLEIN bag but didn’t check out. They’re still waiting for you.',
  },
  {
    subject: 'Still thinking it over? Your picks are in your bag',
    heading: 'Still thinking it over?',
    body: 'Your picks are still saved in your bag. Prices and stock can change at any time — check out now to get them at today’s price.',
  },
  {
    subject: 'Your bag is still waiting — stock is moving',
    heading: 'Don’t miss out',
    body: 'The gear in your bag is still available, but stock on THROTTLEIN changes fast. Complete your order before it’s gone.',
  },
];
const LAST_COPY = {
  subject: 'Final call — your gear is still parked in your bag',
  heading: 'Kickstand up?',
  body: 'Your gear has been parked in your bag for a week. This is the last nudge we’ll send — it’s still there whenever you’re ready to ride.',
};

function buildReminderEmail({ name, lines, stage, isLast = false, cartUrl }) {
  const copy = isLast && stage > 0 ? LAST_COPY : COPY[Math.min(stage, COPY.length - 1)];
  const shown = lines.slice(0, 3);
  const more = lines.length - shown.length;
  const total = lines.reduce((s, l) => s + l.price * l.quantity, 0);

  const rows = shown
    .map(
      (l) => `
      <tr>
        <td style="padding:10px 12px 10px 0;width:72px;vertical-align:top">
          ${l.image ? `<img src="${escapeHtml(l.image)}" alt="" width="64" height="64" style="display:block;width:64px;height:64px;object-fit:contain;background:#fff;border:1px solid #e7e7e9;border-radius:8px" />` : ''}
        </td>
        <td style="padding:10px 0;vertical-align:top;color:#141414;font-size:14px;line-height:1.4">
          <strong>${escapeHtml(l.name)}</strong><br/>
          <span style="color:#6b6b70">${escapeHtml([l.options, `Qty ${l.quantity}`].filter(Boolean).join(' · '))}</span>
        </td>
        <td style="padding:10px 0;vertical-align:top;text-align:right;color:#141414;font-size:14px;white-space:nowrap">${escapeHtml(inr(l.price * l.quantity))}</td>
      </tr>`,
    )
    .join('');

  const html = `
  <div style="font-family:Segoe UI,Roboto,sans-serif;max-width:560px;margin:auto;background:#EFF1EA;padding:32px;border-radius:12px">
    ${brandHeaderHtml()}
    <h2 style="margin:24px 0 8px;color:#141414">${escapeHtml(copy.heading)}</h2>
    <p style="color:#3f3f44;line-height:1.5;margin:0 0 8px">Hi ${escapeHtml(name || 'there')},</p>
    <p style="color:#3f3f44;line-height:1.5;margin:0 0 18px">${escapeHtml(copy.body)}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-top:1px solid #d9dcd2;border-bottom:1px solid #d9dcd2;margin:0 0 18px">${rows}</table>
    ${more > 0 ? `<p style="color:#6b6b70;font-size:13px;margin:-8px 0 14px">+ ${more} more item${more > 1 ? 's' : ''} in your bag</p>` : ''}
    <p style="color:#141414;margin:0 0 20px;font-size:15px">Bag total: <strong>${escapeHtml(inr(total))}</strong></p>
    <a href="${escapeHtml(cartUrl)}" style="background:#141414;color:#FFFFFF;padding:12px 22px;text-decoration:none;border-radius:8px;font-weight:bold;display:inline-block">Complete your order</a>
    <p style="color:#8a8a90;font-size:12px;line-height:1.5;margin:28px 0 0">Prices and stock are confirmed at checkout.</p>
  </div>`;

  const text = [
    `Hi ${name || 'there'},`,
    '',
    copy.body,
    '',
    ...lines.map(
      (l) => `- ${l.name}${l.options ? ` (${l.options})` : ''} x${l.quantity}: ${inr(l.price * l.quantity)}`,
    ),
    '',
    `Bag total: ${inr(total)}`,
    `Complete your order: ${cartUrl}`,
  ].join('\n');

  return { subject: `THROTTLEIN — ${copy.subject}`, html, text };
}

module.exports = {
  tokenSecret,
  unsubscribeToken,
  verifyUnsubscribeToken,
  unsubscribeUrl,
  apiOrigin,
  frontendOrigin,
  brandLogoUrl,
  defaultImageUrl,
  emailLine,
  buildReminderEmail,
};
