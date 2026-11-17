const { env } = require('../config/env');
const { logger } = require('./logger');
/**
 * Mongoose hook that emails everyone on a product's "notify me when back
 * in stock" list the moment its `stock` crosses 0 → >0.
 *
 * Why a schema-level hook instead of patching each call site
 *   Stock gets written from several places — order placement/cancel
 *   ($inc via Product.updateOne), the seller's manual stock edit and the
 *   variants-recompute path (both product.save()) — see productController
 *   and orderController. Hooking the schema itself means every one of
 *   those paths is covered from a single place, the same pattern already
 *   used by imageCleanup.js's attachImageCleanup().
 *
 * Usage
 *   const { attachRestockNotify } = require('../utils/notifyRestock');
 *   attachRestockNotify(productSchema);
 *   module.exports = mongoose.model('Product', productSchema);
 *
 * Never throws — a failed lookup/email must not block the stock write
 * that triggered it.
 */

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Email everyone waiting on `productId`, then clear their requests. */
async function fireRestockEmails(productId) {
  const NotifyRequest = require('../modules/customers/notify-request.model');
  const Product = require('../modules/products/product.model');
  const { sendMail } = require('../config/mail');
  const { publicFileUrl } = require('../middleware/upload');

  /** @type {any[]} user populated */
  const requests = await NotifyRequest.find({ product: productId }).populate('user', 'name email');
  if (!requests.length) return;

  const product = await Product.findById(productId).select('name slug images').lean();
  const productName = product?.name || 'An item on your notify list';
  const frontendOrigin = (env.FRONTEND_ORIGIN || 'http://localhost:3000').replace(/\/$/, '');
  const productUrl = product?.slug ? `${frontendOrigin}/product/${product.slug}?id=${productId}` : frontendOrigin;
  // Same stable proxy/S3 URL the storefront uses — a presigned URL would
  // expire long before some inboxes render the email.
  const rawImage = Array.isArray(product?.images) ? product.images[0] : '';
  const productImage = rawImage ? publicFileUrl(rawImage) : '';
  const imageHtml = productImage
    ? `<img src="${productImage}" alt="${escapeHtml(productName)}"
             width="120" height="120"
             style="display:block;width:120px;height:120px;object-fit:contain;background:#FFFFFF;border:1px solid #e7e7e9;border-radius:10px;margin:0 0 18px" />`
    : '';

  await Promise.all(
    requests.map((r) => {
      if (!r.user?.email) return Promise.resolve();
      return sendMail({
        to: r.user.email,
        subject: `THROTTLEIN — "${productName}" is back in stock`,
        html: `
          <div style="font-family:Segoe UI,Roboto,sans-serif;max-width:520px;margin:auto;background:#EFF1EA;padding:32px;border-radius:12px">
            <h2 style="margin:0 0 12px;color:#141414">Good news, ${escapeHtml(r.user.name || 'there')}!</h2>
            ${imageHtml}
            <p style="color:#3f3f44;line-height:1.5;margin:0 0 20px">
              <strong>${escapeHtml(productName)}</strong> is back in stock. Grab it before it sells out again.
            </p>
            <a href="${productUrl}"
               style="background:#141414;color:#FFFFFF;padding:12px 22px;text-decoration:none;border-radius:8px;font-weight:bold;display:inline-block">
              View product
            </a>
          </div>`,
        text: `${productName} is back in stock. View it: ${productUrl}`,
      }).catch((err) => logger.error({ err }, '[notifyRestock] sendMail failed:'));
    }),
  );

  await NotifyRequest.deleteMany({ product: productId });
}

/** Fire-and-forget: only acts on a genuine 0-or-less → >0 transition. */
function checkRestock(productId, prevStock, nextStock) {
  if (productId == null || nextStock == null) return;
  const wasOut = (prevStock ?? 0) <= 0;
  const isBackIn = nextStock > 0;
  if (!wasOut || !isBackIn) return;
  fireRestockEmails(productId).catch((err) => logger.error({ err }, '[notifyRestock]'));
}

function attachRestockNotify(schema) {
  // ── Product.updateOne(...) / Product.updateMany(...) — used for the
  //    $inc stock adjustments on order placement/cancel. Query middleware:
  //    `this` is the Query, so we snapshot the prior stock in `pre`, then
  //    diff against the post-write value in `post`.
  async function stashPrevStock(query) {
    try {
      const prior = await query.model.findOne(query.getFilter()).select('stock').lean();
      query.__prevStock = prior ? prior.stock : undefined;
    } catch (err) {
      logger.error({ err }, '[notifyRestock] prev-stock lookup failed:');
    }
  }

  schema.pre('updateOne', function () {
    return stashPrevStock(this).catch(() => {});
  });
  schema.pre('updateMany', function () {
    return stashPrevStock(this).catch(() => {});
  });

  schema.post('updateOne', async function () {
    try {
      const doc = await this.model.findOne(this.getFilter()).select('_id stock').lean();
      if (doc) checkRestock(doc._id, this.__prevStock, doc.stock);
    } catch (err) {
      logger.error({ err }, '[notifyRestock]');
    }
  });

  // ── Product.findOneAndUpdate / findByIdAndUpdate ──
  schema.pre('findOneAndUpdate', function () {
    return stashPrevStock(this).catch(() => {});
  });
  schema.post('findOneAndUpdate', function (doc) {
    if (doc) checkRestock(doc._id, this.__prevStock, doc.stock);
  });

  // ── product.save() — the seller's manual stock edit + the
  //    variants-recompute path both mutate `.stock` and call `.save()`. ──
  schema.pre('save', async function () {
    if (!this.isNew && this.isModified('stock')) {
      try {
        const prior = await this.constructor.findById(this._id).select('stock').lean();
        this.$locals.__prevStock = prior ? prior.stock : undefined;
      } catch (err) {
        logger.error({ err }, '[notifyRestock] prev-stock lookup failed:');
      }
    }
  });
  schema.post('save', function (doc) {
    if (doc.$locals && doc.$locals.__prevStock !== undefined) {
      checkRestock(doc._id, doc.$locals.__prevStock, doc.stock);
    }
  });
}

module.exports = { attachRestockNotify };
