/**
 * Storefront search. Every query token must hit the product NAME, its BRAND
 * name or a CATEGORY name (expanded to descendants) — never the description,
 * which once let "helmet" in a rain jacket's copy pollute results. A query
 * with zero hits is spell-corrected against a vocabulary built from category,
 * brand and product-name words ("hemlets" → "helmets").
 */
const products = require('./products.repository');
const catalog = require('./catalog.repository');
const { escapeRegExp, collectCategoryAndDescendantIds } = require('./catalog-tree.service');

const MAX_TOKENS = 6;
const tokensOf = (query) => String(query).toLowerCase().split(/\s+/).filter(Boolean).slice(0, MAX_TOKENS);

/** Iterative two-row Levenshtein distance. */
function levenshtein(a, b) {
  a = String(a).toLowerCase();
  b = String(b).toLowerCase();
  const m = a.length,
    n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** Per-token AND conditions: each token must hit name, brand or category. */
async function buildSearchConditions(query) {
  const conds = [];
  for (const t of tokensOf(query)) {
    const re = new RegExp(escapeRegExp(t), 'i');
    const [brandDocs, catDocs] = await Promise.all([
      catalog.brandsNamed(re),
      catalog.categoriesNamed(re, { activeOnly: true }),
    ]);
    const catIds = [];
    for (const c of catDocs) catIds.push(...(await collectCategoryAndDescendantIds(c._id)));
    /** @type {object[]} */
    const or = [{ name: re }];
    if (brandDocs.length) or.push({ brand: { $in: brandDocs.map((b) => b._id) } });
    if (catIds.length) or.push({ category: { $in: catIds } });
    conds.push({ $or: or });
  }
  return conds;
}

/** Vocabulary for spell correction — category, brand and product-name words of 3+ letters. */
async function buildSearchVocabulary() {
  const [cats, brands, prods] = await Promise.all([
    catalog.activeCategoryNames(),
    catalog.activeBrandNames(),
    products.activeNames(),
  ]);
  const vocab = new Set();
  const addWords = (s) => {
    for (const w of String(s || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/))
      if (w.length >= 3) vocab.add(w);
  };
  cats.forEach((c) => addWords(c.name));
  brands.forEach((b) => addWords(b.name));
  prods.forEach((p) => addWords(p.name));
  return vocab;
}

/** "hemlets glovs" → "helmets gloves"; null when nothing changed. */
async function correctQuerySpelling(query, vocab) {
  const words = vocab || (await buildSearchVocabulary());
  let changed = false;
  const fixed = tokensOf(query).map((t) => {
    if (t.length < 3 || words.has(t)) return t;
    const maxDist = t.length <= 4 ? 1 : 2;
    let best = null;
    let bestD = maxDist + 1;
    for (const w of words) {
      if (Math.abs(w.length - t.length) > maxDist) continue;
      const d = levenshtein(t, w);
      if (d < bestD) {
        bestD = d;
        best = w;
        if (d === 1) break; // can't beat 1 (exact already ruled out)
      }
    }
    if (best && bestD <= maxDist) {
      changed = true;
      return best;
    }
    return t;
  });
  return changed ? fixed.join(' ') : null;
}

/**
 * Search conditions for a listing: the raw query's, or — when it finds
 * nothing and `exact` is off — the spell-corrected query's. `correctedQuery`
 * is set only when the correction was used, so the storefront can show
 * "Showing results for …".
 */
async function resolveSearch(rawQuery, baseFilter, { exact = false } = {}) {
  let conds = await buildSearchConditions(rawQuery);
  let correctedQuery = null;
  const hits = await products.countPublic({ ...baseFilter, $and: conds });
  if (hits === 0 && !exact) {
    const fixed = await correctQuerySpelling(rawQuery);
    if (fixed) {
      const fixedConds = await buildSearchConditions(fixed);
      if ((await products.countPublic({ ...baseFilter, $and: fixedConds })) > 0) {
        conds = fixedConds;
        correctedQuery = fixed;
      }
    }
  }
  return { conds, correctedQuery };
}

/**
 * Autocomplete filter: tokens AND-ed; each token may match name,
 * description, a category whose name contains any token, or such a brand.
 */
async function suggestFilter(q, allowedSellers) {
  const tokens = q.split(/\s+/).filter(Boolean).slice(0, MAX_TOKENS);
  const anyToken = { $regex: tokens.map(escapeRegExp).join('|'), $options: 'i' };
  const [cats, brands] = await Promise.all([
    catalog.categoriesNamed(anyToken, { lean: true }),
    catalog.brandsNamed(anyToken, { lean: true }),
  ]);
  const catIds = cats.map((c) => c._id);
  const brandIds = brands.map((b) => b._id);
  return {
    status: 'active',
    seller: { $in: allowedSellers },
    $and: tokens.map((t) => {
      const tokRegex = { $regex: escapeRegExp(t), $options: 'i' };
      return {
        $or: [
          { name: tokRegex },
          { description: tokRegex },
          { category: { $in: catIds } },
          { brand: { $in: brandIds } },
        ],
      };
    }),
  };
}

module.exports = {
  levenshtein,
  buildSearchConditions,
  buildSearchVocabulary,
  correctQuerySpelling,
  resolveSearch,
  suggestFilter,
};
