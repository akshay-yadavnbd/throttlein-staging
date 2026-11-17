/**
 * Shared pieces of the MCP tool catalogue (./tools.js): status vocabularies, zod
 * argument builders, IST date windows, seller lookups, paging and the off-limits list.
 */
'use strict';
const z = require('zod/v4');
const { SELLER_QUEUE_FILTERS } = require('../../utils/sellerOnboarding');
const { ToolError } = require('./errors');
const data = require('./tools.repository');

const ORDER_STATUSES = ['placed', 'confirmed', 'shipped', 'delivered', 'cancelled'];
const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'refunded'];
const PRODUCT_STATUSES = ['draft', 'active', 'rejected', 'out_of_stock'];
const REFUND_STATUSES = ['requested', 'processing', 'completed', 'failed'];
const SHIPMENT_STATUSES = [
  'queued',
  'pushed',
  'awb',
  'shipped',
  'out_for_delivery',
  'delivered',
  'undelivered',
  'rto_initiated',
  'rto_delivered',
  'lost',
  'cancelled',
  'failed',
  'return_pickup',
  'returned',
];
const SELLER_STAGES = ['signups', 'kycWaiting', 'live', 'suspended'];
const IST_OFFSET_MS = 330 * 60 * 1000;

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const dateArg = (what) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe(`${what} (YYYY-MM-DD, IST)`);
const limitArg = z
  .number()
  .int()
  .min(1)
  .max(200)
  .optional()
  .describe("Rows per page (capped by the connector's page size)");
const cursorArg = z.string().max(1000).optional().describe('Continue from meta.nextCursor of the previous call');
const revealArg = z
  .boolean()
  .default(false)
  .describe('Return unmasked email/phone. Needs the contact:read scope and the superadmin switch; otherwise ignored.');
const sellerArg = z.string().trim().min(1).max(120).optional().describe('Seller id, slug or email');

/** Inclusive IST calendar day → UTC instant, matching the admin orders filter. */
function dayIST(value, endOfDay) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const d = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Midnight IST `daysAgo` days back, as a UTC instant. */
function istDayStart(daysAgo = 0) {
  const shifted = new Date(Date.now() + IST_OFFSET_MS);
  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() - daysAgo) - IST_OFFSET_MS,
  );
}

function istClock() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .formatToParts(new Date())
    .reduce((acc, p) => ({ ...acc, [p.type]: p.value }), /** @type {Record<string, string>} */ ({}));
  return {
    today: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday,
    now: `${parts.hour}:${parts.minute}`,
  };
}

async function resolveSeller(ref) {
  const v = String(ref || '').trim();
  if (!v) return null;
  return data.findSeller(v);
}

/** The onboarding queues, counted with the same filters the admin panel uses. */
async function sellerQueueCounts() {
  const keys = Object.keys(SELLER_QUEUE_FILTERS);
  const counts = await Promise.all(keys.map((k) => data.countUsers(SELLER_QUEUE_FILTERS[k])));
  return Object.fromEntries(keys.map((k, i) => [k, counts[i]]));
}

async function requireSeller(ref) {
  const seller = await resolveSeller(ref);
  if (!seller)
    throw new ToolError('NOT_FOUND', `No seller matches "${String(ref).slice(0, 60)}". Pass an id, slug or email.`);
  return seller;
}

async function sellerMap(orders) {
  const ids = new Set();
  for (const o of orders) {
    for (const it of o.items || []) if (it.seller) ids.add(String(it.seller));
    for (const s of o.sellerShipments || []) if (s.seller) ids.add(String(s.seller));
    for (const r of o.returnRequests || []) if (r.seller) ids.add(String(r.seller));
    for (const d of o.delivery || []) if (d.seller) ids.add(String(d.seller));
  }
  if (!ids.size) return new Map();
  const docs = await data.sellerNames([...ids]);
  return new Map(docs.map((d) => [String(d._id), d]));
}

/**
 * Skip-based paging behind an opaque cursor: fetch one row more than the page
 * to know whether a next page exists, and let the envelope move the cursor
 * back if it has to trim the page to the byte budget.
 */
async function paged(ctx, args, filters, query) {
  const limit = ctx.pageSize(args.limit);
  const position = ctx.decodeCursor(args.cursor, filters) || { skip: 0 };
  const skip = Math.max(0, Number(position.skip) || 0);
  const rows = await query(skip, limit + 1);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const cursorAfter = (kept) => ctx.encodeCursor(filters, { skip: skip + kept });
  return {
    page,
    meta: { nextCursor: hasMore ? cursorAfter(page.length) : null, skip },
    cursorAfter: hasMore || page.length ? cursorAfter : null,
  };
}

async function windowStats(since) {
  const [row] = await data.orderWindow(since);
  return { since, orders: row?.orders || 0, paidRevenue: round2(row?.paidRevenue), cancelled: row?.cancelled || 0 };
}

const OFF_LIMITS = Object.freeze([
  'Any change to data: this connector is read-only.',
  'Bank account numbers, UPI ids and PAN: always masked; only the last digits are shown.',
  'Razorpay signatures, idempotency keys, password and OTP hashes, fulfillment locks: never returned.',
  'Customer and seller email/phone: masked unless the call asks `reveal: true` and the connection holds contact:read with the superadmin switch on; each reveal is recorded.',
  'File paths and URLs for KYC documents and private uploads: status only, never links.',
]);

module.exports = {
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  PRODUCT_STATUSES,
  REFUND_STATUSES,
  SHIPMENT_STATUSES,
  SELLER_STAGES,
  escapeRegex,
  dateArg,
  limitArg,
  cursorArg,
  revealArg,
  sellerArg,
  dayIST,
  istDayStart,
  istClock,
  sellerQueueCounts,
  requireSeller,
  sellerMap,
  paged,
  windowStats,
  OFF_LIMITS,
};
