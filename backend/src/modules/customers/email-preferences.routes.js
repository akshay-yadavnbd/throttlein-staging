/**
 * /api/email — public cart-reminder unsubscribe pages. No login: the signed
 * link in the email is the credential, checked by the controller. They answer
 * HTML, not JSON, so this file is exempt from the validate() guard.
 */
const express = require('express');
const prefs = require('./email-preferences.controller');

const router = express.Router();
router.get('/unsubscribe/cart-reminders', prefs.confirmUnsubscribe);
router.post('/unsubscribe/cart-reminders', prefs.unsubscribe);

module.exports = router;
