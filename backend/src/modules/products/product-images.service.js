/**
 * The image side of a product save: the manifests the seller form posts
 * (main gallery order, per-colour galleries, size chart, A+ slots) and the
 * guardrails that keep a routine edit from wiping photos.
 *
 * Why so strict: sellers repeatedly saw images vanish after routine edits
 * (stale form state, tab races, pre-guardrail deploys). Rather than
 * whitelist "safe wipe" cases, a save needs an explicit `imagesWipeAck: '1'`
 * to empty the main gallery — and even then only when a per-colour gallery
 * remains to fall back on.
 */
const { AppError } = require('../../errors/AppError');
const { logger } = require('../../utils/logger');
const input = require('./product-input');
const { hasAnyImage } = require('./listing-image');

/**
 * Images for a NEW product from the posted manifests. Mutates `body`.
 * `imageOrder` may carry `kept` URLs picked from the Media Library, so a
 * listing built entirely from library images is a legitimate path.
 */
function applyCreateImages(body, raw, uploaded) {
  if (raw.colorImagesManifest !== undefined)
    body.colorImages = input.parseColorImagesManifest(raw.colorImagesManifest, uploaded);
  if (raw.sizeChartImageManifest !== undefined) {
    const parsed = input.parseSizeChartImageManifest(raw.sizeChartImageManifest, uploaded);
    if (parsed !== null) body.sizeChartImage = parsed;
  }
  if (raw.aPlusImagesManifest !== undefined) {
    body.aPlusImages = input.parseAPlusImagesManifest(raw.aPlusImagesManifest, uploaded);
    logger.info({ aPlusImages: body.aPlusImages }, 'product create: aPlusImages set');
  }
  const ordered = input.parseImageOrder(raw.imageOrder, uploaded);
  if (ordered) body.images = ordered;
  // No manifest + fresh uploads → natural upload order. Kept-only
  // submissions always arrive through imageOrder.
  if (!body.images && uploaded.length) body.images = uploaded;
}

/**
 * Every new product needs a photo — drafts excepted (they never reach the
 * storefront; the check re-applies when the seller publishes).
 */
function assertCreateHasImage(body) {
  if (body.status === 'draft' || hasAnyImage(body)) return;
  // Variant mode is inferred from the payload so the message matches what the seller saw.
  const looksVariant = Array.isArray(body.colorImages) && body.colorImages.length > 0;
  throw AppError.badRequest(
    looksVariant ? 'Add at least one photo under Images per color.' : 'Add at least one product image before saving.',
  );
}

/**
 * Images for an EXISTING product. Three modes for the main gallery, in order:
 * the `imageOrder` manifest (kept + staged interleaved), the legacy
 * `existingImages` list + appended uploads, or plain append. Then the
 * guardrails, the colour-bucket mirror and the publish gate. Mutates `product`.
 */
function applyUpdateImages(product, raw, uploaded) {
  const priorImages = Array.isArray(product.images) ? [...product.images] : [];
  const pid = String(product._id);

  // Per-colour galleries: replace only when a manifest was sent; an empty or
  // malformed manifest with no uploads keeps prior entries — unless it is a
  // LITERAL '[]', the form's explicit "I removed every per-colour photo".
  if (raw.colorImagesManifest !== undefined) {
    const parsed = input.parseColorImagesManifest(raw.colorImagesManifest, uploaded);
    const prior = Array.isArray(product.colorImages) ? product.colorImages : [];
    if (
      parsed.length === 0 &&
      uploaded.length === 0 &&
      prior.length > 0 &&
      !input.isExplicitEmptyArray(raw.colorImagesManifest)
    ) {
      logger.warn(
        { productId: pid, kept: prior.length },
        'product update: colorImages guardrail preserved prior entries',
      );
    } else {
      product.colorImages = parsed;
    }
  }

  if (raw.sizeChartImageManifest !== undefined) {
    const prior = product.sizeChartImage || '';
    const parsed = input.parseSizeChartImageManifest(raw.sizeChartImageManifest, uploaded);
    if (parsed !== null) {
      product.sizeChartImage = parsed;
      const action = parsed === '' ? 'cleared' : parsed === prior ? 'kept' : prior ? 'replaced' : 'added';
      logger.info({ productId: pid, action }, 'product update: sizeChartImage');
    } else {
      logger.warn({ productId: pid }, 'product update: sizeChartImage manifest malformed — prior value kept');
    }
  }

  if (raw.aPlusImagesManifest !== undefined) {
    product.aPlusImages = input.parseAPlusImagesManifest(raw.aPlusImagesManifest, uploaded);
    logger.info({ productId: pid, aPlusImages: product.aPlusImages }, 'product update: aPlusImages set');
  }

  const ordered = input.parseImageOrder(raw.imageOrder, uploaded);
  if (ordered) {
    product.images = ordered;
  } else if (raw.existingImages !== undefined) {
    product.images = [...input.parseExistingImages(raw.existingImages), ...uploaded];
  } else if (uploaded.length) {
    product.images = [...(product.images || []), ...uploaded];
  }

  /* ── STRICT guardrail ─────────────────────────────────────────────── */
  const finalImagesEmpty = !Array.isArray(product.images) || product.images.length === 0;
  const finalColorImagesEmpty =
    !Array.isArray(product.colorImages) ||
    !product.colorImages.some((entry) => Array.isArray(entry.images) && entry.images.length > 0);
  const noManifest = raw.imageOrder === undefined && raw.existingImages === undefined;
  const wipeAcknowledged = String(raw.imagesWipeAck || '') === '1';

  if (wipeAcknowledged && finalImagesEmpty && finalColorImagesEmpty) {
    // The ack is only valid when a real per-colour gallery remains.
    logger.warn(
      { productId: pid, priorImages: priorImages.length },
      'product update: REFUSED wipeAck — no gallery would remain; prior main gallery kept',
    );
    product.images = priorImages;
  } else if (priorImages.length > 0 && finalImagesEmpty && !wipeAcknowledged) {
    logger.warn(
      {
        productId: pid,
        priorImages: priorImages.length,
        uploaded: uploaded.length,
        finalColorImagesEmpty,
        imageOrder: raw.imageOrder,
        existingImages: raw.existingImages,
        noManifest,
      },
      'product update: STRICT guardrail fired — prior images preserved',
    );
    if (uploaded.length > 0) {
      // The manifest lost the kept URLs: prior + new, deduped in order.
      const seen = new Set();
      product.images = [...priorImages, ...uploaded].filter(
        (k) => typeof k === 'string' && k && !seen.has(k) && seen.add(k),
      );
    } else {
      product.images = priorImages;
    }
  } else if (
    priorImages.length > 0 &&
    noManifest &&
    uploaded.length > 0 &&
    !priorImages.every((k) => Array.isArray(product.images) && product.images.includes(k))
  ) {
    logger.warn(
      { productId: pid, priorImages: priorImages.length },
      'product update: no-manifest append re-prepended prior images',
    );
    product.images = [
      ...priorImages,
      ...(Array.isArray(product.images) ? product.images.filter((k) => !priorImages.includes(k)) : []),
    ];
  }

  /* ── MIRROR ───────────────────────────────────────────────────────── */
  // With per-colour blocks the form hides the main grid and legitimately
  // sends an empty gallery. Copy the first non-empty colour bucket into
  // `images` so the PDP's default gallery and card thumbnail still work.
  if (!Array.isArray(product.images) || product.images.length === 0) {
    const first = (Array.isArray(product.colorImages) ? product.colorImages : []).find(
      (e) => Array.isArray(e?.images) && e.images.length > 0,
    );
    if (first) {
      product.images = [...first.images];
      logger.info(
        { productId: pid, color: first.color, count: first.images.length },
        'product update: mirrored colour bucket into empty main gallery',
      );
    }
  }

  logger.info(
    {
      productId: pid,
      prior: priorImages.length,
      final: (product.images || []).length,
      uploaded: uploaded.length,
      imageOrder: raw.imageOrder !== undefined,
      existingImages: raw.existingImages !== undefined,
      wipeAck: wipeAcknowledged,
    },
    'product update: image audit',
  );

  // Tell the schema-level guard we checked — but only when a real
  // per-colour fallback exists; otherwise it may still restore prior images.
  const stillEmpty = !Array.isArray(product.images) || product.images.length === 0;
  product.$locals = product.$locals || {};
  product.$locals.imagesWipeAcknowledged = wipeAcknowledged && !stillEmpty;

  // Publish gate — an ACTIVE product carries at least one image; drafts stay exempt.
  if (product.status === 'active' && !hasAnyImage(product)) {
    throw AppError.badRequest(
      'Add at least one product image before publishing. Use "Save as draft" to keep working on it.',
    );
  }
}

module.exports = { applyCreateImages, assertCreateHasImage, applyUpdateImages };
