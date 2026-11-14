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
  // The tool name is retained (not promoted to authority) so the append-only
  // skill event log can record what actually ran on every host. The raw
  // tool_input object is still stripped, and edit targets are surfaced as
  // willEditFilepaths instead.
  assert.equal(normalized.toolName, 'apply_patch');
  assert.equal(Object.hasOwn(normalized, 'toolInput'), false);
  assert.deepEqual(normalized.willEditFilepaths, ['/workspace/file.ts']);
});

test('tool name normalization is shared across trae, cursor and codex payloads', () => {
  const base = {
    tool_input: { working_directory: '/workspace' },
  };
  const trae = normalizeHostPayload(
    { ...base, tool_name: 'Skill' },
    { host: 'trae', event: 'PreToolUse', workspaceRoots: ['/workspace'] },
  );
  const cursor = normalizeHostPayload(
    { ...base, toolName: 'run_skill' },
    { host: 'cursor', event: 'PreToolUse', workspaceRoots: ['/workspace'] },
  );
  const codex = normalizeHostPayload(
    { ...base, name: 'invoke_skill' },
    { host: 'codex', event: 'PreToolUse', workspaceRoots: ['/workspace'] },
  );
  assert.equal(trae.toolName, 'Skill');
  assert.equal(cursor.toolName, 'run_skill');
  assert.equal(codex.toolName, 'invoke_skill');
});

test('FLOW-A04 multi-root ambient cwd does not select a sibling worktree', () => {
  const normalized = normalizeHostPayload(
    {
      hook_event_name: 'PreToolUse',
      repo_working_dir: '/workspace/second',
      tool_name: 'write_stdin',
      tool_input: {},
    },
    {
      host: 'trae',
      event: 'PreToolUse',
      installationRoot: '/workspace/first',
      workspaceRoots: ['/workspace/first', '/workspace/second'],
    },
  );
  assert.equal(normalized.installationRoot, '/workspace/first');
  assert.equal(normalized.explicitToolWorkingDirectory, null);
  assert.equal(normalized.toolWorkingDirectory, '/workspace/second');
  assert.deepEqual(normalized.executionRootHints, []);
});

test('FLOW-A04 unknown host events normalize to an ignorable payload', () => {
  const normalized = normalizeHostPayload(
    { hook_event_name: 'FutureEvent' },
    { host: 'trae', event: 'FutureEvent' },
  );
  assert.equal(normalized.valid, false);
  assert.equal(normalized.code, 'HOOK_PAYLOAD_INVALID');
});

test('compaction re-entry events are recognized instead of dropped as unknown', () => {
  const pre = normalizeHostPayload(
    { hook_event_name: 'PreCompact' },
    { host: 'trae', event: 'PreCompact' },
  );
  assert.equal(pre.valid, true);
  assert.equal(pre.event, 'PRE_COMPACT');

  const post = normalizeHostPayload(
    { hook_event_name: 'PostCompact' },
    { host: 'trae', event: 'PostCompact' },
  );
  assert.equal(post.valid, true);
  assert.equal(post.event, 'POST_COMPACT');
});

test('subagent lifecycle events normalize to valid internal events', () => {
  const start = normalizeHostPayload(
    { hook_event_name: 'SubagentStart' },
    { host: 'trae', event: 'SubagentStart' },
  );
  assert.equal(start.valid, true);
  assert.equal(start.event, 'SUBAGENT_START');

  const stop = normalizeHostPayload(
    { hook_event_name: 'SubagentStop' },
    { host: 'trae', event: 'SubagentStop' },
  );
  assert.equal(stop.valid, true);
  assert.equal(stop.event, 'SUBAGENT_STOP');
});

test('compaction re-entry context renders for the trae host', () => {
  const response = renderHostResponse(
    'trae',
    {
      action: 'CONTEXT',
      code: 'WORKFLOW_REENTRY_AFTER_COMPACTION',
      additionalContext: 'Re-enter via pt-god-view.',
    },
    { hostEvent: 'PostCompact', event: 'POST_COMPACT' },
  );
  assert.equal(
    response.hookSpecificOutput.additionalContext,
    'Re-enter via pt-god-view.',
  );
  assert.notEqual(
    response.hookSpecificOutput?.permissionDecision,
    'deny',
  );
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
