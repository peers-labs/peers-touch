import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const WORKSPACE_ID = /^[0-9a-f]{16}$/;

export const repoRoot = realpathSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..'),
);

function requireIdentifier(value, label) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return value;
}

function resolveWorkspaceId(options = {}) {
  if (options.workspaceId !== undefined) {
    if (
      typeof options.workspaceId !== 'string' ||
      !WORKSPACE_ID.test(options.workspaceId)
    ) {
      throw new Error(`Invalid workspace ID: ${options.workspaceId}`);
    }
    return options.workspaceId;
  }
  return workspaceIdForRoot(options.repoRoot ?? repoRoot);
}

export function workspaceIdForRoot(root = repoRoot) {
  const canonicalRoot = realpathSync(root);
  return createHash('sha256').update(canonicalRoot).digest('hex').slice(0, 16);
}

export function machineDevRoot(home = homedir()) {
  const override = process.env.PT_MACHINE_DEV_ROOT?.trim();
  if (override) return path.resolve(override);
  return path.join(home, '.peers-touch', 'dev');
}

export function machineRegistryPath(home = homedir()) {
  return path.join(machineDevRoot(home), 'registry.json');
}

export function machineRegistryLockPath(home = homedir()) {
  return path.join(machineDevRoot(home), 'registry.lock');
}

export function machineLeaseRoot(home = homedir()) {
  return path.join(machineDevRoot(home), 'leases');
}

export function machineLeasePath(resourceKind, resourceId, home = homedir()) {
  const kind = requireIdentifier(resourceKind, 'lease resource kind').replaceAll(
    '.',
    '-',
  );
  const resource = requireIdentifier(resourceId, 'lease resource id');
  return path.join(machineLeaseRoot(home), `${kind}-${resource}.lock`);
}

export function developmentWorkLedgerPath(home = homedir()) {
  return path.join(machineDevRoot(home), 'work.json');
}

export function developmentWorkLockPath(home = homedir()) {
  return path.join(machineDevRoot(home), 'work.lock');
}

export function machineWorkspacesPath(home = homedir()) {
  return path.join(machineDevRoot(home), 'workspaces');
}

export function workspaceStatePath(options = {}) {
  return path.join(machineWorkspacesPath(options.home), resolveWorkspaceId(options));
}

export function workspaceWorkflowRootPath(options = {}) {
  return path.join(workspaceStatePath(options), 'workflow');
}

export function workspaceActiveWorkPath(options = {}) {
  return path.join(workspaceWorkflowRootPath(options), 'active-work.json');
}

export function workspaceActiveWorkLockPath(options = {}) {
  return path.join(workspaceWorkflowRootPath(options), 'active-work.lock');
}

export function workspaceWorkflowPath(workItemId, options = {}) {
  requireIdentifier(workItemId, 'development work item');
  return path.join(
    workspaceWorkflowRootPath(options),
    workItemId,
  );
}

export function workspaceRuntimePath(name, options = {}) {
  requireIdentifier(name, 'workspace runtime name');
  return path.join(
    machineDevRoot(options.home),
    'workspaces',
    resolveWorkspaceId(options),
    'runtime',
    name,
  );
}

export function workspaceRuntimeRef(name, root = repoRoot) {
  requireIdentifier(name, 'workspace runtime name');
  return `~/.peers-touch/dev/workspaces/${workspaceIdForRoot(root)}/runtime/${name}`;
}

export function isDirectInvocation(metaUrl, argvPath = process.argv[1]) {
  if (!argvPath) return false;
  try {
    return (
      realpathSync(path.resolve(argvPath)) === realpathSync(fileURLToPath(metaUrl))
    );
  } catch {
    return false;
  }
}
