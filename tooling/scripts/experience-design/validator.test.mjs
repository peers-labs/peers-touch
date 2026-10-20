import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluatePrototypeAdmission } from './admission.mjs';

import { minorOnlyBoundaryFixture } from './fixtures/boundary/minor-only.mjs';
import { implicitRecoveryFixture } from './fixtures/negative/implicit-recovery.mjs';
import { completeReviewFixture } from './fixtures/positive/complete-review.mjs';
import {
  digestReviewResult,
  validateIndependentReviewDecision,
  validateReviewResult,
} from './validator.mjs';

test('accepts a complete findings result with recomputable primary ranking', () => {
  const result = completeReviewFixture();
  const summary = validateReviewResult(result);

  assert.equal(summary.ok, true);
  assert.equal(summary.verdict, 'FINDINGS');
  assert.equal(summary.primaryCandidateId, 'candidate.primary');
  assert.equal(summary.eligibleCandidateCount, 2);
});

test('accepts minor-only and named-adjacent recovery boundaries', () => {
  const result = minorOnlyBoundaryFixture();
  const summary = validateReviewResult(result);

  assert.equal(summary.verdict, 'NO_BLOCKING_FINDING');
  assert.equal(summary.primaryCandidateId, null);
  assert.equal(result.minorObservations.length, 1);
});

test('rejects implicit recovery and stale ranking tuples', () => {
  assert.throws(
    () => validateReviewResult(implicitRecoveryFixture()),
    /cannot be implicit/,
  );

  const stale = completeReviewFixture();
  stale.candidateLedger[0].priorityTuple[1] = 6;
  assert.throws(
    () => validateReviewResult(stale),
    (error) => error.code === 'EDX_RANK_INVALID',
  );
});

test('distinguishes exit from requested-outcome recovery', () => {
  const exit = completeReviewFixture();
  exit.exitAndRetryPaths[0].kind = 'exit';
  assert.throws(
    () => validateReviewResult(exit),
    (error) =>
      error.code === 'EDX_RECOVERY_INVALID'
      && /exit cannot reference/.test(error.message),
  );

  const unboundRecovery = completeReviewFixture();
  unboundRecovery.exitAndRetryPaths = [];
  assert.throws(
    () => validateReviewResult(unboundRecovery),
    (error) =>
      error.code === 'EDX_RECOVERY_INVALID'
      && /unreferenced path/.test(error.message),
  );
});

test('rejects unresolved candidate references', () => {
  const result = completeReviewFixture();
  result.candidateLedger[0].candidate.factIds = ['fact.unknown'];

  assert.throws(
    () => validateReviewResult(result),
    (error) => error.code === 'EDX_REFERENCE_INVALID',
  );
});

test('trust projection accepts product contracts and rejects rubric ownership', () => {
  const valid = completeReviewFixture();
  valid.trustBoundaryChecks = [
    {
      id: 'trust.scope-switch',
      contractTransitionRefs: ['contract.scope'],
      beforeScope: 'station-old',
      candidateTarget: 'station-new',
      diagnosticEvidenceKinds: ['reachability'],
      requiredIdentityEvidenceKinds: ['signed-station-identity'],
      scopeEffectMeaning: 'Business scope changes after Access Gate.',
      nextGateMeaning: 'Complete the target Access Gate.',
      failureMeaning: 'The prior scope remains authoritative.',
      visibleConsequences: ['Previous projections are not target truth.'],
      previousScopeExposure: 'Visible only as the previous target reference.',
    },
  ];
  assert.doesNotThrow(() => validateReviewResult(valid));

  const invalid = structuredClone(valid);
  invalid.trustBoundaryChecks[0].contractTransitionRefs = ['contract.rubric'];
  assert.throws(
    () => validateReviewResult(invalid),
    (error) => error.code === 'EDX_TRUST_PROJECTION_INVALID',
  );
});

test('independent review binds every finding and cannot self-review', () => {
  const result = completeReviewFixture();
  const decision = {
    resultDigest: digestReviewResult(result),
    reviewerId: 'agent.independent-reviewer',
    decision: 'changes-required',
    findingCandidateIds: ['candidate.primary', 'candidate.secondary'],
    reviewNotes: ['Primary selection is source-backed.'],
  };
  assert.deepEqual(
    validateIndependentReviewDecision(result, decision),
    { ok: true, decision: 'changes-required' },
  );

  assert.throws(
    () =>
      validateIndependentReviewDecision(result, {
        ...decision,
        reviewerId: result.authorId,
      }),
    /must differ/,
  );
});

test('prototype admission requires accepted review and no scoped unproven point', () => {
  const result = minorOnlyBoundaryFixture();
  const decision = {
    resultDigest: digestReviewResult(result),
    reviewerId: 'agent.independent-reviewer',
    decision: 'accepted',
    findingCandidateIds: ['candidate.minor'],
    reviewNotes: [],
  };
  assert.throws(() => evaluatePrototypeAdmission(result, decision),
    (error) => error.code === 'EDX_BINDING_INVALID');

  const unproven = structuredClone(result);
  unproven.unproven = [
    {
      id: 'unproven.dynamic-recovery',
      contractIds: ['contract.recovery'],
      requirement: 'Recovery transition is exercised.',
      reason: 'No dynamic evidence is attached.',
      requiredEvidenceLevel: 'L3_DYNAMIC',
      requiredFor: ['high-fidelity'],
    },
  ];
  const blockedDecision = {
    ...decision,
    resultDigest: digestReviewResult(unproven),
    decision: 'unproven',
  };
  assert.deepEqual(validateIndependentReviewDecision(unproven, blockedDecision),
    { ok: true, decision: 'unproven' });
  assert.throws(
    () =>
      validateIndependentReviewDecision(unproven, {
        ...blockedDecision,
        decision: 'accepted',
      }),
    /accepted review requires/,
  );
});
