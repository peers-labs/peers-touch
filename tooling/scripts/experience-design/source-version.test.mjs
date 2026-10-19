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
