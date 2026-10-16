import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  WORKFLOW_DOCTOR_DOCUMENTS,
  WORKFLOW_DOCTOR_PROMISES,
  evaluateWorkflowDoctor,
  resolveDoctorReview,
  runWorkflowDoctorCli,
  workflowDoctorExitCode,
} from './workflow-doctor.mjs';

const WORKSPACE_ID = '0123456789abcdef';
const BRANCH = 'feat/dev-product-control-plane';
const HEAD = '1'.repeat(40);
const PLAN_ID = 'DWF-PEERS-DEV-PRODUCT-20260926';

function documentText(omit = null) {
  return WORKFLOW_DOCTOR_PROMISES
    .filter(({ id }) => id !== omit)
    .map(({ id }) => `<!-- workflow-doctor:${id} -->`)
    .join('\n');
}

function snapshot({ planStatus = 'active', reviewState = 'MISSING' } = {}) {
  return {
    worktrees: [
      {
        workspaceId: WORKSPACE_ID,
        agentActivity: { state: 'working' },
        workflow: {
          verdict: 'SUSPENDED',
          continuation: 'CONTINUE',
          plan: {
            id: PLAN_ID,
            status: planStatus,
            progress: { completed: 4, total: 5, percentage: 80 },
          },
          task:
            planStatus === 'active'
              ? { id: 'DWF-PD05-TRUTH' }
              : null,
          session:
            planStatus === 'active'
              ? { state: 'IMPLEMENTING' }
              : null,
          review: { state: reviewState },
          findings: [
            {
              code: 'WORKSPACE_UNREGISTERED',
              owner: 'environment',
              severity: 'warning',
            },
          ],
        },
      },
    ],
  };
}

function integration(status = 'PASS') {
  return status === 'PASS'
    ? {
        status: 'PASS',
        host: 'trae',
        integrationReceipt: {
          receipt: { callbackProof: { status: 'PASS' } },
          findings: [],
        },
        hostProjectionFindings: [],
        workflowIdentity: { identityFindings: [] },
      }
    : {
        status: 'BLOCKED',
        host: 'trae',
        integrationReceipt: { findings: ['integration-receipt-missing'] },
        hostProjectionFindings: [{ issue: 'trae-hooks-invalid' }],
        workflowIdentity: { identityFindings: [] },
      };
}

function plan(root, status = 'active') {
  return {
    mount: {
      mountId: 'mount-dev-product',
      workspaceId: WORKSPACE_ID,
      canonicalRoot: root,
      planId: PLAN_ID,
      planPath: 'docs/architecture/engineering/development-workflow/plan.md',
    },
    snapshot: {
      planId: PLAN_ID,
      executionBinding: {
        workspaceId: WORKSPACE_ID,
        branch: BRANCH,
      },
    },
    run: {
      mountId: 'mount-dev-product',
      state: status,
    },
    planPackage: {
      manifest: { planId: PLAN_ID },
    },
  };
}

function fixture(t, overrides = {}) {
  const root = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), 'workflow-doctor-')),
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let snapshotCalls = 0;
  let planCalls = 0;
  const dependencies = {
    now: () => new Date('2026-09-26T00:00:00.000Z'),
    sourceIdentity: () => ({
      workspaceId: WORKSPACE_ID,
      branch: BRANCH,
      head: HEAD,
    }),
    auditIntegration: () => integration(),
    resolvePlan: () => {
      planCalls += 1;
      return plan(root);
    },
    buildSnapshot: () => {
      snapshotCalls += 1;
      return snapshot();
    },
    resolveReview: (_root, _source, planResult, snapshotValue) => {
      const planStatus = planResult.run.state;
      const row = snapshotValue.worktrees.find(
        (candidate) => candidate.workspaceId === WORKSPACE_ID,
      );
      return {
        planStatus,
        reviewState: row?.workflow?.review?.state ?? 'MISSING',
        required: planStatus === 'completed',
        invalidTaskId: null,
      };
    },
    readFile: () => documentText(),
    ...overrides,
  };
  return {
    root,
    dependencies,
    calls: () => ({ snapshotCalls, planCalls }),
  };
}

function byId(report, id) {
  return report.promises.find((promise) => promise.id === id);
}

test('reports PASS only when every public promise is true', async (t) => {
  const current = fixture(t);
  const report = await evaluateWorkflowDoctor(
    { repoRoot: current.root, host: 'trae' },
    current.dependencies,
  );
  assert.equal(report.status, 'PASS');
  assert.equal(workflowDoctorExitCode(report), 0);
  assert.deepEqual(
    report.promises.map(({ id, status }) => [id, status]),
    WORKFLOW_DOCTOR_PROMISES.map(({ id }) => [id, 'PASS']),
  );
  assert.deepEqual(report.source, {
    workspaceId: WORKSPACE_ID,
    branch: BRANCH,
    head: HEAD,
  });
});

test('broken installed hook names the failed promise and exits nonzero', async (t) => {
  const current = fixture(t, {
    auditIntegration: () => integration('BLOCKED'),
  });
  const report = await evaluateWorkflowDoctor(
    { repoRoot: current.root },
    current.dependencies,
  );
  assert.equal(report.status, 'BLOCKED');
  assert.equal(workflowDoctorExitCode(report), 2);
  assert.deepEqual(byId(report, 'dev.integration.installed'), {
    id: 'dev.integration.installed',
    label: 'Installed agent integration',
    status: 'BLOCKED',
    code: 'AGENT_INTEGRATION_BLOCKED',
    detail: {
      findings: ['integration-receipt-missing', 'trae-hooks-invalid'],
    },
  });
});

test('active Plan permits missing or pending review but rejects stale review', async (t) => {
  for (const reviewState of ['MISSING', 'PENDING', 'PASS']) {
    const current = fixture(t, {
      buildSnapshot: () => snapshot({ reviewState }),
    });
    const report = await evaluateWorkflowDoctor(
      { repoRoot: current.root },
      current.dependencies,
    );
    assert.equal(byId(report, 'dev.review.current').status, 'PASS');
  }
  const stale = fixture(t, {
    buildSnapshot: () => snapshot({ reviewState: 'STALE' }),
  });
  const report = await evaluateWorkflowDoctor(
    { repoRoot: stale.root },
    stale.dependencies,
  );
  assert.equal(byId(report, 'dev.review.current').status, 'BLOCKED');
  assert.equal(
    byId(report, 'dev.review.current').code,
    'COMPLETION_REVIEW_NOT_CURRENT',
  );
});

test('completed Plan requires a current PASS review', async (t) => {
  const missing = fixture(t, {
    resolvePlan: () => plan(missing.root, 'completed'),
    buildSnapshot: () =>
      snapshot({
        planStatus: 'completed',
        reviewState: 'MISSING',
      }),
  });
  let report = await evaluateWorkflowDoctor(
    { repoRoot: missing.root },
    missing.dependencies,
  );
  assert.equal(byId(report, 'dev.review.current').status, 'BLOCKED');

  const passing = fixture(t, {
    resolvePlan: () => plan(passing.root, 'completed'),
    buildSnapshot: () =>
      snapshot({
        planStatus: 'completed',
        reviewState: 'PASS',
      }),
  });
  report = await evaluateWorkflowDoctor(
    { repoRoot: passing.root },
    passing.dependencies,
  );
  assert.equal(report.status, 'PASS');
});

test('cancelled Plan is terminal without a completion claim', async (t) => {
  const current = fixture(t, {
    resolvePlan: () => plan(current.root, 'cancelled'),
    buildSnapshot: () =>
      snapshot({
        planStatus: 'cancelled',
        reviewState: 'MISSING',
      }),
  });
  const report = await evaluateWorkflowDoctor(
    { repoRoot: current.root },
    current.dependencies,
  );
  const promise = byId(report, 'dev.review.current');
  assert.equal(promise.status, 'PASS');
  assert.equal(promise.detail.required, false);
});

test('terminal review resolver reads released work-item lineage from durable history', async (t) => {
  const current = fixture(t);
  const releasedSnapshot = {
    declarations: [
      {
        workspaceId: WORKSPACE_ID,
        planId: PLAN_ID,
        workItemId: 'DWF-DEV-PRODUCT-PD05',
        state: 'RELEASED',
        expiresAt: '2026-09-26T02:00:00.000Z',
      },
    ],
    worktrees: [],
  };
  let inspected = null;
  const result = await resolveDoctorReview(
    current.root,
    { workspaceId: WORKSPACE_ID },
    plan(current.root, 'completed'),
    releasedSnapshot,
    {
      findEarliestInvalidCompletionReview: async (options) => {
        inspected = options;
        return null;
      },
    },
  );
  assert.deepEqual(result, {
    planStatus: 'completed',
    reviewState: 'PASS',
    required: true,
    invalidTaskId: null,
  });
  assert.equal(inspected.workItemId, 'DWF-DEV-PRODUCT-PD05');
  assert.equal(inspected.planPackage.manifest.planId, PLAN_ID);
});

test('released completed Plan accepts a registered Snapshot row and durable review PASS', async (t) => {
  const releasedSnapshot = snapshot({ planStatus: 'completed' });
  releasedSnapshot.worktrees[0].workflow.plan = null;
  releasedSnapshot.worktrees[0].workflow.review = { state: 'MISSING' };
  releasedSnapshot.declarations = [
    {
      workspaceId: WORKSPACE_ID,
      planId: PLAN_ID,
      workItemId: 'DWF-DEV-PRODUCT-PD05',
      state: 'RELEASED',
      expiresAt: '2026-09-26T02:00:00.000Z',
    },
  ];
  const current = fixture(t, {
    resolvePlan: () => plan(current.root, 'completed'),
    buildSnapshot: () => releasedSnapshot,
    resolveReview: () => ({
      planStatus: 'completed',
      reviewState: 'PASS',
      required: true,
      invalidTaskId: null,
    }),
  });
  const report = await evaluateWorkflowDoctor(
    { repoRoot: current.root },
    current.dependencies,
  );
  assert.equal(report.status, 'PASS');
  assert.equal(byId(report, 'dev.workflow.current').detail.planId, PLAN_ID);
  assert.equal(byId(report, 'dev.review.current').detail.reviewState, 'PASS');
});

test('current-worktree projection ignores unrelated global drift and accepts warnings', async (t) => {
  const current = fixture(t, {
    buildSnapshot: () => ({
      verdict: 'DRIFT',
      continuation: 'HARD_BLOCK',
      ...snapshot(),
    }),
  });
  const report = await evaluateWorkflowDoctor(
    { repoRoot: current.root },
    current.dependencies,
  );
  const promise = byId(report, 'dev.workflow.current');
  assert.equal(promise.status, 'PASS');
  assert.deepEqual(promise.detail.warnings, ['WORKSPACE_UNREGISTERED']);
});

test('documentation audit requires every marker in every declared guide', async (t) => {
  const missingId = 'dev.workflow.current';
  const current = fixture(t, {
    readFile: () => documentText(missingId),
  });
  const report = await evaluateWorkflowDoctor(
    { repoRoot: current.root },
    current.dependencies,
  );
  const promise = byId(report, 'dev.docs.executable');
  assert.equal(promise.status, 'BLOCKED');
  assert.deepEqual(promise.detail.missing, [
    `docs/global/workflow.md:${missingId}`,
  ]);
  assert.deepEqual(
    Object.keys(WORKFLOW_DOCTOR_DOCUMENTS),
    ['docs/global/workflow.md'],
  );
});

test('restart reruns durable Plan and Snapshot providers instead of caching state', async (t) => {
  const current = fixture(t);
  const first = await evaluateWorkflowDoctor(
    { repoRoot: current.root },
    current.dependencies,
  );
  const second = await evaluateWorkflowDoctor(
    { repoRoot: current.root },
    current.dependencies,
  );
  assert.equal(first.status, 'PASS');
  assert.equal(second.status, 'PASS');
  assert.deepEqual(current.calls(), { snapshotCalls: 2, planCalls: 2 });
});

test('CLI accepts only a closed host selector', async (t) => {
  const current = fixture(t);
  const report = await runWorkflowDoctorCli(
    ['--host', 'trae'],
    {
      ...current.dependencies,
      repoRoot: current.root,
      sourceIdentity: () => ({
        workspaceId: WORKSPACE_ID,
        branch: BRANCH,
        head: HEAD,
      }),
    },
  );
  assert.equal(report.status, 'PASS');
  await assert.rejects(
    runWorkflowDoctorCli(['--root', '/tmp'], current.dependencies),
    (error) => error.code === 'WORKFLOW_DOCTOR_ARGUMENT_INVALID',
  );
});
