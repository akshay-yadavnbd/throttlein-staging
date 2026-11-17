/**
 * OfflineSale — a manually-recorded sale the seller made outside
 * THROTTLEIN (walk-in customer, physical shop, WhatsApp order, etc.).
 *
 * Purpose: keep online + offline inventory in sync. When the seller
 * records a sale here, the linked Product's stock is decremented
 * atomically — main-gallery `stock` field for single-SKU products,
 * or the matching variant row for products with a size/color matrix.
 *
 * We snapshot `unitPrice` at sale time so revenue reports survive
 * later price changes on the underlying product. `totalAmount` is
 * pre-computed on save so listing pages don't have to re-multiply
 * quantity * unitPrice every render.
 *
 * `variant` sub-doc is only populated when the parent Product has a
 * `variants[]` matrix. For products without variants it stays empty
 * and stock decrement targets the top-level `Product.stock` field.
 *
 * Deletes are handled as "undo" — controller refills the stock the
 * sale drained. Auditability is preserved with a soft `deletedAt`
 * flag on the doc so revenue reports can still surface reversed
 * sales when needed.
 */
const mongoose = require('mongoose');

const offlineSaleSchema = new mongoose.Schema(
  {
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    // Snapshot of the product's name/slug at sale time so a rename
    // or hard-delete later doesn't wipe the historical record.
    productName: { type: String, default: '', trim: true },
    productSlug: { type: String, default: '', trim: true },

    // Variant coordinates. Both fields empty ('') for single-SKU products.
    variant: {
      size: { type: String, default: '', trim: true },
      color: { type: String, default: '', trim: true },
    },

    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    totalAmount: { type: Number, required: true, min: 0 },

    // Free-form buyer context — walk-in customer name, phone, notes.
    // Optional; sellers who don't track this can leave it blank.
    note: { type: String, default: '', trim: true, maxlength: 500 },

    // When the physical sale actually happened. Defaults to now on
    // create so quick-record flows work with no extra input, but the
    // form lets the seller backdate a sale they forgot to log.
    saleDate: { type: Date, default: Date.now, index: true },

    // ── Invoice ────────────────────────────────────────────────────
    // Every sale gets an invoice. `gst` = tax invoice issued under the
    // seller's GSTIN; `non_gst` = plain bill of supply.
    //
    // GST is INCLUSIVE: `totalAmount` (what the buyer paid, and what
    // revenue reports sum) never changes. With GST on, the total is
    // split into `taxableAmount` + `gstAmount` purely for the invoice.
    // The rate is seller-entered per sale.
    //
    // `supplyType` decides how the GST is shown:
    //   intra (buyer in the seller's state) → CGST + SGST, half each
    //   inter (buyer in another state)      → IGST, the full amount
    invoiceType: {
      type: String,
      enum: ['non_gst', 'gst'],
      default: 'non_gst',
    },
    // Per-seller running number, e.g. "OS-2026-0007". Assigned once on
    // create and never reissued (see Counter model).
    invoiceNumber: { type: String, default: '', trim: true, index: true },
    gstRate: { type: Number, default: 0, min: 0, max: 100 },
    taxableAmount: { type: Number, default: 0, min: 0 },
    gstAmount: { type: Number, default: 0, min: 0 },
    supplyType: { type: String, enum: ['intra', 'inter'], default: 'intra' },
    cgstAmount: { type: Number, default: 0, min: 0 },
    sgstAmount: { type: Number, default: 0, min: 0 },
    igstAmount: { type: Number, default: 0, min: 0 },
    // GSTIN snapshot at invoicing time, so a later KYC edit doesn't
    // rewrite invoices that were already handed to buyers.
    sellerGstin: { type: String, default: '', trim: true, uppercase: true },

    // Buyer details printed on the invoice. Name, phone and address are
    // required for every sale (GST or not); email is optional. Sales
    // recorded before this rule may have them blank.
    buyer: {
      name: { type: String, default: '', trim: true, maxlength: 120 },
      phone: { type: String, default: '', trim: true, maxlength: 20 },
      email: { type: String, default: '', trim: true, lowercase: true, maxlength: 160 },
      address: { type: String, default: '', trim: true, maxlength: 500 },
      // Buyer's state — drives intra (CGST+SGST) vs inter (IGST) supply.
      state: { type: String, default: '', trim: true, maxlength: 60 },
    },

    // Set when the seller edits the sale after recording it.
    editedAt: { type: Date, default: null },

    // Soft-delete marker set when the seller undoes a sale. The row
    // stays around so audit reports can still see it as "reversed on
    // <date>". A hard delete only happens via a separate admin path.
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Newest first for the seller's list view + revenue queries scoped to
// a date range.
offlineSaleSchema.index({ seller: 1, saleDate: -1 });
offlineSaleSchema.index({ seller: 1, deletedAt: 1, saleDate: -1 });

module.exports = mongoose.model('OfflineSale', offlineSaleSchema);
