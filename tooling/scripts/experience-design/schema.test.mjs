import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ExperienceReviewError,
  assertObjectShape,
  assertSha256Digest,
  assertSourceLocation,
} from './schema.mjs';

test('closed shapes allow declared optional fields and reject unknown fields', () => {
  assert.doesNotThrow(() =>
    assertObjectShape(
      { id: 'case-1', note: 'optional' },
      ['id'],
      ['note'],
      'case',
    ));
  assert.throws(
    () =>
      assertObjectShape(
        { id: 'case-1', extra: true },
        ['id'],
        ['note'],
        'case',
      ),
    (error) =>
      error instanceof ExperienceReviewError
      && error.code === 'EDX_RESULT_INVALID',
  );
});

test('sha256 bindings require an explicit algorithm prefix', () => {
  assert.equal(
    assertSha256Digest(`sha256:${'a'.repeat(64)}`, 'digest'),
    `sha256:${'a'.repeat(64)}`,
  );
  assert.throws(
    () => assertSha256Digest('a'.repeat(64), 'digest'),
    /valid non-empty string/,
  );
});

test('source locations require an ordered positive line range', () => {
  assert.doesNotThrow(() =>
    assertSourceLocation(
      {
        path: 'docs/source.md',
        lineStart: 4,
        lineEnd: 8,
      },
      'source',
    ));
  assert.throws(
    () =>
      assertSourceLocation(
        {
          path: 'docs/source.md',
          lineStart: 8,
          lineEnd: 4,
        },
        'source',
      ),
    /greater than or equal to 8/,
  );
});
