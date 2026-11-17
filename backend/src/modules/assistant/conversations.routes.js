/** /api/assistant/conversations — the signed-in seller's (or superadmin's) saved assistant chats. */
const express = require('express');
const { protect, requireRole } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const G = require('../../validation/generic');
const c = require('./conversations.controller');

const byId = validate({ params: G.params({ id: 'objectId' }) });
const edit = validate({ params: G.params({ id: 'objectId' }), body: G.objectBody });

const router = express.Router();
router.use(protect, requireRole('seller', 'superadmin'));

router.get('/', validate({ query: G.listQuery }), c.list);
router.post('/', validate({ body: G.objectBody }), c.create);
router.get('/:id', byId, c.getOne);
router.post('/:id/messages', edit, c.append);
router.patch('/:id', edit, c.rename);
router.delete('/:id', byId, c.remove);

module.exports = router;
