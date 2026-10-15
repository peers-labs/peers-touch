import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { workspaceIdForRoot } from '../lib/machine-dev-paths.mjs';

export const TASK_PROGRESS_KIND = 'peers-touch-task-progress';
export const TASK_PROGRESS_SCHEMA_VERSION = 2;

const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SOURCE_ID = /^[0-9a-f]{40,64}$/;
const STAGES = new Set([
  'intake',
  'research',
  'design',
  'prepare',
  'implement',
  'verify',
  'deliver',
]);
const STATES = new Set([
  'active',
  'waiting-user',
  'blocked',
  'completed',
  'cancelled',
]);
const TERMINAL_STATES = new Set(['completed', 'cancelled']);
const LOCK_TIMEOUT_MS = 5_000;
const STALE_LOCK_MS = 30_000;

export class TaskProgressError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'TaskProgressError';
    this.code = code;
    this.detail = detail;
    this.details = detail;
  }
}

function fail(code, message, detail = {}) {
  throw new TaskProgressError(code, message, detail);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function digest(value) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function requiredText(value, field, maxLength = 4_096) {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value === '' ||
    value.length > maxLength ||
    value.includes('\0') ||
    value.includes('\n')
  ) {
    fail('TASK_PROGRESS_INVALID', `${field} is invalid`, { field });
  }
  return value;
}

function optionalText(value, field, maxLength = 4_096) {
  if (value === undefined || value === null) return null;
  return requiredText(value, field, maxLength);
}

function requiredTaskId(value) {
  const taskId = requiredText(value, 'taskId', 128);
  if (!TASK_ID.test(taskId)) {
    fail('TASK_PROGRESS_INVALID', 'taskId is invalid');
  }
  return taskId;
}

function requiredSha(value, field) {
  const sha = requiredText(value, field, 64);
  if (!SHA256.test(sha)) {
    fail('TASK_PROGRESS_INVALID', `${field} is invalid`, { field });
  }
  return sha;
}

function requiredSource(value, field) {
  const source = requiredText(value, field, 64);
  if (!SOURCE_ID.test(source)) {
    fail('TASK_PROGRESS_INVALID', `${field} is invalid`, { field });
  }
  return source;
}

function normalizeIso(value, field) {
  const parsed = Date.parse(value);
  if (
    typeof value !== 'string' ||
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString() !== value
  ) {
    fail('TASK_PROGRESS_INVALID', `${field} is invalid`, { field });
  }
  return value;
}

function normalizeStringList(value, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    fail('TASK_PROGRESS_INVALID', `${field} must be an array`, { field });
  }
  return [...new Set(value.map((item, index) =>
    requiredText(item, `${field}[${index}]`, 2_048),
  ))].sort();
}

function normalizeReferences(value, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    fail('TASK_PROGRESS_INVALID', `${field} must be an array`, { field });
  }
  return value.map((item, index) => {
    if (!isObject(item)) {
      fail('TASK_PROGRESS_INVALID', `${field}[${index}] must be an object`);
    }
    return canonicalize(item);
  });
}

function normalizePlanRef(value) {
  if (value === undefined || value === null) return null;
  if (!isObject(value)) {
    fail('TASK_PROGRESS_INVALID', 'planRef must be an object');
  }
  const relativePath = requiredText(value.path, 'planRef.path', 2_048);
  if (
    path.isAbsolute(relativePath) ||
    relativePath.replaceAll('\\', '/').split('/').includes('..')
  ) {
    fail('TASK_PROGRESS_INVALID', 'planRef.path must stay repository-relative');
  }
  return {
    path: relativePath.replaceAll('\\', '/'),
    contentDigest: requiredSha(value.contentDigest, 'planRef.contentDigest'),
  };
}

function normalizeBlocker(value) {
  if (value === undefined || value === null) return null;
  if (!isObject(value)) {
    fail('TASK_PROGRESS_INVALID', 'blocker must be an object');
  }
  return {
    action: requiredText(value.action, 'blocker.action', 1_024),
    reason: requiredText(value.reason, 'blocker.reason', 4_096),
    evidenceRef: optionalText(value.evidenceRef, 'blocker.evidenceRef', 2_048),
  };
}

function gitValue(root, args, field) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    fail('WORKTREE_IDENTITY_UNAVAILABLE', `cannot resolve ${field}`, {
      root,
      cause: String(error),
    });
  }
}

export function captureTaskWorkspace(workspaceRoot = process.cwd()) {
  let canonicalRoot;
  try {
    canonicalRoot = realpathSync.native(workspaceRoot);
  } catch (error) {
    fail('WORKTREE_IDENTITY_UNAVAILABLE', 'workspace root is unavailable', {
      root: workspaceRoot,
      cause: String(error),
    });
  }
  const gitRoot = realpathSync.native(
    gitValue(canonicalRoot, ['rev-parse', '--show-toplevel'], 'Git root'),
  );
  if (gitRoot !== canonicalRoot) {
    fail('WORKTREE_IDENTITY_MISMATCH', 'workspace root is not the Git root', {
      requested: canonicalRoot,
      actual: gitRoot,
    });
  }
  const branch = gitValue(canonicalRoot, ['branch', '--show-current'], 'branch');
  const head = gitValue(canonicalRoot, ['rev-parse', 'HEAD'], 'HEAD');
  if (!branch || !/^[0-9a-f]{40,64}$/.test(head)) {
    fail('WORKTREE_IDENTITY_UNAVAILABLE', 'workspace source identity is invalid');
  }
  return {
    canonicalRoot,
    workspaceId: workspaceIdForRoot(canonicalRoot),
    branch,
    head,
  };
}

function ensureDirectory(directory) {
  if (existsSync(directory) && lstatSync(directory).isSymbolicLink()) {
    fail('TASK_PROGRESS_PATH_ESCAPE', 'task storage cannot use a symbolic link', {
      directory,
    });
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
}

export function taskProgressPaths(options = {}, settings = {}) {
  const workspace = captureTaskWorkspace(options.workspaceRoot);
  const taskId = requiredTaskId(options.taskId);
  const storageRoot = path.join(workspace.canonicalRoot, '.dev-workflow');
  const tasksRoot = path.join(storageRoot, 'tasks');
  const directory = path.join(tasksRoot, taskId);
  if (settings.create === false) {
    for (const candidate of [storageRoot, tasksRoot, directory]) {
      if (!existsSync(candidate)) {
        fail('TASK_PROGRESS_NOT_FOUND', 'task does not exist', { taskId });
      }
      if (lstatSync(candidate).isSymbolicLink()) {
        fail('TASK_PROGRESS_PATH_ESCAPE', 'task storage cannot use a symbolic link', {
          directory: candidate,
        });
      }
    }
  } else {
    for (const candidate of [storageRoot, tasksRoot, directory]) {
      ensureDirectory(candidate);
    }
  }
  if (!realpathSync(directory).startsWith(`${workspace.canonicalRoot}${path.sep}`)) {
    fail('TASK_PROGRESS_PATH_ESCAPE', 'task storage escaped the worktree');
  }
  return {
    workspace,
    taskId,
    directory,
    snapshot: path.join(directory, 'task.json'),
    lock: path.join(directory, 'task.lock'),
  };
}

function syncDirectory(directory) {
  if (process.platform === 'win32') return;
  const descriptor = openSync(directory, 'r');
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function writeAtomic(file, content) {
  const directory = path.dirname(file);
  const temporary = path.join(
    directory,
    `.${path.basename(file)}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`,
  );
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, content);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, file);
    chmodSync(file, 0o600);
    syncDirectory(directory);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function acquireLock(lockFile, timeoutMs = LOCK_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  const token = randomBytes(16).toString('hex');
  while (true) {
    try {
      const descriptor = openSync(lockFile, 'wx', 0o600);
      writeFileSync(descriptor, `${token}\n`);
      fsyncSync(descriptor);
      closeSync(descriptor);
      return () => {
        if (readFileSync(lockFile, 'utf8').trim() !== token) {
          fail('TASK_PROGRESS_LOCK_INVALID', 'task lock ownership changed');
        }
        unlinkSync(lockFile);
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let modifiedAt;
      try {
        modifiedAt = statSync(lockFile).mtimeMs;
      } catch (statError) {
        if (statError?.code === 'ENOENT') continue;
        throw statError;
      }
      if (Date.now() - modifiedAt > STALE_LOCK_MS) {
        unlinkSync(lockFile);
        continue;
      }
      if (Date.now() >= deadline) {
        fail('TASK_PROGRESS_LOCKED', 'timed out acquiring task lock');
      }
      sleep(25);
    }
  }
}

function withTaskLock(options, settings, operation) {
  const paths = taskProgressPaths(options, settings);
  const now = options.now ? new Date(options.now) : new Date();
  if (!Number.isFinite(now.getTime())) {
    fail('TASK_PROGRESS_INVALID', 'now is invalid');
  }
  const release = acquireLock(paths.lock, options.lockTimeoutMs);
  try {
    return operation(paths, now);
  } finally {
    release();
  }
}

function normalizedRecord(value) {
  if (
    !isObject(value) ||
    value.kind !== TASK_PROGRESS_KIND ||
    value.schemaVersion !== TASK_PROGRESS_SCHEMA_VERSION
  ) {
    fail('TASK_PROGRESS_INVALID', 'task snapshot header is invalid');
  }
  const stage = requiredText(value.stage, 'stage', 32);
  const state = requiredText(value.state, 'state', 32);
  if (!STAGES.has(stage) || !STATES.has(state)) {
    fail('TASK_PROGRESS_INVALID', 'task stage or state is invalid');
  }
  const blocker = normalizeBlocker(value.blocker);
  if ((state === 'blocked') !== (blocker !== null)) {
    fail('TASK_PROGRESS_INVALID', 'blocked state and blocker must agree');
  }
  const revision = Number(value.revision);
  if (!Number.isInteger(revision) || revision < 1) {
    fail('TASK_PROGRESS_INVALID', 'revision is invalid');
  }
  return {
    kind: TASK_PROGRESS_KIND,
    schemaVersion: TASK_PROGRESS_SCHEMA_VERSION,
    taskId: requiredTaskId(value.taskId),
    northStarRef: optionalText(value.northStarRef, 'northStarRef', 2_048),
    contribution: requiredText(value.contribution, 'contribution'),
    goal: requiredText(value.goal, 'goal'),
    workspaceId: requiredText(value.workspaceId, 'workspaceId', 64),
    branch: requiredText(value.branch, 'branch', 1_024),
    initialSource: requiredSource(value.initialSource, 'initialSource'),
    currentSource: requiredSource(value.currentSource, 'currentSource'),
    planRef: normalizePlanRef(value.planRef),
    scope: {
      paths: normalizeStringList(value.scope?.paths, 'scope.paths'),
      exclusions: normalizeStringList(value.scope?.exclusions, 'scope.exclusions'),
    },
    stage,
    state,
    nextAction: optionalText(value.nextAction, 'nextAction'),
    authorizationRefs: normalizeReferences(
      value.authorizationRefs,
      'authorizationRefs',
    ),
    evidenceRefs: normalizeReferences(value.evidenceRefs, 'evidenceRefs'),
    resourceRefs: normalizeReferences(value.resourceRefs, 'resourceRefs'),
    blocker,
    revision,
    updatedAt: normalizeIso(value.updatedAt, 'updatedAt'),
    lastReason: requiredText(value.lastReason, 'lastReason', 2_048),
  };
}

function sealRecord(value) {
  const record = normalizedRecord(value);
  return { ...record, checksum: digest(record) };
}

function parseSnapshot(file) {
  if (!existsSync(file)) {
    fail('TASK_PROGRESS_NOT_FOUND', 'task does not exist');
  }
  let value;
  try {
    value = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    fail('TASK_PROGRESS_SNAPSHOT_INVALID', 'task snapshot is not valid JSON', {
      cause: String(error),
    });
  }
  const record = normalizedRecord(value);
  if (!SHA256.test(value.checksum) || value.checksum !== digest(record)) {
    fail('TASK_PROGRESS_CHECKSUM_INVALID', 'task snapshot checksum is invalid');
  }
  return { ...record, checksum: value.checksum };
}

function persist(paths, record) {
  writeAtomic(
    paths.snapshot,
    `${JSON.stringify(canonicalize(record), null, 2)}\n`,
  );
  return parseSnapshot(paths.snapshot);
}

function initialRecord(input, paths, now) {
  const state = input.state ?? 'active';
  if (TERMINAL_STATES.has(state)) {
    fail('TASK_PROGRESS_INVALID', 'task must be closed through development-close');
  }
  return sealRecord({
    kind: TASK_PROGRESS_KIND,
    schemaVersion: TASK_PROGRESS_SCHEMA_VERSION,
    taskId: paths.taskId,
    northStarRef: input.northStarRef ?? null,
    contribution: input.contribution,
    goal: input.goal,
    workspaceId: paths.workspace.workspaceId,
    branch: paths.workspace.branch,
    initialSource: paths.workspace.head,
    currentSource: paths.workspace.head,
    planRef: input.planRef ?? null,
    scope: {
      paths: input.scopePaths ?? [],
      exclusions: input.scopeExclusions ?? [],
    },
    stage: input.stage ?? 'intake',
    state,
    nextAction: input.nextAction ?? null,
    authorizationRefs: input.authorizationRefs ?? [],
    evidenceRefs: input.evidenceRefs ?? [],
    resourceRefs: input.resourceRefs ?? [],
    blocker: input.blocker ?? null,
    revision: 1,
    updatedAt: now.toISOString(),
    lastReason: input.reason ?? 'Task progress started',
  });
}

export function createTaskProgress(input = {}) {
  return withTaskLock(input, {}, (paths, now) => {
    if (existsSync(paths.snapshot)) {
      fail('TASK_PROGRESS_ALREADY_EXISTS', 'task already exists', {
        taskId: paths.taskId,
      });
    }
    return persist(paths, initialRecord(input, paths, now));
  });
}

function updatedRecord(current, updates, paths, now) {
  if (TERMINAL_STATES.has(current.state)) {
    fail('TASK_PROGRESS_TERMINAL', 'terminal task progress cannot be updated');
  }
  if (updates.state !== undefined && TERMINAL_STATES.has(updates.state)) {
    fail('TASK_PROGRESS_INVALID', 'terminal state requires development-close');
  }
  const sourceChanged = paths.workspace.head !== current.currentSource;
  return sealRecord({
    ...current,
    northStarRef:
      updates.northStarRef === undefined
        ? current.northStarRef
        : updates.northStarRef,
    contribution: updates.contribution ?? current.contribution,
    goal: updates.goal ?? current.goal,
    branch: paths.workspace.branch,
    currentSource: paths.workspace.head,
    planRef: updates.planRef === undefined ? current.planRef : updates.planRef,
    scope: {
      paths: updates.scopePaths ?? current.scope.paths,
      exclusions: updates.scopeExclusions ?? current.scope.exclusions,
    },
    stage: updates.stage ?? current.stage,
    state: updates.state ?? current.state,
    nextAction:
      updates.nextAction === undefined
        ? current.nextAction
        : updates.nextAction,
    authorizationRefs:
      updates.authorizationRefs ?? current.authorizationRefs,
    evidenceRefs:
      updates.evidenceRefs !== undefined
        ? updates.evidenceRefs
        : sourceChanged
          ? []
          : current.evidenceRefs,
    resourceRefs: updates.resourceRefs ?? current.resourceRefs,
    blocker: updates.blocker === undefined ? current.blocker : updates.blocker,
    revision: current.revision + 1,
    updatedAt: now.toISOString(),
    lastReason: updates.reason ?? 'Task progress updated',
  });
}

function expectedRevision(input, current, operation) {
  const expected = Number(input.expectedRevision);
  if (!Number.isInteger(expected) || expected < 1) {
    fail('TASK_PROGRESS_INVALID', `expectedRevision is required for task ${operation}`);
  }
  if (expected !== current.revision) {
    fail('TASK_PROGRESS_REVISION_CONFLICT', 'task revision changed', {
      expectedRevision: expected,
      actualRevision: current.revision,
    });
  }
}

export function updateTaskProgress(input = {}) {
  return withTaskLock(input, { create: false }, (paths, now) => {
    const current = parseSnapshot(paths.snapshot);
    expectedRevision(input, current, 'update');
    return persist(paths, updatedRecord(current, input, paths, now));
  });
}

function resourcesSettled(resourceRefs) {
  return resourceRefs.every((resource) =>
    ['released', 'retained'].includes(resource?.state));
}

export function closeTaskProgress(input = {}) {
  return withTaskLock(input, { create: false }, (paths, now) => {
    const current = parseSnapshot(paths.snapshot);
    expectedRevision(input, current, 'close');
    const state = requiredText(input.state, 'state', 32);
    if (!TERMINAL_STATES.has(state)) {
      fail('TASK_PROGRESS_INVALID', 'close state must be completed or cancelled');
    }
    const evidenceRefs = input.evidenceRefs ?? current.evidenceRefs;
    const resourceRefs = input.resourceRefs ?? current.resourceRefs;
    if (state === 'completed' && evidenceRefs.length === 0) {
      fail(
        'TASK_PROGRESS_EVIDENCE_MISSING',
        'completed task progress requires evidence references',
      );
    }
    if (!resourcesSettled(resourceRefs)) {
      fail(
        'TASK_PROGRESS_RESOURCE_UNSETTLED',
        'task-owned resources must be released or explicitly retained',
      );
    }
    return persist(paths, sealRecord({
      ...current,
      branch: paths.workspace.branch,
      currentSource: paths.workspace.head,
      stage: 'deliver',
      state,
      nextAction: null,
      evidenceRefs,
      resourceRefs,
      blocker: null,
      revision: current.revision + 1,
      updatedAt: now.toISOString(),
      lastReason: input.reason ?? `Task progress ${state}`,
    }));
  });
}

export function readTaskProgress(input = {}) {
  const paths = taskProgressPaths(input, { create: false });
  return parseSnapshot(paths.snapshot);
}

export function inspectTaskProgress(input = {}) {
  return {
    record: readTaskProgress(input),
    snapshotState: 'current',
  };
}

function collectTaskProgress(input = {}) {
  const workspace = captureTaskWorkspace(input.workspaceRoot);
  const tasksRoot = path.join(workspace.canonicalRoot, '.dev-workflow', 'tasks');
  if (!existsSync(tasksRoot)) {
    return { workspace, tasks: [], invalid: [] };
  }
  if (lstatSync(tasksRoot).isSymbolicLink()) {
    fail('TASK_PROGRESS_PATH_ESCAPE', 'task storage cannot use a symbolic link');
  }
  const tasks = [];
  const invalid = [];
  for (const entry of readdirSync(tasksRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !TASK_ID.test(entry.name)) continue;
    try {
      tasks.push(readTaskProgress({
        workspaceRoot: workspace.canonicalRoot,
        taskId: entry.name,
      }));
    } catch (error) {
      invalid.push({
        taskId: entry.name,
        code: error?.code ?? 'TASK_PROGRESS_INVALID',
        message: error?.message ?? String(error),
      });
    }
  }
  tasks.sort((left, right) => left.taskId.localeCompare(right.taskId));
  invalid.sort((left, right) => left.taskId.localeCompare(right.taskId));
  return { workspace, tasks, invalid };
}

export function listTaskProgress(input = {}) {
  return collectTaskProgress(input);
}

export function inspectTaskProgressList(input = {}) {
  const result = collectTaskProgress(input);
  return {
    ...result,
    tasks: result.tasks.map((task) => ({
      ...task,
      projectionState: 'current',
    })),
  };
}
