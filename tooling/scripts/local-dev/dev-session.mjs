#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import path from 'node:path';

import {
  isDirectInvocation,
  repoRoot,
  workspaceIdForRoot,
} from '../lib/machine-dev-paths.mjs';
import { loadPlanPackage } from '../plan/plan-package.mjs';
import { resolveWorkspacePlanBinding } from '../plan/workspace-plan-binding.mjs';
import { canonicalize } from './dev-work-schema.mjs';
import { requireActiveDeclaration } from './dev-work-ledger.mjs';
import {
  DevSessionError,
  createInitialSessionState,
  sessionFail,
} from './dev-session-schema.mjs';
import {
  createSessionStore,
  loadSessionStore,
  readSessionJournal,
  sessionStorePaths,
  transitionSessionStore,
} from './dev-session-store.mjs';

export {
  DevSessionError,
  createInitialSessionState,
  digestEvent,
  transitionSessionState,
  validateSession,
  validateSessionState,
  validateTransitionEvent,
} from './dev-session-schema.mjs';
export {
  MAX_SESSION_EVENTS,
  MAX_SESSION_EVENT_BYTES,
  createTransitionEvent,
  createSessionStore,
  loadSessionStore,
  readSessionJournal,
  sessionStorePaths,
  transitionSessionStore,
} from './dev-session-store.mjs';

function operationDate(options = {}) {
  const value =
    typeof options.clock === 'function'
      ? options.clock()
      : options.now ?? new Date();
  const now = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(now.getTime())) {
    sessionFail('INVALID_CLOCK', 'operation clock returned an invalid time');
  }
  return now;
}

function asSessionError(error) {
  if (error instanceof DevSessionError) return error;
  if (typeof error?.code === 'string') {
    return new DevSessionError(
      error.code,
      error.message ?? String(error),
      error.detail ?? error.details ?? {},
    );
  }
  return error;
}

function segmentContains(prefix, candidate) {
  return candidate === prefix || candidate.startsWith(`${prefix}/`);
}

function assertDeclarationScope(declaration, task) {
  for (const target of task.writeSet) {
    const covered = declaration.sourceClaims.some(
      (claim) =>
        claim.mode === 'exclusive-write' &&
        segmentContains(claim.pathPrefix, target),
    );
    if (!covered) {
      sessionFail(
        'SESSION_SCOPE_MISMATCH',
        'Task writeSet escapes the ACTIVE declaration',
        { taskId: task.taskId, path: target },
      );
    }
  }
}

function repositoryRelative(root, target) {
  return path.relative(root, target).split(path.sep).join('/');
}

function assertPlanAndDeclaration(
  options,
  plan,
  declaration,
  workspacePlanBinding,
) {
  const { manifest, currentTask } = plan;
  if (manifest.status !== 'active' || currentTask === null) {
    sessionFail(
      'SESSION_PLAN_INVALID',
      'Session requires an active package with one current Task',
      { planId: manifest.planId, status: manifest.status },
    );
  }
  const currentEntries = manifest.tasks.filter(
    (task) => task.status === 'in_progress',
  );
  if (
    currentEntries.length !== 1 ||
    currentEntries[0].id !== currentTask.taskId
  ) {
    sessionFail(
      'SESSION_PLAN_INVALID',
      'manifest current Task does not match the loaded Task Slice',
    );
  }
  if (options.taskId !== undefined && currentTask.taskId !== options.taskId) {
    sessionFail('SESSION_IDENTITY_MISMATCH', 'requested Task is not current', {
      requested: options.taskId,
      current: currentTask.taskId,
    });
  }
  if (currentTask.planId !== manifest.planId) {
    sessionFail(
      'SESSION_IDENTITY_MISMATCH',
      'current Task does not match its Plan Package',
    );
  }
  if (
    options.journeyId !== undefined &&
    options.journeyId !== currentTask.journeyId
  ) {
    sessionFail('SESSION_IDENTITY_MISMATCH', 'requested Journey is not current', {
      requested: options.journeyId,
      current: currentTask.journeyId,
    });
  }
  const binding = manifest.binding;
  const planPath = repositoryRelative(plan.repoRoot, plan.path);
  const mismatches = {};
  for (const [field, actual] of [
    ['workspaceId', declaration.workspaceId],
    ['branch', declaration.branch],
  ]) {
    if (binding[field] !== actual) {
      mismatches[field] = { expected: binding[field], actual };
    }
  }
  for (const [field, expected, actual] of [
    ['declarationPlanId', manifest.planId, declaration.planId],
    ['declarationPlanPath', planPath, declaration.planPath],
    ['declarationTaskId', currentTask.taskId, declaration.taskId],
    ['boundPlanId', manifest.planId, workspacePlanBinding.planId],
    ['boundPlanPath', planPath, workspacePlanBinding.planPath],
  ]) {
    if (expected !== actual) {
      mismatches[field] = { expected, actual };
    }
  }
  if (
    declaration.journeyId !== null &&
    declaration.journeyId !== currentTask.journeyId
  ) {
    mismatches.journeyId = {
      expected: currentTask.journeyId,
      actual: declaration.journeyId,
    };
  }
  if (
    options.sessionId !== undefined &&
    options.sessionId !== declaration.sessionId
  ) {
    mismatches.sessionId = {
      expected: declaration.sessionId,
      actual: options.sessionId,
    };
  }
  if (Object.keys(mismatches).length > 0) {
    sessionFail(
      'SESSION_IDENTITY_MISMATCH',
      'Plan, declaration, and Session identity do not match',
      { mismatches },
    );
  }
  assertDeclarationScope(declaration, currentTask);
}

function defaultBindingVerifier({ repoRoot: root, binding, sourceHead }) {
  const verifier = path.join(root, 'tooling', 'scripts', 'verify-worktree-binding.py');
  let output;
  try {
    output = execFileSync(
      'python3',
      [
        verifier,
        '--root',
        root,
        '--branch',
        binding.branch,
        '--workspace-id',
        binding.workspaceId,
        '--head',
        sourceHead,
      ],
      {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  } catch (error) {
    sessionFail(
      'WORKTREE_IDENTITY_MISMATCH',
      'Plan identity and declared source HEAD do not match the worktree',
      { cause: error?.stderr?.trim?.() || String(error) },
    );
  }
  try {
    return JSON.parse(output);
  } catch (error) {
    sessionFail(
      'WORKTREE_IDENTITY_UNAVAILABLE',
      'worktree verifier returned invalid output',
      { cause: String(error) },
    );
  }
}

async function loadBoundContext(options, dependencies = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? repoRoot);
  let declaration;
  let plan;
  let workspacePlanBinding;
  try {
    declaration = requireActiveDeclaration({
      home: options.home,
      workspaceRoot,
      workItemId: options.workItemId,
      sessionId: options.sessionId,
      clock: options.clock,
      now: options.now,
      lockTimeoutMs: options.lockTimeoutMs,
    });
    const loader = dependencies.loadPlanPackage ?? loadPlanPackage;
    plan = await loader(options.planPath, {
      repoRoot: workspaceRoot,
      declaration,
    });
    const resolvePlanBinding =
      dependencies.resolveWorkspacePlanBinding ?? resolveWorkspacePlanBinding;
    workspacePlanBinding = await resolvePlanBinding({
      repoRoot: workspaceRoot,
      home: options.home,
    });
  } catch (error) {
    throw asSessionError(error);
  }
  assertPlanAndDeclaration(
    options,
    plan,
    declaration,
    workspacePlanBinding,
  );
  const verifyBinding = dependencies.verifyBinding ?? defaultBindingVerifier;
  const verified = await verifyBinding({
    repoRoot: plan.repoRoot,
    binding: plan.manifest.binding,
    sourceHead: declaration.sourceHead,
  });
  if (
    verified?.workspaceId !== plan.manifest.binding.workspaceId ||
    verified?.branch !== plan.manifest.binding.branch ||
    verified?.head !== declaration.sourceHead
  ) {
    sessionFail(
      'WORKTREE_IDENTITY_MISMATCH',
      'worktree verifier result does not match Plan identity and declared source HEAD',
      {
        binding: plan.manifest.binding,
        sourceHead: declaration.sourceHead,
        verified,
      },
    );
  }
  return { declaration, plan, workspaceRoot };
}

function storeOptions(options, workspaceId) {
  return {
    home: options.home,
    workspaceRoot: options.workspaceRoot ?? repoRoot,
    workspaceId,
    workItemId: options.workItemId,
    clock: options.clock,
    now: options.now,
    lockTimeoutMs: options.lockTimeoutMs,
    maxEvents: options.maxEvents,
    maxBytes: options.maxBytes,
  };
}

export async function startDevelopmentSession(options, dependencies = {}) {
  if (typeof options.taskId !== 'string' || typeof options.journeyId !== 'string') {
    sessionFail('INVALID_ARGUMENT', 'start requires --task and --journey');
  }
  const { declaration, plan, workspaceRoot } = await loadBoundContext(
    options,
    dependencies,
  );
  const at = operationDate(options).toISOString();
  const state = createInitialSessionState(
    {
      sessionId: declaration.sessionId,
      workItemId: declaration.workItemId,
      planId: plan.manifest.planId,
      taskId: plan.currentTask.taskId,
      workspaceId: plan.manifest.binding.workspaceId,
      branch: plan.manifest.binding.branch,
      journeyId: plan.currentTask.journeyId,
      executionMode: plan.currentTask.executionMode,
    },
    at,
  );
  return createSessionStore(state, {
    ...storeOptions({ ...options, workspaceRoot }, state.workspaceId),
    reason: options.reason ?? 'Bound ACTIVE declaration to current Task',
  });
}

export function statusDevelopmentSession(options) {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? repoRoot);
  const workspaceId = options.workspaceId ?? workspaceIdForRoot(workspaceRoot);
  return loadSessionStore({
    ...storeOptions({ ...options, workspaceRoot }, workspaceId),
    expected: {
      workItemId: options.workItemId,
      workspaceId,
      sessionId: options.sessionId,
      planId: options.planId,
      taskId: options.taskId,
      branch: options.branch,
    },
  });
}

export async function transitionDevelopmentSession(options, dependencies = {}) {
  const { declaration, plan, workspaceRoot } = await loadBoundContext(
    options,
    dependencies,
  );
  return transitionSessionStore({
    ...storeOptions(
      { ...options, workspaceRoot },
      plan.manifest.binding.workspaceId,
    ),
    expected: {
      sessionId: declaration.sessionId,
      workItemId: declaration.workItemId,
      planId: plan.manifest.planId,
      taskId: plan.currentTask.taskId,
      workspaceId: plan.manifest.binding.workspaceId,
      branch: plan.manifest.binding.branch,
    },
    to: options.to,
    reason: options.reason,
    updates: options.updates ?? {},
    context: {
      task: plan.currentTask,
      acceptance: plan.acceptance,
      authorization: plan.manifest.authorization,
    },
  });
}

const OPTION_NAMES = {
  home: 'home',
  'workspace-root': 'workspaceRoot',
  'workspace-id': 'workspaceId',
  'work-item': 'workItemId',
  session: 'sessionId',
  plan: 'planPath',
  task: 'taskId',
  journey: 'journeyId',
  to: 'to',
  reason: 'reason',
  source: 'source',
  verification: 'verification',
  failure: 'failure',
  'runtime-binding-ref': 'runtimeBindingRef',
};
const JSON_OPTIONS = new Set(['source', 'verification', 'failure']);

function parseArguments(argv) {
  const [action, ...rest] = argv;
  const options = {};
  const updates = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) {
      sessionFail('INVALID_ARGUMENT', `unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const optionKey = OPTION_NAMES[key];
    if (!optionKey) {
      sessionFail('INVALID_ARGUMENT', `unsupported option: --${key}`);
    }
    const raw = rest[index + 1];
    if (raw === undefined || raw.startsWith('--')) {
      sessionFail('INVALID_ARGUMENT', `missing value for --${key}`);
    }
    index += 1;
    let value = raw;
    if (JSON_OPTIONS.has(optionKey)) {
      try {
        value = JSON.parse(raw);
      } catch (error) {
        sessionFail('INVALID_ARGUMENT', `--${key} must be valid JSON`, {
          cause: String(error),
        });
      }
    }
    if (
      ['source', 'verification', 'failure', 'runtimeBindingRef'].includes(
        optionKey,
      )
    ) {
      updates[optionKey] = value;
    } else {
      options[optionKey] = value;
    }
  }
  if (Object.keys(updates).length > 0) options.updates = updates;
  return { action, options };
}

function output(value, stream = process.stdout) {
  stream.write(`${JSON.stringify(canonicalize(value), null, 2)}\n`);
}

export async function runCli(argv, io = {}) {
  const { action, options } = parseArguments(argv);
  const write = io.output ?? output;
  let session;
  switch (action) {
    case 'start':
      session = await startDevelopmentSession(options, io.dependencies);
      break;
    case 'status':
      session = statusDevelopmentSession(options);
      break;
    case 'transition':
      session = await transitionDevelopmentSession(options, io.dependencies);
      break;
    default:
      sessionFail(
        'INVALID_ARGUMENT',
        'action must be start, status, or transition',
      );
  }
  const result = { status: 'PASS', action, session };
  write(result);
  return result;
}

function reportError(error) {
  const typed = asSessionError(error);
  const payload =
    typed instanceof DevSessionError
      ? {
          status: 'BLOCKED',
          code: typed.code,
          message: typed.message,
          detail: typed.detail,
        }
      : {
          status: 'BLOCKED',
          code: 'DEV_SESSION_INTERNAL_ERROR',
          message: String(typed),
        };
  output(payload, process.stderr);
  process.exitCode = 2;
}

if (isDirectInvocation(import.meta.url)) {
  runCli(process.argv.slice(2)).catch(reportError);
}
