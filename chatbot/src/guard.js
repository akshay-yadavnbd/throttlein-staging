/**
 * Guardrails that do not depend on the model behaving.
 *
 * - Scope by construction: the model can only act through the tools its role
 *   is given (./mcp/tools.js), and those tools only reach allow-listed API
 *   routes with the user's own JWT. There is no tool for orders, payouts,
 *   other sellers, staff or code — so there is nothing to leak or break even
 *   if the prompt is subverted.
 * - Input hygiene: message size, control characters, history length, per-user
 *   rate limit, and a short-circuit for blatant jailbreak attempts so they
 *   never reach the model.
 * - Output hygiene: tool results are trimmed and free text written by sellers
 *   is marked as data, not instructions.
 */
'use strict';

const INVISIBLE_RANGES = [[0x00, 0x08], [0x0b, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x2064], [0x2066, 0x2069], [0xfeff, 0xfeff]];
const cp = (n) => `\\u${n.toString(16).padStart(4, '0')}`;
const INVISIBLE = new RegExp(`[${INVISIBLE_RANGES.map(([a, b]) => (a === b ? cp(a) : `${cp(a)}-${cp(b)}`)).join('')}]`, 'g');

const JAILBREAK = [
  /ignore (all|any|the|your) (previous|prior|above|earlier) (instructions|rules|prompt)/i,
  /disregard (all|your|the) (previous|prior|above) (instructions|rules)/i,
  /(reveal|print|show|repeat|output) (me )?(your|the) (system|hidden|secret) (prompt|instructions|message)/i,
  /you are now (dan|an? (unrestricted|unfiltered|jailbroken))/i,
  /\bdeveloper mode\b/i,
  /pretend (you have|there are) no (rules|restrictions|guidelines)/i,
];

const REFUSAL = 'I can only help with your Throttlein product catalogue — listing, prices, stock, descriptions and product status. I can\'t change how I work or step outside that. What would you like to do with your products?';

function sanitize(text, max) {
  return String(text || '').normalize('NFKC').replace(INVISIBLE, '').slice(0, max);
}

/** Validates and normalises the conversation the widget sends. Returns { messages } or throws { status, message }. */
function normalizeConversation(input, limits) {
  const raw = Array.isArray(input?.messages) ? input.messages : null;
  if (!raw || !raw.length) throw Object.assign(new Error('Send at least one message.'), { status: 400 });
  const messages = [];
  for (const m of raw.slice(-limits.maxHistory)) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') continue;
    const content = sanitize(m.content, limits.maxMessageChars);
    if (!content.trim()) continue;
    messages.push({ role: m.role, content });
  }
  if (!messages.length || messages[messages.length - 1].role !== 'user') throw Object.assign(new Error('The last message must be from you.'), { status: 400 });
  if (String(raw[raw.length - 1].content || '').length > limits.maxMessageChars) throw Object.assign(new Error(`Keep a message under ${limits.maxMessageChars} characters.`), { status: 400 });
  return { messages };
}

/** A canned answer for obvious jailbreak attempts; null to proceed. */
function shortCircuit(text) {
  return JAILBREAK.some((re) => re.test(text)) ? REFUSAL : null;
}

/** Fixed-window per-user rate limit, in memory (one assistant process). */
function createRateLimiter({ max, windowMs }) {
  const buckets = new Map();
  return (key) => {
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.expires <= now) { b = { count: 0, expires: now + windowMs }; buckets.set(key, b); }
    if (buckets.size > 10000) for (const [k, v] of buckets) if (v.expires <= now) buckets.delete(k);
    b.count += 1;
    return { allowed: b.count <= max, retryAfterSeconds: Math.max(1, Math.ceil((b.expires - now) / 1000)) };
  };
}

/** Seller-written text goes to the model as data, cleaned and bounded. */
const untrusted = (value, max = 600) => (value === null || value === undefined || value === '' ? null : { untrusted: true, text: sanitize(value, max) });

/** Bound a tool result before it reaches the model's context. */
function boundToolResult(text, max) {
  const s = String(text || '');
  return s.length > max ? `${s.slice(0, max)}\n…[truncated: ask for fewer rows or a narrower filter]` : s;
}

/** Strip reasoning blocks a model might emit despite reasoning_format=hidden. */
const stripThinking = (text) => String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

module.exports = { sanitize, normalizeConversation, shortCircuit, createRateLimiter, untrusted, boundToolResult, stripThinking, REFUSAL };
