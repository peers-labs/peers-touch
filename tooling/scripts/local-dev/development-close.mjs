#!/usr/bin/env node

import { isDirectInvocation, repoRoot } from '../lib/machine-dev-paths.mjs';
import {
  closeTaskProgress,
  readTaskProgress,
  TaskProgressError,
} from './task-progress-store.mjs';

const CLOSE_REASONS = new Set(['completed', 'cancelled']);

export class DevelopmentCloseError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DevelopmentCloseError';
    this.code = code;
    this.details = details;
    this.detail = details;
  }
}

function fail(code, message, details = {}) {
  throw new DevelopmentCloseError(code, message, details);
}

function taskOptions(options = {}) {
  const taskId = options.taskId;
  if (typeof taskId !== 'string' || taskId === '') {
    fail('DEVELOPMENT_CLOSE_INVALID', 'taskId is required');
  }
  return {
    workspaceRoot: options.workspaceRoot ?? repoRoot,
    taskId,
  };
}

export async function closeDevelopment(options = {}) {
  const selected = taskOptions(options);
  const closeReason = options.closeReason ?? options.reason;
  if (!CLOSE_REASONS.has(closeReason)) {
    fail(
      'DEVELOPMENT_CLOSE_INVALID',
      'closeReason must be completed or cancelled',
    );
  }
  const current = readTaskProgress(selected);
  try {
    return closeTaskProgress({
      ...selected,
      expectedRevision:
        options.expectedRevision === undefined
          ? current.revision
          : options.expectedRevision,
      state: closeReason === 'completed' ? 'completed' : 'cancelled',
      evidenceRefs: options.evidenceRefs,
      resourceRefs: options.resourceRefs,
      reason:
        options.closeNote ??
        `Task ${closeReason}; close affects only this task record.`,
      now: options.now,
    });
  } catch (error) {
    if (error instanceof TaskProgressError) {
      fail(error.code, error.message, error.detail);
    }
    throw error;
  }
}

const OPTION_NAMES = {
  'workspace-root': 'workspaceRoot',
  task: 'taskId',
  reason: 'closeReason',
  'expected-revision': 'expectedRevision',
  'evidence-refs': 'evidenceRefsJson',
  'resource-refs': 'resourceRefsJson',
};

function parseJson(value, field) {
  try {
    return JSON.parse(value);
  } catch (error) {
    fail('DEVELOPMENT_CLOSE_INVALID', `${field} is not valid JSON`, {
      cause: String(error),
    });
  }
}

function parseArguments(argv) {
  const [action, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    const optionName = token.startsWith('--')
      ? OPTION_NAMES[token.slice(2)]
      : undefined;
    if (!optionName) {
      fail('DEVELOPMENT_CLOSE_INVALID', `unsupported option: ${token}`);
    }
    const value = rest[index + 1];
    if (value === undefined || value.startsWith('--')) {
      fail('DEVELOPMENT_CLOSE_INVALID', `missing value for ${token}`);
    }
    options[optionName] = value;
    index += 1;
  }
  if (options.evidenceRefsJson !== undefined) {
    options.evidenceRefs = parseJson(
      options.evidenceRefsJson,
      'evidenceRefs',
    );
    delete options.evidenceRefsJson;
  }
  if (options.resourceRefsJson !== undefined) {
    options.resourceRefs = parseJson(
      options.resourceRefsJson,
      'resourceRefs',
    );
    delete options.resourceRefsJson;
  }
  return { action, options };
}

function output(value, stream = process.stdout) {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

export async function runCli(argv, io = {}) {
  const { action, options } = parseArguments(argv);
  if (action !== 'close') {
    fail('DEVELOPMENT_CLOSE_INVALID', 'action must be close');
  }
  const result = await closeDevelopment(options);
  (io.output ?? output)(result);
  return result;
}

if (isDirectInvocation(import.meta.url)) {
  try {
    await runCli(process.argv.slice(2));
  } catch (error) {
    output(
      {
        status: 'BLOCKED',
        code: error?.code ?? 'DEVELOPMENT_CLOSE_INTERNAL_ERROR',
        message: error?.message ?? String(error),
        detail: error?.detail ?? error?.details ?? {},
      },
      process.stderr,
    );
    process.exitCode = 2;
  }
}
