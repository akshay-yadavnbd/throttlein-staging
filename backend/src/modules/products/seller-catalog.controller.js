/** A seller's own listings (seller or superadmin). Envelope; read by the seller dashboard and the assistant. */
const asyncHandler = require('express-async-handler');
const { AppError } = require('../../errors/AppError');
const { sendData, sendCreated, sendNoContent } = require('../../utils/apiResponse');
const upload = require('../../middleware/upload');
const { resolveOffersForProducts } = require('../offers');
const products = require('./products.repository');
const catalogService = require('./catalog.service');
const { withListingImage } = require('./listing-image');

/** Uploaded multer files → stored URLs (S3 location or disk filename). */
const filesToUrls = (req) =>
  Array.isArray(req.files) && req.files.length ? req.files.map((f) => upload.fileToUrl(f)) : [];

/** GET /api/products/mine — with the live-offer chip data the list renders. */
exports.listMine = asyncHandler(async (req, res) => {
  const items = await products.listForSeller(req.user._id);
  sendData(res, { items: await resolveOffersForProducts(items.map(withListingImage)) });
});

/** GET /api/products/mine/:id — one of the seller's own products, whatever its state. */
exports.getMine = asyncHandler(async (req, res) => {
  const product = await catalogService.getOwnProduct(req.user, req.params.id);
  sendData(res, { product: withListingImage(product) });
});

/** POST /api/products (multipart) */
exports.create = asyncHandler(async (req, res) => {
  const product = await catalogService.createProduct(req.user, req.body, filesToUrls(req));
  sendCreated(res, { product: withListingImage(product) });
});

/** PUT /api/products/:id (multipart) */
exports.update = asyncHandler(async (req, res) => {
  const product = await catalogService.updateProduct(req.user, req.params.id, req.body, filesToUrls(req));
  sendData(res, { product: withListingImage(product) });
});

/** DELETE /api/products/:id */
exports.remove = asyncHandler(async (req, res) => {
  await catalogService.removeProduct(req.user, req.params.id);
  sendNoContent(res);
});

/** POST /api/products/bulk-status  { ids, status: 'active'|'draft' } */
exports.bulkStatus = asyncHandler(async (req, res) => {
  const { updated, skipped } = await catalogService.bulkSetStatus(
    req.user,
    req.body?.ids,
    String(req.body?.status || ''),
  );
  sendData(res, { updated, skipped });
});

/**
 * POST /api/products/upload-inline — one image for the description editor.
 * Answers the STABLE proxy URL (`/api/files/<key>`, or `/uploads/…` on
 * disk) because the HTML is stored as-is and must keep working for years.
 */
exports.uploadInline = asyncHandler(async (req, res) => {
  if (!req.file) throw AppError.badRequest('No file uploaded — pass the image under the `image` field.');
  const stored = upload.fileToUrl(req.file);
  sendData(res, { url: stored.startsWith('/') ? stored : `/api/files/${stored}` });
});
