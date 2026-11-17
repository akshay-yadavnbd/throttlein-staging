/** POST /api/products/import-url — `{ data: { draft, images, sourceUrl } }`. No rules live here. */
const asyncHandler = require('express-async-handler');
const { sendData } = require('../../utils/apiResponse');
const urlImport = require('./url-import.service');

exports.fromUrl = asyncHandler(async (req, res) => {
  // Set first, so refusals are not cached either: a draft can carry fresh page data.
  res.set('Cache-Control', 'no-store');
  sendData(res, await urlImport.importFromUrl(req.body));
});
