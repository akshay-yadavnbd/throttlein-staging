/**
 * /api/admin/media — the admin media library. Any signed-in superadmin or
 * staff user (the picker is shared by every admin editor, so no module
 * permission); deletes are superadmin only.
 */
const express = require('express');
const { protect, requireRole } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const G = require('../../validation/generic');
const c = require('./media.controller');

const list = validate({ query: G.listQuery });
const superadmin = requireRole('superadmin');

const router = express.Router();
router.use(protect, requireRole('superadmin', 'staff'));

router.get('/', list, c.list);
router.get('/folders', list, c.folders);
router.post('/upload', validate({ body: G.objectBody }), ...c.upload);
router.post('/bulk-delete', superadmin, validate({ body: G.objectBody }), c.bulkRemove);
router.delete('/:id', superadmin, validate({ params: G.params({ id: 'objectId' }) }), c.remove);

module.exports = router;
