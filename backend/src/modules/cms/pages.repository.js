/** Every Page query, plus the Category / Brand slug reads the route resolver needs. Statements only. */
const Page = require('./page.model');
const Category = require('../catalog/category.model');
const Brand = require('../catalog/brand.model');

const POPULATE = [
  { path: 'parentCategory', select: 'name slug' },
  { path: 'filter.category', select: 'name slug icon' },
  { path: 'filter.brand', select: 'name slug logo' },
  { path: 'filter.categories', select: 'name slug icon' },
  { path: 'filter.brands', select: 'name slug logo' },
];

const list = (filter) => Page.find(filter).populate(POPULATE).sort({ order: 1, title: 1 });
const findOne = (filter) => Page.findOne(filter);
const findOnePopulated = (filter) => Page.findOne(filter).populate(POPULATE);
const create = (fields) => Page.create(fields);

const categoryBySlug = (slug) => Category.findOne({ slug });
const brandBySlug = (slug) => Brand.findOne({ slug });

module.exports = { list, findOne, findOnePopulated, create, categoryBySlug, brandBySlug };
