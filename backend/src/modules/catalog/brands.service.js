/** Brand rules: the filtered list (with product counts when asked) and admin writes. */
const escapeRegExp = require('../../utils/escapeRegExp');
const { AppError } = require('../../errors/AppError');
const brands = require('./brands.repository');

const plain = (b) => (typeof b.toObject === 'function' ? b.toObject() : b);

/**
 * GET /api/brands.
 *   q            name contains (case-insensitive)
 *   active=1     active brands only
 *   featured=1   the homepage Top Brands rail
 *   withProducts=1  only brands with at least one ACTIVE product, with `productsCount` (the /brands index)
 *   counts=1     admin: `productsCount` of ANY status, so "Delete brand" can say what it orphans
 */
async function list(query) {
  const { q, active, featured, withProducts, counts } = query;
  const filter = {};
  if (q) filter.name = new RegExp(escapeRegExp(q), 'i');
  if (active === '1') filter.isActive = true;
  if (featured === '1') filter.featured = true;
  let items = await brands.listSorted(filter);

  if (withProducts === '1') {
    const byBrand = await brands.productCountsByBrand({ activeOnly: true });
    items = items
      .filter((b) => (byBrand.get(String(b._id)) || 0) > 0)
      .map((b) => ({ ...plain(b), productsCount: byBrand.get(String(b._id)) }));
  } else if (counts === '1') {
    const byBrand = await brands.productCountsByBrand({ activeOnly: false });
    items = items.map((b) => ({ ...plain(b), productsCount: byBrand.get(String(b._id)) || 0 }));
  }
  return { items, count: items.length };
}

/** Text fields an admin edit may set as sent; empty strings fall through to storefront defaults. */
const TEXT_FIELDS = [
  'name',
  'slug',
  'logo',
  'website',
  'description',
  'order',
  'seoTitle',
  'seoDescription',
  'ogImage',
  'contentTitle',
  'contentDescription',
  'bottomTitle',
  'bottomDescription',
];

async function create(body) {
  if (!body.name || !body.name.trim()) throw AppError.badRequest('Brand name is required');
  const brand = await brands.create({
    name: body.name.trim(),
    slug: body.slug && body.slug.trim() ? body.slug.trim() : undefined,
    logo: body.logo || '',
    website: body.website || '',
    description: body.description || '',
    isActive: body.isActive !== false,
    featured: !!body.featured,
    order: typeof body.order === 'number' ? body.order : 0,
    seoTitle: body.seoTitle || '',
    seoDescription: body.seoDescription || '',
    ogImage: body.ogImage || '',
    contentTitle: body.contentTitle || '',
    contentDescription: body.contentDescription || '',
    bottomTitle: body.bottomTitle || '',
    bottomDescription: body.bottomDescription || '',
  });
  return { brand };
}

async function loadBrand(id) {
  const brand = await brands.findById(id);
  if (!brand) throw AppError.notFound('Brand not found');
  return brand;
}

async function update(id, body) {
  const brand = await loadBrand(id);
  for (const f of TEXT_FIELDS) if (body[f] !== undefined) brand[f] = body[f];
  if (body.isActive !== undefined) brand.isActive = !!body.isActive;
  if (body.featured !== undefined) brand.featured = !!body.featured;
  await brand.save();
  return { brand };
}

async function remove(id) {
  const brand = await loadBrand(id);
  await brand.deleteOne();
}

module.exports = { list, create, update, remove };
