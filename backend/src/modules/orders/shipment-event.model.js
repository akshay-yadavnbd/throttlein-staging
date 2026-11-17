const mongoose = require('mongoose');

// Acknowledge the carrier only after this durable inbox has accepted the event.
// Unmatched events are retained for replay; completed and dead-lettered events expire.
const schema = new mongoose.Schema(
  {
    eventKey: { type: String, required: true, unique: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    // `dead` = gave up matching after MAX_ATTEMPTS; kept 30 days for inspection.
    state: { type: String, enum: ['pending', 'processing', 'completed', 'dead'], default: 'pending' },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now },
    leaseUntil: Date,
    leaseToken: String,
    lastError: String,
    completedAt: Date,
    expiresAt: Date,
  },
  { timestamps: true },
);
schema.index({ state: 1, nextAttemptAt: 1, leaseUntil: 1 });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model('ShipmentEvent', schema);
