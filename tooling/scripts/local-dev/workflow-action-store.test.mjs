import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  MAX_ACTION_RECEIPTS,
  readWorkflowActions,
  readWorkspaceActions,
  recordWorkflowAction,
  reduceWorkflowActivity,
  runWorkflowActionHeartbeat,
  workflowActionPaths,
} from './workflow-action-store.mjs';

const WORKSPACE = '0123456789abcdef';
const BINDING_DIGEST = 'b'.repeat(64);
const PROGRESS = 'c'.repeat(64);

function fixture() {
  const home = mkdtempSync(path.join(tmpdir(), 'workflow-actions-'));
  return {
    home,
    close() {
      rmSync(home, { recursive: true, force: true });
    },
  };
}

function record(home, overrides = {}) {
  return recordWorkflowAction({
    home,
    rootBindingDigest: BINDING_DIGEST,
    actor: {
      host: 'trae',
      bindingDigest: BINDING_DIGEST,
      role: 'OWNER',
      rootBindingDigest: BINDING_DIGEST,
      parentBindingDigest: null,
      assignmentDigest: null,
    },
    binding: {
      workspaceId: WORKSPACE,
      workItemId: 'WORK-1',
      planId: 'PLAN-1',
      taskId: 'TASK-1',
      sessionId: 'SESSION-1',
    },
    operation: {
      family: 'WRITE',
      label: 'apply_patch',
      targetRef: 'apps/dev',
    },
    progressStamp: PROGRESS,
    now: new Date('2026-09-26T00:00:00.000Z'),
    ...overrides,
  });
}

test('records a bounded redacted lifecycle with a verified digest chain', () => {
  const scope = fixture();
  try {
    const started = record(scope.home, { actionId: 'action-1' });
    const heartbeat = record(scope.home, {
      actionId: 'action-1',
      event: 'HEARTBEAT',
      result: 'RUNNING',
      now: new Date('2026-09-26T00:00:05.000Z'),
      operation: {
        family: 'WRITE',
        label: 'apply_patch',
        targetRef: 'apps/dev',
        rawArguments: '--secret must-not-persist',
      },
    });
    const finished = record(scope.home, {
      actionId: 'action-1',
      event: 'FINISHED',
      result: 'PASS',
      durationMs: 9000,
      now: new Date('2026-09-26T00:00:09.000Z'),
    });
    assert.equal(heartbeat.previousDigest, started.digest);
    assert.equal(finished.previousDigest, heartbeat.digest);
    const receipts = readWorkflowActions({
      home: scope.home,
      workspaceId: WORKSPACE,
      rootBindingDigest: BINDING_DIGEST,
    });
    assert.equal(receipts.length, 3);
    assert.equal(JSON.stringify(receipts).includes('must-not-persist'), false);
    assert.deepEqual(
      readWorkspaceActions({
        home: scope.home,
        workspaceId: WORKSPACE,
      }),
      receipts,
    );
  } finally {
    scope.close();
  }
});

test('rejects symlinked stores and invalid operation references', () => {
  const scope = fixture();
  try {
    assert.throws(
      () =>
        record(scope.home, {
          operation: {
            family: 'WRITE',
            label: 'tool',
            targetRef: '../outside',
          },
        }),
      (error) => error.code === 'WORKFLOW_ACTION_INVALID',
    );
    const paths = workflowActionPaths({
      home: scope.home,
      workspaceId: WORKSPACE,
      rootBindingDigest: BINDING_DIGEST,
    });
    record(scope.home);
    rmSync(paths.store);
    symlinkSync('/dev/null', paths.store);
    assert.throws(
      () =>
        readWorkflowActions({
          home: scope.home,
          workspaceId: WORKSPACE,
          rootBindingDigest: BINDING_DIGEST,
        }),
      (error) => error.code === 'WORKFLOW_ACTION_STORE_INVALID',
    );
  } finally {
    scope.close();
  }
});

test('rejects legacy actors and records exact child lineage', () => {
  const scope = fixture();
  try {
    assert.throws(
      () =>
        record(scope.home, {
          actor: {
            host: 'trae',
            bindingDigest: BINDING_DIGEST,
          },
        }),
      (error) => error.code === 'WORKFLOW_ACTION_INVALID',
    );
    const child = record(scope.home, {
      rootBindingDigest: BINDING_DIGEST,
      actor: {
        host: 'trae',
        bindingDigest: 'd'.repeat(64),
        role: 'WORKER',
        rootBindingDigest: BINDING_DIGEST,
        parentBindingDigest: BINDING_DIGEST,
        assignmentDigest: 'e'.repeat(64),
      },
    });
    assert.equal(child.actor.role, 'WORKER');
    assert.equal(child.actor.parentBindingDigest, BINDING_DIGEST);
    assert.equal(child.actor.assignmentDigest, 'e'.repeat(64));
  } finally {
    scope.close();
  }
});

test('interleaved lineage actions retain independent lifecycle state', () => {
  const scope = fixture();
  try {
    record(scope.home, { actionId: 'owner-action' });
    const childActor = {
      host: 'trae',
      bindingDigest: 'd'.repeat(64),
      role: 'WORKER',
      rootBindingDigest: BINDING_DIGEST,
      parentBindingDigest: BINDING_DIGEST,
      assignmentDigest: 'e'.repeat(64),
    };
    record(scope.home, {
      actionId: 'child-action',
      actor: childActor,
      now: new Date('2026-09-26T00:00:01.000Z'),
    });
    const ownerFinished = record(scope.home, {
      actionId: 'owner-action',
      event: 'FINISHED',
      result: 'PASS',
      now: new Date('2026-09-26T00:00:02.000Z'),
    });
    const childFinished = record(scope.home, {
      actionId: 'child-action',
      actor: childActor,
      event: 'FINISHED',
      result: 'PASS',
      now: new Date('2026-09-26T00:00:03.000Z'),
    });
    assert.equal(ownerFinished.sequence, 3);
    assert.equal(childFinished.sequence, 4);
    assert.equal(childFinished.previousDigest, ownerFinished.digest);
  } finally {
    scope.close();
  }
});

test('reduces working, waiting, stalled, looping, blocked, complete, and drift with fixed precedence', () => {
  const scope = fixture();
  try {
    const started = record(scope.home, { actionId: 'working' });
    assert.equal(
      reduceWorkflowActivity([started], {
        now: new Date('2026-09-26T00:00:01.000Z'),
      }).state,
      'working',
    );
    const waiting = record(scope.home, {
      actionId: 'working',
      event: 'HEARTBEAT',
      result: 'WAITING',
      now: new Date('2026-09-26T00:00:02.000Z'),
    });
    assert.equal(
      reduceWorkflowActivity([waiting], {
        now: new Date('2026-09-26T00:00:03.000Z'),
      }).state,
      'waiting',
    );
    assert.equal(
      reduceWorkflowActivity([started], {
        now: new Date('2026-09-26T00:00:41.000Z'),
      }).state,
      'stalled',
    );

    const repeated = Array.from({ length: 4 }, (_, index) => ({
      sequence: index + 1,
      actionId: `repeat-${index}`,
      event: 'FINISHED',
      result: 'PASS',
      operation: { family: 'WRITE', label: 'tool', targetRef: null },
      fingerprint: 'd'.repeat(64),
      progressStamp: PROGRESS,
      at: `2026-09-26T00:01:0${index}.000Z`,
      leaseUntil: null,
    }));
    assert.equal(
      reduceWorkflowActivity(repeated, {
        now: new Date('2026-09-26T00:02:00.000Z'),
      }).state,
      'looping',
    );
    assert.equal(
      reduceWorkflowActivity(repeated, { completed: true }).state,
      'complete',
    );
    assert.equal(
      reduceWorkflowActivity(repeated, {
        blocked: true,
        completed: true,
      }).state,
      'blocked',
    );
    assert.equal(
      reduceWorkflowActivity(repeated, {
        drift: true,
        blocked: true,
      }).state,
      'drift',
    );
  } finally {
    scope.close();
  }
});

test('compacts long streams without exceeding the count budget', () => {
  const scope = fixture();
  try {
    for (let index = 0; index < MAX_ACTION_RECEIPTS + 4; index += 1) {
      const actionId = `bounded-${index}`;
      record(scope.home, {
        actionId,
        event: 'STARTED',
        result: 'RUNNING',
        now: new Date(
          Date.parse('2026-09-26T00:00:00.000Z') + index * 2,
        ),
      });
      record(scope.home, {
        actionId,
        event: 'FINISHED',
        result: 'PASS',
        now: new Date(
          Date.parse('2026-09-26T00:00:00.000Z') + index * 2 + 1,
        ),
      });
    }
    const receipts = readWorkflowActions({
      home: scope.home,
      workspaceId: WORKSPACE,
      rootBindingDigest: BINDING_DIGEST,
    });
    assert.ok(receipts.length > 0 && receipts.length <= MAX_ACTION_RECEIPTS);
    assert.equal(receipts.at(-1).sequence, (MAX_ACTION_RECEIPTS + 4) * 2);
  } finally {
    scope.close();
  }
});

test('heartbeat sidecar extends a live action and terminal PASS becomes waiting', async () => {
  const scope = fixture();
  try {
    const actionId = 'heartbeat-action';
    record(scope.home, { actionId });
    await runWorkflowActionHeartbeat({
      home: scope.home,
      rootBindingDigest: BINDING_DIGEST,
      actor: {
        host: 'trae',
        bindingDigest: BINDING_DIGEST,
        role: 'OWNER',
        rootBindingDigest: BINDING_DIGEST,
        parentBindingDigest: null,
        assignmentDigest: null,
      },
      binding: {
        workspaceId: WORKSPACE,
        workItemId: 'WORK-1',
        planId: 'PLAN-1',
        taskId: 'TASK-1',
        sessionId: 'SESSION-1',
      },
      actionId,
      intervalMs: 1,
      maximumHeartbeats: 1,
    });
    let receipts = readWorkflowActions({
      home: scope.home,
      workspaceId: WORKSPACE,
      rootBindingDigest: BINDING_DIGEST,
    });
    assert.equal(receipts.at(-1).event, 'HEARTBEAT');
    const finished = record(scope.home, {
      actionId,
      event: 'FINISHED',
      result: 'PASS',
    });
    assert.equal(
      reduceWorkflowActivity([finished], { runningPlan: true }).state,
      'waiting',
    );
    await runWorkflowActionHeartbeat({
      home: scope.home,
      workspaceId: WORKSPACE,
      rootBindingDigest: BINDING_DIGEST,
      actionId,
      intervalMs: 1,
      maximumHeartbeats: 1,
    });
    receipts = readWorkflowActions({
      home: scope.home,
      workspaceId: WORKSPACE,
      rootBindingDigest: BINDING_DIGEST,
    });
    assert.equal(receipts.at(-1).event, 'FINISHED');
  } finally {
    scope.close();
  }
});
