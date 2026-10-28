import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CONTROL_PLANE_SOURCE_FILES,
  controlPlaneVersionDigest,
} from './source-version.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

test('control-plane version digest changes with any owned source file', (t) => {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'experience-source-version-'),
  );
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  for (const relativePath of CONTROL_PLANE_SOURCE_FILES) {
    fs.copyFileSync(
      path.join(SCRIPT_DIR, relativePath),
      path.join(temporaryRoot, relativePath),
    );
  }
  const before = controlPlaneVersionDigest(temporaryRoot);
  fs.appendFileSync(
    path.join(temporaryRoot, 'evaluator.mjs'),
    '\n// source identity probe\n',
  );
  const after = controlPlaneVersionDigest(temporaryRoot);

  assert.match(before, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(after, before);
});

test('comparative control-plane sources are version-bound', (t) => {
  const comparativeSources = [
    'comparative-calibration.mjs',
    'comparative-evaluator.mjs',
    'comparative-review.mjs',
    'comparative-schema.mjs',
  ];
  comparativeSources.forEach((source) =>
    assert.ok(CONTROL_PLANE_SOURCE_FILES.includes(source), source));

  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'experience-comparative-version-'),
  );
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  for (const relativePath of CONTROL_PLANE_SOURCE_FILES) {
    fs.copyFileSync(
      path.join(SCRIPT_DIR, relativePath),
      path.join(temporaryRoot, relativePath),
    );
  }
  const baseline = controlPlaneVersionDigest(temporaryRoot);
  for (const relativePath of comparativeSources) {
    const sourcePath = path.join(temporaryRoot, relativePath);
    const original = fs.readFileSync(sourcePath);
    fs.appendFileSync(sourcePath, '\n// comparative source probe\n');
    assert.notEqual(
      controlPlaneVersionDigest(temporaryRoot),
      baseline,
      relativePath,
    );
    fs.writeFileSync(sourcePath, original);
  }
});
