/**
 * Every User query the sellers module makes. Statements only — no rules,
 * no HTTP. Admin routes accept a seller by ObjectId or slug.
 */
const mongoose = require('mongoose');
const User = require('../../models/User');

/** Fields the KYC review screens read. */
const KYC_REVIEW_FIELDS = 'name email storeName phone kyc kycRevision createdAt';

/** Filter for one seller addressed by ObjectId or slug. */
function sellerFilter(idOrSlug) {
  return mongoose.isValidObjectId(idOrSlug)
    ? { _id: idOrSlug, role: 'seller' }
    : { slug: String(idOrSlug).toLowerCase(), role: 'seller' };
}

/** The full user document (saves go through the document). */
const findById = (id) => User.findById(id);

/** Email + kyc only — enough for the self-verification status card. */
const findContactAndKyc = (id) => User.findById(id).select('email kyc');

/** The seller's slug, for the upload folder. */
const findSlug = (id) => User.findById(id).select('slug').lean();

/** One seller document by id or slug (admin review writes go through it). */
const findSellerByIdOrSlug = (idOrSlug) => User.findOne(sellerFilter(idOrSlug));

/** One seller's review fields as a plain object. */
const findSellerKycLean = (idOrSlug) => User.findOne(sellerFilter(idOrSlug)).select(KYC_REVIEW_FIELDS).lean();

/**
 * Sellers with a first submission or a change request awaiting review, oldest first.
 * @returns {Promise<any[]>} lean rows the caller reshapes for review
 */
const listPendingKyc = () =>
  User.find({ role: 'seller', $or: [{ 'kyc.status': 'pending' }, { 'kycRevision.status': 'pending' }] })
    .sort({ 'kyc.submittedAt': 1 })
    .select(KYC_REVIEW_FIELDS)
    .lean();

module.exports = { findById, findContactAndKyc, findSlug, findSellerByIdOrSlug, findSellerKycLean, listPendingKyc };
