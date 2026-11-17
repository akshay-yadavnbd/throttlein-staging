/**
 * Root → leaf category chain for a post, so the storefront can build the
 * hierarchical /blog/cat/sub/.../slug URL. Pure: takes the site's whole
 * category tree (one query) and walks parent pointers in memory, so the
 * hop count is constant regardless of depth.
 */
const indexTree = (categories) => new Map(categories.map((c) => [String(c._id), c]));

/** `categoryRef` may be an id or a populated category document. */
function chainFor(categoryRef, byId) {
  const chain = [];
  const guard = new Set();
  let cursor = categoryRef ? byId.get(String(categoryRef._id || categoryRef)) : null;
  while (cursor && !guard.has(String(cursor._id))) {
    guard.add(String(cursor._id));
    chain.unshift({ _id: cursor._id, name: cursor.name, slug: cursor.slug });
    cursor = cursor.parent ? byId.get(String(cursor.parent)) : null;
  }
  return chain;
}

const slugify = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

module.exports = { indexTree, chainFor, slugify };
