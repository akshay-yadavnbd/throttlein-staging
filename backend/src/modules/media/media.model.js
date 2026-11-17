/**
 * Media — central catalogue of every uploaded asset.
 *
 * Every successful upload through the standard multer pipeline gets
 * a row in this collection (via the trackMediaUpload middleware).
 * The admin Media Library reads from here so the team can re-use
 * an existing asset instead of re-uploading it.
 *
 * Indexed on `key` (unique) so the same S3 object is never tracked
 * twice — re-running the backfill is safe.
 *
 * `folder` is the prefix of the S3 key (everything before the last
 * slash) and is denormalised here so the picker can filter by it
 * cheaply without scanning the key text.
 *
 * Private uploads (KYC docs, return-request evidence) are explicitly
 * NOT tracked — see the path filter in `middleware/trackMediaUpload.js`.
 */
const mongoose = require('mongoose');
const stripImageUrl = require('../../utils/stripImageUrl');

const mediaSchema = new mongoose.Schema(
  {
    // S3 key (or '/uploads/<filename>' in disk-mode). Setter strips
    // any legacy /api/files/ prefix or query string so the stored
    // value is always the bare key.
    key: {
      type: String,
      required: true,
      unique: true,
      set: stripImageUrl,
    },
    // Original filename from the upload, e.g. 'jacket-front.png'.
    // Useful as a display label and for search.
    filename: { type: String, default: '' },
    // MIME type — used by the picker to filter to images vs PDFs etc.
    mimeType: { type: String, default: '' },
    // Size in bytes.
    size: { type: Number, default: 0 },
    // First segment(s) of the S3 key (e.g. 'banners', 'products',
    // 'sellers/acme/products'). Lets the picker offer a folder filter.
    folder: { type: String, default: '', index: true },
    // Free-form tags. Admins can use these to group assets across
    // folders (e.g. 'hero', 'jacket', 'monsoon-sale').
    tags: { type: [String], default: [] },
    // Who uploaded it. May be empty on backfilled records.
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

// Sort feed: newest uploads first.
mediaSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Media', mediaSchema);
