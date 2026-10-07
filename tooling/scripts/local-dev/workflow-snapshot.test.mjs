import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDevSnapshot,
  deriveWorktrees,
  workflowProjection,
} from './workflow-snapshot.mjs';
import {
  projectWorkflowContext,
} from './workflow-snapshot-core.mjs';
import {
  hashWorkflowRootChatIdentity,
} from './workflow-owner-reference.mjs';

test('superseded Plans are terminal without claiming completed review proof', () => {
  const projected = workflowProjection({
    work: [
      {
        state: 'RELEASED',
        plan: {
          status: 'available',
          planId: 'PLAN-OLD',
          planStatus: 'superseded',
          stages: [],
          progress: null,
          task: null,
          session: null,
          sessionErrorCode: null,
          review: {
            state: 'MISSING',
            reviewedAt: null,
            reviewId: null,
          },
        },
      },
    ],
    issues: [],
    freshness: { issues: [] },
    activeWork: null,
    workspaceId: '0123456789abcdef',
    options: {
      now: new Date('2026-09-26T00:00:00.000Z'),
      readActions: () => [],
    },
  });
  assert.equal(projected.workflow.continuation, 'COMPLETE');
  assert.equal(projected.workflow.verdict, 'HEALTHY');
  assert.equal(projected.workflow.review.state, 'MISSING');
});

test('status projection requires the canonical binding projection', () => {
  assert.throws(
    () =>
      projectWorkflowContext(
        {
          executionRoot: '/workspace',
          workspaceId: '0123456789abcdef',
          digest: 'a'.repeat(64),
        },
        { status: 'READY', planPackage: { manifest: { tasks: [] } } },
      ),
    (error) => error.code === 'WORKFLOW_BINDING_PROJECTION_INVALID',
  );

  const projected = projectWorkflowContext(
    {
      kind: 'peers-touch-workflow-binding-projection',
      host: 'trae',
      role: 'OWNER',
      bindingDigest: 'a'.repeat(64),
      rootBindingDigest: 'a'.repeat(64),
      parentBindingDigest: null,
      assignmentDigest: null,
      workflowSessionId: null,
      executionRoot: '/workspace',
      workspaceId: '0123456789abcdef',
      subjectRoots: ['/workspace'],
      toolRoot: '/workspace',
      targetRoots: [],
      released: false,
      childState: null,
    },
    {
      status: 'READY',
      tracked: true,
      branch: 'main',
      head: 'b'.repeat(40),
      binding: { planId: 'PLAN-1', planPath: 'plan.md' },
      declaration: {
        workItemId: 'WORK-1',
        workflowOwner: {
          kind: 'peers-touch-workflow-owner-reference',
          host: 'trae',
          rootChatId: 'main-chat',
          rootChatHash: hashWorkflowRootChatIdentity('trae', 'main-chat'),
          rootBindingDigest: 'a'.repeat(64),
        },
      },
      planPackage: {
        manifest: {
          status: 'active',
          binding: { initialHead: 'c'.repeat(40) },
          tasks: [{ id: 'TASK-1', status: 'in_progress' }],
        },
      },
      currentTask: { taskId: 'TASK-1' },
      session: { state: { state: 'IMPLEMENTING' } },
    },
  );
  assert.equal(projected.binding.role, 'OWNER');
  assert.equal(projected.binding.bindingDigest, 'a'.repeat(64));
  assert.equal(projected.workflowOwner.rootChatId, 'main-chat');
});

test('worktree status exposes creation and current main-session owners', () => {
  const workspaceId = '0123456789abcdef';
  const createdBy = {
    kind: 'peers-touch-workflow-owner-reference',
    host: 'trae',
    rootChatId: 'creator-chat',
    rootChatHash: hashWorkflowRootChatIdentity('trae', 'creator-chat'),
    rootBindingDigest: 'b'.repeat(64),
  };
  const currentOwner = {
    ...createdBy,
    rootChatId: 'current-chat',
    rootChatHash: hashWorkflowRootChatIdentity('trae', 'current-chat'),
    rootBindingDigest: 'd'.repeat(64),
  };
  const [worktree] = deriveWorktrees(
    [],
    [],
    [],
    [],
    [],
    [
      {
        workspaceId,
        name: 'owned-worktree',
        branch: 'feat/owned',
        head: 'e'.repeat(40),
        detached: false,
      },
    ],
    [],
    [],
    '2026-10-07T00:00:00.000Z',
    true,
    { readActions: () => [] },
    [
      {
        workspaceId,
        workflowOwner: currentOwner,
        rootBindingDigest: currentOwner.rootBindingDigest,
        executionRoot: '/workspace/owned',
        boundAt: '2026-10-07T00:00:01.000Z',
        released: false,
      },
    ],
    [
      {
        workspaceId,
        createdBy,
        purpose: 'owned worktree',
      },
    ],
    [],
  );
  assert.deepEqual(worktree.createdBy, createdBy);
  assert.equal(worktree.creation.purpose, 'owned worktree');
  assert.deepEqual(worktree.workflowOwner, currentOwner);
  assert.deepEqual(worktree.workflow.owner, currentOwner);
});

test('registration metadata never substitutes for creation provenance', () => {
  const workspaceId = '0123456789abcdef';
  const inferred = {
    kind: 'peers-touch-workflow-owner-reference',
    host: 'trae',
    rootChatId: 'later-chat',
    rootChatHash: hashWorkflowRootChatIdentity('trae', 'later-chat'),
    rootBindingDigest: 'd'.repeat(64),
  };
  const [worktree] = deriveWorktrees(
    [],
    [
      {
        workspaceId,
        name: 'legacy-worktree',
        branch: 'feat/legacy',
        createdBy: inferred,
      },
    ],
    [],
    [],
    [],
    [
      {
        workspaceId,
        name: 'legacy-worktree',
        branch: 'feat/legacy',
        head: 'e'.repeat(40),
        detached: false,
      },
    ],
    [],
    [],
    '2026-10-07T00:00:00.000Z',
    true,
    { readActions: () => [] },
  );

  assert.equal(worktree.createdBy, null);
});

test('live legacy work without main-session provenance is explicit', () => {
  const workspaceId = '0123456789abcdef';
  const [worktree] = deriveWorktrees(
    [],
    [],
    [
      {
        workspaceId,
        declarationId: `WORK-1-${workspaceId}`,
        workItemId: 'WORK-1',
        sessionId: 'SESSION-1',
        branch: 'feat/legacy',
        owner: 'git@example.invalid',
        purpose: 'legacy work',
        journeyId: null,
        planId: null,
        taskId: null,
        state: 'ACTIVE',
        heartbeatAt: '2026-10-07T00:00:00.000Z',
        expiresAt: '2026-10-07T01:00:00.000Z',
        runtimeClaims: [],
        plan: null,
      },
    ],
    [],
    [],
    [
      {
        workspaceId,
        name: 'legacy-worktree',
        branch: 'feat/legacy',
        head: 'e'.repeat(40),
        detached: false,
      },
    ],
    [],
    [],
    '2026-10-07T00:00:00.000Z',
    true,
    { readActions: () => [] },
  );
  assert.equal(worktree.workflowOwner, null);
  assert.equal(
    worktree.environmentHealth.issues.includes(
      'WORKFLOW_OWNER_SESSION_MISSING',
    ),
    true,
  );
});

test('Plan fallback uses the declaration digest without referencing hidden state', () => {
  const projected = workflowProjection({
    work: [
      {
        state: 'ACTIVE',
        planDigest: 'a'.repeat(64),
        plan: {
          status: 'unavailable',
          errorCode: 'PLAN_UNAVAILABLE',
          review: {
            state: 'MISSING',
            reviewedAt: null,
            reviewId: null,
          },
        },
      },
    ],
    issues: [],
    freshness: { issues: [] },
    activeWork: {
      planId: 'PLAN-1',
      planStatus: 'active',
      currentTaskId: 'TASK-1',
      devState: 'IMPLEMENTING',
      updatedAt: '2026-10-07T00:00:00.000Z',
    },
    workspaceId: '0123456789abcdef',
    options: {
      now: new Date('2026-10-07T00:00:00.000Z'),
      readActions: () => [],
    },
  });

  assert.equal(projected.workflow.plan.digest, 'a'.repeat(64));
  assert.equal(projected.workflow.verdict, 'BLOCKED');
});

test('OWNER binding read errors block the aggregate snapshot', async () => {
  const snapshot = await buildDevSnapshot({
    envRepo: process.cwd(),
    now: new Date('2026-10-07T00:00:00.000Z'),
    discovery: {
      checkedAt: '2026-10-07T00:00:00.000Z',
      records: [],
      error: null,
      available: true,
    },
    observations: { records: [], errors: [] },
    machineStatus: {
      authority: 'available',
      registrations: [],
      activeLeases: [],
      staleLeaseMetadata: [],
      unregisteredObservations: false,
    },
    ledger: { declarations: {} },
    activeWork: { records: [], errors: [] },
    ownerBindings: {
      records: [],
      errors: [
        {
          host: 'trae',
          rootChatHash: 'a'.repeat(64),
          code: 'WORKFLOW_OWNER_BINDING_INVALID',
          message: 'invalid owner binding',
        },
      ],
    },
    worktreeCreations: { records: [], errors: [] },
  });

  assert.equal(snapshot.verdict, 'BLOCKED');
  assert.equal(snapshot.continuation, 'HARD_BLOCK');
  assert.equal(
    snapshot.findings.some(
      (finding) => finding.code === 'WORKFLOW_OWNER_BINDING_INVALID',
    ),
    true,
  );
});
