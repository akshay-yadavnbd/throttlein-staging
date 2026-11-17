/** The seller dashboard's Media tab. */
const asyncHandler = require('express-async-handler');
const { AppError } = require('../../errors/AppError');
const { sendData } = require('../../utils/apiResponse');
const media = require('./media.service');

/** GET /api/products/media/mine — every image across the seller's catalogue. */
exports.listMedia = asyncHandler(async (req, res) => {
  const items = await media.mediaRows(req.user._id);
  sendData(res, { items, total: items.length });
});

/** POST /api/products/media/bulk-remove  { items: [{ productId, kind, color?, key }] } */
exports.bulkRemoveMedia = asyncHandler(async (req, res) => {
  const items = Array.isArray(req.body && req.body.items) ? req.body.items : [];
  if (items.length === 0) throw AppError.badRequest('items array is required');
  if (items.length > 200) throw AppError.badRequest('Max 200 items per bulk remove');
  const { removed, blocked } = await media.bulkRemoveMedia(req.user._id, items);
  sendData(res, { removed, blocked, requested: items.length });
});
