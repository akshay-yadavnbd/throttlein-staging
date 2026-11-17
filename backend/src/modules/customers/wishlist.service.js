/** Wishlist edits and "email me when this is back in stock" requests. */
const { AppError } = require('../../errors/AppError');
const wishlists = require('./wishlist.repository');
const carts = require('./cart.repository');

async function getOrCreate(userId) {
  return (await wishlists.findByUser(userId)) || wishlists.createForUser(userId);
}

async function filled(wishlist) {
  await wishlists.populateProducts(wishlist);
  return { wishlist };
}

async function productOrNotFound(ref, select) {
  if (!ref) throw AppError.badRequest('productId is required');
  const product = await carts.productByRef(ref, { select });
  if (!product) throw AppError.notFound('Product not found');
  return product;
}

async function get(userId) {
  return filled(await getOrCreate(userId));
}

/** Newest first; adding a product already saved is a no-op. */
async function add(userId, productRef) {
  const product = await productOrNotFound(productRef, '_id');
  const id = String(product._id);
  const wishlist = await getOrCreate(userId);
  if (!wishlist.products.some((p) => String(p) === id)) {
    wishlist.products.unshift(product._id);
    await wishlist.save();
  }
  return filled(wishlist);
}

async function remove(userId, productId) {
  const wishlist = await getOrCreate(userId);
  wishlist.products = wishlist.products.filter((p) => String(p) !== productId);
  await wishlist.save();
  return filled(wishlist);
}

/** `alreadyInStock` lets the page say so instead of promising an email that is not coming. */
async function notifyWhenInStock(userId, productRef) {
  const product = await productOrNotFound(productRef, '_id stock');
  await wishlists.requestRestockNotice(userId, product._id);
  return { alreadyInStock: (product.stock ?? 0) > 0 };
}

module.exports = { get, add, remove, notifyWhenInStock };
