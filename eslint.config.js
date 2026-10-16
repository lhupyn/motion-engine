import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/', 'types/', '.shots/', '.claude/'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
  },
];
