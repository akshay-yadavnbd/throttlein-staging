/**
 * Shiprocket API client — the one place the app talks to Shiprocket (auth, errors and
 * mock mode live in client.js). Endpoint wrappers are grouped by concern; import this
 * index, never a group file.
 */
const { getToken } = require('./client');

module.exports = {
  // Auth utility (rarely used directly — exposed for debug / scripts).
  getToken,
  ...require('./pickups'),
  ...require('./shipments'),
  ...require('./operations'),
};
