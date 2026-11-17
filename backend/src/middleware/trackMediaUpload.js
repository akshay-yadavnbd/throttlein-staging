/**
 * trackMediaUpload — best-effort post-multer middleware that records
 * every successful upload into the Media library.
 *
 * Add this AFTER `upload.single(...)` / `upload.array(...)` /
 * `upload.fields(...)` in any public upload route. KYC / evidence
 * routes deliberately don't include it because those uploads are
 * sensitive and shouldn't appear in the picker.
 *
 * Errors are swallowed — the upload itself has already landed in S3.
 * Tracking failure must not break the response the controller is
 * about to send.
 *
 * Idempotent — uses a unique-index upsert on `key`, so the same file
 * key never produces duplicate Media rows even when an endpoint
 * runs the same file through twice.
 */
const Media = require('../modules/media/media.model');
const { logger } = require('../utils/logger');
const { fromObjectKey } = require('../utils/s3KeyPrefix');

/** Decide whether a key belongs in the admin Media library.
 *
 * Excluded:
 *   - KYC documents (sellers/<slug>/kyc/...)
 *   - Return-request evidence (evidence/... or sellers/<slug>/evidence/...)
 *   - ALL seller uploads (anything under sellers/...) — the library is
 *     for admin / staff assets; we don't want a banner picker offering
 *     up a seller's product photo.
 */
function isAdminTrackable(key) {
  if (!key) return false;
  if (/\/kyc\//i.test(key)) return false;
  if (/(^|\/)evidence\//i.test(key)) return false;
  if (/^sellers\//i.test(key)) return false;
  return true;
}

/** Flatten any combination of req.file / req.files into a single array. */
function collectFiles(req) {
  const out = [];
  if (req.file) out.push(req.file);
  if (Array.isArray(req.files)) {
    out.push(...req.files);
  } else if (req.files && typeof req.files === 'object') {
    // upload.fields() shape — { fieldName: [files...] }
    for (const arr of Object.values(req.files)) {
      if (Array.isArray(arr)) out.push(...arr);
    }
  }
  return out;
}

module.exports = async function trackMediaUpload(req, _res, next) {
  const files = collectFiles(req);
  if (files.length === 0) return next();

  // Fire-and-forget. Use Promise.all so the upserts are concurrent
  // but the next handler can run in parallel without waiting on the
  // DB writes. We still await briefly so unit tests that depend on
  // tracking can observe the rows; in production this resolves in
  // <100ms so the overall request time is unaffected.
  try {
    await Promise.all(
      files.map(async (f) => {
        // multer-s3 reports the object key with the environment folder;
        // the library stores the bare key like every other reference.
        const key = f.key ? fromObjectKey(f.key) : f.filename ? `/uploads/${f.filename}` : '';
        if (!key || !isAdminTrackable(key)) return;
        const folder = key.includes('/') ? key.split('/').slice(0, -1).join('/') : '';
        try {
          await Media.findOneAndUpdate(
            { key },
            {
              $setOnInsert: {
                key,
                filename: f.originalname || '',
                mimeType: f.mimetype || '',
                size: typeof f.size === 'number' ? f.size : 0,
                folder,
                uploadedBy: req.user && req.user._id ? req.user._id : undefined,
              },
            },
            { upsert: true, returnDocument: 'before' },
          );
        } catch (err) {
          // Duplicate-key race or schema-validation failure — log + move on.
          logger.warn({ err }, '[trackMediaUpload] failed for %s', key);
        }
      }),
    );
  } catch {
    // Outer Promise.all rejection — should never happen because each
    // inner promise has its own catch, but guard anyway.
  }
  next();
};
