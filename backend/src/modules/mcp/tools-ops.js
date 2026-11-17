/** MCP tools — Connector and platform overview tools: who am I, why denied, the reference dictionary, health, overview. Entries follow the contract in ./tools.js. */
'use strict';
const z = require('zod/v4');
const mongoose = require('mongoose');
const { CHECKOUT_FAILURE_STEPS: STEPS } = require('../customers');
const { getClient } = require('../../database/redis');
const { ToolError, EXPLANATIONS } = require('./errors');
const { ALL_SCOPES, SCOPE_LABELS, describeAreas } = require('./scopes');
const data = require('./tools.repository');
const { env } = require('../../config/env');
const {
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  PRODUCT_STATUSES,
  REFUND_STATUSES,
  SHIPMENT_STATUSES,
  limitArg,
  cursorArg,
  istDayStart,
  istClock,
  sellerQueueCounts,
  paged,
  windowStats,
  OFF_LIMITS,
} = require('./tool-helpers');

const overviewTools = [
  {
    name: 'tin_access_whoami',
    title: 'Who am I',
    description:
      "The staff member this connection acts as (name, email, role), today's date and time in IST, the scopes the connection holds and what they allow, the tools it can call, its limits and what is permanently off-limits. Call this first.",
    scope: 'profile:read',
    run: async (_args, ctx) => ({
      items: [
        {
          name: ctx.user.name,
          email: ctx.user.email,
          role: ctx.user.role,
          company: 'Throttlein',
          timezone: 'Asia/Kolkata',
          ...istClock(),
          currency: 'INR',
          connection: {
            app: ctx.connection.clientName,
            approvalEndsAt: ctx.connection.approvalEndsAt,
            accessExpiresAt: ctx.connection.accessExpiresAt,
          },
          connectorMode: ctx.settings.mode,
          readOnly: true,
          scopes: ctx.scopes.map((scope) => ({ scope, allows: SCOPE_LABELS[scope] })),
          contactReveal: ctx.scopes.includes('contact:read') && ctx.settings.allowContactReveal,
          limits: {
            callsPerMinute: ctx.settings.limits.tokenPerMinute,
            recordsPerDay: ctx.settings.limits.dailyRecords,
            pageSize: ctx.settings.limits.pageSize,
            responseBytes: ctx.settings.limits.responseBytes,
          },
          tools: ctx.visibleTools,
          offLimits: OFF_LIMITS,
        },
      ],
    }),
  },
  {
    name: 'tin_access_explain',
    title: 'Explain access',
    description:
      'Explains an error code returned by this connector (pass `code`), or lists every code and which admin permission each data area requires.',
    scope: 'profile:read',
    input: { code: z.string().trim().max(60).optional().describe('An error code from another tin_* tool') },
    safeArgs: ['code'],
    run: async ({ code }) => {
      if (code) {
        const key = code.toUpperCase();
        if (!EXPLANATIONS[key]) throw new ToolError('NOT_FOUND', `Unknown error code "${code}".`);
        return { items: [{ code: key, meaning: EXPLANATIONS[key] }] };
      }
      return {
        items: [
          {
            errorCodes: Object.entries(EXPLANATIONS).map(([c, meaning]) => ({ code: c, meaning })),
            areas: describeAreas(),
            scopes: ALL_SCOPES,
            note: 'Superadmins hold every scope. Access is re-derived from the live account on every call.',
          },
        ],
      };
    },
  },
  {
    name: 'tin_reference_dictionary',
    title: 'Status dictionary',
    description:
      'The statuses and codes used across tin_* results — order, payment, shipment, refund, product and seller stages, and checkout failure steps — for interpreting rows.',
    scope: 'profile:read',
    run: async () => ({
      items: [
        {
          orderStatus: ORDER_STATUSES,
          paymentStatus: PAYMENT_STATUSES,
          shipmentStatus: SHIPMENT_STATUSES,
          refundStatus: REFUND_STATUSES,
          returnKind: ['return', 'exchange', 'cancellation'],
          productStatus: PRODUCT_STATUSES,
          sellerStage: {
            signups: 'Registered; waiting on the seller (email or KYC)',
            kycWaiting: 'KYC submitted; waiting for our review',
            live: 'Approved and selling',
            suspended: 'Switched off by an admin',
          },
          kycStatus: ['not_started', 'pending', 'approved', 'rejected'],
          checkoutFailureStep: STEPS,
          orderNumberFormat: 'TIN-<year>-<6 digits>, e.g. TIN-2026-000123',
          currency: 'INR; amounts are rupees with paise as decimals',
          dates: 'ISO 8601 in UTC; date filters are IST calendar days',
        },
      ],
    }),
  },
  {
    name: 'tin_ops_health',
    title: 'API health',
    description:
      'Liveness and dependency status of the Throttlein API: deployment revision, MongoDB and Redis connectivity, which integrations are configured, uptime.',
    scope: 'profile:read',
    run: async () => {
      let redis = 'disabled';
      const client = getClient();
      if (client) {
        try {
          redis = (await client.ping()) === 'PONG' ? 'ok' : 'unexpected';
        } catch {
          redis = 'unreachable';
        }
      }
      return {
        items: [
          {
            status: 'ok',
            revision: env.DEPLOY_COMMIT || 'local',
            environment: env.NODE_ENV || 'unset',
            mongodb: { connected: mongoose.connection.readyState === 1, database: mongoose.connection.name },
            redis,
            integrations: {
              razorpay: Boolean(env.RAZORPAY_KEY_ID),
              shiprocket: Boolean(env.SHIPROCKET_EMAIL || env.SHIPROCKET_TOKEN),
              smtp: Boolean(env.SMTP_HOST || env.HOST),
              s3: Boolean(env.S3_BUCKET_NAME),
            },
            uptimeSeconds: Math.round(process.uptime()),
            serverTime: new Date().toISOString(),
          },
        ],
      };
    },
  },
  {
    name: 'tin_ops_overview',
    title: 'Marketplace overview',
    description:
      'Operational snapshot: orders by status and payment status, today / 7-day / 30-day volumes (IST days; revenue counts only paid orders), seller onboarding queues, pending refunds, failed shipment pushes and checkout failures in the last 24h.',
    scope: 'profile:read',
    run: async () => {
      const [
        byStatus,
        byPayment,
        today,
        week,
        month,
        sellerQueues,
        pendingRefunds,
        failedShipments,
        checkoutFailures24h,
      ] = await Promise.all([
        data.ordersByStatus(),
        data.ordersByPayment(),
        windowStats(istDayStart(0)),
        windowStats(istDayStart(6)),
        windowStats(istDayStart(29)),
        sellerQueueCounts(),
        data.countOrders({ 'returnRequests.refundStatus': 'requested' }),
        data.countOrders({ 'sellerShipments.status': 'failed', ...data.NOT_ARCHIVED }),
        data.countCheckoutFailures({ createdAt: { $gte: new Date(Date.now() - 86400000) } }),
      ]);
      const counts = (rows) => Object.fromEntries(rows.map((r) => [r._id || 'unknown', r.n]));
      return {
        items: [
          {
            currency: 'INR',
            orders: {
              byStatus: counts(byStatus),
              byPaymentStatus: counts(byPayment),
              today,
              last7Days: week,
              last30Days: month,
            },
            sellers: sellerQueues,
            attention: {
              pendingRefundRequests: pendingRefunds,
              ordersWithFailedShipmentPush: failedShipments,
              checkoutFailuresLast24h: checkoutFailures24h,
            },
          },
        ],
      };
    },
  },
];

const auditTools = [
  {
    name: 'tin_ops_activity',
    title: 'Connector activity',
    description:
      "The connector's own audit trail (superadmin): who called which tool, outcome, records returned, sign-ins and token events. Arguments are never stored, only their fingerprint.",
    scope: 'ops:admin',
    input: {
      user: z.string().trim().max(120).optional().describe('Staff email or id'),
      tool: z.string().trim().max(60).optional(),
      event: z.string().trim().max(40).optional(),
      outcome: z.string().trim().max(20).optional(),
      limit: limitArg,
      cursor: cursorArg,
    },
    safeArgs: ['tool', 'event', 'outcome', 'limit'],
    run: async (args, ctx) => {
      const filter = {};
      if (args.tool) filter.tool = args.tool;
      if (args.event) filter.event = args.event;
      if (args.outcome) filter.outcome = args.outcome;
      if (args.user) {
        const u = await data.userIdByRef(args.user);
        if (!u) throw new ToolError('NOT_FOUND', 'No staff member matches that reference.');
        filter.user = u._id;
      }
      const { page, meta, cursorAfter } = await paged(
        ctx,
        args,
        { user: args.user, tool: args.tool, event: args.event, outcome: args.outcome },
        (skip, n) => data.auditPage(filter, skip, n),
      );
      return {
        items: page.map((r) => ({
          seq: r.seq,
          at: r.at,
          event: r.event,
          outcome: r.outcome,
          code: r.code || null,
          user: r.userEmail || (r.user ? String(r.user) : null),
          tool: r.tool || null,
          args: r.argsSummary || null,
          detail: r.detail || null,
          records: r.records ?? null,
          bytes: r.bytes ?? null,
          durationMs: r.durationMs ?? null,
          client: r.client || null,
        })),
        meta,
        cursorAfter,
      };
    },
  },
  {
    name: 'tin_ops_audit_verify',
    title: 'Verify audit trail',
    description:
      'Recomputes the HMAC of the most recent audit rows and checks the sequence for gaps (superadmin). A failure means rows were edited or deleted outside the connector.',
    scope: 'ops:admin',
    input: { rows: z.number().int().min(10).max(5000).default(500) },
    safeArgs: ['rows'],
    run: async ({ rows }, ctx) => {
      const recent = await data.recentAudit(rows);
      const result = ctx.audit.verify(recent.reverse());
      return { items: [{ ...result, fromSeq: recent[0]?.seq ?? null, toSeq: recent[recent.length - 1]?.seq ?? null }] };
    },
  },
];

module.exports = { overviewTools, auditTools };
