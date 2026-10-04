#!/usr/bin/env node

import crypto from 'node:crypto';
import path from 'node:path';

import {
  loadSessionStoreFromPath,
  sessionStorePaths,
} from '../local-dev/dev-session-store.mjs';
import {
  PlanPackageError,
  isDirectInvocation,
  loadPlanPackage,
  summarizePlanPackage,
} from './plan-package.mjs';
import {
  PlanMountError,
  resolvePlanExecution,
  updateExecutionRun,
} from './plan-mount.mjs';

const SUCCESSFUL_SESSION_STATES = new Set([
  'SOURCE_READY',
  'DELIVERY_READY',
]);
const REPEATABLE_OPTIONS = new Set([
  'exhaustion-decision-ref',
  'exhaustion-evidence-ref',
]);
const READ_OPTIONS = new Set(['plan', 'repo-root', 'home']);

function fail(code, message, details) {
  throw new PlanPackageError(code, message, details);
}

function digestCompletionCandidate(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex');
}

function parseArguments(argv) {
  if (argv.length === 0) fail('PLAN_CLI_USAGE', 'Command is required');
  const command = argv[0];
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--') || token === '--') {
      fail('PLAN_CLI_USAGE', 'Unexpected positional argument', {
        argument: token,
      });
    }
    const key = token.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      fail('PLAN_CLI_USAGE', `Option --${key} requires a value`);
    }
    index += 1;
    if (REPEATABLE_OPTIONS.has(key)) {
      if (!options[key]) options[key] = [];
      options[key].push(value);
    } else if (Object.hasOwn(options, key)) {
      fail('PLAN_CLI_USAGE', `Option --${key} may appear only once`);
    } else {
      options[key] = value;
    }
  }
  return { command, options };
}

function requireOption(options, key) {
  const value = options[key];
  if (typeof value !== 'string' || value.length === 0) {
    fail('PLAN_CLI_USAGE', `--${key} is required`);
  }
  return value;
}

function assertAllowedOptions(options, allowed) {
  const accepted = allowed instanceof Set ? allowed : new Set(allowed);
  const unknown = Object.keys(options).filter((key) => !accepted.has(key));
  if (unknown.length > 0) {
    fail('PLAN_CLI_USAGE', 'Unknown command option', { unknown });
  }
}

function mountOptions(options) {
  return {
    repoRoot: options['repo-root'],
    home: options.home,
  };
}

function explicitPlanPath(options) {
  if (!options.plan) return null;
  const root = path.resolve(options['repo-root'] ?? process.cwd());
  return path.isAbsolute(options.plan)
    ? path.resolve(options.plan)
    : path.resolve(root, options.plan);
}

function assertRequestedPlan(resolved, options) {
  const requested = explicitPlanPath(options);
  if (requested && requested !== resolved.planPackage.path) {
    fail(
      'PLAN_TARGET_NOT_CURRENT',
      'requested Plan Version is not mounted in this workspace',
      {
        requested,
        mounted: resolved.planPackage.path,
      },
    );
  }
}

async function resolveCurrent(options) {
  const resolved = await resolvePlanExecution(mountOptions(options));
  assertRequestedPlan(resolved, options);
  return resolved;
}

function taskDefinition(resolved, taskId) {
  const index = resolved.snapshot.plan.tasks.findIndex(
    (task) => task.id === taskId,
  );
  if (index < 0) return null;
  return {
    index,
    planTask: resolved.snapshot.plan.tasks[index],
    slice: resolved.planPackage.taskSlices.get(taskId),
    state: resolved.run.taskStates[taskId],
  };
}

function readyTaskIds(snapshot, run) {
  return snapshot.plan.tasks
    .filter((task) => {
      if (run.taskStates[task.id].state !== 'pending') return false;
      return task.dependsOn.every(
        (dependency) => run.taskStates[dependency].state === 'done',
      );
    })
    .map((task) => task.id);
}

function taskProjection(resolved, taskId) {
  const task = taskDefinition(resolved, taskId);
  if (!task) return null;
  return {
    id: task.planTask.id,
    workstreamId: task.planTask.workstreamId,
    path: task.planTask.path,
    dependsOn: task.planTask.dependsOn,
    status: task.state.state,
    blocker: task.state.blocker,
    closureId: task.slice.closureId,
    journeyId: task.slice.journeyId,
    completionClass: task.slice.completionClass,
    runtimeClass: task.slice.runtimeClass,
  };
}

function progressPercentage(completed, total) {
  return total === 0
    ? 100
    : Number(((completed / total) * 100).toFixed(2));
}

export function summarizeExecutionProgress(resolved) {
  const taskIds = resolved.snapshot.plan.tasks.map((task) => task.id);
  const completed = taskIds.filter(
    (taskId) => resolved.run.taskStates[taskId].state === 'done',
  ).length;
  const total = taskIds.length;
  const percentage = progressPercentage(completed, total);
  const currentTaskId =
    resolved.run.state === 'active' ? resolved.run.currentTaskId : null;
  if (!currentTaskId) {
    return {
      unit: 'task-closure',
      completed,
      total,
      percentage,
      currentTaskId: null,
      nextProgressBoundary: null,
    };
  }
  const completedAfter = completed + 1;
  const percentageAfter = progressPercentage(completedAfter, total);
  const doneAfter = new Set(
    taskIds.filter(
      (taskId) => resolved.run.taskStates[taskId].state === 'done',
    ),
  );
  doneAfter.add(currentTaskId);
  const readyBefore = new Set(
    readyTaskIds(resolved.snapshot, resolved.run),
  );
  const unlocksTaskIds = resolved.snapshot.plan.tasks
    .filter(
      (task) =>
        resolved.run.taskStates[task.id].state === 'pending' &&
        !readyBefore.has(task.id) &&
        task.dependsOn.every((dependency) => doneAfter.has(dependency)),
    )
    .map((task) => task.id);
  return {
    unit: 'task-closure',
    completed,
    total,
    percentage,
    currentTaskId,
    nextProgressBoundary: {
      taskId: currentTaskId,
      title: resolved.planPackage.taskSlices.get(currentTaskId).title,
      transition: 'in_progress->done',
      completedDelta: 1,
      completedAfter,
      percentageAfter,
      percentagePointDelta: Number(
        (percentageAfter - percentage).toFixed(2),
      ),
      unlocksTaskIds,
    },
  };
}

export function summarizeExecution(resolved) {
  const taskStatuses = Object.fromEntries(
    resolved.snapshot.plan.tasks.map((task) => [
      task.id,
      resolved.run.taskStates[task.id].state,
    ]),
  );
  const closureStatuses = Object.fromEntries(
    resolved.snapshot.plan.tasks.map((task) => [
      resolved.planPackage.taskSlices.get(task.id).closureId,
      resolved.run.taskStates[task.id].state,
    ]),
  );
  const currentTaskId = resolved.run.currentTaskId;
  const currentTask = currentTaskId
    ? taskDefinition(resolved, currentTaskId)
    : null;
  return {
    ok: true,
    plan: resolved.planPackage.path,
    planPath: resolved.planPackage.planPath,
    planId: resolved.snapshot.planId,
    versionId: resolved.snapshot.planVersionId,
    planVersionDigest: resolved.snapshot.planVersionDigest,
    mountId: resolved.mount.mountId,
    runId: resolved.run.runId,
    snapshotDigest: resolved.snapshot.recordDigest,
    status: resolved.run.state,
    branch: resolved.snapshot.executionBinding.branch,
    workspaceId: resolved.snapshot.executionBinding.workspaceId,
    initialHead: resolved.snapshot.executionBinding.initialHead,
    sourceClaims: resolved.snapshot.plan.scope.sourceClaims.map((claim) => ({
      ...claim,
    })),
    progress: summarizeExecutionProgress(resolved),
    currentTaskId,
    currentTaskPath: currentTask?.planTask.path ?? null,
    currentTaskWriteSet: currentTask?.slice.writeSet ?? [],
    currentClosure: currentTask?.slice.closureId ?? null,
    taskStatuses,
    acceptance: resolved.snapshot.acceptance,
    closureStatuses,
    closures: closureStatuses,
    completion: resolved.snapshot.acceptance.completion,
    full: resolved.snapshot.acceptance.full,
    allDeclaredGateIds: [
      ...new Set([
        ...Object.values(resolved.snapshot.acceptance.closures).flat(),
        ...resolved.snapshot.acceptance.completion,
        ...resolved.snapshot.acceptance.full,
      ]),
    ],
  };
}

async function validateSessionHandoff(resolved, options, transition) {
  if (transition === 'reactivate') return null;
  const sessionPath = requireOption(options, 'session');
  const workItemId = requireOption(options, 'work-item');
  const currentTaskId = resolved.run.currentTaskId;
  if (!currentTaskId) {
    fail('PLAN_ADVANCE_INVALID', 'Execution Run has no current Task');
  }
  const canonicalPath = sessionStorePaths({
    home: options.home,
    workspaceRoot: resolved.workspace.canonicalRoot,
    workspaceId: resolved.workspace.workspaceId,
    workItemId,
  }).session;
  if (path.resolve(sessionPath) !== canonicalPath) {
    fail(
      'PLAN_ADVANCE_INVALID',
      'Task handoff Session must use the canonical workspace/work-item path',
      { requested: path.resolve(sessionPath), expected: canonicalPath },
    );
  }
  let session;
  try {
    session = loadSessionStoreFromPath(sessionPath, {
      expected: {
        planId: resolved.snapshot.planId,
        taskId: currentTaskId,
        workspaceId: resolved.workspace.workspaceId,
        branch: resolved.snapshot.executionBinding.branch,
        workItemId,
      },
    });
  } catch (error) {
    fail(
      'PLAN_ADVANCE_INVALID',
      'Task handoff Session is unavailable or invalid',
      { sessionPath, cause: error.code ?? error.message },
    );
  }
  const state = session.state.state;
  if (transition === 'blocked') {
    if (state !== 'BLOCKED' || session.state.currentFailure === null) {
      fail(
        'PLAN_ADVANCE_INVALID',
        'blocked handoff requires a BLOCKED Session with a failure record',
        { state },
      );
    }
    return session;
  }
  const task = resolved.planPackage.taskSlices.get(currentTaskId);
  const expectedState =
    task.completionClass === 'source' ? 'SOURCE_READY' : 'DELIVERY_READY';
  if (!SUCCESSFUL_SESSION_STATES.has(state) || state !== expectedState) {
    fail(
      'PLAN_ADVANCE_INVALID',
      'Task handoff Session has not reached its completion state',
      { state, expectedState, completionClass: task.completionClass },
    );
  }
  return session;
}

function activateRun(run, snapshot, taskId) {
  if (!['prepared', 'blocked'].includes(run.state)) {
    fail(
      'PLAN_ACTIVATE_INVALID',
      'Only a prepared or blocked Execution Run can activate a Task',
      { state: run.state },
    );
  }
  const ready = readyTaskIds(snapshot, run);
  if (!ready.includes(taskId)) {
    const blockedState = run.taskStates[taskId];
    if (!(run.state === 'blocked' && blockedState?.state === 'blocked')) {
      fail('PLAN_ACTIVATE_INVALID', 'Task is not dependency-ready', {
        taskId,
        readyTaskIds: ready,
      });
    }
  }
  if (!Object.hasOwn(run.taskStates, taskId)) {
    fail('PLAN_ACTIVATE_INVALID', 'Task does not exist', { taskId });
  }
  run.taskStates[taskId] = { state: 'in_progress', blocker: null };
  run.state = 'active';
  run.currentTaskId = taskId;
  run.exhaustion = null;
  return run;
}

function blockerFromOptions(options) {
  return {
    code: requireOption(options, 'blocker-code'),
    owner: requireOption(options, 'blocker-owner'),
    evidenceRef: requireOption(options, 'blocker-evidence-ref'),
  };
}

function exhaustionFromOptions(options, blockedTaskIds) {
  const decisionRefs = options['exhaustion-decision-ref'] ?? [];
  const evidenceRefs = options['exhaustion-evidence-ref'] ?? [];
  if (decisionRefs.length === 0 || evidenceRefs.length === 0) {
    fail(
      'PLAN_ADVANCE_INVALID',
      'fixed-point blocking requires decision and evidence references',
    );
  }
  return {
    recordedAt: new Date().toISOString(),
    blockedTaskIds: [...blockedTaskIds].sort(),
    decisionRefs,
    evidenceRefs,
  };
}

function advanceRun(run, snapshot, transition, options) {
  const currentTaskId = run.currentTaskId;
  if (run.state !== 'active' || currentTaskId === null) {
    fail('PLAN_ADVANCE_INVALID', 'Execution Run has no active Task');
  }
  if (transition === 'done') {
    run.taskStates[currentTaskId] = { state: 'done', blocker: null };
  } else if (transition === 'blocked') {
    run.taskStates[currentTaskId] = {
      state: 'blocked',
      blocker: blockerFromOptions(options),
    };
  } else {
    fail('PLAN_CLI_USAGE', '--to must be done or blocked');
  }
  run.currentTaskId = null;
  run.exhaustion = null;

  if (
    Object.values(run.taskStates).every((state) => state.state === 'done')
  ) {
    run.state = 'completed';
    return run;
  }
  const ready = readyTaskIds(snapshot, run);
  if (ready.length > 0) {
    const nextTaskId = ready[0];
    run.taskStates[nextTaskId] = { state: 'in_progress', blocker: null };
    run.state = 'active';
    run.currentTaskId = nextTaskId;
    return run;
  }
  const blockedTaskIds = Object.entries(run.taskStates)
    .filter(([, state]) => state.state === 'blocked')
    .map(([taskId]) => taskId);
  if (blockedTaskIds.length === 0) {
    fail(
      'PLAN_ADVANCE_INVALID',
      'Execution Run has no ready Task and no blocker',
    );
  }
  run.state = 'blocked';
  run.exhaustion = exhaustionFromOptions(options, blockedTaskIds);
  return run;
}

function transitiveDependents(snapshot, rootTaskId) {
  const affected = new Set([rootTaskId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of snapshot.plan.tasks) {
      if (
        !affected.has(task.id) &&
        task.dependsOn.some((dependency) => affected.has(dependency))
      ) {
        affected.add(task.id);
        changed = true;
      }
    }
  }
  return affected;
}

export async function advancePlan(_planPath, options) {
  const resolved = await resolveCurrent(options);
  const transition = requireOption(options, 'to');
  const session = await validateSessionHandoff(
    resolved,
    options,
    transition,
  );
  const candidate = advanceRun(
    structuredClone(resolved.run),
    resolved.snapshot,
    transition,
    options,
  );
  const reviewOwner = await import('../local-dev/completion-review.mjs');
  if (transition === 'done') {
    const validateCompletion =
      options.completionReviewValidator ??
      reviewOwner.requireCurrentCompletionReview;
    await validateCompletion(
      {
        repoRoot: resolved.workspace.canonicalRoot,
        execution: resolved,
        planPackage: resolved.planPackage,
        session,
        workItemId: session.state.workItemId,
        candidatePlanDigest: digestCompletionCandidate(candidate),
      },
      options.completionReviewDependencies,
    );
  }
  return updateExecutionRun(mountOptions(options), (run) => {
    if (
      run.revision !== resolved.run.revision ||
      run.recordDigest !== resolved.run.recordDigest
    ) {
      fail(
        'PLAN_ADVANCE_CONFLICT',
        'Execution Run changed while completion review was in progress',
      );
    }
    return candidate;
  });
}

export async function activatePlan(_planPath, options) {
  const taskId = requireOption(options, 'task');
  return updateExecutionRun(mountOptions(options), (run, snapshot) =>
    activateRun(run, snapshot, taskId),
  );
}

export async function reopenPlan(_planPath, options) {
  const resolved = await resolveCurrent(options);
  const reviewOwner = await import('../local-dev/completion-review.mjs');
  const invalid = await reviewOwner.findEarliestInvalidCompletionReview(
    {
      repoRoot: resolved.workspace.canonicalRoot,
      execution: resolved,
      planPackage: resolved.planPackage,
      workItemId: requireOption(options, 'work-item'),
    },
    options.completionReviewDependencies,
  );
  if (invalid === null) {
    fail(
      'PLAN_REOPEN_NOT_REQUIRED',
      'No completed Task has a missing or stale Completion Review',
    );
  }
  const affected = transitiveDependents(resolved.snapshot, invalid.taskId);
  const result = await updateExecutionRun(mountOptions(options), (run) => {
    for (const taskId of affected) {
      run.taskStates[taskId] = { state: 'pending', blocker: null };
    }
    run.taskStates[invalid.taskId] = {
      state: 'in_progress',
      blocker: null,
    };
    run.currentTaskId = invalid.taskId;
    run.state = 'active';
    run.exhaustion = null;
    return run;
  });
  return { ...result, invalid };
}

export async function invalidateSourcePlan(_planPath, options) {
  const resolved = await resolveCurrent(options);
  const policy = resolved.planPackage.sourceInvalidationPolicy;
  if (policy === null) {
    fail(
      'PLAN_SOURCE_INVALIDATION_UNAVAILABLE',
      'Plan Version has no Source Invalidation Policy',
    );
  }
  const affected = new Set();
  policy.rootTaskIds.forEach((taskId) => {
    transitiveDependents(resolved.snapshot, taskId).forEach((value) =>
      affected.add(value),
    );
  });
  affected.add(policy.sourceOwnerTaskId);
  const result = await updateExecutionRun(mountOptions(options), (run) => {
    for (const taskId of affected) {
      run.taskStates[taskId] = { state: 'pending', blocker: null };
    }
    run.taskStates[policy.sourceOwnerTaskId] = {
      state: 'in_progress',
      blocker: null,
    };
    run.currentTaskId = policy.sourceOwnerTaskId;
    run.state = 'active';
    run.exhaustion = null;
    return run;
  });
  return {
    ...result,
    invalidatedTaskIds: [...affected].sort(),
  };
}

async function validateCommand(options) {
  assertAllowedOptions(options, READ_OPTIONS);
  const plan = await loadPlanPackage(
    requireOption(options, 'plan'),
    { repoRoot: options['repo-root'] },
  );
  return {
    ...summarizePlanPackage(plan),
    taskCount: plan.plan.tasks.length,
  };
}

async function statusCommand(options) {
  assertAllowedOptions(options, READ_OPTIONS);
  return summarizeExecution(await resolveCurrent(options));
}

async function currentCommand(options) {
  assertAllowedOptions(options, READ_OPTIONS);
  const resolved = await resolveCurrent(options);
  return {
    ok: true,
    plan: resolved.planPackage.path,
    status: resolved.run.state,
    currentTask: resolved.run.currentTaskId
      ? taskProjection(resolved, resolved.run.currentTaskId)
      : null,
  };
}

async function nextCommand(options) {
  assertAllowedOptions(options, READ_OPTIONS);
  const resolved = await resolveCurrent(options);
  return {
    ok: true,
    plan: resolved.planPackage.path,
    status: resolved.run.state,
    currentTaskId: resolved.run.currentTaskId,
    readyTasks: readyTaskIds(resolved.snapshot, resolved.run).map((taskId) =>
      taskProjection(resolved, taskId),
    ),
  };
}

async function activateCommand(options) {
  assertAllowedOptions(options, [...READ_OPTIONS, 'task']);
  return summarizeExecution(
    await activatePlan(options.plan, options),
  );
}

async function advanceCommand(options) {
  assertAllowedOptions(options, [
    ...READ_OPTIONS,
    'to',
    'session',
    'work-item',
    'blocker-code',
    'blocker-owner',
    'blocker-evidence-ref',
    'exhaustion-decision-ref',
    'exhaustion-evidence-ref',
  ]);
  return summarizeExecution(await advancePlan(options.plan, options));
}

async function reopenCommand(options) {
  assertAllowedOptions(options, [...READ_OPTIONS, 'work-item']);
  const result = await reopenPlan(options.plan, options);
  return {
    ...summarizeExecution(result),
    invalid: result.invalid,
  };
}

async function invalidateSourceCommand(options) {
  assertAllowedOptions(options, [...READ_OPTIONS]);
  const result = await invalidateSourcePlan(options.plan, options);
  return {
    ...summarizeExecution(result),
    invalidatedTaskIds: result.invalidatedTaskIds,
  };
}

export async function runPlanctl(argv = process.argv.slice(2)) {
  const { command, options } = parseArguments(argv);
  if (command === 'validate') return validateCommand(options);
  if (command === 'current') return currentCommand(options);
  if (command === 'next') return nextCommand(options);
  if (command === 'status') return statusCommand(options);
  if (command === 'activate') return activateCommand(options);
  if (command === 'advance') return advanceCommand(options);
  if (command === 'reopen') return reopenCommand(options);
  if (command === 'invalidate-source') {
    return invalidateSourceCommand(options);
  }
  fail('PLAN_CLI_USAGE', 'Unknown command', {
    command,
    commands: [
      'validate',
      'current',
      'next',
      'status',
      'activate',
      'advance',
      'reopen',
      'invalidate-source',
    ],
  });
}

function typedError(error) {
  if (
    error instanceof PlanPackageError ||
    error instanceof PlanMountError ||
    error?.name === 'CompletionReviewError'
  ) {
    return error;
  }
  return new PlanPackageError(
    'PLAN_INTERNAL_ERROR',
    error?.message ?? String(error),
  );
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const result = await runPlanctl(argv);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const normalized = typedError(error);
    process.stderr.write(`${JSON.stringify(normalized.toJSON())}\n`);
    process.exitCode = 1;
  }
}

if (isDirectInvocation(import.meta.url)) {
  await main();
}
