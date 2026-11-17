/**
 * Which deployment this process is: 'production', 'staging' or whatever
 * NODE_ENV says when APP_ENV is unset.
 *
 * NODE_ENV stays 'production' on every deployed environment, including
 * staging, so error masking, HSTS, the JWT strength check, strict CORS and
 * the webhook-token requirement behave exactly as on the live site.
 * APP_ENV only answers one narrower question: is this the live site with
 * real money and real couriers? The Shiprocket mock-mode guards use it so
 * staging can run with SHIPROCKET_MOCK_MODE=true without burning wallet
 * balance, while production still refuses to start in mock mode.
 *
 * APP_ENV is set by docker-compose.yml from the deploy target; never in .env.
 */
'use strict';
const { env } = require('./env');

/** True only on the live production site (NODE_ENV and APP_ENV both production; APP_ENV defaults to NODE_ENV). */
const isLive = () => env.isProduction && String(env.APP_ENV || env.NODE_ENV).toLowerCase() === 'production';

module.exports = { isLive };
