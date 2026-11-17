/**
 * Staff KYC review endpoints (/api/admin). HTTP ⇄ service only. Every
 * answer is the `{ data }` envelope (admin/app/kyc-pending, the dashboard,
 * AdminShell and KycReviewCard read it through lib/api.ts `unwrap`).
 */
const asyncHandler = require('express-async-handler');
const upload = require('../../middleware/upload');
const { sendData } = require('../../utils/apiResponse');
const { AppError } = require('../../errors/AppError');
const review = require('./kyc-review.service');
const pickup = require('./pickup-sync.service');
const { kycUploadPrefix } = require('./seller-kyc.controller');

const respond = (fn) => asyncHandler(async (req, res) => sendData(res, await fn(req)));

// GET /kyc/pending — sellers awaiting review
exports.listPendingKyc = respond(() => review.pending());

// GET /sellers/:id/kyc — full KYC for one seller
exports.getSellerKyc = respond((req) => review.forSeller(req.params.id));

// POST /sellers/:id/kyc/approve — body: { revision? }
exports.approveSellerKyc = respond((req) =>
  review.approve(req.params.id, { revision: req.body?.revision, reviewerId: req.user._id }),
);

// PATCH /sellers/:id/kyc — partial edit on the seller's behalf
exports.adminEditSellerKyc = respond((req) => review.edit(req.params.id, req.body, req.user._id));

// POST /sellers/:id/kyc/reject — body: { reason, revision? }
exports.rejectSellerKyc = respond((req) => {
  const { reason, revision } = req.body || {};
  return review.reject(req.params.id, { reason, revision, reviewerId: req.user._id });
});

// GET /sellers/:id/shiprocket/pickup — read-only. Staff verify the phone in
// Shiprocket's panel (no OTP API exists) and call this to pull the result in.
exports.adminGetSellerPickup = respond((req) => pickup.adminPickupStatus(req.params.id));

// POST /kyc/upload — a replacement document uploaded on the seller's behalf
// (?sellerId=). Same multer chain as the seller's own upload.
exports.adminUploadKycFile = [
  kycUploadPrefix,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw AppError.badRequest('No file uploaded');
    sendData(res, { url: await upload.presignKey(upload.fileToUrl(req.file)) });
  }),
];
