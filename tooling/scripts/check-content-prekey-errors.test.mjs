import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONTENT_PREKEY_ERRORS,
  MINIMUM_LOCALE_VERSION,
  validateContentPreKeyErrors,
} from './check-content-prekey-errors.mjs';

function fixture(overrides = {}) {
  const protoText = CONTENT_PREKEY_ERRORS.map(
    ([name, code]) => `ERROR_CODE_${name} = ${code};`,
  ).join('\n');
  const goText = CONTENT_PREKEY_ERRORS.map(
    ([name, code]) => `ErrorCode_ERROR_CODE_${name} ErrorCode = ${code}`,
  ).join('\n');
  const goMessagesText = CONTENT_PREKEY_ERRORS.map(
    ([name]) => `ErrorCode_ERROR_CODE_${name}: "message",`,
  ).join('\n');
  const tsText = CONTENT_PREKEY_ERRORS.map(
    ([name, code]) => `${name} = ${code},`,
  ).join('\n');
  const locale = Object.fromEntries(
    CONTENT_PREKEY_ERRORS.map(([, code]) => [`error.${code}`, `message ${code}`]),
  );
  return {
    protoText,
    goText,
    goMessagesText,
    desktopText: tsText,
    mobileText: tsText,
    enText: JSON.stringify(locale),
    zhText: JSON.stringify(locale),
    metadataText: JSON.stringify({ version: MINIMUM_LOCALE_VERSION }),
    ...overrides,
  };
}

test('accepts complete proto, generated, locale, and metadata parity', () => {
  assert.deepEqual(validateContentPreKeyErrors(fixture()), {
    status: 'PASS',
    errorCount: 9,
    localeVersion: MINIMUM_LOCALE_VERSION,
  });
});

test('rejects numeric drift in a generated client enum', () => {
  const values = fixture();
  assert.throws(
    () =>
      validateContentPreKeyErrors({
        ...values,
        mobileText: values.mobileText.replace(
          'CONTENT_PREKEY_FORBIDDEN = 30201',
          'CONTENT_PREKEY_FORBIDDEN = 30299',
        ),
      }),
    /Mobile CONTENT_PREKEY_FORBIDDEN/,
  );
});

test('rejects missing, duplicate, or empty locale entries', () => {
  const values = fixture();
  const missing = JSON.parse(values.zhText);
  delete missing['error.30209'];
  assert.throws(
    () =>
      validateContentPreKeyErrors({
        ...values,
        zhText: JSON.stringify(missing),
      }),
    /Chinese error\.30209/,
  );

  const duplicate = values.enText.replace(
    '{',
    '{"error.30201":"duplicate",',
  );
  assert.throws(
    () => validateContentPreKeyErrors({ ...values, enText: duplicate }),
    /English error\.30201 must occur exactly once/,
  );

  const empty = JSON.parse(values.enText);
  empty['error.30201'] = ' ';
  assert.throws(
    () =>
      validateContentPreKeyErrors({
        ...values,
        enText: JSON.stringify(empty),
      }),
    /English error\.30201 must be a non-empty string/,
  );
});

test('rejects a locale metadata version without the required increment', () => {
  assert.throws(
    () =>
      validateContentPreKeyErrors({
        ...fixture(),
        metadataText: JSON.stringify({ version: '0.5.5' }),
      }),
    /locale metadata version 0\.5\.5 is below 0\.5\.6/,
  );
});
