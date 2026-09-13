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

export function machineDevRoot(home) {
  if (home !== undefined) {
    return path.join(home, '.peers-touch', 'dev');
  }
  const override = process.env.PT_MACHINE_DEV_ROOT?.trim();
  if (override) {
    if (!path.isAbsolute(override)) {
      throw new Error('PT_MACHINE_DEV_ROOT must be absolute');
    }
    return path.resolve(override);
  }
  return path.join(homedir(), '.peers-touch', 'dev');
}

export function developmentWorkLedgerPath(home) {
  return path.join(machineDevRoot(home), 'work.json');
}

export function developmentWorkLockPath(home) {
  return path.join(machineDevRoot(home), 'work.lock');
}

export function machineRegistryPath(home) {
  return path.join(machineDevRoot(home), 'registry.json');
}

export function machineRegistryLockPath(home) {
  return path.join(machineDevRoot(home), 'registry.lock');
}

export function machineLeaseRoot(home) {
  return path.join(machineDevRoot(home), 'leases');
}

function requiredLeaseIdentifier(value, field) {
  if (
    typeof value !== 'string' ||
    !/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(value)
  ) {
    throw new Error(`Invalid ${field}: ${value}`);
  }
  return value;
}

export function machineLeasePath(resourceKind, resourceId, home = homedir()) {
  const kind = requiredLeaseIdentifier(resourceKind, 'lease resource kind');
  const id = requiredLeaseIdentifier(resourceId, 'lease resource id');
  return path.join(machineLeaseRoot(home), `${kind.replaceAll('.', '-')}-${id}.lock`);
}

export function workspaceStatePath(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  return path.join(
    machineDevRoot(options.home),
    'workspaces',
    workspaceIdForRoot(root),
  );
}

export function workspaceWorkflowPath(workItemId, options = {}) {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(workItemId)) {
    throw new Error(`Invalid development work item: ${workItemId}`);
  }

  return path.join(
    workspaceStatePath(options),
    'workflow',
    workItemId,
  );
}

export function workspaceRuntimePath(name, options = {}) {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) {
    throw new Error(`Invalid workspace runtime name: ${name}`);
  }

  return path.join(
    workspaceStatePath(options),
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
