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
  workspaceObservationPath,
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
  const home = path.join(root, 'home');
  mkdirSync(home);
  return {
    root,
    home,
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

test('reports two worktrees into disjoint owner-only records', () => {
  const scope = fixture();
  try {
    const workspaceA = createRepository(scope.root, 'workspace-a');
    const workspaceB = createRepository(scope.root, 'workspace-b');
    const recordA = reportWorktreeObservation({
      workspaceRoot: workspaceA,
      home: scope.home,
      host: 'trae',
      event: 'SessionStart',
      now: new Date('2026-09-23T01:00:00.000Z'),
    });
    const recordB = reportWorktreeObservation({
      workspaceRoot: workspaceB,
      home: scope.home,
      host: 'codex',
      event: 'UserPromptSubmit',
      now: new Date('2026-09-23T01:00:01.000Z'),
    });

    assert.notEqual(recordA.workspaceId, recordB.workspaceId);
    assert.equal(
      observationFileMode(
        workspaceObservationPath({
          home: scope.home,
          workspaceId: recordA.workspaceId,
        }),
      ),
      0o600,
    );
    const all = readAllWorktreeObservations({ home: scope.home });
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
      home: scope.home,
      now: new Date('2026-09-23T01:00:05.000Z'),
    });
    const result = reportWorktreeObservation({
      workspaceRoot: workspace,
      home: scope.home,
      now: new Date('2026-09-23T01:00:04.000Z'),
    });
    assert.equal(result.reportedAt, newer.reportedAt);
  } finally {
    scope.close();
  }
});

test('one corrupt observation is isolated from healthy workspaces', () => {
  const scope = fixture();
  try {
    const workspaceA = createRepository(scope.root, 'workspace-a');
    const workspaceB = createRepository(scope.root, 'workspace-b');
    const recordA = reportWorktreeObservation({
      workspaceRoot: workspaceA,
      home: scope.home,
    });
    const recordB = reportWorktreeObservation({
      workspaceRoot: workspaceB,
      home: scope.home,
    });
    const corruptFile = workspaceObservationPath({
      home: scope.home,
      workspaceId: recordB.workspaceId,
    });
    const corrupt = JSON.parse(readFileSync(corruptFile, 'utf8'));
    corrupt.branch = 'tampered';
    writeFileSync(corruptFile, `${JSON.stringify(corrupt)}\n`);

    const all = readAllWorktreeObservations({ home: scope.home });
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
