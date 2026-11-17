/** The admin's view of live carts: one aggregation page, then product lines filled in. */
const Cart = require('./cart.model');

/** @returns {Promise<{ rows: any[], total: number }>} */
async function page(stages) {
  const [result] = await Cart.aggregate(stages);
  const rows = /** @type {any} array overload is mistyped */ (
    await Cart.populate(result?.rows || [], {
      path: 'items.product',
      select: 'name slug price variants stock status',
    })
  );
  return { rows, total: result?.count?.[0]?.total || 0 };
}

module.exports = { page };
