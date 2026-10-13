// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/target/**',
      'docs/**/*.md',
      '**/coverage/**',
      'tests/e2e/.work/**',
      'tests/e2e/report/**',
      '.dev/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        projectService: {
          allowDefaultProject: ['vitest.config.ts', 'src/web/vite.config.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
    },
  },
  {
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },
  {
    files: [
      'eslint.config.js',
      'vitest.config.ts',
      '**/vite.config.ts',
      'tests/e2e/**/*.ts',
      'build/**/*.ts',
    ],
    languageOptions: { globals: { ...globals.node } },
  },
);
