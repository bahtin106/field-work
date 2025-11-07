// eslint.config.js — минимальный и спокойный конфиг для Expo (JS/JSX)
import js from '@eslint/js';
import configPrettier from 'eslint-config-prettier';
import prettier from 'eslint-plugin-prettier';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  js.configs.recommended,
  {
    plugins: {
      react,
      'react-hooks': reactHooks,
      prettier,
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      // интеграция с Prettier (только предупреждения по формату)
      'prettier/prettier': 'warn',

      // React 17+ / Expo — React в скоупе не обязателен
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',

      // базовая гигиена, без жёстких правил
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // Mark variables used in JSX as used (prevents false positives for component imports)
      'react/jsx-uses-vars': 'warn',

      // смягчаем типичные придирки
      'react/no-unknown-property': 'off',
      'react/jsx-no-target-blank': 'off',
    },
  },

  // Снимаем конфликты с форматированием
  configPrettier,
];
