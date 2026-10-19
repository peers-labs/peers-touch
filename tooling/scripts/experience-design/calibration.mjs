import fs from 'node:fs';
import path from 'node:path';

import {
  ExperienceDesignError,
  canonicalDigest,
  fail,
  isPlainObject,
} from './canonical.mjs';
import {
  assertExpectedCalibration,
  evaluateExperienceCase,
} from './evaluator.mjs';
import { loadExperienceCase } from './schema.mjs';
import { controlPlaneVersionDigest } from './source-version.mjs';

const CLASSES = ['positive', 'negative', 'boundary'];

function readJson(sourcePath, context) {
  try {
    return JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  } catch (error) {
    fail('CALIBRATION_INCOMPLETE', `${context} is unreadable JSON`, {
      path: sourcePath,
      reason: error.message,
    });
  }
}

function assertClosed(value, required, optional, context) {
  if (!isPlainObject(value)) {
    fail('CALIBRATION_INCOMPLETE', `${context} must be an object`);
  }
  const allowed = new Set([...required, ...optional]);
  const missing = required.filter((key) => !Object.hasOwn(value, key));
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (missing.length > 0 || unknown.length > 0) {
    fail(
      'CALIBRATION_INCOMPLETE',
      `${context} has unknown or missing fields`,
      { missing, unknown },
    );
  }
}

function assertString(value, context) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
  ) {
    fail('CALIBRATION_INCOMPLETE', `${context} must be a valid string`);
  }
}

function normalizeFixturePath(value, context) {
  assertString(value, context);
  const normalized = path.posix.normalize(value);
  if (
    value !== normalized
    || path.isAbsolute(value)
    || value.startsWith('../')
    || value.includes('\\')
    || value.startsWith('holdout/')
  ) {
    fail(
      'CALIBRATION_INCOMPLETE',
      `${context} must be a normalized non-holdout fixture path`,
    );
  }
  return value;
}

function listDiscovered(fixturesRoot) {
  return CLASSES.flatMap((classification) => {
    const directory = path.join(fixturesRoot, classification);
    try {
      return fs
        .readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => `${classification}/${entry.name}`);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }).sort();
}

function validateManifest(manifest, ruleCatalog) {
  assertClosed(
    manifest,
    ['kind', 'schemaVersion', 'cases', 'coverage'],
    [],
    'calibrationManifest',
  );
  if (
    manifest.kind !== 'peers-touch-experience-calibration-manifest'
    || manifest.schemaVersion !== 1
  ) {
    fail('CALIBRATION_INCOMPLETE', 'calibration manifest identity is unsupported');
  }
  if (!Array.isArray(manifest.cases) || manifest.cases.length === 0) {
    fail('CALIBRATION_INCOMPLETE', 'calibrationManifest.cases must be non-empty');
  }
  const casePaths = new Set();
  manifest.cases.forEach((fixtureCase, index) => {
    const context = `calibrationManifest.cases[${index}]`;
    assertClosed(
      fixtureCase,
      ['path', 'class', 'mode'],
      ['expectedErrorCode'],
      context,
    );
    normalizeFixturePath(fixtureCase.path, `${context}.path`);
    if (casePaths.has(fixtureCase.path)) {
      fail('CALIBRATION_INCOMPLETE', 'calibration case path is duplicated', {
        path: fixtureCase.path,
      });
    }
    casePaths.add(fixtureCase.path);
    if (!CLASSES.includes(fixtureCase.class)) {
      fail('CALIBRATION_INCOMPLETE', `${context}.class is unsupported`);
    }
    if (!fixtureCase.path.startsWith(`${fixtureCase.class}/`)) {
      fail(
        'CALIBRATION_INCOMPLETE',
        `${context}.path must live under its calibration class`,
      );
    }
    if (!['evaluation', 'validation-error'].includes(fixtureCase.mode)) {
      fail('CALIBRATION_INCOMPLETE', `${context}.mode is unsupported`);
    }
    if (fixtureCase.mode === 'validation-error') {
      assertString(
        fixtureCase.expectedErrorCode,
        `${context}.expectedErrorCode`,
      );
    } else if (fixtureCase.expectedErrorCode !== undefined) {
      fail(
        'CALIBRATION_INCOMPLETE',
        `${context}.expectedErrorCode is only legal for validation-error`,
      );
    }
  });
  if (!Array.isArray(manifest.coverage)) {
    fail('CALIBRATION_INCOMPLETE', 'calibrationManifest.coverage must be an array');
  }
  const coverageIds = new Set();
  manifest.coverage.forEach((coverage, index) => {
    const context = `calibrationManifest.coverage[${index}]`;
    assertClosed(
      coverage,
      ['ruleId', 'positive', 'negative', 'boundary'],
      [],
      context,
    );
    assertString(coverage.ruleId, `${context}.ruleId`);
    if (!ruleCatalog.rules.has(coverage.ruleId) || coverageIds.has(coverage.ruleId)) {
      fail(
        'CALIBRATION_INCOMPLETE',
        `${context}.ruleId is unknown or duplicated`,
      );
    }
    coverageIds.add(coverage.ruleId);
    for (const classification of CLASSES) {
      const paths = coverage[classification];
      if (!Array.isArray(paths) || paths.length === 0) {
        fail(
          'CALIBRATION_INCOMPLETE',
          `${context}.${classification} must be non-empty`,
        );
      }
      const unique = new Set();
      paths.forEach((fixturePath, fixtureIndex) => {
        normalizeFixturePath(
          fixturePath,
          `${context}.${classification}[${fixtureIndex}]`,
        );
        if (!casePaths.has(fixturePath)) {
          fail(
            'CALIBRATION_INCOMPLETE',
            `${context}.${classification} references an unknown fixture`,
            { fixturePath },
          );
        }
        if (unique.has(fixturePath)) {
          fail(
            'CALIBRATION_INCOMPLETE',
            `${context}.${classification} contains a duplicate`,
            { fixturePath },
          );
        }
        unique.add(fixturePath);
      });
    }
  });
  const catalogIds = [...ruleCatalog.rules.keys()];
  if (
    coverageIds.size !== catalogIds.length
    || catalogIds.some((ruleId) => !coverageIds.has(ruleId))
  ) {
    fail(
      'CALIBRATION_INCOMPLETE',
      'calibration coverage must include every catalog rule',
      {
        expected: catalogIds.sort(),
        actual: [...coverageIds].sort(),
      },
    );
  }
  return casePaths;
}

export function runCalibration({
  fixturesRoot,
  ruleCatalog,
  grammar,
  repoRoot,
}) {
  const manifestPath = path.join(fixturesRoot, 'calibration-manifest.json');
  const manifest = readJson(manifestPath, 'calibration manifest');
  const manifestPaths = validateManifest(manifest, ruleCatalog);
  const discovered = listDiscovered(fixturesRoot);
  if (
    discovered.length !== manifestPaths.size
    || discovered.some((fixturePath) => !manifestPaths.has(fixturePath))
  ) {
    fail(
      'CALIBRATION_INCOMPLETE',
      'calibration manifest and discovered non-holdout fixtures differ',
      {
        manifest: [...manifestPaths].sort(),
        discovered,
      },
    );
  }

  const results = [];
  const resultsByPath = new Map();
  const evaluatorVersionDigest = controlPlaneVersionDigest();
  for (const fixtureCase of manifest.cases) {
    const sourcePath = path.join(fixturesRoot, fixtureCase.path);
    if (fixtureCase.mode === 'validation-error') {
      let observedError = null;
      try {
        loadExperienceCase(sourcePath, {
          ruleCatalog,
          grammar,
        });
      } catch (error) {
        if (error instanceof ExperienceDesignError) observedError = error;
        else throw error;
      }
      if (observedError?.code !== fixtureCase.expectedErrorCode) {
        fail(
          'CALIBRATION_INCOMPLETE',
          'validation-error fixture did not emit the exact expected code',
          {
            path: fixtureCase.path,
            expected: fixtureCase.expectedErrorCode,
            actual: observedError?.code ?? null,
          },
        );
      }
      const fixtureResult = {
        path: fixtureCase.path,
        class: fixtureCase.class,
        mode: fixtureCase.mode,
        errorCode: observedError.code,
        ruleIds: ruleCatalog.rules.has(observedError.code)
          ? [observedError.code]
          : [],
      };
      results.push(fixtureResult);
      resultsByPath.set(fixtureCase.path, fixtureResult);
      continue;
    }
    const loaded = loadExperienceCase(sourcePath, {
      ruleCatalog,
      grammar,
    });
    if (loaded.case.calibration !== fixtureCase.class) {
      fail(
        'CALIBRATION_INCOMPLETE',
        'fixture calibration class differs from its manifest',
        {
          path: fixtureCase.path,
          expected: fixtureCase.class,
          actual: loaded.case.calibration,
        },
      );
    }
    const result = evaluateExperienceCase(loaded, {
      ruleCatalog,
      grammar,
      evaluatorVersionDigest,
      repoRoot,
    });
    assertExpectedCalibration(result, loaded.case.expected);
    const fixtureResult = {
      path: fixtureCase.path,
      class: fixtureCase.class,
      mode: fixtureCase.mode,
      disposition: result.disposition,
      resultDigest: canonicalDigest(result),
      ruleIds: [...new Set(result.findings.map((finding) => finding.ruleId))]
        .sort(),
    };
    results.push(fixtureResult);
    resultsByPath.set(fixtureCase.path, fixtureResult);
  }
  for (const coverage of manifest.coverage) {
    for (const fixturePath of coverage.positive) {
      if (resultsByPath.get(fixturePath).ruleIds.includes(coverage.ruleId)) {
        fail(
          'CALIBRATION_INCOMPLETE',
          'positive fixture unexpectedly triggers its covered rule',
          { ruleId: coverage.ruleId, fixturePath },
        );
      }
    }
    for (const fixturePath of coverage.negative) {
      if (!resultsByPath.get(fixturePath).ruleIds.includes(coverage.ruleId)) {
        fail(
          'CALIBRATION_INCOMPLETE',
          'negative fixture does not trigger its covered rule',
          { ruleId: coverage.ruleId, fixturePath },
        );
      }
    }
  }
  return {
    ok: true,
    kind: 'peers-touch-experience-calibration-result',
    schemaVersion: 1,
    fixtureCount: results.length,
    ruleCount: ruleCatalog.rules.size,
    results,
  };
}
