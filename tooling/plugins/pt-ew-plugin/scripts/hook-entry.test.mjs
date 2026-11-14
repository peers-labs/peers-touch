import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  reportHookObservation,
  runHook,
  workspaceContext,
} from './hook-entry.mjs';

const installationRoot = realpathSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..'),
);

function projectFixture(parent, name) {
  const root = path.join(parent, name);
  mkdirSync(path.join(root, 'tooling', 'skills', 'pt-ew'), {
    recursive: true,
  });
  mkdirSync(path.join(root, 'tooling', 'scripts', 'local-dev'), {
    recursive: true,
  });
  writeFileSync(path.join(root, 'tooling', 'skills', 'pt-ew', 'SKILL.md'), '# fixture\n');
  writeFileSync(path.join(root, 'tooling', 'scripts', 'local-dev', 'dev-work.mjs'), '// fixture\n');
  execFileSync('git', ['init', '-b', 'test/hook-root'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'hook@example.invalid'], {
    cwd: root,
  });
  execFileSync('git', ['config', 'user.name', 'Hook Test'], { cwd: root });
  execFileSync('git', ['config', 'core.hooksPath', '/dev/null'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'test: initialize hook fixture'], {
    cwd: root,
  });
  return realpathSync(root);
}

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
          { path: 'second' },
          { path: 'first' },
        ],
      }),
    );

    assert.deepEqual(workspaceContext(workspace), {
      workspaceRoots: [realpathSync(first), realpathSync(second)],
      skippedFolders: [],
    });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('skips a missing folder but keeps the resolvable roots', () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'pt-hook-workspace-'));
  try {
    const keep = path.join(temporary, 'keep');
    mkdirSync(keep);
    const workspace = path.join(temporary, 'fixture.code-workspace');
    writeFileSync(
      workspace,
      JSON.stringify({
        folders: [{ path: 'keep' }, { path: 'missing' }],
      }),
    );
    const result = workspaceContext(workspace);
    assert.deepEqual(result.workspaceRoots, [realpathSync(keep)]);
    assert.deepEqual(result.skippedFolders, [
      { value: 'missing', reason: 'unresolved' },
    ]);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('rejects a descriptor when every folder is missing', () => {
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

test('FLOW-A04 thin TRAE adapter attaches guidance without identity authority', async () => {
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
  assert.equal(response.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(response.hookSpecificOutput.permissionDecision, 'allow');
  assert.match(
    response.hookSpecificOutput.additionalContext,
    /docs\/global\/workflow\.md/,
  );
  assert.equal(reports.length, 1);
  assert.equal(reports[0].host, 'trae');
});

test('FLOW-A04 installed Hook ignores an explicit sibling worktree', async () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'pt-hook-sibling-'));
  try {
    const sibling = projectFixture(temporary, 'sibling');
    const workspace = path.join(temporary, 'fixture.code-workspace');
    writeFileSync(
      workspace,
      JSON.stringify({
        folders: [
          { path: installationRoot },
          { path: sibling },
        ],
      }),
    );
    const reports = [];
    const response = await runHook({
      argv: [
        '--host',
        'trae',
        '--event',
        'PreToolUse',
        '--workspace',
        workspace,
      ],
      input: Readable.from([
        Buffer.from(
          JSON.stringify({
            tool_name: 'exec_command',
            tool_input: { workdir: sibling },
          }),
        ),
      ]),
      report(options) {
        reports.push(options);
        return { workspaceId: 'unexpected' };
      },
    });
    assert.deepEqual(response, {});
    assert.deepEqual(reports, []);
  } finally {
    // Match the Git fixture lifecycle used by Plan and workflow-kernel tests:
    // external repository observers can finish directory writes after Git exits.
    rmSync(temporary, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});

test('pre-tool events are traced through the injected skill recorder', async () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'pt-hook-trace-'));
  try {
    const workspace = path.join(temporary, 'fixture.code-workspace');
    writeFileSync(
      workspace,
      JSON.stringify({ folders: [{ path: installationRoot }] }),
    );
    const traced = [];
    const response = await runHook({
      argv: ['--host', 'trae', '--event', 'PreToolUse', '--workspace', workspace],
      input: Readable.from([
        Buffer.from(JSON.stringify({ tool_name: 'Skill', tool_input: {} })),
      ]),
      report() {
        return { workspaceId: 'observed' };
      },
      recordSkill(record) {
        traced.push(record);
      },
    });
    assert.equal(traced.length, 1);
    assert.equal(traced[0].host, 'trae');
    assert.equal(traced[0].toolName, 'Skill');
    // The advisory allow/context response is unaffected by tracing.
    assert.ok(response.hookSpecificOutput);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('a failing skill recorder never blocks the hook response', async () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'pt-hook-trace-fail-'));
  try {
    const workspace = path.join(temporary, 'fixture.code-workspace');
    writeFileSync(
      workspace,
      JSON.stringify({ folders: [{ path: installationRoot }] }),
    );
    const response = await runHook({
      argv: ['--host', 'trae', '--event', 'PreToolUse', '--workspace', workspace],
      input: Readable.from([
        Buffer.from(JSON.stringify({ tool_name: 'Write', tool_input: {} })),
      ]),
      report() {
        return { workspaceId: 'observed' };
      },
      recordSkill() {
        throw new Error('disk full');
      },
    });
    assert.ok(response.hookSpecificOutput);
    assert.notEqual(
      response.hookSpecificOutput?.permissionDecision,
      'deny',
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
