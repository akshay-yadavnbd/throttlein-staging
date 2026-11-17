/**
 * Customers module routers.
 *
 *   shopper          mounted inside routes/customerRoutes.js, after its top-level `protect`:
 *                    /cart, /wishlist, /notify-me, /addresses, /checkout/failures
 *   admin            mounted inside routes/adminRoutes.js (/api/admin), after its staff guard:
 *                    /checkout-failures (`orders` permission), /customer-carts (`customers` permission)
 *   (emailPreferences, /api/email, lives in email-preferences.routes.js)
 */
const express = require('express');
const { requirePermission } = require('../../middleware/auth');
const rateLimit = require('../../middleware/rateLimit');
const { validate } = require('../../middleware/validate');
const G = require('../../validation/generic');
const s = require('./customers.schema');
const c = require('./customers.controller');

const list = validate({ query: G.listQuery });
const byItemId = validate({ params: G.params({ itemId: 'objectId' }) });
const byProductId = validate({ params: G.params({ productId: 'objectId' }) });
const byId = validate({ params: G.params({ id: 'objectId' }) });

const shopper = express.Router();
shopper.get('/cart', list, c.getCart);
// Per-seller courier options for the bag (sellers who pass delivery on).
shopper.get('/cart/delivery-options', list, c.deliveryOptions);
shopper.post('/cart', validate({ body: s.cartAdd }), c.addToCart);
shopper.put(
  '/cart/:itemId',
  validate({ params: G.params({ itemId: 'objectId' }), body: s.cartUpdate }),
  c.updateCartItem,
);
shopper.delete('/cart/:itemId', byItemId, c.removeCartItem);
shopper.delete('/cart', c.clearCart);

shopper.get('/wishlist', list, c.getWishlist);
shopper.post('/wishlist', validate({ body: s.productRef }), c.addToWishlist);
shopper.delete('/wishlist/:productId', byProductId, c.removeFromWishlist);

// "Email me when this is back in stock".
shopper.post('/notify-me', validate({ body: s.productRef }), c.notifyWhenInStock);

shopper.get('/addresses', list, c.listAddresses);
shopper.post('/addresses', validate({ body: s.address }), c.createAddress);
shopper.put('/addresses/:id', validate({ params: G.params({ id: 'objectId' }), body: s.address }), c.updateAddress);
shopper.patch(
  '/addresses/:id/default',
  validate({ params: G.params({ id: 'objectId' }), body: G.objectBody }),
  c.setDefaultAddress,
);
shopper.delete('/addresses/:id', byId, c.removeAddress);

shopper.post(
  '/checkout/failures',
  rateLimit({ name: 'checkout-failures', max: 30, window: 60, keyBy: (req) => String(req.user._id) }),
  validate({ body: G.objectBody }),
  c.reportCheckoutFailure,
);

const admin = express.Router();
admin.get('/checkout-failures', requirePermission('orders'), list, c.listCheckoutFailures);
admin.get('/customer-carts', requirePermission('customers'), list, c.listCustomerCarts);

module.exports = { shopper, admin };
