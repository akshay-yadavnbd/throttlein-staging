const mongoose = require('mongoose');
const schema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    step: { type: String, required: true },
    source: { type: String, enum: ['server', 'browser', 'webhook'], required: true },
    message: { type: String, maxlength: 600, required: true },
    code: { type: String, maxlength: 80 },
    paymentMethod: { type: String, enum: ['online', 'emi', 'cod'], default: 'online' },
    attemptId: { type: String, maxlength: 80 },
    razorpayOrderId: { type: String, maxlength: 80 },
    razorpayPaymentId: { type: String, maxlength: 80 },
    httpStatus: Number,
    eventKey: { type: String },
  },
  { timestamps: true, bufferCommands: false },
);
schema.index({ createdAt: -1, _id: -1 });
schema.index({ user: 1, createdAt: -1 });
schema.index({ eventKey: 1 }, { unique: true, sparse: true });
// Operational history, not a permanent copy of customer activity.
schema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });
module.exports = mongoose.model('CheckoutFailure', schema);
