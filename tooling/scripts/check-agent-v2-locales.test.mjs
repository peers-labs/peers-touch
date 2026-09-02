import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ERROR_LOCALE_KEYS,
  RECOVERY_ACTION_IDS,
  STABLE_ERROR_CODES,
  validateLocaleTexts,
} from './check-agent-v2-locales.mjs';

function locale(overrides = {}) {
  return {
    'agent.profile.diagnostics.exportTurnRecord': 'Export diagnostics',
    ...Object.fromEntries(ERROR_LOCALE_KEYS.map((key) => [key, `Copy for ${key}`])),
    ...Object.fromEntries(
      RECOVERY_ACTION_IDS.map((id) => [`agent.recovery.${id}`, `Action for ${id}`]),
    ),
    ...overrides,
  };
}

function texts(en = locale(), zh = locale()) {
  return {
    enText: `${JSON.stringify(en, null, 2)}\n`,
    zhText: `${JSON.stringify(zh, null, 2)}\n`,
  };
}

test('accepts exact, non-empty, parity-complete locale contracts', () => {
  const result = validateLocaleTexts(texts());
  assert.equal(result.errorKeyCount, 55);
  assert.equal(result.recoveryKeyCount, 46);
  assert.equal(STABLE_ERROR_CODES.length, 55);
  assert.ok(STABLE_ERROR_CODES.includes('AGENT_CANVAS_SINGLE_AGENT_NOT_READY'));
});

test('rejects duplicate JSON keys', () => {
  const duplicate = '"agent.profile.diagnostics.exportTurnRecord": "Duplicate",';
  const valid = texts();
  assert.throws(
    () => validateLocaleTexts({
      ...valid,
      enText: valid.enText.replace('{', `{\n  ${duplicate}`),
    }),
    /duplicate keys: agent\.profile\.diagnostics\.exportTurnRecord/,
  );
});

test('rejects cross-locale parity drift including the exportTurnRecord typo', () => {
  const zh = locale();
  delete zh['agent.profile.diagnostics.exportTurnRecord'];
  zh['agent.profile.diagnostics.exportTurn记录'] = '导出诊断';
  assert.throws(
    () => validateLocaleTexts(texts(locale(), zh)),
    /Agent locale parity mismatch.*exportTurnRecord.*exportTurn记录/,
  );
});

test('rejects empty locale copy', () => {
  assert.throws(
    () => validateLocaleTexts(texts(locale({ 'agent.errors.queueFull': '  ' }))),
    /agent\.errors\.queueFull must be a non-empty string/,
  );
});

test('rejects missing and extra error or recovery keys', () => {
  const missingError = locale();
  delete missingError['agent.errors.queueFull'];
  assert.throws(
    () => validateLocaleTexts(texts(missingError, missingError)),
    /agent\.errors\. keyset mismatch; missing=\[agent\.errors\.queueFull\]/,
  );

  const extraRecovery = locale({ 'agent.recovery.unplannedAction': 'Unplanned' });
  assert.throws(
    () => validateLocaleTexts(texts(extraRecovery, extraRecovery)),
    /agent\.recovery\. keyset mismatch.*agent\.recovery\.unplannedAction/,
  );
});

test('rejects stable codes in locale copy and receiver source copy', () => {
  assert.throws(
    () => validateLocaleTexts(
      texts(locale({ 'agent.errors.queueFull': 'ADMISSION_QUEUE_FULL' })),
    ),
    /exposes stable code ADMISSION_QUEUE_FULL as user copy/,
  );

  assert.throws(
    () => validateLocaleTexts({
      ...texts(),
      sourceFiles: [{
        file: 'apps/desktop/src/components/agent/ErrorCard.tsx',
        content: 'export const copy = "PROVIDER_TIMEOUT";',
      }],
    }),
    /receiver source hardcodes stable code PROVIDER_TIMEOUT as user copy/,
  );
});
