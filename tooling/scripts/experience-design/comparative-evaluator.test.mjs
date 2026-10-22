import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assertCurrentComparisonEvaluation,
  evaluatePairedExperienceCase,
} from './comparative-evaluator.mjs';
import {
  loadPairedExperienceCase,
} from './comparative-schema.mjs';
import {
  createComparativeFixture,
  writeComparativePackage,
} from './comparative-test-fixture.mjs';

const VERSION = `sha256:${'f'.repeat(64)}`;

function evaluate(t, options = {}, mutate = null) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cer-evaluator-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundle = createComparativeFixture(options);
  if (mutate !== null) mutate(bundle);
  const casePath = writeComparativePackage(root, bundle);
  const loaded = loadPairedExperienceCase(casePath, root);
  return {
    root,
    bundle,
    casePath,
    loaded,
    result: evaluatePairedExperienceCase(loaded, {
      evaluatorVersionDigest: VERSION,
    }),
  };
}

test('derives material assertion differences and observed path costs', (t) => {
  const { result } = evaluate(t);
  assert.equal(result.disposition, 'material-differences');
  assert.deepEqual(result.materialDifferentialIds, [
    'differential.outcome.complete',
    'differential.outcome.recoverable',
  ]);
  assert.equal(result.earliestDivergence.ordinal, 1);
  assert.equal(result.pathCosts.A.recoveryDebt, 1);
  assert.equal(result.pathCosts.B.recoveryDebt, 0);
  assert.deepEqual(
    result.assertionDifferentials.map((item) => item.criticality),
    ['blocking', 'required'],
  );
});
test('returns no material difference for equivalent outcomes', (t) => {
  const { result } = evaluate(t, {
    successfulA: true,
    successfulB: true,
  });
  assert.equal(result.disposition, 'no-material-difference');
  assert.deepEqual(result.materialDifferentialIds, []);
  assert.equal(result.earliestDivergence, null);
});

test('unproven assertion evidence takes result precedence', (t) => {
  const { result } = evaluate(t, { unprovenA: true });
  assert.equal(result.disposition, 'unproven');
  assert.deepEqual(result.unprovenAssertionIds, [
    'outcome.complete',
    'outcome.recoverable',
  ]);
});

test('leg array permutation preserves semantic evaluation', (t) => {
  const first = evaluate(t);
  const second = evaluate(t, {}, (bundle) => {
    bundle.pair.legs.reverse();
  });
  assert.deepEqual(
    second.result.assertionDifferentials,
    first.result.assertionDifferentials,
  );
  assert.deepEqual(second.result.pathCosts, first.result.pathCosts);
  assert.deepEqual(
    second.result.earliestDivergence,
    first.result.earliestDivergence,
  );
});

test('current evaluation rejects any supplied result drift', (t) => {
  const { loaded, result } = evaluate(t);
  assert.equal(
    assertCurrentComparisonEvaluation(loaded, result, {
      evaluatorVersionDigest: VERSION,
    }).disposition,
    'material-differences',
  );
  const changed = structuredClone(result);
  changed.pathCosts.A.decisionLoad += 1;
  assert.throws(
    () =>
      assertCurrentComparisonEvaluation(loaded, changed, {
        evaluatorVersionDigest: VERSION,
      }),
    (error) => error.code === 'EDX_COMPARE_PAIR_STALE',
  );
});
