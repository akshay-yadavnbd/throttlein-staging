// ESLint flat config. Next.js 16 removed the old `next lint` command, so
// `npm run lint` runs the ESLint CLI directly against this file.
//
// ── PIN ESLINT TO 9.x. DO NOT BUMP TO 10. ───────────────────────────
// See the fuller note in admin/eslint.config.mjs. Short version: on
// eslint@10 the CLI crashes in eslint-plugin-react before linting anything
// ("contextOrFilename.getFilename is not a function"), because the plugins
// bundled by eslint-config-next@16 cap at eslint ^9. Linting was silently
// dead while this project sat on 10.7.0.
//
// `defineConfig` / `globalIgnores` are available in 9.x — verified on 9.39.5.
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Long-standing codebase style — don't fail the lint run on these.
      '@typescript-eslint/no-explicit-any': 'off',
      'react/no-unescaped-entities': 'off',
    },
  },
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']),
]);

export default eslintConfig;
