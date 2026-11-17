/**
 * Which image represents a product on a card: the listing colour's first
 * photo, else the main gallery, else any colour bucket.
 */
function firstColorImage(product, preferredColor = '') {
  const entries = Array.isArray(product?.colorImages) ? product.colorImages : [];
  const pick = (entry) => {
    const imgs = Array.isArray(entry?.images) ? entry.images : [];
    return imgs.find((img) => typeof img === 'string' && img.length) || '';
  };
  if (preferredColor) {
    const img = pick(entries.find((entry) => String(entry?.color || '') === preferredColor));
    if (img) return img;
  }
  for (const entry of entries) {
    const img = pick(entry);
    if (img) return img;
  }
  return '';
}

function listingImageFor(product) {
  if (product?.listingColor) {
    const selected = firstColorImage(product, product.listingColor);
    if (selected) return selected;
  }
  const imgs = Array.isArray(product?.images) ? product.images : [];
  return imgs.find((img) => typeof img === 'string' && img.length) || firstColorImage(product);
}

/** Plain object copy of the product with `listingImage` attached. */
function withListingImage(product) {
  const obj = product && typeof product.toObject === 'function' ? product.toObject() : { ...product };
  obj.listingImage = listingImageFor(obj);
  return obj;
}

/** True when the product has at least one photo in the main gallery or any colour bucket. */
function hasAnyImage(product) {
  return (
    (Array.isArray(product.images) && product.images.length > 0) ||
    (Array.isArray(product.colorImages) &&
      product.colorImages.some((c) => Array.isArray(c?.images) && c.images.length > 0))
  );
}

module.exports = { firstColorImage, listingImageFor, withListingImage, hasAnyImage };
