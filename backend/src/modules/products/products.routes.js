/**
 * /api/products. Mounted by routes/api.js through routes/productRoutes.js.
 * Static paths come BEFORE the /:id routes so the param never captures them.
 */
const express = require('express');
const { protect, requireRole } = require('../../middleware/auth');
const upload = require('../../middleware/upload');
const trackMediaUpload = require('../../middleware/trackMediaUpload');
const rateLimit = require('../../middleware/rateLimit');
const { validate } = require('../../middleware/validate');
const p = require('./products.schema');
const storefront = require('./storefront.controller');
const seller = require('./seller-catalog.controller');
const media = require('./seller-media.controller');
const sheets = require('./import-export.controller');
const catalog = require('../catalog');
const urlImport = require('./url-import.controller');

const router = express.Router();
const sellerOnly = [protect, requireRole('seller', 'superadmin')];

// Draft-only extraction from a product URL: no writes. Per-seller quotas
// protect the server key from accidental cost spikes.
router.post(
  '/import-url',
  ...sellerOnly,
  rateLimit({ name: 'product-import-minute', max: 3, window: 60, keyBy: (req) => String(req.user._id) }),
  rateLimit({ name: 'product-import-day', max: 30, window: 86400, keyBy: (req) => String(req.user._id) }),
  validate({ body: p.importUrl }),
  urlImport.fromUrl,
);

// Public storefront
router.get('/', validate({ query: p.listPublicQuery }), storefront.listPublic);
router.get('/search-suggest', validate({ query: p.searchSuggestQuery }), storefront.searchSuggest);

// Seller's own catalogue and media
router.get('/mine', ...sellerOnly, validate({ query: p.mineQuery }), seller.listMine);
router.get('/mine/:id', ...sellerOnly, validate({ params: p.idOrSlugParams }), seller.getMine);
router.get('/media/mine', ...sellerOnly, media.listMedia);
router.post('/media/bulk-remove', ...sellerOnly, validate({ body: p.bulkRemoveMedia }), media.bulkRemoveMedia);

// Bulk import / export — the seller's own catalogue only
router.get('/export', ...sellerOnly, validate({ query: p.exportQuery }), sheets.exportMine);
router.post(
  '/bulk-status',
  ...sellerOnly,
  validate({ body: p.bulkStatus }, { message: p.BULK_STATUS_MESSAGE }),
  seller.bulkStatus,
);
router.get('/import/template', ...sellerOnly, validate({ query: p.templateQuery }), sheets.importTemplate);
// One data file ("csv" or "xlsx" field, picked by the frontend from the
// extension) plus optional photos ("images"); the importer matches photos to
// sheet cells by basename. 2000 photos: migrated catalogues can be large,
// and multer streams to disk/S3 so the count is not a memory concern.
router.post(
  '/import',
  ...sellerOnly,
  upload.fields([
    { name: 'csv', maxCount: 1 },
    { name: 'xlsx', maxCount: 1 },
    { name: 'images', maxCount: 2000 },
  ]),
  trackMediaUpload,
  validate({ body: p.productFields }),
  sheets.importBulk,
);

// Live shipping rate for the product page — public so guests can check.
router.get(
  '/:id/shipping-rate',
  validate({ params: p.idOrSlugParams, query: p.shippingRateQuery }),
  storefront.shippingRate,
);
// Public review list — keyed by slug so the storefront URL shape stays consistent.
router.get('/:slug/reviews', validate({ params: p.slugParams }), catalog.productReviews);
router.get('/:id', validate({ params: p.idOrSlugParams }), storefront.getOne);

// Seller writes (multipart; validate() runs AFTER multer so it sees the fields)
router.post(
  '/',
  ...sellerOnly,
  upload.array('images', 96),
  trackMediaUpload,
  validate({ body: p.productFields }),
  seller.create,
);
router.put(
  '/:id',
  ...sellerOnly,
  upload.array('images', 96),
  trackMediaUpload,
  validate({ params: p.idOrSlugParams, body: p.productFields }),
  seller.update,
);
router.delete('/:id', ...sellerOnly, validate({ params: p.idOrSlugParams }), seller.remove);
// Inline image for the description editor — not tied to a product, so it
// works on the "New product" page before the product exists.
router.post(
  '/upload-inline',
  ...sellerOnly,
  upload.single('image'),
  trackMediaUpload,
  validate({ body: p.productFields }),
  seller.uploadInline,
);

module.exports = router;
