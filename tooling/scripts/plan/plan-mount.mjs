#!/usr/bin/env node

import crypto, { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import {
  machineDevRoot,
  workspaceIdForRoot,
  workspaceWorkflowPath,
} from '../lib/machine-dev-paths.mjs';
import {
  WorkspaceLifecycleLockError,
  withWorkspaceLifecycleLock,
} from '../local-dev/workspace-lifecycle-lock.mjs';
import { assertDevelopmentCloseAdmission } from '../local-dev/development-close-store.mjs';
import {
  atomicReplaceFile,
  isDirectInvocation,
  loadPlanPackage,
  validateRepositoryPath,
} from './plan-package.mjs';

export const PLAN_MOUNT_KIND = 'peers-touch-plan-mount';
export const PLAN_MOUNT_LEDGER_KIND = 'peers-touch-plan-mount-ledger';
export const EXECUTION_PLAN_SNAPSHOT_KIND =
  'peers-touch-execution-plan-snapshot';
export const EXECUTION_RUN_KIND = 'peers-touch-execution-run';

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const WORKSPACE_ID = /^[0-9a-f]{16}$/;
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MOUNT_STATES = new Set(['mounted', 'released']);
const RELEASE_REASONS = new Set([
  'completed',
  'cancelled',
  'owner-unmount',
]);
const RUN_STATES = new Set([
  'prepared',
  'active',
  'blocked',
  'completed',
  'cancelled',
]);
const TASK_STATES = new Set(['pending', 'in_progress', 'blocked', 'done']);
const LOCK_TIMEOUT_MS = 5_000;

const LEDGER_KEYS = new Set([
  'kind',
  'revision',
  'liveMountsByWorkspace',
  'liveMountsByPlanVersion',
  'runsByMount',
  'recordDigest',
]);
const MOUNT_KEYS = new Set([
  'kind',
  'mountId',
  'projectId',
  'planId',
  'planVersionId',
  'planVersionDigest',
  'planPath',
  'workspaceId',
  'canonicalRoot',
  'state',
  'mountedAt',
  'mountedBy',
  'releasedAt',
  'releaseReason',
  'recordDigest',
]);
const SNAPSHOT_KEYS = new Set([
  'kind',
  'snapshotId',
  'capturedAt',
  'planId',
  'planVersionId',
  'planVersionDigest',
  'planPath',
  'plan',
  'tasks',
  'acceptance',
  'executionBinding',
  'recordDigest',
]);
const EXECUTION_BINDING_KEYS = new Set([
  'mountId',
  'workspaceId',
  'canonicalRoot',
  'branch',
  'initialHead',
]);
const RUN_KEYS = new Set([
  'kind',
  'runId',
  'snapshotId',
  'snapshotDigest',
  'mountId',
  'state',
  'taskStates',
  'exhaustion',
  'currentTaskId',
  'updatedAt',
  'revision',
  'recordDigest',
]);
const TASK_STATE_KEYS = new Set(['state', 'blocker']);
const BLOCKER_KEYS = new Set(['code', 'owner', 'evidenceRef']);
const EXHAUSTION_KEYS = new Set([
  'recordedAt',
  'blockedTaskIds',
  'decisionRefs',
  'evidenceRefs',
]);

export class PlanMountError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'PlanMountError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }

  toJSON() {
    return {
      ok: false,
      error: {
        type: this.name,
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

function fail(code, message, details) {
  throw new PlanMountError(code, message, details);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys) {
  if (!isObject(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.size && actual.every((key) => keys.has(key));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function digestRecord(record) {
  const unsigned = { ...record };
  delete unsigned.recordDigest;
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalize(unsigned)))
    .digest('hex');
}

export function digestPlanMountRecord(record) {
  return digestRecord(record);
}

export function digestExecutionSnapshot(record) {
  return digestRecord(record);
}

export function digestExecutionRun(record) {
  return digestRecord(record);
}

function requiredText(value, field, pattern = undefined) {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value === '' ||
    value.includes('\0') ||
    value.includes('\n') ||
    (pattern && !pattern.test(value))
  ) {
    fail('PLAN_MOUNT_INVALID', `${field} is invalid`, { field });
  }
  return value;
}

function canonicalTimestamp(value, field) {
  requiredText(value, field);
  if (
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    fail('PLAN_MOUNT_INVALID', `${field} must be a canonical timestamp`);
  }
  return value;
}

function operationDate(options = {}) {
  const value =
    typeof options.clock === 'function'
      ? options.clock()
      : options.now ?? new Date();
  const now = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(now.getTime())) {
    fail('PLAN_MOUNT_INVALID', 'operation clock is invalid');
  }
  return now;
}

function randomId(prefix, now) {
  return `${prefix}-${now
    .toISOString()
    .replace(/[^0-9]/g, '')
    .slice(0, 17)}-${randomBytes(16).toString('hex')}`;
}

function canonicalWorkspace(root) {
  let canonicalRoot;
  try {
    canonicalRoot = fs.realpathSync(path.resolve(root));
  } catch (error) {
    fail('WORKTREE_IDENTITY_UNAVAILABLE', 'workspace root cannot be resolved', {
      root,
      cause: String(error),
    });
  }
  let gitRoot;
  let branch;
  let initialHead;
  try {
    gitRoot = fs.realpathSync(
      execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: canonicalRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim(),
    );
    branch = execFileSync('git', ['branch', '--show-current'], {
      cwd: canonicalRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    initialHead = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: canonicalRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    fail('WORKTREE_IDENTITY_UNAVAILABLE', 'workspace Git identity is unavailable', {
      root: canonicalRoot,
      cause: String(error),
    });
  }
  if (gitRoot !== canonicalRoot) {
    fail(
      'WORKTREE_IDENTITY_MISMATCH',
      'workspace root is not the Git worktree root',
      { requested: canonicalRoot, actual: gitRoot },
    );
  }
  requiredText(branch, 'branch');
  requiredText(initialHead, 'initialHead', SHA1);
  return {
    canonicalRoot,
    workspaceId: workspaceIdForRoot(canonicalRoot),
    branch,
    initialHead,
  };
}

function defaultProjectId(workspace) {
  let remote;
  try {
    remote = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: workspace.canonicalRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    fail(
      'PLAN_MOUNT_PROJECT_ID_REQUIRED',
      'projectId is required when the repository has no origin remote',
      { cause: String(error) },
    );
  }
  const normalized = remote.replace(/\\/g, '/').replace(/\.git$/, '');
  const projectId = normalized.split('/').at(-1)?.split(':').at(-1);
  return requiredText(projectId, 'projectId', IDENTIFIER);
}

export function planMountRootPath(options = {}) {
  return path.join(machineDevRoot(options.home), 'plan-mounts');
}

export function planMountLedgerPath(options = {}) {
  return path.join(planMountRootPath(options), 'ledger.json');
}

export function planMountRecordPath(mountId, options = {}) {
  requiredText(mountId, 'mountId', IDENTIFIER);
  return path.join(planMountRootPath(options), 'mounts', `${mountId}.json`);
}

export function planMountLockPath(options = {}) {
  return path.join(planMountRootPath(options), 'ledger.lock');
}

export function executionRunPaths(runId, options = {}) {
  requiredText(runId, 'runId', IDENTIFIER);
  const root = workspaceWorkflowPath(runId, {
    home: options.home,
    repoRoot: options.repoRoot,
    workspaceId: options.workspaceId,
  });
  return {
    root,
    snapshot: path.join(root, 'execution-plan-snapshot.json'),
    run: path.join(root, 'execution-run.json'),
  };
}

function emptyLedger() {
  const ledger = {
    kind: PLAN_MOUNT_LEDGER_KIND,
    revision: 0,
    liveMountsByWorkspace: {},
    liveMountsByPlanVersion: {},
    runsByMount: {},
  };
  ledger.recordDigest = digestRecord(ledger);
  return ledger;
}

function validateStringMap(value, field, valuePattern = IDENTIFIER) {
  if (!isObject(value)) {
    fail('PLAN_MOUNT_LEDGER_INVALID', `${field} must be an object`);
  }
  for (const [key, item] of Object.entries(value)) {
    requiredText(key, `${field} key`);
    requiredText(item, `${field}.${key}`, valuePattern);
  }
}

function validateLedger(value) {
  if (
    !exactKeys(value, LEDGER_KEYS) ||
    value.kind !== PLAN_MOUNT_LEDGER_KIND ||
    !Number.isInteger(value.revision) ||
    value.revision < 0 ||
    typeof value.recordDigest !== 'string' ||
    !SHA256.test(value.recordDigest) ||
    digestRecord(value) !== value.recordDigest
  ) {
    fail('PLAN_MOUNT_LEDGER_INVALID', 'Plan mount ledger is invalid');
  }
  validateStringMap(
    value.liveMountsByWorkspace,
    'liveMountsByWorkspace',
    IDENTIFIER,
  );
  for (const workspaceId of Object.keys(value.liveMountsByWorkspace)) {
    if (!WORKSPACE_ID.test(workspaceId)) {
      fail(
        'PLAN_MOUNT_LEDGER_INVALID',
        'live workspace index contains an invalid workspaceId',
      );
    }
  }
  validateStringMap(
    value.liveMountsByPlanVersion,
    'liveMountsByPlanVersion',
    IDENTIFIER,
  );
  for (const digest of Object.keys(value.liveMountsByPlanVersion)) {
    if (!SHA256.test(digest)) {
      fail(
        'PLAN_MOUNT_LEDGER_INVALID',
        'live Plan Version index contains an invalid digest',
      );
    }
  }
  validateStringMap(value.runsByMount, 'runsByMount', IDENTIFIER);
  return value;
}

function validateMount(record) {
  if (
    !exactKeys(record, MOUNT_KEYS) ||
    record.kind !== PLAN_MOUNT_KIND ||
    !IDENTIFIER.test(record.mountId ?? '') ||
    !IDENTIFIER.test(record.projectId ?? '') ||
    !IDENTIFIER.test(record.planId ?? '') ||
    !IDENTIFIER.test(record.planVersionId ?? '') ||
    !SHA256.test(record.planVersionDigest ?? '') ||
    !WORKSPACE_ID.test(record.workspaceId ?? '') ||
    !path.isAbsolute(record.canonicalRoot ?? '') ||
    !MOUNT_STATES.has(record.state) ||
    !SHA256.test(record.recordDigest ?? '') ||
    digestRecord(record) !== record.recordDigest
  ) {
    fail('PLAN_MOUNT_INVALID', 'Plan mount record is invalid');
  }
  validateRepositoryPath(record.planPath, 'PlanMount.planPath');
  canonicalTimestamp(record.mountedAt, 'PlanMount.mountedAt');
  requiredText(record.mountedBy, 'PlanMount.mountedBy');
  if (record.state === 'mounted') {
    if (record.releasedAt !== null || record.releaseReason !== null) {
      fail(
        'PLAN_MOUNT_INVALID',
        'mounted Plan record cannot contain release fields',
      );
    }
  } else {
    canonicalTimestamp(record.releasedAt, 'PlanMount.releasedAt');
    if (!RELEASE_REASONS.has(record.releaseReason)) {
      fail('PLAN_MOUNT_INVALID', 'released Plan record has invalid reason');
    }
  }
  return record;
}

function validateSnapshot(snapshot) {
  if (
    !exactKeys(snapshot, SNAPSHOT_KEYS) ||
    snapshot.kind !== EXECUTION_PLAN_SNAPSHOT_KIND ||
    !IDENTIFIER.test(snapshot.snapshotId ?? '') ||
    !IDENTIFIER.test(snapshot.planId ?? '') ||
    !IDENTIFIER.test(snapshot.planVersionId ?? '') ||
    !SHA256.test(snapshot.planVersionDigest ?? '') ||
    !Array.isArray(snapshot.tasks) ||
    !exactKeys(snapshot.executionBinding, EXECUTION_BINDING_KEYS) ||
    !IDENTIFIER.test(snapshot.executionBinding.mountId ?? '') ||
    !WORKSPACE_ID.test(snapshot.executionBinding.workspaceId ?? '') ||
    !path.isAbsolute(snapshot.executionBinding.canonicalRoot ?? '') ||
    !SHA1.test(snapshot.executionBinding.initialHead ?? '') ||
    !SHA256.test(snapshot.recordDigest ?? '') ||
    digestRecord(snapshot) !== snapshot.recordDigest
  ) {
    fail(
      'EXECUTION_PLAN_SNAPSHOT_INVALID',
      'Execution Plan snapshot is invalid',
    );
  }
  canonicalTimestamp(snapshot.capturedAt, 'ExecutionPlanSnapshot.capturedAt');
  requiredText(snapshot.executionBinding.branch, 'executionBinding.branch');
  validateRepositoryPath(snapshot.planPath, 'ExecutionPlanSnapshot.planPath');
  return snapshot;
}

function validateBlocker(blocker, field) {
  if (!exactKeys(blocker, BLOCKER_KEYS)) {
    fail('EXECUTION_RUN_INVALID', `${field} is invalid`);
  }
  for (const key of BLOCKER_KEYS) {
    requiredText(blocker[key], `${field}.${key}`);
  }
}

function validateExhaustion(exhaustion) {
  if (!exactKeys(exhaustion, EXHAUSTION_KEYS)) {
    fail('EXECUTION_RUN_INVALID', 'ExecutionRun.exhaustion is invalid');
  }
  canonicalTimestamp(exhaustion.recordedAt, 'ExecutionRun.exhaustion.recordedAt');
  for (const field of [
    'blockedTaskIds',
    'decisionRefs',
    'evidenceRefs',
  ]) {
    if (
      !Array.isArray(exhaustion[field]) ||
      exhaustion[field].length === 0 ||
      new Set(exhaustion[field]).size !== exhaustion[field].length
    ) {
      fail('EXECUTION_RUN_INVALID', `ExecutionRun.exhaustion.${field} is invalid`);
    }
    exhaustion[field].forEach((value) =>
      requiredText(value, `ExecutionRun.exhaustion.${field}`),
    );
  }
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

function validateRun(run, snapshot) {
  if (
    !exactKeys(run, RUN_KEYS) ||
    run.kind !== EXECUTION_RUN_KIND ||
    !IDENTIFIER.test(run.runId ?? '') ||
    !IDENTIFIER.test(run.snapshotId ?? '') ||
    !SHA256.test(run.snapshotDigest ?? '') ||
    !IDENTIFIER.test(run.mountId ?? '') ||
    !RUN_STATES.has(run.state) ||
    !isObject(run.taskStates) ||
    !Number.isInteger(run.revision) ||
    run.revision < 1 ||
    !SHA256.test(run.recordDigest ?? '') ||
    digestRecord(run) !== run.recordDigest
  ) {
    fail('EXECUTION_RUN_INVALID', 'Execution Run is invalid');
  }
  canonicalTimestamp(run.updatedAt, 'ExecutionRun.updatedAt');
  if (
    run.snapshotId !== snapshot.snapshotId ||
    run.snapshotDigest !== snapshot.recordDigest ||
    run.mountId !== snapshot.executionBinding.mountId
  ) {
    fail(
      'EXECUTION_RUN_IDENTITY_MISMATCH',
      'Execution Run does not match its immutable snapshot',
    );
  }
  const expectedIds = snapshot.plan.tasks.map((task) => task.id).sort();
  const actualIds = Object.keys(run.taskStates).sort();
  if (
    expectedIds.length !== actualIds.length ||
    expectedIds.some((id, index) => id !== actualIds[index])
  ) {
    fail(
      'EXECUTION_RUN_INVALID',
      'Execution Run Task states do not equal the snapshot Task DAG',
    );
  }
  for (const [taskId, state] of Object.entries(run.taskStates)) {
    if (
      !exactKeys(state, TASK_STATE_KEYS) ||
      !TASK_STATES.has(state.state)
    ) {
      fail('EXECUTION_RUN_INVALID', 'Execution Run Task state is invalid', {
        taskId,
      });
    }
    if (state.state === 'blocked') {
      validateBlocker(state.blocker, `taskStates.${taskId}.blocker`);
    } else if (state.blocker !== null) {
      fail(
        'EXECUTION_RUN_INVALID',
        'Only a blocked Task may contain blocker metadata',
        { taskId },
      );
    }
    const task = snapshot.plan.tasks.find((candidate) => candidate.id === taskId);
    if (
      ['in_progress', 'blocked', 'done'].includes(state.state) &&
      !task.dependsOn.every(
        (dependency) => run.taskStates[dependency].state === 'done',
      )
    ) {
      fail(
        'EXECUTION_RUN_INVALID',
        'advanced Task has an incomplete dependency',
        { taskId },
      );
    }
  }

  const inProgress = Object.entries(run.taskStates)
    .filter(([, state]) => state.state === 'in_progress')
    .map(([taskId]) => taskId);
  const blocked = Object.entries(run.taskStates)
    .filter(([, state]) => state.state === 'blocked')
    .map(([taskId]) => taskId);
  const done = Object.values(run.taskStates).filter(
    (state) => state.state === 'done',
  ).length;
  if (run.state === 'prepared') {
    if (
      inProgress.length !== 0 ||
      run.currentTaskId !== null ||
      run.exhaustion !== null
    ) {
      fail('EXECUTION_RUN_INVALID', 'prepared Run lifecycle is invalid');
    }
  } else if (run.state === 'active') {
    if (
      inProgress.length !== 1 ||
      run.currentTaskId !== inProgress[0] ||
      run.exhaustion !== null
    ) {
      fail('EXECUTION_RUN_INVALID', 'active Run lifecycle is invalid');
    }
  } else if (run.state === 'blocked') {
    if (
      inProgress.length !== 0 ||
      run.currentTaskId !== null ||
      blocked.length === 0 ||
      run.exhaustion === null
    ) {
      fail('EXECUTION_RUN_INVALID', 'blocked Run lifecycle is invalid');
    }
    validateExhaustion(run.exhaustion);
    if (
      readyTaskIds(snapshot, run).length !== 0 ||
      [...run.exhaustion.blockedTaskIds].sort().join('\0') !==
        [...blocked].sort().join('\0')
    ) {
      fail(
        'EXECUTION_RUN_INVALID',
        'blocked Run exhaustion does not describe a fixed point',
      );
    }
  } else if (run.state === 'completed') {
    if (
      done !== expectedIds.length ||
      run.currentTaskId !== null ||
      inProgress.length !== 0 ||
      run.exhaustion !== null
    ) {
      fail('EXECUTION_RUN_INVALID', 'completed Run lifecycle is invalid');
    }
  } else if (run.state === 'cancelled') {
    if (inProgress.length !== 0 || run.currentTaskId !== null) {
      fail('EXECUTION_RUN_INVALID', 'cancelled Run lifecycle is invalid');
    }
  }
  return run;
}

function parseJsonFile(file, code, message, validator) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    fail(code, message, { file, cause: String(error) });
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    fail(code, message, { file, cause: String(error) });
  }
  return { raw: Buffer.from(raw), value: validator(value) };
}

function readLedger(options = {}) {
  const file = planMountLedgerPath(options);
  if (!fs.existsSync(file)) return { file, raw: null, value: emptyLedger() };
  return {
    file,
    ...parseJsonFile(
      file,
      'PLAN_MOUNT_LEDGER_INVALID',
      'Plan mount ledger cannot be read',
      validateLedger,
    ),
  };
}

async function writeJsonAtomic(file, value, expectedContent) {
  await atomicReplaceFile(file, `${JSON.stringify(value, null, 2)}\n`, {
    ...(expectedContent === undefined ? {} : { expectedContent }),
  });
  fs.chmodSync(file, 0o600);
}

async function publishImmutable(file, value) {
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  if (!fs.existsSync(file)) {
    await writeJsonAtomic(file, value);
    return true;
  }
  const existing = fs.readFileSync(file, 'utf8');
  if (existing !== bytes) {
    fail('PLAN_MOUNT_CONFLICT', 'immutable record path contains different bytes', {
      file,
    });
  }
  return false;
}

function lockOwnerIsLive(lock) {
  if (
    !isObject(lock) ||
    !Number.isInteger(lock.pid) ||
    lock.pid < 1 ||
    typeof lock.token !== 'string'
  ) {
    return false;
  }
  try {
    process.kill(lock.pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

async function acquireLedgerLock(options = {}) {
  const file = planMountLockPath(options);
  await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + (options.lockTimeoutMs ?? LOCK_TIMEOUT_MS);
  const token = randomBytes(16).toString('hex');
  while (true) {
    try {
      const handle = await fsp.open(file, 'wx', 0o600);
      await handle.writeFile(
        `${JSON.stringify({
          kind: 'peers-touch-plan-mount-ledger-lock',
          pid: process.pid,
          token,
          createdAt: operationDate(options).toISOString(),
        })}\n`,
      );
      await handle.sync();
      await handle.close();
      return { file, token };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let current = null;
      try {
        current = JSON.parse(await fsp.readFile(file, 'utf8'));
      } catch {
        // Invalid or interrupted lock files are stale.
      }
      if (!lockOwnerIsLive(current)) {
        await fsp.rm(file, { force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        fail('PLAN_MOUNT_LEDGER_LOCKED', 'Plan mount ledger is locked', {
          pid: current.pid,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}

async function releaseLedgerLock(lease) {
  let current;
  try {
    current = JSON.parse(await fsp.readFile(lease.file, 'utf8'));
  } catch {
    current = null;
  }
  if (current?.token !== lease.token || current?.pid !== process.pid) {
    fail(
      'PLAN_MOUNT_LEDGER_LOCK_MISMATCH',
      'Plan mount ledger lock ownership changed',
    );
  }
  await fsp.unlink(lease.file);
}

async function withLedgerLock(options, operation) {
  const lease = await acquireLedgerLock(options);
  try {
    return await operation();
  } finally {
    await releaseLedgerLock(lease);
  }
}

async function withWorkspaceLifecycle(workspace, options, operation) {
  try {
    return await withWorkspaceLifecycleLock(
      {
        home: options.home,
        ...(workspace.canonicalRoot === undefined
          ? {}
          : { workspaceRoot: workspace.canonicalRoot }),
        workspaceId: workspace.workspaceId,
        lifecycleLease: options.lifecycleLease,
        lockTimeoutMs: options.lifecycleLockTimeoutMs,
      },
      operation,
    );
  } catch (error) {
    if (error instanceof WorkspaceLifecycleLockError) {
      fail(error.code, error.message, error.details);
    }
    throw error;
  }
}

function buildSnapshot(planPackage, workspace, mountId, snapshotId, now) {
  const snapshot = {
    kind: EXECUTION_PLAN_SNAPSHOT_KIND,
    snapshotId,
    capturedAt: now.toISOString(),
    planId: planPackage.plan.planId,
    planVersionId: planPackage.plan.versionId,
    planVersionDigest: planPackage.planVersionDigest,
    planPath: planPackage.planPath,
    plan: planPackage.plan,
    tasks: planPackage.tasks,
    acceptance: planPackage.acceptance,
    executionBinding: {
      mountId,
      workspaceId: workspace.workspaceId,
      canonicalRoot: workspace.canonicalRoot,
      branch: workspace.branch,
      initialHead: workspace.initialHead,
    },
  };
  snapshot.recordDigest = digestExecutionSnapshot(snapshot);
  return snapshot;
}

function initialTaskStates(snapshot, initialStates = undefined) {
  const states = Object.fromEntries(
    snapshot.plan.tasks.map((task) => [
      task.id,
      { state: 'pending', blocker: null },
    ]),
  );
  if (initialStates === undefined) return states;
  if (!isObject(initialStates)) {
    fail('EXECUTION_RUN_INVALID', 'initialTaskStates must be an object');
  }
  for (const [taskId, state] of Object.entries(initialStates)) {
    if (!Object.hasOwn(states, taskId)) {
      fail('EXECUTION_RUN_INVALID', 'initialTaskStates names an unknown Task', {
        taskId,
      });
    }
    states[taskId] = {
      state: requiredText(state, `initialTaskStates.${taskId}`),
      blocker: null,
    };
  }
  return states;
}

function buildRun(snapshot, runId, now, initialStates = undefined) {
  const taskStates = initialTaskStates(snapshot, initialStates);
  const current = Object.entries(taskStates)
    .filter(([, state]) => state.state === 'in_progress')
    .map(([taskId]) => taskId);
  const allDone = Object.values(taskStates).every(
    (state) => state.state === 'done',
  );
  const state = allDone
    ? 'completed'
    : current.length === 1
      ? 'active'
      : 'prepared';
  const run = {
    kind: EXECUTION_RUN_KIND,
    runId,
    snapshotId: snapshot.snapshotId,
    snapshotDigest: snapshot.recordDigest,
    mountId: snapshot.executionBinding.mountId,
    state,
    taskStates,
    exhaustion: null,
    currentTaskId: current[0] ?? null,
    updatedAt: now.toISOString(),
    revision: 1,
  };
  run.recordDigest = digestExecutionRun(run);
  return validateRun(run, snapshot);
}

function readMount(mountId, options) {
  return parseJsonFile(
    planMountRecordPath(mountId, options),
    'PLAN_MOUNT_INVALID',
    'Plan mount record cannot be read',
    validateMount,
  );
}

export function readLivePlanMountId(workspaceId, options = {}) {
  requiredText(workspaceId, 'workspaceId', WORKSPACE_ID);
  return readLedger(options).value.liveMountsByWorkspace[workspaceId] ?? null;
}

export function resolvePlanMountByIdentity(options = {}) {
  const workspaceId = requiredText(
    options.workspaceId,
    'workspaceId',
    WORKSPACE_ID,
  );
  const ledger = readLedger(options).value;
  const indexedMountId = ledger.liveMountsByWorkspace[workspaceId] ?? null;
  const mountId =
    options.mountId === undefined
      ? indexedMountId
      : requiredText(options.mountId, 'mountId', IDENTIFIER);
  if (mountId === null) {
    fail('PLAN_MOUNT_REQUIRED', 'workspace has no live Plan mount', {
      workspaceId,
    });
  }
  const mount = readMount(mountId, options).value;
  if (mount.workspaceId !== workspaceId) {
    fail(
      'PLAN_MOUNT_IDENTITY_MISMATCH',
      'Plan mount does not belong to the requested workspace',
      {
        workspaceId,
        mountWorkspaceId: mount.workspaceId,
        mountId,
      },
    );
  }
  if (mount.state === 'mounted' && indexedMountId !== mountId) {
    fail(
      'PLAN_MOUNT_IDENTITY_MISMATCH',
      'live Plan mount index does not match the requested mount',
      { workspaceId, indexedMountId, mountId },
    );
  }
  if (mount.state === 'released' && options.allowReleased !== true) {
    fail('PLAN_MOUNT_REQUIRED', 'workspace has no live Plan mount', {
      workspaceId,
      mountId,
    });
  }
  const runId = ledger.runsByMount[mountId];
  if (!runId) {
    fail('EXECUTION_RUN_REQUIRED', 'Plan mount has no Execution Run', {
      mountId,
    });
  }
  const workspace = {
    workspaceId,
    canonicalRoot: mount.canonicalRoot,
  };
  const { paths, snapshot, run } = readSnapshotAndRun(
    runId,
    workspace,
    options,
  );
  const mismatches = {};
  for (const [field, expected, actual] of [
    ['snapshotMountId', mountId, snapshot.value.executionBinding.mountId],
    ['snapshotWorkspaceId', workspaceId, snapshot.value.executionBinding.workspaceId],
    ['runMountId', mountId, run.value.mountId],
    ['planId', mount.planId, snapshot.value.planId],
    ['planVersionId', mount.planVersionId, snapshot.value.planVersionId],
    [
      'planVersionDigest',
      mount.planVersionDigest,
      snapshot.value.planVersionDigest,
    ],
    ['planPath', mount.planPath, snapshot.value.planPath],
  ]) {
    if (expected !== actual) mismatches[field] = { expected, actual };
  }
  if (Object.keys(mismatches).length > 0) {
    fail(
      'PLAN_MOUNT_IDENTITY_MISMATCH',
      'Plan mount, snapshot, and run identity disagree',
      { mismatches },
    );
  }
  return {
    workspace,
    ledger,
    mount,
    snapshot: snapshot.value,
    run: run.value,
    paths,
  };
}

function readSnapshotAndRun(runId, workspace, options) {
  const paths = executionRunPaths(runId, {
    home: options.home,
    repoRoot: workspace.canonicalRoot,
    workspaceId: workspace.workspaceId,
  });
  const snapshot = parseJsonFile(
    paths.snapshot,
    'EXECUTION_PLAN_SNAPSHOT_INVALID',
    'Execution Plan snapshot cannot be read',
    validateSnapshot,
  );
  const run = parseJsonFile(
    paths.run,
    'EXECUTION_RUN_INVALID',
    'Execution Run cannot be read',
    (value) => validateRun(value, snapshot.value),
  );
  return { paths, snapshot, run };
}

function assertResolvedIdentity({
  workspace,
  ledger,
  mount,
  snapshot,
  run,
  planPackage,
}) {
  const mismatches = {};
  const checks = [
    ['workspaceId', workspace.workspaceId, mount.workspaceId],
    ['canonicalRoot', workspace.canonicalRoot, mount.canonicalRoot],
    ['mountState', 'mounted', mount.state],
    [
      'workspaceIndex',
      mount.mountId,
      ledger.liveMountsByWorkspace[workspace.workspaceId],
    ],
    [
      'versionIndex',
      mount.mountId,
      ledger.liveMountsByPlanVersion[mount.planVersionDigest],
    ],
    ['runIndex', run.runId, ledger.runsByMount[mount.mountId]],
    ['snapshotMountId', mount.mountId, snapshot.executionBinding.mountId],
    ['runMountId', mount.mountId, run.mountId],
    ['planId', mount.planId, planPackage.plan.planId],
    ['planVersionId', mount.planVersionId, planPackage.plan.versionId],
    [
      'planVersionDigest',
      mount.planVersionDigest,
      planPackage.planVersionDigest,
    ],
    ['planPath', mount.planPath, planPackage.planPath],
  ];
  for (const [field, expected, actual] of checks) {
    if (expected !== actual) mismatches[field] = { expected, actual };
  }
  if (Object.keys(mismatches).length > 0) {
    fail(
      'PLAN_MOUNT_IDENTITY_MISMATCH',
      'Plan mount, snapshot, run, and source identity disagree',
      { mismatches },
    );
  }
}

export async function resolvePlanExecution(options = {}) {
  const workspace = canonicalWorkspace(options.repoRoot ?? process.cwd());
  const ledger = readLedger(options).value;
  const mountId = ledger.liveMountsByWorkspace[workspace.workspaceId];
  if (!mountId) {
    fail('PLAN_MOUNT_REQUIRED', 'workspace has no live Plan mount', {
      workspaceId: workspace.workspaceId,
    });
  }
  const mount = readMount(mountId, options).value;
  const runId = ledger.runsByMount[mountId];
  if (!runId) {
    fail('EXECUTION_RUN_REQUIRED', 'live Plan mount has no Execution Run', {
      mountId,
    });
  }
  const { paths, snapshot, run } = readSnapshotAndRun(
    runId,
    workspace,
    options,
  );
  const absolutePlan = path.join(
    workspace.canonicalRoot,
    ...mount.planPath.split('/'),
  );
  const planPackage = await loadPlanPackage(absolutePlan, {
    repoRoot: workspace.canonicalRoot,
  });
  assertResolvedIdentity({
    workspace,
    ledger,
    mount,
    snapshot: snapshot.value,
    run: run.value,
    planPackage,
  });
  return {
    workspace,
    ledger,
    mount,
    snapshot: snapshot.value,
    run: run.value,
    planPackage,
    paths,
  };
}

export async function mountPlanVersion(options = {}) {
  const workspace = canonicalWorkspace(options.repoRoot ?? process.cwd());
  const owner = requiredText(options.owner, 'owner');
  const requestedPlan = requiredText(options.plan, 'plan');
  const now = operationDate(options);
  const absolutePlan = path.isAbsolute(requestedPlan)
    ? requestedPlan
    : path.join(workspace.canonicalRoot, ...requestedPlan.split('/'));
  const planPackage = await loadPlanPackage(absolutePlan, {
    repoRoot: workspace.canonicalRoot,
  });
  const projectId =
    options.projectId === undefined
      ? defaultProjectId(workspace)
      : requiredText(options.projectId, 'projectId', IDENTIFIER);

  return withWorkspaceLifecycle(workspace, options, () =>
    withLedgerLock(options, async () => {
      assertDevelopmentCloseAdmission({
        home: options.home,
        workspaceId: workspace.workspaceId,
      });
      const currentLedger = readLedger(options);
      const workspaceMountId =
        currentLedger.value.liveMountsByWorkspace[workspace.workspaceId];
      const versionMountId =
        currentLedger.value.liveMountsByPlanVersion[
          planPackage.planVersionDigest
        ];
      if (workspaceMountId) {
        const existingExecution = resolvePlanMountByIdentity({
          ...options,
          workspaceId: workspace.workspaceId,
          mountId: workspaceMountId,
        });
        if (
          ['completed', 'cancelled'].includes(
            existingExecution.run.state,
          )
        ) {
          fail(
            'DEVELOPMENT_CLOSE_REQUIRED',
            'terminal Plan execution must be closed before mount admission',
            {
              mountId: workspaceMountId,
              runId: existingExecution.run.runId,
              runState: existingExecution.run.state,
            },
          );
        }
      }
      if (workspaceMountId || versionMountId) {
        if (workspaceMountId && workspaceMountId === versionMountId) {
          const resolved = await resolvePlanExecution({
            ...options,
            repoRoot: workspace.canonicalRoot,
          });
          if (
            resolved.mount.planVersionDigest ===
            planPackage.planVersionDigest
          ) {
            return { ...resolved, created: false };
          }
        }
        fail(
          'PLAN_MOUNT_CONFLICT',
          'workspace or Plan Version already has a different live mount',
          {
            workspaceMountId: workspaceMountId ?? null,
            versionMountId: versionMountId ?? null,
          },
        );
      }

      const mountId = randomId('mount', now);
      const snapshotId = randomId('snapshot', now);
      const runId = randomId('run', now);
      const snapshot = buildSnapshot(
        planPackage,
        workspace,
        mountId,
        snapshotId,
        now,
      );
      const run = buildRun(
        snapshot,
        runId,
        now,
        options.initialTaskStates,
      );
      const mount = {
        kind: PLAN_MOUNT_KIND,
        mountId,
        projectId,
        planId: planPackage.plan.planId,
        planVersionId: planPackage.plan.versionId,
        planVersionDigest: planPackage.planVersionDigest,
        planPath: planPackage.planPath,
        workspaceId: workspace.workspaceId,
        canonicalRoot: workspace.canonicalRoot,
        state: 'mounted',
        mountedAt: now.toISOString(),
        mountedBy: owner,
        releasedAt: null,
        releaseReason: null,
      };
      mount.recordDigest = digestPlanMountRecord(mount);
      validateMount(mount);

      const paths = executionRunPaths(runId, {
        home: options.home,
        repoRoot: workspace.canonicalRoot,
        workspaceId: workspace.workspaceId,
      });
      await publishImmutable(planMountRecordPath(mountId, options), mount);
      await publishImmutable(paths.snapshot, snapshot);
      await publishImmutable(paths.run, run);

      const ledger = {
        ...currentLedger.value,
        revision: currentLedger.value.revision + 1,
        liveMountsByWorkspace: {
          ...currentLedger.value.liveMountsByWorkspace,
          [workspace.workspaceId]: mountId,
        },
        liveMountsByPlanVersion: {
          ...currentLedger.value.liveMountsByPlanVersion,
          [planPackage.planVersionDigest]: mountId,
        },
        runsByMount: {
          ...currentLedger.value.runsByMount,
          [mountId]: runId,
        },
      };
      ledger.recordDigest = digestRecord(ledger);
      validateLedger(ledger);
      await writeJsonAtomic(
        currentLedger.file,
        ledger,
        currentLedger.raw ?? undefined,
      );
      return {
        workspace,
        ledger,
        mount,
        snapshot,
        run,
        planPackage,
        paths,
        created: true,
      };
    }),
  );
}

export async function updateExecutionRun(options = {}, updater) {
  if (typeof updater !== 'function') {
    fail('EXECUTION_RUN_INVALID', 'Execution Run updater is required');
  }
  const workspace = canonicalWorkspace(options.repoRoot ?? process.cwd());
  return withWorkspaceLifecycle(workspace, options, async () => {
    const resolved = await resolvePlanExecution({
      ...options,
      repoRoot: workspace.canonicalRoot,
    });
    const candidate = await updater(
      structuredClone(resolved.run),
      resolved.snapshot,
      resolved.planPackage,
    );
    if (!isObject(candidate)) {
      fail('EXECUTION_RUN_INVALID', 'Execution Run updater returned no record');
    }
    const now = operationDate(options);
    const next = {
      ...candidate,
      updatedAt: now.toISOString(),
      revision: resolved.run.revision + 1,
    };
    next.recordDigest = digestExecutionRun(next);
    validateRun(next, resolved.snapshot);
    await writeJsonAtomic(resolved.paths.run, next, fs.readFileSync(resolved.paths.run));
    return { ...resolved, run: next };
  });
}

export async function cancelExecutionRun(options = {}) {
  const workspace =
    options.workspaceId === undefined
      ? canonicalWorkspace(options.repoRoot ?? process.cwd())
      : {
          workspaceId: requiredText(
            options.workspaceId,
            'workspaceId',
            WORKSPACE_ID,
          ),
        };
  const owner = requiredText(options.owner, 'owner');
  return withWorkspaceLifecycle(workspace, options, async () => {
    const resolved = resolvePlanMountByIdentity({
      ...options,
      workspaceId: workspace.workspaceId,
    });
    if (owner !== resolved.mount.mountedBy) {
      fail(
        'PLAN_CANCEL_OWNER_MISMATCH',
        'only the exact mount owner may cancel an Execution Run',
        {
          expected: resolved.mount.mountedBy,
          actual: owner,
        },
      );
    }
    if (resolved.run.state === 'completed') {
      fail(
        'PLAN_CANCEL_INVALID',
        'a completed Execution Run cannot be cancelled',
      );
    }
    if (resolved.run.state === 'cancelled') return resolved;
    const next = structuredClone(resolved.run);
    if (next.currentTaskId !== null) {
      next.taskStates[next.currentTaskId] = {
        state: 'pending',
        blocker: null,
      };
    }
    next.state = 'cancelled';
    next.currentTaskId = null;
    next.exhaustion = null;
    next.updatedAt = operationDate(options).toISOString();
    next.revision = resolved.run.revision + 1;
    next.recordDigest = digestExecutionRun(next);
    validateRun(next, resolved.snapshot);
    await writeJsonAtomic(
      resolved.paths.run,
      next,
      fs.readFileSync(resolved.paths.run),
    );
    return { ...resolved, run: next };
  });
}

export async function releasePlanMount(options = {}) {
  const workspace =
    options.workspaceId === undefined
      ? canonicalWorkspace(options.repoRoot ?? process.cwd())
      : {
          workspaceId: requiredText(
            options.workspaceId,
            'workspaceId',
            WORKSPACE_ID,
          ),
        };
  const owner = requiredText(options.owner, 'owner');
  const reason = requiredText(options.reason, 'reason');
  if (!RELEASE_REASONS.has(reason)) {
    fail('PLAN_MOUNT_RELEASE_INVALID', 'release reason is invalid', { reason });
  }
  const now = operationDate(options);
  return withWorkspaceLifecycle(workspace, options, () =>
    withLedgerLock(options, async () => {
      const resolved = resolvePlanMountByIdentity({
        ...options,
        workspaceId: workspace.workspaceId,
        allowReleased: true,
      });
      if (
        options.mountId !== undefined &&
        options.mountId !== resolved.mount.mountId
      ) {
        fail(
          'PLAN_MOUNT_IDENTITY_MISMATCH',
          'requested mountId does not match the workspace mount',
          {
            requested: options.mountId,
            actual: resolved.mount.mountId,
          },
        );
      }
      if (owner !== resolved.mount.mountedBy) {
        fail(
          'PLAN_MOUNT_OWNER_MISMATCH',
          'only the exact mount owner may release a Plan mount',
          {
            expected: resolved.mount.mountedBy,
            actual: owner,
          },
        );
      }
      if (resolved.mount.state === 'released') {
        if (resolved.mount.releaseReason !== reason) {
          fail(
            'PLAN_MOUNT_RELEASE_CONFLICT',
            'Plan mount was already released for a different reason',
            {
              expected: resolved.mount.releaseReason,
              actual: reason,
            },
          );
        }
        const currentLedger = readLedger(options);
        const liveMountsByWorkspace = {
          ...currentLedger.value.liveMountsByWorkspace,
        };
        const liveMountsByPlanVersion = {
          ...currentLedger.value.liveMountsByPlanVersion,
        };
        let changed = false;
        if (
          liveMountsByWorkspace[workspace.workspaceId] ===
          resolved.mount.mountId
        ) {
          delete liveMountsByWorkspace[workspace.workspaceId];
          changed = true;
        }
        if (
          liveMountsByPlanVersion[resolved.mount.planVersionDigest] ===
          resolved.mount.mountId
        ) {
          delete liveMountsByPlanVersion[resolved.mount.planVersionDigest];
          changed = true;
        }
        if (!changed) {
          return {
            mount: resolved.mount,
            run: resolved.run,
            ledger: currentLedger.value,
          };
        }
        const ledger = {
          ...currentLedger.value,
          revision: currentLedger.value.revision + 1,
          liveMountsByWorkspace,
          liveMountsByPlanVersion,
        };
        ledger.recordDigest = digestRecord(ledger);
        validateLedger(ledger);
        await writeJsonAtomic(currentLedger.file, ledger, currentLedger.raw);
        return { mount: resolved.mount, run: resolved.run, ledger };
      }
      if (
        reason === 'completed' &&
        resolved.run.state !== 'completed'
      ) {
        fail(
          'PLAN_MOUNT_RELEASE_DENIED',
          'completed release requires a completed Execution Run',
        );
      }
      if (
        reason === 'cancelled' &&
        resolved.run.state !== 'cancelled'
      ) {
        fail(
          'PLAN_MOUNT_RELEASE_DENIED',
          'cancelled release requires a cancelled Execution Run',
        );
      }
      if (
        reason === 'owner-unmount' &&
        options.allowUnfinished !== true
      ) {
        fail(
          'PLAN_MOUNT_RELEASE_DENIED',
          'unfinished unmount requires explicit owner authorization',
        );
      }
      const released = {
        ...resolved.mount,
        state: 'released',
        releasedAt: now.toISOString(),
        releaseReason: reason,
        mountedBy: owner,
      };
      released.recordDigest = digestPlanMountRecord(released);
      validateMount(released);
      const mountFile = planMountRecordPath(released.mountId, options);
      await writeJsonAtomic(mountFile, released, fs.readFileSync(mountFile));

      const currentLedger = readLedger(options);
      if (
        currentLedger.value.liveMountsByWorkspace[workspace.workspaceId] !==
          released.mountId ||
        currentLedger.value.liveMountsByPlanVersion[
          released.planVersionDigest
        ] !== released.mountId
      ) {
        fail(
          'PLAN_MOUNT_IDENTITY_MISMATCH',
          'Plan mount indexes changed before release',
        );
      }
      const liveMountsByWorkspace = {
        ...currentLedger.value.liveMountsByWorkspace,
      };
      const liveMountsByPlanVersion = {
        ...currentLedger.value.liveMountsByPlanVersion,
      };
      delete liveMountsByWorkspace[workspace.workspaceId];
      delete liveMountsByPlanVersion[released.planVersionDigest];
      const ledger = {
        ...currentLedger.value,
        revision: currentLedger.value.revision + 1,
        liveMountsByWorkspace,
        liveMountsByPlanVersion,
      };
      ledger.recordDigest = digestRecord(ledger);
      validateLedger(ledger);
      await writeJsonAtomic(currentLedger.file, ledger, currentLedger.raw);
      return { mount: released, run: resolved.run, ledger };
    }),
  );
}

function parseArguments(argv) {
  const [action, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    const value = rest[index + 1];
    if (
      !token.startsWith('--') ||
      value === undefined ||
      value.startsWith('--')
    ) {
      fail('PLAN_MOUNT_USAGE', `invalid option: ${token}`);
    }
    const key = token.slice(2);
    if (
      ![
        'repo-root',
        'home',
        'plan',
        'owner',
        'project-id',
        'reason',
        'allow-unfinished',
        'workspace-id',
        'mount-id',
      ].includes(key)
    ) {
      fail('PLAN_MOUNT_USAGE', `unsupported option: ${token}`);
    }
    options[
      {
        'repo-root': 'repoRoot',
        home: 'home',
        plan: 'plan',
        owner: 'owner',
        'project-id': 'projectId',
        reason: 'reason',
        'allow-unfinished': 'allowUnfinished',
        'workspace-id': 'workspaceId',
        'mount-id': 'mountId',
      }[key]
    ] = key === 'allow-unfinished' ? value === 'true' : value;
    index += 1;
  }
  return { action, options };
}

function output(value) {
  process.stdout.write(`${JSON.stringify({ ok: true, ...value }, null, 2)}\n`);
}

export async function runCli(argv = process.argv.slice(2)) {
  const { action, options } = parseArguments(argv);
  if (action === 'mount') {
    const result = await mountPlanVersion(options);
    output({
      created: result.created,
      mount: result.mount,
      snapshot: result.snapshot,
      run: result.run,
    });
    return;
  }
  if (action === 'status') {
    const result = await resolvePlanExecution(options);
    output({
      mount: result.mount,
      snapshot: result.snapshot,
      run: result.run,
    });
    return;
  }
  if (action === 'unmount') {
    output(await releasePlanMount(options));
    return;
  }
  fail('PLAN_MOUNT_USAGE', 'action must be mount, status, or unmount');
}

if (isDirectInvocation(import.meta.url)) {
  runCli().catch((error) => {
    const normalized =
      error instanceof PlanMountError
        ? error
        : new PlanMountError(
            error?.code ?? 'PLAN_MOUNT_INTERNAL_ERROR',
            error?.message ?? String(error),
            error?.details ?? error?.detail,
          );
    process.stderr.write(`${JSON.stringify(normalized.toJSON())}\n`);
    process.exitCode = 2;
  });
}
