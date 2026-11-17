/** Offline sale HTTP handlers (/api/seller/offline-sales). Each calls one service function; no rules live here. */
const asyncHandler = require('express-async-handler');
const { sendData, sendCreated, sendNoContent } = require('../../utils/apiResponse');
const sales = require('./offline-sales.service');

const respond = (fn) => asyncHandler(async (req, res) => sendData(res, await fn(req)));

/** `{ data: { items, totalRevenue, totalUnits, sellerGstin, sellerState }, meta }` — totals cover the whole filter. */
exports.list = asyncHandler(async (req, res) => {
  const { page, limit, total, ...data } = await sales.list(req.user._id, req.query);
  sendData(res, data, 200, {
    page,
    pageSize: limit,
    totalItems: total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
});
exports.getOne = respond((req) => sales.get(req.user._id, req.params.id));
exports.productsLookup = respond((req) => sales.productsLookup(req.user._id, req.query.q));
exports.create = asyncHandler(async (req, res) => sendCreated(res, await sales.create(req.user._id, req.body)));
exports.update = respond((req) => sales.update(req.user._id, req.params.id, req.body));
exports.invoice = respond((req) => sales.invoice(req.user._id, req.params.id));
exports.remove = asyncHandler(async (req, res) => {
  await sales.remove(req.user._id, req.params.id);
  sendNoContent(res);
});
