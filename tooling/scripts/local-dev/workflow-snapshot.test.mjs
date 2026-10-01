import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildDevSnapshot,
  deriveWorktrees as canonicalDeriveWorktrees,
} from '../../../apps/dev/server/status.mjs';
import {
  buildWorkflowSnapshot,
  deriveWorktrees,
  workflowProjection,
} from './workflow-snapshot.mjs';
import {
  projectWorkflowContext,
} from './workflow-snapshot-core.mjs';

test('Workflow Snapshot is a thin projection over the Peers Dev owner', async () => {
  const envRepo = mkdtempSync(path.join(tmpdir(), 'workflow-snapshot-env-'));
  try {
    const options = {
      envRepo,
      now: new Date('2026-09-26T00:00:00.000Z'),
      machineStatus: {
        authority: 'machine-control-plane',
        registrations: [],
        activeLeases: [],
        unregisteredObservations: null,
      },
      discovery: {
        checkedAt: '2026-09-26T00:00:00.000Z',
        records: [],
        error: null,
        available: true,
      },
      observations: { records: [], errors: [] },
      ledger: { declarations: {} },
      activeWork: { records: [], errors: [] },
    };
    assert.equal(deriveWorktrees, canonicalDeriveWorktrees);
    assert.deepEqual(
      await buildWorkflowSnapshot(options),
      await buildDevSnapshot(options),
    );
  } finally {
    rmSync(envRepo, { recursive: true, force: true });
  }
});

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
      declaration: { workItemId: 'WORK-1' },
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
});
