/**
 * Order emails and team notices. Every function here is fire-and-forget
 * safe: failures are logged, never thrown, so a mail outage cannot fail
 * an order. Callers import the module object so tests can swap it whole.
 */
const { env } = require('../../config/env');
const { sendMail } = require('../../config/mail');
const { logger } = require('../../utils/logger');
const orders = require('./orders.repository');
const parties = require('./parties.repository');

const {
  inr,
  escapeHtml,
  adminBase,
  sellerEmailHtml,
  CUSTOMER_STATUS_COPY,
  customerEmailHtml,
} = require('./order-emails');

/** Customer email for a lifecycle status — errors logged, never thrown. */
async function sendCustomerStatusEmail(orderId, status) {
  try {
    const order = await orders.findByIdWithCustomer(orderId);
    if (!order || !order.user?.email) return;
    const copy = CUSTOMER_STATUS_COPY[status];
    if (!copy) return;
    await sendMail({
      to: order.user.email,
      subject: `THROTTLEIN — ${copy.subject} (${order.orderNumber})`,
      html: customerEmailHtml(order, status),
      text:
        `${copy.heading}\n\n${copy.body}\n\n` +
        `Order ${order.orderNumber}\n` +
        `Total: ₹${inr(order.total)}\n\n` +
        `Track it: ${env.FRONTEND_ORIGIN || 'http://localhost:3000'}/account/orders/${order._id}`,
    });
  } catch (err) {
    logger.error({ err, orderId: String(orderId), status }, 'customer status email failed');
  }
}

/**
 * Internal copy of an order event for the addresses configured under
 * super-admin → Notifications. Hung off the same call sites as the customer
 * email so the two can never fire on different conditions. ONE email per
 * order, covering every seller.
 *
 * "New orders" and "status changes" are separate subscriptions; a
 * cancellation is both a lifecycle change AND money moving, so it goes to
 * both lists (recipientsFor() unions and dedupes).
 *
 * @param {'placed'|'confirmed'|'shipped'|'delivered'|'cancelled'} status
 */
async function notifyTeamOfOrder(orderId, status) {
  try {
    const { notifyTeam, teamEmailHtml } = require('../notifications');
    const event =
      status === 'placed'
        ? 'orderPlaced'
        : status === 'cancelled'
          ? ['orderLifecycle', 'returnsRefunds']
          : 'orderLifecycle';

    const order = await orders.findByIdWithCustomer(orderId);
    if (!order) return;

    const sellerIds = [...new Set((order.items || []).filter((i) => i.seller).map((i) => i.seller.toString()))];
    const sellers = sellerIds.length ? await parties.sellerNames(sellerIds) : [];
    const sellerNames = sellers.map((s) => s.storeName || s.name).filter(Boolean);

    const a = order.shippingAddress || {};
    const heading = status === 'placed' ? `New order ${order.orderNumber}` : `Order ${order.orderNumber} — ${status}`;

    await notifyTeam({
      event,
      subject: `[THROTTLEIN] ${heading} · ₹${inr(order.total)}`,
      html: teamEmailHtml({
        heading,
        intro:
          status === 'placed'
            ? `${order.user?.name || 'A customer'} placed an order with ${sellerNames.length || 1} seller${sellerNames.length === 1 ? '' : 's'}.`
            : `This order moved to "${status}".`,
        rows: [
          { label: 'Order', value: order.orderNumber },
          { label: 'Total', value: `₹${inr(order.total)}` },
          { label: 'Payment', value: order.paymentMethod },
          { label: 'Items', value: (order.items || []).length },
          { label: 'Seller(s)', value: sellerNames.join(', ') },
          { label: 'Customer', value: order.user?.name },
          { label: 'Deliver to', value: [a.city, a.state, a.pincode].filter(Boolean).join(', ') },
        ],
        ctaUrl: `${adminBase()}/orders/${order.orderNumber}`,
        ctaLabel: 'Open order',
      }),
      text:
        `${heading}\nTotal: ₹${inr(order.total)} (${order.paymentMethod})\n` +
        `Seller(s): ${sellerNames.join(', ')}\n` +
        `${adminBase()}/orders/${order.orderNumber}`,
    });
  } catch (err) {
    // notifyTeam already swallows its own errors; this guards the lookups above.
    logger.error({ err, orderId: String(orderId), status }, 'team order notification failed');
  }
}

/** Per-seller "new order" emails. Errors are logged but don't block the order. */
async function emailSellersForOrder(order, customerName) {
  const bySeller = new Map();
  for (const it of order.items) {
    if (!it.seller) continue;
    const k = it.seller.toString();
    if (!bySeller.has(k)) bySeller.set(k, []);
    bySeller.get(k).push(it);
  }

  for (const [sellerId, items] of bySeller.entries()) {
    try {
      const seller = await parties.sellerById(sellerId);
      if (!seller?.email) continue;
      const sellerSubtotal = items.reduce((s, i) => s + i.subtotal, 0);
      await sendMail({
        to: seller.email,
        subject: `New order ${order.orderNumber} — ${items.length} item${items.length === 1 ? '' : 's'}`,
        html: sellerEmailHtml({ seller, order, sellerItems: items, sellerSubtotal, customerName }),
        text:
          `New order ${order.orderNumber} on THROTTLEIN.\n` +
          `${items.length} of your products were ordered.\n` +
          `Your subtotal: ₹${inr(sellerSubtotal)}\n` +
          `View it: ${env.FRONTEND_ORIGIN || 'http://localhost:3000'}/dashboard/orders/${order._id}`,
      });
    } catch (err) {
      logger.error({ err, sellerId }, 'seller order email failed');
    }
  }
}

/** The customer raised a return; the seller reviews it first. */
async function notifyTeamReturnRequested(order, created) {
  try {
    const { notifyTeam, teamEmailHtml } = require('../notifications');
    await notifyTeam({
      event: 'returnsRefunds',
      subject: `[THROTTLEIN] Return requested — order ${order.orderNumber}`,
      html: teamEmailHtml({
        heading: `Return requested on ${order.orderNumber}`,
        intro: 'A customer raised a return request. The seller reviews it first.',
        rows: [
          { label: 'Order', value: order.orderNumber },
          { label: 'Kind', value: created?.kind },
          { label: 'Reason', value: created?.reasonCode || created?.reason },
          { label: 'Items', value: (created?.items || []).length },
          { label: 'Requested', value: new Date().toLocaleString('en-IN') },
        ],
        ctaUrl: `${adminBase()}/orders/${order.orderNumber}`,
        ctaLabel: 'Open order',
      }),
      text: `Return requested on order ${order.orderNumber}. ${adminBase()}/orders/${order.orderNumber}`,
    });
  } catch {
    /* notifyTeam logs its own failures */
  }
}

/** A seller verified a return and raised a refund — it holds the customer's money, so the team hears now. */
async function notifyTeamRefundRaised(order, request, refundAmount, raisedBy) {
  try {
    const { notifyTeam, teamEmailHtml } = require('../notifications');
    await notifyTeam({
      event: 'returnsRefunds',
      subject: `[THROTTLEIN] Refund to process — ₹${inr(refundAmount)} on ${order.orderNumber}`,
      html: teamEmailHtml({
        heading: `Refund raised on ${order.orderNumber}`,
        intro: 'A seller verified a return and raised a refund. It is waiting in the refund queue.',
        rows: [
          { label: 'Order', value: order.orderNumber },
          { label: 'Amount', value: `₹${inr(refundAmount)}` },
          { label: 'Method', value: request.refundMethod },
          { label: 'Paid by', value: order.paymentMethod },
          { label: 'Raised by', value: raisedBy },
        ],
        ctaUrl: `${adminBase()}/refund-queue`,
        ctaLabel: 'Open refund queue',
      }),
      text:
        `Refund of ₹${inr(refundAmount)} raised on order ${order.orderNumber} ` +
        `(${request.refundMethod}). ${adminBase()}/refund-queue`,
    });
  } catch {
    /* notifyTeam logs its own failures */
  }
}

module.exports = {
  inr,
  escapeHtml,
  CUSTOMER_STATUS_COPY,
  sendCustomerStatusEmail,
  notifyTeamOfOrder,
  emailSellersForOrder,
  notifyTeamReturnRequested,
  notifyTeamRefundRaised,
};
