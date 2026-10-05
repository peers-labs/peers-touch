import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  PlanMountError,
  mountPlanVersion,
  releasePlanMount,
  resolvePlanExecution,
  updateExecutionRun,
} from './plan-mount.mjs';
import { createPlanRepository } from './plan-test-fixture.mjs';

function scope(t) {
  const fixture = createPlanRepository(t);
  return {
    repoRoot: fixture.repoRoot,
    home: fixture.home,
    plan: fixture.plan,
    otherPlan: fixture.otherPlan,
    projectId: 'peers-touch',
    owner: 'test-owner',
    now: new Date('2026-10-04T00:00:00.000Z'),
  };
}

test('mount publishes one immutable snapshot and mutable Execution Run', async (t) => {
  const options = scope(t);
  const mounted = await mountPlanVersion(options);
  const resolved = await resolvePlanExecution(options);

  assert.equal(mounted.created, true);
  assert.equal(resolved.mount.mountId, mounted.mount.mountId);
  assert.equal(resolved.snapshot.recordDigest, mounted.snapshot.recordDigest);
  assert.equal(resolved.run.state, 'prepared');
  assert.equal(resolved.run.revision, 1);
  assert.equal(
    resolved.snapshot.executionBinding.workspaceId,
    resolved.workspace.workspaceId,
  );
  assert.equal(
    Object.hasOwn(resolved.planPackage.plan, 'binding'),
    false,
  );
});

test('same Plan Version mount is idempotent and a second Plan conflicts', async (t) => {
  const options = scope(t);
  const first = await mountPlanVersion(options);
  const second = await mountPlanVersion(options);

  assert.equal(second.created, false);
  assert.equal(second.mount.mountId, first.mount.mountId);
  await assert.rejects(
    mountPlanVersion({ ...options, plan: options.otherPlan }),
    (error) =>
      error instanceof PlanMountError
      && error.code === 'PLAN_MOUNT_CONFLICT',
  );
});

test('Execution Run updates are revisioned without changing the snapshot', async (t) => {
  const options = scope(t);
  const mounted = await mountPlanVersion(options);
  const taskId = mounted.snapshot.plan.tasks[0].id;
  const updated = await updateExecutionRun(options, (run) => {
    run.state = 'active';
    run.currentTaskId = taskId;
    run.taskStates[taskId] = {
      state: 'in_progress',
      blocker: null,
    };
    return run;
  });

  assert.equal(updated.run.revision, 2);
  assert.equal(updated.run.currentTaskId, taskId);
  assert.equal(
    updated.snapshot.recordDigest,
    mounted.snapshot.recordDigest,
  );
});

test('unfinished mount requires explicit owner unmount authorization', async (t) => {
  const options = scope(t);
  await mountPlanVersion(options);

  await assert.rejects(
    releasePlanMount({
      ...options,
      reason: 'owner-unmount',
    }),
    (error) =>
      error instanceof PlanMountError
      && error.code === 'PLAN_MOUNT_RELEASE_DENIED',
  );
  const released = await releasePlanMount({
    ...options,
    reason: 'owner-unmount',
    allowUnfinished: true,
  });
  assert.equal(released.mount.state, 'released');
  await assert.rejects(
    resolvePlanExecution(options),
    (error) =>
      error instanceof PlanMountError
      && error.code === 'PLAN_MOUNT_REQUIRED',
  );
});

test('tampered immutable snapshot fails closed', async (t) => {
  const options = scope(t);
  const mounted = await mountPlanVersion(options);
  const snapshot = JSON.parse(
    fs.readFileSync(mounted.paths.snapshot, 'utf8'),
  );
  snapshot.planId = 'tampered';
  fs.writeFileSync(
    mounted.paths.snapshot,
    `${JSON.stringify(snapshot)}\n`,
  );

  await assert.rejects(
    resolvePlanExecution(options),
    (error) =>
      error instanceof PlanMountError
      && error.code === 'EXECUTION_PLAN_SNAPSHOT_INVALID',
  );
});
