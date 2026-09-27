import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ActiveWorkError,
  activeWorkStorePaths,
  clearActiveWorkRecord,
  digestActiveWork,
  readActiveWorkRecord,
  readAllActiveWorkRecords,
  updateActiveWorkRecord,
} from './active-work-store.mjs';
import {
  deriveActiveWorkInput,
  syncActiveWork,
} from './active-work.mjs';
import { processStartIdentity } from './dev-work-ledger.mjs';
import {
  repoRoot,
  workspaceIdForRoot,
} from '../lib/machine-dev-paths.mjs';

const WORKSPACE_A = workspaceIdForRoot(repoRoot);
const WORKSPACE_B = 'fedcba9876543210';
const NOW = '2026-09-19T08:00:00.000Z';

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'pt-active-work-'));
  const home = path.join(root, 'home');
  mkdirSync(home, { recursive: true });
  return {
    root,
    home,
    close() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function input(workspaceId = WORKSPACE_A, overrides = {}) {
  return {
    workspaceId,
    workItemId: 'DWF-ACTIVE-WORK',
    planId: 'DWF-PLAN',
    planPath: 'docs/architecture/example/execution-plans/test/plan.md',
    planStatus: 'active',
    currentTaskId: 'DWF-T1',
    currentTaskPath:
      'docs/architecture/example/execution-plans/test/tasks/DWF-T1.md',
    taskStatus: 'in_progress',
    sessionId: 'dwf-active-work-session',
    journeyId: 'DWF-J01',
    devState: 'IMPLEMENTING',
    branch: 'feature/workspace-active-work',
    initialHead: '1'.repeat(40),
    expectedHead: '2'.repeat(40),
    ...overrides,
  };
}

function expectCode(code, operation) {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof ActiveWorkError);
    assert.equal(error.code, code);
    return true;
  });
}

function ownerDependencies(overrides = {}) {
  const declaration = {
    declarationId: `DWF-ACTIVE-WORK-${WORKSPACE_A}`,
    workItemId: 'DWF-ACTIVE-WORK',
    sessionId: 'dwf-active-work-session',
    workspaceId: WORKSPACE_A,
    branch: 'feature/workspace-active-work',
    sourceHead: '2'.repeat(40),
    owner: 'test@example.invalid',
    purpose: 'test active-work projection',
    journeyId: 'DWF-J01',
    state: 'ACTIVE',
    createdAt: '2026-09-19T07:00:00.000Z',
    heartbeatAt: '2026-09-19T07:30:00.000Z',
    expiresAt: '2026-09-19T09:00:00.000Z',
    sourceClaims: [],
    runtimeClaims: [],
    planPath: 'docs/architecture/example/execution-plans/test/plan.md',
    planId: 'DWF-PLAN',
    taskId: 'DWF-T1',
    declarationDigest: 'f'.repeat(64),
  };
  return {
    workspaceRoot: repoRoot,
    workspaceId: WORKSPACE_A,
    gitHead: '2'.repeat(40),
    async resolveWorkspacePlanBinding() {
      return {
        workspaceId: WORKSPACE_A,
        planId: 'DWF-PLAN',
        planPath: declaration.planPath,
      };
    },
    async loadPlanPackage() {
      return {
        manifest: {
          planId: 'DWF-PLAN',
          status: 'active',
          binding: {
            workspaceId: WORKSPACE_A,
            branch: declaration.branch,
            initialHead: '1'.repeat(40),
          },
          tasks: [
            {
              id: 'DWF-T1',
              path: 'tasks/DWF-T1.md',
              status: 'in_progress',
            },
          ],
        },
        taskSlices: new Map([
          ['DWF-T1', { journeyId: 'DWF-J01' }],
        ]),
      };
    },
    readLedger() {
      return {
        declarations: {
          [`DWF-ACTIVE-WORK-${WORKSPACE_A}`]: declaration,
        },
      };
    },
    statusDevelopmentSession() {
      return { state: { state: 'IMPLEMENTING' } };
    },
    ...overrides,
  };
}

test('writes one owner-only record per workspace with revision and digest', () => {
  const scope = fixture();
  try {
    const record = updateActiveWorkRecord(input(), {
      home: scope.home,
      now: new Date(NOW),
      expectedRevision: 0,
    });
    const paths = activeWorkStorePaths({
      home: scope.home,
      workspaceId: WORKSPACE_A,
    });
    assert.equal(record.revision, 1);
    assert.equal(record.recordDigest, digestActiveWork(record));
    assert.equal(statSync(paths.record).mode & 0o777, 0o600);
    assert.equal(statSync(path.dirname(paths.record)).mode & 0o777, 0o700);
    assert.deepEqual(readActiveWorkRecord({
      home: scope.home,
      workspaceId: WORKSPACE_A,
    }), record);

    const idempotent = updateActiveWorkRecord(input(), {
      home: scope.home,
      now: new Date('2026-09-19T08:01:00.000Z'),
      expectedRevision: 1,
    });
    assert.deepEqual(idempotent, record);
  } finally {
    scope.close();
  }
});

test('isolates concurrent Goals by workspace-owned record path', () => {
  const scope = fixture();
  try {
    const first = updateActiveWorkRecord(input(WORKSPACE_A), {
      home: scope.home,
      now: new Date(NOW),
    });
    const second = updateActiveWorkRecord(
      input(WORKSPACE_B, {
        workItemId: 'CHAT-GROUP',
        planId: 'CHAT-PLAN',
        currentTaskId: 'CHAT-T1',
        sessionId: 'chat-group-session',
        journeyId: 'CHAT-J01',
        branch: 'feature/chat-group',
        planPath: 'docs/architecture/chat/execution-plans/group/plan.md',
        currentTaskPath:
          'docs/architecture/chat/execution-plans/group/tasks/CHAT-T1.md',
      }),
      {
        home: scope.home,
        now: new Date('2026-09-19T08:00:01.000Z'),
      },
    );

    assert.notEqual(
      activeWorkStorePaths({
        home: scope.home,
        workspaceId: WORKSPACE_A,
      }).record,
      activeWorkStorePaths({
        home: scope.home,
        workspaceId: WORKSPACE_B,
      }).record,
    );
    assert.equal(readActiveWorkRecord({
      home: scope.home,
      workspaceId: WORKSPACE_A,
    }).workItemId, first.workItemId);
    assert.equal(readActiveWorkRecord({
      home: scope.home,
      workspaceId: WORKSPACE_B,
    }).workItemId, second.workItemId);
    assert.deepEqual(
      readAllActiveWorkRecords({ home: scope.home }).records.map(
        (record) => record.workspaceId,
      ),
      [WORKSPACE_A, WORKSPACE_B],
    );
  } finally {
    scope.close();
  }
});

test('distributed code derives state from each consuming worktree root', () => {
  const scope = fixture();
  try {
    const consumerA = path.join(scope.root, 'consumer-a');
    const consumerB = path.join(scope.root, 'consumer-b');
    const workflowSource = path.join(scope.root, 'workflow-source');
    mkdirSync(consumerA);
    mkdirSync(consumerB);
    mkdirSync(workflowSource);
    const workspaceA = workspaceIdForRoot(consumerA);
    const workspaceB = workspaceIdForRoot(consumerB);
    const sourceWorkspace = workspaceIdForRoot(workflowSource);
    const recordA = updateActiveWorkRecord(
      input(workspaceA, { workItemId: 'CONSUMER-A' }),
      {
        home: scope.home,
        workspaceRoot: consumerA,
        now: new Date(NOW),
      },
    );
    const recordB = updateActiveWorkRecord(
      input(workspaceB, { workItemId: 'CONSUMER-B' }),
      {
        home: scope.home,
        workspaceRoot: consumerB,
        now: new Date(NOW),
      },
    );

    assert.notEqual(workspaceA, workspaceB);
    const pathA = activeWorkStorePaths({
      home: scope.home,
      workspaceRoot: consumerA,
    }).record;
    const pathB = activeWorkStorePaths({
      home: scope.home,
      workspaceRoot: consumerB,
    }).record;
    const sourcePath = activeWorkStorePaths({
      home: scope.home,
      workspaceRoot: workflowSource,
    }).record;
    assert.notEqual(pathA, pathB);
    assert.equal(recordA.workspaceId, workspaceA);
    assert.equal(recordB.workspaceId, workspaceB);
    assert.equal(existsSync(pathA), true);
    assert.equal(existsSync(pathB), true);
    assert.equal(existsSync(sourcePath), false);
    assert.equal(readActiveWorkRecord({
      home: scope.home,
      workspaceId: sourceWorkspace,
    }), null);
    expectCode('ACTIVE_WORK_WORKSPACE_MISMATCH', () =>
      updateActiveWorkRecord(input(workspaceB), {
        home: scope.home,
        workspaceRoot: consumerA,
        now: new Date(NOW),
      }),
    );
  } finally {
    scope.close();
  }
});

test('rejects stale revisions and cross-owner clear attempts', () => {
  const scope = fixture();
  try {
    updateActiveWorkRecord(input(), {
      home: scope.home,
      now: new Date(NOW),
    });
    expectCode('ACTIVE_WORK_REVISION_MISMATCH', () =>
      updateActiveWorkRecord(input(WORKSPACE_A, { devState: 'FOCUSED_CHECKING' }), {
        home: scope.home,
        expectedRevision: 0,
      }),
    );
    expectCode('ACTIVE_WORK_OWNER_MISMATCH', () =>
      clearActiveWorkRecord({
        home: scope.home,
        workspaceId: WORKSPACE_A,
        expectedRevision: 1,
        workItemId: 'OTHER-WORK',
      }),
    );
    const cleared = clearActiveWorkRecord({
      home: scope.home,
      workspaceId: WORKSPACE_A,
      expectedRevision: 1,
      workItemId: 'DWF-ACTIVE-WORK',
    });
    assert.equal(cleared.revision, 1);
    assert.equal(readActiveWorkRecord({
      home: scope.home,
      workspaceId: WORKSPACE_A,
    }), null);
  } finally {
    scope.close();
  }
});

test('rejects symlink and malformed records without hiding healthy workspaces', () => {
  const scope = fixture();
  try {
    updateActiveWorkRecord(input(WORKSPACE_A), {
      home: scope.home,
      now: new Date(NOW),
    });
    const brokenPaths = activeWorkStorePaths({
      home: scope.home,
      workspaceId: WORKSPACE_B,
    });
    mkdirSync(path.dirname(brokenPaths.record), { recursive: true, mode: 0o700 });
    writeFileSync(brokenPaths.record, '{not-json\n', { mode: 0o600 });

    const aggregate = readAllActiveWorkRecords({ home: scope.home });
    assert.equal(aggregate.records.length, 1);
    assert.equal(aggregate.records[0].workspaceId, WORKSPACE_A);
    assert.deepEqual(aggregate.errors.map((error) => error.workspaceId), [
      WORKSPACE_B,
    ]);

    rmSync(brokenPaths.record);
    const outside = path.join(scope.root, 'outside.json');
    writeFileSync(outside, `${JSON.stringify(input(WORKSPACE_B))}\n`);
    symlinkSync(outside, brokenPaths.record);
    expectCode('ACTIVE_WORK_INVALID', () =>
      readActiveWorkRecord({
        home: scope.home,
        workspaceId: WORKSPACE_B,
      }),
    );
  } finally {
    scope.close();
  }
});

test('recovers a stale lock and refuses a live writer lock', () => {
  const scope = fixture();
  try {
    const paths = activeWorkStorePaths({
      home: scope.home,
      workspaceId: WORKSPACE_A,
    });
    mkdirSync(path.dirname(paths.lock), { recursive: true, mode: 0o700 });
    writeFileSync(
      paths.lock,
      `${JSON.stringify({
        pid: 999999,
        processStart: 'stale-process',
        createdAt: NOW,
      })}\n`,
      { mode: 0o600 },
    );
    assert.equal(
      updateActiveWorkRecord(input(), {
        home: scope.home,
        now: new Date(NOW),
      }).revision,
      1,
    );

    writeFileSync(
      paths.lock,
      `${JSON.stringify({
        pid: process.pid,
        processStart: processStartIdentity(),
        createdAt: NOW,
      })}\n`,
      { mode: 0o600 },
    );
    expectCode('ACTIVE_WORK_LOCKED', () =>
      updateActiveWorkRecord(input(WORKSPACE_A, { devState: 'FOCUSED_CHECKING' }), {
        home: scope.home,
        lockTimeoutMs: 1,
      }),
    );
    chmodSync(paths.lock, 0o600);
  } finally {
    scope.close();
  }
});

test('detects digest tampering', () => {
  const scope = fixture();
  try {
    updateActiveWorkRecord(input(), {
      home: scope.home,
      now: new Date(NOW),
    });
    const paths = activeWorkStorePaths({
      home: scope.home,
      workspaceId: WORKSPACE_A,
    });
    const record = JSON.parse(readFileSync(paths.record, 'utf8'));
    record.currentTaskId = 'DWF-T2';
    writeFileSync(paths.record, `${JSON.stringify(record)}\n`);
    expectCode('ACTIVE_WORK_INVALID', () =>
      readActiveWorkRecord({
        home: scope.home,
        workspaceId: WORKSPACE_A,
      }),
    );
  } finally {
    scope.close();
  }
});

test('derives the projection from Plan, declaration, Task, Session and Git owners', async () => {
  const scope = fixture();
  try {
    const dependencies = ownerDependencies();
    assert.deepEqual(
      await deriveActiveWorkInput(
        {
          home: scope.home,
          workItemId: 'DWF-ACTIVE-WORK',
          now: new Date(NOW),
        },
        dependencies,
      ),
      input(),
    );
    const synced = await syncActiveWork(
      {
        home: scope.home,
        workItemId: 'DWF-ACTIVE-WORK',
        now: new Date(NOW),
      },
      dependencies,
    );
    assert.equal(synced.revision, 1);
    assert.equal(synced.devState, 'IMPLEMENTING');
  } finally {
    scope.close();
  }
});

test('rejects owner disagreement instead of projecting guessed progress', async () => {
  const scope = fixture();
  try {
    await assert.rejects(
      deriveActiveWorkInput(
        {
          home: scope.home,
          workItemId: 'DWF-ACTIVE-WORK',
          now: new Date(NOW),
        },
        ownerDependencies({ gitHead: '3'.repeat(40) }),
      ),
      (error) => {
        assert.ok(error instanceof ActiveWorkError);
        assert.equal(error.code, 'ACTIVE_WORK_OWNER_MISMATCH');
        assert.deepEqual(error.detail.mismatches.sourceHead, {
          expected: '3'.repeat(40),
          actual: '2'.repeat(40),
        });
        return true;
      },
    );
  } finally {
    scope.close();
  }
});
