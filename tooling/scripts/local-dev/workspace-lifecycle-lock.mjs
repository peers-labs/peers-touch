import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import {
  workspaceIdForRoot,
  workspaceStatePath,
} from '../lib/machine-dev-paths.mjs';

export const WORKSPACE_LIFECYCLE_LOCK_KIND =
  'peers-touch-workspace-lifecycle-lock';

const LOCK_FILE = 'workspace-lifecycle.lock';
const LOCK_KEYS = new Set([
  'kind',
  'pid',
  'processStart',
  'createdAt',
  'ownerToken',
  'recordDigest',
]);
const SHA256 = /^[0-9a-f]{64}$/;
const WORKSPACE_ID = /^[0-9a-f]{16}$/;
const DEFAULT_TIMEOUT_MS = 5_000;
const ATOMIC_MOVE_NO_REPLACE = [
  'import ctypes, errno, json, os, sys',
  'source, destination = sys.argv[1:3]',
  'reported_code = None',
  'try:',
  '    if sys.platform == "win32":',
  '        function = ctypes.WinDLL("kernel32", use_last_error=True).MoveFileExW',
  '        function.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_uint]',
  '        function.restype = ctypes.c_int',
  '        result = function(source, destination, 0x00000008)',
  '        if result == 0:',
  '            error_number = ctypes.get_last_error()',
  '            reported_code = "EEXIST" if error_number in (80, 183) else "ENOENT" if error_number in (2, 3) else "WINERROR_" + str(error_number)',
  '            raise OSError(error_number, reported_code)',
  '        result = 0',
  '    elif sys.platform == "darwin":',
  '        libc = ctypes.CDLL(None, use_errno=True)',
  '        function = libc.renamex_np',
  '        function.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]',
  '        function.restype = ctypes.c_int',
  '        result = function(os.fsencode(source), os.fsencode(destination), 0x00000004)',
  '    elif sys.platform.startswith("linux"):',
  '        libc = ctypes.CDLL(None, use_errno=True)',
  '        function = libc.renameat2',
  '        function.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]',
  '        function.restype = ctypes.c_int',
  '        result = function(-100, os.fsencode(source), -100, os.fsencode(destination), 0x00000001)',
  '    else:',
  '        raise OSError(errno.ENOTSUP, "atomic rename primitive is unavailable")',
  '    if result != 0:',
  '        error_number = ctypes.get_errno()',
  '        raise OSError(error_number, os.strerror(error_number))',
  '    sys.stdout.write(json.dumps({"ok": True}) + "\\n")',
  'except (AttributeError, OSError) as error:',
  '    error_number = getattr(error, "errno", None) or errno.ENOTSUP',
  '    code = reported_code or errno.errorcode.get(error_number, "UNKNOWN")',
  '    sys.stdout.write(json.dumps({"ok": False, "code": code, "message": str(error)}) + "\\n")',
].join('\n');

export class WorkspaceLifecycleLockError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'WorkspaceLifecycleLockError';
    this.code = code;
    this.detail = detail;
    this.details = detail;
  }
}

function fail(code, message, detail = {}) {
  throw new WorkspaceLifecycleLockError(code, message, detail);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys) {
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

export function digestWorkspaceLifecycleLock(metadata) {
  const unsigned = { ...metadata };
  delete unsigned.recordDigest;
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(unsigned)))
    .digest('hex');
}

function validTimestamp(value) {
  const parsed = Date.parse(value);
  return (
    typeof value === 'string' &&
    Number.isFinite(parsed) &&
    new Date(parsed).toISOString() === value
  );
}

function operationDate(options = {}) {
  const value =
    typeof options.clock === 'function'
      ? options.clock()
      : options.now ?? new Date();
  const now = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(now.getTime())) {
    fail(
      'WORKSPACE_LIFECYCLE_LOCK_INVALID',
      'workspace lifecycle clock is invalid',
    );
  }
  return now;
}

function workspaceIdForOptions(options = {}) {
  let derived;
  if (options.workspaceRoot !== undefined || options.repoRoot !== undefined) {
    try {
      derived = workspaceIdForRoot(
        options.workspaceRoot ?? options.repoRoot,
      );
    } catch (error) {
      fail(
        'WORKTREE_IDENTITY_UNAVAILABLE',
        'workspace lifecycle root cannot be resolved',
        { cause: String(error) },
      );
    }
  }
  if (options.workspaceId !== undefined) {
    if (
      typeof options.workspaceId !== 'string' ||
      !WORKSPACE_ID.test(options.workspaceId)
    ) {
      fail(
        'WORKSPACE_LIFECYCLE_LOCK_INVALID',
        'workspace lifecycle workspaceId is invalid',
      );
    }
    if (derived !== undefined && derived !== options.workspaceId) {
      fail(
        'WORKTREE_IDENTITY_MISMATCH',
        'workspace lifecycle workspaceId does not match its root',
        { expected: derived, actual: options.workspaceId },
      );
    }
    return options.workspaceId;
  }
  if (derived !== undefined) return derived;
  fail(
    'WORKSPACE_LIFECYCLE_LOCK_INVALID',
    'workspace lifecycle lock requires workspaceRoot or workspaceId',
  );
}

export function workspaceLifecycleLockPath(options = {}) {
  const workspaceId = workspaceIdForOptions(options);
  return path.join(
    workspaceStatePath({ home: options.home, workspaceId }),
    'workflow',
    LOCK_FILE,
  );
}

function ownerControls(metadata) {
  const ownedByCurrentUser =
    typeof process.getuid !== 'function' || metadata.uid === process.getuid();
  const privateMode =
    process.platform === 'win32' || (metadata.mode & 0o077) === 0;
  return ownedByCurrentUser && privateMode;
}

function ensurePrivateDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const metadata = lstatSync(directory);
  const ownedByCurrentUser =
    typeof process.getuid !== 'function' || metadata.uid === process.getuid();
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    !ownedByCurrentUser
  ) {
    fail(
      'WORKSPACE_LIFECYCLE_LOCK_INVALID',
      'workspace lifecycle directory must be owner-controlled',
      { directory },
    );
  }
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

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

export function workspaceLifecycleProcessIdentity(pid = process.pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    const command =
      process.platform === 'win32'
        ? [
            'powershell.exe',
            [
              '-NoLogo',
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString("o")`,
            ],
          ]
        : ['ps', ['-o', 'lstart=', '-p', String(pid)]];
    const value = execFileSync(command[0], command[1], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return value || null;
  } catch {
    return null;
  }
}

export function createWorkspaceLifecycleLockMetadata(
  options = {},
  overrides = {},
) {
  const processStart =
    overrides.processStart ??
    workspaceLifecycleProcessIdentity(overrides.pid ?? process.pid);
  if (typeof processStart !== 'string' || processStart === '') {
    fail(
      'WORKSPACE_LIFECYCLE_LOCK_INVALID',
      'workspace lifecycle owner identity cannot be established',
    );
  }
  const metadata = {
    kind: WORKSPACE_LIFECYCLE_LOCK_KIND,
    pid: overrides.pid ?? process.pid,
    processStart,
    createdAt: (overrides.now ?? operationDate(options)).toISOString(),
    ownerToken: overrides.ownerToken ?? randomBytes(32).toString('hex'),
  };
  metadata.recordDigest = digestWorkspaceLifecycleLock(metadata);
  return metadata;
}

function readOwnedLock(file, context = 'workspace lifecycle lock') {
  let fileMetadata;
  try {
    fileMetadata = lstatSync(file);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    fail(
      'WORKSPACE_LIFECYCLE_LOCK_INVALID',
      `${context} cannot be inspected`,
      { file, cause: String(error) },
    );
  }
  if (
    !fileMetadata.isFile() ||
    fileMetadata.isSymbolicLink() ||
    !ownerControls(fileMetadata)
  ) {
    fail(
      'WORKSPACE_LIFECYCLE_LOCK_INVALID',
      `${context} must be an owner-controlled regular file`,
      { file },
    );
  }
  const raw = readFileSync(file);
  let metadata;
  try {
    metadata = JSON.parse(raw.toString('utf8'));
  } catch (error) {
    fail(
      'WORKSPACE_LIFECYCLE_LOCK_INVALID',
      `${context} is not valid JSON`,
      { file, cause: String(error) },
    );
  }
  if (
    !isObject(metadata) ||
    !exactKeys(metadata, LOCK_KEYS) ||
    metadata.kind !== WORKSPACE_LIFECYCLE_LOCK_KIND ||
    !Number.isInteger(metadata.pid) ||
    metadata.pid <= 0 ||
    typeof metadata.processStart !== 'string' ||
    metadata.processStart === '' ||
    !validTimestamp(metadata.createdAt) ||
    typeof metadata.ownerToken !== 'string' ||
    !SHA256.test(metadata.ownerToken) ||
    typeof metadata.recordDigest !== 'string' ||
    !SHA256.test(metadata.recordDigest) ||
    digestWorkspaceLifecycleLock(metadata) !== metadata.recordDigest
  ) {
    fail(
      'WORKSPACE_LIFECYCLE_LOCK_INVALID',
      `${context} schema or digest is invalid`,
      { file },
    );
  }
  return { metadata, raw };
}

function ownerIsLive(metadata) {
  const live = processIsAlive(metadata.pid);
  if (!live) return false;
  const actualStart = workspaceLifecycleProcessIdentity(metadata.pid);
  if (actualStart === null) {
    fail(
      'WORKSPACE_LIFECYCLE_LOCK_INVALID',
      'live workspace lifecycle owner identity cannot be verified',
      { pid: metadata.pid },
    );
  }
  return actualStart === metadata.processStart;
}

function publishOwnedFile(file, metadata) {
  const directory = path.dirname(file);
  ensurePrivateDirectory(directory);
  const temporary = path.join(
    directory,
    `.${path.basename(file)}.${process.pid}.${randomBytes(16).toString('hex')}.tmp`,
  );
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, `${JSON.stringify(metadata)}\n`);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    linkSync(temporary, file);
    syncDirectory(directory);
    return true;
  } catch (error) {
    if (error?.code === 'EEXIST') return false;
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function atomicMoveNoReplace(source, destination) {
  const result = spawnSync(
    'python3',
    [
      '-c',
      ATOMIC_MOVE_NO_REPLACE,
      path.resolve(source),
      path.resolve(destination),
    ],
    {
      encoding: 'utf8',
      env: process.env,
      maxBuffer: 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    fail(
      'WORKSPACE_LIFECYCLE_LOCK_INVALID',
      'workspace lifecycle atomic capture helper failed',
      {
        status: result.status,
        stderr: result.stderr?.trim() || null,
      },
    );
  }
  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    fail(
      'WORKSPACE_LIFECYCLE_LOCK_INVALID',
      'workspace lifecycle atomic capture helper returned invalid output',
    );
  }
  if (payload.ok === true) return true;
  if (['EEXIST', 'ENOENT'].includes(payload.code)) return false;
  fail(
    'WORKSPACE_LIFECYCLE_LOCK_INVALID',
    'workspace lifecycle atomic capture primitive is unavailable',
    { cause: payload.code, message: payload.message },
  );
}

function restoreCapture(capture, destination) {
  if (atomicMoveNoReplace(capture, destination)) {
    syncDirectory(path.dirname(destination));
    return;
  }
  fail(
    'WORKSPACE_LIFECYCLE_LOCK_OWNERSHIP_MISMATCH',
    'workspace lifecycle owner changed during capture restore',
    { capture, destination },
  );
}

function removeExactOwnedFile(file, expected, context) {
  const capture = `${file}.capture.${process.pid}.${randomBytes(16).toString('hex')}`;
  if (!atomicMoveNoReplace(file, capture)) return false;
  const captured = readOwnedLock(capture, context);
  if (
    captured !== null &&
    captured.metadata.ownerToken === expected.metadata.ownerToken &&
    captured.metadata.recordDigest === expected.metadata.recordDigest &&
    captured.raw.equals(expected.raw)
  ) {
    unlinkSync(capture);
    syncDirectory(path.dirname(file));
    return true;
  }
  restoreCapture(capture, file);
  return false;
}

function recoveryPath(lockPath) {
  return `${lockPath}.recovery`;
}

function clearStaleRecovery(lockPath) {
  const file = recoveryPath(lockPath);
  const current = readOwnedLock(file, 'workspace lifecycle recovery claim');
  if (current === null) return true;
  if (ownerIsLive(current.metadata)) return false;
  return removeExactOwnedFile(
    file,
    current,
    'captured workspace lifecycle recovery claim',
  );
}

function releaseOwnedFile(file, owned, context) {
  const current = readOwnedLock(file, context);
  if (
    current === null ||
    current.metadata.ownerToken !== owned.metadata.ownerToken ||
    current.metadata.recordDigest !== owned.metadata.recordDigest
  ) {
    fail(
      'WORKSPACE_LIFECYCLE_LOCK_OWNERSHIP_MISMATCH',
      `${context} is not owned by this operation`,
      {
        file,
        expectedOwnerToken: owned.metadata.ownerToken,
        actualOwnerToken: current?.metadata.ownerToken ?? null,
      },
    );
  }
  if (!removeExactOwnedFile(file, owned, `captured ${context}`)) {
    fail(
      'WORKSPACE_LIFECYCLE_LOCK_OWNERSHIP_MISMATCH',
      `${context} changed during release`,
      { file, expectedOwnerToken: owned.metadata.ownerToken },
    );
  }
}

function tryAcquire(options, state) {
  const { lockPath, metadata } = state;
  const claimPath = recoveryPath(lockPath);
  if (existsSync(claimPath) && !clearStaleRecovery(lockPath)) return null;

  const claimMetadata = createWorkspaceLifecycleLockMetadata(options);
  if (!publishOwnedFile(claimPath, claimMetadata)) return null;
  const claim = readOwnedLock(claimPath, 'workspace lifecycle recovery claim');
  try {
    const current = readOwnedLock(lockPath);
    if (current !== null) {
      if (ownerIsLive(current.metadata)) return null;
      const staleCapture = `${lockPath}.stale.${claimMetadata.ownerToken}`;
      if (!atomicMoveNoReplace(lockPath, staleCapture)) return null;
      const captured = readOwnedLock(
        staleCapture,
        'captured stale workspace lifecycle lock',
      );
      if (
        captured === null ||
        captured.metadata.ownerToken !== current.metadata.ownerToken ||
        captured.metadata.recordDigest !== current.metadata.recordDigest ||
        !captured.raw.equals(current.raw) ||
        ownerIsLive(captured.metadata)
      ) {
        restoreCapture(staleCapture, lockPath);
        return null;
      }
      unlinkSync(staleCapture);
      syncDirectory(path.dirname(lockPath));
    }
    if (!publishOwnedFile(lockPath, metadata)) return null;
    const owned = readOwnedLock(lockPath);
    if (
      owned === null ||
      owned.metadata.ownerToken !== metadata.ownerToken ||
      owned.metadata.recordDigest !== metadata.recordDigest
    ) {
      fail(
        'WORKSPACE_LIFECYCLE_LOCK_OWNERSHIP_MISMATCH',
        'workspace lifecycle lock changed during acquisition',
        { lockPath },
      );
    }
    return owned;
  } finally {
    releaseOwnedFile(
      claimPath,
      claim,
      'workspace lifecycle recovery claim',
    );
  }
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function validateTimeout(value) {
  const timeoutMs = Number(value ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    fail(
      'WORKSPACE_LIFECYCLE_LOCK_INVALID',
      'workspace lifecycle lock timeout is invalid',
    );
  }
  return timeoutMs;
}

function acquireState(options) {
  const workspaceId = workspaceIdForOptions(options);
  const lockPath = workspaceLifecycleLockPath({
    home: options.home,
    workspaceId,
  });
  ensurePrivateDirectory(path.dirname(lockPath));
  const metadata = createWorkspaceLifecycleLockMetadata(options);
  return {
    workspaceId,
    lockPath,
    metadata,
    deadline: Date.now() + validateTimeout(options.lockTimeoutMs),
  };
}

function leaseFromState(state, owned) {
  return Object.freeze({
    kind: WORKSPACE_LIFECYCLE_LOCK_KIND,
    workspaceId: state.workspaceId,
    lockPath: state.lockPath,
    ownerToken: owned.metadata.ownerToken,
    recordDigest: owned.metadata.recordDigest,
  });
}

export function assertWorkspaceLifecycleLease(lease, options = {}) {
  const workspaceId = workspaceIdForOptions(options);
  const lockPath = workspaceLifecycleLockPath({
    home: options.home,
    workspaceId,
  });
  if (
    !isObject(lease) ||
    lease.kind !== WORKSPACE_LIFECYCLE_LOCK_KIND ||
    lease.workspaceId !== workspaceId ||
    lease.lockPath !== lockPath ||
    !SHA256.test(lease.ownerToken ?? '') ||
    !SHA256.test(lease.recordDigest ?? '')
  ) {
    fail(
      'WORKSPACE_LIFECYCLE_LOCK_OWNERSHIP_MISMATCH',
      'workspace lifecycle lease does not match this workspace',
      { workspaceId, lockPath },
    );
  }
  const current = readOwnedLock(lockPath);
  if (
    current === null ||
    current.metadata.kind !== WORKSPACE_LIFECYCLE_LOCK_KIND ||
    current.metadata.ownerToken !== lease.ownerToken ||
    current.metadata.recordDigest !== lease.recordDigest
  ) {
    fail(
      'WORKSPACE_LIFECYCLE_LOCK_OWNERSHIP_MISMATCH',
      'workspace lifecycle lease is no longer held',
      { workspaceId, lockPath },
    );
  }
  return lease;
}

function releaseLease(lease) {
  const current = readOwnedLock(lease.lockPath);
  if (
    current === null ||
    current.metadata.kind !== WORKSPACE_LIFECYCLE_LOCK_KIND ||
    current.metadata.ownerToken !== lease.ownerToken ||
    current.metadata.recordDigest !== lease.recordDigest
  ) {
    fail(
      'WORKSPACE_LIFECYCLE_LOCK_OWNERSHIP_MISMATCH',
      'workspace lifecycle lock ownership changed before release',
      {
        lockPath: lease.lockPath,
        expectedOwnerToken: lease.ownerToken,
        actualOwnerToken: current?.metadata.ownerToken ?? null,
      },
    );
  }
  releaseOwnedFile(
    lease.lockPath,
    current,
    'workspace lifecycle lock',
  );
}

export function acquireWorkspaceLifecycleLockSync(options = {}) {
  if (options.lifecycleLease !== undefined) {
    const lease = assertWorkspaceLifecycleLease(
      options.lifecycleLease,
      options,
    );
    return { lease, release() {} };
  }
  const state = acquireState(options);
  while (true) {
    const owned = tryAcquire(options, state);
    if (owned !== null) {
      const lease = leaseFromState(state, owned);
      return { lease, release: () => releaseLease(lease) };
    }
    if (Date.now() >= state.deadline) {
      fail(
        'WORKSPACE_LIFECYCLE_LOCKED',
        'timed out acquiring workspace lifecycle lock',
        { workspaceId: state.workspaceId, lockPath: state.lockPath },
      );
    }
    sleep(25);
  }
}

export async function acquireWorkspaceLifecycleLock(options = {}) {
  if (options.lifecycleLease !== undefined) {
    const lease = assertWorkspaceLifecycleLease(
      options.lifecycleLease,
      options,
    );
    return { lease, release() {} };
  }
  const state = acquireState(options);
  while (true) {
    const owned = tryAcquire(options, state);
    if (owned !== null) {
      const lease = leaseFromState(state, owned);
      return { lease, release: () => releaseLease(lease) };
    }
    if (Date.now() >= state.deadline) {
      fail(
        'WORKSPACE_LIFECYCLE_LOCKED',
        'timed out acquiring workspace lifecycle lock',
        { workspaceId: state.workspaceId, lockPath: state.lockPath },
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function invokeSyncFailpoint(options, name, lease) {
  const failpoint = options.lifecycleFailpoint ?? options.failpoint;
  if (typeof failpoint !== 'function') return;
  const result = failpoint(name, lease);
  if (result && typeof result.then === 'function') {
    fail(
      'WORKSPACE_LIFECYCLE_LOCK_INVALID',
      'synchronous workspace lifecycle failpoint returned a Promise',
      { name },
    );
  }
}

async function invokeAsyncFailpoint(options, name, lease) {
  const failpoint = options.lifecycleFailpoint ?? options.failpoint;
  if (typeof failpoint === 'function') {
    await failpoint(name, lease);
  }
}

export function withWorkspaceLifecycleLockSync(options, operation) {
  const acquired = acquireWorkspaceLifecycleLockSync(options);
  try {
    invokeSyncFailpoint(
      options,
      'after-workspace-lifecycle-lock-acquired',
      acquired.lease,
    );
    return operation(acquired.lease);
  } finally {
    acquired.release();
  }
}

export async function withWorkspaceLifecycleLock(options, operation) {
  const acquired = await acquireWorkspaceLifecycleLock(options);
  try {
    await invokeAsyncFailpoint(
      options,
      'after-workspace-lifecycle-lock-acquired',
      acquired.lease,
    );
    return await operation(acquired.lease);
  } finally {
    acquired.release();
  }
}
