/** Admin media library HTTP handlers (/api/admin/media). Each calls one service function; no rules live here. */
const asyncHandler = require('express-async-handler');
const upload = require('../../middleware/upload');
const trackMediaUpload = require('../../middleware/trackMediaUpload');
const { sendData, sendList, sendNoContent } = require('../../utils/apiResponse');
const media = require('./media.service');

exports.list = asyncHandler(async (req, res) => {
  const { items, page, limit, total } = await media.list(req.query);
  sendList(res, items, { page, pageSize: limit, totalItems: total });
});
exports.folders = asyncHandler(async (_req, res) => sendData(res, await media.folders()));
/**
 * Up to 20 files under `files`; they land under the flat admin prefix, and
 * trackMediaUpload records each one in the library.
 */
exports.upload = [
  upload.array('files', 20),
  trackMediaUpload,
  asyncHandler(async (req, res) => sendData(res, media.uploaded(Array.isArray(req.files) ? req.files : []))),
];
exports.bulkRemove = asyncHandler(async (req, res) => sendData(res, await media.bulkRemove(req.body?.ids)));
exports.remove = asyncHandler(async (req, res) => {
  await media.remove(req.params.id);
  sendNoContent(res);
});
