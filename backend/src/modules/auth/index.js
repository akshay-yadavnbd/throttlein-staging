/**
 * Auth module — public surface. Registration, email verification, sign-in,
 * profile, password change and reset.
 *
 *   routes      auth.routes.js             /api/auth
 *   controller  auth.controller.js         HTTP ⇄ service, no rules
 *   services    seller-signup, account, password-reset
 *   pure        profile-input (whitelist + clamps), auth-emails (templates + brand header)
 *   data        auth.repository (User)
 *
 * `routes/authRoutes.js` re-exports this module's router.
 */
const controller = require('./auth.controller');
const { brandLogoUrl, brandHeaderHtml, buildVerifyUrl } = require('./auth-emails');

module.exports = {
  ...controller,
  // Shared with other modules' emails (staff invites, onboarding reminders)
  brandLogoUrl,
  brandHeaderHtml,
  buildVerifyUrl,
  routes: require('./auth.routes'),
};
