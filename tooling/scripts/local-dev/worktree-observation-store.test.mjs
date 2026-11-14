import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  observationFileMode,
  readAllWorktreeObservations,
  reportWorktreeObservation,
} from './worktree-observation-store.mjs';
import {
  workspaceIdForRoot,
  worktreeObservationFilePath,
} from '../lib/machine-dev-paths.mjs';

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function createRepository(parent, name) {
  const root = path.join(parent, name);
  mkdirSync(root);
  git(root, ['init', '-b', `feature/${name}`]);
  git(root, ['config', 'user.name', 'Observation Test']);
  git(root, ['config', 'user.email', 'observation@test.invalid']);
  writeFileSync(path.join(root, 'README.md'), `${name}\n`);
  git(root, ['add', 'README.md']);
  git(root, ['commit', '-m', 'test: initialize observation fixture']);
  return root;
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'pt-worktree-observation-'));
  return {
    root,
    close() {
      rmSync(root, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 50,
      });
    },
  };
}

test('reports two worktrees into disjoint worktree-local records', () => {
  const scope = fixture();
  try {
    const workspaceA = createRepository(scope.root, 'workspace-a');
    const workspaceB = createRepository(scope.root, 'workspace-b');
    const recordA = reportWorktreeObservation({
      workspaceRoot: workspaceA,
      host: 'trae',
      event: 'SessionStart',
      now: new Date('2026-09-23T01:00:00.000Z'),
    });
    const recordB = reportWorktreeObservation({
      workspaceRoot: workspaceB,
      host: 'codex',
      event: 'UserPromptSubmit',
      now: new Date('2026-09-23T01:00:01.000Z'),
    });

    assert.notEqual(recordA.workspaceId, recordB.workspaceId);
    const fileA = worktreeObservationFilePath(workspaceA);
    assert.equal(
      fileA,
      path.join(workspaceA, '.dev-workflow', 'observations', 'worktree.json'),
    );
    assert.equal(observationFileMode(fileA), 0o600);

    const all = readAllWorktreeObservations({
      workspaceRoots: [workspaceA, workspaceB],
    });
    assert.deepEqual(
      all.records.map((record) => record.workspaceId),
      [recordA.workspaceId, recordB.workspaceId].sort(),
    );
    assert.deepEqual(all.errors, []);
  } finally {
    scope.close();
  }
});

test('newer observation cannot be replaced by an older report', () => {
  const scope = fixture();
  try {
    const workspace = createRepository(scope.root, 'workspace');
    const newer = reportWorktreeObservation({
      workspaceRoot: workspace,
      now: new Date('2026-09-23T01:00:05.000Z'),
    });
    const result = reportWorktreeObservation({
      workspaceRoot: workspace,
      now: new Date('2026-09-23T01:00:04.000Z'),
    });
    assert.equal(result.reportedAt, newer.reportedAt);
  } finally {
    scope.close();
  }
});

test('one corrupt observation is isolated from healthy worktrees', () => {
  const scope = fixture();
  try {
    const workspaceA = createRepository(scope.root, 'workspace-a');
    const workspaceB = createRepository(scope.root, 'workspace-b');
    const recordA = reportWorktreeObservation({ workspaceRoot: workspaceA });
    const recordB = reportWorktreeObservation({ workspaceRoot: workspaceB });
    const corruptFile = worktreeObservationFilePath(workspaceB);
    const corrupt = JSON.parse(readFileSync(corruptFile, 'utf8'));
    corrupt.branch = 'tampered';
    writeFileSync(corruptFile, `${JSON.stringify(corrupt)}\n`);

    const all = readAllWorktreeObservations({
      workspaceRoots: [workspaceA, workspaceB],
    });
    assert.deepEqual(
      all.records.map((record) => record.workspaceId),
      [recordA.workspaceId],
    );
    assert.deepEqual(all.errors, [
      {
        workspaceId: recordB.workspaceId,
        code: 'WORKTREE_OBSERVATION_INVALID',
        message: 'observation digest is invalid',
      },
    ]);
    assert.equal(workspaceIdForRoot(workspaceA), recordA.workspaceId);
  } finally {
    scope.close();
  }
});

test('collector skips worktrees without a report and flags unresolved roots', () => {
  const scope = fixture();
  try {
    const workspaceA = createRepository(scope.root, 'workspace-a');
    const quiet = createRepository(scope.root, 'workspace-quiet');
    const gone = path.join(scope.root, 'already-removed');
    reportWorktreeObservation({ workspaceRoot: workspaceA });

    const all = readAllWorktreeObservations({
      workspaceRoots: [workspaceA, quiet, gone],
    });
    assert.deepEqual(
      all.records.map((record) => record.workspaceId),
      [workspaceIdForRoot(workspaceA)],
    );
    assert.deepEqual(
      all.errors.map((error) => error.code),
      ['WORKTREE_OBSERVATION_ROOT_UNRESOLVED'],
    );
  } finally {
    scope.close();
  }
});
