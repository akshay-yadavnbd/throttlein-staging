/** Spreadsheet template, export and bulk import for the seller's catalogue. */
const asyncHandler = require('express-async-handler');
const { TEMPLATE_ROWS } = require('./csv-format');
const exportService = require('./export.service');
const importService = require('./import.service');
const { sendData } = require('../../utils/apiResponse');

function sendSheet(res, { body, contentType, filename }) {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(body);
}

/** GET /api/products/import/template?format=csv|xlsx — three example rows (+ Instructions sheet in XLSX). */
exports.importTemplate = asyncHandler(async (req, res) => {
  sendSheet(
    res,
    exportService.sheetDownload(TEMPLATE_ROWS, {
      format: req.query.format,
      name: 'throttlein-products-template',
      instructions: true,
    }),
  );
});

/** GET /api/products/export?format=csv|xlsx — the seller's own catalogue. */
exports.exportMine = asyncHandler(async (req, res) => {
  const rows = await exportService.exportRows(req.user._id);
  const ts = new Date().toISOString().slice(0, 10);
  sendSheet(res, exportService.sheetDownload(rows, { format: req.query.format, name: `throttlein-products-${ts}` }));
});

/** POST /api/products/import (multipart: csv|xlsx + images[]) — per-row results. */
exports.importBulk = asyncHandler(async (req, res) => {
  const { summary, results } = await importService.importBulk(req.user, req.files);
  sendData(res, { summary, results });
});
