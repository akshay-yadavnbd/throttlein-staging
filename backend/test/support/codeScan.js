/**
 * Shared machinery for the code-shape guards (test/codeShape.test.js): walk
 * `src/`, strip comments so a documented example never reads as a live call
 * site, and compare measurements against a baseline in BOTH directions — a
 * number that is wrong either way fails, so a baseline can never quietly
 * become decoration.
 */
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.resolve(__dirname, '../../src');

/**
 * Block comments go first, then any line whose first non-space character is
 * `//` or `*`. Deliberately not a general comment stripper: chopping every
 * `//` to end-of-line would eat URLs inside string literals.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith('//') && !trimmed.startsWith('*');
    })
    .join('\n');
}

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) walk(full, acc);
    else if (entry.endsWith('.js')) acc.push(full);
  }
  return acc;
}

/** Lines as `wc -l` counts them (newline characters), so CRLF files measure the same. */
const rawLines = (raw) => (raw.match(/\n/g) || []).length;

/** Every `.js` file under `src`, once: `{ rel, raw, source }` with `source` comment-stripped. */
function scanSource(root = SRC) {
  return walk(root).map((full) => {
    const raw = fs.readFileSync(full, 'utf8');
    return { rel: path.relative(root, full).split(path.sep).join('/'), raw, source: stripComments(raw) };
  });
}

/** All `require('<specifier>')` specifiers in a comment-stripped source. */
function requiresOf(source) {
  return [...source.matchAll(/require\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]);
}

/**
 * Measured counts vs a baseline object `{ key: number }`. Growth is a
 * violation; shrinkage means the baseline lies and must be lowered; a key
 * that is no longer measured must be removed. Returns readable failures.
 */
function ratchet(measured, baseline, { ceilingHint = '', fixHint = '' } = {}) {
  const failures = [];
  // An entry is a number, or `{ lines, reason }` when it was raised on purpose —
  // the reason is what a reviewer reads in the diff.
  const limitOf = (entry) => (typeof entry === 'number' ? entry : entry.lines);
  for (const [key, value] of measured) {
    if (!(key in baseline)) failures.push(`NEW   ${key} = ${value}${ceilingHint}. ${fixHint}`);
    else if (value > limitOf(baseline[key]))
      failures.push(`GREW  ${key} = ${value} (baseline ${limitOf(baseline[key])}). ${fixHint}`);
    else if (value < limitOf(baseline[key]))
      failures.push(`SHRANK ${key} = ${value} (baseline ${limitOf(baseline[key])}) — lower the baseline to ${value}.`);
  }
  for (const key of Object.keys(baseline)) {
    if (!measured.has(key)) failures.push(`STALE ${key} is no longer over the line — remove it from the baseline.`);
  }
  return failures;
}

/** Same idea for sets of names: extras are violations, missing names are stale. */
function ratchetSet(measured, baseline, { fixHint = '' } = {}) {
  const failures = [];
  const base = new Set(baseline);
  for (const name of measured) if (!base.has(name)) failures.push(`NEW   ${name}. ${fixHint}`);
  for (const name of base) if (!measured.has(name)) failures.push(`STALE ${name} — remove it from the baseline.`);
  return failures;
}

module.exports = { SRC, stripComments, walk, rawLines, scanSource, requiresOf, ratchet, ratchetSet };
