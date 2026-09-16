#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import {
  machineDevRoot,
  workspaceIdForRoot,
} from '../lib/machine-dev-paths.mjs';
import {
  PlanPackageError,
  atomicReplaceFile,
  isDirectInvocation,
  loadPlanPackage,
  renderPlanDocument,
  summarizePlanPackage,
} from './plan-package.mjs';
import {
  PlanMigrationError,
  commitPlanMigration,
  getPlanMigrationPaths,
  preparePlanMigration,
  recoverPlanMigration,
  sha256,
} from './plan-migration.mjs';

const TERMINAL_SESSION_STATES = new Set([
  'SOURCE_READY',
  'DELIVERY_READY',
  'CANCELLED',
]);
const REPEATABLE_OPTIONS = new Set([
  'exhaustion-decision-ref',
  'exhaustion-evidence-ref',
  'replacement',
]);
const PLAN_READ_OPTIONS = ['plan', 'repo-root'];

function fail(code, message, details) {
  throw new PlanPackageError(code, message, details);
}

function parseArguments(argv) {
  if (argv.length === 0) {
    fail('PLAN_CLI_USAGE', 'Command is required');
  }
  const command = argv[0];
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--') || token === '--') {
      fail('PLAN_CLI_USAGE', 'Unexpected positional argument', { argument: token });
    }
    const key = token.slice(2);
    if (!key) fail('PLAN_CLI_USAGE', 'Option name is empty');
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
  const accepted = new Set(allowed);
  const unknown = Object.keys(options).filter((key) => !accepted.has(key));
  if (unknown.length > 0) {
    fail('PLAN_CLI_USAGE', 'Unknown command option', { unknown });
  }
}

function loadOptions(options) {
  return {
    repoRoot: options['repo-root'],
  };
}

function lifecycleTask(planPackage, taskId) {
  return planPackage.manifest.tasks.find((task) => task.id === taskId) ?? null;
}

function taskProjection(planPackage, task) {
  const slice = planPackage.taskSlices.get(task.id);
  return {
    id: task.id,
    workstreamId: task.workstreamId,
    path: task.path,
    dependsOn: task.dependsOn,
    status: task.status,
    blocker: task.blocker,
    closureId: slice.closureId,
    journeyId: slice.journeyId,
    completionClass: slice.completionClass,
    runtimeClass: slice.runtimeClass,
  };
}

async function validateSessionTerminal(sessionPath, planPackage) {
  if (typeof sessionPath !== 'string' || sessionPath.length === 0) {
    fail(
      'PLAN_ADVANCE_INVALID',
      'Task handoff requires explicit --session <path|NONE>',
    );
  }
  if (sessionPath.toUpperCase() === 'NONE') return;
  let session;
  try {
    session = JSON.parse(await fsp.readFile(path.resolve(sessionPath), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return;
    if (error instanceof SyntaxError) {
      fail('PLAN_ADVANCE_INVALID', 'Session snapshot is not valid JSON', { sessionPath });
    }
    throw error;
  }
  const state =
    typeof session.state === 'string'
      ? session.state
      : typeof session.state?.state === 'string'
        ? session.state.state
        : null;
  if (!TERMINAL_SESSION_STATES.has(state)) {
    fail('PLAN_ADVANCE_INVALID', 'Current Development Session is not terminal', {
      sessionPath,
      state,
      terminalStates: [...TERMINAL_SESSION_STATES],
    });
  }
  const sessionState =
    typeof session.state === 'object' && session.state !== null
      ? session.state
      : session;
  if (
    sessionState.planId !== planPackage.manifest.planId ||
    sessionState.taskId !== planPackage.currentTask?.taskId
  ) {
    fail('PLAN_ADVANCE_INVALID', 'Session identity does not match the current Task', {
      expectedPlanId: planPackage.manifest.planId,
      actualPlanId: sessionState.planId ?? null,
      expectedTaskId: planPackage.currentTask?.taskId ?? null,
      actualTaskId: sessionState.taskId ?? null,
    });
  }
  if (state === 'CANCELLED') return;
  const expectedState =
    planPackage.currentTask.completionClass === 'source'
      ? 'SOURCE_READY'
      : 'DELIVERY_READY';
  if (state !== expectedState) {
    fail(
      'PLAN_ADVANCE_INVALID',
      'Session terminal state does not match the Task completion class',
      {
        completionClass: planPackage.currentTask.completionClass,
        expectedState,
        actualState: state,
      },
    );
  }
}

async function acquirePlanLock(lockPath) {
  let handle;
  try {
    handle = await fsp.open(lockPath, 'wx', 0o600);
    await handle.writeFile(
      `${JSON.stringify({
        pid: process.pid,
        createdAt: new Date().toISOString(),
      })}\n`,
    );
    await handle.sync();
    await handle.close();
  } catch (error) {
    if (handle) await handle.close();
    if (error.code === 'EEXIST') {
      fail('PLAN_ADVANCE_LOCKED', 'Plan manifest is already being advanced', { lockPath });
    }
    throw error;
  }
}

async function withPlanLock(planPath, callback) {
  const lockPath = `${planPath}.lock`;
  await acquirePlanLock(lockPath);
  try {
    return await callback();
  } finally {
    await fsp.rm(lockPath, { force: true });
  }
}

function dependenciesDone(task, tasksById) {
  return task.dependsOn.every((dependency) => tasksById.get(dependency).status === 'done');
}

function exhaustionFromOptions(options, manifest) {
  const decisionRefs = options['exhaustion-decision-ref'] ?? [];
  const evidenceRefs = options['exhaustion-evidence-ref'] ?? [];
  const recordedAt = options['recorded-at'];
  if (!recordedAt || decisionRefs.length === 0 || evidenceRefs.length === 0) {
    fail(
      'PLAN_ADVANCE_INVALID',
      'Blocked package transition requires --recorded-at and exhaustion decision/evidence refs',
    );
  }
  return {
    recordedAt,
    blockedTaskIds: manifest.tasks
      .filter((task) => task.status === 'blocked')
      .map((task) => task.id),
    decisionRefs,
    evidenceRefs,
  };
}

function applyAdvance(planPackage, options) {
  const manifest = structuredClone(planPackage.manifest);
  const tasksById = new Map(manifest.tasks.map((task) => [task.id, task]));
  const transition = requireOption(options, 'to');
  const nextTaskId =
    options.next && options.next.toLowerCase() !== 'none' ? options.next : undefined;

  if (transition === 'reactivate') {
    if (manifest.status !== 'blocked') {
      fail('PLAN_ADVANCE_INVALID', 'Only a blocked package may be reactivated');
    }
    if (!nextTaskId) {
      fail('PLAN_ADVANCE_INVALID', 'Reactivation requires an explicit --next Task');
    }
    const nextTask = tasksById.get(nextTaskId);
    if (
      !nextTask ||
      !['pending', 'blocked'].includes(nextTask.status) ||
      !dependenciesDone(nextTask, tasksById)
    ) {
      fail('PLAN_ADVANCE_INVALID', 'Reactivation successor is not dependency-ready', {
        nextTaskId,
      });
    }
    nextTask.status = 'in_progress';
    nextTask.blocker = null;
    manifest.status = 'active';
    manifest.exhaustion = null;
    return manifest;
  }

  if (!new Set(['done', 'blocked']).has(transition)) {
    fail('PLAN_ADVANCE_INVALID', '--to must be done, blocked, or reactivate');
  }
  if (manifest.status !== 'active') {
    fail('PLAN_ADVANCE_INVALID', 'Task handoff requires an active package', {
      status: manifest.status,
    });
  }
  const current = manifest.tasks.find((task) => task.status === 'in_progress');
  const expectedTaskId = requireOption(options, 'task');
  if (!current || current.id !== expectedTaskId) {
    fail('PLAN_ADVANCE_INVALID', '--task does not identify the current Task', {
      expected: current?.id ?? null,
      actual: expectedTaskId,
    });
  }

  if (transition === 'done') {
    current.status = 'done';
    current.blocker = null;
  } else {
    current.status = 'blocked';
    current.blocker = {
      code: requireOption(options, 'blocker-code'),
      owner: requireOption(options, 'blocker-owner'),
      evidenceRef: requireOption(options, 'blocker-evidence-ref'),
    };
  }

  if (nextTaskId) {
    const nextTask = tasksById.get(nextTaskId);
    if (
      !nextTask ||
      nextTask.status !== 'pending' ||
      !dependenciesDone(nextTask, tasksById)
    ) {
      fail('PLAN_ADVANCE_INVALID', 'Explicit successor is not dependency-ready', {
        nextTaskId,
      });
    }
    nextTask.status = 'in_progress';
    nextTask.blocker = null;
    manifest.status = 'active';
    manifest.exhaustion = null;
    return manifest;
  }

  if (manifest.tasks.every((task) => task.status === 'done')) {
    manifest.status = 'completed';
    manifest.exhaustion = null;
    return manifest;
  }

  const ready = manifest.tasks.filter(
    (task) => task.status === 'pending' && dependenciesDone(task, tasksById),
  );
  if (ready.length > 0) {
    fail('PLAN_ADVANCE_INVALID', 'A dependency-ready successor must be selected explicitly', {
      readyTaskIds: ready.map((task) => task.id),
    });
  }
  if (!manifest.tasks.some((task) => task.status === 'blocked')) {
    fail('PLAN_ADVANCE_INVALID', 'Task graph has no ready successor or blocked branch');
  }
  manifest.status = 'blocked';
  manifest.exhaustion = exhaustionFromOptions(options, manifest);
  return manifest;
}

async function validateCandidateDocument(planPackage, candidateDocument, options) {
  const temporaryPath = path.join(
    path.dirname(planPackage.path),
    `.planctl-candidate.${process.pid}.${Date.now()}.${Math.random()
      .toString(16)
      .slice(2)}.md`,
  );
  try {
    await fsp.writeFile(temporaryPath, candidateDocument, { flag: 'wx', mode: 0o600 });
    await loadPlanPackage(temporaryPath, {
      ...loadOptions(options),
      repoRoot: planPackage.repoRoot,
    });
  } finally {
    await fsp.rm(temporaryPath, { force: true });
  }
}

export async function advancePlan(planPath, options) {
  const initial = await loadPlanPackage(planPath, loadOptions(options));
  await validateSessionTerminal(options.session, initial);
  return withPlanLock(initial.path, async () => {
    const current = await loadPlanPackage(initial.path, loadOptions(options));
    const originalDocument = await fsp.readFile(current.path);
    const nextManifest = applyAdvance(current, options);
    const candidateDocument = renderPlanDocument(originalDocument.toString('utf8'), nextManifest);
    await validateCandidateDocument(current, candidateDocument, options);
    await atomicReplaceFile(current.path, candidateDocument, {
      expectedContent: originalDocument,
    });
    return loadPlanPackage(current.path, loadOptions(options));
  });
}

async function statusCommand(options) {
  assertAllowedOptions(options, PLAN_READ_OPTIONS);
  const planPackage = await loadPlanPackage(requireOption(options, 'plan'), loadOptions(options));
  return summarizePlanPackage(planPackage);
}

async function validateCommand(options) {
  assertAllowedOptions(options, PLAN_READ_OPTIONS);
  const planPackage = await loadPlanPackage(requireOption(options, 'plan'), loadOptions(options));
  return {
    ...summarizePlanPackage(planPackage),
    taskCount: planPackage.manifest.tasks.length,
    readyTaskIds: planPackage.readyTasks.map((task) => task.taskId),
  };
}

async function currentCommand(options) {
  assertAllowedOptions(options, PLAN_READ_OPTIONS);
  const planPackage = await loadPlanPackage(requireOption(options, 'plan'), loadOptions(options));
  const current = planPackage.manifest.tasks.find((task) => task.status === 'in_progress');
  return {
    ok: true,
    plan: planPackage.path,
    status: planPackage.manifest.status,
    currentTask: current ? taskProjection(planPackage, current) : null,
  };
}

async function nextCommand(options) {
  assertAllowedOptions(options, PLAN_READ_OPTIONS);
  const planPackage = await loadPlanPackage(requireOption(options, 'plan'), loadOptions(options));
  const readyIds = new Set(planPackage.readyTasks.map((task) => task.taskId));
  return {
    ok: true,
    plan: planPackage.path,
    status: planPackage.manifest.status,
    readyTasks: planPackage.manifest.tasks
      .filter((task) => readyIds.has(task.id))
      .map((task) => taskProjection(planPackage, task)),
  };
}

async function advanceCommand(options) {
  assertAllowedOptions(options, [
    'plan',
    'repo-root',
    'task',
    'to',
    'next',
    'session',
    'blocker-code',
    'blocker-owner',
    'blocker-evidence-ref',
    'recorded-at',
    'exhaustion-decision-ref',
    'exhaustion-evidence-ref',
  ]);
  const planPackage = await advancePlan(requireOption(options, 'plan'), options);
  return summarizePlanPackage(planPackage);
}

function canonicalMigrationPaths(workspaceId) {
  return getPlanMigrationPaths(machineDevRoot(), workspaceId);
}

function parseReplacementOptions(options) {
  return (options.replacement ?? []).map((value, index) => {
    try {
      return JSON.parse(value);
    } catch (error) {
      fail('PLAN_CLI_USAGE', '--replacement must contain JSON', {
        index,
        message: error.message,
      });
    }
  });
}

async function readActiveWorkRegistry(registryRef) {
  if (registryRef.startsWith('context://')) {
    const result = spawnSync('ctx-cli', ['cat', registryRef], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
    if (result.status !== 0) {
      fail(
        'PLAN_MIGRATION_ACTIVE_WORK_CONTEXT_REQUIRED',
        'ctx-cli could not read the active_work registry',
        {
          registryRef,
          status: result.status,
          stderr: result.stderr?.trim() || null,
        },
      );
    }
    return result.stdout;
  }
  if (!path.isAbsolute(registryRef)) {
    fail(
      'PLAN_CLI_USAGE',
      '--active-work-registry must be a context:// URI or absolute file path',
    );
  }
  return fsp.readFile(registryRef, 'utf8');
}

async function migrateCommand(options) {
  assertAllowedOptions(options, [
    'action',
    'repo-root',
    'legacy-plan',
    'package',
    'workspace-id',
    'migration-id',
    'crosswalk-path',
    'crosswalk-digest',
    'active-work-registry',
    'source-commit',
    'source-workspace-digest',
    'reviewed-journal-digest',
    'replacement',
    'strategy',
    'discovery-root',
    'expected-active-plan-count',
    'expected-package-status',
  ]);
  const action = options.action ?? 'prepare';
  const repoRoot = await fsp.realpath(
    path.resolve(requireOption(options, 'repo-root')),
  );
  const requestedWorkspaceId = requireOption(options, 'workspace-id');
  const workspaceId = workspaceIdForRoot(repoRoot);
  if (requestedWorkspaceId !== workspaceId) {
    fail(
      'WORKTREE_IDENTITY_MISMATCH',
      'Migration workspace ID must derive from the canonical repository root',
      {
        requestedWorkspaceId,
        workspaceId,
        repoRoot,
      },
    );
  }
  const paths = canonicalMigrationPaths(workspaceId);
  const shared = {
    repoRoot,
    journalPath: paths.journalPath,
    lockPath: paths.lockPath,
    activeWorkRegistry: requireOption(options, 'active-work-registry'),
    readActiveWorkRegistry,
  };
  let journal;
  let reviewedJournalDigest;
  if (action === 'prepare') {
    const expectedActivePlanCount = Number.parseInt(
      requireOption(options, 'expected-active-plan-count'),
      10,
    );
    journal = await preparePlanMigration({
      ...shared,
      legacyPlan: requireOption(options, 'legacy-plan'),
      packagePlan: requireOption(options, 'package'),
      workspaceId,
      migrationId: requireOption(options, 'migration-id'),
      crosswalkPath: options['crosswalk-path'],
      crosswalkDigest: requireOption(options, 'crosswalk-digest'),
      sourceIdentity: {
        commit: requireOption(options, 'source-commit'),
        workspaceDigest: requireOption(options, 'source-workspace-digest'),
        canonicalWorktreeHash: workspaceId,
      },
      replacements: parseReplacementOptions(options),
      discoveryRoot: requireOption(options, 'discovery-root'),
      expectedActivePlanCount,
      expectedPackageStatus: requireOption(options, 'expected-package-status'),
    });
    reviewedJournalDigest = sha256(await fsp.readFile(paths.journalPath));
  } else if (action === 'commit') {
    reviewedJournalDigest = requireOption(options, 'reviewed-journal-digest');
    journal = await commitPlanMigration({
      ...shared,
      reviewedJournalDigest,
    });
  } else if (action === 'recover') {
    reviewedJournalDigest = requireOption(options, 'reviewed-journal-digest');
    journal = await recoverPlanMigration({
      ...shared,
      reviewedJournalDigest,
      strategy: options.strategy ?? 'auto',
    });
  } else {
    fail('PLAN_CLI_USAGE', '--action must be prepare, commit, or recover');
  }
  return {
    ok: true,
    migration: journal,
    reviewedJournalDigest,
  };
}

export async function runPlanctl(argv = process.argv.slice(2)) {
  const { command, options } = parseArguments(argv);
  if (command === 'validate') return validateCommand(options);
  if (command === 'current') return currentCommand(options);
  if (command === 'next') return nextCommand(options);
  if (command === 'status') return statusCommand(options);
  if (command === 'advance') return advanceCommand(options);
  if (command === 'migrate') return migrateCommand(options);
  fail('PLAN_CLI_USAGE', 'Unknown command', {
    command,
    commands: ['validate', 'current', 'next', 'status', 'advance', 'migrate'],
  });
}

function typedError(error) {
  if (error instanceof PlanPackageError || error instanceof PlanMigrationError) {
    return error;
  }
  return new PlanPackageError('PLAN_INTERNAL_ERROR', error?.message ?? String(error));
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
