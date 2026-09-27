import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildDevSnapshot } from './status.mjs';
import { reportWorktreeObservation } from '../../../tooling/scripts/local-dev/worktree-observation-store.mjs';

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

test('DUI-J01 lists every Git worktree with independent freshness clocks', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pt-dev-ui-journey-'));
  const repository = path.join(root, 'repository');
  const second = path.join(root, 'second');
  const envRepo = path.join(root, 'env');
  const home = path.join(root, 'home');
  try {
    mkdirSync(repository);
    mkdirSync(path.join(envRepo, 'peers-touch'), { recursive: true });
    mkdirSync(home);
    git(repository, ['init', '-b', 'main']);
    git(repository, ['config', 'user.name', 'Dev UI Journey']);
    git(repository, ['config', 'user.email', 'dev-ui@test.invalid']);
    writeFileSync(path.join(repository, 'README.md'), 'journey\n');
    git(repository, ['add', 'README.md']);
    git(repository, ['commit', '-m', 'test: initialize journey']);
    git(repository, ['worktree', 'add', '-b', 'feature/second', second]);

    reportWorktreeObservation({
      workspaceRoot: second,
      home,
      host: 'cli',
      event: 'journey',
      now: new Date('2026-09-23T01:00:05.000Z'),
    });
    const snapshot = await buildDevSnapshot({
      repoRoot: repository,
      envRepo,
      home,
      now: new Date('2026-09-23T01:00:10.000Z'),
    });

    assert.equal(snapshot.discovery.count, 2);
    assert.equal(snapshot.worktrees.length, 2);
    const main = snapshot.worktrees.find((item) => item.name === 'repository');
    const feature = snapshot.worktrees.find((item) => item.name === 'second');
    assert.equal(main.branches[0], 'main');
    assert.equal(main.freshness.state, 'unreported');
    assert.equal(feature.branches[0], 'feature/second');
    assert.equal(feature.freshness.state, 'fresh');
    assert.equal(feature.freshness.lastReportedAt, '2026-09-23T01:00:05.000Z');
    assert.equal(feature.freshness.checkedAt, '2026-09-23T01:00:10.000Z');
    assert.equal(JSON.stringify(snapshot).includes(repository), false);
    assert.equal(JSON.stringify(snapshot).includes(second), false);
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});
