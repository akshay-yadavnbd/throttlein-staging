/**
 * Route tables for the orders module. Three routers, each mounted by the
 * audience's route file (which already applied `protect` and the role
 * guard):
 *
 *   seller   → routes/sellerOrderRoutes.js   (/api/seller/…)
 *   customer → routes/customerRoutes.js      (/api/orders/…, /api/uploads/…)
 *   admin    → routes/adminRoutes.js         (/api/admin/…)
 *
 * The Razorpay webhook stays in routes/webhookRoutes.js (public path).
 */
const express = require('express');
const { requirePermission } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const upload = require('../../middleware/upload');
const o = require('./orders.schema');
const seller = require('./seller-orders.controller');
const sellerReturns = require('./seller-returns.controller');
const customer = require('./customer-orders.controller');
const checkout = require('./checkout.controller');
const admin = require('./admin-orders.controller');

/* ── seller ───────────────────────────────────────────────────────────── */
const sellerRouter = express.Router();
const byId = validate({ params: o.orderParams });
const byRequest = validate({ params: o.requestParams });

sellerRouter.get('/orders', validate({ query: o.listQuery }), seller.listSellerOrders);
// Static paths BEFORE /orders/:id so the param route doesn't capture them.
sellerRouter.get('/orders/attention', seller.sellerAttentionCounts);
sellerRouter.get('/orders/ndr', validate({ query: o.ndrQuery }), seller.sellerListNdr);
sellerRouter.get('/orders/:id', byId, seller.getSellerOrder);
sellerRouter.patch(
  '/orders/:id/status',
  validate({ params: o.orderParams, body: o.updateStatus }),
  seller.updateSellerOrderStatus,
);

// Self-serve shipping — AWB + pickup with Shiprocket; optional { courier_id }.
sellerRouter.post('/orders/:id/ship', validate({ params: o.orderParams, body: o.ship }), seller.sellerShipOrder);
sellerRouter.get('/orders/:id/couriers', byId, seller.sellerOrderCouriers);
// Pickup didn't happen — another attempt, optionally with a different courier.
sellerRouter.post(
  '/orders/:id/reschedule-pickup',
  validate({ params: o.orderParams, body: o.reschedulePickup }),
  seller.sellerReschedulePickup,
);

// Label / invoice / tracking / cancel — the seller never opens Shiprocket.
sellerRouter.get('/orders/:id/label', byId, seller.sellerOrderLabel);
sellerRouter.get('/orders/:id/invoice', byId, seller.sellerOrderInvoice);
sellerRouter.get('/orders/:id/track', byId, seller.sellerOrderTrack);
sellerRouter.post('/orders/:id/cancel-shipment', byId, seller.sellerCancelShipment);
// Cancel before a label exists, then clear the row from the seller's own list.
sellerRouter.post('/orders/:id/cancel-order', byId, seller.sellerCancelOrder);
sellerRouter.post('/orders/:id/hide', validate({ params: o.orderParams, body: o.hide }), seller.sellerHideOrder);

// NDR (Non-Delivery Report) actions
sellerRouter.post(
  '/orders/:id/ndr-action',
  validate({ params: o.orderParams, body: o.ndrAction }),
  seller.sellerNdrAction,
);

// Returns / reverse pickup
sellerRouter.post(
  '/orders/:id/return',
  validate({ params: o.orderParams, body: o.createReturn }),
  sellerReturns.sellerCreateReturn,
);
sellerRouter.get('/return-requests', validate({ query: o.listQuery }), sellerReturns.sellerListReturnRequests);
sellerRouter.get('/return-requests/:reqId', validate({ params: o.reqIdParams }), sellerReturns.sellerGetReturnRequest);
sellerRouter.post('/orders/:id/return-request/:reqId/approve', byRequest, sellerReturns.sellerApproveReturnRequest);
sellerRouter.post(
  '/orders/:id/return-request/:reqId/decline',
  validate({ params: o.requestParams, body: o.decline }),
  sellerReturns.sellerDeclineReturnRequest,
);
sellerRouter.post(
  '/orders/:id/return-request/:reqId/verify',
  validate({ params: o.requestParams, body: o.verifyReturn }),
  sellerReturns.sellerVerifyReturn,
);
sellerRouter.post('/orders/:id/return-request/:reqId/raise-refund', byRequest, sellerReturns.sellerRaiseRefund);
sellerRouter.post(
  '/orders/:id/return-request/:reqId/ship-replacement',
  validate({ params: o.requestParams, body: o.shipReplacement }),
  sellerReturns.sellerShipReplacement,
);

// Manifest — one PDF for the parcels still to hand over
sellerRouter.get('/manifests/today', seller.sellerManifestToday);
// Self-serve retry of a failed Shiprocket push
sellerRouter.post('/orders/:id/retry-push', byId, seller.sellerRetryPush);

/* ── customer ─────────────────────────────────────────────────────────── */
const customerRouter = express.Router();
customerRouter.get('/orders', validate({ query: o.listQuery }), customer.list);
// Static paths BEFORE /orders/:id.
customerRouter.post('/orders/razorpay/init', validate({ body: o.razorpayInit }), checkout.razorpayInit);
customerRouter.post('/orders/razorpay/verify', validate({ body: o.razorpayVerify }), checkout.razorpayVerify);
customerRouter.get('/orders/:id', byId, customer.getOne);
customerRouter.get(
  '/orders/:id/invoice',
  validate({ params: o.orderParams, query: o.invoiceQuery }),
  customer.customerOrderInvoice,
);
customerRouter.post('/orders', validate({ body: o.createOrder }), checkout.create);
customerRouter.post('/orders/:id/cancel', byId, customer.cancel);
customerRouter.post(
  '/orders/:id/return-request',
  validate({ params: o.orderParams, body: o.returnRequest }),
  customer.customerCreateReturnRequest,
);
customerRouter.post('/orders/:id/return-request/:reqId/cancel', byRequest, customer.customerCancelReturnRequest);
// Evidence uploads — private prefix (audit A04); responses carry presigned URLs.
customerRouter.post(
  '/uploads/return-evidence',
  upload.setUploadPrefix((req) => `return-evidence/${req.user._id}`),
  upload.evidence.array('files', 6),
  validate({ body: o.anyBody }),
  customer.customerUploadReturnEvidence,
);

/* ── admin ────────────────────────────────────────────────────────────── */
const adminRouter = express.Router();
// Cancel shares the customer's cancellation core; reschedule shares the seller's pickup helper.
adminRouter.post(
  '/orders/:idOrNumber/cancel',
  requirePermission('orders'),
  validate({ params: o.adminOrderParams, body: o.adminCancel }),
  admin.adminCancelOrder,
);
adminRouter.post(
  '/orders/:idOrNumber/reschedule-pickup',
  requirePermission('orders'),
  validate({ params: o.adminOrderParams, body: o.adminReschedule }),
  admin.adminReschedulePickup,
);
// Refund queue — seller-raised requests the admin processes.
adminRouter.get(
  '/refund-requests',
  requirePermission('refunds'),
  validate({ query: o.refundListQuery }),
  admin.adminListRefundRequests,
);
adminRouter.get(
  '/refund-requests/:reqId',
  requirePermission('refunds'),
  validate({ params: o.reqIdParams }),
  admin.adminGetRefundRequest,
);
adminRouter.post(
  '/refund-requests/:reqId/reconcile',
  requirePermission('refunds'),
  validate({ params: o.reqIdParams }),
  admin.adminReconcileRefund,
);
adminRouter.post(
  '/refund-requests/:reqId/process',
  requirePermission('refunds'),
  validate({ params: o.reqIdParams, body: o.refundProcess }),
  admin.adminProcessRefund,
);
adminRouter.post(
  '/refund-requests/:reqId/release',
  requirePermission('refunds'),
  validate({ params: o.reqIdParams }),
  admin.adminReleaseRefund,
);

module.exports = { seller: sellerRouter, customer: customerRouter, admin: adminRouter };
