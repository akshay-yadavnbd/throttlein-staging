/** Payment snapshots must survive delayed captures and provider retries. */
async function retainCheckoutIntents() {
  const CheckoutIntent = require('../modules/orders/checkout-intent.model');
  let indexes;
  try {
    indexes = await CheckoutIntent.collection.indexes();
  } catch (err) {
    if (err.code === 26) return;
    throw err;
  }
  for (const index of indexes) {
    if (index.key?.expiresAt && index.expireAfterSeconds !== undefined) {
      await CheckoutIntent.collection.dropIndex(index.name);
    }
  }
  await CheckoutIntent.updateMany({ expiresAt: { $exists: true } }, { $unset: { expiresAt: 1 } });
}
module.exports = retainCheckoutIntents;
