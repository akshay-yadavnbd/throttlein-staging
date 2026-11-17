/**
 * /api/admin — the mount list. Admin routes need either superadmin OR a
 * staff user with the right per-module permission: the guard here checks
 * auth + role, and each router or route layers `requirePermission(...)`.
 */
const express = require('express');
const { protect, requireRole } = require('../middleware/auth');
const adminModule = require('../modules/admin');
const ordersModule = require('../modules/orders');
const sellersModule = require('../modules/sellers');
const catalogModule = require('../modules/catalog');
const customersModule = require('../modules/customers');
const payoutsModule = require('../modules/payouts');
const notificationsModule = require('../modules/notifications');

const router = express.Router();

router.use(protect, requireRole('superadmin', 'staff'));

// Dashboard, sellers, customers, product moderation, order feed + archive,
// master key + impersonation, staff, Shiprocket account, cache inspector —
// src/modules/admin/admin.routes.js.
router.use(adminModule.routes);

// KYC review and the read-only Shiprocket pickup check — src/modules/sellers
// (admin router; every route requires the `kyc` permission). Admin-side
// Shiprocket retry routes are gone on purpose: sellers re-sync their own
// pickup and retry their own order push. Admin stays out of the shipping loop.
router.use(sellersModule.routes.admin);

// Admin verbs on an order (cancel, reschedule pickup) and the refund queue —
// src/modules/orders/orders.routes.js (admin router); each route carries its
// own requirePermission.
router.use(ordersModule.routes.admin);

// Checkout failure feed (`orders` permission) and live customer carts (`customers`) — src/modules/customers (admin router).
router.use(customersModule.routes.admin);

/* Internal notification recipients — who gets a copy of order, return,
 * refund and signup/KYC mail. superadmin ONLY: adding an address puts every
 * order in an inbox, so it isn't a staff-grantable permission. src/modules/notifications. */
router.use(notificationsModule.routes.admin);

/* Seller settlements (weekly payouts) and courier-charge corrections — src/modules/payouts.
 * `settlements` is a permission key in admin/lib/modules.ts. */
router.use(payoutsModule.routes.admin);

// Brand & Category requests — review seller-submitted asks for new brands/cats
// (src/modules/catalog, admin router; every route needs the `brand-requests` permission).
router.use(catalogModule.routes.adminRequests);

module.exports = router;
