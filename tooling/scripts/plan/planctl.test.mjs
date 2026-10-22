import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { createPlanRepository } from './plan-test-fixture.mjs';
import { PlanPackageError } from './plan-package.mjs';
import { runPlanctl } from './planctl.mjs';

function scope(t) {
  const fixture = createPlanRepository(t);
  return {
    repoRoot: fixture.repoRoot,
    home: fixture.home,
    plan: fixture.plan,
  };
}

test('FLOW-A02 validates an explicit Plan Version without creating machine state', async (t) => {
  const options = scope(t);
  const result = await runPlanctl([
    'validate',
    '--repo-root',
    options.repoRoot,
    '--plan',
    options.plan,
  ]);
  assert.equal(result.ok, true);
  assert.ok(result.taskCount > 0);
  assert.equal(
    fs.existsSync(path.join(options.home, '.peers-touch', 'dev')),
    false,
  );
});

test('FLOW-A02 inspects an explicit Plan Version without PlanMount or Session', async (t) => {
  const options = scope(t);
  const result = await runPlanctl([
    'inspect',
    '--repo-root',
    options.repoRoot,
    '--plan',
    options.plan,
  ]);
  assert.equal(result.ok, true);
  assert.ok(result.tasks.length > 0);
  assert.equal(Object.hasOwn(result, 'mountId'), false);
  assert.equal(Object.hasOwn(result, 'runId'), false);
});

test('existing bounded legacy Current Snapshot remains readable', async (t) => {
  const options = scope(t);
  const taskPath = path.join(
    path.dirname(path.join(options.repoRoot, options.plan)),
    'tasks',
    'FIXTURE-TASK.md',
  );
  const source = fs.readFileSync(taskPath, 'utf8');
  const snapshot = '## Current Snapshot\n\n- Legacy fixture progress.\n';
  fs.writeFileSync(taskPath, `${source}${snapshot}`);

  const result = await runPlanctl([
    'validate',
    '--repo-root',
    options.repoRoot,
    '--plan',
    options.plan,
  ]);
  assert.equal(result.ok, true);

  fs.writeFileSync(taskPath, `${source}${snapshot}\n${snapshot}`);
  await assert.rejects(
    () =>
      runPlanctl([
        'validate',
        '--repo-root',
        options.repoRoot,
        '--plan',
        options.plan,
      ]),
    (error) => {
      assert.ok(error instanceof PlanPackageError);
      assert.equal(error.code, 'PLAN_SNAPSHOT_INVALID');
      assert.equal(error.details.count, 2);
      return true;
    },
  );
});

test('FLOW-A07 selects one explicit Plan task without workspace occupancy', async (t) => {
  const options = scope(t);
  const inspected = await runPlanctl([
    'inspect',
    '--repo-root',
    options.repoRoot,
    '--plan',
    options.plan,
  ]);
  const selected = inspected.tasks[0];
  const result = await runPlanctl([
    'task',
    '--repo-root',
    options.repoRoot,
    '--plan',
    options.plan,
    '--task',
    selected.id,
  ]);
  assert.equal(result.task.id, selected.id);
  assert.equal(result.planVersionDigest, inspected.planVersionDigest);
});

test('Plan contract binds planned human outcomes but not execution results', async (t) => {
  const options = scope(t);
  const before = await runPlanctl([
    'inspect',
    '--repo-root',
    options.repoRoot,
    '--plan',
    options.plan,
  ]);
  const outcomePath = path.join(
    path.dirname(path.join(options.repoRoot, options.plan)),
    'outcome-comparison.md',
  );
  const source = fs.readFileSync(outcomePath, 'utf8');
  fs.writeFileSync(
    outcomePath,
    source.replace(
      'The fixture has not executed.',
      'The fixture remains unexecuted.',
    ),
  );

  const after = await runPlanctl([
    'inspect',
    '--repo-root',
    options.repoRoot,
    '--plan',
    options.plan,
  ]);

  assert.equal(after.planVersionDigest, before.planVersionDigest);
  assert.equal(
    after.outcomeComparison.resultStatuses.every(
      (item) => item.status === 'UNPROVEN',
    ),
    true,
  );
});

test('Plan contract rejects planned outcome drift', async (t) => {
  const options = scope(t);
  const outcomePath = path.join(
    path.dirname(path.join(options.repoRoot, options.plan)),
    'outcome-comparison.md',
  );
  const source = fs.readFileSync(outcomePath, 'utf8');
  fs.writeFileSync(
    outcomePath,
    source.replace('fixture target.', 'changed fixture target.'),
  );

  await assert.rejects(
    () =>
      runPlanctl([
        'validate',
        '--repo-root',
        options.repoRoot,
        '--plan',
        options.plan,
      ]),
    (error) => {
      assert.ok(error instanceof PlanPackageError);
      assert.equal(error.code, 'PLAN_OUTCOME_STALE');
      return true;
    },
  );
});

test('existing Plan remains readable without outcome comparison', async (t) => {
  const options = scope(t);
  const planPath = path.join(options.repoRoot, options.plan);
  const source = fs.readFileSync(planPath, 'utf8');
  const pattern = /(## Plan Version\s+```json\s+)(\{[\s\S]*?\})(\s+```)/;
  const match = pattern.exec(source);
  assert.ok(match);
  const manifest = JSON.parse(match[2]);
  delete manifest.schemaVersion;
  delete manifest.outcomeComparison;
  fs.writeFileSync(
    planPath,
    source.replace(
      pattern,
      `$1${JSON.stringify(manifest, null, 2)}$3`,
    ),
  );
  fs.rmSync(
    path.join(path.dirname(planPath), 'outcome-comparison.md'),
  );

  const result = await runPlanctl([
    'validate',
    '--repo-root',
    options.repoRoot,
    '--plan',
    options.plan,
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.outcomeComparison, null);
});

test('Plan Versions reject synthetic schema version fields', async (t) => {
  const options = scope(t);
  const planPath = path.join(options.repoRoot, options.plan);
  const source = fs.readFileSync(planPath, 'utf8');
  const pattern = /(## Plan Version\s+```json\s+)(\{[\s\S]*?\})(\s+```)/;
  const match = pattern.exec(source);
  assert.ok(match);

  for (const schemaVersion of [1, 2, 8]) {
    const manifest = JSON.parse(match[2]);
    manifest.schemaVersion = schemaVersion;
    fs.writeFileSync(
      planPath,
      source.replace(
        pattern,
        `$1${JSON.stringify(manifest, null, 2)}$3`,
      ),
    );

    await assert.rejects(
      () =>
        runPlanctl([
          'validate',
          '--repo-root',
          options.repoRoot,
          '--plan',
          options.plan,
        ]),
      (error) => {
        assert.ok(error instanceof PlanPackageError);
        assert.equal(error.code, 'PLAN_SCHEMA_INVALID');
        return true;
      },
    );
  }
});

test('retired execution commands fail closed', async (t) => {
  const options = scope(t);
  await assert.rejects(
    () =>
      runPlanctl([
        'status',
        '--repo-root',
        options.repoRoot,
        '--plan',
        options.plan,
      ]),
    (error) => {
      assert.ok(error instanceof PlanPackageError);
      assert.equal(error.code, 'PLAN_CLI_USAGE');
      assert.deepEqual(error.details.commands, ['validate', 'inspect', 'task']);
      return true;
    },
  );
});
