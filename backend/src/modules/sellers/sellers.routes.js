/**
 * Sellers module routers.
 *
 *   seller  mounted inside routes/sellerOrderRoutes.js (/api/seller), after
 *           its protect + requireRole('seller', 'superadmin') guard
 *   admin   mounted inside routes/adminRoutes.js (/api/admin), after its
 *           protect + requireRole('superadmin', 'staff') guard; every route
 *           here needs the `kyc` permission on top
 */
const express = require('express');
const { blockImpersonated, requirePermission } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const s = require('./sellers.schema');
const seller = require('./seller-kyc.controller');
const admin = require('./admin-kyc.controller');

/* ── /api/seller ───────────────────────────────────────────────────────── */

const sellerRouter = express.Router();

sellerRouter.get('/kyc', seller.getMyKyc);
/* KYC carries the seller's BANK/PAYOUT details, so writing it while
 * impersonating could redirect their money. An admin signed in as a seller
 * can READ the KYC (seeing what the seller sees) but not rewrite it; the
 * audited route for corrections is PATCH /api/admin/sellers/:id/kyc. */
sellerRouter.post('/kyc', blockImpersonated, validate({ body: s.kycBody }), seller.submitKyc);
sellerRouter.post('/kyc/upload', blockImpersonated, validate({ query: s.uploadQuery }), seller.uploadKycFile);

// Self-serve Shiprocket pickup admin — no super-admin involvement.
sellerRouter.get('/shiprocket/pickup', seller.getMyShiprocketPickup);
sellerRouter.post('/shiprocket/sync-pickup', validate({ body: s.anyBody }), seller.sellerSyncPickup);
sellerRouter.post('/shiprocket/edit-pickup', validate({ body: s.pickupEditBody }), seller.sellerEditPickup);

// Seller self-confirmation of pickup details — emailed code. Separate from
// Shiprocket's flag on purpose; see pickup-self-verify.service.js.
sellerRouter.get('/kyc/pickup/self-verification', seller.getPickupSelfVerification);
sellerRouter.post('/kyc/pickup/send-otp', validate({ body: s.anyBody }), seller.sendPickupSelfVerifyOtp);
sellerRouter.post('/kyc/pickup/verify-otp', validate({ body: s.otpBody }), seller.verifyPickupSelfVerifyOtp);

/* ── /api/admin ────────────────────────────────────────────────────────── */

const adminRouter = express.Router();
const kycStaff = requirePermission('kyc');
const byId = validate({ params: s.idOrSlugParams });

adminRouter.get('/kyc/pending', kycStaff, admin.listPendingKyc);
// Same multer wrapper as the seller endpoint — admin uploads a replacement
// GST cert / PAN card on the seller's behalf when the seller mails it in.
adminRouter.post('/kyc/upload', kycStaff, validate({ query: s.uploadQuery }), admin.adminUploadKycFile);
adminRouter.get('/sellers/:id/kyc', kycStaff, byId, admin.getSellerKyc);
adminRouter.patch(
  '/sellers/:id/kyc',
  kycStaff,
  validate({ params: s.idOrSlugParams, body: s.kycBody }),
  admin.adminEditSellerKyc,
);
adminRouter.post(
  '/sellers/:id/kyc/approve',
  kycStaff,
  validate({ params: s.idOrSlugParams, body: s.reviewBody }),
  admin.approveSellerKyc,
);
adminRouter.post(
  '/sellers/:id/kyc/reject',
  kycStaff,
  validate({ params: s.idOrSlugParams, body: s.reviewBody }),
  admin.rejectSellerKyc,
);
// Admin stays out of the shipping loop by design; this read is the one
// exception because it IS a read (see admin-kyc.controller.js).
adminRouter.get('/sellers/:id/shiprocket/pickup', kycStaff, byId, admin.adminGetSellerPickup);

module.exports = { seller: sellerRouter, admin: adminRouter };
