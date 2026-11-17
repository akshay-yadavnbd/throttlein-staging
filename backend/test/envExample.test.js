/**
 * `.env.example` and the schema in src/config/env.js describe the same set of
 * keys. A key the server reads but the example never mentions is a deploy
 * surprise; a key in the example the server never reads is a lie. A commented
 * line (`# KEY=value`) counts as mentioned — it documents an optional default.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ENV_KEYS } = require('../src/config/env');

const exampleKeys = () =>
  new Set(
    fs
      .readFileSync(path.resolve(__dirname, '../.env.example'), 'utf8')
      .split(/\r?\n/)
      .map((line) => /^#?\s*([A-Z][A-Z0-9_]*)=/.exec(line.trim()))
      .filter(Boolean)
      .map((m) => m[1]),
  );

test('every declared env key appears in .env.example', () => {
  const keys = exampleKeys();
  assert.deepEqual(
    ENV_KEYS.filter((k) => !keys.has(k)),
    [],
    'add the key to .env.example with a comment saying what it does',
  );
});

test('.env.example mentions only declared keys', () => {
  const declared = new Set(ENV_KEYS);
  assert.deepEqual(
    [...exampleKeys()].filter((k) => !declared.has(k)),
    [],
    'declare the key in src/config/env.js or drop it from the example',
  );
});
