import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', 'user-data/**', 'test-results/**', 'playwright-report/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // The simulation must stay deterministic and free of rendering, DOM, network and filesystem.
    files: ['packages/sim/src/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'fetch',
        'performance',
        'setTimeout',
        'setInterval',
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded Rng from rng.ts.' },
        { object: 'Date', property: 'now', message: 'Simulation time comes from the tick counter.' },
      ],
      'no-restricted-imports': ['error', { patterns: ['node:*', 'three', 'react', 'ws', 'fs', 'path'] }],
    },
  },
  {
    files: ['apps/client/src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['apps/server/**/*.ts', 'tools/**/*.{js,mjs}', '*.config.{js,ts}', 'packages/*/src/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
);
