/**
 * Request schemas for the sellers module (sellers.routes.js).
 *
 * KYC field rules (GSTIN, PAN, IFSC, …) stay in kyc-rules.js: the dashboard
 * shows those messages verbatim and they apply to admin edits and tests
 * that call the service directly. The schemas here type the envelope.
 */
const { z, optionalText, typeError } = require('../../validation/common');

/** Seller id or slug (admin routes accept either). */
const idOrSlugParams = z.object({
  id: z.string(typeError('Seller not found')).trim().min(1, 'Seller not found').max(200, 'Seller not found'),
});

/** A KYC submission or edit; the fields are checked by kyc-rules.js. */
const kycBody = z.object({}).passthrough();

/** Approve / reject: `revision` targets the pending change request. */
const reviewBody = z
  .object({
    revision: z.boolean().optional(),
    reason: optionalText(2000),
  })
  .passthrough();

/** Admin uploads name the seller; sellers upload under their own account. */
const uploadQuery = z.object({ sellerId: optionalText(64) }).passthrough();

const otpBody = z
  .object({
    otp: z
      .string(typeError('Enter the 6-digit code.', 'Enter the 6-digit code.'))
      .trim()
      .regex(/^\d{6}$/, 'Enter the 6-digit code.'),
  })
  .passthrough();

const pickupEditBody = z
  .object({
    contactName: optionalText(120),
    contactPhone: optionalText(20),
    contactEmail: optionalText(254),
    line1: optionalText(200),
    line2: optionalText(200),
    city: optionalText(80),
    state: optionalText(80),
    pincode: optionalText(10),
    country: optionalText(60),
  })
  .passthrough();

const anyBody = z.object({}).passthrough();

module.exports = { idOrSlugParams, kycBody, reviewBody, uploadQuery, otpBody, pickupEditBody, anyBody };
