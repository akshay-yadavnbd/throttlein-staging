/**
 * Response helpers — the envelope for NEW endpoints.
 *
 *   success → { data, meta? }      (sendData / sendCreated / sendList)
 *   failure → { success:false, code, message, details?, requestId }
 *              — the error middleware only; controllers never build one.
 *
 * Existing endpoints keep the shapes the three frontends already read
 * (`{ order }`, `{ items }`, `{ success, message }`); they move to the
 * envelope route by route as each screen is touched. Until then the
 * helpers below are the shape every new route uses, so the API stops
 * growing new variants.
 */
function sendData(res, data, status = 200, meta) {
  res.status(status).json(meta ? { data, meta } : { data });
}

function sendCreated(res, data) {
  sendData(res, data, 201);
}

/** A page of a list: `items` plus paging meta. */
function sendList(res, items, { page = 1, pageSize = items.length, totalItems = items.length } = {}) {
  const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(totalItems / pageSize)) : 1;
  sendData(res, { items }, 200, { page, pageSize, totalItems, totalPages });
}

/** No body to return (delete, acknowledge). */
function sendNoContent(res) {
  res.status(204).end();
}

module.exports = { sendData, sendCreated, sendList, sendNoContent };
