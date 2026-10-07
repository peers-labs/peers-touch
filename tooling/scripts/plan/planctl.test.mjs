import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { mountPlan, resolvePlanExecution } from './plan-mount.mjs';
import { findStructuredBlocks } from './plan-package.mjs';
import { createPlanRepository } from './plan-test-fixture.mjs';
import {
  activatePlan,
  cancelPlan,
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

function updatePlan(options, update) {
  const planPath = path.join(options.repoRoot, options.plan);
  const text = fs.readFileSync(planPath, 'utf8');
  const block = findStructuredBlocks(text, 'Plan')[0];
  const plan = JSON.parse(block.text);
  update(plan);
  fs.writeFileSync(
    planPath,
    `${text.slice(0, block.contentStart)}${JSON.stringify(plan)}\n${text.slice(block.contentEnd)}`,
  );
}

test('CLI validates a candidate and records explicit North Star approval', async (t) => {
  const options = scope(t);
  updatePlan(options, (plan) => {
    plan.northStarApproval = null;
  });

  const candidate = await runPlanctl([
    'validate',
    '--repo-root',
    options.repoRoot,
    '--plan',
    options.plan,
  ]);
  assert.equal(candidate.northStarApprovalStatus, 'candidate');

  const approved = await runPlanctl([
    'approve-north-star',
    '--repo-root',
    options.repoRoot,
    '--plan',
    options.plan,
    '--actor',
    options.owner,
    '--decision-ref',
    'USER-DECISION-CLI',
  ]);
  assert.equal(approved.approvalRecorded, true);
  assert.equal(approved.northStarApprovalStatus, 'approved');
  assert.equal(approved.northStarApproval.decisionRef, 'USER-DECISION-CLI');

  const repeated = await runPlanctl([
    'approve-north-star',
    '--repo-root',
    options.repoRoot,
    '--plan',
    options.plan,
    '--actor',
    options.owner,
    '--decision-ref',
    'USER-DECISION-CLI',
  ]);
  assert.equal(repeated.approvalRecorded, false);
  assert.equal(repeated.planContentDigest, approved.planContentDigest);
});

test('status projects the current Plan snapshot and mutable Run state', async (t) => {
  const options = scope(t);
  const planBytes = fs.readFileSync(
    path.join(options.repoRoot, options.plan),
    'utf8',
  );
  await mountPlan(options);
  const resolved = await resolvePlanExecution(options);
  const summary = summarizeExecution(resolved);

  assert.equal(summary.planId, resolved.snapshot.planId);
  assert.equal(summary.status, 'prepared');
  assert.equal(summary.currentTaskId, null);
  assert.equal(summary.planDigest, resolved.snapshot.planDigest);
  assert.equal(summary.northStarApprovalStatus, 'approved');
  assert.equal(
    summary.northStarDigest,
    resolved.snapshot.plan.northStarApproval.northStarDigest,
  );
  assert.equal(
    fs.readFileSync(path.join(options.repoRoot, options.plan), 'utf8'),
    planBytes,
  );
});

test('activate starts only one dependency-ready Task in the Execution Run', async (t) => {
  const options = scope(t);
  const mounted = await mountPlan(options);
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
  const mounted = await mountPlan(options);
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

test('CLI status resolves only the workspace-mounted Plan', async (t) => {
  const options = scope(t);
  await mountPlan(options);
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

test('CLI amend records the reason and keeps the current mount and run', async (t) => {
  const options = scope(t);
  const mounted = await mountPlan(options);
  const taskPath = path.join(
    options.repoRoot,
    'plans',
    'primary',
    'tasks',
    'FIXTURE-TASK.md',
  );
  const taskText = fs.readFileSync(taskPath, 'utf8');
  fs.writeFileSync(
    taskPath,
    taskText.replace('"command": "true"', '"command": "node --version"'),
  );

  const result = await runPlanctl([
    'amend',
    '--repo-root',
    options.repoRoot,
    '--home',
    options.home,
    '--plan',
    options.plan,
    '--actor',
    'agent:test',
    '--reason',
    'Use a real focused check.',
    '--change',
    'Replace the placeholder command.',
  ]);

  assert.equal(result.mountId, mounted.mount.mountId);
  assert.equal(result.runId, mounted.run.runId);
  assert.equal(result.amendmentCount, 1);
  assert.equal(result.amendment.reason, 'Use a real focused check.');
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
