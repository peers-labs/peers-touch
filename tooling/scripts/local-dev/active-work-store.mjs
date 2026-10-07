import { createHash, randomBytes } from 'node:crypto';
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
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import {
  machineWorkspacesPath,
  workspaceActiveWorkLockPath,
  workspaceActiveWorkPath,
  workspaceIdForRoot,
} from '../lib/machine-dev-paths.mjs';
import { DEVELOPMENT_STATES } from './dev-session-schema.mjs';
import {
  IDENTIFIER,
  canonicalize,
  isObject,
  normalizePlanPath,
} from './dev-work-schema.mjs';
import { processStartIdentity } from './dev-work-ledger.mjs';
import {
  WorkspaceLifecycleLockError,
  withWorkspaceLifecycleLockSync,
} from './workspace-lifecycle-lock.mjs';
import {
  assertMatchingWorkflowOwner as assertPolicyOwnerMatch,
  requireWorkflowOwnerReference as requirePolicyOwner,
} from './workflow-owner-command-policy.mjs';
import {
  validateWorkflowOwnerReference,
} from './workflow-owner-reference.mjs';

export const ACTIVE_WORK_SCHEMA_VERSION = 1;
export const ACTIVE_WORK_KIND = 'peers-touch-workspace-active-work';

const LOCK_TIMEOUT_MS = 5_000;
const PLAN_STATUSES = new Set([
  'prepared',
  'active',
  'blocked',
  'completed',
  'cancelled',
]);
const TASK_STATUSES = new Set(['pending', 'in_progress', 'blocked', 'done']);
const INPUT_KEYS = new Set([
  'workspaceId',
  'workItemId',
  'mountId',
  'runId',
  'snapshotDigest',
  'planId',
  'planPath',
  'planStatus',
  'currentTaskId',
  'currentTaskPath',
  'taskStatus',
  'sessionId',
  'journeyId',
  'devState',
  'branch',
  'initialHead',
  'expectedHead',
]);
const INPUT_OPTIONAL_KEYS = new Set(['workflowOwner']);
const RECORD_KEYS = new Set([
  'schemaVersion',
  'kind',
  'revision',
  ...INPUT_KEYS,
  'updatedAt',
  'recordDigest',
]);
const RECORD_OPTIONAL_KEYS = new Set(INPUT_OPTIONAL_KEYS);
const LOCK_KEYS = new Set(['pid', 'processStart', 'createdAt']);
const SHA_PATTERN = /^[0-9a-f]{40,64}$/;
const WORKSPACE_ID_PATTERN = /^[0-9a-f]{16}$/;

export class ActiveWorkError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'ActiveWorkError';
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, message, detail = {}) {
  throw new ActiveWorkError(code, message, detail);
}

function assertActiveWorkOwner(expected, actual, detail = {}) {
  try {
    return assertPolicyOwnerMatch(expected, actual, detail);
  } catch (error) {
    fail('ACTIVE_WORK_OWNER_MISMATCH', error.message, error.detail);
  }
}

function requireActiveWorkOwner(value, detail = {}) {
  try {
    return requirePolicyOwner(value, detail);
  } catch (error) {
    fail('ACTIVE_WORK_OWNER_MISMATCH', error.message, error.detail);
  }
}

function exactKeys(value, keys) {
  const actual = Object.keys(value);
  return actual.length === keys.size && actual.every((key) => keys.has(key));
}

function operationDate(options = {}) {
  const value =
    typeof options.clock === 'function'
      ? options.clock()
      : options.now ?? new Date();
  const now = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(now.getTime())) {
    fail('INVALID_CLOCK', 'active-work clock returned an invalid time');
  }
  return now;
}

function validIsoTimestamp(value) {
  const milliseconds = Date.parse(value);
  return (
    typeof value === 'string' &&
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}

function requiredIdentifier(value, field) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
    fail('ACTIVE_WORK_INVALID', `${field} is invalid`, { field });
  }
  return value;
}

function requiredText(value, field, maxLength = 1024) {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value === '' ||
    value.length > maxLength ||
    value.includes('\0') ||
    value.includes('\n')
  ) {
    fail('ACTIVE_WORK_INVALID', `${field} is invalid`, { field });
  }
  return value;
}

function validateRepositoryMarkdownPath(value, field) {
  let normalized;
  try {
    normalized = normalizePlanPath(value);
  } catch {
    fail('ACTIVE_WORK_INVALID', `${field} is invalid`, { field });
  }
  if (normalized !== value) {
    fail('ACTIVE_WORK_INVALID', `${field} is not canonical`, { field });
  }
}

function validateInput(input) {
  if (
    !isObject(input) ||
    [...INPUT_KEYS].some((key) => !Object.hasOwn(input, key)) ||
    Object.keys(input).some(
      (key) => !INPUT_KEYS.has(key) && !INPUT_OPTIONAL_KEYS.has(key),
    )
  ) {
    fail('ACTIVE_WORK_INVALID', 'active-work input fields are invalid');
  }
  if (!WORKSPACE_ID_PATTERN.test(input.workspaceId)) {
    fail('ACTIVE_WORK_INVALID', 'workspaceId is invalid');
  }
  if (!/^[0-9a-f]{64}$/.test(input.snapshotDigest)) {
    fail('ACTIVE_WORK_INVALID', 'snapshotDigest is invalid');
  }
  for (const field of [
    'workItemId',
    'mountId',
    'runId',
    'planId',
    'currentTaskId',
    'sessionId',
    'journeyId',
  ]) {
    requiredIdentifier(input[field], field);
  }
  requiredText(input.branch, 'branch');
  validateRepositoryMarkdownPath(input.planPath, 'planPath');
  validateRepositoryMarkdownPath(input.currentTaskPath, 'currentTaskPath');
  if (!PLAN_STATUSES.has(input.planStatus)) {
    fail('ACTIVE_WORK_INVALID', 'planStatus is invalid');
  }
  if (!TASK_STATUSES.has(input.taskStatus)) {
    fail('ACTIVE_WORK_INVALID', 'taskStatus is invalid');
  }
  if (input.devState !== null && !DEVELOPMENT_STATES.has(input.devState)) {
    fail('ACTIVE_WORK_INVALID', 'devState is invalid');
  }
  for (const field of ['initialHead', 'expectedHead']) {
    if (typeof input[field] !== 'string' || !SHA_PATTERN.test(input[field])) {
      fail('ACTIVE_WORK_INVALID', `${field} is invalid`, { field });
    }
  }
  if (Object.hasOwn(input, 'workflowOwner')) {
    try {
      validateWorkflowOwnerReference(input.workflowOwner, { nullable: true });
    } catch {
      fail('ACTIVE_WORK_INVALID', 'workflowOwner is invalid');
    }
  }
  return input;
}

export function digestActiveWork(record) {
  const unsigned = { ...record };
  delete unsigned.recordDigest;
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(unsigned)))
    .digest('hex');
}

export function validateActiveWorkRecord(record, expectedWorkspaceId) {
  validateActiveWorkRecordShape(record, expectedWorkspaceId);
  if (
    digestActiveWork(record) !== record.recordDigest
  ) {
    fail('ACTIVE_WORK_INVALID', 'active-work record digest is invalid');
  }
  return record;
}

function validateActiveWorkRecordShape(record, expectedWorkspaceId) {
  if (
    !isObject(record) ||
    [...RECORD_KEYS].some((key) => !Object.hasOwn(record, key)) ||
    Object.keys(record).some(
      (key) => !RECORD_KEYS.has(key) && !RECORD_OPTIONAL_KEYS.has(key),
    )
  ) {
    fail('ACTIVE_WORK_INVALID', 'active-work record fields are invalid');
  }
  if (
    record.schemaVersion !== ACTIVE_WORK_SCHEMA_VERSION ||
    record.kind !== ACTIVE_WORK_KIND ||
    !Number.isInteger(record.revision) ||
    record.revision < 1
  ) {
    fail('ACTIVE_WORK_INVALID', 'active-work record header is invalid');
  }
  validateInput({
    ...Object.fromEntries([...INPUT_KEYS].map((key) => [key, record[key]])),
    ...(Object.hasOwn(record, 'workflowOwner')
      ? { workflowOwner: record.workflowOwner }
      : {}),
  });
  if (
    expectedWorkspaceId !== undefined &&
    record.workspaceId !== expectedWorkspaceId
  ) {
    fail(
      'ACTIVE_WORK_WORKSPACE_MISMATCH',
      'active-work record belongs to another workspace',
      { expected: expectedWorkspaceId, actual: record.workspaceId },
    );
  }
  if (!validIsoTimestamp(record.updatedAt)) {
    fail('ACTIVE_WORK_INVALID', 'updatedAt is invalid');
  }
  if (
    typeof record.recordDigest !== 'string' ||
    !/^[0-9a-f]{64}$/.test(record.recordDigest)
  ) {
    fail('ACTIVE_WORK_INVALID', 'active-work record digest field is invalid');
  }
  return record;
}

function workspaceIdForOptions(options = {}) {
  let derivedWorkspaceId;
  if (options.workspaceRoot !== undefined) {
    try {
      derivedWorkspaceId = workspaceIdForRoot(options.workspaceRoot);
    } catch (error) {
      fail('WORKTREE_IDENTITY_UNAVAILABLE', 'workspace root cannot be resolved', {
        cause: String(error),
      });
    }
  }
  if (options.workspaceId !== undefined) {
    if (
      typeof options.workspaceId !== 'string' ||
      !WORKSPACE_ID_PATTERN.test(options.workspaceId)
    ) {
      fail('ACTIVE_WORK_INVALID', 'workspaceId is invalid');
    }
    if (
      derivedWorkspaceId !== undefined &&
      derivedWorkspaceId !== options.workspaceId
    ) {
      fail(
        'ACTIVE_WORK_WORKSPACE_MISMATCH',
        'workspaceId does not match the consuming workspace root',
        {
          expected: derivedWorkspaceId,
          actual: options.workspaceId,
        },
      );
    }
    return options.workspaceId;
  }
  if (derivedWorkspaceId !== undefined) return derivedWorkspaceId;
  try {
    return workspaceIdForRoot(options.workspaceRoot);
  } catch (error) {
    fail('WORKTREE_IDENTITY_UNAVAILABLE', 'workspace root cannot be resolved', {
      cause: String(error),
    });
  }
}

export function activeWorkStorePaths(options = {}) {
  const workspaceId = workspaceIdForOptions(options);
  const pathOptions = {
    home: options.home,
    workspaceId,
  };
  return {
    workspaceId,
    record: options.recordPath ?? workspaceActiveWorkPath(pathOptions),
    lock: options.lockPath ?? workspaceActiveWorkLockPath(pathOptions),
  };
}

function ensurePrivateDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
}

function syncDirectory(directory) {
  if (process.platform === 'win32') return;
  let descriptor;
  try {
    descriptor = openSync(directory, 'r');
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function readOwnedRegularFile(file) {
  const metadata = lstatSync(file);
  const ownedByCurrentUser =
    typeof process.getuid !== 'function' || metadata.uid === process.getuid();
  if (!metadata.isFile() || metadata.isSymbolicLink() || !ownedByCurrentUser) {
    fail(
      'ACTIVE_WORK_INVALID',
      'active-work state must be an owner-controlled regular file',
      { file },
    );
  }
  return readFileSync(file, 'utf8');
}

function readRecordFile(file, workspaceId) {
  if (!existsSync(file)) return null;
  let record;
  try {
    record = JSON.parse(readOwnedRegularFile(file));
  } catch (error) {
    if (error instanceof ActiveWorkError) throw error;
    fail('ACTIVE_WORK_INVALID', 'active-work record is not valid JSON', {
      file,
      cause: String(error),
    });
  }
  return validateActiveWorkRecord(record, workspaceId);
}

export function readActiveWorkRecord(options = {}) {
  const paths = activeWorkStorePaths(options);
  return readRecordFile(paths.record, paths.workspaceId);
}

function writeRecordAtomic(file, record) {
  const directory = path.dirname(file);
  ensurePrivateDirectory(directory);
  const temporary = path.join(
    directory,
    `.${path.basename(file)}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`,
  );
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(
      descriptor,
      `${JSON.stringify(canonicalize(record), null, 2)}\n`,
    );
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

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function readLockMetadata(file) {
  let metadata;
  try {
    metadata = JSON.parse(readOwnedRegularFile(file));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error instanceof ActiveWorkError) throw error;
    fail('ACTIVE_WORK_LOCK_INVALID', 'active-work lock is invalid', {
      cause: String(error),
    });
  }
  if (
    !isObject(metadata) ||
    !exactKeys(metadata, LOCK_KEYS) ||
    !Number.isInteger(metadata.pid) ||
    metadata.pid <= 0 ||
    typeof metadata.processStart !== 'string' ||
    metadata.processStart === '' ||
    !validIsoTimestamp(metadata.createdAt)
  ) {
    fail('ACTIVE_WORK_LOCK_INVALID', 'active-work lock schema is invalid');
  }
  return metadata;
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function acquireLock(file, now, timeoutMs = LOCK_TIMEOUT_MS) {
  const directory = path.dirname(file);
  ensurePrivateDirectory(directory);
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const processStart = processStartIdentity();
    if (!processStart) {
      fail(
        'ACTIVE_WORK_LOCK_INVALID',
        'cannot establish active-work lock process identity',
      );
    }
    const owned = {
      pid: process.pid,
      processStart,
      createdAt: now.toISOString(),
    };
    let descriptor;
    try {
      descriptor = openSync(file, 'wx', 0o600);
      writeFileSync(descriptor, `${JSON.stringify(owned)}\n`);
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      syncDirectory(directory);
      return () => {
        const current = readLockMetadata(file);
        if (current && JSON.stringify(current) !== JSON.stringify(owned)) {
          fail(
            'ACTIVE_WORK_LOCK_INVALID',
            'active-work lock ownership changed',
          );
        }
        try {
          unlinkSync(file);
          syncDirectory(directory);
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
      };
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      if (error?.code !== 'EEXIST') throw error;
      const metadata = readLockMetadata(file);
      if (metadata === null) continue;
      const alive = processIsAlive(metadata.pid);
      const actualStart = processStartIdentity(metadata.pid);
      if (alive && actualStart === null) {
        fail(
          'ACTIVE_WORK_LOCK_INVALID',
          'live active-work lock identity cannot be verified',
        );
      }
      if (!alive || actualStart !== metadata.processStart) {
        try {
          unlinkSync(file);
          syncDirectory(directory);
        } catch (unlinkError) {
          if (unlinkError?.code !== 'ENOENT') throw unlinkError;
        }
        continue;
      }
      if (Date.now() >= deadline) {
        fail('ACTIVE_WORK_LOCKED', 'timed out acquiring active-work lock');
      }
      sleep(50);
    }
  }
}

function semanticInput(record) {
  return {
    ...Object.fromEntries([...INPUT_KEYS].map((key) => [key, record[key]])),
    ...(Object.hasOwn(record, 'workflowOwner')
      ? { workflowOwner: record.workflowOwner }
      : {}),
  };
}

function expectedRevision(options, existing) {
  const actual = existing?.revision ?? 0;
  if (options.expectedRevision === undefined) return actual;
  const expected = Number(options.expectedRevision);
  if (!Number.isInteger(expected) || expected < 0) {
    fail('ACTIVE_WORK_INVALID', 'expectedRevision must be a non-negative integer');
  }
  if (expected !== actual) {
    fail('ACTIVE_WORK_REVISION_MISMATCH', 'active-work revision changed', {
      expected,
      actual,
    });
  }
  return expected;
}

function updateActiveWorkRecordUnderFence(input, options) {
  const paths = activeWorkStorePaths({
    ...options,
    workspaceId: input.workspaceId,
  });
  const now = operationDate(options);
  const release = acquireLock(paths.lock, now, options.lockTimeoutMs);
  try {
    const existing = readRecordFile(paths.record, paths.workspaceId);
    expectedRevision(options, existing);
    if (
      existing &&
      JSON.stringify(canonicalize(semanticInput(existing))) ===
        JSON.stringify(canonicalize(input))
    ) {
      return existing;
    }
    const record = {
      schemaVersion: ACTIVE_WORK_SCHEMA_VERSION,
      kind: ACTIVE_WORK_KIND,
      revision: (existing?.revision ?? 0) + 1,
      ...input,
      updatedAt: now.toISOString(),
    };
    record.recordDigest = digestActiveWork(record);
    validateActiveWorkRecord(record, paths.workspaceId);
    writeRecordAtomic(paths.record, record);
    return readRecordFile(paths.record, paths.workspaceId);
  } finally {
    release();
  }
}

export function updateActiveWorkRecord(input, options = {}) {
  validateInput(input);
  requireActiveWorkOwner(input.workflowOwner, {
    record: 'active-work',
  });
  const paths = activeWorkStorePaths({
    ...options,
    workspaceId: input.workspaceId,
  });
  try {
    return withWorkspaceLifecycleLockSync(
      {
        home: options.home,
        workspaceRoot: options.workspaceRoot,
        workspaceId: paths.workspaceId,
        lifecycleLease: options.lifecycleLease,
        lockTimeoutMs:
          options.lifecycleLockTimeoutMs ?? options.lockTimeoutMs,
        lifecycleFailpoint: options.lifecycleFailpoint,
      },
      (lifecycleLease) =>
        updateActiveWorkRecordUnderFence(input, {
          ...options,
          lifecycleLease,
        }),
    );
  } catch (error) {
    if (error instanceof WorkspaceLifecycleLockError) {
      fail(error.code, error.message, error.detail);
    }
    throw error;
  }
}

function repairActiveWorkRecordUnderFence(input, options) {
  const expectedRecordSha256 = options.expectedRecordSha256;
  if (
    typeof expectedRecordSha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(expectedRecordSha256)
  ) {
    fail(
      'ACTIVE_WORK_INVALID',
      'expectedRecordSha256 must be a SHA-256 digest',
    );
  }
  const paths = activeWorkStorePaths({
    ...options,
    workspaceId: input.workspaceId,
  });
  const now = operationDate(options);
  const release = acquireLock(paths.lock, now, options.lockTimeoutMs);
  try {
    if (!existsSync(paths.record)) {
      fail('ACTIVE_WORK_REPAIR_UNAVAILABLE', 'active-work record is missing');
    }
    const raw = readOwnedRegularFile(paths.record);
    const actualRecordSha256 = createHash('sha256').update(raw).digest('hex');
    if (actualRecordSha256 !== expectedRecordSha256) {
      fail(
        'ACTIVE_WORK_REPAIR_CONFLICT',
        'active-work record changed after repair was authorized',
        {
          expected: expectedRecordSha256,
          actual: actualRecordSha256,
        },
      );
    }
    let existing;
    try {
      existing = JSON.parse(raw);
    } catch (error) {
      fail('ACTIVE_WORK_INVALID', 'active-work record is not valid JSON', {
        file: paths.record,
        cause: String(error),
      });
    }
    validateActiveWorkRecordShape(existing, paths.workspaceId);
    if (digestActiveWork(existing) === existing.recordDigest) {
      fail(
        'ACTIVE_WORK_REPAIR_NOT_REQUIRED',
        'active-work record already has a valid digest',
      );
    }
    for (const field of [
      'workspaceId',
      'mountId',
      'runId',
      'snapshotDigest',
      'planId',
      'planPath',
      'branch',
      'initialHead',
    ]) {
      if (existing[field] !== input[field]) {
        fail(
          'ACTIVE_WORK_OWNER_MISMATCH',
          'invalid active-work record does not match immutable owners',
          {
            field,
            expected: input[field],
            actual: existing[field],
          },
        );
      }
    }
    if (
      (existing.workflowOwner !== undefined ||
        input.workflowOwner !== undefined) &&
      JSON.stringify(canonicalize(existing.workflowOwner ?? null)) !==
        JSON.stringify(canonicalize(input.workflowOwner ?? null))
    ) {
      fail(
        'ACTIVE_WORK_OWNER_MISMATCH',
        'invalid active-work record does not match immutable owners',
        {
          field: 'workflowOwner',
          expected: input.workflowOwner ?? null,
          actual: existing.workflowOwner ?? null,
        },
      );
    }
    expectedRevision(options, existing);
    const record = {
      schemaVersion: ACTIVE_WORK_SCHEMA_VERSION,
      kind: ACTIVE_WORK_KIND,
      revision: existing.revision + 1,
      ...input,
      updatedAt: now.toISOString(),
    };
    record.recordDigest = digestActiveWork(record);
    validateActiveWorkRecord(record, paths.workspaceId);
    writeRecordAtomic(paths.record, record);
    return readRecordFile(paths.record, paths.workspaceId);
  } finally {
    release();
  }
}

export function repairActiveWorkRecord(input, options = {}) {
  validateInput(input);
  requireActiveWorkOwner(input.workflowOwner, {
    record: 'active-work',
  });
  const paths = activeWorkStorePaths({
    ...options,
    workspaceId: input.workspaceId,
  });
  try {
    return withWorkspaceLifecycleLockSync(
      {
        home: options.home,
        workspaceRoot: options.workspaceRoot,
        workspaceId: paths.workspaceId,
        lifecycleLease: options.lifecycleLease,
        lockTimeoutMs:
          options.lifecycleLockTimeoutMs ?? options.lockTimeoutMs,
        lifecycleFailpoint: options.lifecycleFailpoint,
      },
      (lifecycleLease) =>
        repairActiveWorkRecordUnderFence(input, {
          ...options,
          lifecycleLease,
        }),
    );
  } catch (error) {
    if (error instanceof WorkspaceLifecycleLockError) {
      fail(error.code, error.message, error.detail);
    }
    throw error;
  }
}

function clearActiveWorkRecordUnderFence(options) {
  const paths = activeWorkStorePaths(options);
  const now = operationDate(options);
  const release = acquireLock(paths.lock, now, options.lockTimeoutMs);
  try {
    const existing = readRecordFile(paths.record, paths.workspaceId);
    if (existing === null) return null;
    expectedRevision(options, existing);
    if (
      options.workItemId !== undefined &&
      existing.workItemId !== options.workItemId
    ) {
      fail('ACTIVE_WORK_OWNER_MISMATCH', 'work item does not own active-work', {
        expected: options.workItemId,
        actual: existing.workItemId,
      });
    }
    assertActiveWorkOwner(
      existing.workflowOwner,
      options.workflowOwner,
      { record: 'active-work', workspaceId: paths.workspaceId },
    );
    unlinkSync(paths.record);
    syncDirectory(path.dirname(paths.record));
    return existing;
  } finally {
    release();
  }
}

export function clearActiveWorkRecord(options = {}) {
  const paths = activeWorkStorePaths(options);
  try {
    return withWorkspaceLifecycleLockSync(
      {
        home: options.home,
        workspaceRoot: options.workspaceRoot,
        workspaceId: paths.workspaceId,
        lifecycleLease: options.lifecycleLease,
        lockTimeoutMs:
          options.lifecycleLockTimeoutMs ?? options.lockTimeoutMs,
        lifecycleFailpoint: options.lifecycleFailpoint,
      },
      (lifecycleLease) =>
        clearActiveWorkRecordUnderFence({
          ...options,
          workspaceId: paths.workspaceId,
          lifecycleLease,
        }),
    );
  } catch (error) {
    if (error instanceof WorkspaceLifecycleLockError) {
      fail(error.code, error.message, error.detail);
    }
    throw error;
  }
}

export function readAllActiveWorkRecords(options = {}) {
  const root = machineWorkspacesPath(options.home ?? homedir());
  if (!existsSync(root)) return { records: [], errors: [] };
  const records = [];
  const errors = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !WORKSPACE_ID_PATTERN.test(entry.name)) continue;
    try {
      const record = readActiveWorkRecord({
        home: options.home,
        workspaceId: entry.name,
      });
      if (record) records.push(record);
    } catch (error) {
      errors.push({
        workspaceId: entry.name,
        code: error?.code ?? 'ACTIVE_WORK_INVALID',
        message: error?.message ?? String(error),
      });
    }
  }
  records.sort((left, right) => left.workspaceId.localeCompare(right.workspaceId));
  errors.sort((left, right) => left.workspaceId.localeCompare(right.workspaceId));
  return { records, errors };
}
