/**
 * Catalogue HTTP handlers — categories, brands, seller brand/category
 * requests and product reviews. Each reads the validated request, calls one
 * service function and answers the `{ data }` envelope; no rules live here.
 */
const asyncHandler = require('express-async-handler');
const upload = require('../../middleware/upload');
const trackMediaUpload = require('../../middleware/trackMediaUpload');
const { AppError } = require('../../errors/AppError');
const { sendData, sendCreated, sendNoContent } = require('../../utils/apiResponse');
const categories = require('./categories.service');
const brands = require('./brands.service');
const requests = require('./brand-requests.service');
const reviews = require('./reviews.service');

const respond = (fn) => asyncHandler(async (req, res) => sendData(res, await fn(req)));
const respondCreated = (fn) => asyncHandler(async (req, res) => sendCreated(res, await fn(req)));
const noContent = (fn) =>
  asyncHandler(async (req, res) => {
    await fn(req);
    sendNoContent(res);
  });

/** One image under `field` → `{ data: { url } }`; the admin form saves the URL with the rest of the record. */
const imageUpload = (field) => [
  upload.single(field),
  trackMediaUpload,
  asyncHandler(async (req, res) => {
    if (!req.file) throw AppError.badRequest('No file uploaded');
    sendData(res, { url: upload.fileToUrl(req.file) });
  }),
];

/* ── categories (/api/categories) ─────────────────────────────────────── */
exports.categoryTree = respond((req) => categories.tree(req.query));
exports.categoryAdminList = respond(() => categories.adminList());
exports.createCategory = respondCreated((req) => categories.create(req.body));
exports.updateCategory = respond((req) => categories.update(req.params.id, req.body));
exports.removeCategory = noContent((req) => categories.remove(req.params.id));
exports.uploadCategoryIcon = imageUpload('icon');

/* ── brands (/api/brands) ─────────────────────────────────────────────── */
exports.listBrands = respond((req) => brands.list(req.query));
exports.createBrand = respondCreated((req) => brands.create(req.body));
exports.updateBrand = respond((req) => brands.update(req.params.id, req.body));
exports.removeBrand = noContent((req) => brands.remove(req.params.id));
exports.uploadBrandLogo = imageUpload('logo');

/* ── brand / category requests (/api/seller and /api/admin) ───────────── */
exports.submitRequest = respondCreated((req) => requests.submit(req.user, req.body));
exports.listOwnRequests = respond((req) => requests.listOwn(req.user));
exports.editOwnRequest = respond((req) => requests.editOwn(req.user, req.params.id, req.body));
exports.withdrawOwnRequest = noContent((req) => requests.withdrawOwn(req.user, req.params.id));
exports.adminListRequests = respond((req) => requests.adminList(req.query));
exports.adminGetRequest = respond((req) => requests.adminGet(req.params.id));
exports.approveRequest = respond((req) => requests.approve(req.user, req.params.id, req.body));
exports.rejectRequest = respond((req) => requests.reject(req.user, req.params.id, req.body));
exports.adminDeleteRequest = noContent((req) => requests.adminDelete(req.params.id));

/* ── reviews (/api/reviews, and /api/products/:slug/reviews) ──────────── */
exports.upsertReview = respond((req) => reviews.upsert(req.user, req.body));
exports.myReviewsForOrder = respond((req) => reviews.mineForOrder(req.user, req.query.orderId));
exports.reviewEligibility = respond((req) => reviews.eligibility(req.user, (req.query || {}).productId));
exports.deleteReview = noContent((req) => reviews.removeOwn(req.user, req.params.productId));
exports.productReviews = respond((req) => reviews.forProduct(req.params.slug));
/** Photos are uploaded before the review is submitted; their stored keys come back for its `images`. */
exports.uploadReviewImages = asyncHandler(async (req, res) => {
  const files = Array.isArray(req.files) ? req.files : [];
  if (!files.length) throw AppError.badRequest('No files uploaded.');
  sendData(res, { images: files.map((f) => upload.fileToUrl(f)) });
});
