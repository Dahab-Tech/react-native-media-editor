const { defineConfig } = require('eslint/config');
const universe = require('eslint-config-universe/flat/native');
const universeWeb = require('eslint-config-universe/flat/web');
const globals = require('globals');

module.exports = defineConfig([
  { ignores: ['build'] },
  ...universe,
  ...universeWeb,
  // Config files (metro.config.js, babel.config.js, …) run under Node.
  {
    files: ['**/*.config.js', '**/*.config.cjs', '**/*.cjs'],
    languageOptions: { globals: globals.node },
  },
]);
