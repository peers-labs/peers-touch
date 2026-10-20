import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runCalibration } from './calibration.mjs';
import {
  ExperienceDesignError,
  canonicalDigest,
} from './canonical.mjs';
import { evaluateExperienceCase } from './evaluator.mjs';
import { runCli } from './experience-design.mjs';
import { validateHoldoutLedger } from './holdout.mjs';
import { validateReviewReceipt } from './review-receipt.mjs';
import {
  loadGrammar,
  loadRuleCatalog,
  validateRuleCatalogValue,
  validateExperienceCaseValue,
} from './schema.mjs';
import { controlPlaneVersionDigest } from './source-version.mjs';
import { createFixtureBundle } from './test-fixture.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../../..');
const FIXTURES_ROOT = path.join(SCRIPT_DIR, 'fixtures');
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
const HISTORICAL_SOURCE_DIGEST = `sha256:${'9'.repeat(64)}`;
const OTHER_DIGEST = `sha256:${'8'.repeat(64)}`;

function readJson(sourcePath) {
  return JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
}

function writeJson(sourcePath, value) {
  fs.writeFileSync(sourcePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeAddressed(root, directory, value) {
  const digest = canonicalDigest(value);
  const sourcePath = path.join(root, directory, `${digest.slice(7)}.json`);
  writeJson(sourcePath, value);
  return { digest, sourcePath };
}

function prepareRoot(t, { calibration = false } = {}) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'experience-holdout-regression-'),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const directory of [
    'holdout',
    'holdout-results',
    'evaluator-snapshots',
    'reviews',
    'holdout-ledger',
    'positive',
    'negative',
    'boundary',
  ]) {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
  }
  if (calibration) {
    fs.copyFileSync(
      path.join(FIXTURES_ROOT, 'calibration-manifest.json'),
      path.join(root, 'calibration-manifest.json'),
    );
    for (const classification of ['positive', 'negative', 'boundary']) {
      fs.cpSync(
        path.join(FIXTURES_ROOT, classification),
        path.join(root, classification),
        { recursive: true },
      );
    }
  }
  return { root };
}

function writeChain(
  environment,
  experienceCase,
  {
    sourceDigest = controlPlaneVersionDigest(),
    mutateResult = undefined,
  } = {},
) {
  const loadedCase = validateExperienceCaseValue(experienceCase, {
    ruleCatalog,
    grammar,
  });
  const snapshot = {
    kind: 'peers-touch-experience-evaluator-snapshot',
    schemaVersion: 1,
    sourceDigest,
    rules: structuredClone(ruleCatalog.value),
    grammar: structuredClone(grammar.value),
  };
  const result = evaluateExperienceCase(loadedCase, {
    ruleCatalog,
    grammar,
    evaluatorVersionDigest: sourceDigest,
    repoRoot: REPO_ROOT,
  });
  if (mutateResult !== undefined) mutateResult(result);
  const receipt = {
    kind: 'peers-touch-experience-review',
    schemaVersion: 1,
    caseId: loadedCase.case.id,
    caseDigest: loadedCase.digests.case,
    contractDigest: loadedCase.digests.contract,
    candidateDigest: loadedCase.digests.candidate,
    resultDigest: canonicalDigest(result),
    reviewerId: 'independent-holdout-reviewer',
    reviewedAt: '2026-10-20T10:00:00.000Z',
    decision: 'accepted',
    findingIds: result.findings.map((finding) => finding.id),
    reviewerFindings: [],
  };
  const artifacts = {
    case: writeAddressed(environment.root, 'holdout', experienceCase),
    snapshot: writeAddressed(
      environment.root,
      'evaluator-snapshots',
      snapshot,
    ),
    result: writeAddressed(environment.root, 'holdout-results', result),
    receipt: writeAddressed(environment.root, 'reviews', receipt),
  };
  const record = {
    kind: 'peers-touch-experience-holdout-record',
    schemaVersion: 1,
    holdoutId: experienceCase.id,
    caseDigest: artifacts.case.digest,
    evaluatorSnapshotDigest: artifacts.snapshot.digest,
    firstResultDigest: artifacts.result.digest,
    reviewReceiptDigest: artifacts.receipt.digest,
  };
  artifacts.ledger = writeAddressed(
    environment.root,
    'holdout-ledger',
    record,
  );
  return { loadedCase, snapshot, result, receipt, record, artifacts };
}

function replaceLedger(environment, chain, record) {
  fs.unlinkSync(chain.artifacts.ledger.sourcePath);
  chain.record = record;
  chain.artifacts.ledger = writeAddressed(
    environment.root,
    'holdout-ledger',
    record,
  );
}

function writePromotion(
  environment,
  chain,
  {
    caseId = 'fixture.positive.promoted-setup',
    reciprocal = true,
  } = {},
) {
  const sourcePath = path.join(
    environment.root,
    'positive/complete-setup.json',
  );
  const promoted = readJson(sourcePath);
  promoted.id = caseId;
  promoted.promotedFromBlind = {
    holdoutId: chain.record.holdoutId,
    caseDigest: chain.record.caseDigest,
    firstResultDigest: chain.record.firstResultDigest,
    reviewReceiptDigest: chain.record.reviewReceiptDigest,
  };
  writeJson(sourcePath, promoted);
  if (reciprocal) {
    replaceLedger(environment, chain, {
      ...chain.record,
      promotedCaseId: promoted.id,
      promotedCaseDigest: canonicalDigest(promoted),
    });
  }
  return { promoted, sourcePath };
}

function validate(environment) {
  return validateHoldoutLedger({
    fixturesRoot: environment.root,
    ruleCatalog,
    grammar,
    repoRoot: REPO_ROOT,
  });
}

function validateThroughCli(environment) {
  return runCli([
    'validate-holdouts',
    '--package-root',
    environment.root,
    '--repo-root',
    REPO_ROOT,
  ]);
}

function calibrate(environment) {
  return runCalibration({
    fixturesRoot: environment.root,
    ruleCatalog,
    grammar,
    repoRoot: REPO_ROOT,
  });
}

function assertErrorCode(callback, code = 'HOLDOUT_INTEGRITY_INVALID') {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof ExperienceDesignError);
    assert.equal(error.code, code);
    return true;
  });
}

function chainBytes(chain) {
  return Object.values(chain.artifacts).map(({ sourcePath }) => ({
    sourcePath,
    bytes: fs.readFileSync(sourcePath),
  }));
}

function assertUnchanged(before) {
  for (const { sourcePath, bytes } of before) {
    assert.deepEqual(fs.readFileSync(sourcePath), bytes, sourcePath);
  }
}

test('frozen findings retain their disposition and promotion IDs are globally unique', async (t) => {
  for (const [name, mutateResult] of [
    ['unknown unproven requirement', (result) => { result.unprovenEvidenceRequirementIds = ['unknown']; }],
    ['unproven requirement without finding', (result) => { result.unprovenEvidenceRequirementIds = ['evidence-requirement.contract']; }],
    ['invalid timestamp', (result) => { result.evaluatedAt = 'invalid'; }],
    ['missing path costs', (result) => { result.derivedPathCosts = null; }],
  ]) {
    await t.test(`rejects a historical result with ${name}`, (context) => {
      const environment = prepareRoot(context);
      writeChain(environment, createFixtureBundle({ calibration: 'blind' }).experienceCase, { mutateResult });
      assertErrorCode(() => validate(environment));
    });
  }
  await t.test('rejects blocking findings relabeled ready with an accepted receipt', (context) => {
    const environment = prepareRoot(context);
    const bundle = createFixtureBundle({ calibration: 'blind', mutate: ({ candidate }) => {
      candidate.copyNodes.push({ ...candidate.copyNodes[0], id: 'copy.duplicate' });
    } });
    writeChain(environment, bundle.experienceCase, {
      mutateResult: (result) => { result.disposition = 'ready-for-independent-review'; },
    });
    assertErrorCode(() => validate(environment));
  });
  await t.test('rejects promotion reusing a different sealed holdout ID', (context) => {
    const environment = prepareRoot(context, { calibration: true });
    const first = writeChain(environment, createFixtureBundle({ calibration: 'blind', caseId: 'holdout.first' }).experienceCase);
    writeChain(environment, createFixtureBundle({ calibration: 'blind', caseId: 'holdout.second' }).experienceCase);
    writePromotion(environment, first, { caseId: 'holdout.second' });
    assertErrorCode(() => validate(environment));
  });
  await t.test('rejects duplicate calibration IDs at separate paths', (context) => {
    const environment = prepareRoot(context, { calibration: true });
    const chain = writeChain(environment, createFixtureBundle({ calibration: 'blind' }).experienceCase);
    const promotion = writePromotion(environment, chain);
    writeJson(path.join(environment.root, 'positive/copy.json'), promotion.promoted);
    assertErrorCode(() => validate(environment));
  });
  await t.test('allows validation-error fixtures to share an intentionally invalid ID', (context) => {
    const environment = prepareRoot(context, { calibration: true });
    const manifestPath = path.join(environment.root, 'calibration-manifest.json');
    const manifest = readJson(manifestPath);
    for (const name of ['missing-id-one', 'missing-id-two']) {
      const value = createFixtureBundle({ calibration: 'negative' }).experienceCase;
      value.id = 'fixture.deliberately-invalid';
      delete value.title;
      writeJson(path.join(environment.root, `negative/${name}.json`), value);
      manifest.cases.push({ path: `negative/${name}.json`, class: 'negative',
        mode: 'validation-error', expectedErrorCode: 'ED-CONTRACT-001' });
    }
    writeJson(manifestPath, manifest);
    assert.equal(calibrate(environment).results.filter((entry) =>
      entry.path.includes('missing-id-')).length, 2);
  });
  await t.test('promoted historical integrity survives current expectation-rule removal', (context) => {
    const environment = prepareRoot(context, { calibration: true });
    const mutate = ({ candidate }) => {
      candidate.copyNodes.push({ ...candidate.copyNodes[0], id: 'copy.duplicate' });
    };
    const value = createFixtureBundle({ calibration: 'blind', mutate }).experienceCase;
    const chain = writeChain(environment, value);
    chain.receipt.decision = 'changes-required';
    const receipt = writeAddressed(environment.root, 'reviews', chain.receipt);
    replaceLedger(environment, chain, { ...chain.record, reviewReceiptDigest: receipt.digest });
    const promoted = createFixtureBundle({ calibration: 'negative', caseId: 'fixture.promoted-negative', mutate }).experienceCase;
    promoted.expected = {
      disposition: chain.result.disposition,
      expectedRuleIds: ['ED-SEM-001'],
      expectedFindingIds: chain.result.findings.map((finding) => finding.id),
    };
    promoted.promotedFromBlind = { holdoutId: chain.record.holdoutId,
      caseDigest: chain.record.caseDigest, firstResultDigest: chain.record.firstResultDigest,
      reviewReceiptDigest: chain.record.reviewReceiptDigest };
    writeJson(path.join(environment.root, 'negative/promoted.json'), promoted);
    replaceLedger(environment, chain, { ...chain.record,
      promotedCaseId: promoted.id, promotedCaseDigest: canonicalDigest(promoted) });
    const revised = structuredClone(ruleCatalog.value);
    revised.rules = revised.rules.filter((rule) => rule.id !== 'ED-SEM-001');
    const result = validateHoldoutLedger({ fixturesRoot: environment.root,
      ruleCatalog: validateRuleCatalogValue(revised), grammar, repoRoot: REPO_ROOT });
    assert.equal(result.ok, true);
    assert.equal(result.records[0].currentEvaluationStatus, 'unproven');
    assert.equal(result.records[0].currentResultDigest, null);
  });
  await t.test('preserves addressed historical inputs that current schema rejects', (context) => {
    const environment = prepareRoot(context);
    const value = createFixtureBundle({ calibration: 'blind' }).experienceCase;
    const chain = writeChain(environment, value);
    value.candidate.states.push({ ...value.candidate.states[0], id: 'state.historical', kind: 'long-content' });
    value.candidate.traces[0].stateIds.push('state.historical');
    const caseArtifact = writeAddressed(environment.root, 'holdout', value);
    chain.result.caseDigest = caseArtifact.digest;
    const candidate = { ...value.candidate };
    delete candidate.evidence;
    chain.result.candidateDigest = canonicalDigest(candidate);
    const resultArtifact = writeAddressed(environment.root, 'holdout-results', chain.result);
    Object.assign(chain.receipt, {
      caseDigest: caseArtifact.digest, candidateDigest: chain.result.candidateDigest,
      resultDigest: resultArtifact.digest,
    });
    const receiptArtifact = writeAddressed(environment.root, 'reviews', chain.receipt);
    replaceLedger(environment, chain, { ...chain.record, caseDigest: caseArtifact.digest,
      firstResultDigest: resultArtifact.digest, reviewReceiptDigest: receiptArtifact.digest });
    const result = validate(environment);
    assert.equal(result.ok, true);
    assert.equal(result.records[0].currentResultDigest, null);
    assert.equal(result.records[0].currentEvaluationStatus, 'unproven');
    assert.equal(result.records[0].currentEvaluationError.code, 'ED-CONTRACT-001');
  });
});

test('public holdout validation consumes the external package root', async (t) => {
  await t.test('returns the sealed external chain instead of an empty ledger', (t) => {
    const environment = prepareRoot(t);
    const { experienceCase } = createFixtureBundle({
      calibration: 'blind',
      caseId: 'holdout.external-cli',
    });
    const chain = writeChain(environment, experienceCase);
    const before = chainBytes(chain);

    const result = validateThroughCli(environment);

    assert.equal(result.ok, true);
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].holdoutId, experienceCase.id);
    assert.equal(result.records[0].caseDigest, chain.record.caseDigest);
    assert.equal(
      result.records[0].firstResultDigest,
      chain.record.firstResultDigest,
    );
    assert.equal(result.records[0].ledgerDigest, chain.artifacts.ledger.digest);
    assertUnchanged(before);
  });

  for (const artifact of ['case', 'result', 'snapshot', 'receipt', 'ledger']) {
    await t.test(`rejects tampering with the external ${artifact} artifact`, (t) => {
      const environment = prepareRoot(t);
      const { experienceCase } = createFixtureBundle({
        calibration: 'blind',
        caseId: `holdout.external-tamper-${artifact}`,
      });
      const chain = writeChain(environment, experienceCase);
      const { sourcePath } = chain.artifacts[artifact];
      const value = readJson(sourcePath);
      value.tampered = true;
      writeJson(sourcePath, value);

      assertErrorCode(() => validateThroughCli(environment));
    });
  }
});

test('historical holdout integrity is separate from current evaluation', async (t) => {
  await t.test('accepts a snapshot from the current evaluator version', (t) => {
    const environment = prepareRoot(t);
    const { experienceCase } = createFixtureBundle({
      calibration: 'blind',
      caseId: 'holdout.current-snapshot',
    });
    const chain = writeChain(environment, experienceCase);

    const result = validate(environment);

    assert.equal(result.ok, true);
    assert.equal(result.records.length, 1);
    assert.equal(
      result.records[0].currentResultDigest,
      chain.record.firstResultDigest,
    );
  });

  await t.test('preserves the first result and review after a source revision', (t) => {
    const environment = prepareRoot(t);
    const { experienceCase } = createFixtureBundle({
      calibration: 'blind',
      caseId: 'holdout.historical-source',
    });
    assert.notEqual(controlPlaneVersionDigest(), HISTORICAL_SOURCE_DIGEST);
    const chain = writeChain(environment, experienceCase, {
      sourceDigest: HISTORICAL_SOURCE_DIGEST,
    });
    assert.equal(
      chain.result.evaluatorVersionDigest,
      canonicalDigest({
        source: HISTORICAL_SOURCE_DIGEST,
        rules: ruleCatalog.digest,
        grammar: grammar.digest,
      }),
    );
    assert.equal(
      validateReviewReceipt(chain.receipt, {
        loadedCase: chain.loadedCase,
        result: chain.result,
      }).valid,
      true,
    );
    const currentEvaluation = evaluateExperienceCase(chain.loadedCase, {
      ruleCatalog,
      grammar,
      evaluatorVersionDigest: controlPlaneVersionDigest(),
      repoRoot: REPO_ROOT,
    });
    const currentResultDigest = canonicalDigest(currentEvaluation);
    assert.notEqual(currentResultDigest, chain.record.firstResultDigest);
    const before = chainBytes(chain);

    for (let validation = 0; validation < 2; validation += 1) {
      const result = validate(environment);

      assert.equal(result.ok, true);
      assert.equal(result.records.length, 1);
      assert.equal(
        result.records[0].firstResultDigest,
        chain.record.firstResultDigest,
      );
      assert.equal(result.records[0].currentResultDigest, currentResultDigest);
      assert.notEqual(
        result.records[0].currentResultDigest,
        result.records[0].firstResultDigest,
      );
      assertUnchanged(before);
    }
  });

  await t.test('requires the ledger to bind an evaluator snapshot', (t) => {
    const environment = prepareRoot(t);
    const { experienceCase } = createFixtureBundle({
      calibration: 'blind',
      caseId: 'holdout.missing-snapshot-binding',
    });
    const chain = writeChain(environment, experienceCase);
    const record = { ...chain.record };
    delete record.evaluatorSnapshotDigest;
    replaceLedger(environment, chain, record);

    assertErrorCode(() => validate(environment));
  });

  await t.test('rejects a missing content-addressed evaluator snapshot', (t) => {
    const environment = prepareRoot(t);
    const { experienceCase } = createFixtureBundle({
      calibration: 'blind',
      caseId: 'holdout.missing-snapshot-file',
    });
    const chain = writeChain(environment, experienceCase);
    fs.unlinkSync(chain.artifacts.snapshot.sourcePath);

    assertErrorCode(() => validate(environment));
  });

  const snapshotChanges = [
    ['source', (snapshot) => { snapshot.sourceDigest = OTHER_DIGEST; }],
    ['rules', (snapshot) => {
      snapshot.rules.rules[0].condition += ' revised';
    }],
    ['grammar', (snapshot) => {
      snapshot.grammar.sourceDocuments.push(
        'docs/architecture/engineering/experience-design/data-model.md',
      );
    }],
  ];
  for (const [component, mutate] of snapshotChanges) {
    await t.test(`binds the first result to the snapshot ${component} digest`, (t) => {
      const environment = prepareRoot(t);
      const { experienceCase } = createFixtureBundle({
        calibration: 'blind',
        caseId: `holdout.snapshot-${component}-binding`,
      });
      const chain = writeChain(environment, experienceCase, {
        sourceDigest: HISTORICAL_SOURCE_DIGEST,
      });
      const snapshot = structuredClone(chain.snapshot);
      mutate(snapshot);
      const artifact = writeAddressed(
        environment.root,
        'evaluator-snapshots',
        snapshot,
      );
      assert.notEqual(artifact.digest, chain.record.evaluatorSnapshotDigest);
      replaceLedger(environment, chain, {
        ...chain.record,
        evaluatorSnapshotDigest: artifact.digest,
      });

      assertErrorCode(() => validate(environment));
    });
  }

  for (const binding of ['caseDigest', 'contractDigest', 'candidateDigest']) {
    await t.test(`rejects a re-addressed first result with a foreign ${binding}`, (t) => {
      const environment = prepareRoot(t);
      const { experienceCase } = createFixtureBundle({
        calibration: 'blind',
        caseId: `holdout.first-result-${binding}`,
      });
      writeChain(environment, experienceCase, {
        sourceDigest: HISTORICAL_SOURCE_DIGEST,
        mutateResult: (result) => { result[binding] = OTHER_DIGEST; },
      });

      assertErrorCode(() => validate(environment));
    });
  }

  const receiptChanges = [
    ['stale result binding', (receipt) => { receipt.resultDigest = OTHER_DIGEST; }],
    ['non-independent reviewer', (receipt) => {
      receipt.reviewerId = 'contract-author';
    }],
  ];
  for (const [scenario, mutate] of receiptChanges) {
    await t.test(`rejects a re-addressed receipt with a ${scenario}`, (t) => {
      const environment = prepareRoot(t);
      const { experienceCase } = createFixtureBundle({
        calibration: 'blind',
        caseId: `holdout.receipt-${scenario.replaceAll(' ', '-')}`,
      });
      const chain = writeChain(environment, experienceCase, {
        sourceDigest: HISTORICAL_SOURCE_DIGEST,
      });
      const receipt = structuredClone(chain.receipt);
      mutate(receipt);
      const artifact = writeAddressed(environment.root, 'reviews', receipt);
      replaceLedger(environment, chain, {
        ...chain.record,
        reviewReceiptDigest: artifact.digest,
      });

      assertErrorCode(() => validate(environment), 'INDEPENDENT_REVIEW_REQUIRED');
    });
  }
});

test('calibration promotion requires reciprocal immutable blind provenance', async (t) => {
  await t.test('accepts a new calibration ID with reciprocal ledger bindings', (t) => {
    const environment = prepareRoot(t, { calibration: true });
    const { experienceCase } = createFixtureBundle({
      calibration: 'blind',
      caseId: 'holdout.reciprocal-promotion',
    });
    const chain = writeChain(environment, experienceCase, {
      sourceDigest: HISTORICAL_SOURCE_DIGEST,
    });
    const { promoted } = writePromotion(environment, chain);
    assert.notEqual(promoted.id, experienceCase.id);
    assert.equal(chain.record.promotedCaseId, promoted.id);
    assert.equal(chain.record.promotedCaseDigest, canonicalDigest(promoted));
    const before = chainBytes(chain);

    const holdouts = validate(environment);
    const calibration = calibrate(environment);

    assert.equal(holdouts.ok, true);
    assert.equal(holdouts.records.length, 1);
    assert.equal(calibration.ok, true);
    assert.equal(
      calibration.fixtureCount,
      readJson(path.join(environment.root, 'calibration-manifest.json')).cases.length,
    );
    assertUnchanged(before);
  });

  for (const mismatchExpectation of [false, true]) {
    const scenario = mismatchExpectation
      ? 'rejects orphan provenance before comparing evaluator expectations'
      : 'rejects well-formed provenance without any blind ledger';
    await t.test(scenario, (t) => {
      const environment = prepareRoot(t, { calibration: true });
      const sourcePath = path.join(
        environment.root,
        'positive/complete-setup.json',
      );
      const promoted = readJson(sourcePath);
      promoted.promotedFromBlind = {
        holdoutId: 'holdout.never-existed',
        caseDigest: HISTORICAL_SOURCE_DIGEST,
        firstResultDigest: OTHER_DIGEST,
        reviewReceiptDigest: `sha256:${'7'.repeat(64)}`,
      };
      if (mismatchExpectation) {
        promoted.expected.disposition = 'changes-required';
        const manifestPath = path.join(
          environment.root,
          'calibration-manifest.json',
        );
        const manifest = readJson(manifestPath);
        const index = manifest.cases.findIndex(
          (fixture) => fixture.path === 'positive/complete-setup.json',
        );
        assert.notEqual(index, -1);
        manifest.cases.unshift(...manifest.cases.splice(index, 1));
        writeJson(manifestPath, manifest);
      }
      writeJson(sourcePath, promoted);

      assertErrorCode(() => calibrate(environment));
    });
  }

  await t.test('rejects a matching blind chain without reciprocal promotion fields', (t) => {
    const environment = prepareRoot(t, { calibration: true });
    const { experienceCase } = createFixtureBundle({
      calibration: 'blind',
      caseId: 'holdout.non-reciprocal-promotion',
    });
    const chain = writeChain(environment, experienceCase);
    writePromotion(environment, chain, { reciprocal: false });
    assert.equal(Object.hasOwn(chain.record, 'promotedCaseId'), false);
    assert.equal(Object.hasOwn(chain.record, 'promotedCaseDigest'), false);

    assertErrorCode(() => calibrate(environment));
  });

  await t.test('rejects promotion that reuses the original blind ID', (t) => {
    const environment = prepareRoot(t, { calibration: true });
    const { experienceCase } = createFixtureBundle({
      calibration: 'blind',
      caseId: 'holdout.reused-promotion-id',
    });
    const chain = writeChain(environment, experienceCase);
    writePromotion(environment, chain, { caseId: experienceCase.id });

    assertErrorCode(() => calibrate(environment));
  });

  for (const binding of ['promotedCaseId', 'promotedCaseDigest']) {
    await t.test(`rejects a ledger with a different ${binding}`, (t) => {
      const environment = prepareRoot(t, { calibration: true });
      const { experienceCase } = createFixtureBundle({
        calibration: 'blind',
        caseId: `holdout.promotion-${binding}`,
      });
      const chain = writeChain(environment, experienceCase);
      writePromotion(environment, chain);
      replaceLedger(environment, chain, {
        ...chain.record,
        [binding]: binding === 'promotedCaseId'
          ? 'fixture.positive.different-promotion'
          : OTHER_DIGEST,
      });

      assertErrorCode(() => calibrate(environment));
    });
  }
});
