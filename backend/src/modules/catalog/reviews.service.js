/**
 * Purchase-verified product reviews. A customer may review a product only
 * after an order containing it has been delivered to them; one review per
 * (product, customer), edited in place. The product's average rating and
 * review count are recomputed after every write.
 */
const { AppError } = require('../../errors/AppError');
const reviews = require('./reviews.repository');

const MAX_IMAGES = 6;

async function upsert(customer, body) {
  const { productId, orderId, rating, title, comment, images } = body || {};
  if (!productId) throw AppError.badRequest('productId is required');
  if (!comment || !String(comment).trim()) throw AppError.badRequest('Please add a comment for your review');
  const stars = Number(rating);
  if (!Number.isFinite(stars) || stars < 1 || stars > 5) throw AppError.badRequest('Rating must be between 1 and 5');

  const order = await reviews.deliveredOrderWith(customer._id, productId, orderId);
  if (!order) throw AppError.forbidden("You can only review products you've purchased and received.");

  const review = await reviews.upsert(productId, customer._id, {
    product: productId,
    customer: customer._id,
    order: order._id,
    rating: stars,
    title: (title || '').trim(),
    comment: String(comment).trim(),
    images: Array.isArray(images) ? images.filter((u) => typeof u === 'string' && u).slice(0, MAX_IMAGES) : [],
  });
  await reviews.recomputeProductAggregates(productId);
  return { review };
}

/** The caller's reviews for the products in one of their orders ("Edit review" vs "Leave a review"). */
async function mineForOrder(customer, orderId) {
  if (!orderId) throw AppError.badRequest('orderId is required');
  const order = await reviews.customerOrderItems(orderId, customer._id);
  if (!order) throw AppError.notFound('Order not found');
  const productIds = (order.items || []).map((i) => i.product).filter(Boolean);
  return { reviews: await reviews.byCustomerForProducts(customer._id, productIds) };
}

/** Whether the caller may review the product, and their existing review if any (the PDP hides the CTA otherwise). */
async function eligibility(customer, productId) {
  if (!productId) throw AppError.badRequest('productId is required');
  const [order, existingReview] = await Promise.all([
    reviews.deliveredOrderWith(customer._id, productId),
    reviews.byCustomerForProduct(customer._id, productId),
  ]);
  return { eligible: !!order, existingReview: existingReview || null };
}

async function removeOwn(customer, productId) {
  const deleted = await reviews.deleteOwn(productId, customer._id);
  if (!deleted) throw AppError.notFound('Review not found');
}

/** Public list: the 50 newest plus an exact 1–5 star distribution over up to 500 reviews. */
async function forProduct(slug) {
  const product = await reviews.productBySlug(slug);
  if (!product) throw AppError.notFound('Product not found');
  const all = await reviews.publicForProduct(product._id);
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of all) if (distribution[r.rating] !== undefined) distribution[r.rating] += 1;
  return { reviews: all.slice(0, 50), total: all.length, distribution, average: product.rating || 0 };
}

module.exports = { upsert, mineForOrder, eligibility, removeOwn, forProduct };
