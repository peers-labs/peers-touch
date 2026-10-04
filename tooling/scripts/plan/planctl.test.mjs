import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { mountPlanVersion, resolvePlanExecution } from './plan-mount.mjs';
import {
  activatePlan,
  runPlanctl,
  summarizeExecution,
} from './planctl.mjs';

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIRECTORY, '../../..');
const PLAN =
  'docs/architecture/development-workflow/execution-plans/'
  + '20261004-nonblocking-agent-integration/plan.md';

function scope(t) {
  const home = fs.mkdtempSync(
    path.join(os.tmpdir(), 'planctl-test-'),
  );
  t.after(() =>
    fs.rmSync(home, { recursive: true, force: true }),
  );
  return {
    repoRoot: REPO_ROOT,
    'repo-root': REPO_ROOT,
    home,
    plan: PLAN,
    projectId: 'peers-touch',
    owner: 'test-owner',
    now: new Date('2026-10-04T00:00:00.000Z'),
  };
}

test('status projects frozen Plan Version and mutable Run state', async (t) => {
  const options = scope(t);
  const planBytes = fs.readFileSync(
    path.join(REPO_ROOT, PLAN),
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
    fs.readFileSync(path.join(REPO_ROOT, PLAN), 'utf8'),
    planBytes,
  );
});

test('activate starts only one dependency-ready Task in the Execution Run', async (t) => {
  const options = scope(t);
  const mounted = await mountPlanVersion(options);
  const taskId = mounted.snapshot.plan.tasks.find(
    (task) => task.dependsOn.length === 0,
  ).id;
  const activated = await activatePlan(PLAN, {
    ...options,
    task: taskId,
  });

  assert.equal(activated.run.state, 'active');
  assert.equal(activated.run.currentTaskId, taskId);
  assert.equal(activated.run.taskStates[taskId].state, 'in_progress');
});

test('CLI status resolves only the workspace-mounted Plan Version', async (t) => {
  const options = scope(t);
  await mountPlanVersion(options);
  const result = await runPlanctl([
    'status',
    '--repo-root',
    REPO_ROOT,
    '--home',
    options.home,
    '--plan',
    PLAN,
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.status, 'prepared');
  assert.equal(result.planPath, PLAN);
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
