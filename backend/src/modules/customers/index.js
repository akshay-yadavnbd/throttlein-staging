/**
 * Customers module — public surface. The shopper's own data: cart (with an
 * availability verdict per line and per-seller delivery quotes), wishlist,
 * back-in-stock requests, saved addresses, checkout failure telemetry and
 * abandoned-cart reminder emails; plus the admin feeds over them.
 *
 *   routes      customers.routes.js        shopper, admin; email-preferences.routes.js (/api/email)
 *   controllers customers.controller.js, email-preferences.controller.js
 *   services    cart, delivery-quote, wishlist (+ back-in-stock), addresses, checkout-failures, admin-carts, cart-reminders
 *   pure        cart-availability (line verdicts), cart-reminder-email (copy + signed links)
 *   data        cart / wishlist / addresses / checkout-failures / admin-carts / cart-reminders repositories
 *   models      cart, wishlist, notify-request, checkout-failure (*.model.js)
 */
const failures = require('./checkout-failures.service');
const reminders = require('./cart-reminders.service');

module.exports = {
  routes: { ...require('./customers.routes'), emailPreferences: require('./email-preferences.routes') },
  /** Line verdicts the orders module re-checks at checkout. */
  cartAvailability: require('./cart-availability'),
  /** Per-seller delivery quotes: the cart's courier picker and checkout use the same function, so the shown price is the charged price. */
  deliveryQuote: require('./delivery-quote.service'),
  /** Checkout failure telemetry: the orders module records webhook failures; customerRoutes mounts the error capture. */
  CHECKOUT_FAILURE_STEPS: failures.STEPS,
  recordCheckoutFailure: failures.recordFailure,
  captureCheckoutFailure: failures.captureFailure,
  /** Started by src/index.js when CART_REMINDER_ENABLED is set. */
  startCartReminderWorker: reminders.startCartReminderWorker,
};
