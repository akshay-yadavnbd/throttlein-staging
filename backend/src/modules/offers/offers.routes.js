/** /api/seller/offers — the signed-in seller's offers (a superadmin may act on their behalf). */
const express = require('express');
const { protect, requireRole } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const G = require('../../validation/generic');
const c = require('./offers.controller');

const byId = validate({ params: G.params({ id: 'objectId' }) });
const edit = validate({ params: G.params({ id: 'objectId' }), body: G.objectBody });

const router = express.Router();
router.use(protect, requireRole('seller', 'superadmin'));

router.get('/', validate({ query: G.listQuery }), c.list);
router.post('/', validate({ body: G.objectBody }), c.create);
router.get('/:id', byId, c.getOne);
router.put('/:id', edit, c.update);
router.patch('/:id/toggle', edit, c.toggle);
router.delete('/:id', byId, c.remove);

module.exports = router;
