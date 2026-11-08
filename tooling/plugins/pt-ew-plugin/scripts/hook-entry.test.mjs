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

test('Hook returns workflow guidance with filesystem writes denied', () => {
  const response = JSON.parse(execFileSync(process.execPath, [
    '--permission', '--allow-fs-read=*', '--allow-child-process',
    path.join(installationRoot, 'tooling/plugins/pt-ew-plugin/scripts/hook-entry.mjs'),
    '--host', 'trae', '--event', 'PreToolUse',
  ], {
    cwd: installationRoot,
    input: JSON.stringify({
      cwd: installationRoot,
      tool_name: 'Write',
      tool_input: { file_path: 'README.md' },
    }),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }));
  assert.equal(response.hookSpecificOutput.permissionDecision, 'allow');
  assert.match(response.hookSpecificOutput.additionalContext, /pt-dev-workflow\/SKILL\.md/);
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
  assert.match(response.hookSpecificOutput.additionalContext, /pt-god-view\/SKILL\.md/);
  assert.match(response.hookSpecificOutput.additionalContext, /pt-dev-workflow\/SKILL\.md/);
  assert.equal(reports.length, 0);
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
