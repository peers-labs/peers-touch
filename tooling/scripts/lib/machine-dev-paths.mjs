import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const repoRoot = realpathSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..'),
);

export function workspaceIdForRoot(root = repoRoot) {
  const canonicalRoot = realpathSync(root);
  return createHash('sha256').update(canonicalRoot).digest('hex').slice(0, 16);
}

export function machineDevRoot(home = homedir()) {
  return path.join(home, '.peers-touch', 'dev');
}

export function developmentWorkLedgerPath(home = homedir()) {
  return path.join(machineDevRoot(home), 'work.json');
}

export function developmentWorkLockPath(home = homedir()) {
  return path.join(machineDevRoot(home), 'work.lock');
}

export function workspaceWorkflowPath(workItemId, options = {}) {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(workItemId)) {
    throw new Error(`Invalid development work item: ${workItemId}`);
  }

  const root = options.repoRoot ?? repoRoot;
  return path.join(
    machineDevRoot(options.home),
    'workspaces',
    workspaceIdForRoot(root),
    'workflow',
    workItemId,
  );
}

export function workspaceRuntimePath(name, options = {}) {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) {
    throw new Error(`Invalid workspace runtime name: ${name}`);
  }

  const root = options.repoRoot ?? repoRoot;
  return path.join(
    machineDevRoot(options.home),
    'workspaces',
    workspaceIdForRoot(root),
    'runtime',
    name,
  );
}

export function workspaceRuntimeRef(name, root = repoRoot) {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) {
    throw new Error(`Invalid workspace runtime name: ${name}`);
  }
  return `~/.peers-touch/dev/workspaces/${workspaceIdForRoot(root)}/runtime/${name}`;
}
