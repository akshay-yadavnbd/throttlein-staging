// Compatibility entry point for the original commerce verification command.
// The September 24 suites supersede its mocked database operations with an
// isolated MongoDB replica set, fault injection, and real multipart requests.
// No production database, payment gateway, or carrier is contacted.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const backend = path.resolve(__dirname, '../../backend');
for (const args of [['test'], ['run', 'test:integration']]) {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd: backend, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
