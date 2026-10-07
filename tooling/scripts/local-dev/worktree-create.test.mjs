import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  bindWorkflowOwner,
} from './workflow-binding-store.mjs';
import {
  workflowOwnerReferenceFromBinding,
} from './workflow-owner-reference.mjs';
import {
  WorktreeCreationError,
  createWorktree,
  readAllWorktreeCreations,
  readWorktreeCreation,
  runWorktreeCreationCli,
} from './worktree-create.mjs';

function git(root, ...args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'pt-worktree-create-'));
  const sourceRoot = path.join(root, 'source');
  const targetRoot = path.join(root, 'target');
  const home = path.join(root, 'home');
  const machineRoot = path.join(home, '.peers-touch', 'dev');
  mkdirSync(sourceRoot);
  mkdirSync(home);
  git(sourceRoot, 'init', '-b', 'main');
  git(sourceRoot, 'config', 'user.email', 'worktree-test@example.invalid');
  git(sourceRoot, 'config', 'user.name', 'Worktree Test');
  writeFileSync(path.join(sourceRoot, 'README.md'), 'fixture\n');
  git(sourceRoot, 'add', 'README.md');
  git(sourceRoot, 'commit', '-m', 'test: initialize fixture');
  const owner = bindWorkflowOwner('trae', 'main-chat-1', sourceRoot, {
    machineRoot,
    now: new Date('2026-10-07T00:00:00.000Z'),
  }).binding;
  return {
    root,
    sourceRoot,
    targetRoot,
    home,
    machineRoot,
    owner: workflowOwnerReferenceFromBinding(owner),
    close() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test('creates a worktree with durable main-session provenance', () => {
  const scope = fixture();
  try {
    const record = createWorktree({
      home: scope.home,
      sourceRoot: scope.sourceRoot,
      targetRoot: scope.targetRoot,
      branch: 'feat/owned-worktree',
      startPoint: 'HEAD',
      purpose: 'test cross-agent worktree attribution',
      workflowOwner: scope.owner,
      creationActionReceiptDigest: 'a'.repeat(64),
      now: new Date('2026-10-07T00:00:01.000Z'),
    });
    assert.equal(record.createdBy.rootChatId, 'main-chat-1');
    assert.equal(record.branch, 'feat/owned-worktree');
    assert.equal(record.purpose, 'test cross-agent worktree attribution');
    assert.equal(git(scope.targetRoot, 'branch', '--show-current'), record.branch);
    assert.deepEqual(
      readWorktreeCreation({
        home: scope.home,
        workspaceRoot: scope.targetRoot,
      }),
      record,
    );
    assert.deepEqual(readAllWorktreeCreations({ home: scope.home }), {
      records: [record],
      errors: [],
    });
    const replayed = createWorktree({
      home: scope.home,
      sourceRoot: scope.sourceRoot,
      targetRoot: scope.targetRoot,
      branch: 'feat/owned-worktree',
      startPoint: 'HEAD',
      purpose: 'test cross-agent worktree attribution',
      workflowOwner: scope.owner,
      creationActionReceiptDigest: 'b'.repeat(64),
      now: new Date('2026-10-07T00:01:00.000Z'),
    });
    assert.deepEqual(replayed, record);
    if (process.platform !== 'win32') {
      const file = path.join(
        scope.home,
        '.peers-touch',
        'dev',
        'workspaces',
        record.workspaceId,
        'workflow',
        'worktree-creation.json',
      );
      assert.equal(statSync(file).mode & 0o777, 0o600);
    }
  } finally {
    scope.close();
  }
});

test('resolves START as a commit before invoking git worktree add', () => {
  const scope = fixture();
  try {
    assert.throws(
      () =>
        createWorktree({
          home: scope.home,
          sourceRoot: scope.sourceRoot,
          targetRoot: scope.targetRoot,
          branch: 'feat/reject-option-like-start',
          startPoint: '--no-checkout',
          purpose: 'reject option injection',
          workflowOwner: scope.owner,
          creationActionReceiptDigest: 'a'.repeat(64),
        }),
      (error) =>
        error instanceof WorktreeCreationError &&
        error.code === 'WORKTREE_CREATION_FAILED',
    );
    assert.equal(existsSync(scope.targetRoot), false);
    assert.throws(() =>
      git(
        scope.sourceRoot,
        'show-ref',
        '--verify',
        '--quiet',
        'refs/heads/feat/reject-option-like-start',
      ),
    );
  } finally {
    scope.close();
  }
});

test('recovers provenance publication after Git creation is interrupted', () => {
  const scope = fixture();
  const base = {
    home: scope.home,
    sourceRoot: scope.sourceRoot,
    targetRoot: scope.targetRoot,
    branch: 'feat/recover-worktree',
    startPoint: 'HEAD',
    purpose: 'recover durable attribution',
    workflowOwner: scope.owner,
    creationActionReceiptDigest: 'a'.repeat(64),
    now: new Date('2026-10-07T00:00:01.000Z'),
  };
  try {
    assert.throws(
      () =>
        createWorktree({
          ...base,
          creationFailpoint(stage) {
            if (stage === 'after-git-create') {
              throw new Error('simulated interruption');
            }
          },
        }),
      (error) =>
        error instanceof WorktreeCreationError &&
        error.code === 'WORKTREE_CREATION_FAILED',
    );
    assert.equal(existsSync(scope.targetRoot), true);
    assert.equal(
      readWorktreeCreation({
        home: scope.home,
        workspaceRoot: scope.targetRoot,
      }),
      null,
    );

    const recovered = createWorktree({
      ...base,
      creationActionReceiptDigest: 'b'.repeat(64),
      now: new Date('2026-10-07T00:01:00.000Z'),
    });
    assert.equal(recovered.creationActionReceiptDigest, 'a'.repeat(64));
    assert.equal(recovered.createdAt, '2026-10-07T00:00:01.000Z');
  } finally {
    scope.close();
  }
});

test('CLI refuses worktree creation without a current main-session receipt', () => {
  const scope = fixture();
  try {
    assert.throws(
      () =>
        runWorktreeCreationCli(
          [
            'create',
            '--source-root',
            scope.sourceRoot,
            '--path',
            scope.targetRoot,
            '--branch',
            'feat/unowned-worktree',
            '--purpose',
            'must fail closed',
          ],
          {
            resolveCurrentWorkflowOwnerContext: () => ({
              workflowOwner: null,
              actionReceiptDigest: null,
            }),
          },
        ),
      (error) => {
        assert.ok(error instanceof WorktreeCreationError);
        assert.equal(error.code, 'WORKTREE_OWNER_CONTEXT_REQUIRED');
        return true;
      },
    );
  } finally {
    scope.close();
  }
});

test('CLI forwards the current main-session receipt into creation', () => {
  const scope = fixture();
  try {
    let received = null;
    const result = runWorktreeCreationCli(
      [
        'create',
        '--source-root',
        scope.sourceRoot,
        '--path',
        scope.targetRoot,
        '--branch',
        'feat/owned-worktree',
        '--purpose',
        'trace the creator',
      ],
      {
        machineRoot: scope.machineRoot,
        resolveCurrentWorkflowOwnerContext: () => ({
          workflowOwner: scope.owner,
          actionReceiptDigest: 'b'.repeat(64),
        }),
        createWorktree: (options) => {
          received = options;
          return { status: 'created' };
        },
      },
    );
    assert.deepEqual(result, { status: 'created' });
    assert.equal(received.workflowOwner.rootChatId, 'main-chat-1');
    assert.equal(received.creationActionReceiptDigest, 'b'.repeat(64));
  } finally {
    scope.close();
  }
});
