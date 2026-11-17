/** Seller payout and admin settlement HTTP handlers. Each calls one service function; no rules live here. */
const asyncHandler = require('express-async-handler');
const { sendData, sendCreated } = require('../../utils/apiResponse');
const payouts = require('./payouts.service');

const respond = (fn) => asyncHandler(async (req, res) => sendData(res, await fn(req)));

exports.sellerSummary = respond((req) => payouts.sellerSummary(req.user._id));
exports.adminWeek = respond((req) => payouts.adminWeek(req.query.week));
exports.adminInTransit = respond(() => payouts.adminInTransit());
exports.adminPay = asyncHandler(async (req, res) => sendCreated(res, await payouts.pay(req.user, req.body)));
exports.adminHistory = respond((req) => payouts.history(req.query.sellerId));
exports.adminSetCourierCharge = respond((req) =>
  payouts.setCourierCharge(req.params.idOrNumber, req.params.sellerId, req.body),
);
