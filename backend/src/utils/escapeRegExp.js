/**
 * Escape a user-supplied string so it can be embedded in a `new RegExp(...)`
 * as a LITERAL — every regex metacharacter is backslash-escaped.
 *
 * Why this exists: several search endpoints build `new RegExp(req.query.q, 'i')`.
 * Without escaping, a crafted `q` (e.g. `(a+)+$`) triggers catastrophic
 * backtracking against every document — a ReDoS that pins a CPU core and can
 * take the API down. Escaping turns the input into a plain substring match.
 *
 * The length is also clamped: an attacker can't make Mongo scan with a
 * pathologically long pattern, and a 200-char search term is already absurd.
 */
function escapeRegExp(input, { maxLen = 200 } = {}) {
  return String(input == null ? '' : input)
    .slice(0, maxLen)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = escapeRegExp;
