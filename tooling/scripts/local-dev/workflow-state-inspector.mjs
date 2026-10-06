import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';

import {
  developmentWorkLedgerPath,
} from '../lib/machine-dev-paths.mjs';
import { resolvePlanExecution } from '../plan/plan-mount.mjs';
import { readActiveWorkRecord } from './active-work-store.mjs';
import { loadSessionStore } from './dev-session-store.mjs';
import { readLedger } from './dev-work-ledger.mjs';

const LIVE_DECLARATION_STATES = new Set(['DECLARED', 'ACTIVE', 'RELEASING']);

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

export function resolveExecutionRoot(event) {
  for (const candidate of event.executionRootHints ?? []) {
    const root = resolveProjectRoot(candidate);
    if (root !== null) return root;
  }
  return null;
}

function currentHead(root) {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function currentBranch(root) {
  return execFileSync('git', ['branch', '--show-current'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function operationDate(options) {
  const value = options.now ?? new Date();
  const now = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(now.getTime())) {
    throw Object.assign(new Error('Workflow inspection clock is invalid'), {
      code: 'WORKFLOW_INSPECTION_CLOCK_INVALID',
    });
  }
  return now;
}

function activeDeclarations(workspaceId, options) {
  const now = operationDate(options);
  const ledgerReader = options.readLedger ?? readLedger;
  const ledgerFile =
    options.ledgerPath ?? developmentWorkLedgerPath(options.home);
  const ledger = ledgerReader(ledgerFile, now);
  return Object.values(ledger.declarations)
    .filter(
      (declaration) =>
        declaration.workspaceId === workspaceId &&
        LIVE_DECLARATION_STATES.has(declaration.state) &&
        Date.parse(declaration.expiresAt) > now.getTime(),
    )
    .sort((left, right) => right.heartbeatAt.localeCompare(left.heartbeatAt));
}

function mismatch(code, message, detail = {}) {
  return { status: 'HARD_BLOCK', code, message, detail };
}

function executionContext(binding) {
  return {
    canonicalRoot: binding.executionRoot,
    workspaceId: binding.workspaceId,
    skillRoot: path.join(binding.executionRoot, 'tooling', 'skills'),
  };
}

export async function inspectWorkflowContext(binding, options = {}) {
  const worktree = executionContext(binding);
  const { canonicalRoot, workspaceId } = worktree;
  let declarations;
  try {
    declarations = activeDeclarations(workspaceId, options);
  } catch (error) {
    return mismatch(
      error?.code ?? 'MACHINE_WORK_LEDGER_INVALID',
      error?.message ?? String(error),
    );
  }
  if (declarations.length === 0) {
    return mismatch(
      'WORK_DECLARATION_REQUIRED',
      'No live Development declaration exists for the conversation execution root.',
    );
  }
  if (declarations.length !== 1) {
    return mismatch(
      'WORK_DECLARATION_CONFLICT',
      'Multiple live Development declarations exist for the execution root.',
      { workItemIds: declarations.map((item) => item.workItemId) },
    );
  }
  const declaration = declarations[0];
  if (declaration.state !== 'ACTIVE') {
    return mismatch(
      'WORK_DECLARATION_NOT_ACTIVE',
      'The Development declaration must be ACTIVE.',
      { state: declaration.state, workItemId: declaration.workItemId },
    );
  }

  const head = currentHead(canonicalRoot);
  const branch = currentBranch(canonicalRoot);
  if (declaration.sourceHead !== head || declaration.branch !== branch) {
    return mismatch(
      'WORKTREE_IDENTITY_MISMATCH',
      'The active declaration does not match the execution root source.',
      { head, branch },
    );
  }

  const tracked =
    declaration.planId !== null ||
    declaration.planPath !== null ||
    declaration.taskId !== null;
  if (!tracked) {
    return {
      status: 'READY',
      tracked: false,
      declaration,
      head,
      branch,
      ...worktree,
    };
  }
  if (!declaration.planId || !declaration.planPath || !declaration.taskId) {
    return mismatch(
      'PLAN_LOCATOR_INVALID',
      'Tracked declaration has an incomplete Plan locator.',
    );
  }

  let execution;
  try {
    execution = await (
      options.resolvePlanExecution ?? resolvePlanExecution
    )({
      repoRoot: canonicalRoot,
      home: options.home,
    });
  } catch (error) {
    return mismatch(
      error?.code ?? 'PLAN_MOUNT_REQUIRED',
      error?.message ?? String(error),
    );
  }
  const currentTaskId = execution.run.currentTaskId;
  const currentTask = currentTaskId
    ? {
        ...execution.snapshot.plan.tasks.find(
          (task) => task.id === currentTaskId,
        ),
        ...execution.run.taskStates[currentTaskId],
      }
    : null;
  if (
    execution.mount.planId !== declaration.planId ||
    execution.mount.planPath !== declaration.planPath ||
    execution.snapshot.planDigest !== declaration.planDigest ||
    execution.mount.mountId !== declaration.mountId ||
    execution.run.runId !== declaration.runId ||
    currentTask?.id !== declaration.taskId
  ) {
    return mismatch(
      'PLAN_MOUNT_IDENTITY_MISMATCH',
      'Plan mount, run, declaration, and current Task do not agree.',
    );
  }

  let activeWork;
  try {
    activeWork = (
      options.readActiveWorkRecord ?? readActiveWorkRecord
    )({ repoRoot: canonicalRoot });
  } catch (error) {
    return mismatch(
      error?.code ?? 'ACTIVE_WORK_INVALID',
      error?.message ?? String(error),
    );
  }
  if (activeWork === null) {
    return mismatch(
      'ACTIVE_WORK_REQUIRED',
      'Tracked mutation requires workspace active-work.',
    );
  }

  const expectedSessionIdentity = {
    workspaceId,
    workItemId: declaration.workItemId,
    sessionId: declaration.sessionId,
    planId: declaration.planId,
    taskId: declaration.taskId,
    branch,
  };
  let session;
  try {
    const loadSession = options.loadSessionStore ?? loadSessionStore;
    session = await loadSession({
      home: options.home,
      workspaceRoot: canonicalRoot,
      workspaceId,
      workItemId: declaration.workItemId,
      expected: expectedSessionIdentity,
    });
  } catch (error) {
    return mismatch(
      error?.code ?? 'SESSION_UNAVAILABLE',
      error?.message ?? String(error),
    );
  }

  const state = session.state;
  const sessionMismatches = Object.fromEntries(
    Object.entries(expectedSessionIdentity)
      .filter(([field, value]) => state[field] !== value)
      .map(([field, value]) => [
        field,
        { expected: value, actual: state[field] ?? null },
      ]),
  );
  if (Object.keys(sessionMismatches).length > 0) {
    return mismatch(
      'SESSION_IDENTITY_MISMATCH',
      'Development Session identity does not match the active declaration.',
      sessionMismatches,
    );
  }

  const activeWorkMismatches = Object.fromEntries(
    [
      ['workspaceId', workspaceId],
      ['workItemId', declaration.workItemId],
      ['sessionId', declaration.sessionId],
      ['mountId', execution.mount.mountId],
      ['runId', execution.run.runId],
      ['snapshotDigest', execution.snapshot.recordDigest],
      ['planId', declaration.planId],
      ['planPath', declaration.planPath],
      ['currentTaskId', declaration.taskId],
      ['devState', state.state],
      ['branch', branch],
      ['expectedHead', head],
    ]
      .filter(([field, value]) => activeWork[field] !== value)
      .map(([field, value]) => [
        field,
        { expected: value, actual: activeWork[field] ?? null },
      ]),
  );
  if (Object.keys(activeWorkMismatches).length > 0) {
    return mismatch(
      'ACTIVE_WORK_MISMATCH',
      'Workspace active-work does not match its owner state.',
      activeWorkMismatches,
    );
  }

  return {
    status: 'READY',
    tracked: true,
    declaration,
    mount: execution.mount,
    snapshot: execution.snapshot,
    run: execution.run,
    planPackage: execution.planPackage,
    currentTask,
    activeWork,
    session,
    head,
    branch,
    ...worktree,
  };
}

export async function inspectStopContext(binding, inspect = inspectWorkflowContext) {
  const ready = await inspect(binding);
  if (
    ready.status !== 'HARD_BLOCK' ||
    ready.code !== 'WORK_DECLARATION_REQUIRED'
  ) {
    return ready;
  }
  try {
    const execution = await resolvePlanExecution({
      repoRoot: binding.executionRoot,
    });
    const head = currentHead(binding.executionRoot);
    const branch = currentBranch(binding.executionRoot);
    if (['completed', 'cancelled'].includes(execution.run.state)) {
      return {
        status: 'TERMINAL',
        tracked: true,
        mount: execution.mount,
        snapshot: execution.snapshot,
        run: execution.run,
        planPackage: execution.planPackage,
        currentTask: null,
        head,
        branch,
        ...executionContext(binding),
      };
    }
  } catch (error) {
    if (error?.code === 'PLAN_MOUNT_REQUIRED') {
      return {
        status: 'IDLE',
        tracked: false,
        head: currentHead(binding.executionRoot),
        branch: currentBranch(binding.executionRoot),
        ...executionContext(binding),
      };
    }
    return mismatch(
      error?.code ?? 'PLAN_MOUNT_INVALID',
      error?.message ?? String(error),
    );
  }
  return ready;
}
