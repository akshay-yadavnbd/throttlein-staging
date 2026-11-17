/**
 * The admin media library behind the picker in every image-uploading admin
 * form. Seller uploads, KYC documents and return evidence are never listed:
 * they are someone's private files, not library assets.
 *
 * Deleting a file also removes the stored object (best-effort: the row goes
 * either way, so the library never lists a missing file) and clears the key
 * from every model that used it, so banners, promo blocks and products do
 * not keep rendering a broken image.
 */
const upload = require('../../middleware/upload');
const { env } = require('../../config/env');
const { AppError } = require('../../errors/AppError');
const { logger } = require('../../utils/logger');
const escapeRegExp = require('../../utils/escapeRegExp');
const { cascadeMediaDelete } = require('../../utils/cascadeMediaDelete');
const media = require('./media.repository');

/**
 * Keys that are not admin assets. `$nor` with positive regexes rather than
 * `{ $not: regex }`, which behaves inconsistently across driver versions.
 */
const NOT_ADMIN = {
  $nor: [
    { key: { $regex: '^sellers/', $options: 'i' } }, // seller uploads
    { key: { $regex: '/kyc/', $options: 'i' } }, // KYC documents
    { key: { $regex: '(^|/)evidence/', $options: 'i' } }, // return-request evidence
  ],
};

/**
 * A `publicFileUrl()` result the admin's <img> can load from another origin:
 * disk-mode `/uploads/…` paths get the backend origin (PUBLIC_API_URL in
 * production, localhost in dev); absolute URLs pass through.
 */
function absolutize(url) {
  if (!url) return url;
  if (/^https?:\/\//i.test(url) || url.startsWith('data:')) return url;
  if (!url.startsWith('/uploads/')) return url;
  const origin = env.PUBLIC_API_URL
    ? String(env.PUBLIC_API_URL)
        .replace(/\/api\/?$/i, '')
        .replace(/\/+$/, '')
    : `http://localhost:${env.PORT || 5000}`;
  return `${origin}${url}`;
}
const urlOf = (key) => absolutize(upload.publicFileUrl(key));

async function list(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(120, Math.max(1, parseInt(query.limit, 10) || 36));
  const search = String(query.q || '').trim();
  const folder = String(query.folder || '').trim();
  /** @type {object[]} */
  const clauses = [NOT_ADMIN];
  if (search) {
    const re = new RegExp(escapeRegExp(search), 'i');
    clauses.push({ $or: [{ filename: re }, { key: re }] });
  }
  if (folder) clauses.push({ folder });
  const filter = clauses.length === 1 ? clauses[0] : { $and: clauses };
  const [docs, total] = await media.page(filter, { skip: (page - 1) * limit, limit });
  const items = docs.map((d) => ({ ...d.toObject(), url: urlOf(d.key) }));
  return { items, page, limit, total };
}

/** Folders for the picker's filter — the same exclusions, so it never offers `sellers/…`. */
async function folders() {
  return { folders: (await media.folders(NOT_ADMIN)).filter(Boolean).sort() };
}

/** Files multer already stored (and trackMediaUpload already recorded) → what the picker shows. */
function uploaded(files) {
  if (!files.length) throw AppError.badRequest('No files uploaded');
  return {
    items: files.map((f) => {
      const key = upload.fileToUrl(f);
      return {
        key,
        url: urlOf(key),
        filename: f.originalname || '',
        size: typeof f.size === 'number' ? f.size : 0,
        mimeType: f.mimetype || '',
      };
    }),
  };
}

/** Up to 500 at a time so a runaway client cannot hammer the bucket; one storage failure does not block the rest. */
async function bulkRemove(ids) {
  const list = Array.isArray(ids) ? ids : [];
  if (list.length === 0) throw AppError.badRequest('ids array is required');
  if (list.length > 500) throw AppError.badRequest('Max 500 ids per bulk delete');
  const docs = await media.findMany(list);
  const keys = docs.map((d) => d.key).filter(Boolean);
  await Promise.allSettled(
    docs.map((d) =>
      upload.deleteKey(d.key).catch((err) => {
        logger.warn({ err }, '[media.bulkRemove] storage delete failed for %s', d.key);
      }),
    ),
  );
  const result = await media.deleteMany(list);
  await cascadeMediaDelete(keys);
  return { deleted: result.deletedCount || 0, requested: list.length };
}

async function remove(id) {
  const m = await media.findById(id);
  if (!m) throw AppError.notFound('Media not found');
  const { key } = m;
  try {
    await upload.deleteKey(key);
  } catch (err) {
    logger.warn({ err }, '[media.remove] storage delete failed:');
  }
  await m.deleteOne();
  if (key) await cascadeMediaDelete([key]);
}

module.exports = { list, folders, uploaded, bulkRemove, remove };
