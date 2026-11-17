/**
 * Notifications module — public surface. Internal "tell the team" email
 * (one sender every module uses) and the superadmin's recipient list.
 *
 *   routes      notifications.routes.js     admin (/api/admin/notifications)
 *   controller  notifications.controller.js HTTP ⇄ service, no rules
 *   services    notify-team (the sender), recipients (admin management)
 *   pure        team-email (internal email chrome); teams-transport (optional Microsoft Teams card)
 *   data        notifications.repository.js
 *   model       notification-settings.model.js
 */
const { notifyTeam } = require('./notify-team.service');
const { teamEmailHtml } = require('./team-email');

module.exports = {
  routes: require('./notifications.routes'),
  /** Never throws; returns `{ sent, recipients }`. Used by auth, sellers and orders. */
  notifyTeam,
  teamEmailHtml,
};
