import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  mountPlan,
  sealPlanCompletion,
  updateExecutionRun,
} from './plan-mount.mjs';
import {
  PlanCompletionError,
  publishPlanCompletion,
  readPlanCompletion,
} from './plan-completion.mjs';
import { loadPlanPackage } from './plan-package.mjs';
import { createPlanRepository } from './plan-test-fixture.mjs';
import { runPlanctl } from './planctl.mjs';

test('source status is independent of machine-local PlanMount state', async (t) => {
  const fixture = createPlanRepository(t);
  const status = await runPlanctl([
    'source-status',
    '--plan',
    fixture.plan,
    '--repo-root',
    fixture.repoRoot,
    '--home',
    fixture.home,
  ]);

  assert.equal(status.status, 'unverified');
  assert.equal(status.workspaceId, null);
  assert.equal(status.currentTaskId, null);
  assert.deepEqual(status.taskStatuses, {
    'FIXTURE-TASK': 'unverified',
  });
  const mounted = await mountPlan({
    home: fixture.home,
    repoRoot: fixture.repoRoot,
    plan: fixture.plan,
    projectId: 'peers-touch',
    owner: 'test-owner',
  });
  assert.throws(
    () => publishPlanCompletion(mounted),
    (error) =>
      error instanceof PlanCompletionError &&
      error.code === 'PLAN_COMPLETION_INCOMPLETE',
  );
});

test('completed run publishes an immutable repository completion contract', async (t) => {
  const fixture = createPlanRepository(t);
  const options = {
    home: fixture.home,
    repoRoot: fixture.repoRoot,
    plan: fixture.plan,
    projectId: 'peers-touch',
    owner: 'test-owner',
    now: new Date('2026-10-05T00:00:00.000Z'),
  };
  await mountPlan(options);
  await updateExecutionRun(options, (run) => {
    run.taskStates['FIXTURE-TASK'] = { state: 'done', blocker: null };
    run.state = 'completed';
    run.currentTaskId = null;
    return run;
  });
  const sealed = await sealPlanCompletion(options);
  const planPackage = await loadPlanPackage(
    `${fixture.repoRoot}/${fixture.plan}`,
    { repoRoot: fixture.repoRoot },
  );

  assert.deepEqual(
    readPlanCompletion(planPackage),
    sealed.completion,
  );
  assert.equal(sealed.completion.taskStates['FIXTURE-TASK'], 'done');
  assert.equal(
    (await runPlanctl([
      'source-status',
      '--plan',
      fixture.plan,
      '--repo-root',
      fixture.repoRoot,
      '--home',
      fixture.home,
    ])).status,
    'completed',
  );

  const tampered = JSON.parse(fs.readFileSync(sealed.file, 'utf8'));
  tampered.planId = 'OTHER';
  fs.writeFileSync(sealed.file, `${JSON.stringify(tampered)}\n`);
  assert.throws(
    () => readPlanCompletion(planPackage),
    (error) =>
      error instanceof PlanCompletionError &&
      error.code === 'PLAN_COMPLETION_STALE',
  );
});
