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
import { validateHoldoutLedger } from './holdout.mjs';
import { reviewReceiptPayload } from './review-receipt.mjs';
import {
  loadGrammar,
  loadRuleCatalog,
  loadTrustedIssuers,
  validateExperienceCaseValue,
} from './schema.mjs';
import { controlPlaneVersionDigest } from './source-version.mjs';
import {
  createFixtureBundle,
  createFixtureSigner,
} from './test-fixture.mjs';

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

function digestFilename(digest) {
  return `${digest.slice(7)}.json`;
}

function writeAddressed(directory, value) {
  fs.mkdirSync(directory, { recursive: true });
  const digest = canonicalDigest(value);
  fs.writeFileSync(
    path.join(directory, digestFilename(digest)),
    `${JSON.stringify(value, null, 2)}\n`,
  );
  return digest;
}

function signReview(bundle, loadedCase, result) {
  const reviewer = {
    issuer: 'fixture-authority',
    keyId: 'fixture-ed25519',
    subject: 'review-author',
  };
  const receipt = {
    kind: 'peers-touch-experience-review',
    schemaVersion: 1,
    caseId: loadedCase.case.id,
    caseDigest: loadedCase.digests.case,
    contractDigest: loadedCase.digests.contract,
    candidateDigest: loadedCase.digests.candidate,
    resultDigest: canonicalDigest(result),
    reviewer,
    reviewedAt: '2026-10-18T18:00:00.000Z',
    decision: 'accepted',
    findingIds: result.findings.map((finding) => finding.id),
    reviewerFindings: [],
    attestation: {
      digest: `sha256:${'0'.repeat(64)}`,
      principal: reviewer,
      algorithm: 'ed25519',
      signature: 'pending',
    },
  };
  receipt.attestation.digest = canonicalDigest(reviewReceiptPayload(receipt));
  receipt.attestation.signature = sign(
    null,
    Buffer.from(receipt.attestation.digest, 'utf8'),
    bundle.signer.privateKey,
  ).toString('base64');
  return receipt;
}

function prepareRoot(t, signer = createFixtureSigner()) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'experience-holdout-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const seed = createFixtureBundle({ signer });
  const issuerPath = path.join(root, 'trusted-issuers.json');
  fs.writeFileSync(issuerPath, `${JSON.stringify(seed.issuers, null, 2)}\n`);
  const trustedIssuers = loadTrustedIssuers(issuerPath);
  for (const directory of [
    'holdout',
    'holdout-results',
    'reviews',
    'holdout-ledger',
    'positive',
    'negative',
    'boundary',
  ]) {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
  }
  return { root, signer, trustedIssuers };
}

function writeChain(environment, bundle) {
  const loadedCase = validateExperienceCaseValue(bundle.experienceCase, {
    ruleCatalog,
    grammar,
    trustedIssuers: environment.trustedIssuers,
  });
  const result = evaluateExperienceCase(loadedCase, {
    ruleCatalog,
    grammar,
    evaluatorVersionDigest,
    repoRoot: REPO_ROOT,
  });
  const receipt = signReview(bundle, loadedCase, result);
  const caseDigest = writeAddressed(
    path.join(environment.root, 'holdout'),
    bundle.experienceCase,
  );
  const firstResultDigest = writeAddressed(
    path.join(environment.root, 'holdout-results'),
    result,
  );
  const reviewReceiptDigest = writeAddressed(
    path.join(environment.root, 'reviews'),
    receipt,
  );
  const ledger = {
    kind: 'peers-touch-experience-holdout-record',
    schemaVersion: 1,
    holdoutId: bundle.experienceCase.id,
    caseDigest,
    firstResultDigest,
    reviewReceiptDigest,
  };
  const ledgerDigest = writeAddressed(
    path.join(environment.root, 'holdout-ledger'),
    ledger,
  );
  return { ledger, ledgerDigest };
}

function validate(environment) {
  return validateHoldoutLedger({
    fixturesRoot: environment.root,
    ruleCatalog,
    grammar,
    trustedIssuers: environment.trustedIssuers,
    repoRoot: REPO_ROOT,
  });
}

test('validates one immutable content-addressed blind chain', (t) => {
  const environment = prepareRoot(t);
  const bundle = createFixtureBundle({
    signer: environment.signer,
    calibration: 'blind',
    caseId: 'holdout.first-real-example',
  });
  writeChain(environment, bundle);

  const result = validate(environment);

  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].holdoutId, 'holdout.first-real-example');
});

test('rejects a ledger whose filename is not its content digest', (t) => {
  const environment = prepareRoot(t);
  const bundle = createFixtureBundle({
    signer: environment.signer,
    calibration: 'blind',
    caseId: 'holdout.bad-address',
  });
  const { ledgerDigest } = writeChain(environment, bundle);
  fs.renameSync(
    path.join(
      environment.root,
      'holdout-ledger',
      digestFilename(ledgerDigest),
    ),
    path.join(environment.root, 'holdout-ledger', `${'f'.repeat(64)}.json`),
  );

  assert.throws(() => validate(environment), (error) => {
    assert.ok(error instanceof ExperienceDesignError);
    assert.equal(error.code, 'HOLDOUT_INTEGRITY_INVALID');
    assert.match(error.message, /filename is not content-addressed/);
    return true;
  });
});

test('rejects reuse of one holdout ID for changed content', (t) => {
  const environment = prepareRoot(t);
  const first = createFixtureBundle({
    signer: environment.signer,
    calibration: 'blind',
    caseId: 'holdout.reused',
    title: 'First immutable case',
  });
  const second = createFixtureBundle({
    signer: environment.signer,
    calibration: 'blind',
    caseId: 'holdout.reused',
    title: 'Changed case content',
  });
  writeChain(environment, first);
  writeChain(environment, second);

  assert.throws(() => validate(environment), (error) => {
    assert.ok(error instanceof ExperienceDesignError);
    assert.equal(error.code, 'HOLDOUT_INTEGRITY_INVALID');
    assert.match(error.message, /multiple case digests/);
    return true;
  });
});
