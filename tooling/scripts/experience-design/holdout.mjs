import fs from 'node:fs';
import path from 'node:path';

import {
  canonicalDigest,
  fail,
  isPlainObject,
} from './canonical.mjs';
import { evaluateExperienceCase } from './evaluator.mjs';
import { validateReviewReceipt } from './review-receipt.mjs';
import { validateExperienceCaseValue } from './schema.mjs';
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

export function validateHoldoutLedger({
  fixturesRoot,
  ruleCatalog,
  grammar,
  trustedIssuers,
  repoRoot,
}) {
  const ledgerDirectory = path.join(fixturesRoot, 'holdout-ledger');
  const caseDirectory = path.join(fixturesRoot, 'holdout');
  const resultDirectory = path.join(fixturesRoot, 'holdout-results');
  const reviewDirectory = path.join(fixturesRoot, 'reviews');
  const holdoutCases = new Map();
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
    const previousCaseDigest = holdoutCases.get(record.holdoutId);
    if (
      previousCaseDigest !== undefined
      && previousCaseDigest !== record.caseDigest
    ) {
      fail(
        'HOLDOUT_INTEGRITY_INVALID',
        'holdout ID resolves to multiple case digests',
        {
          holdoutId: record.holdoutId,
          first: previousCaseDigest,
          second: record.caseDigest,
        },
      );
    }
    holdoutCases.set(record.holdoutId, record.caseDigest);

    const caseArtifact = readAddressed(
      caseDirectory,
      record.caseDigest,
      'holdout case',
    );
    const loadedCase = validateExperienceCaseValue(caseArtifact.value, {
      ruleCatalog,
      grammar,
      trustedIssuers,
    });
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
    const expectedResult = evaluateExperienceCase(loadedCase, {
      ruleCatalog,
      grammar,
      evaluatorVersionDigest,
      repoRoot,
    });
    if (
      canonicalDigest(expectedResult) !== record.firstResultDigest
      || canonicalDigest(resultArtifact.value) !== canonicalDigest(expectedResult)
    ) {
      fail(
        'HOLDOUT_INTEGRITY_INVALID',
        'first holdout result is not the deterministic result for the case',
      );
    }
    const reviewArtifact = readAddressed(
      reviewDirectory,
      record.reviewReceiptDigest,
      'holdout review receipt',
    );
    validateReviewReceipt(reviewArtifact.value, {
      loadedCase,
      result: resultArtifact.value,
      trustedIssuers,
    });

    if (record.promotedCaseId !== undefined) {
      const promoted = findPromotedCase(fixturesRoot, record);
      const loadedPromoted = validateExperienceCaseValue(promoted, {
        ruleCatalog,
        grammar,
        trustedIssuers,
      });
      const provenance = loadedPromoted.case.promotedFromBlind;
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
    });
  }

  return {
    ok: true,
    kind: 'peers-touch-experience-holdout-validation',
    schemaVersion: 1,
    records,
  };
}
