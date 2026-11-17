/** Seller requests for a new brand or category. */
const CategoryBrandRequest = require('./category-brand-request.model');

const SELLER_FIELDS = 'name storeName email';
const PARENT_FIELDS = 'name slug';

const create = (fields) => CategoryBrandRequest.create(fields);
const findById = (id) => CategoryBrandRequest.findById(id);

const listForSeller = (sellerId) =>
  CategoryBrandRequest.find({ seller: sellerId }).populate('parentCategory', PARENT_FIELDS).sort({ createdAt: -1 });

const listForAdmin = (filter) =>
  CategoryBrandRequest.find(filter)
    .populate('seller', SELLER_FIELDS)
    .populate('parentCategory', PARENT_FIELDS)
    .sort({ createdAt: -1 });

const findForAdmin = (id) =>
  CategoryBrandRequest.findById(id).populate('seller', SELLER_FIELDS).populate('parentCategory', PARENT_FIELDS);

module.exports = { PARENT_FIELDS, create, findById, listForSeller, listForAdmin, findForAdmin };
