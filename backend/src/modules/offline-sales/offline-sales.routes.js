/** /api/seller/offline-sales — the signed-in seller's offline sales (a superadmin may act on their behalf). */
const express = require('express');
const { protect, requireRole } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const G = require('../../validation/generic');
const c = require('./offline-sales.controller');

const list = validate({ query: G.listQuery });
const byId = validate({ params: G.params({ id: 'objectId' }) });

const router = express.Router();
router.use(protect, requireRole('seller', 'superadmin'));

// Static path before /:id so the param never captures it.
router.get('/products-lookup', list, c.productsLookup);
router.get('/', list, c.list);
router.post('/', validate({ body: G.objectBody }), c.create);
router.get('/:id/invoice', byId, c.invoice);
router.get('/:id', byId, c.getOne);
router.patch('/:id', validate({ params: G.params({ id: 'objectId' }), body: G.objectBody }), c.update);
router.delete('/:id', byId, c.remove);

module.exports = router;
