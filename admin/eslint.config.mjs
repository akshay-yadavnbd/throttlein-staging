// ESLint flat config. Next.js 16 removed the old `next lint` command, so
// `npm run lint` runs the ESLint CLI directly against this file.
//
// ── PIN ESLINT TO 9.x. DO NOT BUMP TO 10. ───────────────────────────
// This project was briefly on eslint@10.7.0, and linting was silently
// broken the whole time — every run died before checking a single file:
//
//   TypeError: Error while loading rule 'react/display-name':
//   contextOrFilename.getFilename is not a function
//
// eslint 10 changed the rule-context API. The plugins bundled by
// eslint-config-next@16 don't support it yet: eslint-plugin-react caps at
// ^9.7, eslint-plugin-import and eslint-plugin-jsx-a11y at ^9. npm reported
// all three as peer warnings on every install, which is easy to scroll past
// — the CLI crash is the part that mattered.
//
// `eslint-config-next` itself only asks for `eslint >=9.0.0`; eslint 10 was
// never validated against it. Revisit when eslint-plugin-react ships eslint
// 10 support.
//
// `defineConfig` and `globalIgnores` used below are available in 9.x —
// verified against 9.39.5, both exported from `eslint/config`.
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
