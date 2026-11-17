/** Reads and writes behind seller payouts: delivered / in-transit orders, sellers' bank fields, and settlements. */
const Order = require('../orders/order.model');
const User = require('../../models/User');
const Settlement = require('./settlement.model');

/** Just the order fields a payout line is computed from. */
const LINE_FIELDS = 'orderNumber items itemsTotal paymentMethod gatewayFee sellerShipments returnRequests createdAt';

const ordersFor = (filter, { newestFirst = false } = {}) => {
  const q = Order.find(filter).select(LINE_FIELDS);
  return (newestFirst ? q.sort({ createdAt: -1 }) : q).lean();
};

/** Orders with a forward parcel delivered inside [start, end). */
const deliveredInWeek = (start, end) =>
  ordersFor({
    sellerShipments: {
      $elemMatch: { status: 'delivered', deliveredAt: { $gte: start, $lt: end }, returnOf: { $exists: false } },
    },
  });

/** Orders with a forward parcel on its way (has an AWB, not delivered yet). */
const inTransit = (statuses) =>
  ordersFor(
    {
      sellerShipments: {
        $elemMatch: { status: { $in: statuses }, awbCode: { $ne: '' }, returnOf: { $exists: false } },
      },
    },
    { newestFirst: true },
  );

const sellersWithBank = (ids) =>
  User.find({ _id: { $in: ids } })
    .select(
      'name storeName email slug bankDetails.bankName bankDetails.accountNumber bankDetails.ifsc bankDetails.accountHolder',
    )
    .lean();
const sellersBasic = (ids) =>
  User.find({ _id: { $in: ids } })
    .select('name storeName email slug')
    .lean();

const settlementsOf = (sellerId) => Settlement.find({ seller: sellerId }).sort({ weekKey: -1 }).lean();
const settlementsForWeek = (weekKey, sellerIds) => Settlement.find({ weekKey, seller: { $in: sellerIds } }).lean();
const isSettled = (sellerId, weekKey) => Settlement.exists({ seller: sellerId, weekKey });
const parcelSettled = (sellerId, orderId) => Settlement.exists({ seller: sellerId, 'lines.order': orderId });
const createSettlement = (fields) => Settlement.create(fields);
const history = (filter) =>
  Settlement.find(filter).sort({ paidAt: -1 }).limit(200).populate('seller', 'name storeName email').lean();

/** The order a courier-charge correction targets (a document: it is saved back). */
const orderBy = (filter) => Order.findOne(filter);

module.exports = {
  ordersFor,
  deliveredInWeek,
  inTransit,
  sellersWithBank,
  sellersBasic,
  settlementsOf,
  settlementsForWeek,
  isSettled,
  parcelSettled,
  createSettlement,
  history,
  orderBy,
};
