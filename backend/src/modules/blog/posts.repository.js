/**
 * Every BlogPost query. Statements only.
 *
 * Posts belong to exactly one property ('main' or 'seller'); every
 * filter here carries `site`. View and comment counters update with
 * `timestamps: false` — a view or a comment landing is not an edit, and
 * stamping `updatedAt` used to make every post read "updated today".
 */
const BlogPost = require('./blog-post.model');

const AUTHOR_FIELDS = 'name slug role bio avatarUrl credentials';
const TAXONOMY = [
  { path: 'category', select: 'name slug parent' },
  { path: 'categories', select: 'name slug parent' },
  { path: 'tags', select: 'name slug' },
];
const EDIT_POPULATE = [
  { path: 'category', select: 'name slug' },
  { path: 'categories', select: 'name slug' },
  { path: 'tags', select: 'name slug' },
  { path: 'author', select: AUTHOR_FIELDS },
];

/** Published, not scheduled for the future, on this site. */
const publicFilter = (site) => ({ site, status: 'published', publishedAt: { $lte: new Date() } });

const count = (filter) => BlogPost.countDocuments(filter);

const publicPage = (filter, { skip, limit }) =>
  BlogPost.find(filter)
    .populate([...TAXONOMY, { path: 'author', select: AUTHOR_FIELDS }])
    .sort({ publishedAt: -1 })
    .skip(skip)
    .limit(limit);

/** Newest public post matching the filter, with the hero's author fields. */
const newestPublic = (filter) =>
  BlogPost.findOne(filter)
    .populate([...TAXONOMY, { path: 'author', select: 'name avatar storeName' }])
    .sort({ publishedAt: -1 });

const findPublicBySlug = (site, slug) =>
  BlogPost.findOne({ slug, ...publicFilter(site) }).populate([...TAXONOMY, { path: 'author', select: AUTHOR_FIELDS }]);
/** Bare published post (comment threads). */
const findPublishedBySlug = (site, slug) => BlogPost.findOne({ slug, ...publicFilter(site) });

const bumpViews = (id) => BlogPost.updateOne({ _id: id }, { $inc: { viewCount: 1 } }, { timestamps: false });
const bumpComments = (id, delta) =>
  BlogPost.updateOne({ _id: id }, { $inc: { commentCount: delta } }, { timestamps: false });

/**
 * Admin list sorted by the date it DISPLAYS — last real edit, else the
 * publish date, else creation — as an aggregation because Mongo can't
 * sort on a coalesce. `$match` stays first (required by `$text`); `_id`
 * breaks ties so pagination never repeats a row.
 */
async function adminPage(filter, { skip, limit }) {
  const items = await BlogPost.aggregate([
    { $match: filter },
    { $addFields: { lastChangeAt: { $ifNull: ['$contentUpdatedAt', { $ifNull: ['$publishedAt', '$createdAt'] }] } } },
    { $sort: { lastChangeAt: -1, _id: -1 } },
    { $skip: skip },
    { $limit: limit },
  ]);
  await BlogPost.populate(items, [
    { path: 'category', select: 'name slug' },
    { path: 'categories', select: 'name slug' },
    { path: 'tags', select: 'name slug' },
    { path: 'author', select: 'name' },
  ]);
  return items;
}

const findOneAdmin = (filter) => BlogPost.findOne(filter).populate(EDIT_POPULATE);
const findOne = (filter) => BlogPost.findOne(filter);
const create = (fields) => BlogPost.create(fields);
const withEditFields = (post) => post.populate(EDIT_POPULATE);

/** `[{ _id: <ref>, count }]` grouped by a field, under a match. */
const countBy = (field, match) =>
  BlogPost.aggregate([{ $match: match }, { $group: { _id: `$${field}`, count: { $sum: 1 } } }]);
const countByTag = (site) =>
  BlogPost.aggregate([{ $match: { site } }, { $unwind: '$tags' }, { $group: { _id: '$tags', count: { $sum: 1 } } }]);

const clearCategory = (categoryId) => BlogPost.updateMany({ category: categoryId }, { $set: { category: null } });
const pullTag = (tagId) => BlogPost.updateMany({ tags: tagId }, { $pull: { tags: tagId } });
const clearAuthor = (authorId) => BlogPost.updateMany({ author: authorId }, { $set: { author: null } });

module.exports = {
  STATUSES: BlogPost.STATUSES,
  publicFilter,
  count,
  publicPage,
  newestPublic,
  findPublicBySlug,
  findPublishedBySlug,
  bumpViews,
  bumpComments,
  adminPage,
  findOneAdmin,
  findOne,
  create,
  withEditFields,
  countBy,
  countByTag,
  clearCategory,
  pullTag,
  clearAuthor,
};
