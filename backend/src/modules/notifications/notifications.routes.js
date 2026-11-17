/**
 * Notifications admin router, mounted inside routes/adminRoutes.js (/api/admin)
 * after its staff guard. Superadmin only: not staff with any permission.
 */
const express = require('express');
const { requireRole } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const G = require('../../validation/generic');
const c = require('./notifications.controller');

const superadmin = requireRole('superadmin');
const edit = validate({ params: G.params({ id: 'objectId' }), body: G.objectBody });

const admin = express.Router();
admin.get('/notifications', superadmin, validate({ query: G.listQuery }), c.list);
admin.post('/notifications', superadmin, validate({ body: G.objectBody }), c.add);
admin.patch('/notifications/:id', superadmin, edit, c.update);
admin.delete('/notifications/:id', superadmin, validate({ params: G.params({ id: 'objectId' }) }), c.remove);
admin.post('/notifications/:id/test', superadmin, edit, c.test);

module.exports = { admin };
