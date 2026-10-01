import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

import {
  bindWorkflowOwner,
  claimWorkflowChild,
  createWorkflowBindingAssignment,
  inspectWorkflowBindingLiveness,
  recordWorkflowPreCompact,
  readWorkflowProjectionByActor,
  releaseWorkflowOwner,
  resolveEventWorkflowBinding,
  terminalizeWorkflowChild,
  verifyWorkflowPostCompact,
  workflowOwnerBindingPath,
} from './workflow-binding-store.mjs';
import {
  projectWorkflowBinding,
} from './workflow-binding-projection.mjs';
import {
  updateActiveWorkRecord,
} from './active-work-store.mjs';
import {
  createInitialSessionState,
} from './dev-session-schema.mjs';
import {
  createSessionStore,
} from './dev-session-store.mjs';

const execFileAsync = promisify(execFile);

function fixture() {
  const temporary = mkdtempSync(path.join(tmpdir(), 'workflow-bindings-'));
  const root = path.join(temporary, 'root');
  const home = path.join(temporary, 'home');
  const machineRoot = path.join(home, '.peers-touch', 'dev');
  mkdirSync(root);
  return {
    root,
    home,
    machineRoot,
    close() {
      rmSync(temporary, { recursive: true, force: true });
    },
  };
}

function seedActiveSession(scope, sessionId = 'DEV-SESSION') {
  const workspaceId = ownerProjection(
    bindWorkflowOwner('trae', 'session-seed', scope.root, {
      machineRoot: scope.machineRoot,
      now: new Date('2026-10-01T00:00:00.000Z'),
    }).binding,
  ).workspaceId;
  const workItemId = 'WORK-1';
  const at = '2026-10-01T00:00:00.000Z';
  const state = createInitialSessionState(
    {
      sessionId,
      workItemId,
      planId: 'PLAN-1',
      taskId: 'TASK-1',
      workspaceId,
      branch: 'test',
      journeyId: 'JOURNEY-1',
      executionMode: 'build',
    },
    at,
  );
  createSessionStore(state, {
    home: scope.home,
    workspaceId,
    workItemId,
    now: new Date(at),
  });
  updateActiveWorkRecord(
    {
      workspaceId,
      workItemId,
      planId: 'PLAN-1',
      planPath: 'docs/architecture/test/execution-plans/test/plan.md',
      planStatus: 'active',
      currentTaskId: 'TASK-1',
      currentTaskPath:
        'docs/architecture/test/execution-plans/test/tasks/TASK-1.md',
      taskStatus: 'in_progress',
      sessionId,
      journeyId: 'JOURNEY-1',
      devState: 'BOUND',
      branch: 'test',
      initialHead: '1'.repeat(40),
      expectedHead: '2'.repeat(40),
    },
    {
      home: scope.home,
      workspaceId,
      now: new Date(at),
    },
  );
}

function ownerProjection(owner) {
  return projectWorkflowBinding({ binding: owner });
}

function actor(projection) {
  return {
    host: projection.host,
    bindingDigest: projection.bindingDigest,
    role: projection.role,
    rootBindingDigest: projection.rootBindingDigest,
    parentBindingDigest: projection.parentBindingDigest,
    assignmentDigest: projection.assignmentDigest,
  };
}

test('creates one immutable OWNER without persisting the raw root chat', () => {
  const scope = fixture();
  try {
    const first = bindWorkflowOwner('trae', 'visible-secret', scope.root, {
      machineRoot: scope.machineRoot,
      now: new Date('2026-10-01T00:00:00.000Z'),
    });
    const second = bindWorkflowOwner('trae', 'visible-secret', scope.root, {
      machineRoot: scope.machineRoot,
      now: new Date('2026-10-01T00:00:01.000Z'),
    });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.binding.digest, first.binding.digest);
    const file = workflowOwnerBindingPath(
      'trae',
      'visible-secret',
      { machineRoot: scope.machineRoot },
    );
    assert.equal(file.includes('visible-secret'), false);
    assert.equal(readFileSync(file, 'utf8').includes('visible-secret'), false);
    if (process.platform !== 'win32') {
      assert.equal(lstatSync(file).mode & 0o777, 0o600);
    }
  } finally {
    scope.close();
  }
});

test('OWNER publication survives an interrupted temporary write and concurrent creators', async () => {
  const scope = fixture();
  try {
    const file = workflowOwnerBindingPath('trae', 'concurrent-chat', {
      machineRoot: scope.machineRoot,
    });
    writeFileSync(
      path.join(path.dirname(file), `.${path.basename(file)}.interrupted.tmp`),
      '{"truncated":',
      { mode: 0o600 },
    );
    const moduleUrl = pathToFileURL(
      path.join(
        process.cwd(),
        'tooling/scripts/local-dev/workflow-binding-store.mjs',
      ),
    ).href;
    const script = [
      `import { bindWorkflowOwner } from ${JSON.stringify(moduleUrl)};`,
      'const [root, machineRoot] = process.argv.slice(-2);',
      "const result = bindWorkflowOwner('trae', 'concurrent-chat', root, {",
      '  machineRoot,',
      "  now: new Date('2026-10-01T00:00:00.000Z'),",
      '});',
      'process.stdout.write(result.binding.digest);',
    ].join('\n');
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        execFileAsync(process.execPath, ['--input-type=module', '--eval', script, scope.root, scope.machineRoot]),
      ),
    );
    assert.equal(new Set(results.map((result) => result.stdout)).size, 1);
    assert.doesNotThrow(() => JSON.parse(readFileSync(file, 'utf8')));
  } finally {
    scope.close();
  }
});

test('hard-cut inspection excludes expired and terminal child assignments', () => {
  const scope = fixture();
  try {
    seedActiveSession(scope);
    const owner = bindWorkflowOwner('trae', 'visible-chat', scope.root, {
      machineRoot: scope.machineRoot,
      now: new Date('2026-10-01T00:00:00.000Z'),
    }).binding;
    const assignment = createWorkflowBindingAssignment(
      ownerProjection(owner),
      {
        assignmentId: 'reviewer-1',
        role: 'REVIEWER',
        workflowSessionId: 'DEV-SESSION',
        operationId: 'review-op',
        leaseUntil: '2026-10-01T00:10:00.000Z',
      },
      {
        machineRoot: scope.machineRoot,
        now: new Date('2026-10-01T00:00:01.000Z'),
      },
    ).assignment;
    assert.deepEqual(
      inspectWorkflowBindingLiveness({
        machineRoot: scope.machineRoot,
        now: new Date('2026-10-01T00:00:02.000Z'),
      }).liveAssignments.map((item) => item.assignmentId),
      ['reviewer-1'],
    );

    const child = claimWorkflowChild(
      'trae',
      'reviewer-session',
      owner,
      assignment,
      {
        machineRoot: scope.machineRoot,
        now: new Date('2026-10-01T00:00:03.000Z'),
      },
    ).binding;
    terminalizeWorkflowChild(child, 'PASS', {
      machineRoot: scope.machineRoot,
      now: new Date('2026-10-01T00:00:04.000Z'),
    });
    assert.deepEqual(
      inspectWorkflowBindingLiveness({
        machineRoot: scope.machineRoot,
        now: new Date('2026-10-01T00:00:05.000Z'),
      }).liveAssignments,
      [],
    );
    assert.deepEqual(
      inspectWorkflowBindingLiveness({
        machineRoot: scope.machineRoot,
        now: new Date('2026-10-01T00:11:00.000Z'),
      }).liveAssignments,
      [],
    );
  } finally {
    scope.close();
  }
});

test('one OWNER issues WORKER and REVIEWER children with exact lineage', () => {
  const scope = fixture();
  try {
    seedActiveSession(scope);
    const owner = bindWorkflowOwner('trae', 'visible-chat', scope.root, {
      machineRoot: scope.machineRoot,
      now: new Date('2026-10-01T00:00:00.000Z'),
    }).binding;
    const ownerView = ownerProjection(owner);
    const workerAssignment = createWorkflowBindingAssignment(
      ownerView,
      {
        assignmentId: 'worker-1',
        role: 'WORKER',
        workflowSessionId: 'DEV-SESSION',
        operationId: 'worker-op',
        leaseUntil: '2026-10-01T00:10:00.000Z',
      },
      {
        machineRoot: scope.machineRoot,
        now: new Date('2026-10-01T00:00:01.000Z'),
      },
    ).assignment;
    const reviewerAssignment = createWorkflowBindingAssignment(
      ownerView,
      {
        assignmentId: 'reviewer-1',
        role: 'REVIEWER',
        workflowSessionId: 'DEV-SESSION',
        operationId: 'review-op',
        leaseUntil: '2026-10-01T00:10:00.000Z',
      },
      {
        machineRoot: scope.machineRoot,
        now: new Date('2026-10-01T00:00:01.000Z'),
      },
    ).assignment;
    const worker = claimWorkflowChild(
      'trae',
      'worker-session',
      owner,
      workerAssignment,
      {
        machineRoot: scope.machineRoot,
        now: new Date('2026-10-01T00:00:02.000Z'),
      },
    ).binding;
    const reviewer = claimWorkflowChild(
      'trae',
      'reviewer-session',
      owner,
      reviewerAssignment,
      {
        machineRoot: scope.machineRoot,
        now: new Date('2026-10-01T00:00:02.000Z'),
      },
    ).binding;
    const reviewerRetry = claimWorkflowChild(
      'trae',
      'reviewer-session',
      owner,
      reviewerAssignment,
      {
        machineRoot: scope.machineRoot,
        now: new Date('2026-10-01T00:00:03.000Z'),
      },
    );

    assert.equal(worker.rootBindingDigest, owner.digest);
    assert.equal(worker.parentBindingDigest, owner.digest);
    assert.equal(reviewer.rootBindingDigest, owner.digest);
    assert.equal(reviewer.parentBindingDigest, owner.digest);
    assert.notEqual(worker.digest, reviewer.digest);
    assert.equal(reviewerRetry.created, false);
    assert.equal(reviewerRetry.binding.digest, reviewer.digest);

    const reviewerView = readWorkflowProjectionByActor(
      actor(projectWorkflowBinding({
        binding: reviewer,
        assignment: reviewerAssignment,
        now: new Date('2026-10-01T00:00:03.000Z'),
      })),
      {
        machineRoot: scope.machineRoot,
        now: new Date('2026-10-01T00:00:03.000Z'),
      },
    );
    assert.equal(reviewerView.role, 'REVIEWER');
    assert.equal(reviewerView.childState, 'LEASED');
  } finally {
    scope.close();
  }
});

test('expired or terminal child cannot provide a live claim', () => {
  const scope = fixture();
  try {
    seedActiveSession(scope);
    const owner = bindWorkflowOwner('trae', 'visible-chat', scope.root, {
      machineRoot: scope.machineRoot,
      now: new Date('2026-10-01T00:00:00.000Z'),
    }).binding;
    const assignment = createWorkflowBindingAssignment(
      ownerProjection(owner),
      {
        assignmentId: 'reviewer-stale',
        role: 'REVIEWER',
        workflowSessionId: 'DEV-SESSION',
        operationId: 'review-op',
        leaseUntil: '2026-10-01T00:00:10.000Z',
      },
      {
        machineRoot: scope.machineRoot,
        now: new Date('2026-10-01T00:00:01.000Z'),
      },
    ).assignment;
    const child = claimWorkflowChild(
      'trae',
      'reviewer-session',
      owner,
      assignment,
      {
        machineRoot: scope.machineRoot,
        now: new Date('2026-10-01T00:00:02.000Z'),
      },
    ).binding;
    const childActor = actor(projectWorkflowBinding({
      binding: child,
      assignment,
      now: new Date('2026-10-01T00:00:03.000Z'),
    }));
    assert.equal(
      readWorkflowProjectionByActor(childActor, {
        machineRoot: scope.machineRoot,
        now: new Date('2026-10-01T00:00:11.000Z'),
      }).childState,
      'ASSIGNED',
    );

    const terminal = terminalizeWorkflowChild(child, 'PASS', {
      machineRoot: scope.machineRoot,
      now: new Date('2026-10-01T00:00:04.000Z'),
    });
    assert.equal(
      terminalizeWorkflowChild(child, 'PASS', {
        machineRoot: scope.machineRoot,
        now: new Date('2026-10-01T00:00:05.000Z'),
      }).digest,
      terminal.digest,
    );
    assert.equal(
      readWorkflowProjectionByActor(childActor, {
        machineRoot: scope.machineRoot,
        now: new Date('2026-10-01T00:00:05.000Z'),
      }).childState,
      'TERMINAL',
    );
  } finally {
    scope.close();
  }
});

test('assignment creation requires the exact active Development Session', () => {
  const scope = fixture();
  try {
    seedActiveSession(scope, 'ACTIVE-SESSION');
    const owner = bindWorkflowOwner('trae', 'visible-chat', scope.root, {
      machineRoot: scope.machineRoot,
      now: new Date('2026-10-01T00:00:00.000Z'),
    }).binding;
    assert.throws(
      () =>
        createWorkflowBindingAssignment(
          ownerProjection(owner),
          {
            assignmentId: 'reviewer-invalid',
            role: 'REVIEWER',
            workflowSessionId: 'MISSING-SESSION',
            operationId: 'review-op',
          },
          {
            machineRoot: scope.machineRoot,
            now: new Date('2026-10-01T00:00:01.000Z'),
          },
        ),
      (error) => error.code === 'WORKFLOW_BINDING_SESSION_INVALID',
    );
  } finally {
    scope.close();
  }
});

test('PreCompact persists lineage and PostCompact rejects a changed binding', () => {
  const scope = fixture();
  try {
    const owner = bindWorkflowOwner('trae', 'visible-chat', scope.root, {
      machineRoot: scope.machineRoot,
      now: new Date('2026-10-01T00:00:00.000Z'),
    }).binding;
    const projection = ownerProjection(owner);
    const receipt = recordWorkflowPreCompact(projection, {
      machineRoot: scope.machineRoot,
      now: new Date('2026-10-01T00:00:01.000Z'),
    });
    assert.equal(receipt.bindingDigest, owner.digest);
    assert.equal(
      verifyWorkflowPostCompact(projection, {
        machineRoot: scope.machineRoot,
        now: new Date('2026-10-01T00:00:02.000Z'),
      }).postCompactAt,
      '2026-10-01T00:00:02.000Z',
    );
    recordWorkflowPreCompact(projection, {
      machineRoot: scope.machineRoot,
      now: new Date('2026-10-01T00:00:03.000Z'),
    });
    assert.throws(
      () =>
        verifyWorkflowPostCompact(
          {
            ...projection,
            bindingDigest: 'f'.repeat(64),
          },
          {
            machineRoot: scope.machineRoot,
            now: new Date('2026-10-01T00:00:04.000Z'),
          },
        ),
      (error) => error.code === 'WORKFLOW_COMPACT_LINEAGE_MISMATCH',
    );
  } finally {
    scope.close();
  }
});

test('unassigned TRAE internal session inherits OWNER instead of creating a peer', () => {
  const scope = fixture();
  try {
    const first = resolveEventWorkflowBinding(
      {
        host: 'trae',
        event: 'PRE_TOOL_USE',
        bindingIdentity: {
          rootChatId: 'visible-chat',
          executionSessionId: 'internal-1',
          assignmentId: null,
        },
      },
      scope.root,
      {
        machineRoot: scope.machineRoot,
        now: new Date('2026-10-01T00:00:00.000Z'),
      },
    );
    const second = resolveEventWorkflowBinding(
      {
        host: 'trae',
        event: 'PRE_TOOL_USE',
        bindingIdentity: {
          rootChatId: 'visible-chat',
          executionSessionId: 'internal-2',
          assignmentId: null,
        },
      },
      scope.root,
      {
        machineRoot: scope.machineRoot,
        now: new Date('2026-10-01T00:00:01.000Z'),
      },
    );
    assert.equal(first.projection.role, 'OWNER');
    assert.equal(second.projection.bindingDigest, first.projection.bindingDigest);
    assert.equal(second.projection.executionRoot, first.projection.executionRoot);
  } finally {
    scope.close();
  }
});

test('OWNER release is create-once and conflicting anchors fail closed', () => {
  const scope = fixture();
  try {
    const owner = bindWorkflowOwner('codex', 'owner-session', scope.root, {
      machineRoot: scope.machineRoot,
      now: new Date('2026-10-01T00:00:00.000Z'),
    }).binding;
    const first = releaseWorkflowOwner(owner, 'a'.repeat(64), {
      machineRoot: scope.machineRoot,
      now: new Date('2026-10-01T00:00:01.000Z'),
    });
    assert.equal(
      releaseWorkflowOwner(owner, 'a'.repeat(64), {
        machineRoot: scope.machineRoot,
      }).digest,
      first.digest,
    );
    assert.throws(
      () =>
        releaseWorkflowOwner(owner, 'b'.repeat(64), {
          machineRoot: scope.machineRoot,
        }),
      (error) => error.code === 'WORKFLOW_OWNER_RELEASE_CONFLICT',
    );
  } finally {
    scope.close();
  }
});
