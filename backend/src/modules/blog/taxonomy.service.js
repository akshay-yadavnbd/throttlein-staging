/**
 * Categories and tags (per site) and the shared author roster. Post
 * counts decorate every list so staff see usage at a glance.
 */
const { AppError } = require('../../errors/AppError');
const posts = require('./posts.repository');
const taxonomy = require('./taxonomy.repository');
const { slugify } = require('./category-chain');

const countMap = (rows) => new Map(rows.map((c) => [String(c._id), c.count]));
const withCount = (items, counts, key = 'postCount') =>
  items.map((it) => ({ ...it.toObject(), [key]: counts.get(String(it._id)) || 0 }));

/* ── categories ─────────────────────────────────────────────────────── */

async function listCategories(site) {
  const [items, counts] = await Promise.all([
    taxonomy.listCategories(site),
    posts.countBy('category', { site, category: { $ne: null } }),
  ]);
  return { items: withCount(items, countMap(counts)) };
}

/** A parent must live on the same site, else the URL chain would span two domains. */
async function parentOnSite(parent, site) {
  const parentCat = await taxonomy.categoryIdOnSite(parent, site);
  if (!parentCat) throw AppError.badRequest('Parent category not found on this site.');
  return parentCat._id;
}

async function createCategory(site, { name, description, order, isActive, parent }) {
  if (!name) throw AppError.badRequest('Category name is required.');
  const parentId = parent ? await parentOnSite(parent, site) : null;
  const cat = await taxonomy.createCategory({ site, name, description, order, isActive, parent: parentId });
  await cat.populate('parent', 'name slug');
  return { category: cat };
}

async function updateCategory(site, id, body) {
  const cat = await taxonomy.findCategory(id, site);
  if (!cat) throw AppError.notFound('Category not found.');
  for (const k of ['name', 'description', 'order', 'isActive', 'slug']) if (body[k] !== undefined) cat[k] = body[k];
  if (body.parent !== undefined) {
    const newParent = body.parent || null;
    if (newParent && String(newParent) === String(cat._id))
      throw AppError.badRequest('A category cannot be its own parent.');
    if (newParent) await parentOnSite(newParent, site);
    cat.parent = newParent;
  }
  await cat.save();
  await cat.populate('parent', 'name slug');
  return { category: cat };
}

/** Posts keep publishing with no category; staff can reassign later. */
async function removeCategory(site, id) {
  const cat = await taxonomy.findCategory(id, site);
  if (!cat) throw AppError.notFound('Category not found.');
  await posts.clearCategory(cat._id);
  await cat.deleteOne();
  return {};
}

/* ── tags ───────────────────────────────────────────────────────────── */

async function listTags(site) {
  const [items, counts] = await Promise.all([taxonomy.listTags(site), posts.countByTag(site)]);
  return { items: withCount(items, countMap(counts)) };
}

/** findOrCreate by (site, slug) so a duplicate name never errors. */
async function createTag(site, { name }) {
  if (!name) throw AppError.badRequest('Tag name is required.');
  const slug = slugify(name);
  let tag = await taxonomy.findTagBySlug(site, slug);
  if (!tag) tag = await taxonomy.createTag({ site, name, slug });
  return { tag };
}

async function updateTag(site, id, body) {
  const tag = await taxonomy.findTag(id, site);
  if (!tag) throw AppError.notFound('Tag not found.');
  if (body.name !== undefined) tag.name = body.name;
  if (body.slug !== undefined) tag.slug = body.slug;
  await tag.save();
  return { tag };
}

async function removeTag(site, id) {
  const tag = await taxonomy.findTag(id, site);
  if (!tag) throw AppError.notFound('Tag not found.');
  await posts.pullTag(tag._id);
  await tag.deleteOne();
  return {};
}

/* ── authors (shared roster) ────────────────────────────────────────── */

const cleanCredentials = (list) =>
  Array.isArray(list)
    ? list
        .map((c) => String(c).trim())
        .filter(Boolean)
        .slice(0, 8)
    : [];
const postsOffSite = (authorId, site) => posts.count({ author: authorId, site: { $ne: site } });

/** Counts are for the site being viewed; `otherSitePostCount` feeds the delete guard's dialog. */
async function listAuthors(site) {
  const [items, here, elsewhere] = await Promise.all([
    taxonomy.listAuthors(),
    posts.countBy('author', { site, author: { $ne: null } }),
    posts.countBy('author', { site: { $ne: site }, author: { $ne: null } }),
  ]);
  const hereMap = countMap(here);
  const elsewhereMap = countMap(elsewhere);
  return {
    items: items.map((a) => ({
      ...a.toObject(),
      postCount: hereMap.get(String(a._id)) || 0,
      otherSitePostCount: elsewhereMap.get(String(a._id)) || 0,
    })),
  };
}

async function loadAuthor(id) {
  const author = await taxonomy.findAuthor(id);
  if (!author) throw AppError.notFound('Author not found.');
  return author;
}

const getAuthor = async (id) => ({ author: await loadAuthor(id) });

async function createAuthor({ name, slug, role, bio, avatarUrl, credentials, order, isActive }) {
  if (!name) throw AppError.badRequest('Author name is required.');
  const author = await taxonomy.createAuthor({
    name,
    slug,
    role,
    bio,
    avatarUrl,
    credentials: cleanCredentials(credentials),
    order: Number(order) || 0,
    isActive: isActive !== false,
  });
  return { author };
}

/** Editing a shared author changes the byline on BOTH properties; the response says how many other-site posts moved. */
async function updateAuthor(site, id, body) {
  const author = await loadAuthor(id);
  const affectedOtherSitePosts = await postsOffSite(author._id, site);
  for (const k of ['name', 'slug', 'role', 'bio', 'avatarUrl', 'order', 'isActive'])
    if (body[k] !== undefined) author[k] = body[k];
  if (Array.isArray(body.credentials)) author.credentials = cleanCredentials(body.credentials);
  await author.save();
  return { author, affectedOtherSitePosts };
}

/** Deleting strips the byline on both sites, so a one-site editor may not do it while the other site still uses it. */
async function removeAuthor(site, id, actorRole) {
  const author = await loadAuthor(id);
  const foreignCount = await postsOffSite(author._id, site);
  if (foreignCount > 0 && actorRole !== 'superadmin') {
    throw AppError.conflict(
      `Cannot delete this author: ${foreignCount} post(s) on another site still use this byline. ` +
        `Reassign them first, or ask a superadmin to remove the author.`,
    );
  }
  await posts.clearAuthor(author._id);
  await author.deleteOne();
  return { clearedOtherSitePosts: foreignCount };
}

module.exports = {
  listCategories,
  createCategory,
  updateCategory,
  removeCategory,
  listTags,
  createTag,
  updateTag,
  removeTag,
  listAuthors,
  getAuthor,
  createAuthor,
  updateAuthor,
  removeAuthor,
};
