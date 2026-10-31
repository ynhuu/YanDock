import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import hooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': hooks },
    rules: hooks.configs.recommended.rules,
  },
  {
    files: ['src/shared/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/features/**', '**/app/**'],
              message: '共享模块不能反向依赖功能或页面组装层。',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/features/{auth,project,sessions,terminal}/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/workspace/**', '**/app/**'],
              message:
                '功能模块通过 props 或回调与工作台协作，不反向导入组装层。',
            },
          ],
        },
      ],
    },
  },
)
