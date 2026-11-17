/**
 * Admin post editing. The site is authoritative from the request context
 * (the permission guard verified the caller may write to it) and is never
 * taken from the body; a post cannot be moved between properties by
 * editing it. Taxonomy links are re-checked against the site so a stale
 * or hand-crafted payload can't attach the other property's category or tag.
 */
const mongoose = require('mongoose');
const { AppError } = require('../../errors/AppError');
const posts = require('./posts.repository');
const taxonomy = require('./taxonomy.repository');
const comments = require('./comments.repository');
const { slugify } = require('./category-chain');
const { paging } = require('./public-blog.service');

const UPDATABLE = [
  'title',
  'slug',
  'excerpt',
  'body',
  'featuredImage',
  'category',
  'categories',
  'status',
  'publishedAt',
  'metaTitle',
  'metaDescription',
  'ogImage',
  'isFeatured',
  'faqs',
  'faqHeading',
  'keyTakeaways',
  'references',
  'author',
];

/** Tag ids OR names; new names are created ON THE GIVEN SITE. */
async function resolveTagIds(input, site) {
  if (!Array.isArray(input)) return [];
  const ids = [];
  for (const raw of input) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) continue;
    if (mongoose.isValidObjectId(trimmed)) {
      if (await taxonomy.tagExistsOnSite(trimmed, site)) ids.push(trimmed);
      continue;
    }
    const slug = slugify(trimmed);
    let tag = await taxonomy.findTagBySlug(site, slug);
    if (!tag) tag = await taxonomy.createTag({ site, name: trimmed, slug });
    ids.push(tag._id);
  }
  return ids;
}

/** The category's id when it belongs to `site`, else null. */
async function categoryOnSite(id, site) {
  if (!id || !mongoose.isValidObjectId(id)) return null;
  const cat = await taxonomy.categoryIdOnSite(id, site);
  return cat ? cat._id : null;
}

const checkedCategories = async (list, site) =>
  (await Promise.all(list.map((c) => categoryOnSite(c, site)))).filter(Boolean);

async function list(site, query) {
  const { q, status, category } = query;
  const { page, limit, skip } = paging(query, 25);
  // `site` is an ordinary predicate beside $text (one text index per collection).
  const filter = { site };
  if (q) filter.$text = { $search: q };
  if (status && posts.STATUSES.includes(status)) filter.status = status;
  if (category) filter.category = category;
  const [items, total] = await Promise.all([posts.adminPage(filter, { skip, limit }), posts.count(filter)]);
  return { items, page, total, pages: Math.ceil(total / limit) };
}

/** By id OR slug, any status, always site-scoped (an editor holding one site's key must not read the other's drafts by id). */
async function get(site, ref) {
  const post = await posts.findOneAdmin(mongoose.isValidObjectId(ref) ? { _id: ref, site } : { slug: ref, site });
  if (!post) throw AppError.notFound('Post not found.');
  return { post };
}

async function create(site, body, createdBy) {
  const fields = { ...body, site, createdBy };
  if (Array.isArray(fields.tags)) fields.tags = await resolveTagIds(fields.tags, site);
  if (fields.category !== undefined) fields.category = await categoryOnSite(fields.category, site);
  if (Array.isArray(fields.categories)) fields.categories = await checkedCategories(fields.categories, site);
  // `author` is the shared BlogAuthor byline (optional); blank falls back to the default.
  if (fields.author === '' || fields.author === undefined) fields.author = null;
  const post = await posts.create(fields);
  await posts.withEditFields(post);
  return { post };
}

async function update(site, id, body) {
  const post = await posts.findOne({ _id: id, site });
  if (!post) throw AppError.notFound('Post not found.');
  for (const k of UPDATABLE) if (body[k] !== undefined) post[k] = body[k];
  if (!post.author) post.author = null;
  if (body.tags !== undefined) post.set('tags', await resolveTagIds(body.tags, site));
  if (body.category !== undefined) post.category = await categoryOnSite(body.category, site);
  if (Array.isArray(body.categories)) post.categories = await checkedCategories(body.categories, site);
  await post.save();
  await posts.withEditFields(post);
  return { post };
}

/** Deletes the post and its comment thread. */
async function remove(site, id) {
  const post = await posts.findOne({ _id: id, site });
  if (!post) throw AppError.notFound('Post not found.');
  await post.deleteOne();
  await comments.deleteForPost(post._id);
  return {};
}

module.exports = { list, get, create, update, remove, resolveTagIds, categoryOnSite };
