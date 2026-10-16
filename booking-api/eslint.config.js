// ---------------------------------------------------------------------------
// ESLINT CONFIG  (V2.12 → Part XI: code quality)
//
// A linter catches CORRECTNESS problems (unused vars, unhandled promises, loose
// equality); a formatter (Prettier) settles STYLE. Keeping them separate means
// nobody debates formatting in review, and lint failures always mean something
// real. `eslint-config-prettier` (last in the list) disables any stylistic rules
// that would fight Prettier.
//
// Flat config (ESLint 9+): an array of config objects, applied in order.
// ---------------------------------------------------------------------------

import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
  { ignores: ['node_modules/**', 'coverage/**', 'dist/**'] },

  js.configs.recommended,

  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      // --- The async rules that catch REAL bugs in a Node backend -------------
      // `require-await` is deliberately OFF: it fires on async functions that
      // legitimately return a promise without awaiting it (test mocks, thin
      // pass-throughs), which is correct code. The rules below catch actual bugs
      // without that noise.
      'require-await': 'off',
      'no-return-await': 'error',
      // An async function passed as a Promise executor swallows rejections.
      'no-async-promise-executor': 'error',
      // A promise used where a value is expected — the classic missing `await`.
      'no-promise-executor-return': 'error',
      'no-await-in-loop': 'off', // intentional in the outbox relay & retries

      // --- Correctness --------------------------------------------------------
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-unused-vars': [
        'error',
        // Express error handlers need a 4-arg signature even when `next` is
        // unused, so allow deliberately-underscored args.
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      'no-console': ['warn', { allow: ['error', 'warn'] }], // we have a logger
      'no-throw-literal': 'error', // always throw Error objects
    },
  },

  // Tests and scripts are allowed to console.log freely.
  {
    files: ['tests/**/*.js', 'scripts/**/*.js'],
    rules: { 'no-console': 'off' },
  },

  prettier, // must be LAST: turns off rules that conflict with the formatter
];
