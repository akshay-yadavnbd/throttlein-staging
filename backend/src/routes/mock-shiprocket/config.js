/** Mock-mode switches shared by the mock Shiprocket pages. */
const { env } = require('../../config/env');

const MOCK = String(env.SHIPROCKET_MOCK_MODE || '').toLowerCase() === 'true';
const MOCK_BASE_URL = env.BACKEND_PUBLIC_URL || `http://localhost:${env.PORT || 5000}`;

module.exports = { MOCK, MOCK_BASE_URL };
