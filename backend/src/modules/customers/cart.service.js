/** The shopping bag: reading it with an availability verdict per line, edits, and delivery quotes. */
const { AppError } = require('../../errors/AppError');
const deliveryQuote = require('./delivery-quote.service');
const carts = require('./cart.repository');
const { lineAvailability, buyable } = require('./cart-availability');
const reminders = require('./cart-reminders.service');

async function getOrCreate(userId) {
  return (await carts.findByUser(userId)) || carts.createForUser(userId);
}

const snapshotOf = (product) => ({
  name: product.name || '',
  image: (Array.isArray(product.images) && product.images[0]) || '',
  slug: product.slug || '',
  price: Number(product.price) || 0,
});

/** Copy the product's display fields onto the line (keeps the bag readable after a product is deleted). True if changed. */
function syncSnapshot(item) {
  const p = item.product;
  if (!p || typeof p !== 'object' || !p.name) return false;
  const next = snapshotOf(p);
  const cur = item.snapshot || {};
  if (cur.name === next.name && cur.image === next.image && cur.slug === next.slug && cur.price === next.price)
    return false;
  item.snapshot = next;
  return true;
}

/**
 * The cart as the storefront renders it: EVERY line, each with an
 * `availability` verdict so the page can grey a line out and say why instead
 * of dropping it. `counts` keeps the header badge and the summary in step.
 */
function view(cart) {
  const c = cart.toObject ? cart.toObject() : cart;
  const items = (c.items || []).map((it) => ({ ...it, availability: lineAvailability(it) }));
  const buyableCount = items.filter((it) => buyable(it.availability)).length;
  return {
    ...c,
    items,
    counts: { total: items.length, buyable: buyableCount, unavailable: items.length - buyableCount },
  };
}

/** Save after a shopper edit (restarts the abandoned-cart clock) and answer the fresh view. */
async function saveEdit(cart, { populate = true } = {}) {
  reminders.markCartActivity(cart);
  await cart.save();
  if (populate) await carts.populateLines(cart);
  return { cart: view(cart) };
}

/**
 * GET /api/cart. A line whose product can never be bought again (deleted,
 * or its seller left the marketplace) is dropped here and named in
 * `removed` so the page can say what went. Out-of-stock lines stay: they come back.
 */
async function get(userId) {
  const cart = await getOrCreate(userId);
  await carts.populateLines(cart);
  let dirty = false;
  for (const it of cart.items) dirty = syncSnapshot(it) || dirty;
  const removed = [];
  for (const it of [...cart.items]) {
    if (lineAvailability(it).state !== 'unavailable') continue;
    removed.push({ name: it.snapshot?.name || 'An item', reason: 'no longer available' });
    it.deleteOne();
    dirty = true;
  }
  // Viewing is not shopper activity: no reminder reset here.
  if (dirty) await cart.save();
  if (removed.length) await carts.populateLines(cart);
  return { cart: view(cart), removed };
}

/** Same gate as the storefront: an active product from an account- and KYC-approved seller, or "not found". */
async function add(userId, { productId, quantity = 1, size = '', color = '' }) {
  if (!productId) throw AppError.badRequest('productId is required');
  const product = await carts.productByRef(productId, { populateSeller: true });
  const seller = product?.seller;
  const sellerApproved = seller && seller.status === 'approved' && seller.kyc && seller.kyc.status === 'approved';
  if (!product || !sellerApproved || product.status !== 'active') throw AppError.notFound('Product not found');

  const cart = await getOrCreate(userId);
  const cap = product.stock || 99;
  const existing = cart.items.find(
    (i) => String(i.product) === String(product._id) && i.size === size && (i.color || '') === color,
  );
  if (existing) {
    existing.quantity = Math.min(existing.quantity + Number(quantity), cap);
    existing.snapshot = snapshotOf(product);
  } else {
    cart.items.push({
      product: product._id,
      quantity: Math.min(Number(quantity), cap),
      size,
      color,
      snapshot: snapshotOf(product),
    });
  }
  return saveEdit(cart);
}

async function lineOf(userId, itemId) {
  const cart = await getOrCreate(userId);
  const item = cart.items.id(itemId);
  if (!item) throw AppError.notFound('Cart item not found');
  return { cart, item };
}

async function setQuantity(userId, itemId, quantity) {
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty < 1) throw AppError.badRequest('Quantity must be at least 1');
  const { cart, item } = await lineOf(userId, itemId);
  item.quantity = qty;
  return saveEdit(cart);
}

async function removeLine(userId, itemId) {
  const { cart, item } = await lineOf(userId, itemId);
  item.deleteOne();
  return saveEdit(cart);
}

async function clear(userId) {
  const cart = await getOrCreate(userId);
  cart.set('items', []);
  return saveEdit(cart, { populate: false });
}

/**
 * GET /api/cart/delivery-options — what delivery costs for the buyable lines
 * at this address, one group per seller. Sellers who absorb delivery answer
 * `customerPays: false`; the rest carry live couriers to choose from.
 * `suggestedTotal` is the cheapest-per-seller sum the picker starts on.
 */
async function deliveryOptions(userId, { addressId, cod }) {
  const user = await carts.userWithAddresses(userId);
  const address = user?.addresses?.id(addressId);
  if (!address) throw AppError.badRequest('Pick a delivery address first');

  const cart = await getOrCreate(userId);
  await carts.populateLines(cart);
  const lines = /** @type {any[]} lines populated above */ (cart.items)
    .filter((it) => buyable(lineAvailability(it)))
    .map((it) => ({
      sellerId: it.product?.seller?._id || it.product?.seller,
      productId: it.product?._id,
      quantity: it.quantity,
      subtotal: (Number(it.product?.price) || 0) * it.quantity,
    }))
    .filter((l) => l.sellerId);

  const groups = await deliveryQuote.quoteCart({ lines, address, cod: String(cod || '') === '1' });
  const payable = groups.filter((g) => g.customerPays);
  return {
    groups,
    suggestedTotal: deliveryQuote.round2(payable.reduce((s, g) => s + (g.couriers[0]?.rate || 0), 0)),
    needsChoice: payable.length > 0,
  };
}

module.exports = { get, add, setQuantity, removeLine, clear, deliveryOptions };
