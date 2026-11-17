/**
 * The most a product (or one of its variants) can be priced at, in rupees.
 * Applies to the selling price and the MRP. Enforced on the model, so every
 * write path (form, bulk import, URL import, the assistant) is covered; the
 * request schema and importer check it first for a clearer message.
 * Mirrored for the seller form in frontend/lib/priceLimit.ts.
 */
const MAX_PRICE = 1_000_000;

/** "₹10,00,000" — Indian digit grouping, as sellers read prices. */
const MAX_PRICE_LABEL = `₹${MAX_PRICE.toLocaleString('en-IN')}`;

module.exports = { MAX_PRICE, MAX_PRICE_LABEL };
