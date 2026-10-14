import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createTaskProgress,
  listTaskProgress,
  readTaskProgress,
  runCli,
  TaskProgressError,
  updateTaskProgress,
} from './dev-work.mjs';
import {
  closeTaskProgress,
  taskProgressPaths,
} from './task-progress-store.mjs';

function git(directory, ...args) {
  return execFileSync('git', args, {
    cwd: directory,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'pt-task-progress-'));
  const workspace = path.join(root, 'workspace');
  mkdirSync(workspace);
  execFileSync('git', ['init', '-b', 'feat/task-progress'], { cwd: workspace });
  git(workspace, 'config', 'user.email', 'task-progress@example.invalid');
  git(workspace, 'config', 'user.name', 'Task Progress Test');
  git(workspace, 'config', 'core.hooksPath', '/dev/null');
  writeFileSync(path.join(workspace, 'README.md'), 'fixture\n');
  git(workspace, 'add', 'README.md');
  git(workspace, 'commit', '-m', 'test: initialize task fixture');
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

function startOptions(scope, overrides = {}) {
  return {
    workspaceRoot: scope.workspace,
    taskId: 'FLOW-TASK-1',
    northStarRef: 'docs/architecture/engineering/development-workflow/design.md',
    contribution: 'Make optional task recovery lightweight.',
    goal: 'Prove one atomic task snapshot with CAS.',
    scopePaths: ['tooling/scripts/local-dev'],
    scopeExclusions: ['apps/station'],
    nextAction: 'Implement the next bounded step.',
    reason: 'Start the selected complex task.',
    now: '2026-10-13T12:00:00.000Z',
    ...overrides,
  };
}

function expectCode(code, operation) {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof TaskProgressError);
    assert.equal(error.code, code);
    return true;
  });
}

test('FLOW-A02 ordinary no-Plan work creates no task record', () => {
  const scope = fixture();
  try {
    const status = listTaskProgress({ workspaceRoot: scope.workspace });
    assert.deepEqual(status.tasks, []);
    assert.deepEqual(status.invalid, []);
    assert.equal(existsSync(path.join(scope.workspace, '.dev-workflow')), false);
  } finally {
    scope.close();
  }
});

test('FLOW-A07 selected tasks use independent atomic snapshots and short locks', () => {
  const scope = fixture();
  try {
    const first = createTaskProgress(startOptions(scope));
    const second = createTaskProgress(startOptions(scope, {
      taskId: 'FLOW-TASK-2',
      contribution: 'Keep another task independent.',
      goal: 'Prove task-local storage.',
    }));
    const firstPaths = taskProgressPaths({
      workspaceRoot: scope.workspace,
      taskId: first.taskId,
    });
    const secondPaths = taskProgressPaths({
      workspaceRoot: scope.workspace,
      taskId: second.taskId,
    });
    assert.notEqual(firstPaths.lock, secondPaths.lock);
    assert.equal(statSync(firstPaths.snapshot).mode & 0o777, 0o600);
    assert.equal(statSync(firstPaths.directory).mode & 0o777, 0o700);
    assert.equal(existsSync(path.join(firstPaths.directory, 'events.ndjson')), false);
    assert.match(first.checksum, /^[0-9a-f]{64}$/u);
    assert.deepEqual(
      listTaskProgress({ workspaceRoot: scope.workspace }).tasks.map(
        (item) => item.taskId,
      ),
      ['FLOW-TASK-1', 'FLOW-TASK-2'],
    );
  } finally {
    scope.close();
  }
});

test('FLOW-A08 checksum corruption is local and never manufactures recovery', () => {
  const scope = fixture();
  try {
    createTaskProgress(startOptions(scope));
    createTaskProgress(startOptions(scope, {
      taskId: 'FLOW-TASK-BROKEN',
      contribution: 'Exercise corruption isolation.',
      goal: 'Keep unrelated task status readable.',
    }));
    const broken = taskProgressPaths({
      workspaceRoot: scope.workspace,
      taskId: 'FLOW-TASK-BROKEN',
    });
    const value = JSON.parse(readFileSync(broken.snapshot, 'utf8'));
    writeFileSync(
      broken.snapshot,
      `${JSON.stringify({ ...value, state: 'completed' })}\n`,
    );
    expectCode('TASK_PROGRESS_CHECKSUM_INVALID', () =>
      readTaskProgress({
        workspaceRoot: scope.workspace,
        taskId: 'FLOW-TASK-BROKEN',
      }));
    const status = listTaskProgress({ workspaceRoot: scope.workspace });
    assert.deepEqual(status.tasks.map((item) => item.taskId), ['FLOW-TASK-1']);
    assert.deepEqual(status.invalid.map((item) => item.taskId), [
      'FLOW-TASK-BROKEN',
    ]);
  } finally {
    scope.close();
  }
});

test('FLOW-A10 source changes invalidate evidence and CAS rejects stale writers', () => {
  const scope = fixture();
  try {
    const started = createTaskProgress(startOptions(scope, {
      evidenceRefs: [{ kind: 'SOURCE_CHECK', ref: 'evidence://initial' }],
    }));
    writeFileSync(path.join(scope.workspace, 'change.txt'), 'change\n');
    git(scope.workspace, 'add', 'change.txt');
    git(scope.workspace, 'commit', '-m', 'test: advance source');

    const updated = updateTaskProgress({
      workspaceRoot: scope.workspace,
      taskId: started.taskId,
      expectedRevision: started.revision,
      stage: 'implement',
      reason: 'Continue on the new source.',
      now: '2026-10-13T12:01:00.000Z',
    });
    assert.notEqual(updated.currentSource, started.currentSource);
    assert.deepEqual(updated.evidenceRefs, []);
    expectCode('TASK_PROGRESS_REVISION_CONFLICT', () =>
      updateTaskProgress({
        workspaceRoot: scope.workspace,
        taskId: started.taskId,
        expectedRevision: started.revision,
        stage: 'verify',
        reason: 'Stale writer.',
      }));
  } finally {
    scope.close();
  }
});

test('FLOW-A15 close checks selected task evidence and owned resources', () => {
  const scope = fixture();
  try {
    const started = createTaskProgress(startOptions(scope, {
      resourceRefs: [{ resourceKey: 'local.slot:5', state: 'running' }],
    }));
    expectCode('TASK_PROGRESS_EVIDENCE_MISSING', () =>
      closeTaskProgress({
        workspaceRoot: scope.workspace,
        taskId: started.taskId,
        expectedRevision: started.revision,
        state: 'completed',
        resourceRefs: [{ resourceKey: 'local.slot:5', state: 'released' }],
      }));
    expectCode('TASK_PROGRESS_RESOURCE_UNSETTLED', () =>
      closeTaskProgress({
        workspaceRoot: scope.workspace,
        taskId: started.taskId,
        expectedRevision: started.revision,
        state: 'completed',
        evidenceRefs: [{ kind: 'FUNCTIONAL_CHECK', ref: 'evidence://pass' }],
      }));
    const closed = closeTaskProgress({
      workspaceRoot: scope.workspace,
      taskId: started.taskId,
      expectedRevision: started.revision,
      state: 'completed',
      evidenceRefs: [{ kind: 'FUNCTIONAL_CHECK', ref: 'evidence://pass' }],
      resourceRefs: [{ resourceKey: 'local.slot:5', state: 'retained' }],
      now: '2026-10-13T12:02:00.000Z',
    });
    assert.equal(closed.state, 'completed');
    assert.equal(
      createTaskProgress(startOptions(scope, {
        taskId: 'FLOW-TASK-NEXT',
        contribution: 'Start after another task completed.',
        goal: 'Prove the worktree is not sealed.',
      })).state,
      'active',
    );
  } finally {
    scope.close();
  }
});

test('dev-work has no duplicate close command', () => {
  const scope = fixture();
  try {
    createTaskProgress(startOptions(scope));
    expectCode('TASK_PROGRESS_INVALID', () =>
      runCli([
        'close',
        '--workspace-root',
        scope.workspace,
        '--task',
        'FLOW-TASK-1',
      ], { output() {} }));
  } finally {
    scope.close();
  }
});

test('task storage rejects a symlink escape', () => {
  const scope = fixture();
  try {
    const outside = path.join(scope.root, 'outside');
    mkdirSync(outside);
    symlinkSync(outside, path.join(scope.workspace, '.dev-workflow'));
    assert.equal(
      lstatSync(path.join(scope.workspace, '.dev-workflow')).isSymbolicLink(),
      true,
    );
    expectCode('TASK_PROGRESS_PATH_ESCAPE', () =>
      createTaskProgress(startOptions(scope)));
    assert.equal(
      readFileSync(path.join(scope.workspace, 'README.md'), 'utf8'),
      'fixture\n',
    );
  } finally {
    scope.close();
  }
});
