/**
 * Every User query the admin module makes: sellers, customers, staff and
 * the admin's own record. Statements only.
 */
const mongoose = require('mongoose');
const User = require('../../models/User');

const CUSTOMER_FIELDS = 'name email phone status avatar createdAt addresses slug';

/** Filter for one user by ObjectId or slug, pinned to a role. */
const byIdOrSlug = (idOrSlug, role) =>
  mongoose.isValidObjectId(idOrSlug) ? { _id: idOrSlug, role } : { slug: String(idOrSlug).toLowerCase(), role };

/* ── sellers ────────────────────────────────────────────────────────── */

/** Null when the param is empty, so callers answer 404 uniformly. */
const findSellerByIdOrSlug = (idOrSlug) => (idOrSlug ? User.findOne(byIdOrSlug(idOrSlug, 'seller')) : null);
const findSellerId = (idOrSlug) => User.findOne(byIdOrSlug(idOrSlug, 'seller')).select('_id');
const sellerPage = (filter, { skip, limit }) =>
  Promise.all([User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit), User.countDocuments(filter)]);
const countSellers = (extra = {}) => User.countDocuments({ role: 'seller', ...extra });
const recentSellers = () =>
  User.find({ role: 'seller' }).sort({ createdAt: -1 }).limit(5).select('name email storeName slug status createdAt');
const sellersCreatedSince = (since) => User.find({ role: 'seller', createdAt: { $gte: since } }).select('createdAt');
/** Display fields for a set of seller ids (order feeds, customer history). */
const sellersByIds = (ids, fields = 'name storeName slug email', { lean = false } = {}) => {
  const q = User.find({ _id: { $in: ids } }).select(fields);
  return lean ? q.lean() : q;
};
const emailTakenByOther = (email, userId) => User.findOne({ email, _id: { $ne: userId } }).select('_id');
const deleteUser = (id) => User.deleteOne({ _id: id });

/* ── customers ──────────────────────────────────────────────────────── */

const countCustomers = () => User.countDocuments({ role: 'customer' });
/**
 * @param {string} idOrSlug
 * @param {{ fields?: string }} [opts]
 */
const findCustomerByIdOrSlug = (idOrSlug, { fields } = {}) => {
  const q = User.findOne(byIdOrSlug(idOrSlug, 'customer'));
  return fields ? q.select(fields) : q;
};
const customerPage = (filter, { skip, limit }) =>
  Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).select(CUSTOMER_FIELDS),
    User.countDocuments(filter),
  ]);
const customersMatching = (re) => User.find({ role: 'customer', $or: [{ name: re }, { email: re }] }).select('_id');

/* ── admins and staff ───────────────────────────────────────────────── */

/** The caller's own record with the password hash, for step-up checks. */
const findAdminWithPassword = (id) => User.findById(id).select('+password email role tokenVersion');
const listStaff = () =>
  User.find({ role: 'staff' }).select('name email permissions status createdAt updatedAt').sort({ createdAt: -1 });
const findStaff = (id) => User.findOne({ _id: id, role: 'staff' });
const findByEmail = (email) => User.findOne({ email });
const createUser = (fields) => User.create(fields);

module.exports = {
  CUSTOMER_FIELDS,
  findSellerByIdOrSlug,
  findSellerId,
  sellerPage,
  countSellers,
  recentSellers,
  sellersCreatedSince,
  sellersByIds,
  emailTakenByOther,
  deleteUser,
  countCustomers,
  findCustomerByIdOrSlug,
  customerPage,
  customersMatching,
  findAdminWithPassword,
  listStaff,
  findStaff,
  findByEmail,
  createUser,
};
