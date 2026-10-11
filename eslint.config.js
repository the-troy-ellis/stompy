import js from '@eslint/js';

const browserGlobals = {
  window: 'readonly', document: 'readonly', navigator: 'readonly', location: 'readonly', localStorage: 'readonly',
  requestAnimationFrame: 'readonly', devicePixelRatio: 'readonly', performance: 'readonly', fetch: 'readonly',
  matchMedia: 'readonly', addEventListener: 'readonly', screen: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
  WebSocket: 'readonly', Audio: 'readonly', AudioContext: 'readonly', speechSynthesis: 'readonly',
  SpeechSynthesisUtterance: 'readonly', console: 'readonly', Promise: 'readonly', URLSearchParams: 'readonly',
};
const nodeGlobals = { process: 'readonly', console: 'readonly', URL: 'readonly', setTimeout: 'readonly', performance: 'readonly' };

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: browserGlobals },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }], 'no-empty': ['error', { allowEmptyCatch: true }] },
  },
  {
    // The service worker runs in its own scope, not the page's.
    files: ['src/sw.js'],
    languageOptions: { globals: { self: 'readonly', caches: 'readonly', fetch: 'readonly', URL: 'readonly', Promise: 'readonly' } },
  },
  {
    // The simulation and its data know nothing about the page: no DOM, no GL,
    // no audio, no UI, no input. This is what keeps them testable headlessly.
    files: ['src/sim/**/*.js', 'src/data/**/*.js', 'src/world/**/*.js', 'src/util/math.js', 'src/mesh/**/*.js', 'src/net/protocol.js', 'src/net/interp.js'],
    languageOptions: { globals: { performance: 'readonly' } },
    rules: {
      'no-restricted-imports': ['error', { patterns: ['**/render/*', '**/audio/*', '**/ui/*', '**/input/*', '**/net/client*'] }],
      'no-restricted-globals': ['error', 'window', 'document', 'navigator', 'localStorage', 'requestAnimationFrame', 'fetch', 'AudioContext', 'speechSynthesis', 'location'],
    },
  },
  {
    // The smoke test's page.evaluate callbacks run in the browser.
    files: ['test/smoke/**/*.mjs', 'scripts/shoot.mjs', 'scripts/shootMech.mjs', 'scripts/shootProps.mjs', 'scripts/perf.mjs'],
    languageOptions: { globals: { window: 'readonly', document: 'readonly', localStorage: 'readonly', navigator: 'readonly', fetch: 'readonly', caches: 'readonly', createImageBitmap: 'readonly' } },
  },
  {
    files: ['test/**/*.js', 'test/**/*.mjs', 'scripts/**/*.mjs', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: nodeGlobals },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }] },
  },
];
