/** Seller-facing KYC and pickup endpoints (/api/seller). HTTP ⇄ service only. */
const asyncHandler = require('express-async-handler');
const upload = require('../../middleware/upload');
const { AppError } = require('../../errors/AppError');
const { sendData } = require('../../utils/apiResponse');
const kyc = require('./kyc.service');
const pickup = require('./pickup-sync.service');
const selfVerify = require('./pickup-self-verify.service');

// GET /kyc — current seller's KYC state + account status
exports.getMyKyc = asyncHandler(async (req, res) => {
  sendData(res, await kyc.myKyc(req.user._id));
});

// POST /kyc — submit or update KYC
exports.submitKyc = asyncHandler(async (req, res) => {
  sendData(res, await kyc.submit(req.user._id, req.body));
});

/** Picks the S3 folder for a KYC document before multer runs (shared with the admin upload). */
async function kycUploadPrefix(req, res, next) {
  try {
    req._uploadPrefix = await kyc.uploadFolderFor({
      user: req.user,
      sellerId: req.query.sellerId || req.body?.sellerId,
    });
    next();
  } catch (err) {
    next(err);
  }
}
exports.kycUploadPrefix = kycUploadPrefix;

// POST /kyc/upload — one KYC document (field 'file'). S3 if configured, else /uploads/.
exports.uploadKycFile = [
  kycUploadPrefix,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw AppError.badRequest('No file uploaded');
    const url = upload.fileToUrl(req.file);
    sendData(res, { url: await upload.presignKey(url) });
  }),
];

// GET /shiprocket/pickup — live pickup status, so the dashboard can show
// whether shipping is unlocked without digging through emails.
exports.getMyShiprocketPickup = asyncHandler(async (req, res) => {
  sendData(res, await pickup.myPickupStatus(req.user._id));
});

// POST /shiprocket/sync-pickup
exports.sellerSyncPickup = asyncHandler(async (req, res) => {
  sendData(res, await pickup.syncMyPickup(req.user._id));
});

// POST /shiprocket/edit-pickup — body: pickupAddress fields
exports.sellerEditPickup = asyncHandler(async (req, res) => {
  sendData(res, await pickup.editMyPickup(req.user._id, req.body));
});

// GET /kyc/pickup/self-verification
exports.getPickupSelfVerification = asyncHandler(async (req, res) => {
  sendData(res, await selfVerify.status(req.user._id));
});

// POST /kyc/pickup/send-otp
exports.sendPickupSelfVerifyOtp = asyncHandler(async (req, res) => {
  sendData(res, await selfVerify.sendOtp(req.user._id));
});

// POST /kyc/pickup/verify-otp — body: { otp }
exports.verifyPickupSelfVerifyOtp = asyncHandler(async (req, res) => {
  sendData(res, await selfVerify.verifyOtp(req.user._id, req.body?.otp));
});
