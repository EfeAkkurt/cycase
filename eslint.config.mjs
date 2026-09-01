import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Lint gate for the audit contract (P0 step 1). Kept intentionally close to the
 * TypeScript compiler's own strictness: `tsc` already runs with everything on,
 * so this layer exists for the rule classes the compiler cannot see — hooks
 * misuse, unused directives, foot-gun equality.
 */
export default tseslint.config(
  // Mirrors .gitignore. `dist-*` is a parallel run's build output and
  // `.playwright-cli` holds the trace viewer's own
  // bundled resources; linting them made the gate depend on whether anyone
  // had opened a trace, which is not a property of this codebase.
  { ignores: ['dist', 'dist-*', 'node_modules', '.claude', '.assets-raw', 'output', 'playwright-report', 'test-results', 'scripts/.dist', '.playwright-cli'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      /*
       * The classic two hooks rules only. The v6 "recommended" set ships the
       * React Compiler lints, and those flag every imperative Three.js mutation
       * inside `useFrame` — which is the idiom React Three Fiber is built on,
       * not a defect. The compiler rules would have to be disabled per-file
       * across src/three anyway, at which point they guard nothing.
       */
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      // The engine deliberately narrows unknown tool input after zod parsing.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'smart'],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['scripts/**/*.{mjs,ts}', '*.config.ts'],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'off' },
  },
  {
    files: ['tests/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
);
