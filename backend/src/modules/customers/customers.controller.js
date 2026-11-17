/**
 * Shopper HTTP handlers — cart, wishlist, back-in-stock requests, saved
 * addresses, checkout failure reports — plus the two admin feeds (checkout
 * failures, live carts). Each calls one service function and answers the
 * `{ data, meta }` envelope; no rules live here.
 */
const asyncHandler = require('express-async-handler');
const { sendData, sendCreated, sendList } = require('../../utils/apiResponse');
const cart = require('./cart.service');
const wishlist = require('./wishlist.service');
const addresses = require('./addresses.service');
const failures = require('./checkout-failures.service');
const adminCarts = require('./admin-carts.service');

const respond = (fn) => asyncHandler(async (req, res) => sendData(res, await fn(req)));
/** A service page `{ items, page, limit, total }` → `{ data: { items }, meta }`. */
const listing = (fn) =>
  asyncHandler(async (req, res) => {
    const { items, page, limit, total } = await fn(req);
    sendList(res, items, { page, pageSize: limit, totalItems: total });
  });

/* ── cart (/api/cart) ─────────────────────────────────────────────────── */
exports.getCart = respond((req) => cart.get(req.user._id));
exports.addToCart = respond((req) => cart.add(req.user._id, req.body));
exports.updateCartItem = respond((req) => cart.setQuantity(req.user._id, req.params.itemId, req.body.quantity));
exports.removeCartItem = respond((req) => cart.removeLine(req.user._id, req.params.itemId));
exports.clearCart = respond((req) => cart.clear(req.user._id));
exports.deliveryOptions = respond((req) => cart.deliveryOptions(req.user._id, req.query));

/* ── wishlist and back-in-stock ───────────────────────────────────────── */
exports.getWishlist = respond((req) => wishlist.get(req.user._id));
exports.addToWishlist = respond((req) => wishlist.add(req.user._id, req.body.productId));
exports.removeFromWishlist = respond((req) => wishlist.remove(req.user._id, req.params.productId));
exports.notifyWhenInStock = respond((req) => wishlist.notifyWhenInStock(req.user._id, req.body.productId));

/* ── saved addresses (/api/addresses) ─────────────────────────────────── */
exports.listAddresses = respond((req) => addresses.list(req.user._id));
exports.createAddress = asyncHandler(async (req, res) =>
  sendCreated(res, await addresses.create(req.user._id, req.body)),
);
exports.updateAddress = respond((req) => addresses.update(req.user._id, req.params.id, req.body));
exports.setDefaultAddress = respond((req) => addresses.setDefault(req.user._id, req.params.id));
exports.removeAddress = respond((req) => addresses.remove(req.user._id, req.params.id));

/* ── checkout failures ────────────────────────────────────────────────── */
/** 202: accepted for the feed; the browser does not read the body. */
exports.reportCheckoutFailure = asyncHandler(async (req, res) =>
  sendData(res, await failures.report(req.user, req.body), 202),
);
exports.listCheckoutFailures = listing((req) => failures.list(req.query));

/* ── admin: live carts ────────────────────────────────────────────────── */
exports.listCustomerCarts = listing((req) => adminCarts.list(req.query));
