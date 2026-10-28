import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ExperienceDesignError,
  canonicalDigest,
} from './canonical.mjs';
import { evaluateExperienceCase } from './evaluator.mjs';
import { runCli } from './experience-design.mjs';
import { validateReviewReceipt } from './review-receipt.mjs';
import {
  loadGrammar,
  loadRuleCatalog,
  validateExperienceCaseValue,
} from './schema.mjs';
import { controlPlaneVersionDigest } from './source-version.mjs';
import { createFixtureBundle } from './test-fixture.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../../..');
const ruleCatalog = loadRuleCatalog(
  path.join(
    REPO_ROOT,
    'docs/architecture/engineering/experience-design/rules.json',
  ),
);
const grammar = loadGrammar(
  path.join(
    REPO_ROOT,
    'docs/client/common/ui-identity/grammar-bindings.json',
  ),
);
const evaluatorVersionDigest = controlPlaneVersionDigest();

function prepare(t, bundle = createFixtureBundle()) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'review-receipt-'));
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  const loadedCase = validateExperienceCaseValue(bundle.experienceCase, {
    ruleCatalog,
    grammar,
  });
  const result = evaluateExperienceCase(loadedCase, {
    ruleCatalog,
    grammar,
    evaluatorVersionDigest,
    repoRoot: REPO_ROOT,
  });
  return {
    loadedCase,
    result,
    temporaryRoot,
  };
}

function reviewReceipt(
  prepared,
  {
    decision = 'accepted',
    findingIds = prepared.result.findings.map((finding) => finding.id),
    reviewerFindings = [],
    reviewerId = 'review-author',
  } = {},
) {
  return {
    kind: 'peers-touch-experience-review',
    schemaVersion: 1,
    caseId: prepared.loadedCase.case.id,
    caseDigest: prepared.loadedCase.digests.case,
    contractDigest: prepared.loadedCase.digests.contract,
    candidateDigest: prepared.loadedCase.digests.candidate,
    resultDigest: canonicalDigest(prepared.result),
    reviewerId,
    reviewedAt: '2026-10-18T18:00:00.000Z',
    decision,
    findingIds,
    reviewerFindings,
  };
}

function expectReviewError(action, pattern) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof ExperienceDesignError);
    assert.equal(error.code, 'INDEPENDENT_REVIEW_REQUIRED');
    assert.match(error.message, pattern);
    return true;
  });
}

test('valid digest-bound independent review accepts a ready result', (t) => {
  const prepared = prepare(t);
  const receipt = reviewReceipt(prepared);

  const validation = validateReviewReceipt(receipt, prepared);

  assert.equal(validation.valid, true);
  assert.equal(validation.decision, 'accepted');
});

test('CLI validates the exact current case, result, and receipt chain', (t) => {
  const prepared = prepare(t);
  const receipt = reviewReceipt(prepared);
  const casePath = path.join(prepared.temporaryRoot, 'case.json');
  const resultPath = path.join(prepared.temporaryRoot, 'result.json');
  const receiptPath = path.join(prepared.temporaryRoot, 'receipt.json');
  fs.writeFileSync(
    casePath,
    `${JSON.stringify(prepared.loadedCase.case, null, 2)}\n`,
  );
  fs.writeFileSync(
    resultPath,
    `${JSON.stringify(prepared.result, null, 2)}\n`,
  );
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

  const validation = runCli([
    'validate-review',
    casePath,
    resultPath,
    receiptPath,
  ]);

  assert.equal(validation.valid, true);
  assert.equal(validation.decision, 'accepted');

  assert.throws(
    () => runCli([
      'validate',
      casePath,
      '--trusted-issuers',
      path.join(prepared.temporaryRoot, 'legacy-issuers.json'),
    ]),
    (error) => {
      assert.ok(error instanceof ExperienceDesignError);
      assert.equal(error.code, 'ED_CLI_USAGE');
      assert.match(error.message, /unknown option/);
      return true;
    },
  );
});

test('reviewer cannot overlap any case author', (t) => {
  const prepared = prepare(t);
  const authorship = prepared.loadedCase.case.authorship;
  for (const reviewerId of [
    authorship.contractAuthorId,
    authorship.candidateAuthorId,
    ...authorship.evidenceAuthorIds,
    authorship.expectationAuthorId,
  ]) {
    const receipt = reviewReceipt(prepared, { reviewerId });
    expectReviewError(
      () => validateReviewReceipt(receipt, prepared),
      /independent/,
    );
  }
});

test('receipt cannot omit an evaluator finding', (t) => {
  const prepared = prepare(
    t,
    createFixtureBundle({
      calibration: 'negative',
      mutate: ({ candidate }) => {
        candidate.copyNodes.push({
          id: 'copy.duplicate',
          surfaceId: 'surface.connect',
          scope: 'scope.connect',
          conceptId: 'concept.connect',
          role: 'title',
          text: 'Connect this account',
        });
      },
    }),
  );
  const receipt = reviewReceipt(prepared, {
    decision: 'changes-required',
    findingIds: [],
  });

  expectReviewError(
    () => validateReviewReceipt(receipt, prepared),
    /exactly bind/,
  );
});

test('receipt rejects every stale immutable-input binding', (t) => {
  const prepared = prepare(t);
  const staleBindings = [
    ['caseId', 'case.stale'],
    ['caseDigest', `sha256:${'1'.repeat(64)}`],
    ['contractDigest', `sha256:${'2'.repeat(64)}`],
    ['candidateDigest', `sha256:${'3'.repeat(64)}`],
    ['resultDigest', `sha256:${'4'.repeat(64)}`],
  ];

  for (const [key, value] of staleBindings) {
    const receipt = reviewReceipt(prepared);
    receipt[key] = value;
    expectReviewError(
      () => validateReviewReceipt(receipt, prepared),
      /stale/,
    );
  }
});

test('blocking independent finding forces changes-required', (t) => {
  const prepared = prepare(t);
  const reviewerFindings = [
    {
      id: 'review.content.1',
      category: 'content',
      severity: 'blocking',
      location: 'surface.connect',
      evidence: 'Independent rendered review',
      observed: 'The main instruction is ambiguous.',
      consequence: 'A user cannot choose the correct account.',
      correction: 'Clarify the account identity before the commitment.',
    },
  ];
  const receipt = reviewReceipt(prepared, {
    decision: 'changes-required',
    reviewerFindings,
  });

  assert.equal(validateReviewReceipt(receipt, prepared).valid, true);
});

test('accepted is illegal when evaluator remains unproven', (t) => {
  const prepared = prepare(
    t,
    createFixtureBundle({
      calibration: 'boundary',
      mutateEvidence: ({ candidate }) => {
        candidate.evidence[0].status = 'unproven';
      },
    }),
  );
  const receipt = reviewReceipt(prepared, { decision: 'accepted' });

  expectReviewError(
    () => validateReviewReceipt(receipt, prepared),
    /incompatible/,
  );
});

test('legacy cryptographic attestation fields fail closed', (t) => {
  const prepared = prepare(t);
  const receipt = {
    ...reviewReceipt(prepared),
    attestation: {
      digest: `sha256:${'0'.repeat(64)}`,
      algorithm: 'ed25519',
      signature: 'legacy',
    },
  };

  expectReviewError(
    () => validateReviewReceipt(receipt, prepared),
    /unknown or missing fields/,
  );
});
