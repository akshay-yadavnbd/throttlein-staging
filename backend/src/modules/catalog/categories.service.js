/** Category rules: the cached public tree, the admin list, and writes that keep the tree acyclic. */
const cache = require('../../utils/redisCache');
const frontend = require('../../infrastructure/storefront/revalidate');
const { AppError } = require('../../errors/AppError');
const categories = require('./categories.repository');
const { buildTree, markHasProducts } = require('./category-tree');

const TREE_CACHE = 'categories:tree:*';
const TREE_TTL_SECONDS = 300;
const trimmed = (v) => String(v || '').trim();

/** Every cached tree variant goes, and the storefront home rebuilds, after any write. */
async function afterWrite(paths) {
  await cache.deleteCacheByPattern(TREE_CACHE);
  for (const p of paths) frontend.revalidatePath(p);
}

/**
 * The public tree. `hasProducts` annotates every node with whether its
 * SUBTREE carries a storefront-visible product: the navbar hides empty
 * categories, admin pickers show everything, from one response shape.
 * Cached five minutes per variant (Redis; falls back to the database when
 * it is down). Writes clear the cache; a product landing in an empty
 * category shows up within the TTL.
 */
function tree({ includeInactive, hasProducts }) {
  const onlyActive = includeInactive !== '1';
  const withCounts = hasProducts === '1';
  // v2: the cached payload stopped carrying `success` when the API moved to the envelope.
  const key = `categories:tree:v2:active=${onlyActive ? 1 : 0}:hp=${withCounts ? 1 : 0}`;
  return cache.getOrSetCache(key, TREE_TTL_SECONDS, async () => {
    const items = await categories.listSorted(onlyActive ? { isActive: true } : {});
    const nodes = buildTree(items);
    if (withCounts) markHasProducts(nodes, await categories.visibleProductCategoryIds());
    return { tree: nodes, count: items.length };
  });
}

async function adminList() {
  const items = await categories.listSorted();
  return { tree: buildTree(items), flat: items, count: items.length };
}

async function create(body) {
  const { name, slug, description, parent, icon, order, isActive } = body;
  if (!name || !name.trim()) throw AppError.badRequest('Category name is required');
  if (parent && !(await categories.exists(parent))) throw AppError.badRequest('Parent category does not exist');
  const category = await categories.create({
    name: name.trim(),
    slug: slug && slug.trim() ? slug.trim() : undefined,
    description: description || '',
    parent: parent || null,
    icon: icon || '',
    order: typeof order === 'number' ? order : 0,
    isActive: isActive !== false,
    seoTitle: trimmed(body.seoTitle),
    seoDescription: trimmed(body.seoDescription),
    contentTitle: trimmed(body.contentTitle),
    contentDescription: trimmed(body.contentDescription),
    bottomTitle: trimmed(body.bottomTitle),
    bottomDescription: String(body.bottomDescription || ''),
  });
  await afterWrite(['/']);
  return { category };
}

/** Refuses a parent that is the category itself or one of its descendants. */
async function assertNotOwnAncestor(category, parent) {
  if (String(parent) === String(category._id)) throw AppError.badRequest('A category cannot be its own parent');
  let cursor = await categories.findById(parent);
  while (cursor) {
    if (String(cursor._id) === String(category._id)) {
      throw AppError.badRequest('Cannot move a category into one of its descendants');
    }
    cursor = cursor.parent ? await categories.findById(cursor.parent) : null;
  }
}

/** Plain fields copied as sent; trimmed text fields; the two booleans / nullables handled below. */
const RAW_FIELDS = ['name', 'slug', 'description', 'icon', 'order'];
const TRIMMED_FIELDS = ['seoTitle', 'seoDescription', 'contentTitle', 'contentDescription', 'bottomTitle'];

async function update(id, body) {
  const category = await categories.findById(id);
  if (!category) throw AppError.notFound('Category not found');
  // Captured before the changes so a slug rename also rebuilds the page it moves away from.
  const previousSlug = category.slug;
  if (body.parent) await assertNotOwnAncestor(category, body.parent);

  for (const f of RAW_FIELDS) if (body[f] !== undefined) category[f] = body[f];
  for (const f of TRIMMED_FIELDS) if (body[f] !== undefined) category[f] = trimmed(body[f]);
  if (body.parent !== undefined) category.parent = body.parent || null;
  if (body.isActive !== undefined) category.isActive = !!body.isActive;
  if (body.bottomDescription !== undefined) category.bottomDescription = String(body.bottomDescription || '');
  await category.save();

  // The category's own page is rebuilt too, not just home: an SEO or content edit
  // must not wait out the page's ISR window. A renamed slug clears the old page as well.
  const paths = ['/', `/${category.slug}`];
  if (previousSlug && previousSlug !== category.slug) paths.push(`/${previousSlug}`);
  await afterWrite(paths);
  return { category };
}

async function remove(id) {
  const category = await categories.findById(id);
  if (!category) throw AppError.notFound('Category not found');
  const children = await categories.countChildren(category._id);
  if (children > 0) {
    throw AppError.badRequest(`Has ${children} subcategor${children === 1 ? 'y' : 'ies'} · delete or move them first`);
  }
  await category.deleteOne();
  await afterWrite(['/']);
}

module.exports = { tree, adminList, create, update, remove };
