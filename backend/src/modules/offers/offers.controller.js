/** Seller offer HTTP handlers (/api/seller/offers). Each calls one service function; no rules live here. */
const asyncHandler = require('express-async-handler');
const { sendData, sendCreated, sendList, sendNoContent } = require('../../utils/apiResponse');
const offers = require('./offers.service');

const respond = (fn) => asyncHandler(async (req, res) => sendData(res, await fn(req)));

exports.list = asyncHandler(async (req, res) => {
  const { items, page, limit, total } = await offers.list(req.user._id, req.query);
  sendList(res, items, { page, pageSize: limit, totalItems: total });
});
exports.create = asyncHandler(async (req, res) => sendCreated(res, await offers.create(req.user._id, req.body)));
exports.getOne = respond((req) => offers.get(req.user._id, req.params.id));
exports.update = respond((req) => offers.update(req.user._id, req.params.id, req.body));
exports.toggle = respond((req) => offers.toggle(req.user._id, req.params.id));
exports.remove = asyncHandler(async (req, res) => {
  await offers.remove(req.user._id, req.params.id);
  sendNoContent(res);
});
