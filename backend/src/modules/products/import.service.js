/**
 * Bulk import from a CSV / XLSX plus optional photos. Rows match an existing
 * product by `id`, then `sku`, then (name + category) within this seller;
 * otherwise they create one. Each row succeeds or fails on its own.
 */
const mongoose = require('mongoose');
const { AppError } = require('../../errors/AppError');
const { env } = require('../../config/env');
const { logger } = require('../../utils/logger');
const upload = require('../../middleware/upload');
const products = require('./products.repository');
const catalog = require('./catalog.repository');
const csv = require('./csv-format');
const input = require('./product-input');
const { hasAnyImage } = require('./listing-image');
const { MAX_PRICE, MAX_PRICE_LABEL } = require('./price-limit');

/**
 * The uploaded sheet's bytes across all three multer backends: memory
 * (buffer), disk (path) and S3 (key → GetObject).
 */
async function readUploadedBytes(file) {
  try {
    if (file.buffer && file.buffer.length) return file.buffer;
    if (file.path) return require('node:fs').readFileSync(file.path);
    if (file.key && upload.s3Client) {
      const { GetObjectCommand } = require('@aws-sdk/client-s3');
      const s3Res = await upload.s3Client.send(new GetObjectCommand({ Bucket: env.S3_BUCKET_NAME, Key: file.key }));
      const chunks = [];
      for await (const chunk of s3Res.Body) chunks.push(chunk);
      return Buffer.concat(chunks);
    }
    throw new Error(
      'Uploaded file has no readable source (no buffer, path, or S3 key). This usually means the upload middleware misconfigured storage.',
    );
  } catch (e) {
    throw AppError.badRequest(`Couldn't read uploaded file: ${e.message}`);
  }
}

/** Bike-tree helpers over the cached category list (no per-row queries). */
function bikeResolver(allCategories) {
  const shopByBike = allCategories.find((c) => c.parent === null && c.name === 'Shop by Bike');
  const byId = (id) => allCategories.find((c) => c._id.equals(id));
  function isInBikeTree(catId) {
    if (!shopByBike) return false;
    let cur = allCategories.find((c) => c._id.toString() === catId.toString());
    while (cur) {
      if (cur._id.equals(shopByBike._id)) return true;
      if (!cur.parent) return false;
      cur = byId(cur.parent);
    }
    return false;
  }
  /**
   * "Classic 350", "Royal Enfield > Classic 350", "Royal Enfield/Classic 350"
   * (case-insensitive) → the bike category, or a helpful error with suggestions.
   */
  function resolveBike(raw) {
    if (!shopByBike) throw new Error('"Shop by Bike" tree not configured — admin must seed it first');
    const parts = String(raw)
      .split(/\s*[>/|]\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    const bikeCats = allCategories.filter((c) => isInBikeTree(c._id) && !c._id.equals(shopByBike._id));
    const leafName = parts[parts.length - 1].toLowerCase();
    let matches = bikeCats.filter((c) => c.name.toLowerCase() === leafName);
    if (matches.length > 1 && parts.length >= 2) {
      const makeName = parts[parts.length - 2].toLowerCase();
      matches = matches.filter((c) => byId(c.parent)?.name.toLowerCase() === makeName);
    }
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      const paths = matches.slice(0, 3).map((c) => `"${byId(c.parent)?.name || ''} > ${c.name}"`);
      throw new Error(`bike "${raw}" matches multiple models — be more specific (e.g. ${paths.join(', ')})`);
    }
    const suggestions = bikeCats
      .filter((c) => c.name.toLowerCase().includes(leafName))
      .slice(0, 3)
      .map((c) => `"${c.name}"`);
    throw new Error(
      `bike "${raw}" not found under Shop by Bike.${suggestions.length ? ` Did you mean ${suggestions.join(' / ')}?` : ''}`,
    );
  }
  return { isInBikeTree, resolveBike };
}

const optionalNumber = (v) => (v !== '' && v != null ? Number(v) : undefined);
const setIfNumber = (product, key, value) => {
  if (value !== undefined && !Number.isNaN(value)) product[key] = value;
};

/** One sheet row → a saved product. Throws a sentence for the row's error column. */
async function importRow(r, ctx) {
  const { sellerId, catByName, brandByName, imageUrlByName, bikes } = ctx;
  const name = String(r.name || '').trim();
  if (!name) throw new Error('name is required');
  const categoryName = String(r.category || '')
    .trim()
    .toLowerCase();
  if (!categoryName) throw new Error('category is required');
  const category = catByName.get(categoryName);
  if (!category) throw new Error(`category "${r.category}" not found in admin`);
  if (bikes.isInBikeTree(category._id)) throw new Error('category is a bike model — pick a product category');
  const brandName = String(r.brand || '')
    .trim()
    .toLowerCase();
  const brand = brandName ? brandByName.get(brandName) : null;
  if (brandName && !brand) throw new Error(`brand "${r.brand}" not found in admin`);
  const bikeRaw = String(r.bike || '').trim();
  const bike = bikeRaw ? bikes.resolveBike(bikeRaw) : null;

  const price = Number(r.price);
  if (!Number.isFinite(price) || price < 0) throw new Error('price must be a number ≥ 0');
  if (price > MAX_PRICE) throw new Error(`price must be at most ${MAX_PRICE} (${MAX_PRICE_LABEL})`);
  const taxFields = input.readTaxFields({
    ...(r.gstRate != null ? { gstRate: r.gstRate } : {}),
    ...(r.hsn != null && String(r.hsn).trim() ? { hsn: r.hsn } : {}),
  });
  const variants = csv.parseVariantsCell(r.variants);
  const colorImagesResult = csv.parseColorImagesCell(r.colorImages, imageUrlByName);
  const colorImages = colorImagesResult.colorImages;
  // Every variant colour needs a gallery when both columns are used.
  if (variants.length > 0 && colorImages.length > 0) {
    const imageColors = new Set(colorImages.map((c) => c.color));
    const missing = [...new Set(variants.map((v) => (v.color || '').trim()).filter(Boolean))].filter(
      (c) => !imageColors.has(c),
    );
    if (missing.length > 0) throw new Error(`variant colour(s) missing from colorImages: ${missing.join(', ')}`);
  }
  const listingColor = String(r.listingColor || '').trim();
  if (listingColor && variants.length > 0 && !new Set(variants.map((v) => (v.color || '').trim())).has(listingColor)) {
    throw new Error(`listingColor "${listingColor}" doesn't match any variant colour`);
  }
  const sku = String(r.sku || '').trim();
  const { images, unresolved } = csv.parseImagesCell(r.images, imageUrlByName);

  // Upsert lookup, most reliable first: id (exported sheets) → sku → name + category.
  let product = null;
  const rowId = String(r.id || r._id || '').trim();
  if (rowId && mongoose.isValidObjectId(rowId)) product = await products.findOwned(rowId, sellerId);
  if (!product && sku) product = await products.findOwnedBySku(sellerId, sku);
  if (!product) product = await products.findOwnedByNameInCategory(sellerId, name, category._id);
  const isUpdate = !!product;
  if (!product) product = products.newProduct({ seller: sellerId });

  product.name = name;
  if (sku) product.sku = sku;
  product.category = category._id;
  product.brand = brand ? brand._id : null;
  product.bike = bike ? bike._id : null;
  product.price = price;
  setIfNumber(product, 'mrp', r.mrp ? Number(r.mrp) : undefined);
  // Variant-aware stock: the matrix sums to the top-level stock.
  if (variants.length > 0) {
    product.set('variants', variants);
    product.stock = variants.reduce((s, v) => s + (Number(v.stock) || 0), 0);
    product.sizes = [...new Set(variants.map((v) => v.size).filter(Boolean))];
  } else {
    const stock = r.stock ? Number(r.stock) : 0;
    product.stock = Number.isFinite(stock) ? stock : 0;
    product.sizes = String(r.sizes || '')
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  setIfNumber(product, 'weightGrams', r.weightGrams ? Number(r.weightGrams) : undefined);
  // Parcel dimensions: undefined leaves the schema default / stored value alone.
  setIfNumber(product, 'lengthCm', optionalNumber(r.lengthCm));
  setIfNumber(product, 'breadthCm', optionalNumber(r.breadthCm));
  setIfNumber(product, 'heightCm', optionalNumber(r.heightCm));
  Object.assign(product, taxFields);
  product.color = String(r.color || '').trim();
  if (listingColor) product.listingColor = listingColor;
  if (colorImages.length > 0) product.set('colorImages', colorImages);
  product.set('status', input.sellerStatus(r.status) || 'active');
  product.isFeatured =
    String(r.isFeatured || '')
      .trim()
      .toLowerCase() === 'true';
  product.description = String(r.description || '').trim();
  if (images.length) product.images = images;

  // Draft gate: a row that would go live without any image is saved as a draft.
  let draftedNoImages = false;
  if (product.status === 'active' && !hasAnyImage(product)) {
    product.status = 'draft';
    draftedNoImages = true;
  }
  await product.save();

  const warnings = [];
  if (draftedNoImages) warnings.push('no images — saved as draft (add photos, then publish)');
  const allUnresolved = [...unresolved, ...colorImagesResult.unresolved];
  if (allUnresolved.length)
    warnings.push(`${allUnresolved.length} image(s) couldn't be matched: ${allUnresolved.join(', ')}`);
  return { name, isUpdate, draftedNoImages, warning: warnings.join('; ') };
}

/**
 * POST /api/products/import. `files` is multer's `.fields()` output: one
 * data file under `csv` or `xlsx`, photos under `images`. Returns
 * `{ summary, results }`.
 */
async function importBulk(user, files) {
  if (user.role === 'seller' && (user.kyc?.status !== 'approved' || user.status !== 'approved')) {
    throw AppError.forbidden('Your account must be fully approved before importing products.');
  }
  const csvFile = files?.csv?.[0] || null;
  const xlsxFile = files?.xlsx?.[0] || null;
  const dataFile = csvFile || xlsxFile;
  if (!dataFile) throw AppError.badRequest('Upload a spreadsheet (field name "csv" or "xlsx").');
  // Detect XLSX by field, extension or mime — a renamed file still parses.
  const isXlsx =
    !!xlsxFile ||
    /\.xlsx$/i.test(dataFile.originalname || '') ||
    new RegExp(`^${csv.XLSX_MIME.replace(/[.+]/g, '\\$&')}`).test(dataFile.mimetype || '');

  // basename → URL for every uploaded photo, lowercased (Windows paths).
  const imageUrlByName = new Map();
  for (const f of files?.images || []) {
    const base = String(f.originalname || '')
      .split(/[\\/]/)
      .pop()
      .toLowerCase();
    if (base) imageUrlByName.set(base, upload.fileToUrl(f));
  }

  const bytes = await readUploadedBytes(dataFile);
  let records;
  try {
    records = csv.parseSheet(bytes, { xlsx: isXlsx });
  } catch (e) {
    throw AppError.badRequest(`Couldn't parse ${isXlsx ? 'XLSX' : 'CSV'}: ${e.message}`);
  }
  // The sheet is a throwaway parse artifact — clean it up, never block on it.
  if (dataFile.key || dataFile.filename) {
    upload
      .deleteKey(dataFile.key || `/uploads/${dataFile.filename}`)
      .catch((err) => logger.warn({ err }, 'product import: failed to clean up temp upload'));
  }

  const allCategories = await catalog.allCategoriesForImport();
  const allBrands = await catalog.allBrandsForImport();
  const ctx = {
    sellerId: user._id,
    catByName: new Map(allCategories.map((c) => [c.name.toLowerCase(), c])),
    brandByName: new Map(allBrands.map((b) => [b.name.toLowerCase(), b])),
    imageUrlByName,
    bikes: bikeResolver(allCategories),
  };

  const results = [];
  let created = 0,
    updated = 0,
    drafted = 0;
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const row = i + 2; // header is line 1
    try {
      const out = await importRow(r, ctx);
      if (out.isUpdate) updated += 1;
      else created += 1;
      if (out.draftedNoImages) drafted += 1;
      results.push({
        row,
        name: out.name,
        status: out.isUpdate ? 'updated' : 'created',
        ...(out.warning ? { warning: out.warning } : {}),
      });
    } catch (e) {
      results.push({ row, name: r.name || '(no name)', status: 'failed', error: e.message });
    }
  }
  return {
    summary: {
      total: records.length,
      created,
      updated,
      draftedNoImages: drafted,
      failed: results.filter((x) => x.status === 'failed').length,
    },
    results,
  };
}

module.exports = { importBulk };
