import js from '@eslint/js';
import configPrettier from 'eslint-config-prettier';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

const appFiles = ['**/*.{js,jsx}'];

export default [
  {
    ignores: [
      'node_modules/**',
      'node_modules.backup/**',
      'dist/**',
      '.expo/**',
      'android/**',
      'ios/**',
      'coverage/**',
      'backups/**',
      'supabase/.temp/**',
      'theme/CapsulePressable.jsx',
      '**/*.backup.*',
      'com.facebook.react.*',
      'java.util.concurrent.*',
    ],
  },
  js.configs.recommended,
  {
    files: appFiles,
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        __DEV__: 'readonly',
        console: 'readonly',
        process: 'readonly',
        fetch: 'readonly',
        require: 'readonly',
        module: 'readonly',
        global: 'readonly',
        document: 'readonly',
        location: 'readonly',
        URL: 'readonly',
        AbortController: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/jsx-uses-vars': 'warn',
      'react-hooks/rules-of-hooks': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      'no-empty': 'off',
      'no-redeclare': 'off',
      'no-dupe-keys': 'warn',
      'no-undef': 'off',
      'no-useless-catch': 'off',
      'no-useless-escape': 'off',
      'no-sparse-arrays': 'off',
      'no-case-declarations': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error', 'info', 'debug'] }],
    },
  },
  configPrettier,
];
