import fs from 'node:fs';
import path from 'node:path';

import {
  ExperienceDesignError,
  canonicalDigest,
  fail,
  isPlainObject,
} from './canonical.mjs';
import { evaluateExperienceCase } from './evaluator.mjs';
import { validateReviewReceipt } from './review-receipt.mjs';
import {
  validateExperienceCaseValue,
  validateRuleCatalogValue,
  validateGrammarValue,
} from './schema.mjs';
import { controlPlaneVersionDigest } from './source-version.mjs';

function digestBasename(digest) {
  return `${digest.slice('sha256:'.length)}.json`;
}

function readJson(sourcePath, context) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  } catch (error) {
    fail('HOLDOUT_INTEGRITY_INVALID', `${context} is unreadable JSON`, {
      path: sourcePath,
      reason: error.message,
    });
  }
  return value;
}

function assertDigest(value, context) {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    fail('HOLDOUT_INTEGRITY_INVALID', `${context} must be a sha256 digest`);
  }
}

function assertId(value, context) {
  if (
    typeof value !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  ) {
    fail('HOLDOUT_INTEGRITY_INVALID', `${context} must be a stable ID`);
  }
}

function assertClosed(value, required, optional, context) {
  if (!isPlainObject(value)) {
    fail('HOLDOUT_INTEGRITY_INVALID', `${context} must be an object`);
  }
  const allowed = new Set([...required, ...optional]);
  const missing = required.filter((key) => !Object.hasOwn(value, key));
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (missing.length > 0 || unknown.length > 0) {
    fail(
      'HOLDOUT_INTEGRITY_INVALID',
      `${context} has unknown or missing fields`,
      { missing, unknown },
    );
  }
}

function readAddressed(directory, digest, context) {
  assertDigest(digest, `${context}.digest`);
  const sourcePath = path.join(directory, digestBasename(digest));
  const value = readJson(sourcePath, context);
  const actual = canonicalDigest(value);
  if (actual !== digest) {
    fail(
      'HOLDOUT_INTEGRITY_INVALID',
      `${context} content digest does not match its address`,
      { expected: digest, actual, path: sourcePath },
    );
  }
  return { value, sourcePath };
}

function validateLedgerRecord(record, context) {
  assertClosed(
    record,
    [
      'kind',
      'schemaVersion',
      'holdoutId',
      'caseDigest',
      'firstResultDigest',
      'reviewReceiptDigest',
      'evaluatorSnapshotDigest',
    ],
    ['promotedCaseId', 'promotedCaseDigest'],
    context,
  );
  if (
    record.kind !== 'peers-touch-experience-holdout-record'
    || record.schemaVersion !== 1
  ) {
    fail(
      'HOLDOUT_INTEGRITY_INVALID',
      `${context} identity is unsupported`,
    );
  }
  assertId(record.holdoutId, `${context}.holdoutId`);
  for (const key of [
    'caseDigest',
    'firstResultDigest',
    'reviewReceiptDigest',
    'evaluatorSnapshotDigest',
  ]) {
    assertDigest(record[key], `${context}.${key}`);
  }
  const hasPromotedId = Object.hasOwn(record, 'promotedCaseId');
  const hasPromotedDigest = Object.hasOwn(record, 'promotedCaseDigest');
  if (hasPromotedId !== hasPromotedDigest) {
    fail(
      'HOLDOUT_INTEGRITY_INVALID',
      `${context} promotion fields must be both present or both absent`,
    );
  }
  if (hasPromotedId) {
    assertId(record.promotedCaseId, `${context}.promotedCaseId`);
    assertDigest(record.promotedCaseDigest, `${context}.promotedCaseDigest`);
  }
}

function listJsonFiles(directory) {
  try {
    return fs
      .readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => path.join(directory, entry.name))
      .sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function calibrationCases(fixturesRoot) {
  return ['positive', 'negative', 'boundary']
    .flatMap((classification) => listJsonFiles(path.join(fixturesRoot, classification)))
    .map((sourcePath) => ({ value: readJson(sourcePath, 'calibration case'), sourcePath }));
}

function findPromotedCase(fixturesRoot, record) {
  const candidates = ['positive', 'negative', 'boundary']
    .flatMap((classification) =>
      listJsonFiles(path.join(fixturesRoot, classification)));
  for (const candidatePath of candidates) {
    const candidate = readJson(candidatePath, 'promoted calibration case');
    if (
      candidate.id === record.promotedCaseId
      && canonicalDigest(candidate) === record.promotedCaseDigest
    ) {
      return candidate;
    }
  }
  fail(
    'HOLDOUT_INTEGRITY_INVALID',
    'promoted calibration case cannot be resolved',
    {
      promotedCaseId: record.promotedCaseId,
      promotedCaseDigest: record.promotedCaseDigest,
    },
  );
}

function historicalInputs(fixturesRoot, record) {
  const snapshot = readAddressed(
    path.join(fixturesRoot, 'evaluator-snapshots'),
    record.evaluatorSnapshotDigest,
    'evaluator snapshot',
  ).value;
  assertClosed(snapshot, ['kind', 'schemaVersion', 'sourceDigest', 'rules', 'grammar'], [], 'evaluator snapshot');
  if (snapshot.kind !== 'peers-touch-experience-evaluator-snapshot' || snapshot.schemaVersion !== 1) {
    fail('HOLDOUT_INTEGRITY_INVALID', 'evaluator snapshot identity is unsupported');
  }
  assertDigest(snapshot.sourceDigest, 'evaluator snapshot sourceDigest');
  return {
    sourceDigest: snapshot.sourceDigest,
    ruleCatalog: validateRuleCatalogValue(snapshot.rules),
    grammar: validateGrammarValue(snapshot.grammar),
  };
}

function validateHistoricalResult(result, loadedCase, snapshot) {
  assertClosed(result, [
    'kind', 'schemaVersion', 'caseId', 'evaluatedAt', 'evaluatorVersionDigest',
    'caseDigest', 'contractDigest', 'candidateDigest', 'disposition',
    'derivedPathCosts', 'findings', 'unprovenEvidenceRequirementIds',
  ], [], 'historical evaluation result');
  if (result.kind !== 'peers-touch-experience-findings' || result.schemaVersion !== 1
    || result.caseId !== loadedCase.case.id
    || ['case', 'contract', 'candidate'].some((field) => result[`${field}Digest`] !== loadedCase.digests[field])
    || result.evaluatorVersionDigest !== canonicalDigest({
      source: snapshot.sourceDigest, rules: snapshot.ruleCatalog.digest, grammar: snapshot.grammar.digest,
    })) {
    fail('HOLDOUT_INTEGRITY_INVALID', 'historical result does not bind its case and evaluator snapshot');
  }
  if (!['changes-required', 'ready-for-independent-review', 'unproven'].includes(result.disposition)
    || !Array.isArray(result.findings) || !Array.isArray(result.unprovenEvidenceRequirementIds)) {
    fail('HOLDOUT_INTEGRITY_INVALID', 'historical result has invalid findings or disposition');
  }
  if (typeof result.evaluatedAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result.evaluatedAt)
    || !Number.isFinite(Date.parse(result.evaluatedAt))
    || new Date(result.evaluatedAt).toISOString() !== result.evaluatedAt) {
    fail('HOLDOUT_INTEGRITY_INVALID', 'historical result timestamp is invalid');
  }
  const journeyIds = loadedCase.case.candidate.journeys?.map((journey) => journey.journeyId);
  if (!Array.isArray(journeyIds) || !isPlainObject(result.derivedPathCosts)
    || JSON.stringify(Object.keys(result.derivedPathCosts).sort()) !== JSON.stringify([...journeyIds].sort())) {
    fail('HOLDOUT_INTEGRITY_INVALID', 'historical path costs do not bind Journey IDs');
  }
  for (const cost of Object.values(result.derivedPathCosts)) {
    assertClosed(cost, ['commitments', 'contextSwitches', 'decisionLoad', 'interruptions', 'recoveryDebt'], [], 'historical path cost');
    if (Object.values(cost).some((value) => !Number.isSafeInteger(value) || value < 0)) {
      fail('HOLDOUT_INTEGRITY_INVALID', 'historical path cost requires nonnegative integers');
    }
  }
  const requirements = new Set(loadedCase.case.contract.requiredEvidence?.map((requirement) => requirement.id));
  const unprovenIds = result.unprovenEvidenceRequirementIds;
  if (new Set(unprovenIds).size !== unprovenIds.length || unprovenIds.some((id) => !requirements.has(id))) {
    fail('HOLDOUT_INTEGRITY_INVALID', 'historical unproven references are unknown or duplicated');
  }
  const findingIds = new Set();
  for (const finding of result.findings) {
    assertClosed(finding, ['id', 'ruleId', 'severity', 'owner', 'location', 'observed', 'consequence', 'correction'], [], 'historical finding');
    assertId(finding.id, 'historical finding ID');
    for (const field of ['location', 'observed', 'consequence', 'correction']) {
      if (typeof finding[field] !== 'string' || finding[field].trim() === '') {
        fail('HOLDOUT_INTEGRITY_INVALID', `historical finding ${field} is invalid`);
      }
    }
    const rule = snapshot.ruleCatalog.rules.get(finding.ruleId);
    if (rule === undefined || findingIds.has(finding.id)
      || finding.severity !== rule.severity || finding.owner !== rule.owner) {
      fail('HOLDOUT_INTEGRITY_INVALID', 'historical finding does not match its frozen rule catalog');
    }
    findingIds.add(finding.id);
  }
  const matchingSeverity = snapshot.ruleCatalog.value.precedence.find(
    (severity) => result.findings.some((finding) => finding.severity === severity),
  );
  const matchingDispositions = matchingSeverity === undefined
    ? new Set([snapshot.ruleCatalog.value.readyDisposition])
    : new Set(result.findings
      .filter((finding) => finding.severity === matchingSeverity)
      .map((finding) => snapshot.ruleCatalog.rules.get(finding.ruleId).disposition));
  if (matchingDispositions.size !== 1) {
    fail('HOLDOUT_INTEGRITY_INVALID', 'historical precedence maps to conflicting dispositions');
  }
  const [expectedDisposition] = matchingDispositions;
  if (result.disposition !== expectedDisposition) {
    fail('HOLDOUT_INTEGRITY_INVALID', 'historical disposition contradicts its frozen findings');
  }
  const evidenceIds = result.findings.filter((finding) => finding.ruleId === 'ED-EVIDENCE-001')
    .map((finding) => finding.location.replace(/^contract\.requiredEvidence\./, '')).sort();
  if (JSON.stringify(evidenceIds) !== JSON.stringify([...unprovenIds].sort())
    || (result.disposition === 'ready-for-independent-review' && unprovenIds.length > 0)) {
    fail('HOLDOUT_INTEGRITY_INVALID', 'historical evidence findings and unproven references disagree');
  }
}

function historicalCase(value) {
  assertClosed(value, ['kind', 'schemaVersion', 'id', 'title', 'calibration', 'claim', 'authorship', 'contract', 'candidate'], [], 'historical case');
  if (value.kind !== 'peers-touch-experience-case' || value.schemaVersion !== 1 || value.calibration !== 'blind') {
    fail('HOLDOUT_INTEGRITY_INVALID', 'historical case must be a blind Experience Case');
  }
  assertId(value.id, 'historical case ID');
  assertClosed(value.authorship, ['contractAuthorId', 'candidateAuthorId', 'evidenceAuthorIds'], [], 'historical authorship');
  assertId(value.authorship.contractAuthorId, 'historical contract author');
  assertId(value.authorship.candidateAuthorId, 'historical candidate author');
  if (!Array.isArray(value.authorship.evidenceAuthorIds) || !Array.isArray(value.candidate?.evidence)
    || !isPlainObject(value.contract) || !isPlainObject(value.candidate)) {
    fail('HOLDOUT_INTEGRITY_INVALID', 'historical case author/evidence bindings are invalid');
  }
  value.authorship.evidenceAuthorIds.forEach((id) => assertId(id, 'historical evidence author'));
  const candidate = { ...value.candidate };
  delete candidate.evidence;
  return {
    case: value,
    digests: {
      case: canonicalDigest(value), contract: canonicalDigest(value.contract),
      candidate: canonicalDigest(candidate),
    },
  };
}

function currentEvaluation(value, options) {
  try {
    const result = evaluateExperienceCase(
      validateExperienceCaseValue(value, options), options,
    );
    return { currentResultDigest: canonicalDigest(result), currentEvaluationStatus: 'evaluated' };
  } catch (error) {
    if (!(error instanceof ExperienceDesignError)) throw error;
    return {
      currentResultDigest: null, currentEvaluationStatus: 'unproven',
      currentEvaluationError: { code: error.code, message: error.message },
    };
  }
}

export function validateHoldoutLedger({
  fixturesRoot,
  ruleCatalog,
  grammar,
  repoRoot,
}) {
  const ledgerDirectory = path.join(fixturesRoot, 'holdout-ledger');
  const caseDirectory = path.join(fixturesRoot, 'holdout');
  const resultDirectory = path.join(fixturesRoot, 'holdout-results');
  const reviewDirectory = path.join(fixturesRoot, 'reviews');
  const holdoutIds = new Set();
  const records = [];
  const evaluatorVersionDigest = controlPlaneVersionDigest();

  for (const ledgerPath of listJsonFiles(ledgerDirectory)) {
    const record = readJson(ledgerPath, 'holdout ledger record');
    validateLedgerRecord(record, 'holdoutLedger');
    const ledgerDigest = canonicalDigest(record);
    if (path.basename(ledgerPath) !== digestBasename(ledgerDigest)) {
      fail(
        'HOLDOUT_INTEGRITY_INVALID',
        'holdout ledger filename is not content-addressed',
        {
          path: ledgerPath,
          expected: digestBasename(ledgerDigest),
        },
      );
    }
    if (holdoutIds.has(record.holdoutId)) {
      fail(
        'HOLDOUT_INTEGRITY_INVALID',
        'holdout ID resolves to multiple sealed chains',
        {
          holdoutId: record.holdoutId,
        },
      );
    }
    holdoutIds.add(record.holdoutId);

    const caseArtifact = readAddressed(
      caseDirectory,
      record.caseDigest,
      'holdout case',
    );
    const snapshot = historicalInputs(fixturesRoot, record);
    const loadedCase = historicalCase(caseArtifact.value);
    if (
      loadedCase.case.calibration !== 'blind'
      || loadedCase.case.id !== record.holdoutId
    ) {
      fail(
        'HOLDOUT_INTEGRITY_INVALID',
        'holdout case must remain blind and bind the ledger holdout ID',
      );
    }
    const resultArtifact = readAddressed(
      resultDirectory,
      record.firstResultDigest,
      'first holdout result',
    );
    validateHistoricalResult(resultArtifact.value, loadedCase, snapshot);
    const reviewArtifact = readAddressed(
      reviewDirectory,
      record.reviewReceiptDigest,
      'holdout review receipt',
    );
    validateReviewReceipt(reviewArtifact.value, {
      loadedCase,
      result: resultArtifact.value,
    });

    if (record.promotedCaseId !== undefined) {
      const promoted = findPromotedCase(fixturesRoot, record);
      const provenance = promoted.promotedFromBlind;
      if (
        provenance === undefined
        || provenance.holdoutId !== record.holdoutId
        || provenance.caseDigest !== record.caseDigest
        || provenance.firstResultDigest !== record.firstResultDigest
        || provenance.reviewReceiptDigest !== record.reviewReceiptDigest
      ) {
        fail(
          'HOLDOUT_INTEGRITY_INVALID',
          'promoted calibration case does not bind the immutable blind chain',
        );
      }
    }
    records.push({
      holdoutId: record.holdoutId,
      caseDigest: record.caseDigest,
      firstResultDigest: record.firstResultDigest,
      reviewReceiptDigest: record.reviewReceiptDigest,
      ledgerDigest,
      evaluatorSnapshotDigest: record.evaluatorSnapshotDigest,
      ...currentEvaluation(caseArtifact.value, { ruleCatalog, grammar, evaluatorVersionDigest, repoRoot }),
    });
  }
  const promotedIds = new Set();
  for (const { value: promoted } of calibrationCases(fixturesRoot)) {
    if (!isPlainObject(promoted)) continue;
    if (promoted.promotedFromBlind === undefined) continue;
    if (typeof promoted.id !== 'string'
      || promotedIds.has(promoted.id)
      || holdoutIds.has(promoted.id)) {
      fail('HOLDOUT_INTEGRITY_INVALID', 'promotion ID is invalid, duplicated, or reused from a sealed blind case');
    }
    promotedIds.add(promoted.id);
    const provenance = promoted.promotedFromBlind;
    const record = records.find((entry) => entry.holdoutId === provenance.holdoutId);
    if (record === undefined) {
      fail('HOLDOUT_INTEGRITY_INVALID', 'promoted calibration case has no sealed blind chain');
    }
    const ledger = readAddressed(ledgerDirectory, record.ledgerDigest, 'promotion ledger').value;
    if (promoted.id === ledger.holdoutId || ledger.promotedCaseId !== promoted.id
      || ledger.promotedCaseDigest !== canonicalDigest(promoted)
      || ['caseDigest', 'firstResultDigest', 'reviewReceiptDigest'].some(
        (field) => provenance[field] !== ledger[field],
      )) {
      fail('HOLDOUT_INTEGRITY_INVALID', 'promotion lacks reciprocal immutable ledger binding');
    }
  }

  return {
    ok: true,
    kind: 'peers-touch-experience-holdout-validation',
    schemaVersion: 1,
    records,
  };
}
