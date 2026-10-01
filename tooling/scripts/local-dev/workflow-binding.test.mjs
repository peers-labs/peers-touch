import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runWorkflowBindingCli,
} from './workflow-binding.mjs';

const OWNER = {
  host: 'trae',
  bindingDigest: 'a'.repeat(64),
  role: 'OWNER',
  rootBindingDigest: 'a'.repeat(64),
  parentBindingDigest: null,
  assignmentDigest: null,
};

test('binding CLI issues one bounded child assignment from the current owner', () => {
  const calls = [];
  const result = runWorkflowBindingCli(
    [
      'assign',
      '--actor',
      JSON.stringify(OWNER),
      '--role',
      'REVIEWER',
      '--workflow-session',
      'SESSION-1',
      '--operation',
      'review-1',
      '--assignment',
      'review-1',
      '--lease-seconds',
      '60',
    ],
    {
      readWorkflowBindingContextByActor: () => ({
        projection: {
          kind: 'peers-touch-workflow-binding-projection',
          ...OWNER,
          executionRoot: '/workspace',
          workspaceId: '0123456789abcdef',
          workflowSessionId: null,
          subjectRoots: [],
          toolRoot: null,
          targetRoots: [],
          released: false,
          childState: null,
        },
      }),
      createWorkflowBindingAssignment: (...args) => {
        calls.push(args);
        return { assignment: { digest: 'b'.repeat(64) }, created: true };
      },
    },
  );
  assert.equal(result.status, 'PASS');
  assert.equal(result.assignment.digest, 'b'.repeat(64));
  assert.equal(calls[0][1].role, 'REVIEWER');
  assert.equal(calls[0][1].leaseMs, 60_000);
});

test('binding CLI refuses to terminalize an owner', () => {
  assert.throws(
    () =>
      runWorkflowBindingCli(
        ['terminal', '--actor', JSON.stringify(OWNER), '--result', 'PASS'],
        {
          readWorkflowBindingContextByActor: () => ({
            projection: { role: 'OWNER' },
          }),
        },
      ),
    (error) => error.code === 'WORKFLOW_BINDING_TERMINAL_INVALID',
  );
});
