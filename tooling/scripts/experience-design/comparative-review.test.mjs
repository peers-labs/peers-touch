import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { canonicalDigest } from './canonical.mjs';
import {
  evaluatePairedExperienceCase,
} from './comparative-evaluator.mjs';
import {
  loadPairedExperienceCase,
} from './comparative-schema.mjs';
import {
  comparativePriorityTuple,
  projectTargetContracts,
  validateBlindReview,
  validateBlindedDeltaReport,
  validateCausalDeltaReport,
  validateDispositionReview,
  validateIdentityMap,
} from './comparative-review.mjs';
import {
  createComparativeFixture,
  writeComparativePackage,
} from './comparative-test-fixture.mjs';

const VERSION = `sha256:${'f'.repeat(64)}`;
const TS = '2026-10-22T04:00:00.000Z';

function reviewFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cer-review-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const casePath = writeComparativePackage(
    root,
    createComparativeFixture(),
  );
  const loaded = loadPairedExperienceCase(casePath, root);
  const evaluation = evaluatePairedExperienceCase(loaded, {
    evaluatorVersionDigest: VERSION,
  });
  const differentialById = new Map(
    evaluation.assertionDifferentials.map((item) => [item.id, item]),
  );
  const blindedReport = {
    kind: 'peers-touch-blinded-delta-report',
    schemaVersion: 1,
    id: 'blind.report',
    authorId: 'author.blind-report',
    comparisonEvaluationDigest: canonicalDigest(evaluation),
    identityLeakage: 'none',
    deltas: evaluation.materialDifferentialIds.map((id, index) => {
      const differential = differentialById.get(id);
      const delta = {
        id: `blind.delta.${index + 1}`,
        differentialId: id,
        oracleAssertionId: differential.oracleAssertionId,
        earliestDivergentStateRefs:
          differential.earliestDivergentStateRefs,
        causalStatus: 'mechanism-supported',
        pairedFactIds: {
          A: differential.AFactIds,
          B: differential.BFactIds,
        },
        mechanism:
          'The earliest visible state changes whether the outcome remains reachable.',
        userConsequence:
          'One leg blocks the bounded outcome while the other preserves progress.',
        falsifier:
          'A controlled intervention that preserves this state does not close the outcome gap.',
        confidence: 'high',
        journeyFrequency: index === 0 ? 'frequent' : 'periodic',
        userWorkAtRisk: index === 0 ? 'high' : 'medium',
        priorityTuple: [],
      };
      delta.priorityTuple = comparativePriorityTuple(delta, differential);
      return delta;
    }),
    unprovenAssertionIds: [],
  };
  const blindReview = {
    kind: 'peers-touch-comparison-blind-review',
    schemaVersion: 1,
    reportDigest: canonicalDigest(blindedReport),
    reviewerId: 'reviewer.blind',
    reviewedAt: TS,
    decision: 'accepted',
    deltaIds: blindedReport.deltas.map((delta) => delta.id),
    reviewNotes: [],
    reviewerFindings: [],
  };
  const identityMap = {
    kind: 'peers-touch-comparison-identity-map',
    schemaVersion: 1,
    pairedCaseDigest: loaded.digests.pair,
    comparisonEvaluationDigest: canonicalDigest(evaluation),
    blindedDeltaDigest: canonicalDigest(blindedReport),
    blindReviewDigest: canonicalDigest(blindReview),
    roles: {
      A: 'peers',
      B: 'reference',
    },
    revealedById: 'author.identity-reveal',
    revealedAt: TS,
    peersBinding: {
      legAlias: 'A',
      experienceCase: {
        path: 'identity/peers-case.json',
        digest: `sha256:${'1'.repeat(64)}`,
      },
      evaluationResult: {
        path: 'identity/peers-result.json',
        digest: `sha256:${'2'.repeat(64)}`,
      },
      reviewReceipt: {
        path: 'identity/peers-review.json',
        digest: `sha256:${'3'.repeat(64)}`,
      },
    },
  };
  const peersBinding = {
    legAlias: 'A',
    experienceCaseDigest: `sha256:${'1'.repeat(64)}`,
    evaluationResultDigest: `sha256:${'2'.repeat(64)}`,
    reviewReceiptDigest: `sha256:${'3'.repeat(64)}`,
    bindingDigest: `sha256:${'4'.repeat(64)}`,
  };
  const causalReport = {
    kind: 'peers-touch-causal-delta-report',
    schemaVersion: 1,
    id: 'causal.report',
    authorId: 'author.causal-report',
    blindedDeltaDigest: canonicalDigest(blindedReport),
    blindReviewDigest: canonicalDigest(blindReview),
    identityMapDigest: canonicalDigest(identityMap),
    peersBindingDigest: peersBinding.bindingDigest,
    deltas: blindedReport.deltas.map((delta, index) => ({
      id: `causal.delta.${index + 1}`,
      blindedDeltaId: delta.id,
      revealedRoles: {
        A: 'peers',
        B: 'reference',
      },
      kind:
        index === 0
          ? 'candidate-drift'
          : 'benchmark-liability',
      ownerLayer: index === 0 ? 'prototype' : 'product',
      proposedDisposition: index === 0 ? 'adapt' : 'reject',
      causalStatus: delta.causalStatus,
      interventionEvidenceDigests: [],
      ...(index === 0
        ? {
            targetProposal: {
              id: 'target.delta.1',
              targetOwner: 'product',
              affectedCapabilityIds: ['capability.compare'],
              affectedJourneyIds: ['journey.compare'],
              affectedStateIds: ['state.A.failure'],
              changedPromise:
                'Preserve work and expose a visible recovery path.',
              requiredAcceptanceIds: ['acceptance.compare.recovery'],
              requiredEvidence: [
                'L3 dynamic recovery with preserved input',
              ],
              nonAdoptedBenchmarkDetails: [
                'Do not copy the reference visual identity.',
              ],
            },
          }
        : {}),
    })),
  };
  const dispositionReview = {
    kind: 'peers-touch-comparison-disposition-review',
    schemaVersion: 1,
    causalDeltaDigest: canonicalDigest(causalReport),
    reviewerId: 'reviewer.disposition',
    reviewedAt: TS,
    decision: 'accepted',
    deltaDecisions: causalReport.deltas.map((delta, index) => ({
      id: `decision.${index + 1}`,
      deltaId: delta.id,
      decision: 'accepted',
      rationale: 'The disposition follows Peers product constraints.',
    })),
    reviewNotes: [],
    reviewerFindings: [],
  };
  const forbiddenAuthorIds = [
    ...evaluation.authorIds,
    blindedReport.authorId,
    blindReview.reviewerId,
    identityMap.revealedById,
  ];
  return {
    root,
    loaded,
    evaluation,
    blindedReport,
    blindReview,
    identityMap,
    peersBinding,
    causalReport,
    dispositionReview,
    forbiddenAuthorIds,
  };
}

function validateThroughDisposition(value) {
  validateBlindedDeltaReport(value.blindedReport, value.evaluation);
  validateBlindReview(
    value.blindReview,
    value.evaluation,
    value.blindedReport,
  );
  validateIdentityMap(value.identityMap, {
    pairDigest: value.loaded.digests.pair,
    evaluationDigest: canonicalDigest(value.evaluation),
    reportDigest: canonicalDigest(value.blindedReport),
    blindReviewDigest: canonicalDigest(value.blindReview),
    blindReview: value.blindReview,
    forbiddenAuthorIds: [
      ...value.evaluation.authorIds,
      value.blindedReport.authorId,
      value.blindReview.reviewerId,
    ],
  });
  validateCausalDeltaReport(value.causalReport, {
    blindedReport: value.blindedReport,
    blindReview: value.blindReview,
    identityMap: value.identityMap,
    peersBinding: value.peersBinding,
  });
  validateDispositionReview(value.dispositionReview, {
    causalReport: value.causalReport,
    forbiddenAuthorIds: value.forbiddenAuthorIds,
  });
}

test('validates the blind/reveal chain and projects accepted targets', (t) => {
  const value = reviewFixture(t);
  validateThroughDisposition(value);
  const projection = projectTargetContracts(
    value.causalReport,
    value.dispositionReview,
    { forbiddenAuthorIds: value.forbiddenAuthorIds },
  );
  assert.equal(projection.proposals.length, 1);
  assert.equal(projection.proposals[0].acceptedDisposition, 'adapt');
  assert.equal(
    projection.proposals[0].changedPromise,
    'Preserve work and expose a visible recovery path.',
  );
});

test('blind report must cover every material differential exactly', (t) => {
  const value = reviewFixture(t);
  value.blindedReport.deltas.pop();
  assert.throws(
    () =>
      validateBlindedDeltaReport(
        value.blindedReport,
        value.evaluation,
      ),
    (error) => error.code === 'EDX_COMPARE_CAUSAL_OVERCLAIM',
  );
});

test('blind report forbids intervention-confirmed causality', (t) => {
  const value = reviewFixture(t);
  value.blindedReport.deltas[0].causalStatus =
    'intervention-confirmed';
  assert.throws(
    () =>
      validateBlindedDeltaReport(
        value.blindedReport,
        value.evaluation,
      ),
    (error) => error.code === 'EDX_COMPARE_CAUSAL_OVERCLAIM',
  );
});

test('blind report priority is recomputable and totally ordered', (t) => {
  const value = reviewFixture(t);
  value.blindedReport.deltas[0].priorityTuple[0] += 1;
  assert.throws(
    () =>
      validateBlindedDeltaReport(
        value.blindedReport,
        value.evaluation,
      ),
    (error) => error.code === 'EDX_COMPARE_CAUSAL_OVERCLAIM',
  );

  const reordered = reviewFixture(t);
  reordered.blindedReport.deltas.reverse();
  assert.throws(
    () =>
      validateBlindedDeltaReport(
        reordered.blindedReport,
        reordered.evaluation,
      ),
    (error) => error.code === 'EDX_COMPARE_CAUSAL_OVERCLAIM',
  );
});

test('blind review rejects author overlap', (t) => {
  const value = reviewFixture(t);
  value.blindReview.reviewerId = value.evaluation.authorIds[0];
  assert.throws(
    () =>
      validateBlindReview(
        value.blindReview,
        value.evaluation,
        value.blindedReport,
      ),
    (error) => error.code === 'EDX_COMPARE_REVIEW_REQUIRED',
  );
});

test('identity reveal requires an accepted blind review', (t) => {
  const value = reviewFixture(t);
  value.blindReview.decision = 'unproven';
  assert.throws(
    () =>
      validateIdentityMap(value.identityMap, {
        pairDigest: value.loaded.digests.pair,
        evaluationDigest: canonicalDigest(value.evaluation),
        reportDigest: canonicalDigest(value.blindedReport),
        blindReviewDigest: canonicalDigest(value.blindReview),
        blindReview: value.blindReview,
        forbiddenAuthorIds: value.evaluation.authorIds,
      }),
    (error) => error.code === 'EDX_COMPARE_PAIR_STALE'
      || error.code === 'EDX_COMPARE_REVIEW_REQUIRED',
  );
});

test('confirmed causality requires exact intervention evidence', (t) => {
  const value = reviewFixture(t);
  value.causalReport.deltas[0].causalStatus =
    'intervention-confirmed';
  assert.throws(
    () =>
      validateCausalDeltaReport(value.causalReport, {
        blindedReport: value.blindedReport,
        blindReview: value.blindReview,
        identityMap: value.identityMap,
        peersBinding: value.peersBinding,
      }),
    (error) => error.code === 'EDX_COMPARE_CAUSAL_OVERCLAIM',
  );
  value.causalReport.deltas[0].interventionEvidenceDigests = [
    `sha256:${'9'.repeat(64)}`,
  ];
  validateCausalDeltaReport(value.causalReport, {
    blindedReport: value.blindedReport,
    blindReview: value.blindReview,
    identityMap: value.identityMap,
    peersBinding: value.peersBinding,
  });
});

test('causal report author cannot overlap blind-stage authors', (t) => {
  const value = reviewFixture(t);
  value.causalReport.authorId = value.blindReview.reviewerId;
  assert.throws(
    () =>
      validateCausalDeltaReport(value.causalReport, {
        blindedReport: value.blindedReport,
        blindReview: value.blindReview,
        identityMap: value.identityMap,
        peersBinding: value.peersBinding,
        forbiddenAuthorIds: value.forbiddenAuthorIds,
      }),
    (error) => error.code === 'EDX_COMPARE_REVIEW_REQUIRED',
  );
});

test('disposition review rejects prior-author overlap', (t) => {
  const value = reviewFixture(t);
  value.dispositionReview.reviewerId = value.blindReview.reviewerId;
  assert.throws(
    () =>
      validateDispositionReview(value.dispositionReview, {
        causalReport: value.causalReport,
        forbiddenAuthorIds: value.forbiddenAuthorIds,
      }),
    (error) => error.code === 'EDX_COMPARE_REVIEW_REQUIRED',
  );
});

test('target projection fails closed on changes-required review', (t) => {
  const value = reviewFixture(t);
  value.dispositionReview.reviewerFindings = [{
    id: 'finding.blocking',
    severity: 'blocking',
    observed: 'The target proposal exceeds accepted Product scope.',
    correction: 'Return the proposal to Product ownership.',
  }];
  value.dispositionReview.decision = 'changes-required';
  value.dispositionReview.causalDeltaDigest =
    canonicalDigest(value.causalReport);
  assert.throws(
    () =>
      projectTargetContracts(
        value.causalReport,
        value.dispositionReview,
        { forbiddenAuthorIds: value.forbiddenAuthorIds },
      ),
    (error) => error.code === 'EDX_COMPARE_TARGET_UNAUTHORIZED',
  );
});
