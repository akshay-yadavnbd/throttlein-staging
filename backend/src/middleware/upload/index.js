/**
 * Multer middleware for product image uploads, plus the helpers used
 * elsewhere to convert stored references into URLs that browsers can fetch.
 *
 * Storage modes (chosen at boot):
 *   - S3:   when AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION /
 *           S3_BUCKET_NAME are all set in .env (and DISABLE_S3 isn't set).
 *           `req.files[i].key` holds the S3 object key, `req.files[i].location`
 *           the raw S3 URL.
 *   - Disk: fallback when any of the above is missing. Files land in
 *           ./uploads/ and `req.files[i].filename` holds the name.
 *
 * URL strategy:
 *   - S3 mode  → store the bare object key in the DB (e.g. "products/123-foo.png").
 *                Serializers later call `presignKey()` to mint a short-lived
 *                presigned URL when an API response is built. Bucket stays
 *                private; the URL exposed to clients has the same shape as
 *                "...amazonaws.com/<key>?X-Amz-Signature=..." (nwatch-style).
 *   - Disk mode → store "/uploads/<filename>" and let the existing static
 *                file middleware serve it. No signing needed.
 *
 * Use `upload.fileToUrl(f)` at the upload site to convert the multer-file
 * object to whatever string should be stored in the DB. Use
 * `upload.presignKey(key)` at serialization time to convert a stored S3 key
 * to a fetchable URL.
 */
const path = require('path');
const multer = require('multer');
const { env } = require('../../config/env');
const { AppError } = require('../../errors/AppError');
const { storage, s3Client, useS3 } = require('./storage');
const { resolveKeyPrefix, setUploadPrefix, normaliseToKey, isPrivatePrefix } = require('./keys');
const files = require('./files');
const { guardParsers } = require('./guards');

const fileFilter = (req, file, cb) => {
  const extension = path.extname(file.originalname).toLowerCase();
  const types = {
    '.png': ['image/png'],
    '.jpg': ['image/jpeg'],
    '.jpeg': ['image/jpeg'],
    '.webp': ['image/webp'],
    '.gif': ['image/gif'],
    '.avif': ['image/avif'],
    '.pdf': ['application/pdf'],
    '.mp4': ['video/mp4'],
    '.mov': ['video/quicktime'],
    '.webm': ['video/webm'],
    '.3gp': ['video/3gpp'],
    '.csv': ['text/csv', 'application/vnd.ms-excel'],
    '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'],
  };
  const isSheet = ['csv', 'xlsx'].includes(file.fieldname) && req.path === '/import';
  const privatePurpose = isPrivatePrefix(resolveKeyPrefix(req));
  const allowed =
    types[extension]?.includes(file.mimetype) &&
    (isSheet || !['.csv', '.xlsx'].includes(extension)) &&
    (privatePurpose || extension !== '.pdf');
  // SVG is active XML and cannot be accepted as a public upload without sanitization.
  if (!allowed) return cb(AppError.badRequest('Unsupported file type or extension.'));
  cb(null, true);
};

const maxBytes = (Number(env.MAX_FILE_SIZE_MB) || 5) * 1024 * 1024;
const evidenceMaxBytes = (Number(env.MAX_VIDEO_SIZE_MB) || 50) * 1024 * 1024;

// One Object.assign (not property-by-property) so the type checker sees the extras.
const upload = Object.assign(
  multer({
    storage,
    fileFilter,
    limits: { fileSize: maxBytes, fields: 150, fieldSize: 1024 * 1024, parts: 2200 },
  }),
  {
    evidence: multer({
      storage,
      fileFilter,
      limits: { fileSize: evidenceMaxBytes, files: 6, fields: 50, parts: 60 },
    }),
    // Make the S3 client available to other modules (the response serializer
    // needs it for presigning) and a flag callers can check.
    s3Client,
    usingS3: useS3,
    ...files,
    normaliseToKey,
    // Re-export for routes that want to opt into a non-default prefix.
    setUploadPrefix,
  },
);

guardParsers([upload, upload.evidence]);

module.exports = upload;
