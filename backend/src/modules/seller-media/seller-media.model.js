/**
 * SellerMedia — per-seller media library.
 *
 * Mirrors the admin `Media` collection but scoped to a single seller.
 * Every SellerMedia doc is owned by exactly one seller (the `seller`
 * ObjectId ref) so a seller can only ever see / delete their own
 * uploads via /api/seller/media.
 *
 * Rows are created when a seller uploads through the /dashboard/media
 * library page. Product-embedded images (uploaded via the product
 * form or bulk CSV import) do NOT get a row here — they're
 * enumerated live from Product docs via /products/media/mine.
 *
 * The compound `{ seller, key }` unique index is defensive: our S3
 * key generator (`makeKey` in `middleware/upload.js`) already emits
 * globally-unique keys (timestamp + random suffix), but a mistaken
 * upload of the same key twice for one seller shouldn't produce a
 * duplicate row.
 */
const mongoose = require('mongoose');
const stripImageUrl = require('../../utils/stripImageUrl');

const sellerMediaSchema = new mongoose.Schema(
  {
    // Owning seller. Required — this collection makes no sense unscoped.
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // S3 key (or '/uploads/<filename>' in disk-mode). Setter strips any
    // legacy /api/files/ prefix or query string so the stored value is
    // always the bare key.
    key: {
      type: String,
      required: true,
      set: stripImageUrl,
    },
    // Original filename from the upload, e.g. 'jacket-front.png'.
    filename: { type: String, default: '' },
    // MIME type — used by the picker to filter to images vs PDFs etc.
    mimeType: { type: String, default: '' },
    // Size in bytes.
    size: { type: Number, default: 0 },
    // First segment(s) of the S3 key (e.g. 'sellers/acme/library'). Lets
    // the picker offer a folder filter.
    folder: { type: String, default: '', index: true },
  },
  { timestamps: true },
);

// Compound uniqueness — a single seller can't have duplicate key rows;
// two sellers COULD theoretically share a key (globally unique in
// practice, but we don't rely on it).
sellerMediaSchema.index({ seller: 1, key: 1 }, { unique: true });
// Sort feed: newest uploads first, scoped per seller.
sellerMediaSchema.index({ seller: 1, createdAt: -1 });

module.exports = mongoose.model('SellerMedia', sellerMediaSchema);
