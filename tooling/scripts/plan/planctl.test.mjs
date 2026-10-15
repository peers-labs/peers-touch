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
