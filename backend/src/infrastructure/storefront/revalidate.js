const { env } = require('../../config/env');
const { logger } = require('../../utils/logger');
/**
 * Fire-and-forget POST to the storefront's /api/revalidate endpoint so
 * Next.js drops its ISR cache for a path after an admin save. Without
 * this, admin edits surface on the live site only after the page's
 * `revalidate` window elapses (60s-5min depending on the section).
 *
 * Env:
 *   FRONTEND_ORIGIN      — where to POST (e.g. https://throttlein.com)
 *   REVALIDATE_SECRET    — shared with the Next.js route
 *
 * Failures are logged but never thrown — admin saves shouldn't break
 * because the frontend is briefly offline.
 */
function revalidatePath(path) {
  const origin = (env.FRONTEND_ORIGIN || '').replace(/\/$/, '');
  const secret = env.REVALIDATE_SECRET || '';
  if (!origin || !secret) return; // not configured — silent no-op
  const url = `${origin}/api/revalidate`;
  // Node 18+ has global fetch. Don't await — fire and forget so the
  // admin's PUT response isn't delayed by a slow frontend.
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ path }),
  }).catch((e) => {
    logger.warn({ err: e }, `[revalidate] ${path} failed:`);
  });
}

module.exports = { revalidatePath };
