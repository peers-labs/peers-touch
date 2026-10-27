import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { canonicalDigest } from './canonical.mjs';
import { comparativePriorityTuple } from './comparative-review.mjs';
import { evaluateExperienceCase } from './evaluator.mjs';
import { runCli } from './experience-design.mjs';
import { loadGrammar, loadExperienceCase, loadRuleCatalog } from './schema.mjs';
import { controlPlaneVersionDigest } from './source-version.mjs';
import { createFixtureBundle } from './test-fixture.mjs';
import {
  createComparativeFixture,
  writeComparativePackage,
} from './comparative-test-fixture.mjs';

const TS = '2026-10-22T05:00:00.000Z';
const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const RULES = path.join(
  REPO_ROOT,
  'docs/architecture/engineering/experience-design/rules.json',
);
const GRAMMAR = path.join(
  REPO_ROOT,
  'docs/client/common/ui-identity/grammar-bindings.json',
);

function writeJson(root, relative, value) {
  const absolute = path.join(root, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`);
  return canonicalDigest(value);
}

function stagedPackage(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cer-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pairPath = writeComparativePackage(
    root,
    createComparativeFixture(),
  );
  const pairRelative = path.relative(root, pairPath);
  const evaluation = runCli([
    'compare-evaluate',
    pairRelative,
    '--package-root',
    root,
  ]);
  writeJson(root, 'comparison-evaluation.json', evaluation);
  const blindedReport = {
    kind: 'peers-touch-blinded-delta-report',
    schemaVersion: 1,
    id: 'blind.report.cli',
    authorId: 'author.blind-report.cli',
    comparisonEvaluationDigest: canonicalDigest(evaluation),
    identityLeakage: 'none',
    deltas: evaluation.assertionDifferentials
      .filter((item) => item.classification === 'result-difference')
      .map((item, index) => {
        const delta = {
          id: `blind.delta.cli.${index + 1}`,
          differentialId: item.id,
          oracleAssertionId: item.oracleAssertionId,
          earliestDivergentStateRefs: item.earliestDivergentStateRefs,
          causalStatus: 'mechanism-supported',
          pairedFactIds: {
            A: item.AFactIds,
            B: item.BFactIds,
          },
          mechanism:
            'The first divergent state changes whether the outcome remains reachable.',
          userConsequence:
            'The Peers candidate loses the bounded outcome or recovery.',
          falsifier:
            'Preserving the divergent state does not close the outcome gap.',
          confidence: 'high',
          journeyFrequency: index === 0 ? 'frequent' : 'periodic',
          userWorkAtRisk: index === 0 ? 'high' : 'medium',
          priorityTuple: [],
        };
        delta.priorityTuple = comparativePriorityTuple(delta, item);
        return delta;
      }),
    unprovenAssertionIds: evaluation.unprovenAssertionIds,
  };
  writeJson(root, 'blinded-deltas.json', blindedReport);
  const blindReview = {
    kind: 'peers-touch-comparison-blind-review',
    schemaVersion: 1,
    reportDigest: canonicalDigest(blindedReport),
    reviewerId: 'reviewer.blind.cli',
    reviewedAt: TS,
    decision: 'accepted',
    deltaIds: blindedReport.deltas.map((delta) => delta.id),
    reviewNotes: [],
    reviewerFindings: [],
  };
  writeJson(root, 'blind-review.json', blindReview);

  const sources = {
    ruleCatalog: loadRuleCatalog(RULES),
    grammar: loadGrammar(GRAMMAR),
    evaluatorVersionDigest: controlPlaneVersionDigest(),
  };
  const edxBundle = createFixtureBundle();
  const edxCaseDigest = writeJson(
    root,
    'identity/peers-case.json',
    edxBundle.experienceCase,
  );
  const loadedCase = loadExperienceCase(
    path.join(root, 'identity/peers-case.json'),
    sources,
  );
  const edxResult = evaluateExperienceCase(loadedCase, {
    ruleCatalog: sources.ruleCatalog,
    grammar: sources.grammar,
    evaluatorVersionDigest: sources.evaluatorVersionDigest,
    repoRoot: REPO_ROOT,
  });
  const edxResultDigest = writeJson(
    root,
    'identity/peers-result.json',
    edxResult,
  );
  const receipt = {
    kind: 'peers-touch-experience-review',
    schemaVersion: 1,
    caseId: loadedCase.case.id,
    caseDigest: loadedCase.digests.case,
    contractDigest: loadedCase.digests.contract,
    candidateDigest: loadedCase.digests.candidate,
    resultDigest: canonicalDigest(edxResult),
    reviewerId: 'reviewer.peers-edx.cli',
    reviewedAt: TS,
    decision: 'accepted',
    findingIds: [],
    reviewerFindings: [],
  };
  const receiptDigest = writeJson(
    root,
    'identity/peers-review.json',
    receipt,
  );
  const identityMap = {
    kind: 'peers-touch-comparison-identity-map',
    schemaVersion: 1,
    pairedCaseDigest: evaluation.caseDigest,
    comparisonEvaluationDigest: canonicalDigest(evaluation),
    blindedDeltaDigest: canonicalDigest(blindedReport),
    blindReviewDigest: canonicalDigest(blindReview),
    roles: {
      A: 'peers',
      B: 'reference',
    },
    revealedById: 'author.identity.cli',
    revealedAt: TS,
    peersBinding: {
      legAlias: 'A',
      experienceCase: {
        path: 'identity/peers-case.json',
        digest: edxCaseDigest,
      },
      evaluationResult: {
        path: 'identity/peers-result.json',
        digest: edxResultDigest,
      },
      reviewReceipt: {
        path: 'identity/peers-review.json',
        digest: receiptDigest,
      },
    },
  };
  writeJson(root, 'identity-map.json', identityMap);
  const peersBindingDigest = canonicalDigest({
    case: edxCaseDigest,
    result: edxResultDigest,
    receipt: receiptDigest,
  });
  const causalReport = {
    kind: 'peers-touch-causal-delta-report',
    schemaVersion: 1,
    id: 'causal.report.cli',
    authorId: 'author.causal.cli',
    blindedDeltaDigest: canonicalDigest(blindedReport),
    blindReviewDigest: canonicalDigest(blindReview),
    identityMapDigest: canonicalDigest(identityMap),
    peersBindingDigest,
    deltas: blindedReport.deltas.map((delta, index) => ({
      id: `causal.delta.cli.${index + 1}`,
      blindedDeltaId: delta.id,
      revealedRoles: {
        A: 'peers',
        B: 'reference',
      },
      kind: 'candidate-drift',
      ownerLayer: 'prototype',
      proposedDisposition: 'adapt',
      causalStatus: delta.causalStatus,
      interventionEvidenceDigests: [],
      targetProposal: {
        id: `target.delta.cli.${index + 1}`,
        targetOwner: 'product',
        affectedCapabilityIds: ['capability.compare'],
        affectedJourneyIds: ['journey.compare'],
        affectedStateIds: ['state.A.failure'],
        changedPromise:
          'Preserve user work and expose visible recovery.',
        requiredAcceptanceIds: [
          `acceptance.compare.${index + 1}`,
        ],
        requiredEvidence: [
          'L3 dynamic recovery with preserved state',
        ],
        nonAdoptedBenchmarkDetails: [
          'Do not copy benchmark identity or visual styling.',
        ],
      },
    })),
  };
  writeJson(root, 'causal-deltas.json', causalReport);
  const dispositionReview = {
    kind: 'peers-touch-comparison-disposition-review',
    schemaVersion: 1,
    causalDeltaDigest: canonicalDigest(causalReport),
    reviewerId: 'reviewer.disposition.cli',
    reviewedAt: TS,
    decision: 'accepted',
    deltaDecisions: causalReport.deltas.map((delta, index) => ({
      id: `decision.cli.${index + 1}`,
      deltaId: delta.id,
      decision: 'accepted',
      rationale: 'The target is Peers-owned and evidence-backed.',
    })),
    reviewNotes: [],
    reviewerFindings: [],
  };
  writeJson(root, 'disposition-review.json', dispositionReview);
  const chain = [
    pairRelative,
    'comparison-evaluation.json',
    'blinded-deltas.json',
    'blind-review.json',
    'identity-map.json',
    'causal-deltas.json',
    'disposition-review.json',
  ];
  return {
    root,
    chain,
    pairRelative,
    evaluation,
  };
}

test('CLI validates and evaluates an explicit paired package', (t) => {
  const value = stagedPackage(t);
  const validated = runCli([
    'compare-validate',
    value.pairRelative,
    '--package-root',
    value.root,
  ]);
  assert.equal(validated.ok, true);
  const evaluated = runCli([
    'compare-evaluate',
    value.pairRelative,
    '--package-root',
    value.root,
  ]);
  assert.equal(evaluated.disposition, 'material-differences');
});

test('CLI validates blind and disposition review before target projection', (t) => {
  const value = stagedPackage(t);
  const blind = runCli([
    'compare-review-blind',
    ...value.chain.slice(0, 4),
    '--package-root',
    value.root,
  ]);
  assert.equal(blind.decision, 'accepted');
  const disposition = runCli([
    'compare-review-disposition',
    ...value.chain,
    '--package-root',
    value.root,
  ]);
  assert.equal(disposition.decision, 'accepted');
  const projection = runCli([
    'compare-project-target',
    ...value.chain,
    '--package-root',
    value.root,
  ]);
  assert.equal(projection.proposals.length, 2);
});

test('final projection recomputes current pair and rejects drift', (t) => {
  const value = stagedPackage(t);
  const evaluationPath = path.join(
    value.root,
    'comparison-evaluation.json',
  );
  const changed = JSON.parse(fs.readFileSync(evaluationPath));
  changed.pathCosts.A.decisionLoad += 1;
  writeJson(value.root, 'comparison-evaluation.json', changed);
  assert.throws(
    () =>
      runCli([
        'compare-project-target',
        ...value.chain,
        '--package-root',
        value.root,
      ]),
    (error) => error.code === 'EDX_COMPARE_PAIR_STALE',
  );
});

test('compare commands reject missing package roots and incomplete chains', () => {
  assert.throws(
    () => runCli(['compare-validate', 'paired-case.json']),
    (error) => error.code === 'ED_CLI_USAGE',
  );
  assert.throws(
    () =>
      runCli([
        'compare-project-target',
        'causal-deltas.json',
        'disposition-review.json',
        '--package-root',
        '/tmp',
      ]),
    (error) => error.code === 'ED_CLI_USAGE',
  );
});
