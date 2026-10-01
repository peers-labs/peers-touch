import assert from 'node:assert/strict';
import test from 'node:test';

import {
  projectHostBindingIdentity,
  projectWorkflowBinding,
  projectWorkflowEventRoots,
} from './workflow-binding-projection.mjs';

const DIGEST = 'a'.repeat(64);

test('TRAE owner identity uses only chat_session_id', () => {
  const identity = projectHostBindingIdentity('trae', {
    chat_session_id: 'visible-chat',
    session_id: 'internal-session',
    conversation_id: 'must-not-alias',
    workflow_assignment_id: 'assignment-1',
  });
  assert.equal(identity.rootChatId, 'visible-chat');
  assert.equal(identity.executionSessionId, 'internal-session');
  assert.equal(identity.assignmentId, 'assignment-1');

  const missingRoot = projectHostBindingIdentity('trae', {
    session_id: 'internal-session',
  });
  assert.equal(missingRoot.rootChatId, null);
  assert.equal(missingRoot.executionSessionId, 'internal-session');
});

test('Cursor and Codex use only their documented identity fields', () => {
  assert.equal(
    projectHostBindingIdentity('cursor', {
      conversation_id: 'cursor-chat',
      session_id: 'ignored',
    }).rootChatId,
    'cursor-chat',
  );
  assert.equal(
    projectHostBindingIdentity('cursor', {
      conversationId: 'legacy-alias',
    }).rootChatId,
    null,
  );
  assert.equal(
    projectHostBindingIdentity('codex', {
      session_id: 'codex-session',
      conversation_id: 'ignored',
    }).rootChatId,
    'codex-session',
  );
  assert.equal(
    projectHostBindingIdentity('codex', {
      sessionId: 'legacy-alias',
    }).rootChatId,
    null,
  );
});

test('owner projection carries immutable authority and per-event roots', () => {
  const projection = projectWorkflowBinding({
    binding: {
      kind: 'peers-touch-workflow-owner-binding',
      host: 'trae',
      role: 'OWNER',
      executionRoot: '/workspace/owner',
      workspaceId: '0123456789abcdef',
      digest: DIGEST,
    },
    subjectRoots: ['/workspace/read', '/workspace/read'],
    toolRoot: '/workspace/tool',
    targetRoots: ['/workspace/target'],
  });
  assert.equal(projection.role, 'OWNER');
  assert.equal(projection.bindingDigest, DIGEST);
  assert.equal(projection.rootBindingDigest, DIGEST);
  assert.equal(projection.parentBindingDigest, null);
  assert.deepEqual(projection.subjectRoots, ['/workspace/read']);
  assert.equal(projection.toolRoot, '/workspace/tool');
  const next = projectWorkflowEventRoots(projection, {
    subjectRoots: ['/workspace/next'],
    toolRoot: '/workspace/next',
    targetRoots: ['/workspace/next'],
  });
  assert.equal(next.bindingDigest, projection.bindingDigest);
  assert.deepEqual(next.subjectRoots, ['/workspace/next']);
});

test('expired and terminal child projections cannot appear leased', () => {
  const assignment = {
    digest: 'b'.repeat(64),
    rootBindingDigest: DIGEST,
    parentBindingDigest: DIGEST,
    leaseUntil: '2026-10-01T00:00:10.000Z',
  };
  const binding = {
    kind: 'peers-touch-workflow-child-binding',
    host: 'trae',
    role: 'REVIEWER',
    digest: 'c'.repeat(64),
    assignmentDigest: assignment.digest,
    rootBindingDigest: DIGEST,
    parentBindingDigest: DIGEST,
    workflowSessionId: 'SESSION-1',
    executionRoot: '/workspace/owner',
    workspaceId: '0123456789abcdef',
  };
  assert.equal(
    projectWorkflowBinding({
      binding,
      assignment,
      now: new Date('2026-10-01T00:00:11.000Z'),
    }).childState,
    'ASSIGNED',
  );
  assert.equal(
    projectWorkflowBinding({
      binding,
      assignment,
      terminal: true,
      now: new Date('2026-10-01T00:00:01.000Z'),
    }).childState,
    'TERMINAL',
  );
});
