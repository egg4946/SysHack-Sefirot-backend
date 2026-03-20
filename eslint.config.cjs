const { defineConfig } = require('eslint/config');

module.exports = defineConfig({
  ignores: ['node_modules', 'dist', 'build', '.vite', '.cache', 'coverage', 'public'],
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  // no extends to avoid legacy/plugin-style shareable configs in flat mode
  rules: {
    'no-console': ['warn', { allow: ['warn', 'error'] }],
  },
});
