import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { workspaceIdForRoot } from '../lib/machine-dev-paths.mjs';
import {
  deriveWorkflowSnapshot,
  loadWorkflowSnapshot,
  projectContextAnchor,
} from './workflow-snapshot.mjs';

const OBSERVED_AT = '2026-09-20T00:00:00.000Z';
const HEAD = '1'.repeat(40);
const INITIAL_HEAD = '0'.repeat(40);
const WORKSPACE_ID = '0123456789abcdef';
const PLAN_PATH = 'docs/architecture/example/execution-plans/plan/plan.md';
const TASK_PATH =
  'docs/architecture/example/execution-plans/plan/tasks/TASK-1.md';

function owners(overrides = {}) {
  const git = {
    workspaceId: WORKSPACE_ID,
    branch: 'feature/workflow',
    commit: HEAD,
    tree: '2'.repeat(40),
    clean: false,
    stable: true,
    workspaceDigest: `sha256:${'3'.repeat(64)}`,
  };
  const binding = {
    workspaceId: WORKSPACE_ID,
    planId: 'PLAN-1',
    planPath: PLAN_PATH,
  };
  const plan = {
    planId: 'PLAN-1',
    planPath: PLAN_PATH,
    status: 'active',
    branch: git.branch,
    workspaceId: WORKSPACE_ID,
    initialHead: INITIAL_HEAD,
    currentTaskId: 'TASK-1',
    currentTaskPath: 'tasks/TASK-1.md',
    currentJourneyId: 'JOURNEY-1',
    tasks: [
      { id: 'TASK-1', status: 'in_progress' },
      { id: 'TASK-2', status: 'pending' },
    ],
    progress: {
      unit: 'task-closure',
      completed: 0,
      total: 2,
      percentage: 0,
      currentTaskId: 'TASK-1',
      nextProgressBoundary: {
        taskId: 'TASK-1',
        completedDelta: 1,
        completedAfter: 1,
        percentageAfter: 50,
        percentagePointDelta: 50,
        unlocksTaskIds: ['TASK-2'],
      },
    },
  };
  const declaration = {
    declarationId: 'work-1-0123456789abcdef',
    workItemId: 'work-1',
    sessionId: 'session-1',
    workspaceId: WORKSPACE_ID,
    planId: plan.planId,
    planPath: plan.planPath,
    taskId: plan.currentTaskId,
    journeyId: plan.currentJourneyId,
    branch: git.branch,
    sourceHead: git.commit,
    state: 'ACTIVE',
    expiresAt: '2026-09-20T08:00:00.000Z',
    runtimeClaims: [],
  };
  const session = {
    sessionId: declaration.sessionId,
    workItemId: declaration.workItemId,
    planId: declaration.planId,
    taskId: declaration.taskId,
    workspaceId: declaration.workspaceId,
    branch: declaration.branch,
    journeyId: declaration.journeyId,
    state: 'IMPLEMENTING',
    updatedAt: OBSERVED_AT,
    failure: null,
    verification: null,
  };
  const activeWork = {
    workspaceId: WORKSPACE_ID,
    workItemId: declaration.workItemId,
    planId: plan.planId,
    planPath: plan.planPath,
    planStatus: plan.status,
    currentTaskId: plan.currentTaskId,
    currentTaskPath: TASK_PATH,
    taskStatus: 'in_progress',
    sessionId: session.sessionId,
    journeyId: session.journeyId,
    devState: session.state,
    branch: git.branch,
    initialHead: plan.initialHead,
    expectedHead: git.commit,
    revision: 1,
    updatedAt: OBSERVED_AT,
  };
  return {
    observedAt: OBSERVED_AT,
    git,
    binding,
    plan,
    declarations: [declaration],
    session,
    activeWork,
    runtime: {
      registration: {
        workspaceId: WORKSPACE_ID,
        branch: git.branch,
        profile: null,
        activity: 'active',
        profileState: 'available',
        profileError: null,
      },
      leases: [],
    },
    rollout: {
      kind: 'peers-touch-skill-rollout',
      state: 'INSTALLED',
      workspaceId: WORKSPACE_ID,
      branch: git.branch,
      sourceHead: git.commit,
      catalogDigest: '4'.repeat(64),
      catalogGitState: 'CLEAN',
      installedAt: OBSERVED_AT,
    },
    errors: {},
    ...overrides,
  };
}

test('deriveWorkflowSnapshot returns HEALTHY only when all runtime owners agree', () => {
  const snapshot = deriveWorkflowSnapshot(owners());

  assert.equal(snapshot.kind, 'peers-touch-workflow-snapshot');
  assert.equal(snapshot.verdict, 'HEALTHY');
  assert.equal(snapshot.continuation, 'CONTINUE');
  assert.deepEqual(snapshot.findings, []);
  assert.equal(snapshot.owners.plan.progress.percentage, 0);
  assert.equal(snapshot.owners.activeWork.currentTaskPath, TASK_PATH);
});

test('deriveWorkflowSnapshot reports typed cross-owner drift', () => {
  const input = owners();
  input.activeWork = {
    ...input.activeWork,
    currentTaskId: 'TASK-OLD',
    devState: 'BOUND',
  };
  input.declarations[0] = {
    ...input.declarations[0],
    sourceHead: '9'.repeat(40),
  };

  const snapshot = deriveWorkflowSnapshot(input);

  assert.equal(snapshot.verdict, 'DRIFT');
  assert.equal(snapshot.continuation, 'CONTINUE');
  assert.deepEqual(
    snapshot.findings.map(({ owner, field }) => [owner, field]),
    [
      ['declaration', 'sourceHead'],
      ['active-work', 'currentTaskId'],
      ['active-work', 'devState'],
    ],
  );
});

test('forward-only HEAD progress is not drift when lineage is established', () => {
  const input = owners();
  const oldHead = '5'.repeat(40);
  input.declarations[0] = {
    ...input.declarations[0],
    sourceHead: oldHead,
  };
  input.activeWork = {
    ...input.activeWork,
    expectedHead: oldHead,
  };
  input.headLineage = {
    declarationSourceHeadIsAncestor: true,
    expectedHeadIsAncestor: true,
  };

  const snapshot = deriveWorkflowSnapshot(input);

  assert.equal(snapshot.verdict, 'HEALTHY');
  assert.equal(snapshot.continuation, 'CONTINUE');
  assert.deepEqual(snapshot.findings, []);
});

test('non-ancestor HEAD divergence is reported as drift', () => {
  const input = owners();
  const divergedHead = '6'.repeat(40);
  input.declarations[0] = {
    ...input.declarations[0],
    sourceHead: divergedHead,
  };
  input.activeWork = {
    ...input.activeWork,
    expectedHead: divergedHead,
  };
  input.headLineage = {
    declarationSourceHeadIsAncestor: false,
    expectedHeadIsAncestor: false,
  };

  const snapshot = deriveWorkflowSnapshot(input);

  assert.equal(snapshot.verdict, 'DRIFT');
  assert.equal(snapshot.continuation, 'CONTINUE');
  const driftFields = snapshot.findings.map(({ owner, field }) => [owner, field]);
  assert.ok(driftFields.some(([o, f]) => o === 'declaration' && f === 'sourceHead'));
  assert.ok(driftFields.some(([o, f]) => o === 'active-work' && f === 'expectedHead'));
});

test('explicit owner blockers are distinct from contradictory state', () => {
  const input = owners();
  input.session = {
    ...input.session,
    state: 'BLOCKED',
    failure: {
      kind: 'HOST_CAPABILITY_UNAVAILABLE',
      owner: 'host',
      summary: 'device unavailable',
    },
  };
  input.activeWork = {
    ...input.activeWork,
    devState: 'BLOCKED',
  };

  const snapshot = deriveWorkflowSnapshot(input);

  assert.equal(snapshot.verdict, 'BLOCKED');
  assert.equal(snapshot.continuation, 'CONTINUE');
  assert.deepEqual(snapshot.findings, []);
  assert.equal(snapshot.owners.session.failure.owner, 'host');
});

test('rollout drift stays observable without blocking business work', () => {
  const input = owners();
  input.rollout = {
    ...input.rollout,
    sourceHead: '8'.repeat(40),
  };

  const snapshot = deriveWorkflowSnapshot(input);

  assert.equal(snapshot.verdict, 'HEALTHY');
  assert.equal(snapshot.continuation, 'CONTINUE');
  assert.deepEqual(
    snapshot.findings.map(({ severity, code, owner }) => [
      severity,
      code,
      owner,
    ]),
    [['warning', 'WORKFLOW_ROLLOUT_DRIFT', 'rollout']],
  );
});

test('retired rollout receipt state is warning-only catalog drift', () => {
  const input = owners();
  input.rollout = {
    ...input.rollout,
    state: 'RETIRED',
  };

  const snapshot = deriveWorkflowSnapshot(input);

  assert.equal(snapshot.verdict, 'HEALTHY');
  assert.equal(snapshot.continuation, 'CONTINUE');
  assert.deepEqual(
    snapshot.findings.map(({ severity, code, owner, field }) => [
      severity,
      code,
      owner,
      field,
    ]),
    [['warning', 'WORKFLOW_ROLLOUT_DRIFT', 'rollout', 'state']],
  );
});

test('completed Plan without live execution returns COMPLETE', () => {
  const input = owners();
  input.plan = {
    ...input.plan,
    status: 'completed',
    currentTaskId: null,
    currentTaskPath: null,
    currentJourneyId: null,
    tasks: input.plan.tasks.map((task) => ({ ...task, status: 'done' })),
  };
  input.declarations = [];
  input.session = null;
  input.activeWork = null;
  input.plan.frontier = {
    readyTaskIds: ['TASK-STALE'],
    blocked: [],
    waiting: [],
  };

  const snapshot = deriveWorkflowSnapshot(input);
  const projection = projectContextAnchor(snapshot);

  assert.equal(snapshot.verdict, 'SUSPENDED');
  assert.equal(snapshot.continuation, 'COMPLETE');
  assert.deepEqual(snapshot.findings, []);
  assert.equal(projection.frontier.ready.total, 0);
  assert.equal(projection.frontier.terminalState, 'completed');
  assert.deepEqual(projection.currentObservation, {
    taskId: null,
    sessionId: null,
    status: 'none',
    evidence: null,
    timing: null,
  });
});

test('current Task without a Session is explicitly not started', () => {
  const input = owners();
  input.session = null;
  input.activeWork = {
    ...input.activeWork,
    devState: null,
  };

  const projection = projectContextAnchor(deriveWorkflowSnapshot(input));

  assert.equal(projection.currentObservation.taskId, 'TASK-1');
  assert.equal(projection.currentObservation.sessionId, null);
  assert.equal(projection.currentObservation.status, 'not-started');
  assert.deepEqual(projection.currentObservation.evidence, {
    SOURCE_CHECK: 'NOT_RUN',
    STRUCTURAL_CHECK: 'NOT_RUN',
    UX_REVIEW: 'NOT_RUN',
    FUNCTIONAL_CHECK: 'NOT_RUN',
    ACCEPTANCE_PROOF: 'NOT_RUN',
  });
  assert.equal(projection.currentObservation.timing, null);
});

test('current observation distinguishes an unavailable Session read', () => {
  const input = owners();
  input.session = null;
  input.activeWork = {
    ...input.activeWork,
    devState: null,
  };
  input.errors = {
    session: {
      code: 'SESSION_JOURNAL_INVALID',
      message: 'journal cannot be read',
    },
  };

  const projection = projectContextAnchor(deriveWorkflowSnapshot(input));

  assert.equal(projection.currentObservation.taskId, 'TASK-1');
  assert.equal(projection.currentObservation.status, 'unavailable');
  assert.equal(projection.currentObservation.evidence, null);
  assert.equal(projection.currentObservation.timing, null);
});

test('fixed-point Plan blocker returns HARD_BLOCK', () => {
  const input = owners();
  input.plan = {
    ...input.plan,
    status: 'blocked',
    currentTaskId: null,
    currentTaskPath: null,
    currentJourneyId: null,
    tasks: input.plan.tasks.map((task, index) => ({
      ...task,
      status: index === 0 ? 'blocked' : 'pending',
    })),
  };
  input.declarations[0] = {
    ...input.declarations[0],
    taskId: 'TASK-1',
  };
  input.activeWork = {
    ...input.activeWork,
    planStatus: 'blocked',
    taskStatus: 'blocked',
  };

  const snapshot = deriveWorkflowSnapshot(input);

  assert.equal(snapshot.verdict, 'BLOCKED');
  assert.equal(snapshot.continuation, 'HARD_BLOCK');
});

test('critical Git or Plan identity drift returns HARD_BLOCK', () => {
  const input = owners();
  input.plan = {
    ...input.plan,
    branch: 'other-branch',
  };

  const snapshot = deriveWorkflowSnapshot(input);

  assert.equal(snapshot.verdict, 'DRIFT');
  assert.equal(snapshot.continuation, 'HARD_BLOCK');
  assert.deepEqual(
    snapshot.findings.map(({ owner, field }) => [owner, field]),
    [['plan', 'branch']],
  );
});

test('compact Context Anchor projection omits full owner payloads', () => {
  const input = owners();
  input.plan.frontier = {
    readyTaskIds: ['TASK-2'],
    blocked: [],
    waiting: Array.from({ length: 10 }, (_, index) => ({
      taskId: `WAIT-${index + 1}`,
      reason: 'depends:TASK-1',
    })),
  };
  input.session = {
    ...input.session,
    timing: {
      completeness: 'complete',
      startedAt: OBSERVED_AT,
      observedAt: OBSERVED_AT,
      elapsedMs: 12_000,
      phaseMs: {
        implement: 5_000,
        test: 2_000,
        functional: 3_000,
        acceptance: 0,
        wait: 2_000,
      },
      evidence: {
        SOURCE_CHECK: 'PASS',
        FUNCTIONAL_CHECK: 'PASS',
        ACCEPTANCE_PROOF: 'UNPROVEN',
      },
      tokens: null,
    },
  };
  const snapshot = deriveWorkflowSnapshot(input);

  const projection = projectContextAnchor(snapshot, {
    worktreeName: 'peers-touch-git',
  });

  assert.equal(projection.kind, 'peers-touch-context-anchor-projection');
  assert.equal(projection.current.taskId, 'TASK-1');
  assert.equal(projection.current.sessionState, 'IMPLEMENTING');
  assert.equal(projection.currentObservation.taskId, 'TASK-1');
  assert.equal(projection.currentObservation.sessionId, 'session-1');
  assert.equal(projection.currentObservation.status, 'measured');
  assert.equal(
    projection.currentObservation.timing.phaseMs.implement,
    5_000,
  );
  assert.equal(
    projection.currentObservation.evidence.ACCEPTANCE_PROOF,
    'UNPROVEN',
  );
  assert.equal(projection.binding.worktreeName, 'peers-touch-git');
  assert.equal(projection.binding.verifiedHead, HEAD);
  assert.equal(projection.frontier.ready.total, 1);
  assert.equal(projection.frontier.waiting.items.length, 8);
  assert.equal(projection.frontier.waiting.hidden, 2);
  assert.equal(Object.hasOwn(projection, 'owners'), false);
  assert.equal(Object.hasOwn(projection, 'timing'), false);
  assert.equal(Object.hasOwn(projection, 'evidence'), false);
  assert.ok(
    JSON.stringify(projection).length < JSON.stringify(snapshot).length,
  );
});

test('loadWorkflowSnapshot reads owners and delegates all consistency decisions', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'workflow-snapshot-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-b', 'feature/workflow'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], {
    cwd: root,
  });
  execFileSync('git', ['config', 'user.name', 'Workflow Test'], { cwd: root });
  writeFileSync(path.join(root, 'README.md'), 'fixture\n');
  execFileSync('git', ['add', 'README.md'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'test: fixture'], { cwd: root });
  const workspaceId = workspaceIdForRoot(root);
  const fixtureOwners = owners({
    git: {
      ...owners().git,
      workspaceId,
      branch: 'feature/workflow',
    },
  });
  fixtureOwners.binding.workspaceId = workspaceId;
  fixtureOwners.plan.workspaceId = workspaceId;
  fixtureOwners.declarations[0].workspaceId = workspaceId;
  fixtureOwners.activeWork.workspaceId = workspaceId;
  fixtureOwners.runtime.registration.workspaceId = workspaceId;
  fixtureOwners.rollout.workspaceId = workspaceId;
  const packageModel = {
    repoRoot: root,
    path: path.join(root, PLAN_PATH),
    manifest: {
      planId: fixtureOwners.plan.planId,
      status: 'active',
      binding: {
        branch: fixtureOwners.git.branch,
        workspaceId,
        initialHead: INITIAL_HEAD,
      },
      tasks: [
        {
          id: 'TASK-1',
          path: 'tasks/TASK-1.md',
          status: 'in_progress',
          dependsOn: [],
        },
      ],
    },
    taskSlices: new Map([
      ['TASK-1', { taskId: 'TASK-1', journeyId: 'JOURNEY-1' }],
    ]),
  };
  const sessionStore = {
    state: {
      ...fixtureOwners.session,
      workspaceId,
      currentFailure: null,
      lastVerification: null,
    },
  };
  const snapshot = await loadWorkflowSnapshot(
    {
      workspaceRoot: root,
      now: new Date(OBSERVED_AT),
      machineStatus: {
        registrations: [fixtureOwners.runtime.registration],
        activeLeases: [],
      },
    },
    {
      inspectGitWorkspace() {
        return fixtureOwners.git;
      },
      resolveWorkspacePlanBinding() {
        return fixtureOwners.binding;
      },
      loadPlanPackage() {
        return packageModel;
      },
      readLedger() {
        return {
          declarations: {
            [fixtureOwners.declarations[0].declarationId]:
              fixtureOwners.declarations[0],
          },
        };
      },
      readActiveWorkRecord() {
        return fixtureOwners.activeWork;
      },
      inspectSessionJournal() {
        return { events: [], session: sessionStore };
      },
      readRolloutReceipt() {
        return fixtureOwners.rollout;
      },
    },
  );

  assert.equal(snapshot.verdict, 'HEALTHY');
  assert.equal(snapshot.continuation, 'CONTINUE');
  assert.equal(snapshot.workspaceId, workspaceId);
  assert.equal(Object.hasOwn(snapshot, 'worktreeName'), false);
  assert.equal(Object.hasOwn(snapshot.owners.plan, 'frontier'), false);
  assert.equal(
    Object.hasOwn(snapshot.owners.plan, 'currentCompletionClass'),
    false,
  );
  assert.equal(Object.hasOwn(snapshot.owners.session, 'startedAt'), false);
  assert.equal(Object.hasOwn(snapshot.owners.session, 'timing'), false);
  assert.equal(
    execFileSync('git', ['status', '--porcelain'], {
      cwd: root,
      encoding: 'utf8',
    }),
    '',
  );
});
