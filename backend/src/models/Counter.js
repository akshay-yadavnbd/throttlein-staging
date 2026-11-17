/**
 * Atomic named counters (audit A10).
 *
 * Order numbers were previously derived from `countDocuments() + 1` inside
 * a pre-save hook — two simultaneous checkouts computed the same number and
 * one insert failed on the unique index (after the customer had already
 * paid, on the online path). A `findOneAndUpdate` `$inc` on this collection
 * is atomic on the server, so every caller gets a distinct sequence value,
 * and deleting orders can never cause a number to be reissued.
 *
 * `_id` is the counter name (e.g. "order-2026"); `seq` is the last value
 * handed out.
 */
const mongoose = require('mongoose');

const counterSchema = new mongoose.Schema(
  {
    _id: { type: String },
    seq: { type: Number, default: 0 },
  },
  { versionKey: false, statics: { next } },
);

/**
 * Atomically reserve and return the next value for `name`.
 *
 * `floor` (optional) fast-forwards a fresh counter past legacy values —
 * used on first run so new order numbers continue after the ones the old
 * count-based scheme already issued.
 */
async function next(name, floor = 0) {
  if (floor > 0) {
    // $max is a no-op once seq has passed the floor; cheap insurance that
    // also seeds the document on first use (upsert).
    await this.updateOne({ _id: name }, { $max: { seq: floor } }, { upsert: true });
  }
  const doc = await this.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { returnDocument: 'after', upsert: true },
  );
  return doc.seq;
}

module.exports = mongoose.model('Counter', counterSchema);
