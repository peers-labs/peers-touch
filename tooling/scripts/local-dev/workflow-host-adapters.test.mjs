import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeHostPayload,
  renderHostFailure,
  renderHostResponse,
} from './workflow-host-adapters.mjs';

test('normalizes Cursor without confusing tool cwd with execution roots', () => {
  const event = normalizeHostPayload(
    {
      conversation_id: 'conversation-1',
      workspace_roots: ['/workspace/a', '/workspace/b'],
      cwd: '/workspace/a',
      tool_name: 'Shell',
      tool_input: {
        command: 'git status',
        working_directory: '/workspace/b',
      },
    },
    {
      host: 'cursor',
      event: 'preToolUse',
      installationRoot: '/workspace/a',
    },
  );
  assert.equal(event.valid, true);
  assert.equal(event.event, 'PRE_TOOL_USE');
  assert.equal(event.stableConversationId, 'conversation-1');
  assert.equal(event.executionRootHints[0], '/workspace/a');
  assert.equal(event.toolWorkingDirectory, '/workspace/b');
});

test('normalizes TRAE session identity and hook names', () => {
  const event = normalizeHostPayload(
    {
      hook_event_name: 'PreToolUse',
      session_id: 'session-1',
      repo_working_dir: '/workspace',
      tool_name: 'Read',
      tool_input: { file_path: '/other/README.md' },
    },
    { host: 'trae' },
  );
  assert.equal(event.valid, true);
  assert.equal(event.event, 'PRE_TOOL_USE');
  assert.equal(event.stableConversationId, 'session-1');
  assert.equal(event.executionRootHints[0], '/workspace');
});

test('ignores interaction overlays that try to widen execution policy', () => {
  const event = normalizeHostPayload(
    {
      session_id: 'session-1',
      repo_working_dir: '/workspace/bound',
      tool_name: 'Write',
      tool_input: { file_path: '/workspace/other/file.txt' },
      user_overlay: {
        executionRoot: '/workspace/other',
        sourceClaims: [{ mode: 'exclusive-write', pathPrefix: '.' }],
        authorization: { history: { rewrite: 'allowed' } },
      },
    },
    {
      host: 'trae',
      event: 'PreToolUse',
      installationRoot: '/workspace/bound',
    },
  );

  assert.equal(event.valid, true);
  assert.deepEqual(event.executionRootHints, ['/workspace/bound']);
  assert.equal(event.toolInput.file_path, '/workspace/other/file.txt');
  assert.equal('userOverlay' in event, false);
  assert.equal('authorization' in event, false);
});

test('rejects conflicting host conversation identifiers', () => {
  const event = normalizeHostPayload(
    {
      conversation_id: 'conversation-1',
      session_id: 'session-2',
    },
    { host: 'cursor', event: 'preToolUse' },
  );
  assert.equal(event.valid, false);
  assert.equal(event.code, 'HOST_CONVERSATION_ID_AMBIGUOUS');
});

test('renders Cursor permission and continuation responses', () => {
  const normalized = { event: 'PRE_TOOL_USE', hostEvent: 'preToolUse' };
  assert.deepEqual(
    renderHostResponse(
      'cursor',
      { action: 'DENY', code: 'DENIED', reason: 'blocked' },
      normalized,
    ),
    {
      permission: 'deny',
      user_message: 'DENIED: blocked',
      agent_message: 'DENIED: blocked',
    },
  );
  assert.deepEqual(
    renderHostResponse(
      'cursor',
      {
        action: 'CONTINUE',
        code: 'ANCHOR',
        reason: 'continue',
        followupMessage: 'rendered',
      },
      { event: 'STOP', hostEvent: 'stop' },
    ),
    { followup_message: 'rendered' },
  );
  assert.deepEqual(
    renderHostResponse(
      'cursor',
      { action: 'DENY', code: 'INVALID', reason: 'ambiguous identity' },
      { event: 'BEFORE_PROMPT', hostEvent: 'beforeSubmitPrompt' },
    ),
    {
      continue: false,
      user_message: 'INVALID: ambiguous identity',
    },
  );
});

test('renders Claude-compatible TRAE and Codex responses', () => {
  assert.deepEqual(
    renderHostResponse(
      'trae',
      { action: 'DENY', code: 'DENIED', reason: 'blocked' },
      { event: 'PRE_TOOL_USE', hostEvent: 'PreToolUse' },
    ),
    {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'DENIED: blocked',
      },
    },
  );
  assert.deepEqual(
    renderHostFailure('codex', 'Stop', new Error('broken')),
    {
      decision: 'block',
      reason: 'PT_EW_PLUGIN_FAILURE: broken',
    },
  );
  assert.deepEqual(
    renderHostFailure('cursor', 'beforeSubmitPrompt', new Error('broken')),
    {
      continue: false,
      user_message: 'PT_EW_PLUGIN_FAILURE: broken',
    },
  );
});

test('normalizes PostToolUse action identity for terminal receipts', () => {
  const event = normalizeHostPayload(
    {
      session_id: 'session-1',
      tool_use_id: 'tool-call-1',
      repo_working_dir: '/workspace',
      tool_name: 'Write',
      tool_input: { file_path: '/workspace/file.txt' },
    },
    { host: 'trae', event: 'PostToolUse' },
  );
  assert.equal(event.valid, true);
  assert.equal(event.event, 'POST_TOOL_USE');
  assert.equal(event.actionId, 'tool-call-1');
});
