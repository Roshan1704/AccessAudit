import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/drizzle.config.ts',
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': 'error',
    },
  },
  {
    // Root tool configs sit outside any tsconfig project, so they get syntax-only linting.
    files: [
      '**/*.mjs',
      '**/*.js',
      'playwright.config.ts',
      'vitest.config.mts',
      'apps/web/vite.config.ts',
    ],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { parserOptions: { projectService: false } },
  },
  {
    // HTTP test responses are untyped JSON; assertions validate the shape.
    files: ['**/*.test.ts', '**/test-harness.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
    },
  },
  {
    // React event handlers idiomatically use shorthand arrows that call state setters.
    files: ['apps/web/**/*.ts', 'apps/web/**/*.tsx'],
    ignores: ['apps/web/vite.config.ts'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
    },
  },
  prettier,
);
