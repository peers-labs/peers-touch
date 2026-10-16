import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  AcceptanceAdmissionError,
  admitAcceptance,
} from './acceptance-admission.mjs';

const ROOT = '/tmp/acceptance-admission';
const PLAN_PATH =
  'docs/architecture/example/execution-plans/current/plan.md';
const WORKSPACE_ID = '0123456789abcdef';
const BRANCH = 'feature/acceptance';

function fixture(state = 'ACCEPTANCE_RUNNING') {
  const task = {
    taskId: 'TASK-1',
    closureId: 'closure-1',
    completionClass: 'functional',
  };
  const execution = {
    planPackage: {
      path: path.join(ROOT, PLAN_PATH),
      taskSlices: new Map([[task.taskId, task]]),
    },
    snapshot: {
      planId: 'PLAN-1',
      executionBinding: {
        workspaceId: WORKSPACE_ID,
        branch: BRANCH,
      },
      acceptance: {
        closures: {
          'closure-1': ['gate-1'],
        },
      },
    },
    run: {
      state: 'active',
      currentTaskId: task.taskId,
    },
  };
  const session = {
    state: {
      sessionId: 'session-1',
      planId: execution.snapshot.planId,
      taskId: task.taskId,
      workspaceId: WORKSPACE_ID,
      branch: BRANCH,
      state,
    },
  };
  return {
    execution,
    session,
    dependencies: {
      resolvePlanExecution() {
        return execution;
      },
      loadSessionStoreFromPath() {
        return session;
      },
    },
  };
}

async function rejects(code, operation) {
  await assert.rejects(operation, (error) => {
    assert.ok(error instanceof AcceptanceAdmissionError);
    assert.equal(error.code, code);
    return true;
  });
}

test('broad Acceptance requires an explicit matching Session', async () => {
  const scope = fixture();
  await rejects(
    'ACCEPTANCE_SESSION_REQUIRED',
    admitAcceptance(
      { repoRoot: ROOT, mode: 'acceptance' },
      scope.dependencies,
    ),
  );

  await rejects(
    'ACCEPTANCE_SESSION_INVALID',
    admitAcceptance(
      {
        repoRoot: ROOT,
        mode: 'acceptance',
        session: '/tmp/session.json',
      },
      {
        ...scope.dependencies,
        loadSessionStoreFromPath() {
          const error = new Error('identity mismatch');
          error.code = 'SESSION_IDENTITY_MISMATCH';
          throw error;
        },
      },
    ),
  );
});

test('broad Acceptance rejects the pre-functional frontier', async () => {
  const scope = fixture('FUNCTIONAL_PASS');
  await rejects(
    'ACCEPTANCE_FUNCTIONAL_FRONTIER_REQUIRED',
    admitAcceptance(
      {
        repoRoot: ROOT,
        mode: 'acceptance',
        session: '/tmp/session.json',
      },
      scope.dependencies,
    ),
  );
});

test('broad Acceptance starts only from ACCEPTANCE_RUNNING', async () => {
  const scope = fixture();
  const admitted = await admitAcceptance(
    {
      repoRoot: ROOT,
      mode: 'acceptance',
      session: '/tmp/session.json',
    },
    scope.dependencies,
  );

  assert.deepEqual(admitted, {
    ok: true,
    mode: 'acceptance',
    planId: 'PLAN-1',
    taskId: 'TASK-1',
    closureId: 'closure-1',
    sessionId: 'session-1',
    sessionState: 'ACCEPTANCE_RUNNING',
  });
});

test('Gap Detector requires successful formal Acceptance', async () => {
  const running = fixture('ACCEPTANCE_RUNNING');
  await rejects(
    'ACCEPTANCE_FUNCTIONAL_FRONTIER_REQUIRED',
    admitAcceptance(
      {
        repoRoot: ROOT,
        mode: 'gap',
        session: '/tmp/session.json',
      },
      running.dependencies,
    ),
  );

  const passed = fixture('ACCEPTANCE_PASS');
  const admitted = await admitAcceptance(
    {
      repoRoot: ROOT,
      mode: 'gap',
      session: '/tmp/session.json',
    },
    passed.dependencies,
  );
  assert.equal(admitted.sessionState, 'ACCEPTANCE_PASS');
});

test('current Task must own a formal Acceptance closure', async () => {
  const scope = fixture();
  scope.execution.snapshot.acceptance.closures['closure-1'] = [];
  await rejects(
    'ACCEPTANCE_PLAN_NOT_READY',
    admitAcceptance(
      {
        repoRoot: ROOT,
        mode: 'acceptance',
        session: '/tmp/session.json',
      },
      scope.dependencies,
    ),
  );
});
