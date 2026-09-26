#!/usr/bin/env node

import { isDirectInvocation } from '../lib/machine-dev-paths.mjs';
import {
  reportWorktreeObservation,
  WorktreeObservationError,
} from './worktree-observation-store.mjs';

function parseArguments(argv) {
  const options = {};
  const allowed = new Set(['workspace-root', 'home', 'host', 'event']);
  for (let index = 0; index < argv.length; index += 2) {
    const token = argv[index];
    if (!token?.startsWith('--') || !allowed.has(token.slice(2))) {
      throw new WorktreeObservationError(
        'WORKTREE_OBSERVATION_ARGUMENT_INVALID',
        `unsupported argument: ${token ?? '<missing>'}`,
      );
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new WorktreeObservationError(
        'WORKTREE_OBSERVATION_ARGUMENT_INVALID',
        `missing value for ${token}`,
      );
    }
    options[token.slice(2)] = value;
  }
  return {
    workspaceRoot: options['workspace-root'],
    home: options.home,
    host: options.host,
    event: options.event,
  };
}

export function run(argv = process.argv.slice(2)) {
  return reportWorktreeObservation(parseArguments(argv));
}

if (isDirectInvocation(import.meta.url)) {
  try {
    process.stdout.write(`${JSON.stringify(run(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        status: 'BLOCKED',
        code: error.code ?? 'WORKTREE_OBSERVATION_FAILED',
        message: error.message,
        detail: error.detail ?? {},
      })}\n`,
    );
    process.exitCode = 1;
  }
}
