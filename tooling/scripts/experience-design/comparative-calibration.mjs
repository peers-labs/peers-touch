import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  evaluatePairedExperienceCase,
} from './comparative-evaluator.mjs';
import {
  comparativeFail,
  loadPairedExperienceCase,
} from './comparative-schema.mjs';
import {
  createComparativeFixture,
  writeComparativePackage,
} from './comparative-test-fixture.mjs';

const REQUIRED_CLASSES = ['positive', 'negative', 'boundary'];

function fail(message, details = undefined) {
  comparativeFail('COMPARATIVE_CALIBRATION_INCOMPLETE', message, details);
}

function readManifest(fixturesRoot) {
  const sourcePath = path.join(
    fixturesRoot,
    'comparative/calibration-manifest.json',
  );
  try {
    return JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  } catch (error) {
    fail('comparative calibration manifest is unreadable', {
      path: sourcePath,
      reason: error.message,
    });
  }
}

function assertExactSet(actual, expected, context) {
  const left = [...new Set(actual)].sort();
  const right = [...new Set(expected)].sort();
  if (
    left.length !== right.length
    || left.some((value, index) => value !== right[index])
  ) {
    fail(`${context} does not match`, { expected: right, actual: left });
  }
}

function validateManifest(manifest) {
  if (
    manifest?.schemaVersion !== 1
    || !Array.isArray(manifest.cases)
    || manifest.cases.length === 0
  ) fail('comparative calibration manifest shape is invalid');
  const ids = new Set();
  for (const entry of manifest.cases) {
    if (
      typeof entry.id !== 'string'
      || ids.has(entry.id)
      || !REQUIRED_CLASSES.includes(entry.class)
      || !['evaluation', 'validation-error'].includes(entry.mode)
      || typeof entry.options !== 'object'
      || entry.options === null
      || Array.isArray(entry.options)
    ) fail('comparative calibration entry is invalid', { entry });
    ids.add(entry.id);
  }
  assertExactSet(
    manifest.cases.map((entry) => entry.class),
    REQUIRED_CLASSES,
    'comparative calibration classes',
  );
}

function applyMutation(bundle, mutation) {
  if (mutation === undefined) return;
  if (mutation === 'reviewer-overlap') {
    bundle.legReviews.A.reviewerId = bundle.oracle.authoredById;
    return;
  }
  fail(`unsupported comparative calibration mutation ${mutation}`);
}

function executeEntry(entry, evaluatorVersionDigest) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cer-calibration-'));
  try {
    const bundle = createComparativeFixture(entry.options);
    applyMutation(bundle, entry.mutation);
    const casePath = writeComparativePackage(root, bundle);
    try {
      const loaded = loadPairedExperienceCase(casePath, root);
      const result = evaluatePairedExperienceCase(loaded, {
        evaluatorVersionDigest,
      });
      if (entry.mode !== 'evaluation') {
        fail(`case ${entry.id} expected validation failure`);
      }
      if (result.disposition !== entry.expectedDisposition) {
        fail(`case ${entry.id} disposition does not match`, {
          expected: entry.expectedDisposition,
          actual: result.disposition,
        });
      }
      assertExactSet(
        result.materialDifferentialIds,
        entry.expectedMaterialDifferentialIds ?? [],
        `case ${entry.id} material differentials`,
      );
      assertExactSet(
        result.unprovenAssertionIds,
        entry.expectedUnprovenAssertionIds ?? [],
        `case ${entry.id} unproven assertions`,
      );
      return {
        id: entry.id,
        class: entry.class,
        mode: entry.mode,
        disposition: result.disposition,
        materialDifferentialIds: result.materialDifferentialIds,
        unprovenAssertionIds: result.unprovenAssertionIds,
      };
    } catch (error) {
      if (
        entry.mode !== 'validation-error'
        || error.code !== entry.expectedErrorCode
      ) throw error;
      return {
        id: entry.id,
        class: entry.class,
        mode: entry.mode,
        errorCode: error.code,
      };
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

export function runComparativeCalibration({
  fixturesRoot,
  evaluatorVersionDigest,
}) {
  const manifest = readManifest(fixturesRoot);
  validateManifest(manifest);
  const results = manifest.cases.map((entry) =>
    executeEntry(entry, evaluatorVersionDigest));
  return {
    ok: true,
    kind: 'peers-touch-comparative-calibration-result',
    schemaVersion: 1,
    fixtureCount: results.length,
    results,
  };
}
