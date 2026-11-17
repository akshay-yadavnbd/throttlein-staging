/**
 * Pure parsers for what the seller form posts. Multipart form-data sends
 * everything as strings (or repeated fields), so each field has one place
 * that turns it into the shape the Product schema stores.
 */
const { AppError } = require('../../errors/AppError');
const { GST_RATES, parseGstRate, parseHsn } = require('../../utils/gst');

const SELLER_STATUSES = ['active', 'draft', 'out_of_stock'];
const NUMERIC_FIELDS = ['price', 'mrp', 'stock', 'weightGrams', 'discountPercent', 'lengthCm', 'breadthCm', 'heightCm'];

/** Validate the optional `gstRate` / `hsn` inputs. Returns only the keys that were sent; throws 400 on bad values. */
function readTaxFields(src) {
  const out = {};
  if (src.gstRate !== undefined) {
    const rate = parseGstRate(src.gstRate);
    if (Number.isNaN(rate)) throw AppError.badRequest(`GST rate must be one of ${GST_RATES.join(', ')}%.`);
    if (rate !== undefined) out.gstRate = rate;
  }
  if (src.hsn !== undefined) {
    const hsn = parseHsn(src.hsn);
    if (hsn === null) throw AppError.badRequest('HSN code must be 4, 6 or 8 digits.');
    out.hsn = hsn;
  }
  return out;
}

/** JSON array string, repeated field, or plain string → array of trimmed strings. */
function parseSizes(raw) {
  if (raw === undefined || raw === null || raw === '') return [];
  if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean);
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.map((s) => String(s).trim()).filter(Boolean);
      } catch (_) {
        /* fall through */
      }
    }
    return trimmed ? [trimmed] : [];
  }
  return [];
}

/** A JSON array (string or value) → array, or null when absent / unparseable. */
function jsonArray(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

/**
 * The variants matrix the seller form posts as JSON:
 *   [{ size, color, stock, sku?, price?, mrp? }, …]
 * Trims text, coerces stock to a non-negative int, coerces the optional
 * price / mrp overrides to 2-decimal money or null (= inherit the product's
 * base value), drops empty rows, and dedupes by (size, color) — last wins.
 */
function parseVariants(raw) {
  const arr = jsonArray(raw);
  if (!arr) return [];
  const toMoney = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
  };
  const byKey = new Map();
  for (const entry of arr) {
    if (!entry || typeof entry !== 'object') continue;
    const size = String(entry.size || '').trim();
    const color = String(entry.color || '').trim();
    const sku = String(entry.sku || '').trim();
    let stock = Number(entry.stock);
    if (!Number.isFinite(stock) || stock < 0) stock = 0;
    stock = Math.floor(stock);
    if (!size && !color && stock === 0) continue;
    byKey.set(`${size}::${color}`, { size, color, stock, sku, price: toMoney(entry.price), mrp: toMoney(entry.mrp) });
  }
  return Array.from(byKey.values());
}

/** True when the client sent a LITERAL empty array — an intentional "clear this list". */
function isExplicitEmptyArray(raw) {
  if (Array.isArray(raw)) return raw.length === 0;
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('[')) return false;
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) && parsed.length === 0;
  } catch (_) {
    return false;
  }
}

/** `uploaded[i]` when `i` is a valid index to a non-empty URL, else ''. */
const stagedUrl = (uploaded, i) => {
  const pool = Array.isArray(uploaded) ? uploaded : [];
  const n = Number(i);
  return Number.isInteger(n) && n >= 0 && n < pool.length && typeof pool[n] === 'string' && pool[n].length
    ? pool[n]
    : '';
};

/**
 * Per-color image manifest `[{ color, kept: [url], staged: [index] }]`.
 * Staged indices point into the SAME uploaded list the main gallery uses.
 * Entries without a color or without images are dropped; duplicate colors
 * dedupe (last wins). Returns `[{ color, images }]`.
 */
function parseColorImagesManifest(raw, uploaded) {
  const arr = jsonArray(raw);
  if (!arr) return [];
  const byColor = new Map();
  for (const entry of arr) {
    if (!entry || typeof entry !== 'object') continue;
    const color = String(entry.color || '').trim();
    if (!color) continue;
    const kept = Array.isArray(entry.kept) ? entry.kept : [];
    const staged = Array.isArray(entry.staged) ? entry.staged : [];
    const images = [...kept, ...staged.map((i) => stagedUrl(uploaded, i))].filter(
      (s) => typeof s === 'string' && s.trim().length,
    );
    if (images.length === 0) continue;
    byColor.set(color, { color, images });
  }
  return Array.from(byColor.values());
}

/**
 * Size chart manifest `{ kept: string|null, staged: number|null }` → URL,
 * '' (explicit clear: both null) or null (malformed — caller preserves prior).
 */
function parseSizeChartImageManifest(raw, uploaded) {
  if (raw === undefined || raw === null || raw === '') return null;
  let obj = null;
  if (typeof raw === 'object' && !Array.isArray(raw)) obj = raw;
  else if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) obj = parsed;
    } catch (_) {
      return null;
    }
  }
  if (!obj) return null;
  if (typeof obj.kept === 'string' && obj.kept.trim().length) return obj.kept.trim();
  if (Number.isInteger(obj.staged)) {
    const url = stagedUrl(uploaded, obj.staged);
    if (url) return url;
  }
  if (obj.kept === null && obj.staged === null) return '';
  return null;
}

/**
 * A+ content manifest: up to 3 entries of `{ type:'kept', url }` or
 * `{ type:'staged', index }` → a length-3 array of URLs with '' for empty
 * slots, so slot positions stay stable.
 */
function parseAPlusImagesManifest(raw, uploaded) {
  const arr = jsonArray(raw);
  if (!arr) return ['', '', ''];
  const out = arr.slice(0, 3).map((entry) => {
    if (!entry || typeof entry !== 'object') return '';
    if (entry.type === 'kept' && typeof entry.url === 'string' && entry.url.trim().length) return entry.url.trim();
    if (entry.type === 'staged' && Number.isInteger(entry.index)) return stagedUrl(uploaded, entry.index);
    return '';
  });
  while (out.length < 3) out.push('');
  return out;
}

/**
 * Main-gallery order manifest `[{ type:'kept', url } | { type:'staged', index }]`
 * → ordered URL list, or null when the manifest is absent / malformed.
 */
function parseImageOrder(raw, uploaded) {
  if (raw === undefined) return null;
  const arr = jsonArray(raw);
  if (!arr) return null;
  return arr
    .map((item) => {
      if (!item) return null;
      if (item.type === 'staged' && Number.isInteger(item.index)) return stagedUrl(uploaded, item.index) || null;
      if (item.type === 'kept' && typeof item.url === 'string' && item.url.length) return item.url;
      return null;
    })
    .filter((s) => typeof s === 'string' && s.length);
}

/** Legacy `existingImages` array (JSON string or array) → string URLs; [] when malformed. */
function parseExistingImages(raw) {
  const arr = jsonArray(raw);
  return arr ? arr.filter((u) => typeof u === 'string') : [];
}

const slugify = (v) =>
  String(v || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Array, JSON array string or comma-separated string → lowercase slugs, deduped. */
function normalizeCities(raw) {
  if (raw === undefined || raw === null || raw === '') return [];
  let arr = [];
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) arr = parsed;
      } catch (_) {
        arr = trimmed.split(',');
      }
    } else arr = trimmed.split(',');
  }
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const slug = slugify(item);
    if (slug && !seen.has(slug)) {
      seen.add(slug);
      out.push(slug);
    }
  }
  return out;
}

/** Seller-selectable status, or undefined for anything else ('rejected' is admin-only). */
function sellerStatus(raw) {
  if (raw === undefined) return undefined;
  const s = String(raw).trim().toLowerCase();
  return SELLER_STATUSES.includes(s) ? s : undefined;
}

const toBool = (v) => v === true || v === 'true';

module.exports = {
  SELLER_STATUSES,
  NUMERIC_FIELDS,
  readTaxFields,
  parseSizes,
  parseVariants,
  isExplicitEmptyArray,
  parseColorImagesManifest,
  parseSizeChartImageManifest,
  parseAPlusImagesManifest,
  parseImageOrder,
  parseExistingImages,
  slugify,
  normalizeCities,
  sellerStatus,
  toBool,
};
