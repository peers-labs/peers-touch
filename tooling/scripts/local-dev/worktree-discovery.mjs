import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';

import { workspaceIdForRoot } from '../lib/machine-dev-paths.mjs';

export class WorktreeDiscoveryError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'WorktreeDiscoveryError';
    this.code = code;
    this.detail = detail;
  }
}

function parseRecord(fields, checkedAt) {
  const values = {};
  for (const field of fields) {
    const separator = field.indexOf(' ');
    const key = separator < 0 ? field : field.slice(0, separator);
    const value = separator < 0 ? true : field.slice(separator + 1);
    values[key] = value;
  }
  if (typeof values.worktree !== 'string' || typeof values.HEAD !== 'string') {
    throw new WorktreeDiscoveryError(
      'WORKTREE_DISCOVERY_INVALID',
      'git worktree record is incomplete',
    );
  }
  let canonicalRoot;
  try {
    canonicalRoot = realpathSync(values.worktree);
  } catch {
    return null;
  }
  const branch =
    typeof values.branch === 'string'
      ? values.branch.replace(/^refs\/heads\//, '')
      : null;
  return {
    workspaceId: workspaceIdForRoot(canonicalRoot),
    canonicalRoot,
    name: path.basename(canonicalRoot),
    branch,
    head: values.HEAD,
    detached: values.detached === true || branch === null,
    checkedAt,
  };
}

export function parseGitWorktreeList(output, checkedAt) {
  return output
    .split('\0\0')
    .map((record) => record.split('\0').filter(Boolean))
    .filter((fields) => fields.length > 0)
    .map((fields) => parseRecord(fields, checkedAt))
    .filter(Boolean)
    .sort((left, right) => left.workspaceId.localeCompare(right.workspaceId));
}

export function discoverGitWorktrees(options = {}) {
  const checkedAt = (options.now ?? new Date()).toISOString();
  let output;
  try {
    output = (options.execFileSync ?? execFileSync)(
      'git',
      ['worktree', 'list', '--porcelain', '-z'],
      {
        cwd: options.repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  } catch (error) {
    throw new WorktreeDiscoveryError(
      'WORKTREE_DISCOVERY_UNAVAILABLE',
      'cannot enumerate Git worktrees',
      { cause: error?.stderr?.toString().trim() || String(error) },
    );
  }
  return {
    checkedAt,
    records: parseGitWorktreeList(output, checkedAt),
  };
}
