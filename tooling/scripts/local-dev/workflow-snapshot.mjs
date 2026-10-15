#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import path from 'node:path';

import { isDirectInvocation, repoRoot } from '../lib/machine-dev-paths.mjs';
import { inspectGitWorkspace } from './git-workspace.mjs';
import { inspectTaskProgressList } from './task-progress-store.mjs';

export async function buildStandaloneWorkflowSnapshot(options = {}) {
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw Object.assign(new Error('snapshot clock is invalid'), {
      code: 'WORKFLOW_SNAPSHOT_CLOCK_INVALID',
    });
  }
  const roots = options.workspaceRoots ?? [options.repoRoot ?? repoRoot];
  const worktrees = [];
  const errors = [];
  for (const candidate of roots) {
    try {
      const root = realpathSync(candidate);
      const source = inspectGitWorkspace(root, {
        excludePaths: ['.dev-workflow'],
      });
      const progress = inspectTaskProgressList({ workspaceRoot: root });
      worktrees.push({
        canonicalRoot: root,
        workspaceId: source.workspaceId,
        source,
        tasks: progress.tasks,
        taskErrors: progress.invalid,
      });
    } catch (error) {
      errors.push({
        workspaceRoot: path.resolve(candidate),
        code: error?.code ?? 'WORKFLOW_SNAPSHOT_PARTIAL',
        message: error?.message ?? String(error),
      });
    }
  }
  const snapshot = {
    kind: 'peers-touch-standalone-workflow-snapshot',
    schemaVersion: 1,
    observedAt: now.toISOString(),
    worktrees,
    errors,
    runtime: options.machineStatus ?? null,
  };
  return {
    ...snapshot,
    digest: createHash('sha256')
      .update(JSON.stringify({ ...snapshot, observedAt: null }))
      .digest('hex'),
  };
}

if (isDirectInvocation(import.meta.url)) {
  try {
    const snapshot = await buildStandaloneWorkflowSnapshot();
    process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        ok: false,
        error: {
          code: error?.code ?? 'WORKFLOW_SNAPSHOT_UNAVAILABLE',
          message: error?.message ?? String(error),
        },
      })}\n`,
    );
    process.exitCode = 2;
  }
}
