/** Order lookups for the mock pages: by AWB or shipment id, and by Shiprocket order id. */
const Order = require('../../modules/orders/order.model');
const User = require('../../models/User');

/**
 * Find the order + matching sellerShipments entry from any of:
 *   - awbCode      (the AWB Shiprocket assigns)
 *   - shipmentId   (Shiprocket's internal shipment id, what generateLabel uses)
 *
 * The mock generateLabel endpoint passes shipment_id in the URL path, so we
 * accept either to be safe.
 */
async function findOrderByAwbOrShipment(key) {
  const k = String(key);
  const order = await Order.findOne({
    $or: [{ 'sellerShipments.awbCode': k }, { 'sellerShipments.shipmentId': k }],
  })
    .populate('user', 'name email')
    .lean();
  if (!order) return null;
  const shipment = (order.sellerShipments || []).find((s) => s.awbCode === k || String(s.shipmentId) === k);
  if (!shipment) return null;
  const seller = await User.findById(shipment.seller).lean();
  return { order, shipment, seller };
}

/** Find the order + matching sellerShipments entry from the Shiprocket order id */
async function findOrderBySrId(srId) {
  const order = await Order.findOne({ 'sellerShipments.shiprocketOrderId': String(srId) })
    .populate('user', 'name email')
    .lean();
  if (!order) return null;
  const shipment = (order.sellerShipments || []).find((s) => String(s.shiprocketOrderId) === String(srId));
  if (!shipment) return null;
  const seller = await User.findById(shipment.seller).lean();
  return { order, shipment, seller };
}

/** Orders carrying any of these Shiprocket shipment ids (the manifest page). */
const ordersByShipmentIds = (ids) =>
  Order.find({ 'sellerShipments.shipmentId': { $in: ids } })
    .populate('user', 'name email')
    .lean();

/** The seller's slug, for the channel order id a webhook carries. */
const sellerSlug = (sellerId) => User.findById(sellerId).select('slug');

/** One order as a document (the delivery simulation saves it). */
const orderByFilter = (filter) => Order.findOne(filter);

module.exports = { findOrderByAwbOrShipment, findOrderBySrId, ordersByShipmentIds, sellerSlug, orderByFilter };
