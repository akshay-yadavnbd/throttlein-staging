/**
 * GST tax invoices, one per seller parcel.
 *
 * Replaces Shiprocket's invoice PDF, which printed our Shiprocket account's
 * company as the seller for every parcel, masked the buyer's name ("Not
 * Authorized") and showed zero tax. On a marketplace the SELLER supplies the
 * goods, so each seller's slice of an order gets its own invoice:
 *
 *  - Sold by: the seller's store name, GSTIN and pickup address, frozen on
 *    the shipment when the invoice is first issued.
 *  - Numbering: the seller's own series per Indian financial year
 *    (TI2627-00001), as GST requires per GSTIN. Issued once, never reused.
 *  - Tax: listed prices are GST-inclusive, so each line is split back into
 *    taxable value + CGST/SGST (same state) or IGST (inter-state). A seller
 *    without a GSTIN can't charge GST — they get a Bill of Supply instead.
 *  - Contact: Throttlein support only; the seller's and buyer's phone numbers
 *    stay off the document (sellers never see buyer contact details).
 *
 * The PDF is rendered on demand from the order, so nothing is stored but
 * the number, date and seller snapshot.
 */
'use strict';

const invoices = require('./tax-invoice.repository');
const { effectiveRate, splitInclusive, isIntraState, stateCode, round2 } = require('../../utils/gst');
const { sliceCharges } = require('../../utils/sliceCharges');
const { env } = require('../../config/env');
const { AppError } = require('../../errors/AppError');

const GSTIN_RE = /^\d{2}[A-Z0-9]{13}$/;

const supportEmail = () => env.INVOICE_SUPPORT_EMAIL || 'info@throttlein.com';

/** This seller's outbound parcel in the order (not a return/replacement leg). */
function forwardEntry(order, sellerId) {
  return (
    (order.sellerShipments || []).find(
      (s) => (s.kind || 'forward') === 'forward' && String(s.seller) === String(sellerId),
    ) || null
  );
}

/** "2627" for any date from 1 April 2026 to 31 March 2027 (IST). */
function financialYear(date) {
  const ist = new Date(new Date(date).getTime() + 330 * 60 * 1000);
  const start = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  return `${String(start).slice(2)}${String(start + 1).slice(2)}`;
}

/**
 * Give this parcel its invoice number and seller snapshot, once. A
 * conditional update makes the first caller win; a concurrent loser reads
 * the winner's record (its reserved sequence number is simply skipped).
 */
async function ensureIssued(order, entry) {
  if (entry.taxInvoice?.number) return entry.taxInvoice;
  const seller = await invoices.invoiceSeller(entry.seller);
  /** @type {PostalAddress} */
  const pa = seller?.kyc?.pickupAddress || {};
  const date = entry.pickedUpAt || order.shippedAt || new Date();
  const fy = financialYear(date);
  const seq = await invoices.nextInvoiceSequence(`invoice-${entry.seller}-${fy}`);
  const record = {
    number: `TI${fy}-${String(seq).padStart(5, '0')}`,
    date,
    issuedAt: new Date(),
    seller: {
      name: seller?.storeName || seller?.name || 'Seller',
      gstin: String(seller?.kyc?.gstin || '')
        .trim()
        .toUpperCase(),
      address: [pa.line1, pa.line2, [pa.city, pa.pincode].filter(Boolean).join(' - ')].filter(Boolean).join(', '),
      state: pa.state || '',
    },
  };
  const result = await invoices.claimInvoice(order._id, entry._id, record);
  if (result.modifiedCount) return record;
  const fresh = await invoices.shipmentsOf(order._id);
  const won = fresh?.sellerShipments?.find((s) => String(s._id) === String(entry._id))?.taxInvoice;
  if (won?.number) return won;
  throw AppError.unavailable('Could not issue the invoice. Please try again.');
}

/** Everything the PDF prints, computed from the order and the issued record. */
async function buildInvoiceData(order, entry, issued) {
  const sellerId = String(entry.seller);
  const lines = (order.items || []).filter((it) => String(it.seller) === sellerId);
  // Lines placed before the GST snapshot existed fall back to the product's current values.
  const needLookup = lines.filter((it) => (it.gstRate == null || !it.hsn) && it.product).map((it) => it.product);
  const products = needLookup.length ? await invoices.gstFields(needLookup) : [];
  const productById = new Map(products.map((p) => [String(p._id), p]));

  const seller = issued.seller || {};
  const registered = GSTIN_RE.test(seller.gstin || '');
  const sa = order.shippingAddress || {};
  const intra = isIntraState({ sellerState: seller.state, sellerGstin: seller.gstin, customerState: sa.state });

  const rows = lines.map((it) => {
    const p = productById.get(String(it.product));
    const rate = registered ? effectiveRate(it.gstRate, p?.gstRate) : 0;
    const qty = Number(it.quantity) || 1;
    const gross = Number(it.subtotal) || (Number(it.price) || 0) * qty;
    return {
      description: it.name,
      detail: [it.size && `Size: ${it.size}`, it.color && `Colour: ${it.color}`].filter(Boolean).join('  ·  '),
      hsn: it.hsn || p?.hsn || '',
      qty,
      unitPrice: round2(gross / qty),
      ...splitInclusive(gross, rate, intra),
    };
  });

  // Delivery and COD fees the customer paid this seller. As part of a
  // composite supply they take the rate of the principal (largest) item.
  const charges = sliceCharges(order).get(sellerId) || { shipping: 0, codFee: 0 };
  const principalRate = rows.length ? rows.reduce((a, r) => (r.gross > a.gross ? r : a)).rate : 0;
  for (const [description, amount] of [
    ['Shipping charges', charges.shipping],
    ['Cash on delivery charges', charges.codFee],
  ]) {
    if (amount > 0)
      rows.push({
        description,
        detail: '',
        hsn: '',
        qty: 1,
        unitPrice: amount,
        ...splitInclusive(amount, principalRate, intra),
      });
  }

  const sum = (k) => round2(rows.reduce((s, r) => s + r[k], 0));
  const customerState = sa.state || '';
  return {
    title: registered ? 'TAX INVOICE' : 'BILL OF SUPPLY',
    registered,
    intra,
    number: issued.number,
    date: issued.date,
    orderNumber: order.orderNumber,
    orderDate: order.createdAt,
    payment: order.paymentMethod === 'cod' ? 'Cash on delivery' : 'Prepaid',
    placeOfSupply: customerState
      ? `${customerState}${stateCode(customerState) ? ` (${stateCode(customerState)})` : ''}`
      : '',
    seller: {
      name: seller.name,
      gstin: seller.gstin,
      address: seller.address,
      state: seller.state ? `${seller.state}${stateCode(seller.state) ? ` (${stateCode(seller.state)})` : ''}` : '',
    },
    customer: {
      name: sa.fullName || 'Customer',
      address: [sa.line1, sa.line2, [sa.city, sa.pincode].filter(Boolean).join(' - '), sa.state, sa.country]
        .filter(Boolean)
        .join(', '),
    },
    rows,
    totals: {
      taxable: sum('taxable'),
      cgst: sum('cgst'),
      sgst: sum('sgst'),
      igst: sum('igst'),
      tax: sum('tax'),
      gross: sum('gross'),
    },
    supportEmail: supportEmail(),
  };
}

const { amountInWords, renderPdf } = require('./tax-invoice.pdf');

/** Issue (once) and render this parcel's invoice. */
async function invoicePdf(order, entry) {
  const issued = await ensureIssued(order, entry);
  const data = await buildInvoiceData(order, entry, issued);
  return { pdf: await renderPdf(data), number: data.number, filename: `Invoice-${data.number}.pdf` };
}

/** Send a rendered invoice as a download. */
function sendPdf(res, { pdf, filename }) {
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': pdf.length,
    'Cache-Control': 'private, no-store',
  });
  res.end(pdf);
}

module.exports = {
  forwardEntry,
  financialYear,
  ensureIssued,
  buildInvoiceData,
  renderPdf,
  invoicePdf,
  sendPdf,
  amountInWords,
};
