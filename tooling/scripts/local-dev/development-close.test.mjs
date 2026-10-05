import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import test from 'node:test';

import {
  mountPlanVersion,
  readLivePlanMountId,
  updateExecutionRun,
} from '../plan/plan-mount.mjs';
import { createPlanRepository } from '../plan/plan-test-fixture.mjs';
import { summarizeExecution } from '../plan/planctl.mjs';
import { workspaceIdForRoot } from '../lib/machine-dev-paths.mjs';
import { updateActiveWorkRecord } from './active-work-store.mjs';
import {
  createDevelopmentCloseReceipt,
  writeDevelopmentCloseReceipt,
} from './development-close-store.mjs';
import { closeDevelopment } from './development-close.mjs';
import {
  checkDeclaration,
  startOrUpdateDeclaration,
  statusAll,
} from './dev-work-ledger.mjs';

function declarationOptions(fixture, overrides = {}) {
  return {
    home: fixture.home,
    workspaceRoot: fixture.repoRoot,
    workItemId: 'DWF-CLOSE-STANDALONE',
    owner: 'test-owner',
    purpose: 'test Development close',
    sourceClaims: `exclusive-write:${fixture.plan}`,
    runtimeClaims: '',
    expiresMinutes: 60,
    now: new Date('2026-10-05T00:00:00.000Z'),
    ...overrides,
  };
}

function activeDeclaration(fixture, overrides = {}) {
  const options = declarationOptions(fixture, overrides);
  const declaration = startOrUpdateDeclaration(options);
  checkDeclaration({
    home: fixture.home,
    workspaceRoot: fixture.repoRoot,
    workItemId: declaration.workItemId,
    sessionId: declaration.sessionId,
    now: new Date('2026-10-05T00:01:00.000Z'),
    ...(overrides.planExecution === undefined
      ? {}
      : { planExecution: overrides.planExecution }),
    ...(overrides.planStatus === undefined
      ? {}
      : { planStatus: overrides.planStatus }),
  });
  return declaration;
}

test('standalone Development close releases declaration and persists receipt', async (t) => {
  const fixture = createPlanRepository(t);
  const declaration = activeDeclaration(fixture);

  const receipt = await closeDevelopment({
    home: fixture.home,
    repoRoot: fixture.repoRoot,
    workItemId: declaration.workItemId,
    mode: 'standalone',
    closeReason: 'completed',
    environmentPolicy: 'retain',
    owner: declaration.owner,
    now: new Date('2026-10-05T00:02:00.000Z'),
  });

  assert.equal(receipt.state, 'CLOSED');
  assert.equal(receipt.resources.runtimeLeases, 'RELEASED');
  assert.equal(receipt.resources.session, 'NOT_APPLICABLE');
  assert.equal(receipt.resources.activeWork, 'NOT_APPLICABLE');
  assert.equal(receipt.resources.declaration, 'RELEASED');
  assert.equal(receipt.resources.planMount, 'NOT_APPLICABLE');
  assert.equal(receipt.resources.environmentRegistration, 'RETAINED');
  const stored = statusAll({
    home: fixture.home,
    now: new Date('2026-10-05T00:03:00.000Z'),
  }).declarations.find(
    (candidate) => candidate.declarationId === declaration.declarationId,
  );
  assert.equal(stored.state, 'RELEASED');
});

test('Development close resumes after an interrupted owner stage', async (t) => {
  const fixture = createPlanRepository(t);
  const declaration = activeDeclaration(fixture);
  let interrupted = false;

  await assert.rejects(
    closeDevelopment({
      home: fixture.home,
      repoRoot: fixture.repoRoot,
      workItemId: declaration.workItemId,
      mode: 'standalone',
      closeReason: 'completed',
      environmentPolicy: 'retain',
      owner: declaration.owner,
      now: new Date('2026-10-05T00:02:00.000Z'),
      stageHook(stage) {
        if (stage === 'declaration' && !interrupted) {
          interrupted = true;
          throw new Error('simulated interruption');
        }
      },
    }),
    (error) =>
      error instanceof Error &&
      error.code === 'DEVELOPMENT_CLOSE_INTERNAL_ERROR',
  );

  const receipt = await closeDevelopment({
    home: fixture.home,
    repoRoot: fixture.repoRoot,
    workItemId: declaration.workItemId,
    mode: 'standalone',
    closeReason: 'completed',
    environmentPolicy: 'retain',
    owner: declaration.owner,
    now: new Date('2026-10-05T00:03:00.000Z'),
  });
  assert.equal(receipt.state, 'CLOSED');
  assert.ok(receipt.revision > 1);
});

test('tracked Development close clears projections and releases mount', async (t) => {
  const fixture = createPlanRepository(t);
  const mounted = await mountPlanVersion({
    home: fixture.home,
    repoRoot: fixture.repoRoot,
    plan: fixture.plan,
    projectId: 'peers-touch',
    owner: 'test-owner',
    now: new Date('2026-10-05T00:00:00.000Z'),
  });
  const execution = await updateExecutionRun(
    {
      home: fixture.home,
      repoRoot: fixture.repoRoot,
      now: new Date('2026-10-05T00:00:30.000Z'),
    },
    (run) => {
      for (const taskId of Object.keys(run.taskStates)) {
        run.taskStates[taskId] = { state: 'done', blocker: null };
      }
      run.state = 'completed';
      run.currentTaskId = null;
      run.exhaustion = null;
      return run;
    },
  );
  const taskId = execution.snapshot.plan.tasks.at(-1).id;
  const declaration = activeDeclaration(fixture, {
    workItemId: 'DWF-CLOSE-TRACKED',
    planPath: fixture.plan,
    planId: execution.mount.planId,
    planExecution: execution,
    planStatus: summarizeExecution(execution),
    taskId,
  });
  updateActiveWorkRecord(
    {
      workspaceId: execution.mount.workspaceId,
      workItemId: declaration.workItemId,
      mountId: execution.mount.mountId,
      runId: execution.run.runId,
      snapshotDigest: execution.snapshot.recordDigest,
      planId: execution.mount.planId,
      planPath: execution.mount.planPath,
      planStatus: 'completed',
      currentTaskId: taskId,
      currentTaskPath: `${fixture.plan.slice(0, fixture.plan.lastIndexOf('/'))}/${execution.snapshot.plan.tasks.find((task) => task.id === taskId).path}`,
      taskStatus: 'done',
      sessionId: declaration.sessionId,
      journeyId: declaration.journeyId ?? 'DWF-CLOSE-J01',
      devState: null,
      branch: execution.snapshot.executionBinding.branch,
      initialHead: execution.snapshot.executionBinding.initialHead,
      expectedHead: declaration.sourceHead,
    },
    {
      home: fixture.home,
      workspaceRoot: fixture.repoRoot,
      now: new Date('2026-10-05T00:01:00.000Z'),
    },
  );

  const receipt = await closeDevelopment({
    home: fixture.home,
    repoRoot: fixture.repoRoot,
    workItemId: declaration.workItemId,
    mode: 'tracked',
    closeReason: 'completed',
    environmentPolicy: 'retain',
    owner: declaration.owner,
    mountId: execution.mount.mountId,
    now: new Date('2026-10-05T00:02:00.000Z'),
  });

  assert.equal(receipt.state, 'CLOSED');
  assert.equal(receipt.resources.activeWork, 'CLOSED');
  assert.equal(receipt.resources.planMount, 'RELEASED');
  assert.equal(
    readLivePlanMountId(execution.mount.workspaceId, { home: fixture.home }),
    null,
  );
});

test('owner-abandon closes an orphan mount after worktree deletion', async (t) => {
  const fixture = createPlanRepository(t);
  const mounted = await mountPlanVersion({
    home: fixture.home,
    repoRoot: fixture.repoRoot,
    plan: fixture.plan,
    projectId: 'peers-touch',
    owner: 'test-owner',
    now: new Date('2026-10-05T00:00:00.000Z'),
  });
  rmSync(fixture.repoRoot, { recursive: true, force: true });

  const receipt = await closeDevelopment({
    home: fixture.home,
    workspaceId: mounted.mount.workspaceId,
    mountId: mounted.mount.mountId,
    workItemId: 'DWF-CLOSE-ORPHAN',
    mode: 'tracked',
    closeReason: 'owner-abandon',
    environmentPolicy: 'retain',
    owner: mounted.mount.mountedBy,
    now: new Date('2026-10-05T00:01:00.000Z'),
  });

  assert.equal(receipt.state, 'CLOSED');
  assert.equal(receipt.resources.planMount, 'RELEASED');
  assert.equal(
    readLivePlanMountId(mounted.mount.workspaceId, { home: fixture.home }),
    null,
  );
});

test('unfinished close receipt blocks new declaration admission', (t) => {
  const fixture = createPlanRepository(t);
  const workspaceId = workspaceIdForRoot(fixture.repoRoot);
  const receipt = createDevelopmentCloseReceipt(
    {
      workspaceId,
      workItemId: 'DWF-CLOSE-BLOCKER',
      mode: 'standalone',
      closeReason: 'completed',
      environmentPolicy: 'retain',
      owner: 'test-owner',
      mountId: null,
      runId: null,
    },
    { now: new Date('2026-10-05T00:00:00.000Z') },
  );
  writeDevelopmentCloseReceipt(receipt, { home: fixture.home });

  assert.throws(
    () =>
      startOrUpdateDeclaration(
        declarationOptions(fixture, {
          workItemId: 'DWF-CLOSE-NEXT',
        }),
      ),
    (error) => error?.code === 'DEVELOPMENT_CLOSE_IN_PROGRESS',
  );
});
