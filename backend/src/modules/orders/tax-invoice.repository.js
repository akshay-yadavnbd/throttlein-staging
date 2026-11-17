/** Reads and the one write behind GST tax invoices. */
const Order = require('./order.model');
const Product = require('../products/product.model');
const User = require('../../models/User');
const Counter = require('../../models/Counter');

/** What the "Sold by" block snapshots from the seller. */
const invoiceSeller = (sellerId) => User.findById(sellerId).select('name storeName kyc.gstin kyc.pickupAddress').lean();

/** The seller's next number in a series (one series per seller per financial year). */
const nextInvoiceSequence = (name) => Counter.next(name);

/** Stamp the invoice on the slice only if it has none yet: the first caller wins. */
const claimInvoice = (orderId, entryId, record) =>
  Order.updateOne(
    { _id: orderId, sellerShipments: { $elemMatch: { _id: entryId, 'taxInvoice.number': { $exists: false } } } },
    { $set: { 'sellerShipments.$.taxInvoice': record } },
  );

const shipmentsOf = (orderId) => Order.findById(orderId).select('sellerShipments').lean();

/** GST rate / HSN for lines placed before the order snapshotted them. */
const gstFields = (productIds) =>
  Product.find({ _id: { $in: productIds } })
    .select('gstRate hsn')
    .lean();

module.exports = { invoiceSeller, nextInvoiceSequence, claimInvoice, shipmentsOf, gstFields };
