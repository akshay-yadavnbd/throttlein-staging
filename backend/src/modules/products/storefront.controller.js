/** Public catalogue endpoints — no auth. Envelope: the storefront reads these through `envelopeOrLegacy` / `dataOf`. */
const asyncHandler = require('express-async-handler');
const storefront = require('./storefront.service');
const { sendData } = require('../../utils/apiResponse');

/** GET /api/products */
exports.listPublic = asyncHandler(async (req, res) => {
  // Paging in meta; the search echo (`query`, `correctedQuery`) stays beside the items.
  const { items, page, limit, total, pages, ...search } = await storefront.listPublic(req.query);
  sendData(res, { items, ...search }, 200, { page, pageSize: limit, totalItems: total, totalPages: pages });
});

/** GET /api/products/search-suggest?q= — up to 8 rows for the navbar dropdown. */
exports.searchSuggest = asyncHandler(async (req, res) => {
  sendData(res, { items: await storefront.suggestions(req.query.q) });
});

/** GET /api/products/:id — id or slug. */
exports.getOne = asyncHandler(async (req, res) => {
  sendData(res, { product: await storefront.publicProduct(req.params.id) });
});

/** GET /api/products/:id/shipping-rate?pincode= — always 200; `{ ok:false, reason }` for expected misses. */
exports.shippingRate = asyncHandler(async (req, res) => {
  sendData(res, await storefront.shippingRate(req.params.id, req.query.pincode));
});
