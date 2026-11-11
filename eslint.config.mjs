import js from '@eslint/js'
import stylistic from '@stylistic/eslint-plugin'
import eslintConfigPrettier from 'eslint-config-prettier/flat'
import importPlugin from 'eslint-plugin-import-x'
import perfectionist from 'eslint-plugin-perfectionist'
import { defineConfig } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const scriptFiles = ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}']
const typescriptFiles = ['**/*.{ts,tsx,mts,cts}']
const memberGroups = ['index-signature', 'required-member', 'optional-member', 'member', 'unknown']
const namingConvention = [
  'error',
  {
    selector: 'typeParameter',
    format: ['PascalCase'],
    custom: { regex: '^T[A-Z][a-zA-Z0-9]+$', match: true },
  },
  { selector: 'typeLike', format: ['PascalCase'] },
  { selector: 'property', modifiers: ['requiresQuotes'], format: null },
  {
    selector: ['classProperty', 'parameterProperty'],
    modifiers: ['private'],
    types: ['boolean'],
    format: ['camelCase'],
    leadingUnderscore: 'require',
    custom: { regex: '^(?:is|has|can|should)(?:[A-Z]|$)', match: false },
  },
  {
    selector: ['classProperty', 'parameterProperty'],
    modifiers: ['private'],
    format: ['camelCase'],
    leadingUnderscore: 'require',
  },
  {
    selector: ['variable', 'parameter', 'property'],
    types: ['boolean'],
    format: ['camelCase'],
    custom: { regex: '^(?:is|has|can|should)(?:[A-Z]|$)', match: false },
  },
  {
    selector: ['variable', 'function', 'parameter', 'memberLike'],
    format: ['camelCase'],
    leadingUnderscore: 'allow',
  },
]

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/build/**',
      '**/.pnpm-store/**',
      '**/*.generated.*',
    ],
  },
  js.configs.recommended,
  {
    files: scriptFiles,
    plugins: {
      '@stylistic': stylistic,
      'import-x': importPlugin,
      perfectionist,
    },
    settings: {
      ...importPlugin.flatConfigs.typescript.settings,
      'import-x/resolver': {
        typescript: {
          project: ['tsconfig.json', 'apps/*/tsconfig.json', 'packages/*/tsconfig.json'],
          noWarnOnMultipleProjects: true,
        },
        node: true,
      },
    },
    rules: {
      'array-callback-return': 'error',
      'consistent-return': 'error',
      curly: ['error', 'all'],
      eqeqeq: ['error', 'always'],
      'import-x/no-cycle': 'error',
      'import-x/no-duplicates': 'error',
      'import-x/no-extraneous-dependencies': [
        'error',
        {
          devDependencies: [
            '**/*.config.{js,mjs,cjs,ts,mts,cts}',
            '**/scripts/**',
            '**/tests/**',
            '**/*.{test,spec,stories}.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
          ],
        },
      ],
      'import-x/no-self-import': 'error',
      'import-x/no-unresolved': 'error',
      'no-alert': 'error',
      'no-constant-binary-expression': 'error',
      'no-debugger': 'error',
      'no-else-return': 'error',
      'no-eval': 'error',
      'no-fallthrough': 'error',
      'no-nested-ternary': 'error',
      'no-param-reassign': 'error',
      'no-unneeded-ternary': 'error',
      'no-unreachable': 'error',
      'no-unused-vars': ['error', { args: 'all', argsIgnorePattern: '^_', caughtErrors: 'all' }],
      'no-var': 'error',
      'no-warning-comments': ['warn', { terms: ['todo', 'fixme'], location: 'start' }],
      'object-shorthand': 'error',
      'prefer-const': 'error',
      'prefer-template': 'error',
    },
  },
  {
    files: scriptFiles,
    rules: {
      'perfectionist/sort-exports': ['error', { type: 'natural' }],
      'perfectionist/sort-imports': [
        'error',
        {
          type: 'natural',
          internalPattern: ['^@livescript/.+'],
          groups: [
            ['value-builtin', 'type-builtin'],
            ['value-external', 'type-external'],
            ['value-internal', 'type-internal'],
            ['value-parent', 'type-parent'],
            ['value-sibling', 'type-sibling', 'value-index', 'type-index'],
            'side-effect',
            'unknown',
          ],
        },
      ],
      'perfectionist/sort-named-exports': ['error', { type: 'natural' }],
      'perfectionist/sort-named-imports': ['error', { type: 'natural' }],
    },
  },
  {
    files: typescriptFiles,
    rules: {
      // Groups define the member order; declaration order is preserved inside each group.
      'perfectionist/sort-classes': [
        'error',
        {
          type: 'unsorted',
          groups: [
            'index-signature',
            'static-block',
            'static-property',
            'property',
            'constructor',
            ['static-get-method', 'static-set-method'],
            ['get-method', 'set-method'],
            'static-method',
            'method',
            'protected-method',
            'private-method',
            'unknown',
          ],
        },
      ],
      'perfectionist/sort-interfaces': ['error', { type: 'unsorted', groups: memberGroups }],
      'perfectionist/sort-object-types': ['error', { type: 'unsorted', groups: memberGroups }],
    },
  },
  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: typescriptFiles,
  })),
  ...tseslint.configs.stylisticTypeChecked.map((config) => ({
    ...config,
    files: typescriptFiles,
  })),
  {
    files: [
      '**/*.config.{js,mjs,cjs,ts,mts,cts}',
      '**/scripts/**/*.{js,mjs,cjs,ts,mts,cts}',
      '**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.{js,jsx,mjs,cjs}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/naming-convention': namingConvention,
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: false }],
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/return-await': ['error', 'in-try-catch'],
    },
  },
  {
    files: typescriptFiles,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-indexed-object-style': ['error', 'index-signature'],
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      '@typescript-eslint/consistent-type-exports': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/explicit-member-accessibility': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/naming-convention': namingConvention,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: false }],
      '@typescript-eslint/no-inferrable-types': [
        'error',
        { ignoreParameters: true, ignoreProperties: true },
      ],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-unnecessary-type-parameters': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { args: 'all', argsIgnorePattern: '^_', caughtErrors: 'all' },
      ],
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/prefer-readonly': 'error',
      '@typescript-eslint/return-await': ['error', 'in-try-catch'],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'PropertyDefinition:not([typeAnnotation])',
          message: 'Class properties must have an explicit type annotation.',
        },
        {
          selector:
            'TSParameterProperty[parameter.type="AssignmentPattern"]:not([parameter.left.typeAnnotation])',
          message: 'Parameter properties must have an explicit type annotation.',
        },
        {
          selector:
            'TSParameterProperty[parameter.type="Identifier"]:not([parameter.typeAnnotation])',
          message: 'Parameter properties must have an explicit type annotation.',
        },
      ],
    },
  },
  eslintConfigPrettier,
  {
    // Prettier owns token spacing; these rules only manage structural blank lines, so they stay
    // enabled after the Prettier compatibility config.
    files: scriptFiles,
    rules: {
      '@stylistic/lines-between-class-members': [
        'error',
        'always',
        { exceptAfterSingleLine: true },
      ],
      '@stylistic/padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: 'multiline-block-like', next: '*' },
      ],
    },
  },
)
