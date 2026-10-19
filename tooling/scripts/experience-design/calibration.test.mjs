import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runCalibration } from './calibration.mjs';
import { ExperienceDesignError } from './canonical.mjs';
import {
  loadGrammar,
  loadRuleCatalog,
  loadTrustedIssuers,
} from './schema.mjs';

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

function copyFixtures(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'experience-calibration-'),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(FIXTURES_ROOT, root, { recursive: true });
  return root;
}

function calibrate(fixturesRoot) {
  return runCalibration({
    fixturesRoot,
    ruleCatalog,
    grammar,
    trustedIssuers: loadTrustedIssuers(
      path.join(fixturesRoot, 'trusted-issuers.json'),
    ),
    repoRoot: REPO_ROOT,
  });
}

test('calibration covers every rule with exact signed fixtures', () => {
  const result = calibrate(FIXTURES_ROOT);

  assert.equal(result.ok, true);
  assert.equal(result.ruleCount, ruleCatalog.rules.size);
  assert.equal(result.fixtureCount, 13);
});

test('negative coverage must actually trigger its declared rule', (t) => {
  const root = copyFixtures(t);
  const manifestPath = path.join(root, 'calibration-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const semanticCoverage = manifest.coverage.find(
    (item) => item.ruleId === 'ED-SEM-001',
  );
  semanticCoverage.negative = ['negative/path-budget.json'];
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  assert.throws(() => calibrate(root), (error) => {
    assert.ok(error instanceof ExperienceDesignError);
    assert.equal(error.code, 'CALIBRATION_INCOMPLETE');
    assert.match(error.message, /does not trigger/);
    return true;
  });
});

test('calibration discovery never reads holdout fixtures', (t) => {
  const root = copyFixtures(t);
  fs.mkdirSync(path.join(root, 'holdout'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'holdout', 'not-content-addressed.json'),
    '{ invalid holdout json',
  );

  assert.equal(calibrate(root).ok, true);
});
