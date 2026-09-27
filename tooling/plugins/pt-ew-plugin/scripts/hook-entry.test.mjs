import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import {
  reportHookObservation,
  runHook,
} from './hook-entry.mjs';

test('reports the current worktree without changing hook admission', async () => {
  const calls = [];
  const result = await reportHookObservation(
    { host: 'trae', hostEvent: 'UserPromptSubmit' },
    '/tmp/worktree',
    {
      report(options) {
        calls.push(options);
        return { workspaceId: '0123456789abcdef' };
      },
    },
  );
  assert.equal(result.status, 'REPORTED');
  assert.deepEqual(calls, [
    {
      workspaceRoot: '/tmp/worktree',
      host: 'trae',
      event: 'UserPromptSubmit',
      minimumIntervalMs: 15_000,
    },
  ]);
});

test('observation failure is isolated from hook admission', async () => {
  const result = await reportHookObservation(
    { host: 'codex', hostEvent: 'PreToolUse' },
    '/tmp/worktree',
    {
      report() {
        const error = new Error('disk unavailable');
        error.code = 'WORKTREE_OBSERVATION_FAILED';
        throw error;
      },
    },
  );
  assert.deepEqual(result, {
    status: 'UNAVAILABLE',
    code: 'WORKTREE_OBSERVATION_FAILED',
  });
});

test('runs the host-neutral kernel through a thin TRAE adapter', async () => {
  const reports = [];
  const response = await runHook({
    argv: ['--host', 'trae', '--event', 'PreToolUse'],
    input: Readable.from([
      Buffer.from(
        JSON.stringify({
          repo_working_dir: process.cwd(),
          tool_name: 'Write',
          tool_input: { file_path: 'README.md' },
        }),
      ),
    ]),
    report(options) {
      reports.push(options);
      return { workspaceId: 'observed' };
    },
  });
  assert.deepEqual(response, {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        'STABLE_CONVERSATION_ID_REQUIRED: A stable conversation identifier is required for mutation.',
    },
  });
  assert.equal(reports.length, 1);
  assert.equal(reports[0].host, 'trae');
});
