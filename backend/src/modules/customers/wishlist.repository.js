/** Wishlists and back-in-stock ("notify me") requests. */
const Wishlist = require('./wishlist.model');
const NotifyRequest = require('./notify-request.model');

const findByUser = (userId) => Wishlist.findOne({ user: userId });
const createForUser = (userId) => Wishlist.create({ user: userId, products: [] });

const populateProducts = (wishlist) =>
  wishlist.populate({
    path: 'products',
    select: 'name slug price mrp images stock brand category status',
    populate: [
      { path: 'brand', select: 'name slug' },
      { path: 'category', select: 'name slug' },
    ],
  });

/** Upsert: asking again while a request is pending is a harmless no-op. */
const requestRestockNotice = (userId, productId) =>
  NotifyRequest.updateOne(
    { user: userId, product: productId },
    { $setOnInsert: { user: userId, product: productId } },
    { upsert: true },
  );

module.exports = { findByUser, createForUser, populateProducts, requestRestockNotice };
