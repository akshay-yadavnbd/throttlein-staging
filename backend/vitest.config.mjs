import { defineConfig } from 'vitest/config';

/**
 * One `npm test`, two projects:
 *
 *   unit         — everything that runs without a database (stubs, VM-loaded
 *                  modules, in-process HTTP). Fast; run it on every change.
 *   integration  — suites that boot mongodb-memory-server (checkout, stock,
 *                  refunds, shipment sync, archive, cart reminders, MCP).
 *                  The first run downloads a MongoDB binary; later runs reuse it.
 *
 * Test files are CommonJS (`require`) and use the vitest globals
 * (`test`, `expect`, `vi`, `beforeAll`, …) plus `node:assert/strict`.
 * Every file runs in its own forked worker, so a suite that mutates
 * `process.env` or hooks `Module._load` never leaks into another.
 */
const INTEGRATION = [
  'test/commerceSecurity.test.js',
  'test/orderArchive.test.js',
  'test/cartReminders.test.js',
  'test/mcp.test.js',
];

export default defineConfig({
  test: {
    globals: true,
    restoreMocks: true,
    unstubGlobals: true,
    pool: 'forks',
    testTimeout: 30_000,
    // mongodb-memory-server may download a binary on first run.
    hookTimeout: 180_000,
    projects: [
      { extends: true, test: { name: 'unit', include: ['test/**/*.test.js'], exclude: INTEGRATION } },
      { extends: true, test: { name: 'integration', include: INTEGRATION } },
    ],
  },
});
