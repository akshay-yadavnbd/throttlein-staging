/**
 * Per-seller delivery quotes for a cart.
 *
 * A bag can hold items from several sellers, and each one ships its own
 * parcel from its own pickup pincode — so there is no single "shipping
 * fee" for an order. This module answers, for one customer address:
 *
 *   for each seller in the cart → does the customer pay for delivery,
 *   and if so, which couriers serve that route and what do they charge?
 *
 * The SAME function backs the cart's courier picker and the order it
 * creates, so the price the customer is shown is the price the server
 * charges — a client-supplied rate is never trusted, only the courier id
 * the customer picked.
 */
const carts = require('./cart.repository');
const shiprocket = require('../../infrastructure/shipping/shiprocket');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Parcel weight in kg for one seller's lines, floored at Shiprocket's 0.5kg. */
function weightFor(lines, weightMap) {
  const grams = lines.reduce((s, l) => s + (weightMap.get(String(l.productId)) || 500) * l.quantity, 0);
  return Math.max(0.5, grams / 1000);
}

/** Does this seller refuse to ship to this address? */
function sellerExcludes(seller, address) {
  const pin = String(address?.pincode || '').trim();
  const state = String(address?.state || '')
    .trim()
    .toLowerCase();
  const byPin = (seller.excludedPincodes || []).some((x) => {
    const p = String(x).trim();
    return p.length === 6 ? pin === p : p && pin.startsWith(p);
  });
  const byState = (seller.excludedStates || []).some((x) => String(x).trim().toLowerCase() === state);
  return byPin || byState;
}

/**
 * Quote every seller in `lines` ([{ sellerId, productId, quantity, subtotal }])
 * for `address`. `cod` makes Shiprocket return COD-capable couriers.
 *
 * Returns one group per seller:
 *   { sellerId, sellerName, customerPays, itemTotal, weightKg,
 *     couriers: [{ id, name, rate, codCharges, etd, days, recommended }],
 *     error }                       // set when the route can't be quoted
 *
 * A seller who absorbs delivery comes back with `customerPays: false` and
 * an empty courier list — nothing to choose, nothing to pay.
 */
async function quoteCart({ lines, address, cod = false }) {
  const bySeller = new Map();
  for (const l of lines) {
    const k = String(l.sellerId);
    if (!bySeller.has(k)) bySeller.set(k, []);
    bySeller.get(k).push(l);
  }
  const sellerIds = [...bySeller.keys()];
  if (!sellerIds.length) return [];

  const [sellers, products] = await Promise.all([
    carts.quoteSellers(sellerIds),
    carts.productWeights(lines.map((l) => l.productId).filter(Boolean)),
  ]);
  const sMap = new Map(sellers.map((u) => [String(u._id), u]));
  const wMap = new Map(products.map((p) => [String(p._id), p.weightGrams || 500]));

  // One Shiprocket round-trip per seller, in parallel — a bag rarely has
  // more than a handful, and serialising them stalls the checkout.
  return Promise.all(
    sellerIds.map(async (sellerId) => {
      const seller = sMap.get(sellerId);
      const group = bySeller.get(sellerId);
      const itemTotal = round2(group.reduce((s, l) => s + (Number(l.subtotal) || 0), 0));
      const base = {
        sellerId,
        sellerName: seller?.storeName || seller?.name || 'Seller',
        customerPays: seller?.deliveryPaidByCustomer === true,
        itemTotal,
        weightKg: weightFor(group, wMap),
        couriers: [],
        error: '',
      };
      if (!base.customerPays) return base;

      const pickup = seller?.kyc?.pickupAddress?.pincode;
      if (!pickup) return { ...base, error: 'This seller hasn’t set a pickup address yet.' };
      if (sellerExcludes(seller, address)) return { ...base, error: 'This seller doesn’t deliver to your address.' };

      let data;
      try {
        data = await shiprocket.serviceability({
          pickup_pincode: pickup,
          delivery_pincode: address.pincode,
          weight: base.weightKg,
          cod: cod ? 1 : 0,
        });
      } catch (e) {
        return { ...base, error: 'Couldn’t fetch delivery rates just now.' };
      }
      const rows = data?.data?.available_courier_companies || [];
      if (!rows.length) return { ...base, error: 'No courier delivers to your pincode from this seller.' };

      const recommendedId = data?.data?.recommended_by?.id;
      const couriers = rows
        .map((c) => ({
          id: Number(c.courier_company_id),
          name: String(c.courier_name || 'Courier'),
          rate: round2(c.rate),
          codCharges: round2(c.cod_charges || 0),
          days: Number(c.estimated_delivery_days) || null,
          etd: c.etd || (c.estimated_delivery_days ? `${c.estimated_delivery_days} days` : ''),
          recommended: Number(c.courier_company_id) === Number(recommendedId),
        }))
        .filter((c) => Number.isFinite(c.id) && c.rate >= 0)
        .sort((a, b) => a.rate - b.rate);

      return { ...base, couriers };
    }),
  );
}

/**
 * Resolve the customer's picks against a fresh quote.
 *
 * `picks` is { [sellerId]: courierId } as sent by the cart. Returns
 * `{ selections, total, error }` — `selections` is what gets written onto
 * the order (rate included, taken from the SERVER's quote), `error` is the
 * first thing wrong, in the customer's words.
 */
function resolveSelections(groups, picks = {}) {
  const selections = [];
  let total = 0;
  for (const g of groups) {
    if (!g.customerPays) continue;
    if (g.error) return { selections: [], total: 0, error: `${g.sellerName}: ${g.error}` };
    const wanted = Number(picks[g.sellerId]);
    const courier =
      g.couriers.find((c) => c.id === wanted) ||
      // Nothing picked (or a courier that has since disappeared) falls back
      // to the cheapest serviceable one rather than failing the order.
      g.couriers[0];
    if (!courier) return { selections: [], total: 0, error: `No courier is available for ${g.sellerName}'s parcel.` };
    selections.push({
      sellerId: g.sellerId,
      courierId: courier.id,
      courierName: courier.name,
      rate: courier.rate,
      etd: courier.etd,
      chosen: courier.id === wanted,
    });
    total = round2(total + courier.rate);
  }
  return { selections, total, error: '' };
}

module.exports = { quoteCart, resolveSelections, round2 };
