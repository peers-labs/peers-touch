import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import {
  reportHookObservation,
  runHook,
  workspaceContext,
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

test('loads ordered roots from the installed TRAE workspace descriptor', () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'pt-hook-workspace-'));
  try {
    const first = path.join(temporary, 'first');
    const second = path.join(temporary, 'second');
    mkdirSync(first);
    mkdirSync(second);
    const workspace = path.join(temporary, 'fixture.code-workspace');
    writeFileSync(
      workspace,
      JSON.stringify({
        folders: [
          { path: 'first' },
          { path: 'missing' },
          { path: 'second' },
          { path: 'first' },
        ],
      }),
    );

    assert.deepEqual(workspaceContext(workspace), {
      workspaceRoots: [realpathSync(first), realpathSync(second)],
      bootstrapRoot: realpathSync(first),
    });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('rejects a workspace descriptor with a missing folder', () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'pt-hook-workspace-'));
  try {
    const workspace = path.join(temporary, 'fixture.code-workspace');
    writeFileSync(
      workspace,
      JSON.stringify({ folders: [{ path: 'missing' }] }),
    );
    assert.throws(
      () => workspaceContext(workspace),
      /TRAE_WORKSPACE_DESCRIPTOR_INVALID/,
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
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
