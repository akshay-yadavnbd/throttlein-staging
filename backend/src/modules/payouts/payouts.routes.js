/**
 * Payouts module routers.
 *
 *   seller  mounted inside routes/sellerOrderRoutes.js (/api/seller), after its
 *           protect + requireRole('seller', 'superadmin') guard: GET /payouts
 *   admin   mounted inside routes/adminRoutes.js (/api/admin), after its staff
 *           guard; every route needs the `settlements` permission
 */
const express = require('express');
const { requirePermission } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const G = require('../../validation/generic');
const c = require('./payouts.controller');

const list = validate({ query: G.listQuery });

const seller = express.Router();
// Delivered parcels rolled into weekly settlements.
seller.get('/payouts', list, c.sellerSummary);

const admin = express.Router();
const settlements = requirePermission('settlements');
admin.get('/settlements', settlements, list, c.adminWeek);
admin.get('/settlements/history', settlements, list, c.adminHistory);
admin.get('/settlements/in-transit', settlements, list, c.adminInTransit);
admin.post('/settlements/pay', settlements, validate({ body: G.objectBody }), c.adminPay);
admin.patch(
  '/orders/:idOrNumber/shipments/:sellerId/courier-charge',
  settlements,
  validate({ params: G.params({ idOrNumber: 'orderRef', sellerId: 'objectId' }), body: G.objectBody }),
  c.adminSetCourierCharge,
);

module.exports = { seller, admin };
