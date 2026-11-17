/** HTML for order emails: the seller's new-order mail and the customer's status mails (pure; sending lives in order-notifications.js). */
const { env } = require('../../config/env');

const inr = (n) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const frontendBase = () => (env.FRONTEND_ORIGIN || 'http://localhost:3000').replace(/\/$/, '');
const adminBase = () => (env.ADMIN_ORIGIN || 'http://localhost:3001').replace(/\/$/, '');

/** Brand header used at the top of every order-related email. Renders the
 *  real THROTTLEIN PNG logo (Gmail strips SVG src refs; Outlook desktop
 *  won't render them). Logo URL: EMAIL_LOGO_URL → FRONTEND_ORIGIN when it is
 *  a real https URL (not localhost) → production fallback. */
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

function itemRowsHtml(items, { showUnit = false } = {}) {
  return items
    .map(
      (it) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #e7e7e9">
          <div style="font-weight:600;color:#141414">${escapeHtml(it.name)}</div>
          <div style="font-size:12px;color:#717177">
            ${[it.brand, it.size && `Size ${it.size}`, `Qty ${it.quantity}`].filter(Boolean).map(escapeHtml).join(' · ')}
          </div>
        </td>
        <td style="padding:8px 0;text-align:right;border-bottom:1px solid #e7e7e9">
          <div style="font-weight:700;color:#141414">₹${inr(it.subtotal)}</div>
          ${showUnit ? `<div style="font-size:12px;color:#717177">₹${inr(it.price)} ea</div>` : ''}
        </td>
      </tr>`,
    )
    .join('');
}

/** THROTTLEIN-branded HTML email for the seller's slice of an order. */
function sellerEmailHtml({ seller, order, sellerItems, sellerSubtotal, customerName }) {
  const a = order.shippingAddress;
  return `
  <div style="font-family:Segoe UI,Roboto,sans-serif;max-width:640px;margin:auto;background:#EFF1EA;padding:32px;border-radius:12px">
    ${brandHeader()}
    <h2 style="margin:20px 0 4px;color:#141414">New order — ${escapeHtml(order.orderNumber)}</h2>
    <p style="color:#3f3f44;line-height:1.5;margin:0">
      Hi ${escapeHtml(seller.name)}, ${escapeHtml(customerName || 'a customer')} just placed an order containing
      <strong>${sellerItems.length} of your product${sellerItems.length === 1 ? '' : 's'}</strong>.
      Pack and dispatch as soon as you can.
    </p>

    <h3 style="margin:24px 0 8px;color:#141414">Your items in this order</h3>
    <table style="width:100%;border-collapse:collapse">${itemRowsHtml(sellerItems, { showUnit: true })}</table>
    <div style="text-align:right;font-weight:800;color:#141414;margin-top:10px">
      Your subtotal: ₹${inr(sellerSubtotal)}
    </div>

    <h3 style="margin:24px 0 8px;color:#141414">Ship to</h3>
    <!-- Name + address only. Sellers don't receive the buyer's phone/email —
         the carrier gets those from us directly. Mirrors sellerSafeAddress. -->
    <div style="background:white;border:1px solid #e7e7e9;border-radius:8px;padding:14px;font-size:14px;color:#27272a;line-height:1.5">
      <strong>${escapeHtml(a.fullName)}</strong><br/>
      ${escapeHtml(a.line1)}<br/>
      ${a.line2 ? escapeHtml(a.line2) + '<br/>' : ''}
      ${escapeHtml(a.city)}, ${escapeHtml(a.state)} ${escapeHtml(a.pincode)}<br/>
      ${escapeHtml(a.country || 'India')}
    </div>

    <div style="margin:24px 0">
      <a href="${frontendBase()}/dashboard/orders/${order._id}"
         style="background:#141414;color:#FFFFFF;padding:12px 22px;text-decoration:none;border-radius:8px;font-weight:bold;display:inline-block">
         View in seller dashboard
      </a>
    </div>

    <p style="font-size:12px;color:#717177;margin-top:18px">
      Payment: ${escapeHtml(order.paymentMethod.toUpperCase())} · ${escapeHtml(order.paymentStatus)}<br/>
      Order placed: ${new Date(order.createdAt).toLocaleString('en-IN')}
    </p>
  </div>`;
}

/** Per-status copy for the customer-facing emails. */
const CUSTOMER_STATUS_COPY = {
  placed: {
    subject: 'Order received',
    heading: 'Thanks for your order!',
    body: "We've received your order and you'll get another email as soon as the seller confirms it.",
    cta: 'View order',
    pillBg: '#141414',
    pillText: '#FFFFFF',
  },
  confirmed: {
    subject: 'Order confirmed',
    heading: 'Your order is confirmed',
    body: 'The seller has confirmed your order and is preparing it for dispatch.',
    cta: 'Track order',
    pillBg: '#141414',
    pillText: '#FFFFFF',
  },
  shipped: {
    subject: 'Order shipped',
    heading: 'Your order is on its way 🛵',
    body: "Great news — the seller has dispatched your order. It'll arrive shortly.",
    cta: 'Track order',
    pillBg: '#141414',
    pillText: '#FFFFFF',
  },
  delivered: {
    subject: 'Order delivered',
    heading: 'Delivered!',
    body: 'Your order has been marked delivered. We hope you love it — drop in anytime to leave a review.',
    cta: 'View order',
    pillBg: '#141414',
    pillText: '#FFFFFF',
  },
  cancelled: {
    subject: 'Order cancelled',
    heading: 'Your order was cancelled',
    body: 'Your cancellation is recorded. Stock and refunds are released after the carrier confirms the parcel has stopped. Check your order for the current status.',
    cta: 'View order',
    pillBg: '#c0392b',
    pillText: '#FFFFFF',
  },
};

/** Render the customer email HTML for a given order + status. */
function customerEmailHtml(order, status) {
  const copy = CUSTOMER_STATUS_COPY[status];
  if (!copy) return '';
  const userName = (order.user && order.user.name) || 'there';
  const a = order.shippingAddress;
  const orderUrl = `${frontendBase()}/account/orders/${order._id}`;

  return `
  <div style="font-family:Segoe UI,Roboto,sans-serif;max-width:640px;margin:auto;background:#EFF1EA;padding:32px;border-radius:12px">
    ${brandHeader()}

    <span style="display:inline-block;margin:18px 0 6px;background:${copy.pillBg};color:${copy.pillText};padding:4px 12px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase">
      ${escapeHtml(status)}
    </span>

    <h2 style="margin:6px 0 4px;color:#141414">${escapeHtml(copy.heading)}</h2>
    <p style="color:#3f3f44;line-height:1.5;margin:0">
      Hi ${escapeHtml(userName)},<br/><br/>
      ${escapeHtml(copy.body)}
    </p>

    <h3 style="margin:24px 0 8px;color:#141414">Order ${escapeHtml(order.orderNumber)}</h3>
    <table style="width:100%;border-collapse:collapse">${itemRowsHtml(order.items)}</table>

    <table style="width:100%;margin-top:10px">
      <tr>
        <td style="color:#717177;font-size:13px">Items total</td>
        <td style="text-align:right;color:#141414;font-size:13px">₹${inr(order.itemsTotal)}</td>
      </tr>
      <tr>
        <td style="color:#717177;font-size:13px">Shipping</td>
        <td style="text-align:right;color:#141414;font-size:13px">${order.shippingFee > 0 ? '₹' + inr(order.shippingFee) : 'Free'}</td>
      </tr>
      <tr>
        <td style="color:#141414;font-weight:800;padding-top:6px">Total</td>
        <td style="text-align:right;color:#141414;font-weight:800;padding-top:6px">₹${inr(order.total)}</td>
      </tr>
    </table>

    <h3 style="margin:24px 0 8px;color:#141414">Ship to</h3>
    <div style="background:white;border:1px solid #e7e7e9;border-radius:8px;padding:14px;font-size:14px;color:#27272a;line-height:1.5">
      <strong>${escapeHtml(a.fullName)}</strong><br/>
      ${escapeHtml(a.phone)}<br/>
      ${escapeHtml(a.line1)}<br/>
      ${a.line2 ? escapeHtml(a.line2) + '<br/>' : ''}
      ${escapeHtml(a.city)}, ${escapeHtml(a.state)} ${escapeHtml(a.pincode)}<br/>
      ${escapeHtml(a.country || 'India')}
    </div>

    <div style="margin:24px 0">
      <a href="${orderUrl}"
         style="background:#141414;color:#FFFFFF;padding:12px 22px;text-decoration:none;border-radius:8px;font-weight:bold;display:inline-block">
         ${escapeHtml(copy.cta)}
      </a>
    </div>

    <p style="font-size:12px;color:#717177;margin-top:18px">
      Order placed: ${new Date(order.createdAt).toLocaleString('en-IN')}<br/>
      Payment: ${escapeHtml(order.paymentMethod.toUpperCase())} · ${escapeHtml(order.paymentStatus)}
    </p>
  </div>`;
}

module.exports = { inr, escapeHtml, adminBase, sellerEmailHtml, CUSTOMER_STATUS_COPY, customerEmailHtml };
