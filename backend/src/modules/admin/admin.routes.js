/**
 * /api/admin routes owned by the admin module. Mounted by routes/adminRoutes.js
 * after its protect + requireRole('superadmin', 'staff') guard; each route
 * layers the staff permission it needs (dashboard endpoints stay open to
 * every authenticated admin so the home screen renders for everyone).
 */
const express = require('express');
const { requireRole, requirePermission } = require('../../middleware/auth');
const rateLimit = require('../../middleware/rateLimit');
const { validate } = require('../../middleware/validate');
const a = require('./admin.schema');
const c = require('./admin.controller');

const router = express.Router();
const superadmin = requireRole('superadmin');
const sensitiveLimit = rateLimit({ name: 'admin-step-up', max: 10, window: 900 });
const byIdOrSlug = validate({ params: a.idOrSlugParams });
const byObjectId = validate({ params: a.objectIdParams });
const byOrderRef = validate({ params: a.orderRefParams });

router.get('/stats', c.dashboardStats);
router.get('/overview', c.dashboardOverview);

/* ── sellers ────────────────────────────────────────────────────────── */
const sellersStaff = requirePermission('sellers');
router.get('/sellers', sellersStaff, validate({ query: a.sellersQuery }), c.listSellers);
router.get('/sellers/queues', sellersStaff, c.sellerQueues);
router.get('/sellers/:id', sellersStaff, byIdOrSlug, c.getSeller);
router.patch('/sellers/:id', sellersStaff, validate({ params: a.idOrSlugParams, body: a.objectBody }), c.updateSeller);
router.patch(
  '/sellers/:id/status',
  sellersStaff,
  validate({ params: a.idOrSlugParams, body: a.sellerStatusBody }),
  c.updateSellerStatus,
);
/* Sign in as a seller. superadmin ONLY — not staff holding `sellers` — and
 * the handler re-checks the step-up credential (security.service.js). */
router.post(
  '/sellers/:id/impersonate',
  superadmin,
  sensitiveLimit,
  validate({ params: a.idOrSlugParams, body: a.impersonateBody }),
  c.impersonateSeller,
);
// Read-only preview powering the delete confirmation dialog.
router.get('/sellers/:id/deletion-impact', sellersStaff, byIdOrSlug, c.sellerDeletionImpact);
router.delete('/sellers/:id', sellersStaff, byIdOrSlug, c.deleteSeller);
// Email a stalled seller the nudge for where they stopped (onboarding-reminders.service.js).
router.post(
  '/sellers/:id/remind',
  sellersStaff,
  validate({ params: a.idOrSlugParams, body: a.objectBody }),
  c.sendOnboardingReminder,
);

/* ── master access key (superadmin only, see security.service.js) ──── */
router.get('/security/master-key', superadmin, c.getMasterKeyStatus);
router.put('/security/master-key', superadmin, sensitiveLimit, validate({ body: a.masterKeyBody }), c.setMasterKey);
router.patch('/security/master-key/login', superadmin, validate({ body: a.objectBody }), c.setMasterKeyLogin);
router.delete('/security/master-key', superadmin, sensitiveLimit, c.disableMasterKey);

/* ── customers (buyers) ─────────────────────────────────────────────── */
const customersStaff = requirePermission('customers');
router.get('/customers', customersStaff, validate({ query: a.listQuery }), c.listCustomers);
router.get('/customers/:id', customersStaff, byIdOrSlug, c.getCustomer);
router.delete('/customers/:id', customersStaff, byIdOrSlug, c.deleteCustomer);

/* ── product moderation (under `sellers`: whoever manages sellers moderates listings) ── */
router.get('/products', sellersStaff, validate({ query: a.productsQuery }), c.listAllProducts);
router.patch(
  '/products/:id/status',
  sellersStaff,
  validate({ params: a.objectIdParams, body: a.objectBody }),
  c.updateProductStatus,
);
router.patch(
  '/products/:id/locations',
  sellersStaff,
  validate({ params: a.objectIdParams, body: a.objectBody }),
  c.updateProductLocations,
);

/* ── orders feed ────────────────────────────────────────────────────── */
const ordersStaff = requirePermission('orders');
router.get('/orders', ordersStaff, validate({ query: a.ordersQuery }), c.listAllOrders);
// Static path before the param route so "failed-pushes" is never read as an order number.
router.get('/orders/failed-pushes', ordersStaff, validate({ query: a.listQuery }), c.listFailedPushes);
router.get('/orders/:idOrNumber', ordersStaff, byOrderRef, c.getOrderDetail);
// "Delete order" = archive (hidden everywhere people look, restorable).
router.post(
  '/orders/:idOrNumber/archive',
  ordersStaff,
  validate({ params: a.orderRefParams, body: a.archiveBody }),
  c.archiveOrder,
);
router.post(
  '/orders/:idOrNumber/restore',
  ordersStaff,
  validate({ params: a.orderRefParams, body: a.objectBody }),
  c.restoreOrder,
);

/* ── staff (internal users) ─────────────────────────────────────────── */
const staffStaff = requirePermission('staff');
router.get('/staff/permissions', staffStaff, c.listPermissions);
router.get('/staff', staffStaff, c.listStaff);
router.post('/staff', staffStaff, validate({ body: a.objectBody }), c.createStaff);
router.patch('/staff/:id', staffStaff, validate({ params: a.objectIdParams, body: a.objectBody }), c.updateStaff);
router.post(
  '/staff/:id/resend-invite',
  staffStaff,
  validate({ params: a.objectIdParams, body: a.objectBody }),
  c.resendStaffInvite,
);
router.delete('/staff/:id', staffStaff, byObjectId, c.deleteStaff);

/* ── Shiprocket account (all sellers ship under the one THROTTLEIN account) ── */
router.get('/shiprocket/ping', ordersStaff, c.shiprocketPing);
router.get('/shiprocket/wallet', ordersStaff, c.shiprocketWallet);
router.get(
  '/shiprocket/wallet/statement',
  ordersStaff,
  validate({ query: a.walletStatementQuery }),
  c.shiprocketWalletStatement,
);
router.get('/shiprocket/cod-remittance', ordersStaff, c.shiprocketCodRemittance);

/* ── Cache inspector: superadmin only, no staff permission maps to it ── */
router.get('/redis/inspect', superadmin, validate({ query: a.redisInspectQuery }), c.redisInspect);
router.delete('/redis/delete-by-prefix', superadmin, validate({ query: a.redisDeleteQuery }), c.redisDeleteByPrefix);

module.exports = router;
