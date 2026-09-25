#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import {
  developmentWorkLedgerPath,
  isDirectInvocation,
  repoRoot,
  workspaceIdForRoot,
} from '../lib/machine-dev-paths.mjs';
import { loadPlanPackage } from '../plan/plan-package.mjs';
import { resolveWorkspacePlanBinding } from '../plan/workspace-plan-binding.mjs';
import {
  ActiveWorkError,
  clearActiveWorkRecord,
  readActiveWorkRecord,
  readAllActiveWorkRecords,
  updateActiveWorkRecord,
} from './active-work-store.mjs';
import { statusDevelopmentSession } from './dev-session.mjs';
import { readLedger } from './dev-work-ledger.mjs';
import { canonicalize } from './dev-work-schema.mjs';

const LIVE_DECLARATION_STATES = new Set(['DECLARED', 'ACTIVE', 'RELEASING']);
const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

function fail(code, message, detail = {}) {
  throw new ActiveWorkError(code, message, detail);
}

function requiredIdentifier(value, field) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
    fail('INVALID_ARGUMENT', `${field} is invalid`, { field });
  }
  return value;
}

function canonicalWorkspaceRoot(root) {
  let workspaceRoot;
  try {
    workspaceRoot = realpathSync(path.resolve(root ?? repoRoot));
    const gitRoot = realpathSync(
      execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: workspaceRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim(),
    );
    if (gitRoot !== workspaceRoot) {
      fail(
        'WORKTREE_IDENTITY_MISMATCH',
        'workspace root is not the Git worktree root',
        { requested: workspaceRoot, actual: gitRoot },
      );
    }
    return workspaceRoot;
  } catch (error) {
    if (error instanceof ActiveWorkError) throw error;
    fail('WORKTREE_IDENTITY_UNAVAILABLE', 'workspace root cannot be resolved', {
      root,
      cause: String(error),
    });
  }
}

function gitValue(workspaceRoot, arguments_, field) {
  try {
    const value = execFileSync('git', arguments_, {
      cwd: workspaceRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    if (!value) throw new Error(`${field} is empty`);
    return value;
  } catch (error) {
    fail('WORKTREE_IDENTITY_UNAVAILABLE', `cannot resolve ${field}`, {
      cause: String(error),
    });
  }
}

function currentDeclaration(options, workspaceId, dependencies) {
  const ledgerPath =
    options.ledgerPath ??
    developmentWorkLedgerPath(options.home ?? homedir());
  const ledger = (dependencies.readLedger ?? readLedger)(
    ledgerPath,
    options.now ?? new Date(),
  );
  const declaration =
    ledger.declarations[`${options.workItemId}-${workspaceId}`] ?? null;
  if (!declaration) {
    fail('WORK_DECLARATION_MISSING', 'development declaration does not exist', {
      workItemId: options.workItemId,
      workspaceId,
    });
  }
  if (
    !LIVE_DECLARATION_STATES.has(declaration.state) ||
    Date.parse(declaration.expiresAt) <=
      (options.now ?? new Date()).getTime()
  ) {
    fail('WORK_DECLARATION_NOT_ACTIVE', 'development declaration is not active', {
      state: declaration.state,
      expiresAt: declaration.expiresAt,
    });
  }
  return declaration;
}

function expectedTaskStatus(planStatus) {
  if (planStatus === 'active') return 'in_progress';
  if (planStatus === 'blocked') return 'blocked';
  if (planStatus === 'completed') return 'done';
  return null;
}

function assertOwnerAgreement({
  binding,
  declaration,
  head,
  planPackage,
  task,
  taskSlice,
  workspaceId,
}) {
  const expectedStatus = expectedTaskStatus(planPackage.manifest.status);
  const mismatches = {};
  for (const [field, expected, actual] of [
    ['workspaceId', workspaceId, declaration.workspaceId],
    ['planId', binding.planId, declaration.planId],
    ['planPath', binding.planPath, declaration.planPath],
    ['taskId', declaration.taskId, task?.id],
    ['taskStatus', expectedStatus, task?.status],
    ['branch', planPackage.manifest.binding.branch, declaration.branch],
    ['sourceHead', head, declaration.sourceHead],
    ['journeyId', taskSlice?.journeyId, declaration.journeyId],
  ]) {
    if (expected !== actual) mismatches[field] = { expected, actual };
  }
  if (Object.keys(mismatches).length > 0) {
    fail(
      'ACTIVE_WORK_OWNER_MISMATCH',
      'Plan, declaration, Task, Session or Git owners disagree',
      { mismatches },
    );
  }
}

function readSessionState(options, declaration, planPackage, dependencies) {
  try {
    const session = (
      dependencies.statusDevelopmentSession ?? statusDevelopmentSession
    )({
      home: options.home,
      workspaceRoot: options.workspaceRoot,
      workspaceId: declaration.workspaceId,
      workItemId: declaration.workItemId,
      sessionId: declaration.sessionId,
      planId: declaration.planId,
      taskId: declaration.taskId,
      branch: declaration.branch,
      now: options.now,
    });
    return session.state.state;
  } catch (error) {
    if (error?.code === 'SESSION_UNAVAILABLE') return null;
    throw error;
  }
}

export async function deriveActiveWorkInput(options, dependencies = {}) {
  const workspaceRoot =
    dependencies.workspaceRoot ??
    canonicalWorkspaceRoot(options.workspaceRoot ?? repoRoot);
  const workspaceId =
    dependencies.workspaceId ?? workspaceIdForRoot(workspaceRoot);
  const workItemId = requiredIdentifier(options.workItemId, 'workItemId');
  const binding = await (
    dependencies.resolveWorkspacePlanBinding ?? resolveWorkspacePlanBinding
  )({
    home: options.home,
    repoRoot: workspaceRoot,
  });
  const planPath = path.resolve(
    workspaceRoot,
    ...binding.planPath.split('/'),
  );
  const planPackage = await (
    dependencies.loadPlanPackage ?? loadPlanPackage
  )(planPath, { repoRoot: workspaceRoot });
  const declaration = currentDeclaration(
    { ...options, workItemId },
    workspaceId,
    dependencies,
  );
  const task =
    planPackage.manifest.tasks.find(
      (candidate) => candidate.id === declaration.taskId,
    ) ?? null;
  const taskSlice = task ? planPackage.taskSlices.get(task.id) : null;
  const head =
    dependencies.gitHead ??
    gitValue(workspaceRoot, ['rev-parse', 'HEAD'], 'source HEAD');

  assertOwnerAgreement({
    binding,
    declaration,
    head,
    planPackage,
    task,
    taskSlice,
    workspaceId,
  });

  const currentTaskPath = path.posix.join(
    path.posix.dirname(binding.planPath),
    task.path,
  );
  return {
    workspaceId,
    workItemId,
    planId: binding.planId,
    planPath: binding.planPath,
    planStatus: planPackage.manifest.status,
    currentTaskId: task.id,
    currentTaskPath,
    taskStatus: task.status,
    sessionId: declaration.sessionId,
    journeyId: declaration.journeyId,
    devState: readSessionState(
      { ...options, workspaceRoot },
      declaration,
      planPackage,
      dependencies,
    ),
    branch: declaration.branch,
    initialHead: planPackage.manifest.binding.initialHead,
    expectedHead: declaration.sourceHead,
  };
}

export async function syncActiveWork(options, dependencies = {}) {
  const input = await deriveActiveWorkInput(options, dependencies);
  return updateActiveWorkRecord(input, {
    home: options.home,
    workspaceRoot: options.workspaceRoot ?? repoRoot,
    expectedRevision: options.expectedRevision,
    now: options.now,
    clock: options.clock,
    lockTimeoutMs: options.lockTimeoutMs,
  });
}

export function statusActiveWork(options = {}) {
  return readActiveWorkRecord({
    home: options.home,
    workspaceRoot: options.workspaceRoot ?? repoRoot,
    workspaceId: options.workspaceId,
  });
}

export function closeActiveWork(options = {}) {
  requiredIdentifier(options.workItemId, 'workItemId');
  if (options.expectedRevision === undefined) {
    fail('INVALID_ARGUMENT', 'close requires --expected-revision');
  }
  return clearActiveWorkRecord({
    home: options.home,
    workspaceRoot: options.workspaceRoot ?? repoRoot,
    workspaceId: options.workspaceId,
    expectedRevision: options.expectedRevision,
    workItemId: options.workItemId,
  });
}

const OPTION_NAMES = {
  home: 'home',
  'workspace-root': 'workspaceRoot',
  'workspace-id': 'workspaceId',
  'work-item': 'workItemId',
  'expected-revision': 'expectedRevision',
};

function parseArguments(argv) {
  const [action, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) {
      fail('INVALID_ARGUMENT', `unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const optionKey = OPTION_NAMES[key];
    if (!optionKey) {
      fail('INVALID_ARGUMENT', `unsupported option: --${key}`);
    }
    const value = rest[index + 1];
    if (value === undefined || value.startsWith('--')) {
      fail('INVALID_ARGUMENT', `missing value for --${key}`);
    }
    index += 1;
    options[optionKey] = value;
  }
  return { action, options };
}

function output(value, stream = process.stdout) {
  stream.write(`${JSON.stringify(canonicalize(value), null, 2)}\n`);
}

export async function runCli(argv, io = {}) {
  const { action, options } = parseArguments(argv);
  const write = io.output ?? output;
  let result;
  switch (action) {
    case 'sync':
      result = await syncActiveWork(options, io.dependencies);
      break;
    case 'status':
      result = statusActiveWork(options);
      break;
    case 'status-all':
      result = readAllActiveWorkRecords({ home: options.home });
      break;
    case 'close':
      result = closeActiveWork(options);
      break;
    default:
      fail(
        'INVALID_ARGUMENT',
        'action must be sync, status, status-all, or close',
      );
  }
  write({ status: 'PASS', action, activeWork: result });
  return result;
}

function reportError(error) {
  output(
    {
      status: 'BLOCKED',
      code: error?.code ?? 'ACTIVE_WORK_INTERNAL_ERROR',
      message: error?.message ?? String(error),
      detail: error?.detail ?? error?.details ?? {},
    },
    process.stderr,
  );
  process.exitCode = 2;
}

if (isDirectInvocation(import.meta.url)) {
  runCli(process.argv.slice(2)).catch(reportError);
}
