import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildStandaloneWorkflowSnapshot } from './workflow-snapshot.mjs';
import { createTaskProgress, taskProgressPaths } from './task-progress-store.mjs';

function fixture(t) {
  const root = realpathSync(
    mkdtempSync(path.join(tmpdir(), 'workflow-snapshot-')),
  );
  t.after(() =>
    rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }));
  execFileSync('git', ['init', '-b', 'feat/snapshot'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'snapshot@example.invalid'], {
    cwd: root,
  });
  execFileSync('git', ['config', 'user.name', 'Snapshot Test'], { cwd: root });
  execFileSync('git', ['config', 'core.hooksPath', '/dev/null'], { cwd: root });
  writeFileSync(path.join(root, 'README.md'), 'fixture\n');
  execFileSync('git', ['add', 'README.md'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'test: initialize fixture'], {
    cwd: root,
  });
  return root;
}

test('FLOW-A09 snapshot is one-shot read-only and isolates corrupt tasks', async (t) => {
  const root = fixture(t);
  createTaskProgress({
    workspaceRoot: root,
    taskId: 'VALID',
    contribution: 'Expose valid progress.',
    goal: 'Keep partial status readable.',
  });
  createTaskProgress({
    workspaceRoot: root,
    taskId: 'BROKEN',
    contribution: 'Exercise isolation.',
    goal: 'Keep corruption local.',
  });
  const broken = taskProgressPaths({ workspaceRoot: root, taskId: 'BROKEN' });
  writeFileSync(broken.snapshot, '{"invalid":true}\n');
  const valid = taskProgressPaths({ workspaceRoot: root, taskId: 'VALID' });
  const before = readFileSync(valid.snapshot, 'utf8');

  const snapshot = await buildStandaloneWorkflowSnapshot({
    workspaceRoots: [root],
    now: new Date('2026-10-13T12:00:00.000Z'),
  });
  assert.deepEqual(snapshot.worktrees[0].tasks.map((item) => item.taskId), [
    'VALID',
  ]);
  assert.deepEqual(
    snapshot.worktrees[0].taskErrors.map((item) => item.taskId),
    ['BROKEN'],
  );
  assert.equal(readFileSync(valid.snapshot, 'utf8'), before);
});

test('FLOW-A09 an unavailable workspace is local to one snapshot row', async (t) => {
  const root = fixture(t);
  const snapshot = await buildStandaloneWorkflowSnapshot({
    workspaceRoots: [root, path.join(root, 'missing')],
  });
  assert.equal(snapshot.worktrees.length, 1);
  assert.equal(snapshot.errors.length, 1);
  assert.equal(snapshot.worktrees[0].source.branch, 'feat/snapshot');
});
