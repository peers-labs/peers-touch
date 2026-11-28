#!/usr/bin/env node

import { isDirectInvocation } from '../lib/machine-dev-paths.mjs';
import { createHash } from 'node:crypto';
import {
  readSurfaceLedger, sourceRoot, surfaceContext, updateSurfaceFeedback, verifySurfaceAuthority,
} from '../review/ui-surface-authority.mjs';
import {
  createTaskProgress,
  listTaskProgress,
  readTaskProgress,
  TaskProgressError,
  updateTaskProgress,
} from './task-progress-store.mjs';

export {
  createTaskProgress,
  inspectTaskProgress,
  inspectTaskProgressList,
  listTaskProgress,
  readTaskProgress,
  TaskProgressError,
  updateTaskProgress,
} from './task-progress-store.mjs';

const OPTION_NAMES = {
  task: 'taskId',
  goal: 'goal',
  contribution: 'contribution',
  'north-star-ref': 'northStarRef',
  stage: 'stage',
  state: 'state',
  'next-action': 'nextAction',
  'expected-revision': 'expectedRevision',
  reason: 'reason',
  'plan-ref': 'planRefJson',
  'scope-paths': 'scopePaths',
  'scope-exclusions': 'scopeExclusions',
  'authorization-refs': 'authorizationRefsJson',
  'evidence-refs': 'evidenceRefsJson',
  'resource-refs': 'resourceRefsJson',
  blocker: 'blockerJson',
  'workspace-root': 'workspaceRoot',
  kind: 'kind',
  surface: 'surfaceId',
  feedback: 'feedbackId',
  request: 'request',
  'request-ref': 'requestRef',
  target: 'target',
  evidence: 'evidence',
  by: 'by',
  'source-digest': 'sourceDigest',
};

function parseJson(value, field) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new TaskProgressError(
      'TASK_PROGRESS_INVALID',
      `${field} is not valid JSON`,
      { cause: String(error) },
    );
  }
}

function parseList(value) {
  if (value === undefined || value === '') return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function parseArguments(argv) {
  const [action, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) {
      throw new TaskProgressError(
        'TASK_PROGRESS_INVALID',
        `unexpected argument: ${token}`,
      );
    }
    const key = token.slice(2);
    const optionName = OPTION_NAMES[key];
    if (!optionName) {
      throw new TaskProgressError(
        'TASK_PROGRESS_INVALID',
        `unsupported option: --${key}`,
      );
    }
    const value = rest[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new TaskProgressError(
        'TASK_PROGRESS_INVALID',
        `missing value for --${key}`,
      );
    }
    options[optionName] = value;
    index += 1;
  }
  for (const field of ['scopePaths', 'scopeExclusions']) {
    if (options[field] !== undefined) options[field] = parseList(options[field]);
  }
  for (const [source, target] of [
    ['planRefJson', 'planRef'],
    ['authorizationRefsJson', 'authorizationRefs'],
    ['evidenceRefsJson', 'evidenceRefs'],
    ['resourceRefsJson', 'resourceRefs'],
    ['blockerJson', 'blocker'],
  ]) {
    if (options[source] !== undefined) {
      options[target] = parseJson(options[source], source);
      delete options[source];
    }
  }
  return { action, options };
}

function output(value, stream = process.stdout) {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function runCli(argv, io = {}) {
  const { action, options } = parseArguments(argv);
  const write = io.output ?? output;
  let result;
  switch (action) {
    case 'intake': {
      const root = options.workspaceRoot ?? sourceRoot;
      if (options.kind !== 'ui-feedback') {
        if (options.kind !== undefined) throw new TaskProgressError('TASK_PROGRESS_INVALID', 'unknown intake kind');
        result = { stage: 'intake', uiSurfaces: surfaceContext(root, options.scopePaths ?? [], { optional: true }) };
        break;
      }
      const matches = options.surfaceId ? readSurfaceLedger(root).filter(surface => surface.id === options.surfaceId)
        : surfaceContext(root, options.scopePaths ?? []);
      if (matches.length !== 1) throw new TaskProgressError('UI_SURFACE_SELECTION_REQUIRED', 'select one registered UI surface');
      const surfaceId = matches[0].id;
      if (!options.requestRef?.trim()) throw new TaskProgressError('UI_SURFACE_ARGUMENT_INVALID', 'request-ref is required');
      const feedbackId = options.feedbackId ?? `feedback-${createHash('sha256').update(`${surfaceId}\0${options.requestRef}`).digest('hex').slice(0, 24)}`;
      result = updateSurfaceFeedback(root, 'feedback', { ...options, surfaceId, feedbackId });
      break;
    }
    case 'ui-review':
    case 'ui-confirm':
      result = updateSurfaceFeedback(options.workspaceRoot ?? sourceRoot, action.slice(3), options);
      break;
    case 'before-implement':
      if (!options.surfaceId) throw new TaskProgressError('UI_SURFACE_SELECTION_REQUIRED', 'surface is required');
      result = verifySurfaceAuthority(options.workspaceRoot ?? sourceRoot, { surfaceIds: [options.surfaceId] });
      break;
    case 'start':
      result = createTaskProgress(options);
      break;
    case 'update':
      result = updateTaskProgress(options);
      break;
    case 'status':
      result = readTaskProgress(options);
      break;
    case 'status-all':
      result = listTaskProgress(options);
      break;
    default:
      throw new TaskProgressError(
        'TASK_PROGRESS_INVALID',
        'action must be intake, ui-review, ui-confirm, before-implement, start, update, status, or status-all',
      );
  }
  write(result);
  return result;
}

function reportError(error) {
  const payload =
    typeof error?.code === 'string'
      ? {
          status: 'BLOCKED',
          code: error.code,
          message: error.message,
          detail: error.detail ?? error.details ?? {},
        }
      : {
          status: 'BLOCKED',
          code: 'TASK_PROGRESS_INTERNAL_ERROR',
          message: String(error),
        };
  output(payload, process.stderr);
  process.exitCode = 2;
}

if (isDirectInvocation(import.meta.url)) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    reportError(error);
  }
}
