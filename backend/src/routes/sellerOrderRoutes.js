const express = require('express');
const { protect, requireRole } = require('../middleware/auth');
const ordersModule = require('../modules/orders');
const sellersModule = require('../modules/sellers');
const catalogModule = require('../modules/catalog');
const payoutsModule = require('../modules/payouts');

const router = express.Router();

router.use(protect, requireRole('seller', 'superadmin'));

// Orders, returns, NDR, manifests — src/modules/orders/orders.routes.js (seller router).
router.use(ordersModule.routes.seller);

// KYC, Shiprocket pickup sync and pickup confirmation — src/modules/sellers (seller router).
router.use(sellersModule.routes.seller);

// Seller payouts: delivered parcels rolled into weekly settlements — src/modules/payouts (seller router).
router.use(payoutsModule.routes.seller);

// Brand & Category requests — seller submits, admin reviews on /brand-requests
// (src/modules/catalog, seller router).
router.use(catalogModule.routes.sellerRequests);

module.exports = router;
