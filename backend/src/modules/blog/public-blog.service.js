/** Storefront reads: the index, the hero, one post, the taxonomy lists. */
const mongoose = require('mongoose');
const { AppError } = require('../../errors/AppError');
const posts = require('./posts.repository');
const taxonomy = require('./taxonomy.repository');
const { indexTree, chainFor } = require('./category-chain');

const paging = (query, defaultLimit) => {
  const page = Number(query.page || 1);
  const limit = Number(query.limit || defaultLimit);
  return { page, limit, skip: (page - 1) * limit };
};

/**
 * Paginated public list. `exclude` omits ids (the index promotes one post
 * into a hero; excluding it server-side keeps every page the same size
 * and `total` honest). Category / tag lookups are site-scoped, so a slug
 * from the other property means "no such category here" — an empty page.
 */
async function list(site, query) {
  const { q, category, tag, exclude } = query;
  const { page, limit, skip } = paging(query, 12);
  const filter = posts.publicFilter(site);
  if (q) filter.$text = { $search: q };
  if (exclude) {
    const ids = String(exclude)
      .split(',')
      .map((s) => s.trim())
      .filter((s) => mongoose.isValidObjectId(s));
    if (ids.length) filter._id = { $nin: ids };
  }
  const empty = { items: [], total: 0, page, limit, pages: 0 };
  if (category) {
    const cat = await taxonomy.findCategoryByRef(site, category);
    if (!cat) return empty;
    filter.category = cat._id;
  }
  if (tag) {
    const tg = await taxonomy.findTagByRef(site, tag);
    if (!tg) return empty;
    filter.tags = tg._id;
  }
  const [items, total, tree] = await Promise.all([
    posts.publicPage(filter, { skip, limit }),
    posts.count(filter),
    taxonomy.categoryTree(site),
  ]);
  const byId = indexTree(tree);
  return {
    items: items.map((p) => ({ ...p.toObject(), categoryChain: chainFor(p.category, byId) })),
    page,
    limit,
    total,
    pages: Math.ceil(total / limit),
  };
}

/** The hero: the featured post, else the newest, so the index is never empty. */
async function featured(site) {
  const chosen =
    (await posts.newestPublic({ ...posts.publicFilter(site), isFeatured: true })) ||
    (await posts.newestPublic(posts.publicFilter(site)));
  if (!chosen) return { post: null };
  const byId = indexTree(await taxonomy.categoryTree(site));
  return { post: { ...chosen.toObject(), categoryChain: chainFor(chosen.category, byId) } };
}

async function getOne(site, slug) {
  const post = await posts.findPublicBySlug(site, slug);
  if (!post) throw AppError.notFound('Post not found.');
  let categoryChain = [];
  if (post.category) {
    const byId = indexTree(await taxonomy.categoryTree(site));
    categoryChain = chainFor(post.category, byId);
  }
  // Out-of-band view count; never blocks the response.
  posts.bumpViews(post._id).catch(() => {});
  return { post: { ...post.toObject(), categoryChain } };
}

const categories = async (site) => ({ items: await taxonomy.activeCategories(site) });
const tags = async (site) => ({ items: await taxonomy.listTags(site) });
const authors = async () => ({ items: await taxonomy.listActiveAuthors() });

module.exports = { list, featured, getOne, categories, tags, authors, paging };
