import { existsSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  captureTaskWorkspace,
  inspectTaskProgress,
} from './task-progress-store.mjs';

function nearestExistingPath(candidate) {
  let current = path.resolve(candidate);
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return lstatSync(current).isFile() ? path.dirname(current) : current;
}

export function resolveProjectRoot(candidate) {
  if (!candidate) return null;
  try {
    const start = nearestExistingPath(candidate);
    if (start === null) return null;
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: start,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (
      !existsSync(path.join(root, 'tooling', 'skills', 'pt-ew', 'SKILL.md')) ||
      !existsSync(
        path.join(root, 'tooling', 'scripts', 'local-dev', 'dev-work.mjs'),
      )
    ) {
      return null;
    }
    return realpathSync(root);
  } catch {
    return null;
  }
}

function mismatch(code, message, detail = {}) {
  return { status: 'HARD_BLOCK', code, message, detail };
}

export function inspectStandaloneWorkflowContext(options = {}) {
  let workspace;
  try {
    workspace = captureTaskWorkspace(
      options.workspaceRoot ?? options.executionRoot,
    );
  } catch (error) {
    return mismatch(
      error?.code ?? 'WORKTREE_IDENTITY_UNAVAILABLE',
      error?.message ?? String(error),
    );
  }
  const base = {
    status: 'READY',
    mode: 'standalone',
    head: workspace.head,
    branch: workspace.branch,
    canonicalRoot: workspace.canonicalRoot,
    workspaceId: workspace.workspaceId,
    skillRoot: path.join(workspace.canonicalRoot, 'tooling', 'skills'),
  };
  if (options.taskId === undefined || options.taskId === null) {
    return { ...base, tracked: false, task: null };
  }
  try {
    const inspected = inspectTaskProgress({
      workspaceRoot: workspace.canonicalRoot,
      taskId: options.taskId,
    });
    return {
      ...base,
      tracked: true,
      task: {
        ...inspected.record,
        projectionState: inspected.snapshotState,
      },
    };
  } catch (error) {
    return mismatch(
      error?.code ?? 'TASK_PROGRESS_UNAVAILABLE',
      error?.message ?? String(error),
      { taskId: options.taskId },
    );
  }
}
