import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeDevelopment,
  DevelopmentCloseError,
  runCli,
} from './development-close.mjs';
import {
  createTaskProgress,
  readTaskProgress,
} from './task-progress-store.mjs';

function git(directory, ...args) {
  return execFileSync('git', args, {
    cwd: directory,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'pt-development-close-'));
  const workspace = path.join(root, 'workspace');
  mkdirSync(workspace);
  execFileSync('git', ['init', '-b', 'feat/close'], { cwd: workspace });
  git(workspace, 'config', 'user.email', 'close@example.invalid');
  git(workspace, 'config', 'user.name', 'Close Test');
  git(workspace, 'config', 'core.hooksPath', '/dev/null');
  writeFileSync(path.join(workspace, 'README.md'), 'fixture\n');
  git(workspace, 'add', 'README.md');
  git(workspace, 'commit', '-m', 'test: initialize close fixture');
  return {
    root,
    workspace,
    close() {
      rmSync(root, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    },
  };
}

function start(scope, overrides = {}) {
  return createTaskProgress({
    workspaceRoot: scope.workspace,
    taskId: 'CLOSE-TASK',
    contribution: 'Close one selected task without sealing the worktree.',
    goal: 'Prove task-local close.',
    resourceRefs: [],
    ...overrides,
  });
}

function expectCode(code, operation) {
  return assert.rejects(operation, (error) => {
    assert.ok(error instanceof DevelopmentCloseError);
    assert.equal(error.code, code);
    return true;
  });
}

test('FLOW-A15 closes only the selected task and leaves the worktree reusable', async () => {
  const scope = fixture();
  try {
    const current = start(scope);
    const closed = await closeDevelopment({
      workspaceRoot: scope.workspace,
      taskId: current.taskId,
      closeReason: 'completed',
      evidenceRefs: [{ kind: 'FUNCTIONAL_CHECK', ref: 'evidence://close' }],
      resourceRefs: [],
    });
    assert.equal(closed.state, 'completed');
    assert.equal(
      readTaskProgress({
        workspaceRoot: scope.workspace,
        taskId: current.taskId,
      }).state,
      'completed',
    );
    const next = createTaskProgress({
      workspaceRoot: scope.workspace,
      taskId: 'NEXT-TASK',
      contribution: 'Continue with unrelated work.',
      goal: 'Prove no workspace-wide close guard remains.',
    });
    assert.equal(next.state, 'active');
  } finally {
    scope.close();
  }
});

test('close refuses unsettled task-owned resources but ignores unrelated workspace state', async () => {
  const scope = fixture();
  try {
    const current = start(scope, {
      resourceRefs: [{ resourceKey: 'device:one', state: 'running' }],
    });
    await expectCode('TASK_PROGRESS_RESOURCE_UNSETTLED', () =>
      closeDevelopment({
        workspaceRoot: scope.workspace,
        taskId: current.taskId,
        closeReason: 'completed',
        evidenceRefs: [{ kind: 'FUNCTIONAL_CHECK', ref: 'evidence://close' }],
      }),
    );
    const cancelled = await closeDevelopment({
      workspaceRoot: scope.workspace,
      taskId: current.taskId,
      closeReason: 'cancelled',
      resourceRefs: [{ resourceKey: 'device:one', state: 'released' }],
    });
    assert.equal(cancelled.state, 'cancelled');
  } finally {
    scope.close();
  }
});

test('development-close exposes only the close action', async () => {
  const scope = fixture();
  try {
    const current = start(scope);
    await expectCode('DEVELOPMENT_CLOSE_INVALID', () =>
      runCli([
        'status',
        '--workspace-root',
        scope.workspace,
        '--task',
        current.taskId,
      ], { output() {} }),
    );
    assert.equal(
      readTaskProgress({
        workspaceRoot: scope.workspace,
        taskId: current.taskId,
      }).state,
      'active',
    );
  } finally {
    scope.close();
  }
});
