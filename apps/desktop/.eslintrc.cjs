module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'no-restricted-syntax': [
      'error',
      {
        selector: "CallExpression[callee.object.name='window'][callee.property.name='dispatchEvent']",
        message: 'Use eventBus.publish(EVENT.*) instead of window.dispatchEvent.',
      },
      {
        selector: "NewExpression[callee.name='CustomEvent']",
        message: 'Use centralized EVENT constants via eventBus.publish.',
      },
      {
        selector: "NewExpression[callee.name='Event']",
        message: 'Use centralized EVENT constants via eventBus.publish.',
      },
      {
        selector: "CallExpression[callee.object.name='window'][callee.property.name='addEventListener']",
        message: 'Use eventBus.subscribe(EVENT.*) for app events.',
      },
      {
        selector: "CallExpression[callee.object.name='window'][callee.property.name='removeEventListener']",
        message: 'Use unsubscribe returned by eventBus.subscribe.',
      },
      {
        selector: "CallExpression[callee.object.name='eventBus'][callee.property.name='publish'][arguments.0.type='Literal']",
        message: 'Use EVENT constants, do not pass string literals to eventBus.publish.',
      },
      {
        selector: "CallExpression[callee.object.name='eventBus'][callee.property.name='subscribe'][arguments.0.type='Literal']",
        message: 'Use EVENT constants, do not pass string literals to eventBus.subscribe.',
      },
      {
        selector: "CallExpression[callee.object.name='eventBus'][callee.property.name='once'][arguments.0.type='Literal']",
        message: 'Use EVENT constants, do not pass string literals to eventBus.once.',
      },
    ],
  },
  overrides: [
    {
      files: ['src/kernel/events/bus.ts', 'src/kernel/events/browser.ts'],
      rules: {
        'no-restricted-syntax': 'off',
      },
    },
  ],
}
