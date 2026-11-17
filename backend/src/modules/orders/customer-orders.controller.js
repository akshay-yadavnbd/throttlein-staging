/**
 * The customer's own orders (/api/orders/*): list, detail, invoice, cancel,
 * return requests and evidence uploads.
 */
const asyncHandler = require('express-async-handler');
const { sendData, sendCreated } = require('../../utils/apiResponse');
const { AppError } = require('../../errors/AppError');
const taxInvoice = require('./tax-invoice.service');
const upload = require('../../middleware/upload');
const orders = require('./orders.repository');
const parties = require('./parties.repository');
const returns = require('./returns.service');
const cancellation = require('./cancellation.service');
const presenter = require('./orders.presenter');
const { isForward } = require('./order-state');
const { lockedByCustomer } = require('./locking');

async function loadCustomerOrder(req) {
  const order = await orders.findForCustomer(req.params.id, req.user._id);
  if (!order) throw AppError.notFound('Order not found');
  return order;
}

/** GET /api/orders — my orders, bounded (audit P2). */
exports.list = asyncHandler(async (req, res) => {
  const paging = orders.pageParams(req.query);
  const [rows, total] = await orders.listForCustomer(req.user._id, paging);
  res.set('X-Total-Count', String(total));
  const meta = presenter.paginationMeta({ total, page: paging.page, limit: paging.limit });
  sendData(res, { items: rows }, 200, {
    page: meta.page,
    pageSize: meta.limit,
    totalItems: meta.total,
    totalPages: meta.pages,
  });
});

/** GET /api/orders/:id — detail plus each seller's return policy so the UI needn't do the maths. */
exports.getOne = asyncHandler(async (req, res) => {
  const order = await loadCustomerOrder(req);
  const sellerIds = [...new Set((order.items || []).map((it) => String(it.seller)).filter(Boolean))];
  const sellerPolicy = {};
  for (const v of await parties.sellerPolicies(sellerIds)) {
    sellerPolicy[String(v._id)] = {
      storeName: v.storeName || v.name,
      slug: v.slug,
      returnPolicyDays: v.returnPolicyDays ?? 7,
      exchangePolicyDays: v.exchangePolicyDays ?? 7,
    };
  }
  sendData(res, { order, sellerPolicy });
});

/** GET /api/orders/:id/invoice?seller= — one seller's GST invoice PDF, delivered parcels only. */
exports.customerOrderInvoice = asyncHandler(async (req, res) => {
  const order = await loadCustomerOrder(req);
  const delivered = (order.sellerShipments || []).filter((s) => isForward(s) && s.status === 'delivered');
  const wanted = req.query.seller
    ? delivered.find((s) => String(s.seller) === String(req.query.seller))
    : delivered.length === 1
      ? delivered[0]
      : null;
  if (!wanted) {
    throw AppError.badRequest(
      delivered.length
        ? 'Pick which shipment you want the invoice for.'
        : 'Your invoice will be available once the order is delivered.',
    );
  }
  taxInvoice.sendPdf(res, await taxInvoice.invoicePdf(order, wanted));
});

/** POST /api/orders/:id/cancel */
exports.cancel = lockedByCustomer(async (req, res) => {
  const { order, carrierFailures } = await cancellation.cancelByCustomer(req.params.id, req.user._id);
  // Surfaced so the UI can warn instead of promising a clean cancel.
  sendData(res, { order, carrierCancellationPending: carrierFailures > 0 });
});

/** POST /api/orders/:id/return-request */
exports.customerCreateReturnRequest = lockedByCustomer(async (req, res) => {
  const order = await loadCustomerOrder(req);
  const request = await returns.createReturnRequest(order, req.user._id, req.body);
  sendCreated(res, { request });
});

/** POST /api/orders/:id/return-request/:reqId/cancel */
exports.customerCancelReturnRequest = lockedByCustomer(async (req, res) => {
  const order = await loadCustomerOrder(req);
  const request = await returns.cancelReturnRequest(order, req.params.reqId);
  sendData(res, { request });
});

/** POST /api/uploads/return-evidence — up to 6 image/video files; returns the URLs for the request payload. */
exports.customerUploadReturnEvidence = asyncHandler(async (req, res) => {
  const files = Array.isArray(req.files) ? req.files : [];
  if (!files.length) throw AppError.badRequest('No files uploaded.');
  const attachments = files.map((f) => {
    const mime = String(f.mimetype || '');
    return {
      url: upload.fileToUrl(f),
      kind: mime.startsWith('video/') ? 'video' : 'image',
      mimeType: mime,
      sizeBytes: f.size || 0,
    };
  });
  sendData(res, { attachments });
});
