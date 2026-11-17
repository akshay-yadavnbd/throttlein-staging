/**
 * Reads of Category, Brand and User that the product flows need. Each
 * selects only what its caller uses. A catalogue / sellers module would own
 * these later.
 */
const Category = require('../catalog/category.model');
const Brand = require('../catalog/brand.model');
const User = require('../../models/User');

/* ── sellers ──────────────────────────────────────────────────────────── */

/**
 * Sellers whose products may appear on the storefront: account approved
 * AND KYC approved. Everyone else's products stay hidden even when the
 * product itself is active — nothing ships until the admin says so.
 */
const approvedSellerIds = () => User.distinct('_id', { role: 'seller', status: 'approved', 'kyc.status': 'approved' });

const sellerShippingProfile = (sellerId) =>
  User.findById(sellerId).select('status kyc.status kyc.pickupAddress excludedPincodes codEnabled');

/* ── categories ───────────────────────────────────────────────────────── */

const categoryById = (id) => Category.findById(id);
const categoryBySlug = (slug) => Category.findOne({ slug });
const categoryByName = (regex) => Category.findOne({ name: regex });
const childCategories = (parentIds) => Category.find({ parent: { $in: parentIds } }).select('_id');
/** Categories whose name matches; `activeOnly` for the search index, all for autocomplete. */
const categoriesNamed = (regex, { activeOnly = false, lean = false } = {}) => {
  const q = Category.find({ name: regex, ...(activeOnly ? { isActive: true } : {}) }).select('_id');
  return lean ? q.lean() : q;
};
const activeCategoryNames = () => Category.find({ isActive: true }).select('name');
const allCategoriesForImport = () => Category.find({}).select('name parent');

/* ── brands ───────────────────────────────────────────────────────────── */

const brandById = (id) => Brand.findById(id);
const brandBySlug = (slug) => Brand.findOne({ slug });
const brandByName = (regex) => Brand.findOne({ name: regex });
const brandExists = (id) => Brand.exists({ _id: id });
const brandsNamed = (regex, { lean = false } = {}) => {
  const q = Brand.find({ name: regex }).select('_id');
  return lean ? q.lean() : q;
};
const activeBrandNames = () => Brand.find({ isActive: true }).select('name');
const allBrandsForImport = () => Brand.find({}).select('name');

module.exports = {
  approvedSellerIds,
  sellerShippingProfile,
  categoryById,
  categoryBySlug,
  categoryByName,
  childCategories,
  categoriesNamed,
  activeCategoryNames,
  allCategoriesForImport,
  brandById,
  brandBySlug,
  brandByName,
  brandExists,
  brandsNamed,
  activeBrandNames,
  allBrandsForImport,
};
