const mongoose = require('mongoose');

/**
 * One weekly payout to one seller, created when admin records the bank
 * transfer. The lines are a SNAPSHOT of what was paid — later edits to an
 * order (a refund, a corrected courier charge) don't rewrite history; they
 * show up as an adjustment in a later week instead.
 */
const settlementSchema = new mongoose.Schema(
  {
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    weekKey: { type: String, required: true }, // Monday YYYY-MM-DD (IST)
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    lines: [
      {
        order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
        orderNumber: String,
        deliveredAt: Date,
        paymentMethod: String,
        itemTotal: Number,
        courierCharge: Number,
        gatewayCharge: Number,
        refunds: Number,
        net: Number,
      },
    ],
    orders: { type: Number, default: 0 },
    itemTotal: { type: Number, default: 0 },
    courierCharge: { type: Number, default: 0 },
    gatewayCharge: { type: Number, default: 0 },
    refunds: { type: Number, default: 0 },
    net: { type: Number, default: 0 },
    /** What was actually transferred — normally == net; admin may round. */
    amountPaid: { type: Number, required: true },
    utr: { type: String, default: '' },
    note: { type: String, default: '' },
    paidAt: { type: Date, default: Date.now },
    paidBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    paidByEmail: { type: String, default: '' },
  },
  { timestamps: true },
);

settlementSchema.index({ seller: 1, weekKey: 1 }, { unique: true });

module.exports = mongoose.model('Settlement', settlementSchema);
