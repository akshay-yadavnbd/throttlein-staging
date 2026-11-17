/**
 * Rows that belong to a seller or a customer outside their own User
 * document — counted before a delete, swept after it. Statements only.
 */
const SellerOffer = require('../offers/seller-offer.model');
const SellerMedia = require('../seller-media/seller-media.model');
const OfflineSale = require('../offline-sales/offline-sale.model');
const CategoryBrandRequest = require('../catalog/category-brand-request.model');
const Media = require('../media/media.model');
const Cart = require('../customers/cart.model');
const Wishlist = require('../customers/wishlist.model');

/** `{ offers, sellerMedia, offlineSales, brandRequests, mediaUploads }` for one seller. */
async function sellerOwnershipCounts(sid) {
  const [offers, sellerMedia, offlineSales, brandRequests, mediaUploads] = await Promise.all([
    SellerOffer.countDocuments({ seller: sid }),
    SellerMedia.countDocuments({ seller: sid }),
    OfflineSale.countDocuments({ seller: sid }),
    CategoryBrandRequest.countDocuments({ seller: sid }),
    Media.countDocuments({ uploadedBy: sid }),
  ]);
  return { offers, sellerMedia, offlineSales, brandRequests, mediaUploads };
}

const deleteOffers = (sid) => SellerOffer.deleteMany({ seller: sid });
const deleteSellerMedia = (sid) => SellerMedia.deleteMany({ seller: sid });
const deleteOfflineSales = (sid) => OfflineSale.deleteMany({ seller: sid });
const deleteBrandRequests = (sid) => CategoryBrandRequest.deleteMany({ seller: sid });
/** Media rows are a shared library — keep the assets, drop the dangling uploader reference. */
const clearMediaUploader = (sid) => Media.updateMany({ uploadedBy: sid }, { $unset: { uploadedBy: '' } });

const deleteCart = (userId) => Cart.deleteOne({ user: userId });
const deleteWishlist = (userId) => Wishlist.deleteOne({ user: userId });

module.exports = {
  sellerOwnershipCounts,
  deleteOffers,
  deleteSellerMedia,
  deleteOfflineSales,
  deleteBrandRequests,
  clearMediaUploader,
  deleteCart,
  deleteWishlist,
};
