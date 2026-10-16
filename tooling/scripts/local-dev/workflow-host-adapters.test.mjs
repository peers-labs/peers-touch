import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeHostPayload,
  renderHostFailure,
  renderHostResponse,
} from './workflow-host-adapters.mjs';

test('FLOW-A04 normalizes workspace context without constructing OWNER authority', () => {
  const normalized = normalizeHostPayload(
    {
      hook_event_name: 'PreToolUse',
      tool_name: 'apply_patch',
      tool_input: { file_path: '/workspace/file.ts' },
      chat_session_id: 'must-not-be-authority',
    },
    {
      host: 'trae',
      event: 'PreToolUse',
      workspaceRoots: ['/workspace'],
    },
  );
  assert.equal(normalized.valid, true);
  assert.equal(normalized.event, 'PRE_TOOL_USE');
  assert.equal(Object.hasOwn(normalized, 'bindingIdentity'), false);
  assert.equal(Object.hasOwn(normalized, 'toolName'), false);
  assert.equal(Object.hasOwn(normalized, 'toolInput'), false);
});

test('FLOW-A04 unknown host events normalize to an ignorable payload', () => {
  const normalized = normalizeHostPayload(
    { hook_event_name: 'FutureEvent' },
    { host: 'trae', event: 'FutureEvent' },
  );
  assert.equal(normalized.valid, false);
  assert.equal(normalized.code, 'HOOK_PAYLOAD_INVALID');
});

test('FLOW-A04 host rendering can attach context but never needs a permission grant', () => {
  const response = renderHostResponse(
    'trae',
    {
      action: 'CONTEXT',
      additionalContext: 'Read project workflow.',
    },
    {
      hostEvent: 'UserPromptSubmit',
      event: 'BEFORE_PROMPT',
    },
  );
  assert.equal(
    response.hookSpecificOutput.additionalContext,
    'Read project workflow.',
  );
});

test('FLOW-A04 adapter failures are neutral for every event', () => {
  for (const event of ['PreToolUse', 'Stop', 'FutureEvent']) {
    const response = renderHostFailure(
      'trae',
      event,
      new Error('optional context failed'),
    );
    assert.equal(response.decision, undefined);
    assert.notEqual(
      response.hookSpecificOutput?.permissionDecision,
      'deny',
    );
  }
});
