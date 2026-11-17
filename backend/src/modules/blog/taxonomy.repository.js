/**
 * BlogCategory and BlogTag (site-scoped) and BlogAuthor (shared across
 * properties — the same writers byline on both sites). Statements only.
 */
const mongoose = require('mongoose');
const BlogCategory = require('./blog-category.model');
const BlogTag = require('./blog-tag.model');
const BlogAuthor = require('./blog-author.model');

const byIdOrSlug = (site, ref) =>
  mongoose.isValidObjectId(ref) ? { _id: ref, site } : { site, slug: String(ref).toLowerCase() };

/* ── categories ─────────────────────────────────────────────────────── */
const findCategoryByRef = (site, ref) => BlogCategory.findOne(byIdOrSlug(site, ref));
/** The whole tree for one site, lean — the chain builder walks it in memory. */
const categoryTree = (site) => BlogCategory.find({ site }, 'name slug parent').lean();
const activeCategories = (site) =>
  BlogCategory.find({ site, isActive: true }).select('name slug description order parent').sort({ order: 1, name: 1 });
const listCategories = (site) =>
  BlogCategory.find({ site }).populate('parent', 'name slug').sort({ order: 1, name: 1 });
/** The id when the category exists on this site, else null. */
const categoryIdOnSite = (id, site) => BlogCategory.findOne({ _id: id, site }).select('_id');
const findCategory = (id, site) => BlogCategory.findOne({ _id: id, site });
const createCategory = (fields) => BlogCategory.create(fields);

/* ── tags ───────────────────────────────────────────────────────────── */
const findTagByRef = (site, ref) => BlogTag.findOne(byIdOrSlug(site, ref));
const listTags = (site) => BlogTag.find({ site }).sort({ name: 1 });
const tagExistsOnSite = (id, site) => BlogTag.exists({ _id: id, site });
const findTagBySlug = (site, slug) => BlogTag.findOne({ site, slug });
const findTag = (id, site) => BlogTag.findOne({ _id: id, site });
const createTag = (fields) => BlogTag.create(fields);

/* ── authors (shared) ───────────────────────────────────────────────── */
const listAuthors = () => BlogAuthor.find({}).sort({ order: 1, name: 1 });
const listActiveAuthors = () => BlogAuthor.find({ isActive: true }).sort({ order: 1, name: 1 });
const findAuthor = (id) => BlogAuthor.findById(id);
const createAuthor = (fields) => BlogAuthor.create(fields);

module.exports = {
  findCategoryByRef,
  categoryTree,
  activeCategories,
  listCategories,
  categoryIdOnSite,
  findCategory,
  createCategory,
  findTagByRef,
  listTags,
  tagExistsOnSite,
  findTagBySlug,
  findTag,
  createTag,
  listAuthors,
  listActiveAuthors,
  findAuthor,
  createAuthor,
};
