/**
 * Picks which tool areas a turn needs. Every tool schema is re-sent on every
 * model call, and the full seller set (~30 tools) would not fit Groq's free
 * tier (~8k tokens a minute), so the model sees only the areas the recent
 * conversation is about. Areas from the last few user messages are kept so a
 * follow-up ("and the second one?") still has its tools; a pending
 * confirmation always keeps its own tool's area.
 */
'use strict';

const AREA_PATTERNS = {
  catalog: /\b(products?|catalog(ue)?|listings?|stock|inventory|prices?|mrp|rates?|sku|drafts?|publish|unpublish|out of stock|sizes?|colou?rs?|descriptions?|categor(y|ies)|brands?|weight|featured?|seo|low[- ]stock|best[- ]?sell(ers?|ing)?|top[- ]?sell(ers?|ing)?|most sold|selling|sold)\b/i,
  import: /https?:\/\/|\b(url|link|import|add (a |new )?product|new product|create (a )?product|scrape)\b/i,
  orders: /\b(orders?|ship(ping|ment|ped)?|dispatch|couriers?|pickups?|awb|labels?|track(ing)?|deliver(y|ed|ies)?|ndr|rto|cancel(led|lation)?|confirm(ed)?|tin-\d{4})/i,
  returns: /\b(returns?|exchanges?|refunds?|replacements?|reverse pickup)\b/i,
  payouts: /\b(payouts?|settlements?|earnings?|earned|paid out|utr|money|revenue|income|due)\b/i,
  offers: /\b(offers?|discounts?|deals?|sale price|% off|coupons?|promotions?)\b/i,
  offline: /\b(offline|walk[- ]?in|counter sale|shop sale|in[- ]store|sold (in|at) (the )?(shop|store))\b/i,
  media: /\b(media|images?|photos?|pictures?|gallery|files?)\b/i,
  requests: /\b(brand request|category request|new brand|new category|request (a |for a )?(brand|category)|requests?)\b/i,
  profile: /\b(profile|store name|shop name|phone|address|cod|cash on delivery|return polic(y|ies)|exchange polic(y|ies)|return days|delivery charges?|who pays|exclude[sd]?|pincodes?|states?|kyc|verification|account|settings?)\b/i,
};

const DEFAULT_AREAS = ['catalog', 'orders'];

function areasFor(text) {
  return Object.entries(AREA_PATTERNS).filter(([, re]) => re.test(text || '')).map(([area]) => area);
}

/**
 * @param messages  the conversation (role/content)
 * @param pending   a carried previewed change ({tool}) or null
 * @param toolGroups map tool name → its areas
 */
function pickAreas(messages, pending, toolGroups) {
  const users = messages.filter((m) => m.role === 'user');
  const latest = areasFor(users[users.length - 1]?.content);
  const recent = users.slice(-3, -1).flatMap((m) => areasFor(m.content));
  const areas = new Set([...latest, ...recent]);
  if (pending?.tool && toolGroups[pending.tool]) for (const g of toolGroups[pending.tool]) areas.add(g);
  if (!latest.length && !areas.size) DEFAULT_AREAS.forEach((a) => areas.add(a));
  // Adding a product needs the category lookup and the catalogue it lands in.
  if (areas.has('import')) areas.add('catalog');
  return [...areas];
}

module.exports = { pickAreas, areasFor, AREA_PATTERNS, DEFAULT_AREAS };
