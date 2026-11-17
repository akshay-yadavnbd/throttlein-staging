/**
 * The seller dashboard's media library (/dashboard/media). Every query is
 * scoped to the signed-in seller, so a crafted id or key never reaches
 * another seller's files or reveals their products.
 *
 * Deleting a file that one of the seller's products still shows is BLOCKED:
 * a single delete answers `IN_USE` with the products (the Media page
 * branches on that code), a bulk delete skips it and lists it as blocked.
 */
const upload = require('../../middleware/upload');
const { env } = require('../../config/env');
const { AppError } = require('../../errors/AppError');
const { logger } = require('../../utils/logger');
const escapeRegExp = require('../../utils/escapeRegExp');
const media = require('./seller-media.repository');

const SEVEN_DAYS = 7 * 24 * 3600; // the longest expiry AWS SigV4 accepts on a presigned URL

/** Disk-mode `/uploads/…` paths get the backend origin (the dashboard runs on another port in dev). */
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

/** Everything before the last '/' of a key. */
function folderOf(key) {
  if (!key || typeof key !== 'string') return '';
  const i = key.lastIndexOf('/');
  return i === -1 ? '' : key.slice(0, i);
}

/** key → the seller's products ({ _id, name, slug }) still showing it: gallery, a colour gallery or the size chart. */
async function productsByKey(sellerId, keys) {
  const inUse = new Map();
  if (!keys.length) return inUse;
  const keySet = new Set(keys);
  for (const p of await media.productsUsing(sellerId, keys)) {
    const info = { _id: p._id, name: p.name, slug: p.slug };
    const found = new Set(
      [
        ...(p.images || []),
        ...(p.colorImages || []).flatMap((ci) => (ci && ci.images) || []),
        ...(p.sizeChartImage ? [p.sizeChartImage] : []),
      ].filter((k) => keySet.has(k)),
    );
    for (const k of found) {
      if (!inUse.has(k)) inUse.set(k, []);
      inUse.get(k).push(info);
    }
  }
  return inUse;
}

async function list(sellerId, query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 48));
  const search = String(query.q || '').trim();
  const folder = String(query.folder || '').trim();
  /** @type {object[]} */
  const clauses = [{ seller: sellerId }];
  if (search) {
    const re = new RegExp(escapeRegExp(search), 'i');
    clauses.push({ $or: [{ filename: re }, { key: re }] });
  }
  if (folder) clauses.push({ folder });
  const filter = clauses.length === 1 ? clauses[0] : { $and: clauses };

  const [[docs, total], allFolders] = await Promise.all([
    media.page(filter, { skip: (page - 1) * limit, limit }),
    media.folders(sellerId),
  ]);
  const items = docs.map((d) => ({ ...d.toObject(), url: urlOf(d.key) }));
  return { items, folders: allFolders.filter(Boolean).sort(), page, limit, total };
}

/**
 * Files already stored by multer under the seller-scoped prefix → library rows.
 * The admin library's tracker deliberately skips seller uploads, so the rows
 * are written here. A row that fails to record is logged and left out.
 */
async function recordUploads(sellerId, files) {
  if (!files.length) throw AppError.badRequest('No files uploaded');
  const items = [];
  for (const f of files) {
    const key = upload.fileToUrl(f);
    if (!key) continue;
    const doc = {
      seller: sellerId,
      key,
      filename: f.originalname || '',
      mimeType: f.mimetype || '',
      size: typeof f.size === 'number' ? f.size : 0,
      folder: folderOf(key),
    };
    try {
      const row = await media.record(sellerId, key, doc);
      items.push({
        _id: row._id,
        key: row.key,
        url: urlOf(row.key),
        filename: row.filename,
        size: row.size,
        mimeType: row.mimeType,
      });
    } catch (err) {
      logger.warn({ err }, '[sellerMedia.upload] failed to record %s', key);
    }
  }
  return { items };
}

/** Storage cleanup is best-effort: the row goes either way, so the library never lists a missing file. */
function deleteStored(key, where) {
  return upload
    .deleteKey(key)
    .catch((err) => logger.warn({ err }, `[sellerMedia.${where}] storage delete failed for %s`, key));
}

async function remove(sellerId, id) {
  const m = await media.findOwn(id, sellerId);
  if (!m) throw AppError.notFound('Media not found');
  const products = (await productsByKey(sellerId, [m.key])).get(m.key) || [];
  if (products.length) {
    throw new AppError(
      'IN_USE',
      `Used by ${products.length} product${products.length === 1 ? '' : 's'} · remove it in the product editor first`,
      { products },
      { status: 400 },
    );
  }
  await deleteStored(m.key, 'remove');
  await m.deleteOne();
}

async function bulkRemove(sellerId, ids) {
  const list = Array.isArray(ids) ? ids : [];
  if (list.length === 0) throw AppError.badRequest('ids array is required');
  if (list.length > 500) throw AppError.badRequest('Max 500 ids per bulk delete');
  const docs = await media.findOwnMany(list, sellerId);
  if (docs.length === 0) return { deleted: 0, blocked: [], requested: list.length };

  const inUse = await productsByKey(sellerId, docs.map((d) => d.key).filter(Boolean));
  const blocked = [];
  const deletable = [];
  for (const d of docs) {
    if (inUse.has(d.key))
      blocked.push({ id: String(d._id), key: d.key, productNames: inUse.get(d.key).map((p) => p.name) });
    else deletable.push(d);
  }
  if (deletable.length) {
    await Promise.allSettled(deletable.map((d) => deleteStored(d.key, 'bulkRemove')));
    await media.deleteOwnMany(
      deletable.map((d) => d._id),
      sellerId,
    );
  }
  return { deleted: deletable.length, blocked, requested: list.length };
}

/**
 * A 7-day presigned URL for one of the seller's own images ("Copy URL": it
 * works in WhatsApp, emails and marketing tools without our backend). The
 * seller owns the key when a library row or one of their products carries it.
 */
async function presign(sellerId, rawKey) {
  const raw = String(rawKey || '').trim();
  if (!raw) throw AppError.badRequest('key is required');
  // Tolerate a pasted absolute URL or /api/files/ proxy path.
  const key = raw
    .replace(/^https?:\/\/[^/]+\//i, '')
    .replace(/^\/+/, '')
    .replace(/^api\/files\//, '')
    .split('?')[0];
  if (!key) throw AppError.badRequest('key is malformed');
  const owned = (await media.ownsKey(sellerId, key)) || (await media.productUsingKey(sellerId, key));
  if (!owned) throw AppError.forbidden('You do not own this image.');
  return { key, url: await upload.presignPublicKey(key, SEVEN_DAYS), expiresIn: SEVEN_DAYS };
}

module.exports = { list, recordUploads, remove, bulkRemove, presign };
