import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import test from 'node:test';
import path from 'node:path';

import {
  developmentWorkLedgerPath,
  developmentWorkLockPath,
  machineLeasePath,
  machineLeaseRoot,
  machineDevRoot,
  machineRegistryLockPath,
  machineRegistryPath,
  workspaceIdForRoot,
  workspaceStatePath,
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
  assert.equal(
    workspaceStatePath({ home: '/home/tester', repoRoot: root }),
    path.join('/home/tester/.peers-touch/dev/workspaces', expectedWorkspaceId),
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

test('resolves the canonical registry and OS lease paths', () => {
  assert.equal(
    machineRegistryPath('/home/tester'),
    '/home/tester/.peers-touch/dev/registry.json',
  );
  assert.equal(
    machineRegistryLockPath('/home/tester'),
    '/home/tester/.peers-touch/dev/registry.lock',
  );
  assert.equal(
    machineLeaseRoot('/home/tester'),
    '/home/tester/.peers-touch/dev/leases',
  );
  assert.equal(
    machineLeasePath('station.deploy', 'station-four', '/home/tester'),
    '/home/tester/.peers-touch/dev/leases/station-deploy-station-four.lock',
  );
});

test('supports an explicit isolated machine Dev root', () => {
  const previous = process.env.PT_MACHINE_DEV_ROOT;
  process.env.PT_MACHINE_DEV_ROOT = '/tmp/peers-touch-machine-dev-test';
  try {
    assert.equal(
      machineDevRoot(),
      '/tmp/peers-touch-machine-dev-test',
    );
    assert.equal(
      machineRegistryPath(),
      '/tmp/peers-touch-machine-dev-test/registry.json',
    );
  } finally {
    if (previous === undefined) {
      delete process.env.PT_MACHINE_DEV_ROOT;
    } else {
      process.env.PT_MACHINE_DEV_ROOT = previous;
    }
  }
});

test('rejects runtime names that can escape the workspace root', () => {
  assert.throws(() => workspaceRuntimePath('../outside'), /Invalid workspace runtime name/);
  assert.throws(() => workspaceRuntimePath('/absolute'), /Invalid workspace runtime name/);
  assert.throws(
    () => workspaceWorkflowPath('../outside'),
    /Invalid development work item/,
  );
  assert.throws(
    () => machineLeasePath('station.deploy', '../outside', '/home/tester'),
    /Invalid lease resource id/,
  );
});
