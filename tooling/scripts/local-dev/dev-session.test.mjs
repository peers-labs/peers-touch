import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { workspaceIdForRoot } from '../lib/machine-dev-paths.mjs';
import {
  checkDeclaration,
  startOrUpdateDeclaration,
} from './dev-work.mjs';
import {
  DevSessionError,
  readSessionJournal,
  sessionStorePaths,
  startDevelopmentSession,
  statusDevelopmentSession,
  transitionDevelopmentSession,
} from './dev-session.mjs';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);
const BRANCH = 'merge-desktop-prototype';
const INITIAL_HEAD = '3d4e858ce0c8e28969e01a736e2b238269aedb3b';
const EXPECTED_HEAD = '771605c8d768ea3ef73a1b9b1a63befae354292f';
const WORKTREE_SET_DIGEST =
  '4b41b36f2a0a6704e9779efc97495b76bbe1cd0b1427a1d564baf306025281c4';
const WORKSPACE_ID = 'b0a926025d2b25b9';
const START_TIME = Date.parse('2026-09-16T12:00:00.000Z');

function fixture({
  workClass = 'refactor',
  planWorkClass,
  completionClass = 'functional',
  executionMode = 'build',
  runtimeClass = 'source-only',
  gates = [],
  deployProfiles = [],
} = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'pt-dev-session-'));
  const home = path.join(root, 'home');
  let tick = 0;
  const clock = () => new Date(START_TIME + tick++ * 1_000);
  const workItemId = 'dwf-b1';
  const sessionId = 'dwf-b1-session';
  const journeyId = 'DWF-AS03';
  const taskId = 'DWF-B1';
  const task = {
    schemaVersion: 1,
    kind: 'peers-touch-task-slice',
    planId: 'mobile-shell',
    taskId,
    workstreamId: 'DWF-B',
    title: 'Development workflow control plane',
    workClass,
    completionClass,
    executionMode,
    closureId: 'dwf-b1',
    journeyId,
    runtimeClass,
    writeSet: ['tooling/scripts/local-dev'],
    readSet: ['docs/architecture/development-workflow'],
    budgets: {
      focusedCheckSeconds: 30,
      functionalRunSeconds: 30,
      cleanupSeconds: 30,
    },
    checks: [
      {
        id: 'node-test',
        command: 'node --test',
        verificationClass: 'SOURCE_CHECK',
      },
    ],
    doneWhen: ['tests pass'],
    failureBehavior: ['fail closed'],
    updatedAt: '2026-09-16T00:00:00.000Z',
    durableEvidence: [],
  };
  const manifest = {
    schemaVersion: 1,
    kind: 'peers-touch-plan-package',
    planId: 'mobile-shell',
    status: 'active',
    binding: {
      branch: BRANCH,
      workspaceId: WORKSPACE_ID,
      initialHead: INITIAL_HEAD,
      expectedHead: EXPECTED_HEAD,
      worktreeSetDigest: WORKTREE_SET_DIGEST,
    },
    workClass: planWorkClass ?? workClass,
    tasks: [
      {
        id: taskId,
        workstreamId: 'DWF-B',
        path: `tasks/${taskId}.md`,
        dependsOn: [],
        status: 'in_progress',
        blocker: null,
      },
    ],
    authorization: {
      checkpoint: { localCommit: 'allowed', amend: 'denied' },
      delivery: { push: 'denied', pullRequest: 'denied' },
      runtime: { deployProfiles, destructiveResetScopes: [] },
      history: { rewrite: 'denied' },
    },
  };
  const plan = {
    path: path.join(REPO_ROOT, 'fake-plan.md'),
    repoRoot: REPO_ROOT,
    manifest,
    acceptance: {
      schemaVersion: 1,
      closures: { 'dwf-b1': gates },
      completion: [...gates],
      full: [...gates],
    },
    taskSlices: new Map([[taskId, task]]),
    currentTask: task,
    readyTasks: [],
  };
  const dependencies = {
    async loadPlanPackage(_planPath, options) {
      assert.equal(options.repoRoot, REPO_ROOT);
      assert.equal(options.declaration.state, 'ACTIVE');
      return plan;
    },
    async verifyBinding({ repoRoot, binding }) {
      assert.equal(repoRoot, REPO_ROOT);
      assert.equal(binding.initialHead, INITIAL_HEAD);
      assert.equal(binding.expectedHead, EXPECTED_HEAD);
      return {
        root: REPO_ROOT,
        branch: binding.branch,
        workspaceId: binding.workspaceId,
        head: binding.expectedHead,
        worktreeSetDigest: binding.worktreeSetDigest,
      };
    },
  };
  const baseOptions = {
    home,
    workspaceRoot: REPO_ROOT,
    workItemId,
    sessionId,
    planPath: plan.path,
    taskId,
    journeyId,
    clock,
  };
  return {
    root,
    home,
    clock,
    workItemId,
    sessionId,
    task,
    plan,
    dependencies,
    baseOptions,
    close() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function declarationOptions(scope, overrides = {}) {
  return {
    home: scope.home,
    workspaceRoot: REPO_ROOT,
    workItemId: scope.workItemId,
    sessionId: scope.sessionId,
    owner: 'lane-b',
    purpose: 'implement DWF-B1',
    journeyId: scope.task.journeyId,
    branch: BRANCH,
    sourceHead: EXPECTED_HEAD,
    sourceClaims: 'exclusive-write:tooling/scripts/local-dev',
    runtimeClaims: '',
    clock: scope.clock,
    ...overrides,
  };
}

function activateDeclaration(scope) {
  startOrUpdateDeclaration(declarationOptions(scope));
  return checkDeclaration({
    home: scope.home,
    workspaceRoot: REPO_ROOT,
    workItemId: scope.workItemId,
    sessionId: scope.sessionId,
    clock: scope.clock,
  });
}

async function start(scope) {
  activateDeclaration(scope);
  return startDevelopmentSession(scope.baseOptions, scope.dependencies);
}

async function transition(scope, to, updates = {}, overrides = {}) {
  return transitionDevelopmentSession(
    {
      ...scope.baseOptions,
      taskId: undefined,
      journeyId: undefined,
      to,
      reason: `advance to ${to}`,
      updates,
      ...overrides,
    },
    scope.dependencies,
  );
}

function verification(
  verificationClass,
  result,
  id = `${verificationClass.toLowerCase()}-${result.toLowerCase()}`,
) {
  return {
    id,
    verificationClass,
    result,
    startedAt: '2026-09-16T12:00:00.000Z',
    durationMs: 10,
    artifactRefs: [],
  };
}

function sourceCheckpoint() {
  return {
    commit: EXPECTED_HEAD,
    tree: '8'.repeat(40),
    branch: BRANCH,
    clean: true,
    createdAt: '2026-09-16T12:00:00.000Z',
    purpose: 'development-runtime',
  };
}

function failure(stage, owner = 'source', kind = 'SOURCE_CHECK_FAILED') {
  return {
    kind,
    stage,
    owner,
    summary: 'deterministic failure',
    retryable: true,
  };
}

function expectCode(code, operation) {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof DevSessionError);
    assert.equal(error.code, code);
    return true;
  });
}

async function rejectCode(code, operation) {
  await assert.rejects(operation, (error) => {
    assert.ok(error instanceof DevSessionError);
    assert.equal(error.code, code);
    return true;
  });
}

test('start requires an ACTIVE declaration and preserves distinct Plan heads', async () => {
  const scope = fixture();
  try {
    startOrUpdateDeclaration(declarationOptions(scope));
    await rejectCode('WORK_DECLARATION_NOT_ACTIVE', () =>
      startDevelopmentSession(scope.baseOptions, scope.dependencies),
    );
    checkDeclaration({
      home: scope.home,
      workspaceRoot: REPO_ROOT,
      workItemId: scope.workItemId,
      sessionId: scope.sessionId,
      clock: scope.clock,
    });
    const session = await startDevelopmentSession(
      scope.baseOptions,
      scope.dependencies,
    );
    assert.equal(session.state.state, 'BOUND');
    assert.equal(session.state.workspaceId, WORKSPACE_ID);
    assert.notEqual(INITIAL_HEAD, EXPECTED_HEAD);
    assert.equal(workspaceIdForRoot(REPO_ROOT), WORKSPACE_ID);
    const paths = sessionStorePaths({
      home: scope.home,
      workspaceId: WORKSPACE_ID,
      workItemId: scope.workItemId,
    });
    assert.equal(statSync(paths.directory).mode & 0o777, 0o700);
    assert.equal(statSync(paths.session).mode & 0o777, 0o600);
    assert.equal(statSync(paths.events).mode & 0o777, 0o600);
  } finally {
    scope.close();
  }
});

test('Session transition policy follows the current Task work class', async () => {
  const scope = fixture({
    workClass: 'infrastructure',
    planWorkClass: 'product-behavior',
  });
  try {
    const session = await start(scope);
    assert.equal(session.state.state, 'BOUND');
    await transition(scope, 'IMPLEMENTING');
  } finally {
    scope.close();
  }
});

test('start rejects task, journey, declaration scope, and binding mismatch', async () => {
  const taskScope = fixture();
  try {
    activateDeclaration(taskScope);
    await rejectCode('SESSION_IDENTITY_MISMATCH', () =>
      startDevelopmentSession(
        { ...taskScope.baseOptions, taskId: 'DWF-B2' },
        taskScope.dependencies,
      ),
    );
    await rejectCode('SESSION_IDENTITY_MISMATCH', () =>
      startDevelopmentSession(
        { ...taskScope.baseOptions, journeyId: 'DWF-AS04' },
        taskScope.dependencies,
      ),
    );
  } finally {
    taskScope.close();
  }

  const scopeMismatch = fixture();
  try {
    startOrUpdateDeclaration(
      declarationOptions(scopeMismatch, {
        sourceClaims: 'exclusive-write:apps/desktop',
      }),
    );
    checkDeclaration({
      home: scopeMismatch.home,
      workspaceRoot: REPO_ROOT,
      workItemId: scopeMismatch.workItemId,
      sessionId: scopeMismatch.sessionId,
      clock: scopeMismatch.clock,
    });
    await rejectCode('SESSION_SCOPE_MISMATCH', () =>
      startDevelopmentSession(
        scopeMismatch.baseOptions,
        scopeMismatch.dependencies,
      ),
    );
  } finally {
    scopeMismatch.close();
  }

  const bindingScope = fixture();
  try {
    activateDeclaration(bindingScope);
    bindingScope.plan.manifest.binding.expectedHead = '9'.repeat(40);
    await rejectCode('SESSION_IDENTITY_MISMATCH', () =>
      startDevelopmentSession(
        bindingScope.baseOptions,
        bindingScope.dependencies,
      ),
    );
  } finally {
    bindingScope.close();
  }
});

test('build source-only refactor follows its legal completion path', async () => {
  const scope = fixture();
  try {
    await start(scope);
    await rejectCode('SESSION_TRANSITION_INVALID', () =>
      transition(scope, 'REPRODUCING'),
    );
    await transition(scope, 'IMPLEMENTING');
    await transition(scope, 'FOCUSED_CHECKING');
    await rejectCode('SESSION_VERIFICATION_REQUIRED', () =>
      transition(scope, 'FOCUSED_PASS'),
    );
    await transition(scope, 'FOCUSED_PASS', {
      verification: verification('SOURCE_CHECK', 'PASS'),
    });
    await transition(scope, 'FUNCTIONAL_RUNNING');
    await rejectCode('SESSION_VERIFICATION_REQUIRED', () =>
      transition(scope, 'FUNCTIONAL_PASS'),
    );
    await transition(scope, 'FUNCTIONAL_PASS', {
      verification: verification('FUNCTIONAL_CHECK', 'PASS'),
    });
    const complete = await transition(scope, 'DELIVERY_READY');
    assert.equal(complete.state.state, 'DELIVERY_READY');
    await rejectCode('SESSION_TRANSITION_INVALID', () =>
      transition(scope, 'CLEANING'),
    );
  } finally {
    scope.close();
  }
});

test('source completion terminates at SOURCE_READY without functional proof', async () => {
  const scope = fixture({
    workClass: 'product-behavior',
    completionClass: 'source',
  });
  try {
    await start(scope);
    await transition(scope, 'IMPLEMENTING');
    await transition(scope, 'FOCUSED_CHECKING');
    await transition(scope, 'FOCUSED_PASS', {
      verification: verification('SOURCE_CHECK', 'PASS'),
    });
    await rejectCode('SESSION_TRANSITION_INVALID', () =>
      transition(scope, 'FUNCTIONAL_RUNNING'),
    );
    const sourceReady = await transition(scope, 'SOURCE_READY');
    assert.equal(sourceReady.state.state, 'SOURCE_READY');
    await rejectCode('SESSION_TRANSITION_INVALID', () =>
      transition(scope, 'DELIVERY_READY'),
    );
  } finally {
    scope.close();
  }
});

test('fix mode requires reproduction evidence and first-failure ownership', async () => {
  const scope = fixture({ executionMode: 'fix' });
  try {
    await start(scope);
    await transition(scope, 'REPRODUCING');
    await rejectCode('SESSION_VERIFICATION_REQUIRED', () =>
      transition(scope, 'REPRODUCED'),
    );
    await transition(scope, 'REPRODUCED', {
      verification: verification('FUNCTIONAL_CHECK', 'FAIL'),
      failure: failure('REPRODUCING', 'product', 'PRODUCT_ASSERTION_FAILED'),
    });
    const implementing = await transition(scope, 'IMPLEMENTING');
    assert.equal(implementing.state.currentFailure.owner, 'product');
  } finally {
    scope.close();
  }
});

test('runtime and formal Acceptance paths enforce checkpoint and proof fences', async () => {
  const scope = fixture({
    workClass: 'product-behavior',
    runtimeClass: 'service',
    gates: ['development-workflow-control-plane'],
    deployProfiles: ['dwf-local'],
  });
  try {
    await start(scope);
    await transition(scope, 'IMPLEMENTING');
    await transition(scope, 'FOCUSED_CHECKING');
    await transition(scope, 'FOCUSED_PASS', {
      verification: verification('STRUCTURAL_CHECK', 'PASS'),
    });
    await transition(scope, 'CHECKPOINTING');
    await rejectCode('SESSION_CHECKPOINT_REQUIRED', () =>
      transition(scope, 'CHECKPOINTED'),
    );
    await transition(scope, 'CHECKPOINTED', { source: sourceCheckpoint() });
    await transition(scope, 'DEPLOYING');
    await rejectCode('SESSION_RUNTIME_REQUIRED', () =>
      transition(scope, 'DEPLOYED'),
    );
    await transition(scope, 'DEPLOYED', {
      runtimeBindingRef: 'runtime/dwf-local/lease-1',
    });
    await transition(scope, 'FUNCTIONAL_RUNNING');
    await transition(scope, 'FUNCTIONAL_PASS', {
      verification: verification('FUNCTIONAL_CHECK', 'PASS'),
    });
    await transition(scope, 'ACCEPTANCE_READY');
    await transition(scope, 'FINAL_CHECKPOINTED');
    await transition(scope, 'ACCEPTANCE_RUNNING');
    await rejectCode('SESSION_VERIFICATION_REQUIRED', () =>
      transition(scope, 'ACCEPTANCE_PASS'),
    );
    await transition(scope, 'ACCEPTANCE_PASS', {
      verification: verification('ACCEPTANCE_PROOF', 'PASS'),
    });
    assert.equal(
      (await transition(scope, 'DELIVERY_READY')).state.state,
      'DELIVERY_READY',
    );
  } finally {
    scope.close();
  }
});

test('documentation closes after focused checks without a functional claim', async () => {
  const scope = fixture({
    workClass: 'documentation',
    completionClass: 'source',
    runtimeClass: 'source-only',
  });
  try {
    await start(scope);
    await transition(scope, 'IMPLEMENTING');
    await transition(scope, 'FOCUSED_CHECKING');
    await transition(scope, 'FOCUSED_PASS', {
      verification: verification('SOURCE_CHECK', 'PASS'),
    });
    assert.equal(
      (await transition(scope, 'SOURCE_READY')).state.state,
      'SOURCE_READY',
    );
  } finally {
    scope.close();
  }
});

test('acceptance aggregate skips functional execution and requires formal proof', async () => {
  const scope = fixture({
    completionClass: 'acceptance-aggregate',
    gates: ['development-workflow-control-plane'],
  });
  try {
    await start(scope);
    await transition(scope, 'IMPLEMENTING');
    await transition(scope, 'FOCUSED_CHECKING');
    await transition(scope, 'FOCUSED_PASS', {
      verification: verification('STRUCTURAL_CHECK', 'PASS'),
    });
    await rejectCode('SESSION_TRANSITION_INVALID', () =>
      transition(scope, 'FUNCTIONAL_RUNNING'),
    );
    await transition(scope, 'ACCEPTANCE_RUNNING');
    await rejectCode('SESSION_VERIFICATION_REQUIRED', () =>
      transition(scope, 'ACCEPTANCE_PASS'),
    );
    await transition(scope, 'ACCEPTANCE_PASS', {
      verification: verification('ACCEPTANCE_PROOF', 'PASS'),
    });
    assert.equal(
      (await transition(scope, 'DELIVERY_READY')).state.state,
      'DELIVERY_READY',
    );
  } finally {
    scope.close();
  }
});

test('acceptance aggregate requires a non-empty formal Gate closure', async () => {
  const scope = fixture({
    completionClass: 'acceptance-aggregate',
  });
  try {
    await start(scope);
    await transition(scope, 'IMPLEMENTING');
    await transition(scope, 'FOCUSED_CHECKING');
    await transition(scope, 'FOCUSED_PASS', {
      verification: verification('SOURCE_CHECK', 'PASS'),
    });
    await rejectCode('SESSION_TRANSITION_INVALID', () =>
      transition(scope, 'ACCEPTANCE_RUNNING'),
    );
  } finally {
    scope.close();
  }
});

test('failure recovery, cleanup, and cancellation remain explicit', async () => {
  const scope = fixture();
  try {
    await start(scope);
    await transition(scope, 'IMPLEMENTING');
    await transition(scope, 'FAILED', {
      failure: failure('IMPLEMENTING'),
    });
    await rejectCode('SESSION_TRANSITION_INVALID', () =>
      transition(scope, 'IMPLEMENTING'),
    );
    await transition(scope, 'IMPLEMENTING', { failure: null });
    await transition(scope, 'CLEANING', {
      failure: failure('IMPLEMENTING', 'source', 'CANCELLED'),
    });
    const cancelled = await transition(scope, 'CANCELLED');
    assert.equal(cancelled.state.state, 'CANCELLED');
    await rejectCode('SESSION_TRANSITION_INVALID', () =>
      transition(scope, 'BOUND'),
    );
  } finally {
    scope.close();
  }
});

test('replay repairs a journal-ahead snapshot and rejects snapshot-ahead state', async () => {
  const repairScope = fixture();
  try {
    const initial = await start(repairScope);
    await transition(repairScope, 'IMPLEMENTING');
    const paths = sessionStorePaths({
      home: repairScope.home,
      workspaceId: WORKSPACE_ID,
      workItemId: repairScope.workItemId,
    });
    writeFileSync(
      paths.session,
      `${JSON.stringify(initial, null, 2)}\n`,
      { mode: 0o600 },
    );
    const repaired = statusDevelopmentSession({
      home: repairScope.home,
      workspaceRoot: REPO_ROOT,
      workItemId: repairScope.workItemId,
      clock: repairScope.clock,
    });
    assert.equal(repaired.state.state, 'IMPLEMENTING');
    assert.equal(repaired.eventCount, 2);
  } finally {
    repairScope.close();
  }

  const aheadScope = fixture();
  try {
    await start(aheadScope);
    const paths = sessionStorePaths({
      home: aheadScope.home,
      workspaceId: WORKSPACE_ID,
      workItemId: aheadScope.workItemId,
    });
    const snapshot = JSON.parse(readFileSync(paths.session, 'utf8'));
    snapshot.eventCount += 1;
    writeFileSync(paths.session, `${JSON.stringify(snapshot)}\n`);
    expectCode('SESSION_JOURNAL_INVALID', () =>
      statusDevelopmentSession({
        home: aheadScope.home,
        workspaceRoot: REPO_ROOT,
        workItemId: aheadScope.workItemId,
        clock: aheadScope.clock,
      }),
    );
  } finally {
    aheadScope.close();
  }
});

test('journal corruption is rejected without snapshot replacement', async () => {
  const scope = fixture();
  try {
    await start(scope);
    const paths = sessionStorePaths({
      home: scope.home,
      workspaceId: WORKSPACE_ID,
      workItemId: scope.workItemId,
    });
    const event = JSON.parse(readFileSync(paths.events, 'utf8').trim());
    event.reason = 'tampered';
    writeFileSync(paths.events, `${JSON.stringify(event)}\n`);
    const before = readFileSync(paths.session, 'utf8');
    expectCode('SESSION_JOURNAL_INVALID', () =>
      statusDevelopmentSession({
        home: scope.home,
        workspaceRoot: REPO_ROOT,
        workItemId: scope.workItemId,
        clock: scope.clock,
      }),
    );
    assert.equal(readFileSync(paths.session, 'utf8'), before);
  } finally {
    scope.close();
  }
});

test('compaction preserves the prior digest and continuing sequence', async () => {
  const scope = fixture();
  try {
    await start(scope);
    await transition(scope, 'IMPLEMENTING', {}, { maxEvents: 2 });
    const before = readSessionJournal({
      home: scope.home,
      workspaceRoot: REPO_ROOT,
      workItemId: scope.workItemId,
      clock: scope.clock,
    });
    const priorDigest = before.events.at(-1).eventDigest;
    await transition(scope, 'FOCUSED_CHECKING', {}, { maxEvents: 2 });
    let journal = readSessionJournal({
      home: scope.home,
      workspaceRoot: REPO_ROOT,
      workItemId: scope.workItemId,
      clock: scope.clock,
    });
    assert.equal(journal.events.length, 1);
    assert.equal(journal.events[0].kind, 'COMPACTED_BASELINE');
    assert.equal(journal.events[0].sequence, 3);
    assert.equal(journal.events[0].compactedThrough, 3);
    assert.equal(journal.events[0].previousDigest, priorDigest);
    await transition(
      scope,
      'FOCUSED_PASS',
      { verification: verification('SOURCE_CHECK', 'PASS') },
      { maxEvents: 2 },
    );
    journal = readSessionJournal({
      home: scope.home,
      workspaceRoot: REPO_ROOT,
      workItemId: scope.workItemId,
      clock: scope.clock,
    });
    assert.deepEqual(
      journal.events.map((event) => event.sequence),
      [3, 4],
    );
    assert.equal(
      journal.events[1].previousDigest,
      journal.events[0].eventDigest,
    );
  } finally {
    scope.close();
  }
});

test('status rejects Session identity mismatch', async () => {
  const scope = fixture();
  try {
    await start(scope);
    expectCode('SESSION_IDENTITY_MISMATCH', () =>
      statusDevelopmentSession({
        home: scope.home,
        workspaceRoot: REPO_ROOT,
        workItemId: scope.workItemId,
        taskId: 'DWF-B2',
        clock: scope.clock,
      }),
    );
  } finally {
    scope.close();
  }
});

test('direct and symlinked Session CLI invocations both execute', async () => {
  const scope = fixture();
  try {
    await start(scope);
    const cli = fileURLToPath(new URL('./dev-session.mjs', import.meta.url));
    const link = path.join(scope.root, 'dev-session-link.mjs');
    symlinkSync(cli, link);
    assert.ok(lstatSync(link).isSymbolicLink());
    for (const entrypoint of [cli, link]) {
      const result = spawnSync(
        process.execPath,
        [
          entrypoint,
          'status',
          '--home',
          scope.home,
          '--workspace-root',
          REPO_ROOT,
          '--work-item',
          scope.workItemId,
        ],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            DEVELOPER_DIR: '/Library/Developer/CommandLineTools',
          },
        },
      );
      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.status, 'PASS');
      assert.equal(payload.session.state.state, 'BOUND');
    }
  } finally {
    scope.close();
  }
});
