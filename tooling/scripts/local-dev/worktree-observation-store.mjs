import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import {
  machineWorkspacesPath,
  workspaceIdForRoot,
  workspaceObservationLockPath,
  workspaceObservationPath,
} from '../lib/machine-dev-paths.mjs';

export const WORKTREE_OBSERVATION_KIND = 'peers-touch-worktree-observation';
const WORKSPACE_ID = /^[0-9a-f]{16}$/;
const HEAD = /^[0-9a-f]{40}$/;
const HOSTS = new Set(['trae', 'codex', 'cursor', 'cli']);
const RECORD_KEYS = new Set([
  'kind',
  'workspaceId',
  'name',
  'branch',
  'head',
  'dirty',
  'reporter',
  'reportedAt',
  'recordDigest',
]);
const REPORTER_KEYS = new Set(['host', 'event']);

export class WorktreeObservationError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'WorktreeObservationError';
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, message, detail = {}) {
  throw new WorktreeObservationError(code, message, detail);
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.size &&
    Object.keys(value).every((key) => keys.has(key))
  );
}

function validTimestamp(value) {
  const milliseconds = Date.parse(value);
  return (
    typeof value === 'string' &&
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}

function digestPayload(record) {
  return {
    kind: record.kind,
    workspaceId: record.workspaceId,
    name: record.name,
    branch: record.branch,
    head: record.head,
    dirty: record.dirty,
    reporter: {
      host: record.reporter.host,
      event: record.reporter.event,
    },
    reportedAt: record.reportedAt,
  };
}

function digestRecord(record) {
  return createHash('sha256')
    .update(JSON.stringify(digestPayload(record)))
    .digest('hex');
}

export function validateWorktreeObservation(record, expectedWorkspaceId) {
  if (!exactKeys(record, RECORD_KEYS)) {
    fail('WORKTREE_OBSERVATION_INVALID', 'observation fields are invalid');
  }
  if (
    record.kind !== WORKTREE_OBSERVATION_KIND ||
    !WORKSPACE_ID.test(record.workspaceId) ||
    (expectedWorkspaceId !== undefined &&
      record.workspaceId !== expectedWorkspaceId) ||
    typeof record.name !== 'string' ||
    record.name.length === 0 ||
    typeof record.branch !== 'string' ||
    record.branch.length === 0 ||
    !HEAD.test(record.head) ||
    typeof record.dirty !== 'boolean' ||
    !exactKeys(record.reporter, REPORTER_KEYS) ||
    !HOSTS.has(record.reporter.host) ||
    typeof record.reporter.event !== 'string' ||
    record.reporter.event.length === 0 ||
    record.reporter.event.length > 128 ||
    !validTimestamp(record.reportedAt) ||
    !/^[0-9a-f]{64}$/.test(record.recordDigest)
  ) {
    fail('WORKTREE_OBSERVATION_INVALID', 'observation schema is invalid', {
      workspaceId: record?.workspaceId ?? null,
    });
  }
  if (record.recordDigest !== digestRecord(record)) {
    fail('WORKTREE_OBSERVATION_INVALID', 'observation digest is invalid', {
      workspaceId: record.workspaceId,
    });
  }
  return record;
}

function gitValue(root, args, field) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    fail(
      'WORKTREE_OBSERVATION_GIT_UNAVAILABLE',
      `cannot resolve ${field}`,
      { cause: error?.stderr?.toString().trim() || String(error) },
    );
  }
}

function captureObservation(options = {}) {
  const workspaceRoot = gitValue(
    options.workspaceRoot ?? process.cwd(),
    ['rev-parse', '--show-toplevel'],
    'worktree root',
  );
  const workspaceId = workspaceIdForRoot(workspaceRoot);
  const host = options.host ?? 'cli';
  if (!HOSTS.has(host)) {
    fail('WORKTREE_OBSERVATION_INVALID', 'reporter host is invalid', { host });
  }
  const event = options.event ?? 'manual';
  if (
    typeof event !== 'string' ||
    event.length === 0 ||
    event.length > 128
  ) {
    fail('WORKTREE_OBSERVATION_INVALID', 'reporter event is invalid');
  }
  const now = options.now ?? new Date();
  const branch =
    gitValue(workspaceRoot, ['branch', '--show-current'], 'branch') ||
    'detached';
  const record = {
    kind: WORKTREE_OBSERVATION_KIND,
    workspaceId,
    name: path.basename(workspaceRoot),
    branch,
    head: gitValue(workspaceRoot, ['rev-parse', 'HEAD'], 'HEAD'),
    dirty:
      gitValue(
        workspaceRoot,
        ['status', '--porcelain', '--untracked-files=normal'],
        'worktree status',
      ) !== '',
    reporter: { host, event },
    reportedAt: now.toISOString(),
    recordDigest: '',
  };
  record.recordDigest = digestRecord(record);
  return validateWorktreeObservation(record, workspaceId);
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

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function acquireLock(file, timeoutMs = 2000) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      writeFileSync(
        file,
        `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`,
        { flag: 'wx', mode: 0o600 },
      );
      return () => {
        try {
          unlinkSync(file);
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        const metadata = JSON.parse(readFileSync(file, 'utf8'));
        if (!processIsAlive(metadata.pid)) {
          unlinkSync(file);
          continue;
        }
      } catch (lockError) {
        if (lockError?.code === 'ENOENT') continue;
      }
      if (Date.now() >= deadline) {
        fail('WORKTREE_OBSERVATION_LOCKED', 'observation writer is busy');
      }
      sleep(25);
    }
  }
}

function syncDirectory(directory) {
  if (process.platform === 'win32') return;
  const fd = openSync(directory, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function writeAtomic(file, record) {
  const directory = path.dirname(file);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(
    directory,
    `.${path.basename(file)}.${process.pid}.${randomBytes(8).toString('hex')}`,
  );
  let fd;
  try {
    fd = openSync(temporary, 'wx', 0o600);
    writeFileSync(fd, `${JSON.stringify(record, null, 2)}\n`);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, file);
    syncDirectory(directory);
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export function readWorktreeObservation(options = {}) {
  const file = options.file ?? workspaceObservationPath(options);
  if (!existsSync(file)) return null;
  let record;
  try {
    record = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    fail('WORKTREE_OBSERVATION_INVALID', 'observation is not valid JSON', {
      cause: String(error),
    });
  }
  return validateWorktreeObservation(record, options.workspaceId);
}

export function reportWorktreeObservation(options = {}) {
  const workspaceRoot = gitValue(
    options.workspaceRoot ?? process.cwd(),
    ['rev-parse', '--show-toplevel'],
    'worktree root',
  );
  const workspaceId = workspaceIdForRoot(workspaceRoot);
  const file =
    options.file ??
    workspaceObservationPath({
      home: options.home,
      workspaceId,
    });
  const lockFile =
    options.lockFile ??
    workspaceObservationLockPath({
      home: options.home,
      workspaceId,
    });
  const now = options.now ?? new Date();
  const minimumIntervalMs = options.minimumIntervalMs ?? 0;
  if (minimumIntervalMs > 0) {
    const current = readWorktreeObservation({ file, workspaceId });
    if (
      current &&
      now.getTime() - Date.parse(current.reportedAt) < minimumIntervalMs
    ) {
      return current;
    }
  }
  const record = captureObservation({
    ...options,
    workspaceRoot,
    now,
  });
  const release = acquireLock(lockFile, options.lockTimeoutMs);
  try {
    const current = readWorktreeObservation({
      file,
      workspaceId: record.workspaceId,
    });
    if (
      current &&
      Date.parse(current.reportedAt) > Date.parse(record.reportedAt)
    ) {
      return current;
    }
    writeAtomic(file, record);
    return readWorktreeObservation({
      file,
      workspaceId: record.workspaceId,
    });
  } finally {
    release();
  }
}

export function readAllWorktreeObservations(options = {}) {
  const root = options.root ?? machineWorkspacesPath(options.home);
  if (!existsSync(root)) return { records: [], errors: [] };
  const records = [];
  const errors = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !WORKSPACE_ID.test(entry.name)) continue;
    const file = options.root
      ? path.join(root, entry.name, 'observations', 'worktree.json')
      : workspaceObservationPath({
          home: options.home,
          workspaceId: entry.name,
        });
    if (!existsSync(file)) continue;
    try {
      const record = readWorktreeObservation({
        file,
        workspaceId: entry.name,
      });
      if (record) records.push(record);
    } catch (error) {
      errors.push({
        workspaceId: entry.name,
        code: error.code ?? 'WORKTREE_OBSERVATION_INVALID',
        message: error.message,
      });
    }
  }
  records.sort((left, right) => left.workspaceId.localeCompare(right.workspaceId));
  errors.sort((left, right) => left.workspaceId.localeCompare(right.workspaceId));
  return { records, errors };
}

export function observationFileMode(file) {
  return statSync(file).mode & 0o777;
}
