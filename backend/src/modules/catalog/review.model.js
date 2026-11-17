/**
 * Product review left by a customer who has purchased and received the
 * product. Each (product, customer) pair can hold only one review —
 * if a customer submits again, the existing record is updated. The
 * customer's source `order` is recorded so the eligibility check
 * (must be delivered, must contain this product) can be audited later.
 *
 * On every save, the parent Product's `rating` and `reviewsCount`
 * aggregates are recomputed from the live review set. The same happens
 * after a delete, so the storefront's listings stay in sync with the
 * actual review data without a nightly cron job.
 */

const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // The order that earned the customer the right to review. Soft ref
    // (not required by db lookups) because admin moderation may
    // re-attribute a review later.
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      default: null,
    },
    rating: { type: Number, min: 1, max: 5, required: true },
    title: { type: String, trim: true, maxlength: 120, default: '' },
    comment: { type: String, trim: true, maxlength: 2000, required: true },
    // Optional customer-uploaded photos of the product (stored the same
    // way as return-evidence uploads — bare S3 key or "/uploads/<file>"
    // disk path; resolved to a fetchable URL at render time via
    // upload.publicFileUrl() / the frontend's imageUrl() helper).
    images: { type: [String], default: [] },
  },
  { timestamps: true, statics: { recomputeProductAggregates } },
);

// One review per (product, customer). The upsert in the controller relies
// on this so a re-submission updates rather than duplicates.
reviewSchema.index({ product: 1, customer: 1 }, { unique: true });

/**
 * Recompute the parent Product's `rating` (avg) and `reviewsCount`. Pulled
 * out as a static so both Mongoose middleware AND the controller's
 * findOneAndUpdate path can use it (findOneAndUpdate doesn't fire `save`
 * middleware, which would otherwise leave aggregates stale).
 */
async function recomputeProductAggregates(productId) {
  const Review = mongoose.model('Review');
  const Product = mongoose.model('Product');
  const reviews = await Review.find({ product: productId }, 'rating');
  const count = reviews.length;
  const avg = count > 0 ? reviews.reduce((s, r) => s + r.rating, 0) / count : 0;
  await Product.updateOne({ _id: productId }, { $set: { rating: +avg.toFixed(2), reviewsCount: count } });
}

reviewSchema.post('save', async function () {
  await recomputeProductAggregates(this.product);
});

// post('remove') doesn't fire for findOneAndDelete; cover both.
async function handleDelete(doc) {
  if (doc) await recomputeProductAggregates(doc.product);
}
reviewSchema.post('findOneAndDelete', handleDelete);
reviewSchema.post('deleteOne', { document: true, query: false }, function () {
  recomputeProductAggregates(this.product);
});

module.exports = mongoose.model('Review', reviewSchema);
