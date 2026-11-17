/**
 * Signed-in customer routes, mounted at /api by routes/api.js. Order matters:
 * the checkout failure capture is an error middleware and must come after the
 * checkout routes it watches.
 */
const express = require('express');
const { protect } = require('../middleware/auth');
const customersModule = require('../modules/customers');
const ordersModule = require('../modules/orders');

const router = express.Router();

// Every route here needs a signed-in user (any role can have a cart / wishlist).
router.use(protect);

// Cart, wishlist, back-in-stock, addresses, checkout failure reports — src/modules/customers (shopper router).
router.use(customersModule.routes.shopper);

// Orders, checkout, returns, evidence uploads — src/modules/orders/orders.routes.js (customer router).
router.use(ordersModule.routes.customer);

// Records where a checkout broke, then passes the original error on.
router.use(customersModule.captureCheckoutFailure);

module.exports = router;
