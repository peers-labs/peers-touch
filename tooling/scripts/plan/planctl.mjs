#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import {
  machineDevRoot,
  workspaceIdForRoot,
} from '../lib/machine-dev-paths.mjs';
import { canonicalize } from '../local-dev/dev-work-schema.mjs';
import {
  PlanPackageError,
  atomicMoveFileNoReplace,
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
  processIdentityForPid,
  recoverPlanMigration,
  sha256,
} from './plan-migration.mjs';
import {
  readSessionJournalFromPath,
  summarizeSessionJournal,
} from '../local-dev/dev-session-store.mjs';

const SUCCESSFUL_SESSION_STATES = new Set([
  'SOURCE_READY',
  'DELIVERY_READY',
]);
const TERMINAL_TASK_STATUSES = new Set(['done', 'descoped']);
const PLAN_LOCK_KIND = 'peers-touch-plan-lock';
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
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

function validateSourceEvidence(evidencePath, planPackage) {
  let raw;
  try {
    raw = fs.readFileSync(evidencePath, 'utf8');
  } catch (error) {
    fail(
      'PLAN_ADVANCE_INVALID',
      'Source evidence file is unreadable',
      { evidencePath, cause: error.code ?? error.message },
    );
  }
  let evidence;
  try {
    evidence = JSON.parse(raw);
  } catch {
    fail('PLAN_ADVANCE_INVALID', 'Source evidence is not valid JSON', { evidencePath });
  }
  if (
    !isPlainObject(evidence) ||
    evidence.planId !== planPackage.manifest.planId ||
    evidence.taskId !== planPackage.currentTask?.taskId ||
    evidence.workspaceId !== planPackage.manifest.binding.workspaceId ||
    evidence.branch !== planPackage.manifest.binding.branch
  ) {
    fail(
      'PLAN_ADVANCE_INVALID',
      'Source evidence identity does not match the current Task',
      { evidencePath },
    );
  }
  if (
    !Array.isArray(evidence.verifications) ||
    evidence.verifications.length === 0 ||
    !evidence.verifications.every(
      (record) =>
        isPlainObject(record) &&
        record.verificationClass === 'SOURCE_CHECK' &&
        record.result === 'PASS',
    )
  ) {
    fail(
      'PLAN_ADVANCE_INVALID',
      'Source evidence must contain at least one passing SOURCE_CHECK',
      { evidencePath },
    );
  }
  return evidence;
}

async function validateSessionHandoff(sessionPath, planPackage, options) {
  const transition = options.to;
  if (transition === 'reactivate') return;
  const hasSourceEvidence = typeof options['source-evidence'] === 'string';
  const hasSession = typeof sessionPath === 'string' && sessionPath.length > 0;
  if (hasSourceEvidence && hasSession) {
    fail(
      'PLAN_ADVANCE_INVALID',
      '--source-evidence and --session are mutually exclusive',
    );
  }
  if (hasSourceEvidence) {
    if (transition !== 'done') {
      fail(
        'PLAN_ADVANCE_INVALID',
        'Source evidence advance is only valid for --to done',
      );
    }
    if (planPackage.currentTask?.completionClass !== 'source') {
      fail(
        'PLAN_ADVANCE_INVALID',
        'Source evidence advance is only valid for source-class Tasks',
        { completionClass: planPackage.currentTask?.completionClass ?? null },
      );
    }
    const evidence = validateSourceEvidence(
      options['source-evidence'],
      planPackage,
    );
    return {
      taskId: planPackage.currentTask.taskId,
      sessionId: null,
      terminalState: 'SOURCE_READY',
      timing: null,
      evidence: {
        SOURCE_CHECK: evidence.verifications[0].result,
        STRUCTURAL_CHECK: 'UNPROVEN',
        UX_REVIEW: 'UNPROVEN',
        FUNCTIONAL_CHECK: 'UNPROVEN',
        ACCEPTANCE_PROOF: 'UNPROVEN',
      },
      tokens: null,
    };
  }
  if (typeof sessionPath !== 'string' || sessionPath.length === 0) {
    fail(
      'PLAN_ADVANCE_INVALID',
      'Task handoff requires an explicit journal-backed --session path',
    );
  }
  if (sessionPath.toUpperCase() === 'NONE') {
    fail(
      'PLAN_ADVANCE_INVALID',
      'Task handoff requires an existing journal-backed Session',
    );
  }
  let journal;
  try {
    journal = readSessionJournalFromPath(sessionPath, {
      expected: {
        planId: planPackage.manifest.planId,
        taskId: planPackage.currentTask?.taskId,
        workspaceId: planPackage.manifest.binding.workspaceId,
        branch: planPackage.manifest.binding.branch,
      },
    });
  } catch (error) {
    fail(
      'PLAN_ADVANCE_INVALID',
      'Task handoff Session is unavailable or invalid',
      { sessionPath, cause: error.code ?? error.message },
    );
  }
  const session = journal.session;
  const state =
    typeof session.state === 'string'
      ? session.state
      : typeof session.state?.state === 'string'
        ? session.state.state
        : null;
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
  if (transition === 'blocked') {
    if (
      state !== 'BLOCKED' ||
      typeof sessionState.currentFailure !== 'object' ||
      sessionState.currentFailure === null
    ) {
      fail(
        'PLAN_ADVANCE_INVALID',
        'Blocked Task handoff requires a BLOCKED Session with a failure record',
        { sessionPath, state },
      );
    }
    const failure = sessionState.currentFailure;
    const evidenceRef = failure.observationRef ?? failure.diagnosticRef;
    if (
      options['blocker-code'] !== failure.kind ||
      options['blocker-owner'] !== failure.owner ||
      options['blocker-evidence-ref'] !== evidenceRef
    ) {
      fail(
        'PLAN_ADVANCE_INVALID',
        'Blocked Task handoff metadata does not match the Session failure',
        {
          expected: {
            code: failure.kind,
            owner: failure.owner,
            evidenceRef: evidenceRef ?? null,
          },
          actual: {
            code: options['blocker-code'] ?? null,
            owner: options['blocker-owner'] ?? null,
            evidenceRef: options['blocker-evidence-ref'] ?? null,
          },
        },
      );
    }
    return null;
  }
  if (!SUCCESSFUL_SESSION_STATES.has(state)) {
    fail('PLAN_ADVANCE_INVALID', 'Current Development Session is not successful', {
      sessionPath,
      state,
      successfulStates: [...SUCCESSFUL_SESSION_STATES],
    });
  }
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
  const timing = summarizeSessionJournal(
    journal.events,
    sessionState.updatedAt,
  );
  return {
    taskId: sessionState.taskId,
    sessionId: sessionState.sessionId,
    terminalState: state,
    timing: {
      completeness: timing.completeness,
      startedAt: timing.startedAt,
      closedAt: timing.observedAt,
      elapsedMs: timing.elapsedMs,
      phaseMs: timing.phaseMs,
    },
    evidence: timing.evidence,
    tokens: null,
  };
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

async function syncDirectory(directory) {
  try {
    const handle = await fsp.open(directory, fs.constants.O_RDONLY);
    await handle.sync();
    await handle.close();
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EISDIR'].includes(error.code)) throw error;
  }
}

function planLockMetadata(planPath, ownerToken) {
  const processIdentity = processIdentityForPid(process.pid);
  if (processIdentity === null) {
    fail(
      'PLAN_LOCK_INVALID',
      'Current process identity cannot be established',
      { pid: process.pid },
    );
  }
  return {
    kind: PLAN_LOCK_KIND,
    planPath,
    ownerToken,
    pid: process.pid,
    processIdentity,
    createdAt: new Date().toISOString(),
  };
}

function validatePlanLockMetadata(metadata, planPath, context = 'Plan lock') {
  const expectedKeys = [
    'createdAt',
    'kind',
    'ownerToken',
    'pid',
    'planPath',
    'processIdentity',
  ];
  if (
    !isPlainObject(metadata) ||
    Object.keys(metadata).sort().join(',') !== expectedKeys.join(',') ||
    metadata.kind !== PLAN_LOCK_KIND ||
    metadata.planPath !== planPath ||
    !SHA256_PATTERN.test(metadata.ownerToken ?? '') ||
    !Number.isInteger(metadata.pid) ||
    metadata.pid < 1 ||
    !SHA256_PATTERN.test(metadata.processIdentity ?? '') ||
    typeof metadata.createdAt !== 'string' ||
    Number.isNaN(Date.parse(metadata.createdAt))
  ) {
    fail('PLAN_LOCK_INVALID', `${context} metadata is invalid`, { planPath });
  }
  return metadata;
}

async function readPlanLock(lockPath, planPath, context = 'Plan lock') {
  let raw;
  let metadata;
  try {
    raw = await fsp.readFile(lockPath);
    metadata = JSON.parse(raw.toString('utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) {
      fail('PLAN_LOCK_INVALID', `${context} metadata is not valid JSON`, {
        lockPath,
      });
    }
    throw error;
  }
  return {
    raw,
    metadata: validatePlanLockMetadata(metadata, planPath, context),
  };
}

function planLockOwnerIsLive(metadata) {
  try {
    process.kill(metadata.pid, 0);
  } catch (error) {
    if (error.code === 'ESRCH') return false;
  }
  const currentIdentity = processIdentityForPid(metadata.pid);
  return (
    currentIdentity === null ||
    currentIdentity === metadata.processIdentity
  );
}

async function invokePlanFailpoint(options, name) {
  if (typeof options.failpoint === 'function') {
    await options.failpoint(name);
  }
}

async function createOwnedPlanFile(lockPath, planPath) {
  await fsp.mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  const ownerToken = randomBytes(32).toString('hex');
  let handle;
  let created = false;
  try {
    handle = await fsp.open(lockPath, 'wx', 0o600);
    created = true;
    await handle.writeFile(`${JSON.stringify(planLockMetadata(planPath, ownerToken))}\n`);
    await handle.sync();
    await handle.close();
    handle = null;
    await syncDirectory(path.dirname(lockPath));
    return { lockPath, ownerToken, planPath };
  } catch (error) {
    if (handle) await handle.close();
    if (created) await fsp.rm(lockPath, { force: true });
    throw error;
  }
}

async function restoreCapturedPlanFile(capturedPath, destinationPath, message) {
  try {
    await atomicMoveFileNoReplace(capturedPath, destinationPath);
  } catch (error) {
    fail('PLAN_ADVANCE_LOCKED', message, {
      lockPath: destinationPath,
      capturedPath,
      cause: error.code ?? error.message,
    });
  }
}

async function acquirePlanRecoveryClaim(lockPath, planPath, options) {
  const claimPath = `${lockPath}.recovery`;
  const ownerToken = randomBytes(32).toString('hex');
  const candidatePath = `${claimPath}.${ownerToken}`;
  await fsp.writeFile(
    candidatePath,
    `${JSON.stringify(planLockMetadata(planPath, ownerToken))}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  try {
    while (true) {
      try {
        await fsp.link(candidatePath, claimPath);
        await syncDirectory(path.dirname(claimPath));
        return { lockPath: claimPath, ownerToken, planPath, candidatePath };
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      const current = await readPlanLock(
        claimPath,
        planPath,
        'Plan lock recovery claim',
      );
      if (current && planLockOwnerIsLive(current.metadata)) {
        fail('PLAN_ADVANCE_LOCKED', 'Plan lock recovery is already active', {
          lockPath: claimPath,
          pid: current.metadata.pid,
        });
      }
      await invokePlanFailpoint(options, 'after-stale-plan-recovery-claim-observed');
      const stalePath = `${claimPath}.stale.${ownerToken}`;
      try {
        await atomicMoveFileNoReplace(claimPath, stalePath);
      } catch (error) {
        if (error.code === 'PLAN_CONCURRENT_MODIFICATION') continue;
        throw error;
      }
      const captured = await readPlanLock(
        stalePath,
        planPath,
        'Captured Plan lock recovery claim',
      );
      if (
        !captured ||
        !current ||
        !captured.raw.equals(current.raw) ||
        planLockOwnerIsLive(captured.metadata)
      ) {
        await restoreCapturedPlanFile(
          stalePath,
          claimPath,
          'A competing Plan lock recovery claim changed during stale takeover',
        );
        continue;
      }
      await fsp.unlink(stalePath);
      await syncDirectory(path.dirname(stalePath));
    }
  } catch (error) {
    await fsp.rm(candidatePath, { force: true });
    throw error;
  }
}

async function releaseOwnedPlanFile(lease) {
  const releasePath = `${lease.lockPath}.release.${lease.ownerToken}`;
  try {
    await atomicMoveFileNoReplace(lease.lockPath, releasePath);
  } catch (error) {
    fail(
      'PLAN_LOCK_OWNERSHIP_MISMATCH',
      'Owned Plan lock is unavailable during release',
      {
        lockPath: lease.lockPath,
        expectedOwnerToken: lease.ownerToken,
        cause: error.code ?? error.message,
      },
    );
  }
  const captured = await readPlanLock(
    releasePath,
    lease.planPath,
    'Captured Plan lock release',
  );
  if (!captured || captured.metadata.ownerToken !== lease.ownerToken) {
    await restoreCapturedPlanFile(
      releasePath,
      lease.lockPath,
      'Plan lock changed during owned release',
    );
    fail(
      'PLAN_LOCK_OWNERSHIP_MISMATCH',
      'Plan lock is not owned by this operation',
      {
        lockPath: lease.lockPath,
        expectedOwnerToken: lease.ownerToken,
        actualOwnerToken: captured?.metadata.ownerToken ?? null,
      },
    );
  }
  await fsp.unlink(releasePath);
  if (lease.candidatePath) {
    await fsp.rm(lease.candidatePath, { force: true });
  }
  await syncDirectory(path.dirname(lease.lockPath));
}

async function acquirePlanLock(planPath, options) {
  const lockPath = `${planPath}.lock`;
  const recoveryClaim = await acquirePlanRecoveryClaim(lockPath, planPath, options);
  try {
    const current = await readPlanLock(lockPath, planPath);
    if (current && planLockOwnerIsLive(current.metadata)) {
      fail('PLAN_ADVANCE_LOCKED', 'Plan manifest is already being changed', {
        lockPath,
        pid: current.metadata.pid,
      });
    }
    if (current) {
      await invokePlanFailpoint(options, 'after-stale-plan-lock-observed');
      const stalePath = `${lockPath}.stale.${recoveryClaim.ownerToken}`;
      await atomicMoveFileNoReplace(lockPath, stalePath);
      const captured = await readPlanLock(
        stalePath,
        planPath,
        'Captured stale Plan lock',
      );
      if (
        !captured ||
        !captured.raw.equals(current.raw) ||
        planLockOwnerIsLive(captured.metadata)
      ) {
        await restoreCapturedPlanFile(
          stalePath,
          lockPath,
          'A competing Plan lock changed during stale takeover',
        );
        fail(
          captured && planLockOwnerIsLive(captured.metadata)
            ? 'PLAN_ADVANCE_LOCKED'
            : 'PLAN_LOCK_OWNERSHIP_MISMATCH',
          'Captured Plan lock is not the reviewed stale lock',
          { lockPath },
        );
      }
      await fsp.unlink(stalePath);
      await syncDirectory(path.dirname(stalePath));
    }
    const lease = await createOwnedPlanFile(lockPath, planPath);
    lease.recoveryClaim = recoveryClaim;
    return lease;
  } catch (error) {
    await releaseOwnedPlanFile(recoveryClaim);
    throw error;
  }
}

async function releasePlanLock(lease) {
  try {
    await releaseOwnedPlanFile(lease);
  } finally {
    await releaseOwnedPlanFile(lease.recoveryClaim);
  }
}

async function withPlanLock(planPath, options, callback) {
  const lease = await acquirePlanLock(planPath, options);
  try {
    await invokePlanFailpoint(options, 'after-plan-lock-acquired');
    return await callback();
  } finally {
    await releasePlanLock(lease);
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

  if (manifest.tasks.every((task) => TERMINAL_TASK_STATUSES.has(task.status))) {
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

function parseSourceInvalidationPolicy(document) {
  const match = /^## Source Invalidation Policy\s*$\n+```json\s*$\n([\s\S]*?)\n```\s*$/m.exec(
    document,
  );
  if (!match) {
    fail(
      'PLAN_SOURCE_INVALIDATION_UNAVAILABLE',
      'Plan does not declare a source invalidation policy',
    );
  }
  let policy;
  try {
    policy = JSON.parse(match[1]);
  } catch {
    fail(
      'PLAN_SOURCE_INVALIDATION_INVALID',
      'Source invalidation policy is not valid JSON',
    );
  }
  const keys = Object.keys(policy ?? {}).sort();
  const expectedKeys = ['kind', 'rootTaskIds', 'sourceOwnerTaskId'];
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index]) ||
    policy.kind !== 'peers-touch-source-invalidation-policy' ||
    typeof policy.sourceOwnerTaskId !== 'string' ||
    !Array.isArray(policy.rootTaskIds) ||
    policy.rootTaskIds.length === 0 ||
    policy.rootTaskIds.some((taskId) => typeof taskId !== 'string') ||
    new Set(policy.rootTaskIds).size !== policy.rootTaskIds.length
  ) {
    fail(
      'PLAN_SOURCE_INVALIDATION_INVALID',
      'Source invalidation policy has an invalid shape',
    );
  }
  return policy;
}

function sourceInvalidationClosure(manifest, policy) {
  const tasksById = new Map(manifest.tasks.map((task) => [task.id, task]));
  const taskIds = new Set(tasksById.keys());
  if (
    !taskIds.has(policy.sourceOwnerTaskId) ||
    policy.rootTaskIds.some(
      (taskId) =>
        taskId === policy.sourceOwnerTaskId || !taskIds.has(taskId),
    )
  ) {
    fail(
      'PLAN_SOURCE_INVALIDATION_INVALID',
      'Source invalidation policy references invalid Tasks',
      { policy },
    );
  }
  const dependsOnSourceOwner = (taskId, visited = new Set()) => {
    if (taskId === policy.sourceOwnerTaskId) return true;
    if (visited.has(taskId)) return false;
    visited.add(taskId);
    return tasksById
      .get(taskId)
      .dependsOn.some((dependency) =>
        dependsOnSourceOwner(dependency, visited),
      );
  };
  if (
    policy.rootTaskIds.some(
      (taskId) => !dependsOnSourceOwner(taskId),
    )
  ) {
    fail(
      'PLAN_SOURCE_INVALIDATION_INVALID',
      'Every source invalidation root must depend on the source owner',
      { policy },
    );
  }
  const affected = new Set(policy.rootTaskIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of manifest.tasks) {
      if (
        !affected.has(task.id) &&
        task.dependsOn.some((dependency) => affected.has(dependency))
      ) {
        affected.add(task.id);
        changed = true;
      }
    }
  }
  return {
    sourceOwnerTaskId: policy.sourceOwnerTaskId,
    rootTaskIds: [...policy.rootTaskIds],
    affectedTaskIds: manifest.tasks
      .filter((task) => affected.has(task.id))
      .map((task) => task.id),
  };
}

function applySourceInvalidation(planPackage, options, policy) {
  const manifest = structuredClone(planPackage.manifest);
  if (manifest.status !== 'active') {
    fail(
      'PLAN_SOURCE_INVALIDATION_INVALID',
      'Source invalidation requires an active Plan',
      { status: manifest.status },
    );
  }
  const failedTaskId = requireOption(options, 'task');
  const firstFailureRef = requireOption(options, 'first-failure-ref');
  if (
    path.isAbsolute(firstFailureRef) ||
    firstFailureRef.includes('\\') ||
    firstFailureRef.split('/').some((part) => ['', '.', '..'].includes(part))
  ) {
    fail(
      'PLAN_SOURCE_INVALIDATION_INVALID',
      '--first-failure-ref must be a repository-relative evidence reference',
    );
  }
  const current = manifest.tasks.find((task) => task.status === 'in_progress');
  if (!current || current.id !== failedTaskId) {
    fail(
      'PLAN_SOURCE_INVALIDATION_INVALID',
      '--task does not identify the current functional Task',
      { expected: current?.id ?? null, actual: failedTaskId },
    );
  }
  const currentSlice = planPackage.taskSlices.get(failedTaskId);
  if (currentSlice?.completionClass !== 'functional') {
    fail(
      'PLAN_SOURCE_INVALIDATION_INVALID',
      'Only a functional Task may invalidate the frozen source',
      { taskId: failedTaskId },
    );
  }
  const closure = sourceInvalidationClosure(manifest, policy);
  if (!closure.affectedTaskIds.includes(failedTaskId)) {
    fail(
      'PLAN_SOURCE_INVALIDATION_INVALID',
      'Current Task is outside the Plan-declared invalidation closure',
      { taskId: failedTaskId, rootTaskIds: closure.rootTaskIds },
    );
  }
  const tasksById = new Map(manifest.tasks.map((task) => [task.id, task]));
  const sourceOwner = tasksById.get(closure.sourceOwnerTaskId);
  if (sourceOwner?.status !== 'done') {
    fail(
      'PLAN_SOURCE_INVALIDATION_INVALID',
      'Plan-declared source owner is not complete',
      {
        sourceOwnerTaskId: closure.sourceOwnerTaskId,
        status: sourceOwner?.status ?? null,
      },
    );
  }
  const invalidatedEvidence = closure.affectedTaskIds.flatMap((taskId) =>
    (planPackage.taskSlices.get(taskId)?.durableEvidence ?? []).map((evidence) => ({
      taskId,
      verificationClass: evidence.verificationClass,
      result: evidence.result,
      ref: evidence.ref,
    })),
  );
  for (const taskId of closure.affectedTaskIds) {
    const task = tasksById.get(taskId);
    task.status = 'pending';
    task.blocker = null;
  }
  sourceOwner.status = 'in_progress';
  sourceOwner.blocker = null;
  manifest.status = 'active';
  manifest.exhaustion = null;
  return {
    manifest,
    proof: {
      kind: 'peers-touch-source-invalidation-proof',
      planId: manifest.planId,
      workspaceId: manifest.binding.workspaceId,
      sourceOwnerTaskId: closure.sourceOwnerTaskId,
      rootTaskIds: closure.rootTaskIds,
      failedTaskId,
      invalidatedTaskIds: closure.affectedTaskIds,
      firstFailureRef,
      priorManifestDigest: sha256(
        Buffer.from(JSON.stringify(canonicalize(planPackage.manifest))),
      ),
      invalidatedEvidence,
    },
  };
}

async function writeSourceInvalidationProof(proof, options = {}) {
  const unsigned = canonicalize(proof);
  const proofDigest = sha256(Buffer.from(JSON.stringify(unsigned)));
  const payload = {
    ...unsigned,
    proofDigest,
  };
  const bytes = Buffer.from(`${JSON.stringify(canonicalize(payload), null, 2)}\n`);
  const proofPath = path.join(
    machineDevRoot(options.home),
    'workspaces',
    proof.workspaceId,
    'workflow',
    'source-invalidations',
    proof.planId,
    `${proofDigest}.json`,
  );
  await fsp.mkdir(path.dirname(proofPath), { recursive: true, mode: 0o700 });
  try {
    await fsp.writeFile(proofPath, bytes, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = await fsp.readFile(proofPath);
    if (!existing.equals(bytes)) {
      fail(
        'PLAN_SOURCE_INVALIDATION_CONFLICT',
        'Source invalidation proof path contains different bytes',
        { proofPath },
      );
    }
  }
  return {
    proofDigest,
    proofPath,
  };
}

function applyActivation(planPackage, options) {
  if (planPackage.manifest.status !== 'prepared') {
    fail('PLAN_ACTIVATE_INVALID', 'Only a prepared Plan Package may be activated', {
      status: planPackage.manifest.status,
    });
  }
  const taskId = requireOption(options, 'task');
  const manifest = structuredClone(planPackage.manifest);
  const tasksById = new Map(manifest.tasks.map((task) => [task.id, task]));
  const task = tasksById.get(taskId);
  if (
    !task ||
    task.status !== 'pending' ||
    !dependenciesDone(task, tasksById)
  ) {
    fail('PLAN_ACTIVATE_INVALID', 'Activation Task is not dependency-ready', {
      taskId,
    });
  }
  manifest.status = 'active';
  task.status = 'in_progress';
  task.blocker = null;
  manifest.exhaustion = null;
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
  return withPlanLock(initial.path, options, async () => {
    const current = await loadPlanPackage(initial.path, loadOptions(options));
    const closureObservation = await validateSessionHandoff(
      options.session,
      current,
      options,
    );
    const originalDocument = await fsp.readFile(current.path);
    const nextManifest = applyAdvance(current, options);
    const candidateDocument = renderPlanDocument(originalDocument.toString('utf8'), nextManifest);
    await validateCandidateDocument(current, candidateDocument, options);
    await atomicReplaceFile(current.path, candidateDocument, {
      expectedContent: originalDocument,
    });
    const advanced = await loadPlanPackage(current.path, loadOptions(options));
    advanced.closureObservation = closureObservation;
    return advanced;
  });
}

export async function activatePlan(planPath, options) {
  const initial = await loadPlanPackage(planPath, loadOptions(options));
  return withPlanLock(initial.path, options, async () => {
    const current = await loadPlanPackage(initial.path, loadOptions(options));
    const originalDocument = await fsp.readFile(current.path);
    const nextManifest = applyActivation(current, options);
    const candidateDocument = renderPlanDocument(
      originalDocument.toString('utf8'),
      nextManifest,
    );
    await validateCandidateDocument(current, candidateDocument, options);
    await atomicReplaceFile(current.path, candidateDocument, {
      expectedContent: originalDocument,
    });
    return loadPlanPackage(current.path, loadOptions(options));
  });
}

export async function invalidateSourcePlan(planPath, options) {
  const initial = await loadPlanPackage(planPath, loadOptions(options));
  return withPlanLock(initial.path, options, async () => {
    const current = await loadPlanPackage(initial.path, loadOptions(options));
    const originalDocument = await fsp.readFile(current.path);
    const policy = parseSourceInvalidationPolicy(
      originalDocument.toString('utf8'),
    );
    const invalidation = applySourceInvalidation(current, options, policy);
    const candidateDocument = renderPlanDocument(
      originalDocument.toString('utf8'),
      invalidation.manifest,
    );
    await validateCandidateDocument(current, candidateDocument, options);
    const proof = await writeSourceInvalidationProof(
      invalidation.proof,
      options,
    );
    await atomicReplaceFile(current.path, candidateDocument, {
      expectedContent: originalDocument,
    });
    return {
      planPackage: await loadPlanPackage(current.path, loadOptions(options)),
      proof,
    };
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
    'source-evidence',
    'blocker-code',
    'blocker-owner',
    'blocker-evidence-ref',
    'recorded-at',
    'exhaustion-decision-ref',
    'exhaustion-evidence-ref',
  ]);
  const planPackage = await advancePlan(requireOption(options, 'plan'), options);
  return {
    ...summarizePlanPackage(planPackage),
    closureObservation: planPackage.closureObservation ?? null,
  };
}

async function activateCommand(options) {
  assertAllowedOptions(options, ['plan', 'repo-root', 'task']);
  const planPackage = await activatePlan(requireOption(options, 'plan'), options);
  return summarizePlanPackage(planPackage);
}

async function invalidateSourceCommand(options) {
  assertAllowedOptions(options, [
    'plan',
    'repo-root',
    'task',
    'first-failure-ref',
    'home',
  ]);
  const result = await invalidateSourcePlan(
    requireOption(options, 'plan'),
    options,
  );
  return {
    ...summarizePlanPackage(result.planPackage),
    invalidationProof: result.proof,
  };
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
    'expected-current-task',
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
      expectedCurrentTaskId:
        requireOption(options, 'expected-current-task').toUpperCase() === 'NONE'
          ? null
          : options['expected-current-task'],
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
  if (command === 'activate') return activateCommand(options);
  if (command === 'advance') return advanceCommand(options);
  if (command === 'invalidate-source') return invalidateSourceCommand(options);
  if (command === 'migrate') return migrateCommand(options);
  fail('PLAN_CLI_USAGE', 'Unknown command', {
    command,
    commands: [
      'validate',
      'current',
      'next',
      'status',
      'activate',
      'advance',
      'invalidate-source',
      'migrate',
    ],
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
