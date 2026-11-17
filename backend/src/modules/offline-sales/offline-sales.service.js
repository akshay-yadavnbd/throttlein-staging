/**
 * Offline sales — the seller's point-of-sale log (/dashboard/offline-sales)
 * that keeps shop-counter sales in step with online stock. Recording a sale
 * takes the units out of stock; editing its quantity moves stock by the
 * difference; undoing it (a soft delete) puts them back. Every sale carries
 * an invoice number and a GST or non-GST tax split (offline-sale-tax.js).
 * All reads and writes are scoped to the signed-in seller.
 *
 * Stock is read, checked and written without a transaction. Two sales racing
 * for the last unit can drive it negative; the product schema's `min: 0`
 * then rejects the second save, and that seller re-picks. Acceptable.
 */
const mongoose = require('mongoose');
const { AppError } = require('../../errors/AppError');
const { logger } = require('../../utils/logger');
const escapeRegExp = require('../../utils/escapeRegExp');
const sales = require('./offline-sales.repository');
const {
  DEFAULT_GST_RATE,
  computeTax,
  readGstRate,
  resolveSupplyType,
  normalizeInvoiceType,
} = require('./offline-sale-tax');
const { readBuyer, validateBuyer, saleDateRange, dateOr } = require('./offline-sale-input');
const { hasVariants, findVariantIndex, applyStockChange } = require('./stock');

const NO_GSTIN = 'Add your GSTIN in Verification before issuing GST invoices.';
const BAD_RATE = 'GST rate must be more than 0 and at most 100%.';

/** GSTIN + pickup state in one read. */
async function sellerTaxProfile(sellerId) {
  const me = await sales.sellerTaxFields(sellerId);
  return {
    gstin: String(me?.kyc?.gstin || '')
      .trim()
      .toUpperCase(),
    state: String(me?.kyc?.pickupAddress?.state || '').trim(),
  };
}

/** The next per-seller, per-year invoice number, e.g. "OS-2026-0007". */
async function nextInvoiceNumber(sellerId, date) {
  const year = (date instanceof Date && Number.isFinite(date.getTime()) ? date : new Date()).getFullYear();
  const seq = await sales.nextSequence(`offline-invoice-${sellerId}-${year}`);
  return `OS-${year}-${String(seq).padStart(4, '0')}`;
}

function assertBuyer(buyer) {
  const error = validateBuyer(buyer);
  if (error) throw AppError.badRequest(error);
}

/* ── reads ────────────────────────────────────────────────────────────── */

/**
 * History, newest first, with revenue / unit totals over the whole filter.
 * A sale whose product was later deleted from the catalogue drops out of
 * the list and the totals; it stays in the database and comes back flagged
 * `productDeleted` under `includeDeleted=true`. Checked here rather than on
 * product delete, so every way a product can disappear is covered.
 */
async function list(sellerId, query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 30));
  const includeDeleted = String(query.includeDeleted || '') === 'true';

  const filter = { seller: sellerId };
  if (!includeDeleted) filter.deletedAt = null;
  const range = saleDateRange(query.from, query.to);
  if (range) filter.saleDate = range;

  const ownProductIds = await sales.ownProductIds(sellerId);
  const liveProducts = new Set(ownProductIds.map(String));
  // Cast for the aggregate below, which does not auto-cast strings the way find() does.
  const productQuery =
    query.product && mongoose.isValidObjectId(query.product)
      ? new mongoose.Types.ObjectId(String(query.product))
      : null;
  if (productQuery) {
    filter.product = includeDeleted || liveProducts.has(String(productQuery)) ? productQuery : { $in: [] };
  } else if (!includeDeleted) {
    filter.product = { $in: ownProductIds };
  }

  const [rows, total] = await sales.page(filter, { skip: (page - 1) * limit, limit });
  const items = rows.map((it) => ({ ...it, productDeleted: !liveProducts.has(String(it.product)) }));
  const { totalRevenue, totalUnits } = await sales.totals(filter);
  const tax = await sellerTaxProfile(sellerId);
  return { items, totalRevenue, totalUnits, sellerGstin: tax.gstin, sellerState: tax.state, page, limit, total };
}

async function get(sellerId, id) {
  const sale = await sales.findOwn(id, sellerId);
  if (!sale) throw AppError.notFound('Sale not found.');
  return { sale };
}

/** The record-sale picker: the seller's products (name or SKU match) with their variants. */
async function productsLookup(sellerId, q) {
  const filter = { seller: sellerId };
  const search = String(q || '').trim();
  if (search) {
    const re = new RegExp(escapeRegExp(search), 'i');
    filter.$or = [{ name: re }, { sku: re }];
  }
  return { items: await sales.lookupProducts(filter) };
}

/* ── writes ───────────────────────────────────────────────────────────── */

/**
 * Record a sale. A product with variants needs a size and / or colour that
 * matches a row (picking none would corrupt the matrix); the unit price is
 * the seller's override (haggled prices are common) or the product's price.
 */
async function create(sellerId, b = {}) {
  const productId = String(b.product || '').trim();
  const size = String(b.variant?.size || b.size || '').trim();
  const color = String(b.variant?.color || b.color || '').trim();
  const quantity = Math.floor(Number(b.quantity) || 0);
  const invoiceType = normalizeInvoiceType(b.invoiceType);
  const buyer = readBuyer(b.buyer);
  const gstRate = readGstRate(b.gstRate);

  if (!mongoose.isValidObjectId(productId)) throw AppError.badRequest('A valid product must be picked.');
  if (!quantity || quantity < 1) throw AppError.badRequest('Quantity must be at least 1.');
  assertBuyer(buyer);
  if (invoiceType === 'gst' && gstRate === null) throw AppError.badRequest(BAD_RATE);
  const tax = invoiceType === 'gst' ? await sellerTaxProfile(sellerId) : { gstin: '', state: '' };
  if (invoiceType === 'gst' && !tax.gstin) throw AppError.badRequest(NO_GSTIN);
  const supplyType = resolveSupplyType(b.supplyType, buyer.state, tax.state);

  const product = await sales.ownProduct(productId, sellerId);
  if (!product) throw AppError.notFound('Product not found in your catalog.');
  const variants = hasVariants(product);
  if (variants) {
    if (!size && !color) throw AppError.badRequest('This product has variants — pick a size and/or color.');
    const idx = findVariantIndex(product, size, color);
    if (idx < 0) throw AppError.badRequest(`No variant matching size="${size}" color="${color}" on this product.`);
    const left = Number(product.variants[idx].stock) || 0;
    if (left < quantity) throw AppError.badRequest(`Only ${left} unit(s) left of that size/color combination.`);
  } else {
    const left = Number(product.stock) || 0;
    if (left < quantity) throw AppError.badRequest(`Only ${left} unit(s) left in stock.`);
  }

  const override = Number(b.unitPrice);
  const unitPrice = Number.isFinite(override) && override >= 0 ? override : Number(product.price) || 0;
  const totalAmount = Math.round(unitPrice * quantity);
  const saleDate = dateOr(b.saleDate, new Date());

  applyStockChange(product, variants ? { size, color } : null, -quantity);
  await product.save();

  const sale = await sales.create({
    seller: sellerId,
    product: product._id,
    productName: product.name,
    productSlug: product.slug,
    variant: variants ? { size, color } : { size: '', color: '' },
    quantity,
    unitPrice,
    totalAmount,
    note: String(b.note || '').trim(),
    saleDate,
    invoiceType,
    invoiceNumber: await nextInvoiceNumber(sellerId, saleDate),
    sellerGstin: tax.gstin,
    buyer,
    ...computeTax(totalAmount, invoiceType, gstRate, supplyType),
  });
  logger.info(
    `[offline-sale] created id=${sale._id} seller=${sellerId} product=${product._id} qty=${quantity} variant=${size}/${color} → new stock=${product.stock}`,
  );
  return { sale, productStock: product.stock };
}

/**
 * Edit quantity, unit price, date, note, invoice type, GST rate / supply or
 * buyer. The product and variant are fixed (a different stock row means
 * undo and re-record). The invoice number is kept, so a re-printed invoice
 * matches the one the buyer already holds; so is the GSTIN it was issued under.
 */
async function update(sellerId, id, b = {}) {
  if (!mongoose.isValidObjectId(id)) throw AppError.notFound('Sale not found.');
  const sale = await sales.findOwn(id, sellerId, { liveOnly: true });
  if (!sale) throw AppError.notFound('Sale not found (or already deleted).');

  let quantity = sale.quantity;
  if (b.quantity !== undefined) {
    quantity = Math.floor(Number(b.quantity) || 0);
    if (!quantity || quantity < 1) throw AppError.badRequest('Quantity must be at least 1.');
  }
  let unitPrice = sale.unitPrice;
  if (b.unitPrice !== undefined && b.unitPrice !== null && b.unitPrice !== '') {
    const p = Number(b.unitPrice);
    if (!Number.isFinite(p) || p < 0) throw AppError.badRequest('Unit price must be zero or more.');
    unitPrice = p;
  }
  const saleDate = dateOr(b.saleDate, sale.saleDate);
  const note =
    b.note !== undefined
      ? String(b.note || '')
          .trim()
          .slice(0, 500)
      : sale.note;
  const invoiceType = b.invoiceType !== undefined ? normalizeInvoiceType(b.invoiceType) : sale.invoiceType || 'non_gst';
  const buyer = readBuyer(
    b.buyer !== undefined ? b.buyer : /** @type {any} nested path */ (sale.buyer)?.toObject?.() || sale.buyer || {},
  );
  assertBuyer(buyer);
  // Rate: an explicit value wins, else the sale's own, else the default.
  const gstRate = readGstRate(b.gstRate, sale.gstRate > 0 ? sale.gstRate : DEFAULT_GST_RATE);

  let sellerGstin = '';
  let supplyType = 'intra';
  if (invoiceType === 'gst') {
    if (gstRate === null) throw AppError.badRequest(BAD_RATE);
    const tax = await sellerTaxProfile(sellerId);
    sellerGstin = sale.sellerGstin || tax.gstin;
    if (!sellerGstin) throw AppError.badRequest(NO_GSTIN);
    supplyType = resolveSupplyType(b.supplyType !== undefined ? b.supplyType : sale.supplyType, buyer.state, tax.state);
  }

  // Stock follows the quantity delta (more units sold → stock drops further).
  const delta = quantity - sale.quantity;
  if (delta !== 0) {
    const product = await sales.ownProduct(sale.product, sellerId);
    if (!product) {
      if (delta > 0) throw AppError.badRequest('This product no longer exists, so the quantity cannot be increased.');
    } else {
      const before = applyStockChange(product, sale.variant, -delta);
      if (delta > 0 && before < delta) throw AppError.badRequest(`Only ${before} more unit(s) available in stock.`);
      await product.save();
    }
  }

  const totalAmount = Math.round(unitPrice * quantity);
  Object.assign(sale, { quantity, unitPrice, totalAmount, saleDate, note, invoiceType, sellerGstin, buyer });
  Object.assign(sale, computeTax(totalAmount, invoiceType, gstRate, supplyType));
  if (!sale.invoiceNumber) sale.invoiceNumber = await nextInvoiceNumber(sellerId, saleDate);
  sale.editedAt = new Date();
  await sale.save();
  logger.info(
    `[offline-sale] edited id=${sale._id} seller=${sellerId} qty=${quantity} (delta ${delta}) invoice=${invoiceType}`,
  );
  return { sale };
}

/** Everything the printable invoice needs. Sales recorded before invoices existed get a number on first view. */
async function invoice(sellerId, id) {
  if (!mongoose.isValidObjectId(id)) throw AppError.notFound('Sale not found.');
  const sale = await sales.findOwn(id, sellerId);
  if (!sale) throw AppError.notFound('Sale not found.');
  if (!sale.invoiceNumber) {
    sale.invoiceNumber = await nextInvoiceNumber(sellerId, sale.saleDate);
    if (!sale.invoiceType) sale.invoiceType = 'non_gst';
    Object.assign(
      sale,
      computeTax(
        sale.totalAmount,
        sale.invoiceType,
        sale.gstRate > 0 ? sale.gstRate : DEFAULT_GST_RATE,
        sale.supplyType,
      ),
    );
    await sale.save();
  }
  const me = await sales.sellerInvoiceFields(sellerId);
  /** @type {PostalAddress} */
  const pa = me?.kyc?.pickupAddress || {};
  const pickupLine = [pa.line1, pa.line2, pa.city, pa.state, pa.pincode]
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .join(', ');
  return {
    sale,
    seller: {
      storeName: me?.storeName || me?.name || '',
      name: me?.name || '',
      email: me?.email || '',
      phone: me?.phone || '',
      address: pickupLine || me?.address || '',
      state: pa.state || '',
      gstin: sale.sellerGstin || String(me?.kyc?.gstin || '').toUpperCase(),
    },
  };
}

/** Undo: soft delete, and the units go back to the row they came from. */
async function remove(sellerId, id) {
  const sale = await sales.findOwn(id, sellerId, { liveOnly: true });
  if (!sale) throw AppError.notFound('Sale not found (or already undone).');
  const product = await sales.ownProduct(sale.product, sellerId);
  if (product) {
    applyStockChange(product, sale.variant, sale.quantity);
    await product.save();
  }
  sale.deletedAt = new Date();
  await sale.save();
  logger.info(`[offline-sale] undone id=${sale._id} seller=${sellerId} refilled qty=${sale.quantity}`);
}

module.exports = { list, get, productsLookup, create, update, invoice, remove };
