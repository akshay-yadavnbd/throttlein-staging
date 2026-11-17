/** The single notification-settings document, delivery stamps on it, and the admin audit trail for changes. */
const NotificationSettings = require('./notification-settings.model');
const AdminAuditLog = require('../admin/admin-audit-log.model');

/** The settings document (created on first use). */
const load = () => NotificationSettings.load();

/** Every address subscribed to any of the event(s): env list + active recipients, deduplicated. */
const recipientsFor = (event) => NotificationSettings.recipientsFor(event);

/**
 * `lastSentAt` on the recipients matched by `arrayFilter`. `timestamps: false`:
 * delivery metadata is not an edit to the settings and must not make them look freshly saved.
 */
const stampSent = (arrayFilter) =>
  NotificationSettings.updateOne(
    { _id: 'notifications' },
    { $set: { 'recipients.$[r].lastSentAt': new Date() } },
    { arrayFilters: [arrayFilter], timestamps: false },
  );

const audit = (entry) => AdminAuditLog.record(entry);

/** The event catalogue (key, label, description) the recipients page lists. */
const { EVENTS, EVENT_KEYS } = NotificationSettings;

module.exports = { EVENTS, EVENT_KEYS, load, recipientsFor, stampSent, audit };
