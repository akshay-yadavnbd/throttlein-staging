/**
 * The category tree as the product flows see it: the "Shop by Bike" subtree
 * (bikes attach via `product.bike`, everything else via `product.category`),
 * lookups by id / slug / name, and descendant expansion.
 */
const mongoose = require('mongoose');
const catalog = require('./catalog.repository');

const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SHOP_BY_BIKE = 'Shop by Bike';

/** Walk up the parent chain — true if the category lives under "Shop by Bike". */
async function isInShopByBike(categoryId) {
  let cur = await catalog.categoryById(categoryId);
  while (cur) {
    if (cur.parent === null && cur.name === SHOP_BY_BIKE) return true;
    if (!cur.parent) return false;
    cur = await catalog.categoryById(cur.parent);
  }
  return false;
}

async function isOutsideShopByBike(categoryId) {
  let cur = await catalog.categoryById(categoryId);
  while (cur) {
    if (cur.parent === null && cur.name === SHOP_BY_BIKE) return false;
    if (!cur.parent) return true;
    cur = await catalog.categoryById(cur.parent);
  }
  return true;
}

/** Category from an id, slug or name (case-insensitive on name). */
async function resolveCategory(input) {
  if (!input) return null;
  if (mongoose.isValidObjectId(input)) return (await catalog.categoryById(input)) || null;
  const raw = String(input).trim();
  return (
    (await catalog.categoryBySlug(raw.toLowerCase())) ||
    (await catalog.categoryByName(new RegExp(`^${escapeRegExp(raw)}$`, 'i')))
  );
}

/** Brand from an id, slug or display name. */
async function resolveBrand(input) {
  if (!input) return null;
  let brand = mongoose.isValidObjectId(input) ? await catalog.brandById(input) : null;
  if (!brand) {
    const raw = String(input).trim();
    brand =
      (await catalog.brandBySlug(raw.toLowerCase())) ||
      (await catalog.brandByName(new RegExp(`^${escapeRegExp(raw)}$`, 'i')));
  }
  return brand || null;
}

/** A category and every descendant id (breadth-first). */
async function collectCategoryAndDescendantIds(rootId) {
  const ids = [rootId];
  let frontier = [rootId];
  while (frontier.length) {
    const children = await catalog.childCategories(frontier);
    if (!children.length) break;
    const next = children.map((c) => c._id);
    ids.push(...next);
    frontier = next;
  }
  return ids;
}

module.exports = {
  SHOP_BY_BIKE,
  escapeRegExp,
  isInShopByBike,
  isOutsideShopByBike,
  resolveCategory,
  resolveBrand,
  collectCategoryAndDescendantIds,
};
