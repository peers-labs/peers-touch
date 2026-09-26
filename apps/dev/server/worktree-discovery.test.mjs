import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  discoverGitWorktrees,
  parseGitWorktreeList,
} from './worktree-discovery.mjs';

test('parses branch and detached worktrees without exposing policy state', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pt-worktree-discovery-'));
  try {
    const first = path.join(root, 'first');
    const second = path.join(root, 'second');
    mkdirSync(first);
    mkdirSync(second);
    const checkedAt = '2026-09-23T01:00:00.000Z';
    const output =
      `worktree ${first}\0` +
      `HEAD ${'1'.repeat(40)}\0` +
      'branch refs/heads/feature/first\0\0' +
      `worktree ${second}\0` +
      `HEAD ${'2'.repeat(40)}\0` +
      'detached\0\0';

    const records = parseGitWorktreeList(output, checkedAt);
    assert.equal(records.length, 2);
    const branch = records.find(
      (record) => record.canonicalRoot === realpathSync(first),
    );
    const detached = records.find(
      (record) => record.canonicalRoot === realpathSync(second),
    );
    assert.equal(branch.branch, 'feature/first');
    assert.equal(branch.detached, false);
    assert.equal(detached.branch, null);
    assert.equal(detached.detached, true);
    assert.equal(detached.checkedAt, checkedAt);
  } finally {
    rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
});

test('discovery uses one bounded git worktree command', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pt-worktree-discovery-'));
  try {
    const workspace = path.join(root, 'workspace');
    mkdirSync(workspace);
    const calls = [];
    const result = discoverGitWorktrees({
      repoRoot: workspace,
      now: new Date('2026-09-23T01:00:00.000Z'),
      execFileSync(command, args, options) {
        calls.push({ command, args, options });
        return (
          `worktree ${workspace}\0` +
          `HEAD ${'a'.repeat(40)}\0` +
          'branch refs/heads/main\0\0'
        );
      },
    });
    assert.equal(result.records.length, 1);
    assert.deepEqual(calls[0].args, [
      'worktree',
      'list',
      '--porcelain',
      '-z',
    ]);
    assert.equal(result.records[0].checkedAt, result.checkedAt);
  } finally {
    rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
});
