#!/usr/bin/env node

import {
  buildDevSnapshot,
  deriveWorktrees,
  workflowProjection,
} from '../../../apps/dev/server/status.mjs';
import { isDirectInvocation } from '../lib/machine-dev-paths.mjs';

export { deriveWorktrees, workflowProjection };

export async function buildWorkflowSnapshot(options = {}) {
  return buildDevSnapshot(options);
}

if (isDirectInvocation(import.meta.url)) {
  try {
    const snapshot = await buildWorkflowSnapshot();
    process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        ok: false,
        error: {
          code: error?.code ?? 'WORKFLOW_SNAPSHOT_UNAVAILABLE',
          message: 'Workflow snapshot is unavailable',
        },
      })}\n`,
    );
    process.exitCode = 2;
  }
}
