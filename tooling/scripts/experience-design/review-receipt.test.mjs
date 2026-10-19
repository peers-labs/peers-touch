import assert from 'node:assert/strict';
import { sign } from 'node:crypto';
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
import {
  reviewReceiptPayload,
  validateReviewReceipt,
} from './review-receipt.mjs';
import {
  loadGrammar,
  loadRuleCatalog,
  loadTrustedIssuers,
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
  const issuerPath = path.join(temporaryRoot, 'issuers.json');
  fs.writeFileSync(issuerPath, `${JSON.stringify(bundle.issuers)}\n`);
  const trustedIssuers = loadTrustedIssuers(issuerPath);
  const loadedCase = validateExperienceCaseValue(bundle.experienceCase, {
    ruleCatalog,
    grammar,
    trustedIssuers,
  });
  const result = evaluateExperienceCase(loadedCase, {
    ruleCatalog,
    grammar,
    evaluatorVersionDigest,
    repoRoot: REPO_ROOT,
  });
  return {
    bundle,
    issuerPath,
    loadedCase,
    result,
    temporaryRoot,
    trustedIssuers,
  };
}

function reviewerPrincipal() {
  return {
    issuer: 'fixture-authority',
    keyId: 'fixture-ed25519',
    subject: 'review-author',
  };
}

function signedReceipt(
  prepared,
  {
    decision = 'accepted',
    findingIds = prepared.result.findings.map((finding) => finding.id),
    reviewerFindings = [],
    reviewer = reviewerPrincipal(),
  } = {},
) {
  const receipt = {
    kind: 'peers-touch-experience-review',
    schemaVersion: 1,
    caseId: prepared.loadedCase.case.id,
    caseDigest: prepared.loadedCase.digests.case,
    contractDigest: prepared.loadedCase.digests.contract,
    candidateDigest: prepared.loadedCase.digests.candidate,
    resultDigest: canonicalDigest(prepared.result),
    reviewer,
    reviewedAt: '2026-10-18T18:00:00.000Z',
    decision,
    findingIds,
    reviewerFindings,
    attestation: {
      digest: 'sha256:'.padEnd(71, '0'),
      principal: reviewer,
      algorithm: 'ed25519',
      signature: 'pending',
    },
  };
  receipt.attestation.digest = canonicalDigest(reviewReceiptPayload(receipt));
  receipt.attestation.signature = sign(
    null,
    Buffer.from(receipt.attestation.digest, 'utf8'),
    prepared.bundle.signer.privateKey,
  ).toString('base64');
  return receipt;
}

function expectReviewError(action, pattern) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof ExperienceDesignError);
    assert.equal(error.code, 'INDEPENDENT_REVIEW_REQUIRED');
    assert.match(error.message, pattern);
    return true;
  });
}

test('valid signed independent review accepts a ready result', (t) => {
  const prepared = prepare(t);
  const receipt = signedReceipt(prepared);

  const validation = validateReviewReceipt(receipt, prepared);

  assert.equal(validation.valid, true);
  assert.equal(validation.decision, 'accepted');
});

test('CLI validates the exact current case, result, and receipt chain', (t) => {
  const prepared = prepare(t);
  const receipt = signedReceipt(prepared);
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
    '--trusted-issuers',
    prepared.issuerPath,
  ]);

  assert.equal(validation.valid, true);
  assert.equal(validation.decision, 'accepted');
});

test('reviewer cannot overlap any case author', (t) => {
  const prepared = prepare(t);
  const receipt = signedReceipt(prepared, {
    reviewer: prepared.loadedCase.case.authorship.contractAuthor,
  });

  expectReviewError(
    () => validateReviewReceipt(receipt, prepared),
    /independent/,
  );
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
  const receipt = signedReceipt(prepared, {
    decision: 'changes-required',
    findingIds: [],
  });

  expectReviewError(
    () => validateReviewReceipt(receipt, prepared),
    /exactly bind/,
  );
});

test('receipt is stale when the result digest changes', (t) => {
  const prepared = prepare(t);
  const receipt = signedReceipt(prepared);
  receipt.resultDigest = 'sha256:'.padEnd(71, '1');

  expectReviewError(
    () => validateReviewReceipt(receipt, prepared),
    /stale/,
  );
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
  const receipt = signedReceipt(prepared, {
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
  const receipt = signedReceipt(prepared, { decision: 'accepted' });

  expectReviewError(
    () => validateReviewReceipt(receipt, prepared),
    /incompatible/,
  );
});
