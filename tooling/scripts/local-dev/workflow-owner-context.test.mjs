import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { workspaceIdForRoot } from '../lib/machine-dev-paths.mjs';
import {
  bindWorkflowOwner,
} from './workflow-binding-store.mjs';
import { recordWorkflowAction } from './workflow-action-store.mjs';
import {
  resolveCurrentWorkflowOwnerContext,
} from './workflow-owner-context.mjs';

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'pt-owner-context-'));
  const workspaceRoot = path.join(root, 'workspace');
  const home = path.join(root, 'home');
  const machineRoot = path.join(home, '.peers-touch', 'dev');
  mkdirSync(workspaceRoot);
  mkdirSync(home);
  return {
    root,
    workspaceRoot,
    home,
    machineRoot,
    close() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test('resolves the main-session owner from the current workspace action', () => {
  const scope = fixture();
  try {
    const owner = bindWorkflowOwner(
      'trae',
      'main-chat-session',
      scope.workspaceRoot,
      {
        machineRoot: scope.machineRoot,
        now: new Date('2026-10-07T00:00:00.000Z'),
      },
    ).binding;
    const receipt = recordWorkflowAction({
      machineRoot: scope.machineRoot,
      rootBindingDigest: owner.digest,
      actor: {
        host: owner.host,
        bindingDigest: owner.digest,
        role: 'OWNER',
        rootBindingDigest: owner.digest,
        parentBindingDigest: null,
        assignmentDigest: null,
      },
      binding: {
        workspaceId: owner.workspaceId,
        workItemId: null,
        planId: null,
        taskId: null,
        sessionId: null,
      },
      actionId: 'dev-start-action',
      operation: {
        family: 'OWNER_CONTROL',
        label: 'dev-start',
        targetRef: null,
      },
      progressStamp: 'a'.repeat(64),
      now: new Date('2026-10-07T00:00:01.000Z'),
    });

    const context = resolveCurrentWorkflowOwnerContext({
      machineRoot: scope.machineRoot,
      workspaceRoot: scope.workspaceRoot,
      operationLabel: 'dev-start',
      now: new Date('2026-10-07T00:00:02.000Z'),
    });
    assert.equal(context.workflowOwner.rootChatId, 'main-chat-session');
    assert.equal(context.workflowOwner.rootBindingDigest, owner.digest);
    assert.equal(context.actionReceiptDigest, receipt.digest);
  } finally {
    scope.close();
  }
});

test('returns no owner outside an active Hook action', () => {
  const scope = fixture();
  try {
    assert.deepEqual(
      resolveCurrentWorkflowOwnerContext({
        machineRoot: scope.machineRoot,
        workspaceRoot: scope.workspaceRoot,
      }),
      {
        workflowOwner: null,
        actionReceiptDigest: null,
      },
    );
  } finally {
    scope.close();
  }
});

test('does not let a child receipt shadow or impersonate the OWNER action', () => {
  const scope = fixture();
  try {
    const owner = bindWorkflowOwner(
      'trae',
      'main-chat-session',
      scope.workspaceRoot,
      {
        machineRoot: scope.machineRoot,
        now: new Date('2026-10-07T00:00:00.000Z'),
      },
    ).binding;
    const binding = {
      workspaceId: owner.workspaceId,
      workItemId: null,
      planId: null,
      taskId: null,
      sessionId: null,
    };
    const operation = {
      family: 'OWNER_CONTROL',
      label: 'dev-start',
      targetRef: null,
    };
    const ownerReceipt = recordWorkflowAction({
      machineRoot: scope.machineRoot,
      rootBindingDigest: owner.digest,
      actor: {
        host: owner.host,
        bindingDigest: owner.digest,
        role: 'OWNER',
        rootBindingDigest: owner.digest,
        parentBindingDigest: null,
        assignmentDigest: null,
      },
      binding,
      actionId: 'shared-action-id',
      operation,
      progressStamp: 'a'.repeat(64),
      now: new Date('2026-10-07T00:00:01.000Z'),
    });
    recordWorkflowAction({
      machineRoot: scope.machineRoot,
      rootBindingDigest: owner.digest,
      actor: {
        host: owner.host,
        bindingDigest: 'b'.repeat(64),
        role: 'WORKER',
        rootBindingDigest: owner.digest,
        parentBindingDigest: owner.digest,
        assignmentDigest: 'c'.repeat(64),
      },
      binding,
      actionId: 'shared-action-id',
      operation,
      progressStamp: 'd'.repeat(64),
      now: new Date('2026-10-07T00:00:02.000Z'),
    });

    const context = resolveCurrentWorkflowOwnerContext({
      machineRoot: scope.machineRoot,
      workspaceRoot: scope.workspaceRoot,
      operationLabel: 'dev-start',
      now: new Date('2026-10-07T00:00:03.000Z'),
    });
    assert.equal(context.workflowOwner.rootBindingDigest, owner.digest);
    assert.equal(context.actionReceiptDigest, ownerReceipt.digest);
  } finally {
    scope.close();
  }
});

test('same actionId under different OWNER roots remains ambiguous', () => {
  const scope = fixture();
  try {
    const workspaceId = bindWorkflowOwner(
      'trae',
      'main-chat-session',
      scope.workspaceRoot,
      {
        machineRoot: scope.machineRoot,
        now: new Date('2026-10-07T00:00:00.000Z'),
      },
    ).binding.workspaceId;
    const receipt = (rootBindingDigest, at) => ({
      actionId: 'shared-action-id',
      actor: {
        role: 'OWNER',
        bindingDigest: rootBindingDigest,
        rootBindingDigest,
      },
      at,
      binding: { workspaceId },
      operation: {
        family: 'OWNER_CONTROL',
        label: 'dev-start',
      },
      result: 'RUNNING',
      leaseUntil: '2026-10-07T00:01:00.000Z',
    });

    assert.throws(
      () =>
        resolveCurrentWorkflowOwnerContext({
          machineRoot: scope.machineRoot,
          workspaceRoot: scope.workspaceRoot,
          operationLabel: 'dev-start',
          now: new Date('2026-10-07T00:00:03.000Z'),
          readActions: () => [
            receipt('a'.repeat(64), '2026-10-07T00:00:01.000Z'),
            receipt('b'.repeat(64), '2026-10-07T00:00:02.000Z'),
          ],
        }),
      (error) => error?.code === 'WORKFLOW_OWNER_CONTEXT_AMBIGUOUS',
    );
  } finally {
    scope.close();
  }
});

test('child-only action receipts cannot establish OWNER context', () => {
  const scope = fixture();
  try {
    const workspaceId = workspaceIdForRoot(scope.workspaceRoot);
    assert.deepEqual(
      resolveCurrentWorkflowOwnerContext({
        machineRoot: scope.machineRoot,
        workspaceRoot: scope.workspaceRoot,
        operationLabel: 'dev-start',
        now: new Date('2026-10-07T00:00:03.000Z'),
        readActions: () => [
          {
            actionId: 'child-action',
            actor: {
              role: 'WORKER',
              bindingDigest: 'b'.repeat(64),
              rootBindingDigest: 'a'.repeat(64),
            },
            at: '2026-10-07T00:00:01.000Z',
            binding: { workspaceId },
            operation: {
              family: 'OWNER_CONTROL',
              label: 'dev-start',
            },
            result: 'RUNNING',
            leaseUntil: '2026-10-07T00:01:00.000Z',
          },
        ],
      }),
      {
        workflowOwner: null,
        actionReceiptDigest: null,
      },
    );
  } finally {
    scope.close();
  }
});
