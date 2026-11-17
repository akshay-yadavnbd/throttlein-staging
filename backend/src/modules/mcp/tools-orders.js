/** MCP tools — Order tools: search and detail, failed shipments, checkout failures, refunds. Entries follow the contract in ./tools.js. */
'use strict';
const z = require('zod/v4');
const { CHECKOUT_FAILURE_STEPS: STEPS } = require('../customers');
const { ToolError } = require('./errors');
const redact = require('./redact');
const data = require('./tools.repository');
const {
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  REFUND_STATUSES,
  escapeRegex,
  dateArg,
  limitArg,
  cursorArg,
  revealArg,
  sellerArg,
  dayIST,
  requireSeller,
  sellerMap,
  paged,
} = require('./tool-helpers');

const orderTools = [
  {
    name: 'tin_orders_search',
    title: 'Search orders',
    description:
      'Orders newest first with optional filters. `query` matches the order number or the customer name/email; `awb` matches a courier tracking number; `from`/`to` are inclusive IST dates. Page with `cursor`.',
    scope: 'orders:read',
    untrustedOutput: false,
    input: {
      status: z.enum(ORDER_STATUSES).optional(),
      paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
      seller: sellerArg,
      query: z.string().trim().min(2).max(100).optional().describe('Order number or customer name/email'),
      awb: z.string().trim().min(3).max(60).optional().describe('Courier AWB / tracking number'),
      from: dateArg('Placed on or after'),
      to: dateArg('Placed on or before'),
      limit: limitArg,
      cursor: cursorArg,
      reveal: revealArg,
    },
    safeArgs: ['status', 'paymentStatus', 'from', 'to', 'limit', 'reveal'],
    run: async (args, ctx) => {
      const { status, paymentStatus, seller, query, awb, from, to } = args;
      // Admin-deleted (archived) orders stay out, as in the admin panel.
      /** @type {Record<string, any>} */
      const filter = { ...data.NOT_ARCHIVED };
      if (status) filter.status = status;
      if (paymentStatus) filter.paymentStatus = paymentStatus;
      if (awb) filter['sellerShipments.awbCode'] = awb;
      const fromAt = dayIST(from, false);
      const toAt = dayIST(to, true);
      if (fromAt || toAt) filter.createdAt = { ...(fromAt && { $gte: fromAt }), ...(toAt && { $lte: toAt }) };
      if (seller) filter['items.seller'] = (await requireSeller(seller))._id;
      if (query) {
        const re = new RegExp(escapeRegex(query), 'i');
        const customers = await data.customersMatching(re);
        filter.$or = [{ orderNumber: re }, { user: { $in: customers.map((u) => u._id) } }];
      }
      const { page, meta, cursorAfter } = await paged(
        ctx,
        args,
        { status, paymentStatus, seller, query, awb, from, to },
        (skip, n) => data.ordersPage(filter, skip, n),
      );
      const sellers = await sellerMap(page);
      return { items: page.map((o) => redact.orderSummary(o, sellers, ctx.view)), meta, cursorAfter };
    },
  },
  {
    name: 'tin_orders_get',
    title: 'Get order',
    description:
      'Full operational detail for one order by order number (e.g. TIN-2026-000123) or id: customer, items, payment, per-seller shipments with courier errors, and return/refund requests.',
    scope: 'orders:read',
    untrustedOutput: true,
    input: { order: z.string().trim().min(3).max(40).describe('Order number or id'), reveal: revealArg },
    safeArgs: ['order', 'reveal'],
    run: async ({ order }, ctx) => {
      const doc = await data.findOrder(order);
      if (!doc) throw new ToolError('NOT_FOUND', `Order "${order}" was not found.`);
      return { items: [redact.orderDetail(doc, await sellerMap([doc]), ctx.view)] };
    },
  },
  {
    name: 'tin_shipments_failed',
    title: 'Problem shipments',
    description:
      'Seller shipments stuck in a problem state — `failed` (Shiprocket push failed at checkout; sellers retry from their panel), `undelivered` or `lost` — with the courier error and the seller to nudge.',
    scope: 'orders:read',
    untrustedOutput: true,
    input: { status: z.enum(['failed', 'undelivered', 'lost']).default('failed'), limit: limitArg, cursor: cursorArg },
    safeArgs: ['status', 'limit'],
    run: async (args, ctx) => {
      const { page, meta, cursorAfter } = await paged(ctx, args, { status: args.status }, (skip, n) =>
        data.shipmentsPage(args.status, skip, n),
      );
      const sellers = await sellerMap(page);
      const items = [];
      for (const o of page) {
        for (const s of o.sellerShipments || [])
          if (s.status === args.status)
            items.push({
              orderNumber: o.orderNumber,
              orderId: String(o._id),
              placedAt: o.createdAt,
              orderStatus: o.status,
              shipment: redact.shipmentSummary(s, sellers),
            });
      }
      return { items, meta, cursorAfter };
    },
  },
  {
    name: 'tin_checkout_failures',
    title: 'Checkout failures',
    description:
      'Checkout and payment failures in the last N hours (default 24, max 30 days) with a per-step breakdown. Records are kept for 90 days.',
    scope: 'orders:read',
    untrustedOutput: true,
    input: {
      step: z.enum(STEPS).optional(),
      hours: z.number().int().min(1).max(720).default(24),
      limit: limitArg,
      cursor: cursorArg,
      reveal: revealArg,
    },
    safeArgs: ['step', 'hours', 'limit', 'reveal'],
    run: async (args, ctx) => {
      const since = new Date(Date.now() - args.hours * 3600000);
      const filter = { createdAt: { $gte: since }, ...(args.step && { step: args.step }) };
      const [{ page, meta, cursorAfter }, byStep] = await Promise.all([
        paged(ctx, args, { step: args.step, hours: args.hours }, (skip, n) =>
          data.checkoutFailuresPage(filter, skip, n),
        ),
        data.checkoutFailuresByStep(since),
      ]);
      return {
        items: page.map((f) => redact.checkoutFailureRow(f, ctx.view)),
        meta: { ...meta, since, byStep: Object.fromEntries(byStep.map((r) => [r._id, r.n])) },
        cursorAfter,
      };
    },
  },
  {
    name: 'tin_refunds_list',
    title: 'Refund queue',
    description:
      'Return/exchange requests flagged for refund. Default shows the admin inbox (`requested`); use `all` for history. Customer payout details are always masked.',
    scope: 'refunds:read',
    untrustedOutput: true,
    input: {
      status: z.enum([...REFUND_STATUSES, 'all']).default('requested'),
      limit: limitArg,
      cursor: cursorArg,
      reveal: revealArg,
    },
    safeArgs: ['status', 'limit', 'reveal'],
    run: async (args, ctx) => {
      const statuses = args.status === 'all' ? REFUND_STATUSES : [args.status];
      const { page, meta, cursorAfter } = await paged(ctx, args, { status: args.status }, (skip, n) =>
        data.refundsPage(statuses, skip, n),
      );
      const sellers = await sellerMap(page);
      const items = [];
      for (const o of page)
        for (const r of o.returnRequests || [])
          if (statuses.includes(r.refundStatus)) items.push(redact.refundRow(o, r, sellers, ctx.view));
      return { items, meta, cursorAfter };
    },
  },
];

module.exports = { orderTools };
