import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { digestCompletionCandidate } from '../local-dev/completion-review.mjs';
import { mountPlanVersion, resolvePlanExecution } from './plan-mount.mjs';
import { createPlanRepository } from './plan-test-fixture.mjs';
import {
  activatePlan,
  cancelPlan,
  digestRunCompletionCandidate,
  runPlanctl,
  summarizeExecution,
} from './planctl.mjs';

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));

function scope(t) {
  const fixture = createPlanRepository(t);
  return {
    repoRoot: fixture.repoRoot,
    'repo-root': fixture.repoRoot,
    home: fixture.home,
    plan: fixture.plan,
    projectId: 'peers-touch',
    owner: 'test-owner',
    now: new Date('2026-10-04T00:00:00.000Z'),
  };
}

test('status projects frozen Plan Version and mutable Run state', async (t) => {
  const options = scope(t);
  const planBytes = fs.readFileSync(
    path.join(options.repoRoot, options.plan),
    'utf8',
  );
  await mountPlanVersion(options);
  const resolved = await resolvePlanExecution(options);
  const summary = summarizeExecution(resolved);

  assert.equal(summary.planId, resolved.snapshot.planId);
  assert.equal(summary.status, 'prepared');
  assert.equal(summary.currentTaskId, null);
  assert.equal(summary.planVersionDigest, resolved.mount.planVersionDigest);
  assert.equal(
    fs.readFileSync(path.join(options.repoRoot, options.plan), 'utf8'),
    planBytes,
  );
});

test('activate starts only one dependency-ready Task in the Execution Run', async (t) => {
  const options = scope(t);
  const mounted = await mountPlanVersion(options);
  const taskId = mounted.snapshot.plan.tasks.find(
    (task) => task.dependsOn.length === 0,
  ).id;
  const activated = await activatePlan(options.plan, {
    ...options,
    task: taskId,
  });

  assert.equal(activated.run.state, 'active');
  assert.equal(activated.run.currentTaskId, taskId);
  assert.equal(activated.run.taskStates[taskId].state, 'in_progress');
});

test('cancel transitions an active Execution Run and is idempotent', async (t) => {
  const options = scope(t);
  const mounted = await mountPlanVersion(options);
  const taskId = mounted.snapshot.plan.tasks.find(
    (task) => task.dependsOn.length === 0,
  ).id;
  await activatePlan(options.plan, {
    ...options,
    task: taskId,
  });

  const cancelled = await cancelPlan(options.plan, {
    ...options,
    owner: options.owner,
  });
  assert.equal(cancelled.run.state, 'cancelled');
  assert.equal(cancelled.run.currentTaskId, null);
  assert.equal(cancelled.run.taskStates[taskId].state, 'pending');

  const repeated = await runPlanctl([
    'cancel',
    '--repo-root',
    options.repoRoot,
    '--home',
    options.home,
    '--plan',
    options.plan,
    '--owner',
    options.owner,
  ]);
  assert.equal(repeated.status, 'cancelled');
  assert.equal(repeated.runId, cancelled.run.runId);
});

test('CLI status resolves only the workspace-mounted Plan Version', async (t) => {
  const options = scope(t);
  await mountPlanVersion(options);
  const result = await runPlanctl([
    'status',
    '--repo-root',
    options.repoRoot,
    '--home',
    options.home,
    '--plan',
    options.plan,
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.status, 'prepared');
  assert.equal(result.planPath, options.plan);
});

test('completion review precedes the single guarded Run update', () => {
  const source = fs.readFileSync(
    path.join(TEST_DIRECTORY, 'planctl.mjs'),
    'utf8',
  );
  const start = source.indexOf('export async function advancePlan');
  const end = source.indexOf('export async function activatePlan', start);
  const advance = source.slice(start, end);

  assert.ok(
    advance.indexOf('await validateCompletion')
      < advance.lastIndexOf('return updateExecutionRun'),
  );
  assert.match(advance, /run\.revision !== resolved\.run\.revision/u);
  assert.match(advance, /run\.recordDigest !== resolved\.run\.recordDigest/u);
  assert.doesNotMatch(advance, /Restore the exact previous run|rollback/u);
});

test('completion candidate digest uses the delegated review envelope', () => {
  const resolved = {
    mount: { planVersionDigest: 'plan-digest' },
    snapshot: { recordDigest: 'snapshot-digest' },
    run: { runId: 'run-id', revision: 7 },
  };
  const candidate = {
    currentTaskId: 'TASK-02',
    exhaustion: null,
  };
  const envelope = {
    kind: 'peers-touch-execution-run-completion-candidate',
    planVersionDigest: 'plan-digest',
    snapshotDigest: 'snapshot-digest',
    runId: 'run-id',
    runRevision: 7,
    transition: {
      to: 'done',
      nextTaskId: 'TASK-02',
      exhaustion: null,
    },
  };
  const expected = digestCompletionCandidate(envelope);

  assert.equal(digestRunCompletionCandidate(resolved, candidate), expected);
});
