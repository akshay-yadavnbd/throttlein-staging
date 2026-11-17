import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

/**
 * Backend lint. Three layers:
 *   1. ESLint's recommended rules (real bugs: undefined names, unreachable
 *      code, duplicate keys, …).
 *   2. House rules that mirror docs/backend-conventions.md so a violation
 *      shows in the editor, not only in the shape guard:
 *        - no `console` in server-process code (utils/logger instead);
 *        - no `process.env` outside config/env.js;
 *        - no `res.status(4xx).json(...)` for failures (throw AppError).
 *   3. Prettier's config last, so no formatting rule fights the formatter.
 *
 * Test files run under the vitest globals; CLI tools may print.
 */

/** Files a person runs in a terminal — they print on purpose (same list as test/codeShape.test.js). */
const CLI_FILES = [
  'src/config/env.js',
  'src/utils/testSmtp.js',
  'src/utils/redisInspector.js',
  'src/database/seed/**/*.js',
  'scripts/**/*.js',
  'loadEnv.js',
  'server.js',
];

const vitestGlobals = {
  test: 'readonly',
  it: 'readonly',
  describe: 'readonly',
  expect: 'readonly',
  vi: 'readonly',
  beforeAll: 'readonly',
  afterAll: 'readonly',
  beforeEach: 'readonly',
  afterEach: 'readonly',
};

export default [
  { ignores: ['node_modules/**', 'uploads/**', 'private-uploads/**', 'dist/**', 'coverage/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.es2021 },
    },
    rules: {
      'no-unused-vars': [
        'error',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-console': 'error',
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message: 'Read configuration through `env` from src/config/env.js (declare the key in its schema).',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='json'][callee.object.callee.property.name='status'][callee.object.arguments.0.value>=400]",
          message: 'Throw AppError.<factory>(message, details?) and let the error layer answer.',
        },
      ],
    },
  },
  { files: ['eslint.config.mjs', 'vitest.config.mjs'], languageOptions: { sourceType: 'module' } },
  { files: CLI_FILES, rules: { 'no-console': 'off', 'no-restricted-properties': 'off' } },
  { files: ['src/modules/mcp/index.js'], rules: { 'no-restricted-syntax': 'off' } }, // JSON-RPC answers
  {
    files: ['test/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...vitestGlobals } },
    rules: { 'no-console': 'off', 'no-restricted-properties': 'off', 'no-restricted-syntax': 'off' },
  },
  prettier,
];
