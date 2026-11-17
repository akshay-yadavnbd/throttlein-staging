/**
 * Orders module — public surface.
 *
 *   routes      orders.routes.js          seller / customer / admin routers
 *   controllers *.controller.js           HTTP ⇄ service, no rules
 *   services    checkout(-pricing) / fulfilment / dispatch / awb / ndr-manifest / return-legs / returns / refunds / cancellation
 *               shipment-sync (carrier events → order state) / shipment-worker / tax-invoice
 *   state       order-state.js            derived status, slice lookups; shipment-status.js (carrier status mapping)
 *   presenter   orders.presenter.js       response shapes
 *   data        *.repository.js           every query (Order, intents, cart, stock, users, shipment inbox, invoices)
 *
 * Other modules, routes/webhookRoutes.js, src/index.js and scripts use only
 * what is exported here.
 */
const checkoutController = require('./checkout.controller');
const customerController = require('./customer-orders.controller');
const sellerController = require('./seller-orders.controller');
const sellerReturnsController = require('./seller-returns.controller');
const adminController = require('./admin-orders.controller');

const { pushOrderToShiprocket } = require('./dispatch.service');
const { deriveOrderAggregate } = require('./order-state');
const { withFulfillmentLock } = require('./orders.repository');
const { sellerSafeAddress, sellerOrderDto } = require('./orders.presenter');
const { applyRazorpayRefund } = require('./refunds.service');
const { finalizeOrder, assertPaymentMatchesIntent } = require('./checkout.service');
const { buildOrderPayload } = require('./checkout-pricing.service');
const { restoreCancelledStock } = require('./cancellation.service');
const { enqueueShipmentEvent, processShipmentEvent } = require('./shipment-sync.service');
const { startShipmentWorker } = require('./shipment-worker.service');

module.exports = {
  // HTTP handlers
  ...checkoutController,
  ...customerController,
  ...sellerController,
  ...sellerReturnsController,
  ...adminController,
  // Shared with scripts and tests
  pushOrderToShiprocket,
  deriveOrderAggregate,
  withFulfillmentLock,
  sellerSafeAddress,
  sellerOrderDto,
  applyRazorpayRefund,
  finalizeOrder,
  buildOrderPayload,
  assertPaymentMatchesIntent,
  restoreCancelledStock,
  // Carrier webhooks (routes/webhookRoutes.js) and the shipment worker (src/index.js)
  enqueueShipmentEvent,
  processShipmentEvent,
  startShipmentWorker,
  /** Carrier status mapping, exposed for the webhook route's tests. */
  shipmentStatus: require('./shipment-status'),
  routes: require('./orders.routes'),
};
