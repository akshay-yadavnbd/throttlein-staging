/**
 * Single env loader for every backend entry point.
 *
 * Always loads backend/.env regardless of which subdirectory the calling
 * script lives in — so seed scripts, migrations and the server all
 * `require()` this file and pick up the same vars without each computing
 * its own relative path.
 *
 * Usage:
 *   - backend/src/index.js         → require('./config/loadEnv')
 *   - backend/src/utils/X.js       → require('../config/loadEnv')
 *   - backend/scripts/X.js         → require('../loadEnv') (the shim in backend/)
 *
 * It lives in src/ so the build compiles it with everything else; from
 * dist/config/ the path below still reaches backend/.env.
 *
 * The file does its work as a side-effect at require time, then exits.
 * Calling it twice is harmless — dotenv won't override already-set vars.
 */
const path = require('path');

require('dotenv').config({
  path: path.resolve(__dirname, '..', '..', '.env'),
  // dotenv 17 prints an "injected env … dotenvx" tip on every load; the
  // validated config in src/config/env.js reports what matters.
  quiet: true,
});
