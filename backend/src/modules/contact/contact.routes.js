/** /api/contact — public, rate-limited per client. */
const express = require('express');
const rateLimit = require('../../middleware/rateLimit');
const { validate } = require('../../middleware/validate');
const s = require('./contact.schema');
const c = require('./contact.controller');

const router = express.Router();
router.post('/', rateLimit({ name: 'contact', max: 5, window: 900 }), validate({ body: s.contact }), c.submit);

module.exports = router;
