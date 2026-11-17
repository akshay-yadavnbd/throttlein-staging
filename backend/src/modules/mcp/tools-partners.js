/** MCP tools — Seller and catalogue tools: sellers, KYC queue, products, settlements. Entries follow the contract in ./tools.js. */
'use strict';
const z = require('zod/v4');
const { SELLER_QUEUE_FILTERS } = require('../../utils/sellerOnboarding');
const redact = require('./redact');
const data = require('./tools.repository');
const {
  PRODUCT_STATUSES,
  SELLER_STAGES,
  escapeRegex,
  limitArg,
  cursorArg,
  revealArg,
  sellerArg,
  istDayStart,
  requireSeller,
  paged,
} = require('./tool-helpers');

const partnerTools = [
  {
    name: 'tin_sellers_list',
    title: 'List sellers',
    description:
      'Sellers by onboarding stage — signups (waiting on the seller), kycWaiting (waiting on us), live, suspended — with optional store name / name / email / slug search.',
    scope: 'sellers:read',
    input: {
      stage: z.enum(SELLER_STAGES).optional(),
      query: z.string().trim().min(2).max(100).optional().describe('Store name, name, email or slug'),
      limit: limitArg,
      cursor: cursorArg,
      reveal: revealArg,
    },
    safeArgs: ['stage', 'limit', 'reveal'],
    run: async (args, ctx) => {
      const filter = args.stage ? { ...SELLER_QUEUE_FILTERS[args.stage] } : { role: 'seller' };
      if (args.query) {
        const re = new RegExp(escapeRegex(args.query), 'i');
        filter.$and = [{ $or: [{ storeName: re }, { name: re }, { email: re }, { slug: re }] }];
      }
      const { page, meta, cursorAfter } = await paged(ctx, args, { stage: args.stage, query: args.query }, (skip, n) =>
        data.sellersPage(filter, skip, n),
      );
      return { items: page.map((u) => redact.sellerSummary(u, ctx.view)), meta, cursorAfter };
    },
  },
  {
    name: 'tin_sellers_get',
    title: 'Get seller',
    description:
      'One seller by id, slug or email: profile, policies, KYC status with masked bank/PAN (last digits only), and activity counts (products by status, orders in the last 30 days, open refunds, failed shipment pushes).',
    scope: 'sellers:read',
    untrustedOutput: true,
    input: { seller: z.string().trim().min(1).max(120).describe('Seller id, slug or email'), reveal: revealArg },
    safeArgs: ['reveal'],
    run: async ({ seller }, ctx) => {
      const doc = await requireSeller(seller);
      const [products, orders30d, openRefunds, failedShipments] = await Promise.all([
        data.productsByStatusForSeller(doc._id),
        data.countOrders({ 'items.seller': doc._id, createdAt: { $gte: istDayStart(29) }, ...data.NOT_ARCHIVED }),
        data.countOrders({
          returnRequests: { $elemMatch: { seller: doc._id, refundStatus: { $in: ['requested', 'processing'] } } },
        }),
        data.countOrders({
          sellerShipments: { $elemMatch: { seller: doc._id, status: 'failed' } },
          ...data.NOT_ARCHIVED,
        }),
      ]);
      return {
        items: [
          {
            ...redact.sellerDetail(doc, ctx.view),
            activity: {
              productsByStatus: Object.fromEntries(products.map((p) => [p._id, p.n])),
              ordersLast30Days: orders30d,
              openRefundRequests: openRefunds,
              failedShipmentPushes: failedShipments,
            },
          },
        ],
      };
    },
  },
  {
    name: 'tin_kyc_pending',
    title: 'Pending KYC',
    description:
      'Sellers whose KYC is submitted and waiting for review, oldest first, with how long they have waited and which documents are attached (status only, never the files).',
    scope: 'kyc:read',
    input: { limit: limitArg, cursor: cursorArg, reveal: revealArg },
    safeArgs: ['limit', 'reveal'],
    run: async (args, ctx) => {
      const { page, meta, cursorAfter } = await paged(ctx, args, {}, (skip, n) =>
        data.kycQueuePage(SELLER_QUEUE_FILTERS.kycWaiting, skip, n),
      );
      return {
        items: page.map((u) => {
          const d = redact.sellerDetail(u, ctx.view);
          const submittedAt = u.kyc?.submittedAt || null;
          return {
            id: d.id,
            storeName: d.storeName,
            name: d.name,
            email: d.email,
            phone: d.phone,
            submittedAt,
            waitingDays: submittedAt ? Math.floor((Date.now() - new Date(submittedAt).getTime()) / 86400000) : null,
            gstin: d.kyc.gstin,
            documents: d.kyc.documents,
            bank: d.kyc.bank,
          };
        }),
        meta,
        cursorAfter,
      };
    },
  },
  {
    name: 'tin_products_search',
    title: 'Search products',
    description:
      'Products across all sellers by name, SKU or slug, optionally filtered by status or seller; newest updates first.',
    scope: 'sellers:read',
    input: {
      query: z.string().trim().min(2).max(100).optional().describe('Name, SKU or slug'),
      status: z.enum(PRODUCT_STATUSES).optional(),
      seller: sellerArg,
      limit: limitArg,
      cursor: cursorArg,
    },
    safeArgs: ['status', 'limit'],
    run: async (args, ctx) => {
      const filter = {};
      if (args.status) filter.status = args.status;
      if (args.seller) filter.seller = (await requireSeller(args.seller))._id;
      if (args.query) {
        const re = new RegExp(escapeRegex(args.query), 'i');
        filter.$or = [{ name: re }, { sku: re }, { slug: re }];
      }
      const { page, meta, cursorAfter } = await paged(
        ctx,
        args,
        { query: args.query, status: args.status, seller: args.seller },
        (skip, n) => data.productsPage(filter, skip, n),
      );
      return { items: page.map(redact.productSummary), meta, cursorAfter };
    },
  },
  {
    name: 'tin_settlements_list',
    title: 'Seller settlements',
    description:
      'Weekly payouts recorded to sellers (what was transferred, UTR, period totals), newest first; optionally for one seller.',
    scope: 'settlements:read',
    input: { seller: sellerArg, limit: limitArg, cursor: cursorArg },
    safeArgs: ['limit'],
    run: async (args, ctx) => {
      const filter = args.seller ? { seller: (await requireSeller(args.seller))._id } : {};
      const { page, meta, cursorAfter } = await paged(ctx, args, { seller: args.seller }, (skip, n) =>
        data.settlementsPage(filter, skip, n),
      );
      return { items: page.map(redact.settlementRow), meta, cursorAfter };
    },
  },
];

module.exports = { partnerTools };
