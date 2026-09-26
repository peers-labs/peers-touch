import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  WorkspaceLifecycleLockError,
  acquireWorkspaceLifecycleLock,
  acquireWorkspaceLifecycleLockSync,
  createWorkspaceLifecycleLockMetadata,
  digestWorkspaceLifecycleLock,
  withWorkspaceLifecycleLock,
  workspaceLifecycleLockPath,
  workspaceLifecycleProcessIdentity,
} from './workspace-lifecycle-lock.mjs';

const WORKSPACE_ID = '0123456789abcdef';
const NOW = new Date('2026-09-26T00:00:00.000Z');

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'pt-workspace-lifecycle-'));
  const home = path.join(root, 'home');
  mkdirSync(home, { recursive: true });
  return {
    root,
    home,
    options: {
      home,
      workspaceId: WORKSPACE_ID,
      now: NOW,
    },
    close() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function expectCode(code, operation) {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof WorkspaceLifecycleLockError);
    assert.equal(error.code, code);
    return true;
  });
}

test('serializes sync and async owners with one owner-only workspace fence', async () => {
  const scope = fixture();
  try {
    const first = acquireWorkspaceLifecycleLockSync(scope.options);
    const lockPath = workspaceLifecycleLockPath(scope.options);
    assert.equal(statSync(lockPath).mode & 0o777, 0o600);
    expectCode('WORKSPACE_LIFECYCLE_LOCKED', () =>
      acquireWorkspaceLifecycleLockSync({
        ...scope.options,
        lockTimeoutMs: 1,
      }),
    );

    const order = [];
    const waiting = withWorkspaceLifecycleLock(
      { ...scope.options, lockTimeoutMs: 1_000 },
      async () => {
        order.push('second');
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(order, []);
    first.release();
    await waiting;
    assert.deepEqual(order, ['second']);
    assert.equal(existsSync(lockPath), false);
  } finally {
    scope.close();
  }
});

test('takes over a stale legacy binding lock through an owner-token claim', () => {
  const scope = fixture();
  try {
    const lockPath = workspaceLifecycleLockPath(scope.options);
    mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
    const stale = createWorkspaceLifecycleLockMetadata(
      scope.options,
      {
        pid: 2_147_483_647,
        processStart: 'stale-process',
        ownerToken: 'a'.repeat(64),
        now: NOW,
      },
    );
    stale.kind = 'peers-touch-workspace-plan-binding-lock';
    stale.recordDigest = digestWorkspaceLifecycleLock(stale);
    writeFileSync(lockPath, `${JSON.stringify(stale)}\n`, { mode: 0o600 });

    const acquired = acquireWorkspaceLifecycleLockSync(scope.options);
    const current = JSON.parse(readFileSync(lockPath, 'utf8'));
    assert.notEqual(current.ownerToken, stale.ownerToken);
    assert.equal(current.kind, 'peers-touch-workspace-lifecycle-lock');
    acquired.release();
    assert.equal(existsSync(lockPath), false);
    assert.equal(existsSync(`${lockPath}.recovery`), false);
  } finally {
    scope.close();
  }
});

test('owned release preserves a replacement owner instead of unlinking it', () => {
  const scope = fixture();
  try {
    const acquired = acquireWorkspaceLifecycleLockSync(scope.options);
    const lockPath = workspaceLifecycleLockPath(scope.options);
    const replacement = createWorkspaceLifecycleLockMetadata(
      scope.options,
      {
        pid: process.pid,
        processStart: workspaceLifecycleProcessIdentity(),
        ownerToken: 'b'.repeat(64),
        now: NOW,
      },
    );
    writeFileSync(lockPath, `${JSON.stringify(replacement)}\n`, { mode: 0o600 });

    expectCode(
      'WORKSPACE_LIFECYCLE_LOCK_OWNERSHIP_MISMATCH',
      acquired.release,
    );
    assert.deepEqual(JSON.parse(readFileSync(lockPath, 'utf8')), replacement);
    rmSync(lockPath);
  } finally {
    scope.close();
  }
});

test('an inherited lifecycle lease is accepted only for the same workspace', async () => {
  const scope = fixture();
  try {
    const acquired = await acquireWorkspaceLifecycleLock(scope.options);
    const result = await withWorkspaceLifecycleLock(
      {
        ...scope.options,
        lifecycleLease: acquired.lease,
      },
      async (lease) => lease.ownerToken,
    );
    assert.equal(result, acquired.lease.ownerToken);
    await assert.rejects(
      withWorkspaceLifecycleLock(
        {
          ...scope.options,
          workspaceId: 'fedcba9876543210',
          lifecycleLease: acquired.lease,
        },
        async () => {},
      ),
      (error) => {
        assert.equal(
          error.code,
          'WORKSPACE_LIFECYCLE_LOCK_OWNERSHIP_MISMATCH',
        );
        return true;
      },
    );
    acquired.release();
  } finally {
    scope.close();
  }
});
