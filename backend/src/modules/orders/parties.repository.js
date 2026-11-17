/**
 * Reads of User (customers and sellers) that the order flows need. Each
 * function selects only the fields its caller uses. A sellers module would
 * own these later; keeping them together makes that move a file rename.
 */
const User = require('../../models/User');

const byIds = (ids) => ({ _id: { $in: ids } });

/** Whole customer document — checkout needs `addresses.id(...)`. */
const customerById = (userId) => User.findById(userId);
const customerContact = (userId) => User.findById(userId).select('name email');
const userEmail = (userId) => User.findById(userId).select('email');

/** Whole seller document (pickup address, store name, contact). */
const sellerById = (sellerId) => User.findById(sellerId);
const sellerPickupProfile = (sellerId) => User.findById(sellerId).select('kyc.pickupAddress kyc.shiprocket');
const sellerPickupPincode = (sellerId) => User.findById(sellerId).select('kyc.pickupAddress');
const sellerLabel = (sellerId) => User.findById(sellerId).select('storeName name');
const sellerContactFull = (sellerId) => User.findById(sellerId).select('name storeName slug email phone').lean();

/** Sellers for the carrier push: pickup nickname + slug fallback. */
const sellersForDispatch = (ids) =>
  User.find(byIds(ids)).select('name email slug kyc.shiprocket.pickupLocation kyc.pickupAddress');
/** Sellers for checkout gating: COD, exclusions, status, return windows. */
const sellersForCheckout = (ids) =>
  User.find(byIds(ids))
    .select(
      'codEnabled codCharge storeName name status excludedStates excludedPincodes returnPolicyDays exchangePolicyDays',
    )
    .lean();
const sellerNames = (ids) => User.find(byIds(ids)).select('storeName name').lean();
const sellerPolicies = (ids) =>
  User.find(byIds(ids)).select('storeName name slug returnPolicyDays exchangePolicyDays').lean();
const sellerCards = (ids) => User.find(byIds(ids)).select('name storeName slug').lean();

module.exports = {
  customerById,
  customerContact,
  userEmail,
  sellerById,
  sellerPickupProfile,
  sellerPickupPincode,
  sellerLabel,
  sellerContactFull,
  sellersForDispatch,
  sellersForCheckout,
  sellerNames,
  sellerPolicies,
  sellerCards,
};
