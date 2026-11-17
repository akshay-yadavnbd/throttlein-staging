/** /api/seller/media — the signed-in seller's media library (a superadmin may act on their behalf). */
const express = require('express');
const { protect, requireRole } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const G = require('../../validation/generic');
const c = require('./seller-media.controller');

const body = validate({ body: G.objectBody });

const router = express.Router();
router.use(protect, requireRole('seller', 'superadmin'));

router.get('/', validate({ query: G.listQuery }), c.list);
router.post('/upload', body, ...c.upload);
router.post('/bulk-delete', body, c.bulkRemove);
router.post('/presign', body, c.presign);
router.delete('/:id', validate({ params: G.params({ id: 'objectId' }) }), c.remove);

module.exports = router;
