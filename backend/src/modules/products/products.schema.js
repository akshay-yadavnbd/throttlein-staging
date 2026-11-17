/** Request schemas for the products module (products.routes.js). */
const { z, paging, optionalInt, optionalNumber, optionalText, typeError } = require('../../validation/common');
const { MAX_PRICE, MAX_PRICE_LABEL } = require('./price-limit');

/** Public catalogue listing. Unknown query keys pass through. */
const listPublicQuery = z
  .object({
    q: optionalText(200),
    category: optionalText(120),
    bike: optionalText(120),
    brand: optionalText(120),
    seller: optionalText(80),
    city: optionalText(80),
    state: optionalText(80),
    country: optionalText(80),
    sort: optionalText(40),
    minPrice: optionalNumber('minPrice must be a number.'),
    maxPrice: optionalNumber('maxPrice must be a number.'),
    page: optionalInt({ min: 1, message: 'page must be a positive number.' }),
    // 300: the storefront category page (CategoryPage.tsx) loads that many for its facets.
    limit: optionalInt({ min: 1, max: 300, message: 'limit must be between 1 and 300.' }),
    exact: optionalText(5),
    discounted: optionalText(5),
  })
  .passthrough();

const searchSuggestQuery = z.object({ q: optionalText(120) }).passthrough();

/** Product id or slug. */
const idOrSlugParams = z.object({
  id: z.string(typeError('Product not found')).trim().min(1, 'Product not found').max(200, 'Product not found'),
});

/**
 * The rate widget expects a 200 `{ ok:false, reason:'bad-pincode' }` for a
 * malformed pincode (the controller answers that), so the route only types
 * and trims the value here rather than rejecting it.
 */
const shippingRateQuery = z.object({ pincode: optionalText(20) }).passthrough();

/**
 * Ids that are not ObjectIds are filtered and reported as `skipped` by the
 * controller, so the schema bounds the list and types the status only.
 */
const bulkStatus = z.object({
  ids: z.array(z.string().max(80)).min(1).max(500),
  status: z.enum(['active', 'draft']),
});
const BULK_STATUS_MESSAGE = 'Provide product ids and a status of active or draft.';

const exportQuery = z
  .object({
    format: z.preprocess(
      (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
      z.enum(['csv', 'xlsx'], { error: 'format must be csv or xlsx.' }).optional(),
    ),
  })
  .passthrough();

const mineQuery = paging({ maxLimit: 500 });

/** Seller Media tab: remove product-embedded image references. */
const bulkRemoveMedia = z
  .object({
    items: z
      .array(z.object({}).passthrough(), typeError('items array is required', 'items array is required'))
      .min(1, 'items array is required')
      .max(200, 'Max 200 items per bulk remove'),
  })
  .passthrough();

const templateQuery = exportQuery;

/** Public review list is keyed by slug. */
const slugParams = z.object({
  slug: z.string(typeError('Product not found')).trim().min(1, 'Product not found').max(200, 'Product not found'),
});

/** Draft import from a product URL; the controller owns the consent rule. */
const importUrl = z
  .object({
    url: z.string().trim().max(2000, 'That link is too long.').optional(),
    confirmRights: z.boolean().optional(),
  })
  .passthrough();

/**
 * Create / update arrive as multipart form data (every field a string).
 * The controller owns the business rules; this types the headline fields
 * when present so a wrong shape fails fast with a sentence.
 */
const productFields = z
  .object({
    name: z.string().trim().max(200, 'Product name must be at most 200 characters.').optional(),
    sku: z.string().trim().max(80, 'SKU must be at most 80 characters.').optional(),
    price: optionalNumber('Price must be a number.').refine(
      (v) => v === undefined || v <= MAX_PRICE,
      `Price can be at most ${MAX_PRICE_LABEL}.`,
    ),
    mrp: optionalNumber('MRP must be a number.').refine(
      (v) => v === undefined || v <= MAX_PRICE,
      `MRP can be at most ${MAX_PRICE_LABEL}.`,
    ),
    stock: optionalInt({ min: 0, message: 'Stock must be a whole number.' }),
  })
  .passthrough();

module.exports = {
  listPublicQuery,
  searchSuggestQuery,
  idOrSlugParams,
  shippingRateQuery,
  bulkStatus,
  BULK_STATUS_MESSAGE,
  exportQuery,
  templateQuery,
  mineQuery,
  productFields,
  bulkRemoveMedia,
  slugParams,
  importUrl,
};
