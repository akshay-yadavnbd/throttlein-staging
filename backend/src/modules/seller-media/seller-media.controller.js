/** Seller media library HTTP handlers (/api/seller/media). Each calls one service function; no rules live here. */
const asyncHandler = require('express-async-handler');
const upload = require('../../middleware/upload');
const { sendData, sendNoContent } = require('../../utils/apiResponse');
const media = require('./seller-media.service');

const respond = (fn) => asyncHandler(async (req, res) => sendData(res, await fn(req)));

/** `{ data: { items, folders }, meta }` — folders cover the whole library, not just this page. */
exports.list = asyncHandler(async (req, res) => {
  const { page, limit, total, ...data } = await media.list(req.user._id, req.query);
  sendData(res, data, 200, {
    page,
    pageSize: limit,
    totalItems: total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
});
/** Up to 20 files under `files`. */
exports.upload = [
  upload.array('files', 20),
  respond((req) => media.recordUploads(req.user._id, Array.isArray(req.files) ? req.files : [])),
];
exports.remove = asyncHandler(async (req, res) => {
  await media.remove(req.user._id, req.params.id);
  sendNoContent(res);
});
exports.bulkRemove = respond((req) => media.bulkRemove(req.user._id, req.body?.ids));
exports.presign = respond((req) => media.presign(req.user._id, req.body?.key));
