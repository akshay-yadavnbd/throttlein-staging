/**
 * The most a product or variant can be priced at, in rupees (price and MRP).
 * The backend enforces the same cap in backend/src/modules/products/price-limit.js;
 * keep the two in step.
 */
export const MAX_PRICE = 1_000_000;

/** "₹10,00,000" — Indian digit grouping. */
export const MAX_PRICE_LABEL = `₹${MAX_PRICE.toLocaleString('en-IN')}`;

/** True when a typed amount is a number over the cap (blank and non-numbers are other checks' job). */
export function overPriceLimit(raw: string | number | null | undefined): boolean {
  const n = Number(String(raw ?? '').trim());
  return String(raw ?? '').trim() !== '' && Number.isFinite(n) && n > MAX_PRICE;
}
