import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  PlanMountError,
  amendMountedPlan,
  cancelExecutionRun,
  mountPlan,
  releasePlanMount,
  resolvePlanExecution,
  updateExecutionRun,
} from './plan-mount.mjs';
import {
  appendPlanAmendment,
  findStructuredBlocks,
  loadPlanPackage,
} from './plan-package.mjs';
import { createPlanRepository } from './plan-test-fixture.mjs';
import { approveNorthStar } from './planctl.mjs';
import {
  createDevelopmentCloseReceipt,
  writeDevelopmentCloseReceipt,
} from '../local-dev/development-close-store.mjs';
import { workspaceIdForRoot } from '../lib/machine-dev-paths.mjs';

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

function updateStructuredBlock(filePath, label, update) {
  const text = fs.readFileSync(filePath, 'utf8');
  const block = findStructuredBlocks(text, label)[0];
  const value = JSON.parse(block.text);
  update(value);
  fs.writeFileSync(
    filePath,
    `${text.slice(0, block.contentStart)}${JSON.stringify(value)}\n${text.slice(block.contentEnd)}`,
  );
}

function updatePlan(options, update) {
  updateStructuredBlock(
    path.join(options.repoRoot, options.plan),
    'Plan',
    update,
  );
}

function primaryTaskPath(options) {
  return path.join(
    options.repoRoot,
    'plans',
    'primary',
    'tasks',
    'FIXTURE-TASK.md',
  );
}

function updateTaskCommand(options, command) {
  const taskPath = primaryTaskPath(options);
  const text = fs.readFileSync(taskPath, 'utf8');
  fs.writeFileSync(taskPath, text.replace('"command": "true"', `"command": "${command}"`));
}

test('mount publishes the initial immutable snapshot and mutable Execution Run', async (t) => {
  const options = scope(t);
  const mounted = await mountPlan(options);
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

test('candidate Plan cannot mount until its North Star is explicitly approved', async (t) => {
  const options = scope(t);
  updatePlan(options, (plan) => {
    plan.northStarApproval = null;
  });
  const candidate = await loadPlanPackage(
    path.join(options.repoRoot, options.plan),
    { repoRoot: options.repoRoot },
  );

  assert.equal(candidate.northStarApproval.status, 'candidate');
  await assert.rejects(
    mountPlan(options),
    (error) =>
      error instanceof PlanMountError &&
      error.code === 'NORTH_STAR_APPROVAL_REQUIRED',
  );

  const approved = await approveNorthStar(options.plan, {
    plan: options.plan,
    'repo-root': options.repoRoot,
    actor: options.owner,
    'decision-ref': 'USER-DECISION-CANDIDATE',
    now: options.now,
  });
  assert.equal(approved.northStarApprovalStatus, 'approved');
  const mounted = await mountPlan(options);
  assert.equal(
    mounted.snapshot.plan.northStarApproval.decisionRef,
    'USER-DECISION-CANDIDATE',
  );
});

test('same Plan mount is idempotent and a second Plan conflicts', async (t) => {
  const options = scope(t);
  const first = await mountPlan(options);
  const second = await mountPlan(options);

  assert.equal(second.created, false);
  assert.equal(second.mount.mountId, first.mount.mountId);
  await assert.rejects(
    mountPlan({ ...options, plan: options.otherPlan }),
    (error) =>
      error instanceof PlanMountError
      && error.code === 'PLAN_MOUNT_CONFLICT',
  );
});

test('unfinished Development close blocks new Plan mount admission', async (t) => {
  const options = scope(t);
  const workspaceId = workspaceIdForRoot(options.repoRoot);
  const receipt = createDevelopmentCloseReceipt(
    {
      workspaceId,
      workItemId: 'DWF-CLOSE-BLOCKER',
      mode: 'standalone',
      closeReason: 'completed',
      environmentPolicy: 'retain',
      owner: options.owner,
      mountId: null,
      runId: null,
    },
    options,
  );
  writeDevelopmentCloseReceipt(receipt, { home: options.home });

  await assert.rejects(
    mountPlan(options),
    (error) => error?.code === 'DEVELOPMENT_CLOSE_IN_PROGRESS',
  );
});

test('terminal live mount requires coordinated close before reuse', async (t) => {
  const options = scope(t);
  await mountPlan(options);
  await updateExecutionRun(options, (run) => {
    for (const taskId of Object.keys(run.taskStates)) {
      run.taskStates[taskId] = { state: 'done', blocker: null };
    }
    run.state = 'completed';
    run.currentTaskId = null;
    run.exhaustion = null;
    return run;
  });

  await assert.rejects(
    mountPlan(options),
    (error) => error?.code === 'DEVELOPMENT_CLOSE_REQUIRED',
  );
});

test('Execution Run updates are revisioned without changing the snapshot', async (t) => {
  const options = scope(t);
  const mounted = await mountPlan(options);
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

test('Execution Run update rejects out-of-band changes after its read', async (t) => {
  const options = scope(t);
  const mounted = await mountPlan(options);

  await assert.rejects(
    updateExecutionRun(options, (run) => {
      fs.appendFileSync(mounted.paths.run, '\n');
      return run;
    }),
    (error) => error?.code === 'PLAN_CONCURRENT_MODIFICATION',
  );
});

test('agent amendment keeps the mount and advances the immutable snapshot', async (t) => {
  const options = scope(t);
  const mounted = await mountPlan(options);
  updateTaskCommand(options, 'node --version');

  await assert.rejects(
    resolvePlanExecution(options),
    (error) =>
      error instanceof PlanMountError &&
      error.code === 'PLAN_AMENDMENT_REQUIRED',
  );
  const amended = await amendMountedPlan({
    ...options,
    actor: 'agent:test',
    reason: 'The focused check must execute the actual runtime.',
    changes: ['Replace the placeholder focused check.'],
  });

  assert.equal(amended.mount.mountId, mounted.mount.mountId);
  assert.notEqual(amended.snapshot.snapshotId, mounted.snapshot.snapshotId);
  assert.equal(amended.snapshot.amendmentCount, 1);
  assert.equal(amended.amendment.approval.kind, 'agent');
  assert.deepEqual(
    amended.snapshot.plan.northStarApproval,
    mounted.snapshot.plan.northStarApproval,
  );
  assert.equal(
    amended.amendment.fromContentDigest,
    mounted.snapshot.planContentDigest,
  );
  assert.equal(
    amended.amendment.toContentDigest,
    amended.snapshot.planContentDigest,
  );
  const resolved = await resolvePlanExecution(options);
  assert.equal(resolved.snapshot.snapshotId, amended.snapshot.snapshotId);
  assert.equal(
    fs.readdirSync(amended.paths.snapshots).filter((name) => name.endsWith('.json')).length,
    2,
  );
  const repeated = await amendMountedPlan({
    ...options,
    actor: 'agent:test',
    reason: 'The focused check must execute the actual runtime.',
    changes: ['Replace the placeholder focused check.'],
  });
  assert.equal(repeated.amended, false);
  assert.equal(repeated.snapshot.snapshotId, amended.snapshot.snapshotId);
});

test('amendment retries recover after the Plan log is committed first', async (t) => {
  const options = scope(t);
  const mounted = await mountPlan(options);
  updateTaskCommand(options, 'node --version');
  const candidate = await loadPlanPackage(
    path.join(options.repoRoot, options.plan),
    {
      repoRoot: options.repoRoot,
      allowUnrecordedAmendment: true,
    },
  );
  const amendment = {
    id: 'amendment-recovery',
    createdAt: '2026-10-06T01:00:00.000Z',
    actor: 'agent:test',
    reason: 'Recover an interrupted amendment.',
    changes: ['Replace the placeholder focused check.'],
    impact: {
      taskIds: ['FIXTURE-TASK'],
      gateIds: [],
    },
    approval: {
      kind: 'agent',
      decisionRef: null,
    },
    fromContentDigest: mounted.snapshot.planContentDigest,
    toContentDigest: candidate.planContentDigest,
  };
  await appendPlanAmendment(candidate, amendment);

  const recovered = await amendMountedPlan({
    ...options,
    actor: amendment.actor,
    reason: amendment.reason,
    changes: amendment.changes,
  });

  assert.equal(recovered.amended, true);
  assert.equal(recovered.amendment.id, amendment.id);
  assert.equal(recovered.run.runId, mounted.run.runId);
  assert.notEqual(recovered.snapshot.snapshotId, mounted.snapshot.snapshotId);
});

test('amendment retries reject rewritten audit history', async (t) => {
  const options = scope(t);
  await mountPlan(options);
  updateTaskCommand(options, 'node --version');
  await amendMountedPlan({
    ...options,
    actor: 'agent:test',
    reason: 'Record the original amendment.',
    changes: ['Replace the placeholder focused check.'],
  });
  updatePlan(options, (plan) => {
    plan.amendments[0].reason = 'Rewrite the audit history.';
  });

  await assert.rejects(
    amendMountedPlan({
      ...options,
      actor: 'agent:test',
      reason: 'Record the original amendment.',
      changes: ['Replace the placeholder focused check.'],
    }),
    (error) =>
      error instanceof PlanMountError &&
      error.code === 'PLAN_AMENDMENT_CONFLICT',
  );
});

test('amending the active Task revalidates it and continues the same run', async (t) => {
  const options = scope(t);
  const mounted = await mountPlan(options);
  const taskId = mounted.snapshot.plan.tasks[0].id;
  await updateExecutionRun(options, (run) => {
    run.state = 'active';
    run.currentTaskId = taskId;
    run.taskStates[taskId] = {
      state: 'in_progress',
      blocker: null,
    };
    return run;
  });
  updateTaskCommand(options, 'node --version');

  const amended = await amendMountedPlan({
    ...options,
    actor: 'agent:test',
    reason: 'Use a real check while work is in progress.',
    changes: ['Replace the current Task check.'],
  });

  assert.equal(amended.run.runId, mounted.run.runId);
  assert.equal(amended.run.state, 'active');
  assert.equal(amended.run.currentTaskId, taskId);
  assert.equal(amended.run.taskStates[taskId].state, 'in_progress');
});

test('North Star changes invalidate approval and require explicit reapproval', async (t) => {
  const options = scope(t);
  await mountPlan(options);
  updatePlan(options, (plan) => {
    plan.northStar.objective = 'Deliver a different product outcome.';
  });

  await assert.rejects(
    amendMountedPlan({
      ...options,
      actor: 'agent:test',
      reason: 'Change the product outcome.',
      changes: ['Replace the North Star objective.'],
    }),
    (error) =>
      error instanceof PlanMountError &&
      error.code === 'NORTH_STAR_APPROVAL_REQUIRED' &&
      error.details?.status === 'stale',
  );

  const approved = await approveNorthStar(options.plan, {
    plan: options.plan,
    'repo-root': options.repoRoot,
    actor: options.owner,
    'decision-ref': 'USER-DECISION-20261006',
    now: options.now,
  });
  assert.equal(approved.northStarApprovalStatus, 'approved');

  await assert.rejects(
    amendMountedPlan({
      ...options,
      actor: 'agent:test',
      reason: 'Change the product outcome.',
      changes: ['Replace the North Star objective.'],
    }),
    (error) =>
      error instanceof PlanMountError &&
      error.code === 'OWNER_DECISION_REQUIRED' &&
      Array.isArray(error.details?.options),
  );

  await assert.rejects(
    amendMountedPlan({
      ...options,
      actor: options.owner,
      reason: 'The owner accepted the new product outcome.',
      changes: ['Replace the North Star objective.'],
      approval: 'owner',
      decisionRef: 'A-DIFFERENT-DECISION',
    }),
    (error) =>
      error instanceof PlanMountError &&
      error.code === 'PLAN_AMENDMENT_APPROVAL_MISMATCH',
  );

  const amended = await amendMountedPlan({
    ...options,
    actor: options.owner,
    reason: 'The owner accepted the new product outcome.',
    changes: ['Replace the North Star objective.'],
    approval: 'owner',
    decisionRef: 'USER-DECISION-20261006',
  });
  assert.equal(amended.amendment.approval.kind, 'owner');
  assert.equal(
    amended.snapshot.plan.northStarApproval.northStarDigest,
    approved.northStarDigest,
  );
});

test('stale North Star approval wins over amendment drift during execution admission', async (t) => {
  const options = scope(t);
  await mountPlan(options);
  updateTaskCommand(options, 'node --version');
  await amendMountedPlan({
    ...options,
    actor: 'agent:test',
    reason: 'Create an existing amendment chain.',
    changes: ['Replace the placeholder focused check.'],
  });
  updatePlan(options, (plan) => {
    plan.northStar.successCriteria[0].statement =
      'The changed outcome requires a new explicit decision.';
  });
  const candidate = await loadPlanPackage(
    path.join(options.repoRoot, options.plan),
    { repoRoot: options.repoRoot },
  );
  assert.equal(candidate.northStarApproval.status, 'stale');

  await assert.rejects(
    resolvePlanExecution(options),
    (error) =>
      error instanceof PlanMountError &&
      error.code === 'NORTH_STAR_APPROVAL_REQUIRED' &&
      error.details?.status === 'stale',
  );
});

test('criterion coverage must resolve to exact Task closures and Gates', async (t) => {
  const options = scope(t);
  updatePlan(options, (plan) => {
    plan.criterionCoverage[0].closureIds = ['UNKNOWN-CLOSURE'];
  });

  await assert.rejects(
    loadPlanPackage(path.join(options.repoRoot, options.plan), {
      repoRoot: options.repoRoot,
    }),
    (error) =>
      error?.code === 'PLAN_CRITERION_COVERAGE_INVALID',
  );
});

test('ordinary amendments cannot rewrite the North Star approval record', async (t) => {
  const options = scope(t);
  await mountPlan(options);
  updatePlan(options, (plan) => {
    plan.northStarApproval.decisionRef = 'REWRITTEN-DECISION';
  });

  await assert.rejects(
    amendMountedPlan({
      ...options,
      actor: 'agent:test',
      reason: 'Rewrite approval metadata.',
      changes: ['Replace the approval decision reference.'],
    }),
    (error) =>
      error instanceof PlanMountError &&
      error.code === 'NORTH_STAR_APPROVAL_IMMUTABLE',
  );
});

test('criterion coverage amendments preserve North Star approval', async (t) => {
  const options = scope(t);
  const mounted = await mountPlan(options);
  const nextClosureId = 'primary-closure-v2';
  updateStructuredBlock(
    primaryTaskPath(options),
    'Task Slice',
    (task) => {
      task.closureId = nextClosureId;
    },
  );
  updateStructuredBlock(
    path.join(options.repoRoot, options.plan),
    'Acceptance Execution',
    (acceptance) => {
      acceptance.closures = { [nextClosureId]: [] };
    },
  );
  updatePlan(options, (plan) => {
    plan.criterionCoverage[0].closureIds = [nextClosureId];
  });

  const amended = await amendMountedPlan({
    ...options,
    actor: 'agent:test',
    reason: 'Rename the criterion closure mapping.',
    changes: ['Update the Task, closure, and criterion crosswalk.'],
  });

  assert.equal(amended.amendment.approval.kind, 'agent');
  assert.deepEqual(
    amended.snapshot.plan.northStarApproval,
    mounted.snapshot.plan.northStarApproval,
  );
  assert.deepEqual(
    amended.snapshot.plan.criterionCoverage[0].closureIds,
    [nextClosureId],
  );
});

test('authorization expansion requires owner approval', async (t) => {
  const options = scope(t);
  await mountPlan(options);
  updatePlan(options, (plan) => {
    plan.authorization.delivery.push = 'allowed';
  });

  await assert.rejects(
    amendMountedPlan({
      ...options,
      actor: 'agent:test',
      reason: 'Publish the completed change.',
      changes: ['Allow push delivery.'],
    }),
    (error) =>
      error instanceof PlanMountError &&
      error.code === 'OPERATION_AUTHORIZATION_REQUIRED',
  );
});

test('amending a completed Task reopens its affected closure without remounting', async (t) => {
  const options = scope(t);
  const mounted = await mountPlan({
    ...options,
    initialTaskStates: { 'FIXTURE-TASK': 'done' },
  });
  updateTaskCommand(options, 'node --version');

  const amended = await amendMountedPlan({
    ...options,
    actor: 'agent:test',
    reason: 'The completed check no longer proves the current contract.',
    changes: ['Strengthen the completed Task check.'],
  });

  assert.equal(amended.mount.mountId, mounted.mount.mountId);
  assert.equal(amended.run.state, 'prepared');
  assert.equal(amended.run.taskStates['FIXTURE-TASK'].state, 'pending');
  assert.deepEqual(amended.affectedTaskIds, ['FIXTURE-TASK']);
});

test('unfinished mount requires explicit owner unmount authorization', async (t) => {
  const options = scope(t);
  await mountPlan(options);

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

test('release and cancellation require the exact mount owner', async (t) => {
  const options = scope(t);
  await mountPlan(options);

  await assert.rejects(
    cancelExecutionRun({
      ...options,
      owner: 'other-owner',
    }),
    (error) =>
      error instanceof PlanMountError
      && error.code === 'PLAN_CANCEL_OWNER_MISMATCH',
  );
  await assert.rejects(
    releasePlanMount({
      ...options,
      owner: 'other-owner',
      reason: 'owner-unmount',
      allowUnfinished: true,
    }),
    (error) =>
      error instanceof PlanMountError
      && error.code === 'PLAN_MOUNT_OWNER_MISMATCH',
  );
});

test('deleted worktree mount can be recovered by workspaceId and mountId', async (t) => {
  const options = scope(t);
  const mounted = await mountPlan(options);
  fs.rmSync(options.repoRoot, { recursive: true, force: true });

  const released = await releasePlanMount({
    home: options.home,
    workspaceId: mounted.mount.workspaceId,
    mountId: mounted.mount.mountId,
    owner: options.owner,
    reason: 'owner-unmount',
    allowUnfinished: true,
  });

  assert.equal(released.mount.state, 'released');
  assert.equal(released.mount.releaseReason, 'owner-unmount');
});

test('tampered immutable snapshot fails closed', async (t) => {
  const options = scope(t);
  const mounted = await mountPlan(options);
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
