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
import { resolvePlanExecution } from '../plan/plan-mount.mjs';
import {
  ActiveWorkError,
  clearActiveWorkRecord,
  readActiveWorkRecord,
  readAllActiveWorkRecords,
  repairActiveWorkRecord,
  updateActiveWorkRecord,
} from './active-work-store.mjs';
import { statusDevelopmentSession } from './dev-session.mjs';
import { readLedger } from './dev-work-ledger.mjs';
import { canonicalize } from './dev-work-schema.mjs';
import {
  WorkspaceLifecycleLockError,
  withWorkspaceLifecycleLock,
} from './workspace-lifecycle-lock.mjs';
import {
  resolveCurrentWorkflowOwnerContext,
} from './workflow-owner-context.mjs';
import {
  sameWorkflowOwnerReference,
  validateWorkflowOwnerReference,
} from './workflow-owner-reference.mjs';

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

function assertOwnerAgreement({
  declaration,
  execution,
  head,
  task,
  taskSlice,
  workspaceId,
  workflowOwner,
}) {
  const mismatches = {};
  for (const [field, expected, actual] of [
    ['workspaceId', workspaceId, declaration.workspaceId],
    ['planId', execution.mount.planId, declaration.planId],
    ['planPath', execution.mount.planPath, declaration.planPath],
    ['planDigest', execution.snapshot.planDigest, declaration.planDigest],
    ['mountId', execution.mount.mountId, declaration.mountId],
    ['runId', execution.run.runId, declaration.runId],
    ['taskId', execution.run.currentTaskId, declaration.taskId],
    ['taskStatus', 'in_progress', task?.state],
    [
      'branch',
      execution.snapshot.executionBinding.branch,
      declaration.branch,
    ],
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
  if (
    declaration.workflowOwner !== undefined &&
    workflowOwner !== undefined &&
    workflowOwner !== null &&
    !sameWorkflowOwnerReference(
      declaration.workflowOwner,
      validateWorkflowOwnerReference(workflowOwner),
    )
  ) {
    fail(
      'ACTIVE_WORK_OWNER_MISMATCH',
      'current workflow OWNER does not own the declaration',
      {
        expected: declaration.workflowOwner.rootBindingDigest,
        actual: workflowOwner.rootBindingDigest,
      },
    );
  }
}

function readSessionState(options, declaration, dependencies) {
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
  const execution = await (
    dependencies.resolvePlanExecution ?? resolvePlanExecution
  )({
    home: options.home,
    repoRoot: workspaceRoot,
  });
  const declaration = currentDeclaration(
    { ...options, workItemId },
    workspaceId,
    dependencies,
  );
  const currentTaskId = execution.run.currentTaskId;
  const task = currentTaskId
    ? execution.run.taskStates[currentTaskId]
    : null;
  const taskSlice = currentTaskId
    ? execution.planPackage.taskSlices.get(currentTaskId)
    : null;
  const head =
    dependencies.gitHead ??
    gitValue(workspaceRoot, ['rev-parse', 'HEAD'], 'source HEAD');

  assertOwnerAgreement({
    declaration,
    execution,
    head,
    task,
    taskSlice,
    workspaceId,
    workflowOwner: options.workflowOwner,
  });

  const currentTaskPath = path.posix.join(
    path.posix.dirname(execution.mount.planPath),
    execution.snapshot.plan.tasks.find(
      (candidate) => candidate.id === currentTaskId,
    ).path,
  );
  return {
    workspaceId,
    workItemId,
    mountId: execution.mount.mountId,
    runId: execution.run.runId,
    snapshotDigest: execution.snapshot.recordDigest,
    planId: execution.mount.planId,
    planPath: execution.mount.planPath,
    planStatus: execution.run.state,
    currentTaskId,
    currentTaskPath,
    taskStatus: task.state,
    sessionId: declaration.sessionId,
    journeyId: declaration.journeyId,
    devState: readSessionState(
      { ...options, workspaceRoot },
      declaration,
      dependencies,
    ),
    branch: declaration.branch,
    initialHead: execution.snapshot.executionBinding.initialHead,
    expectedHead: declaration.sourceHead,
    ...(declaration.workflowOwner === undefined
      ? {}
      : { workflowOwner: declaration.workflowOwner }),
  };
}

export async function syncActiveWork(options, dependencies = {}) {
  const workspaceRoot =
    dependencies.workspaceRoot ??
    canonicalWorkspaceRoot(options.workspaceRoot ?? repoRoot);
  const workspaceId =
    dependencies.workspaceId ?? workspaceIdForRoot(workspaceRoot);
  try {
    return await withWorkspaceLifecycleLock(
      {
        home: options.home,
        workspaceRoot,
        workspaceId,
        lockTimeoutMs:
          options.lifecycleLockTimeoutMs ?? options.lockTimeoutMs,
        lifecycleFailpoint: options.lifecycleFailpoint,
      },
      async (lifecycleLease) => {
        const input = await deriveActiveWorkInput(
          { ...options, workspaceRoot },
          { ...dependencies, workspaceRoot, workspaceId },
        );
        return updateActiveWorkRecord(input, {
          home: options.home,
          workspaceRoot,
          lifecycleLease,
          expectedRevision: options.expectedRevision,
          now: options.now,
          clock: options.clock,
          lockTimeoutMs: options.lockTimeoutMs,
        });
      },
    );
  } catch (error) {
    if (error instanceof WorkspaceLifecycleLockError) {
      fail(error.code, error.message, error.detail);
    }
    throw error;
  }
}

export async function repairActiveWork(options, dependencies = {}) {
  const input = await deriveActiveWorkInput(options, dependencies);
  return repairActiveWorkRecord(input, {
    home: options.home,
    workspaceRoot: options.workspaceRoot ?? repoRoot,
    expectedRevision: options.expectedRevision,
    expectedRecordSha256: options.expectedRecordSha256,
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
  'expected-record-sha256': 'expectedRecordSha256',
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
  const ownerOperationLabels = {
    sync: 'active-work-sync',
    repair: 'active-work-repair',
    close: 'active-work-close',
  };
  if (ownerOperationLabels[action]) {
    options.workflowOwner = (
      io.dependencies?.resolveCurrentWorkflowOwnerContext ??
      resolveCurrentWorkflowOwnerContext
    )({
      home: options.home,
      workspaceRoot: options.workspaceRoot ?? process.cwd(),
      operationLabel: ownerOperationLabels[action],
    }).workflowOwner;
  }
  let result;
  switch (action) {
    case 'sync':
      result = await syncActiveWork(options, io.dependencies);
      break;
    case 'repair':
      if (options.expectedRecordSha256 === undefined) {
        fail(
          'INVALID_ARGUMENT',
          'repair requires --expected-record-sha256',
        );
      }
      result = await repairActiveWork(options, io.dependencies);
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
        'action must be sync, repair, status, status-all, or close',
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
