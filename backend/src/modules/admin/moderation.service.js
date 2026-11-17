/** Product moderation: the cross-seller list, status / featured flags, location tags. */
const escapeRegExp = require('../../utils/escapeRegExp');
const { AppError } = require('../../errors/AppError');
const products = require('./products.repository');
const { pageOf } = require('./sellers.service');

const PRODUCT_STATUSES = ['draft', 'active', 'rejected', 'out_of_stock'];

/** ?scope=all for every seller's products; the default is the admin's own listings. */
async function list(query, adminId) {
  const { status, q, scope = 'mine' } = query;
  const filter = {};
  if (scope !== 'all') filter.seller = adminId;
  if (status) filter.status = status;
  if (q) {
    const re = new RegExp(escapeRegExp(q), 'i');
    filter.$or = [{ name: re }, { brand: re }];
  }
  const { page, limit, skip } = pageOf(query);
  const [items, total] = await products.page(filter, { skip, limit });
  return { items, total, page, limit };
}

async function setStatus(idOrSlug, { status, isFeatured }) {
  const updates = {};
  if (status) {
    if (!PRODUCT_STATUSES.includes(status)) throw AppError.badRequest('Invalid product status.');
    updates.status = status;
  }
  if (typeof isFeatured === 'boolean') updates.isFeatured = isFeatured;
  const product = await products.updateByIdOrSlug(idOrSlug, updates);
  if (!product) throw AppError.notFound('Product not found.');
  return { product };
}

const slugify = (v) =>
  String(v)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Array, JSON-stringified array or CSV string → slugified, deduped array. */
function toSlugList(raw) {
  if (raw === undefined || raw === null || raw === '') return [];
  let arr = [];
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === 'string') {
    const t = raw.trim();
    if (t.startsWith('[')) {
      try {
        const p = JSON.parse(t);
        if (Array.isArray(p)) arr = p;
      } catch {
        arr = t.split(',');
      }
    } else arr = t.split(',');
  }
  const seen = new Set();
  const out = [];
  for (const it of arr) {
    const s = slugify(it);
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

/**
 * City / state / country tags that drive the location pages ("LS2 Helmets
 * in Noida"). Same normalisation as the seller side, so both produce the
 * same tag shapes.
 */
async function setLocations(idOrSlug, body) {
  const updates = {};
  if (body.cities !== undefined) updates.cities = toSlugList(body.cities);
  if (body.states !== undefined) updates.states = toSlugList(body.states);
  if (body.country !== undefined) updates.country = toSlugList(body.country)[0] || '';
  const product = await products.updateByIdOrSlug(idOrSlug, updates);
  if (!product) throw AppError.notFound('Product not found.');
  return { product };
}

module.exports = { list, setStatus, setLocations, toSlugList, PRODUCT_STATUSES };
