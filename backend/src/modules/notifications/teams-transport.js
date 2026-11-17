const { env } = require('../../config/env');
const { logger } = require('../../utils/logger');
/** Optional transport for notifyTeam. No database, worker, or startup hook.
 * Clear TEAMS_SELLER_WEBHOOK_URL to disable it; email remains independent.
 */
const WEBHOOK_ENV_BY_EVENT = {
  sellerSignupKyc: 'TEAMS_SELLER_WEBHOOK_URL',
};

function validateWebhook(value) {
  const url = new URL(value);
  const powerPlatform =
    /^[a-z0-9-]+\.[a-z0-9-]+\.environment\.api\.powerplatform\.com$/i.test(url.hostname) &&
    /^\/powerautomate\/automations\/direct\/(?:[a-z0-9-]+\/\d+\/)?workflows\/[a-f\d-]+\/triggers\/manual\/paths\/invoke$/i.test(
      url.pathname,
    );
  const logicApps =
    /^[a-z0-9-]+\.[a-z0-9-]+\.logic\.azure\.com$/i.test(url.hostname) &&
    /^\/workflows\/[a-f\d-]+\/triggers\/manual\/paths\/invoke$/i.test(url.pathname);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== '443') ||
    !(powerPlatform || logicApps) ||
    !url.searchParams.get('sig') ||
    !url.searchParams.get('api-version')
  ) {
    throw new Error('Invalid Teams Workflow URL.');
  }
  return url.href;
}

function cardText(value) {
  return String(value ?? '')
    .slice(0, 300)
    .replace(/[\\`*_{}[\]()<>#!|~]/g, '\\$&');
}

function buildCard(notice) {
  const origin = new URL(env.ADMIN_ORIGIN);
  if (
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== '/' ||
    (origin.protocol !== 'https:' &&
      !(!env.isProduction && origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname)))
  ) {
    throw new Error('Invalid admin origin.');
  }
  // Callers provide only an application path, never an external destination.
  if (!/^\/(?!\/)/.test(notice.adminPath) || notice.adminPath.includes('\\')) throw new Error('Invalid admin path.');
  const card = {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.2',
    body: [
      { type: 'TextBlock', text: cardText(notice.heading), weight: 'Bolder', size: 'Medium', wrap: true },
      ...(notice.rows || []).slice(0, 12).map(({ label, value }) => ({
        type: 'TextBlock',
        text: `${cardText(label)}: ${cardText(value)}`,
        wrap: true,
        spacing: 'Small',
      })),
    ],
    actions: [
      {
        type: 'Action.OpenUrl',
        title: cardText(notice.actionLabel || 'Open admin'),
        url: `${origin.origin}${notice.adminPath}`,
      },
    ],
  };
  return {
    type: 'message',
    attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null, content: card }],
  };
}

async function sendTeamsNotification({ event, notice }, fetchImpl = fetch) {
  // Explicit safe display fields are required. Never forward email HTML/text:
  // existing KYC emails contain details unsuitable for a channel message.
  if (!notice) return;
  try {
    const urls = new Set(
      []
        .concat(event)
        .map((key) => (Object.hasOwn(WEBHOOK_ENV_BY_EVENT, key) ? env[WEBHOOK_ENV_BY_EVENT[key]]?.trim() : ''))
        .filter(Boolean)
        .map(validateWebhook),
    );
    if (!urls.size) return;
    const body = JSON.stringify(buildCard(notice));
    await Promise.allSettled(
      [...urls].map(async (url) => {
        try {
          const response = await fetchImpl(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            redirect: 'error',
            signal: AbortSignal.timeout(5000),
          });
          // Never log URLs or read response bodies; either can expose the secret.
          if (!response.ok) logger.warn(`[teams] Workflow returned HTTP ${response.status}.`);
          if (response.body) await response.body.cancel();
        } catch {
          logger.warn('[teams] Workflow request failed or timed out.');
        }
      }),
    );
  } catch {
    logger.warn('[teams] Notification skipped; check TEAMS_SELLER_WEBHOOK_URL and ADMIN_ORIGIN.');
  }
}

module.exports = { sendTeamsNotification, buildCard, validateWebhook };
