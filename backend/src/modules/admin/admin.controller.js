/**
 * Admin HTTP handlers — dashboard, sellers, customers, products, orders
 * feed, security, staff, platform tools. Each one reads the validated
 * request, calls one service function and answers. No rules live here.
 */
const asyncHandler = require('express-async-handler');
const { sendData, sendCreated, sendList, sendNoContent } = require('../../utils/apiResponse');
const { auditContext } = require('./audit-context');
const dashboard = require('./dashboard.service');
const sellers = require('./sellers.service');
const removal = require('./seller-removal.service');
const customers = require('./customers.service');
const security = require('./security.service');
const feed = require('./order-feed.service');
const moderation = require('./moderation.service');
const staff = require('./staff.service');
const tools = require('./platform-tools.service');
const reminders = require('./onboarding-reminders.service');

/** `fn(req)` → `{ data }`. Every admin screen reads the envelope through lib/api.ts `unwrap`. */
const respond = (fn) => asyncHandler(async (req, res) => sendData(res, await fn(req)));

/** A service page `{ items, total, page, limit }` → `{ data: { items }, meta }`. */
const listing = (fn) =>
  asyncHandler(async (req, res) => {
    const { items, total, page, limit } = await fn(req);
    sendList(res, items, { page, pageSize: limit, totalItems: total });
  });

/* ── dashboard (envelope: admin/app/dashboard) ──────────────────────── */
exports.dashboardStats = respond(() => dashboard.stats());
exports.dashboardOverview = respond(() => dashboard.overview());

/* ── sellers (envelope: admin/app/sellers, sellers/[slug], AdminShell bell) ── */
exports.sellerQueues = respond(async () => ({ queues: await sellers.queueCounts() }));
exports.listSellers = listing((req) => sellers.list(req.query));
exports.getSeller = respond((req) => sellers.detail(req.params.id));
exports.updateSellerStatus = respond((req) => sellers.setStatus(req.params.id, req.body.status));
exports.updateSeller = respond((req) => sellers.update(req.params.id, req.body));
exports.sellerDeletionImpact = respond((req) => removal.preview(req.params.id));
exports.deleteSeller = respond((req) => removal.remove(req.params.id));
/** The cooldown is skipped only when the admin deliberately forces it (`?force=true` or `{ force: true }`). */
exports.sendOnboardingReminder = respond((req) =>
  reminders.sendReminder(req.params.id, { force: req.query.force === 'true' || req.body?.force === true }),
);

/* ── customers (envelope: admin/app/customers, customers/[slug]) ────── */
exports.listCustomers = listing((req) => customers.list(req.query));
exports.getCustomer = respond((req) => customers.detail(req.params.id));
exports.deleteCustomer = respond((req) => customers.remove(req.params.id));

/* ── security (envelope: admin/app/security + the sellers page read it through unwrap) ── */
exports.getMasterKeyStatus = respond(() => security.status());
exports.setMasterKeyLogin = respond((req) => security.setPublicLogin(Boolean(req.body?.enabled), auditContext(req)));
exports.setMasterKey = respond((req) =>
  security.setKey(
    { adminPassword: String(req.body?.adminPassword || ''), newKey: String(req.body?.newKey || '') },
    auditContext(req),
  ),
);
exports.disableMasterKey = respond((req) =>
  security.disableKey(String(req.body?.adminPassword || ''), auditContext(req)),
);
exports.impersonateSeller = respond((req) =>
  security.impersonate(req.params.id, String(req.body?.password || ''), auditContext(req)),
);

/* ── orders feed (envelope: admin/app/orders*, dashboard, AdminShell bell, DeleteOrderDialog) ── */
const pageMeta = ({ page, limit, total, pages }) => ({ page, pageSize: limit, totalItems: total, totalPages: pages });
exports.listAllOrders = asyncHandler(async (req, res) => {
  const result = await feed.list(req.query);
  if (result.kind === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.body);
    return;
  }
  const { orders, statusCounts, archivedCount } = result;
  sendData(res, { items: orders, statusCounts, archivedCount }, 200, pageMeta(result));
});
exports.listFailedPushes = asyncHandler(async (req, res) => {
  const result = await feed.failedPushes(req.query);
  sendData(res, { items: result.orders }, 200, pageMeta(result));
});
exports.getOrderDetail = respond((req) => feed.detail(req.params.idOrNumber));
exports.archiveOrder = respond((req) =>
  feed.setArchived(req.params.idOrNumber, true, { reason: req.body?.reason, ctx: auditContext(req) }),
);
exports.restoreOrder = respond((req) =>
  feed.setArchived(req.params.idOrNumber, false, { reason: req.body?.reason, ctx: auditContext(req) }),
);

/* ── product moderation (envelope: admin/app/products) ──────────────── */
exports.listAllProducts = listing((req) => moderation.list(req.query, req.user._id));
exports.updateProductStatus = respond((req) => moderation.setStatus(req.params.id, req.body));
exports.updateProductLocations = respond((req) => moderation.setLocations(req.params.id, req.body));

/* ── staff (envelope: admin/app/staff reads it through unwrap) ──────── */
exports.listStaff = asyncHandler(async (req, res) => sendList(res, (await staff.list()).items));
exports.createStaff = asyncHandler(async (req, res) => sendCreated(res, await staff.create(req.body, req.user)));
exports.updateStaff = respond((req) => staff.update(req.params.id, req.body));
exports.resendStaffInvite = respond((req) => staff.resendInvite(req.params.id, req.user));
exports.deleteStaff = asyncHandler(async (req, res) => {
  await staff.remove(req.params.id);
  sendNoContent(res);
});
// DEPRECATED: the admin frontend reads its module list from its own
// registry. Kept as an empty answer so an older client degrades gracefully.
exports.listPermissions = respond(() => ({ permissions: [] }));

/* ── platform tools (envelope: admin/app/cache, shiprocket/cod-remittance) ── */
exports.shiprocketPing = respond(() => tools.shiprocketPing());
exports.shiprocketWallet = respond(() => tools.wallet());
exports.shiprocketWalletStatement = respond((req) => tools.walletStatement(req.query));
exports.shiprocketCodRemittance = respond(() => tools.codRemittance());
exports.redisInspect = respond((req) => tools.redisInspect(req.query));
exports.redisDeleteByPrefix = respond((req) => tools.redisDeleteByPrefix(req.query));
