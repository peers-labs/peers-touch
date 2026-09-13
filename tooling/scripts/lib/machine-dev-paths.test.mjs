import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import test from 'node:test';
import path from 'node:path';

import {
  developmentWorkLedgerPath,
  developmentWorkLockPath,
  machineDevRoot,
  workspaceIdForRoot,
  workspaceWorkflowPath,
  workspaceRuntimeRef,
  workspaceRuntimePath,
} from './machine-dev-paths.mjs';

test('resolves runtime state under the machine Dev Control Plane', () => {
  const root = realpathSync(process.cwd());
  const expectedWorkspaceId = createHash('sha256')
    .update(root)
    .digest('hex')
    .slice(0, 16);

  assert.equal(workspaceIdForRoot(root), expectedWorkspaceId);
  assert.equal(machineDevRoot('/home/tester'), '/home/tester/.peers-touch/dev');
  assert.equal(
    workspaceRuntimePath('atelier-controlled-gate', {
      home: '/home/tester',
      repoRoot: root,
    }),
    path.join(
      '/home/tester/.peers-touch/dev/workspaces',
      expectedWorkspaceId,
      'runtime',
      'atelier-controlled-gate',
    ),
  );
  assert.equal(
    workspaceRuntimeRef('atelier-controlled-gate', root),
    `~/.peers-touch/dev/workspaces/${expectedWorkspaceId}/runtime/atelier-controlled-gate`,
  );
});

test('resolves the public work ledger and workspace workflow state', () => {
  const root = realpathSync(process.cwd());
  const workspaceId = workspaceIdForRoot(root);

  assert.equal(
    developmentWorkLedgerPath('/home/tester'),
    '/home/tester/.peers-touch/dev/work.json',
  );
  assert.equal(
    developmentWorkLockPath('/home/tester'),
    '/home/tester/.peers-touch/dev/work.lock',
  );
  assert.equal(
    workspaceWorkflowPath('chat-group', {
      home: '/home/tester',
      repoRoot: root,
    }),
    path.join(
      '/home/tester/.peers-touch/dev/workspaces',
      workspaceId,
      'workflow',
      'chat-group',
    ),
  );
});

test('rejects runtime names that can escape the workspace root', () => {
  assert.throws(() => workspaceRuntimePath('../outside'), /Invalid workspace runtime name/);
  assert.throws(() => workspaceRuntimePath('/absolute'), /Invalid workspace runtime name/);
  assert.throws(
    () => workspaceWorkflowPath('../outside'),
    /Invalid development work item/,
  );
});
