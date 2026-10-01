import assert from 'node:assert/strict';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  bindWorkflowOwner,
  claimWorkflowChild,
  createWorkflowBindingAssignment,
  readWorkflowProjectionByActor,
  releaseWorkflowOwner,
  resolveEventWorkflowBinding,
  terminalizeWorkflowChild,
  workflowOwnerBindingPath,
} from './workflow-binding-store.mjs';
import {
  projectWorkflowBinding,
} from './workflow-binding-projection.mjs';

function fixture() {
  const temporary = mkdtempSync(path.join(tmpdir(), 'workflow-bindings-'));
  const root = path.join(temporary, 'root');
  const machineRoot = path.join(temporary, 'machine');
  mkdirSync(root);
  return {
    root,
    machineRoot,
    close() {
      rmSync(temporary, { recursive: true, force: true });
    },
  };
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

test('one OWNER issues WORKER and REVIEWER children with exact lineage', () => {
  const scope = fixture();
  try {
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
