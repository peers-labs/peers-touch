import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { runComparativeCalibration } from './comparative-calibration.mjs';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');

test('runs exact positive, negative, and boundary CER calibration', () => {
  const result = runComparativeCalibration({
    fixturesRoot: FIXTURES,
    evaluatorVersionDigest: `sha256:${'f'.repeat(64)}`,
  });
  assert.equal(result.ok, true);
  assert.equal(result.fixtureCount, 4);
  assert.deepEqual(
    [...new Set(result.results.map((entry) => entry.class))].sort(),
    ['boundary', 'negative', 'positive'],
  );
  assert.equal(
    result.results.find((entry) => entry.id === 'material-gap').disposition,
    'material-differences',
  );
  assert.equal(
    result.results.find((entry) => entry.id === 'reviewer-overlap').errorCode,
    'EDX_COMPARE_REVIEW_REQUIRED',
  );
});
