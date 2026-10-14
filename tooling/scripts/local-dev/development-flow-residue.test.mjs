import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  HISTORICAL_EXCLUSIONS,
  inspectDevelopmentFlowResidue,
  RETIRED_PATHS,
} from './development-flow-residue.mjs';

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'pt-flow-residue-'));
  mkdirSync(
    path.join(
      root,
      'docs/architecture/example/execution-plans/retired',
    ),
    { recursive: true },
  );
  writeFileSync(
    path.join(
      root,
      'docs/architecture/example/execution-plans/retired/plan.md',
    ),
    'historical: tooling/scripts/plan/plan-mount.mjs\n',
  );
  return {
    root,
    close() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test('historical exclusions are explicit and do not hide active references', () => {
  const scope = fixture();
  try {
    mkdirSync(path.join(scope.root, 'tooling/scripts'), { recursive: true });
    writeFileSync(
      path.join(scope.root, 'tooling/scripts/consumer.mjs'),
      "import './plan/plan-mount.mjs';\n",
    );
    const report = inspectDevelopmentFlowResidue({
      repoRoot: scope.root,
    });
    assert.equal(report.status, 'BLOCKED');
    assert.deepEqual(
      report.findings.map((finding) => finding.path),
      ['tooling/scripts/consumer.mjs'],
    );
    assert.ok(HISTORICAL_EXCLUSIONS.includes('docs/**/execution-plans/**'));
  } finally {
    scope.close();
  }
});

test('a retired implementation path is always a blocking finding', () => {
  const scope = fixture();
  try {
    const retired = RETIRED_PATHS[0];
    const target = path.join(scope.root, retired);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, 'retired\n');
    const report = inspectDevelopmentFlowResidue({
      repoRoot: scope.root,
    });
    assert.equal(report.status, 'BLOCKED');
    assert.ok(
      report.findings.some(
        (finding) =>
          finding.code === 'RETIRED_PATH_PRESENT' &&
          finding.path === retired,
      ),
    );
  } finally {
    scope.close();
  }
});
