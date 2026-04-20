// Peers-Touch Conventional Commits configuration
// Enforced via husky pre-commit hook
// Docs: https://commitlint.js.org/
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // type must be one of the allowed values
    'type-enum': [
      2,
      'always',
      [
        'feat',     // new feature
        'fix',      // bug fix
        'docs',     // documentation only
        'refactor', // code refactoring (no feature/fix)
        'test',     // adding or updating tests
        'chore',    // maintenance, deps, tooling
        'ci',       // CI/CD configuration
        'perf',     // performance improvement
        'style',    // formatting, whitespace (no logic change)
        'build',    // build system or external deps
        'revert',   // revert a previous commit
      ],
    ],
    // scope should match project modules
    'scope-enum': [
      1, // warning (not error) — allow new scopes as project grows
      'always',
      [
        'station',
        'desktop',
        'mobile',
        'android',
        'ios',
        'proto',
        'model',
        'applet-sdk',
        'applets',
        'locales',
        'tooling',
        'ci',
        'deps',
        'oauth2',
      ],
    ],
    'scope-case': [2, 'always', 'kebab-case'],
    'subject-max-length': [2, 'always', 72],
    'subject-case': [2, 'never', ['start-case', 'pascal-case', 'upper-case']],
    'subject-empty': [2, 'never'],
    'type-empty': [2, 'never'],
    'type-case': [2, 'always', 'lower-case'],
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [1, 'always', 100], // warning only
    // Allow Made-with trailer for AI traceability
    'trailer-exists': [0, 'always', 'Made-with'],
  },
};
