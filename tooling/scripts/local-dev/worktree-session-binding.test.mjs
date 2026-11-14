import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  bindSessionWorktree,
  detectWorktreeDrift,
  readSessionBinding,
  resolveInvocationWorktree,
} from './worktree-session-binding.mjs';

const relay = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
  '..',
  '..',
);
const sibling = path.resolve(relay, '..', 'peers-official-site');

function tempStateRoot() {
  return mkdtempSync(path.join(tmpdir(), 'wtguard-'));
}

test('binds one worktree once and ignores a later different root', () => {
  const stateRoot = tempStateRoot();
  const first = bindSessionWorktree({
    stateRoot,
    workspaceRoots: [relay],
    source: 'test',
  });
  assert.equal(first.status, 'BOUND');
  assert.equal(first.binding.name, 'peers-relay');

  const second = bindSessionWorktree({
    stateRoot,
    workspaceRoots: [sibling],
    source: 'test',
  });
  assert.equal(second.status, 'ALREADY_BOUND');
  assert.equal(readSessionBinding(stateRoot).canonicalRoot, relay);
});

test('refuses to guess when zero or multiple roots are open', () => {
  assert.equal(
    bindSessionWorktree({
      stateRoot: tempStateRoot(),
      workspaceRoots: [],
    }).status,
    'UNRESOLVED',
  );
  assert.equal(
    bindSessionWorktree({
      stateRoot: tempStateRoot(),
      workspaceRoots: [relay, sibling],
    }).status,
    'UNRESOLVED',
  );
});

test('allows same-worktree mutation but drifts on a sibling worktree', () => {
  const stateRoot = tempStateRoot();
  bindSessionWorktree({ stateRoot, workspaceRoots: [relay], source: 'test' });
  const binding = readSessionBinding(stateRoot);

  const same = resolveInvocationWorktree({ toolWorkingDirectory: relay });
  assert.equal(detectWorktreeDrift({ binding, invocationRoot: same }), null);

  const other = resolveInvocationWorktree({ toolWorkingDirectory: sibling });
  assert.deepEqual(
    detectWorktreeDrift({ binding, invocationRoot: other }).boundRoot,
    relay,
  );
});

test('drift catches an absolute file target inside another worktree', () => {
  const stateRoot = tempStateRoot();
  bindSessionWorktree({ stateRoot, workspaceRoots: [relay], source: 'test' });
  const binding = readSessionBinding(stateRoot);
  const invocationRoot = resolveInvocationWorktree({
    toolWorkingDirectory: relay,
    targetFilepaths: [path.join(sibling, 'README.md')],
  });
  assert.ok(detectWorktreeDrift({ binding, invocationRoot }));
});

test('fails open when no invocation root can be resolved', () => {
  const stateRoot = tempStateRoot();
  bindSessionWorktree({ stateRoot, workspaceRoots: [relay], source: 'test' });
  const binding = readSessionBinding(stateRoot);
  assert.equal(
    detectWorktreeDrift({ binding, invocationRoot: null }),
    null,
  );
});
