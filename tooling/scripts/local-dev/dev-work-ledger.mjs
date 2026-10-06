import { randomBytes } from 'node:crypto';
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
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  developmentWorkLedgerPath,
  developmentWorkLockPath,
  repoRoot,
  workspaceIdForRoot,
} from '../lib/machine-dev-paths.mjs';
import {
  DEFAULT_EXPIRES_MINUTES,
  LEDGER_KIND,
  LIVE_STATES,
  SCHEMA_VERSION,
  canonicalize,
  digestDeclaration,
  fail,
  isObject,
  normalizePlanPath,
  parseRuntimeClaims,
  parseSourceClaims,
  requiredIdentifier,
  requiredText,
  validateDeclaration,
  validateSourcePathContainment,
} from './dev-work-schema.mjs';
import {
  WorkspaceLifecycleLockError,
  withWorkspaceLifecycleLockSync,
} from './workspace-lifecycle-lock.mjs';
import { assertDevelopmentCloseAdmission } from './development-close-store.mjs';
import { readActiveWorkRecord } from './active-work-store.mjs';
import {
  sameWorkflowOwnerReference,
  validateWorkflowOwnerReference,
} from './workflow-owner-reference.mjs';

const LOCK_TIMEOUT_MS = 5_000;
const WORKSPACE_ID = /^[0-9a-f]{16}$/;
const PLANCTL_SCRIPT = fileURLToPath(
  new URL('../plan/planctl.mjs', import.meta.url),
);
const PLAN_MOUNT_SCRIPT = fileURLToPath(
  new URL('../plan/plan-mount.mjs', import.meta.url),
);
const LEDGER_KEYS = new Set([
  'schemaVersion',
  'kind',
  'updatedAt',
  'declarations',
]);
const LOCK_KEYS = new Set(['pid', 'processStart', 'createdAt']);
const RECOVERY_KEYS = new Set([
  'pid',
  'processStart',
  'createdAt',
  'lockDev',
  'lockIno',
]);
const ATOMIC_RENAME_SCRIPT = [
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

function exactKeys(value, keys) {
  const actual = Object.keys(value);
  return actual.length === keys.size && actual.every((key) => keys.has(key));
}

function toOperationDate(options = {}) {
  const value =
    typeof options.clock === 'function'
      ? options.clock()
      : options.now ?? new Date();
  const now = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(now.getTime())) {
    fail('INVALID_CLOCK', 'operation clock returned an invalid time');
  }
  return now;
}

function ensurePrivateDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
}

export function emptyLedger(now = new Date()) {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: LEDGER_KIND,
    updatedAt: now.toISOString(),
    declarations: {},
  };
}

export function readLedger(file, now = new Date()) {
  if (!existsSync(file)) return emptyLedger(now);
  let ledger;
  try {
    ledger = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    fail('MACHINE_WORK_LEDGER_INVALID', 'work ledger is not valid JSON', {
      cause: String(error),
    });
  }
  const updatedAt = Date.parse(ledger?.updatedAt);
  if (
    !isObject(ledger) ||
    !exactKeys(ledger, LEDGER_KEYS) ||
    ledger.schemaVersion !== SCHEMA_VERSION ||
    ledger.kind !== LEDGER_KIND ||
    !isObject(ledger.declarations) ||
    !Number.isFinite(updatedAt) ||
    new Date(updatedAt).toISOString() !== ledger.updatedAt
  ) {
    fail('MACHINE_WORK_LEDGER_INVALID', 'work ledger schema is invalid');
  }
  for (const [id, declaration] of Object.entries(ledger.declarations)) {
    validateDeclaration(declaration);
    if (id !== declaration.declarationId) {
      fail(
        'MACHINE_WORK_LEDGER_INVALID',
        'declaration map key does not match declarationId',
        { declarationId: declaration.declarationId, key: id },
      );
    }
  }
  return ledger;
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

export function processStartIdentity(pid = process.pid) {
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

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function readLockMetadata(lockFile) {
  let raw;
  try {
    raw = readFileSync(lockFile, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    fail(
      'MACHINE_WORK_LEDGER_LOCK_INVALID',
      'work ledger lock metadata cannot be read',
      { cause: String(error) },
    );
  }
  let metadata;
  try {
    metadata = JSON.parse(raw);
  } catch (error) {
    fail(
      'MACHINE_WORK_LEDGER_LOCK_INVALID',
      'work ledger lock metadata is invalid',
      { cause: String(error) },
    );
  }
  const createdAt = Date.parse(metadata?.createdAt);
  if (
    !isObject(metadata) ||
    !exactKeys(metadata, LOCK_KEYS) ||
    !Number.isInteger(metadata.pid) ||
    metadata.pid <= 0 ||
    typeof metadata.processStart !== 'string' ||
    metadata.processStart.trim() !== metadata.processStart ||
    metadata.processStart === '' ||
    !Number.isFinite(createdAt) ||
    new Date(createdAt).toISOString() !== metadata.createdAt
  ) {
    fail(
      'MACHINE_WORK_LEDGER_LOCK_INVALID',
      'work ledger lock metadata schema is invalid',
    );
  }
  return metadata;
}

function syncDirectory(directory) {
  if (process.platform === 'win32') return;
  let fd;
  try {
    fd = openSync(directory, 'r');
    fsyncSync(fd);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function publishLockAtomic(lockFile, metadata) {
  const directory = path.dirname(lockFile);
  const temp = path.join(
    directory,
    `.${path.basename(lockFile)}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`,
  );
  let fd;
  try {
    fd = openSync(temp, 'wx', 0o600);
    writeFileSync(fd, `${JSON.stringify(metadata)}\n`);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    linkSync(temp, lockFile);
    syncDirectory(directory);
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temp)) unlinkSync(temp);
  }
}

function staleRecoveryPath(lockFile) {
  return `${lockFile}.recovery`;
}

function readRecoveryMetadata(recoveryFile) {
  let raw;
  try {
    raw = readFileSync(recoveryFile, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    fail(
      'MACHINE_WORK_LEDGER_LOCK_INVALID',
      'work ledger recovery metadata cannot be read',
      { cause: String(error) },
    );
  }
  let metadata;
  try {
    metadata = JSON.parse(raw);
  } catch (error) {
    fail(
      'MACHINE_WORK_LEDGER_LOCK_INVALID',
      'work ledger recovery metadata is invalid',
      { cause: String(error) },
    );
  }
  const createdAt = Date.parse(metadata?.createdAt);
  if (
    !isObject(metadata) ||
    !exactKeys(metadata, RECOVERY_KEYS) ||
    !Number.isInteger(metadata.pid) ||
    metadata.pid <= 0 ||
    typeof metadata.processStart !== 'string' ||
    metadata.processStart.trim() !== metadata.processStart ||
    metadata.processStart === '' ||
    !Number.isFinite(createdAt) ||
    new Date(createdAt).toISOString() !== metadata.createdAt ||
    !Number.isInteger(metadata.lockDev) ||
    metadata.lockDev < 0 ||
    !Number.isInteger(metadata.lockIno) ||
    metadata.lockIno < 0
  ) {
    fail(
      'MACHINE_WORK_LEDGER_LOCK_INVALID',
      'work ledger recovery metadata schema is invalid',
    );
  }
  return metadata;
}

function publishRecoveryAtomic(recoveryFile, metadata) {
  publishLockAtomic(recoveryFile, metadata);
}

function atomicMoveFileNoReplace(sourceFile, destinationFile) {
  const result = spawnSync(
    'python3',
    [
      '-c',
      ATOMIC_RENAME_SCRIPT,
      path.resolve(sourceFile),
      path.resolve(destinationFile),
    ],
    {
      encoding: 'utf8',
      env: process.env,
      maxBuffer: 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    fail(
      'MACHINE_WORK_LEDGER_LOCK_INVALID',
      'atomic lock capture helper failed',
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
      'MACHINE_WORK_LEDGER_LOCK_INVALID',
      'atomic lock capture helper returned invalid output',
    );
  }
  if (payload.ok === true) return true;
  if (['EEXIST', 'ENOENT'].includes(payload.code)) return false;
  fail(
    'MACHINE_WORK_LEDGER_LOCK_INVALID',
    'required atomic lock capture primitive is unavailable',
    { cause: payload.code, message: payload.message },
  );
}

function removeOwnedMetadataFile(file, expected, reader) {
  const capture = `${file}.capture.${process.pid}.${randomBytes(16).toString('hex')}`;
  if (!atomicMoveFileNoReplace(file, capture)) return false;
  const captured = reader(capture);
  if (
    captured !== null &&
    JSON.stringify(captured) === JSON.stringify(expected)
  ) {
    unlinkSync(capture);
    syncDirectory(path.dirname(file));
    return true;
  }
  if (!atomicMoveFileNoReplace(capture, file)) {
    fail(
      'MACHINE_WORK_LEDGER_LOCK_INVALID',
      'metadata owner changed during atomic capture',
      { file, capture },
    );
  }
  return false;
}

function clearStaleRecovery(recoveryFile) {
  const metadata = readRecoveryMetadata(recoveryFile);
  if (metadata === null) return true;
  const live = processIsAlive(metadata.pid);
  const actualStart = processStartIdentity(metadata.pid);
  if (live && actualStart === null) {
    fail(
      'MACHINE_WORK_LEDGER_LOCK_INVALID',
      'live work ledger recovery owner has no verifiable process identity',
    );
  }
  if (live && actualStart === metadata.processStart) {
    return false;
  }
  return removeOwnedMetadataFile(
    recoveryFile,
    metadata,
    readRecoveryMetadata,
  );
}

function claimAndRemoveStaleLock(lockFile, expectedMetadata) {
  const recoveryFile = staleRecoveryPath(lockFile);
  let lockStat;
  try {
    lockStat = lstatSync(lockFile);
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  const processStart = processStartIdentity();
  if (!processStart) {
    fail(
      'MACHINE_WORK_LEDGER_LOCK_INVALID',
      'cannot establish recovery process identity',
    );
  }
  const recoveryMetadata = {
    pid: process.pid,
    processStart,
    createdAt: new Date().toISOString(),
    lockDev: lockStat.dev,
    lockIno: lockStat.ino,
  };
  try {
    publishRecoveryAtomic(recoveryFile, recoveryMetadata);
  } catch (error) {
    if (error?.code === 'EEXIST') return false;
    throw error;
  }
  try {
    const current = readLockMetadata(lockFile);
    if (
      current === null ||
      JSON.stringify(current) !== JSON.stringify(expectedMetadata)
    ) {
      return false;
    }
    let currentStat;
    try {
      currentStat = lstatSync(lockFile);
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
    if (
      recoveryMetadata.lockDev !== currentStat.dev ||
      recoveryMetadata.lockIno !== currentStat.ino
    ) {
      return false;
    }
    const live = processIsAlive(current.pid);
    const actualStart = processStartIdentity(current.pid);
    if (live && actualStart === current.processStart) {
      return false;
    }
    return removeOwnedMetadataFile(
      lockFile,
      expectedMetadata,
      readLockMetadata,
    );
  } finally {
    removeOwnedMetadataFile(
      recoveryFile,
      recoveryMetadata,
      readRecoveryMetadata,
    );
  }
}

function acquireLock(
  lockFile,
  timeoutMs = LOCK_TIMEOUT_MS,
  lockTime = new Date(),
) {
  const deadline = Date.now() + timeoutMs;
  let ownedMetadata;
  while (true) {
    try {
      const recoveryFile = staleRecoveryPath(lockFile);
      if (existsSync(recoveryFile)) {
        const cleared = clearStaleRecovery(recoveryFile);
        if (cleared) continue;
        if (Date.now() >= deadline) {
          fail(
            'MACHINE_WORK_LEDGER_LOCKED',
            'timed out while stale lock recovery is in progress',
          );
        }
        sleep(50);
        continue;
      }
      const processStart = processStartIdentity();
      if (!processStart) {
        fail(
          'MACHINE_WORK_LEDGER_LOCK_INVALID',
          'cannot establish lock process identity',
        );
      }
      ownedMetadata = {
        pid: process.pid,
        processStart,
        createdAt: lockTime.toISOString(),
      };
      publishLockAtomic(lockFile, ownedMetadata);
      if (existsSync(recoveryFile)) {
        if (
          !removeOwnedMetadataFile(
            lockFile,
            ownedMetadata,
            readLockMetadata,
          )
        ) {
          fail(
            'MACHINE_WORK_LEDGER_LOCK_INVALID',
            'work ledger lock ownership changed during recovery exclusion',
          );
        }
        continue;
      }
      return () => {
        const current = readLockMetadata(lockFile);
        if (
          current &&
          JSON.stringify(current) !== JSON.stringify(ownedMetadata)
        ) {
          fail(
            'MACHINE_WORK_LEDGER_LOCK_INVALID',
            'work ledger lock ownership changed',
          );
        }
        if (
          current !== null &&
          !removeOwnedMetadataFile(
            lockFile,
            ownedMetadata,
            readLockMetadata,
          )
        ) {
          fail(
            'MACHINE_WORK_LEDGER_LOCK_INVALID',
            'work ledger lock ownership changed during release',
          );
        }
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const metadata = readLockMetadata(lockFile);
      if (metadata === null) continue;
      const live = processIsAlive(metadata.pid);
      const actualStart = processStartIdentity(metadata.pid);
      if (live && actualStart === null) {
        fail(
          'MACHINE_WORK_LEDGER_LOCK_INVALID',
          'live work ledger lock has no verifiable process identity',
        );
      }
      if (!live || actualStart !== metadata.processStart) {
        claimAndRemoveStaleLock(lockFile, metadata);
        continue;
      }
      if (Date.now() >= deadline) {
        fail('MACHINE_WORK_LEDGER_LOCKED', 'timed out acquiring work ledger lock');
      }
      sleep(50);
    }
  }
}

function writeLedgerAtomic(file, ledger) {
  const directory = path.dirname(file);
  ensurePrivateDirectory(directory);
  const temp = path.join(
    directory,
    `.${path.basename(file)}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`,
  );
  let fd;
  try {
    fd = openSync(temp, 'wx', 0o600);
    writeFileSync(fd, `${JSON.stringify(canonicalize(ledger), null, 2)}\n`);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temp, file);
    chmodSync(file, 0o600);
    syncDirectory(directory);
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temp)) unlinkSync(temp);
  }
}

function pathsOverlap(left, right) {
  return (
    left === right ||
    left.startsWith(`${right}/`) ||
    right.startsWith(`${left}/`)
  );
}

function isLive(declaration, now) {
  return (
    LIVE_STATES.has(declaration.state) &&
    Date.parse(declaration.expiresAt) > now.getTime()
  );
}

function reconcileExpired(ledger, now) {
  let changed = false;
  for (const declaration of Object.values(ledger.declarations)) {
    if (
      LIVE_STATES.has(declaration.state) &&
      Date.parse(declaration.expiresAt) <= now.getTime()
    ) {
      declaration.state = 'STALE';
      declaration.declarationDigest = digestDeclaration(declaration);
      changed = true;
    }
  }
  return changed;
}

function conflictWith(candidate, current) {
  if (
    candidate.workspaceId !== current.workspaceId &&
    candidate.branch === current.branch &&
    candidate.sourceClaims.some((claim) => claim.mode === 'exclusive-write') &&
    current.sourceClaims.some((claim) => claim.mode === 'exclusive-write')
  ) {
    return { kind: 'BRANCH_WRITE_CONFLICT', resource: candidate.branch };
  }
  if (candidate.workspaceId === current.workspaceId) {
    for (const left of candidate.sourceClaims) {
      for (const right of current.sourceClaims) {
        if (
          pathsOverlap(left.pathPrefix, right.pathPrefix) &&
          (left.mode === 'exclusive-write' || right.mode === 'exclusive-write')
        ) {
          return { kind: 'SOURCE_WRITE_CONFLICT', resource: left.pathPrefix };
        }
      }
    }
  }
  for (const left of candidate.runtimeClaims) {
    for (const right of current.runtimeClaims) {
      if (
        left.kind === right.kind &&
        left.resourceId === right.resourceId &&
        (left.mode === 'exclusive' || right.mode === 'exclusive')
      ) {
        return {
          kind: 'RUNTIME_RESOURCE_CONFLICT',
          resource: `${left.kind}:${left.resourceId}`,
        };
      }
    }
  }
  return null;
}

function sourceOverlapWarning(candidate, current) {
  if (
    candidate.workspaceId === current.workspaceId ||
    candidate.branch === current.branch
  ) {
    return null;
  }
  for (const left of candidate.sourceClaims) {
    for (const right of current.sourceClaims) {
      if (
        pathsOverlap(left.pathPrefix, right.pathPrefix) &&
        (left.mode === 'exclusive-write' || right.mode === 'exclusive-write')
      ) {
        return {
          kind: 'SOURCE_OVERLAP_WARNING',
          resource: left.pathPrefix,
          otherPathPrefix: right.pathPrefix,
        };
      }
    }
  }
  return null;
}

function gitValue(root, args, field) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    fail('WORKTREE_IDENTITY_UNAVAILABLE', `cannot resolve ${field}`, { root });
  }
}

function declarationId(workItemId, workspaceId) {
  return `${workItemId}-${workspaceId}`;
}

function validateExpiry(value) {
  const expiresMinutes = Number(value ?? DEFAULT_EXPIRES_MINUTES);
  if (
    !Number.isFinite(expiresMinutes) ||
    expiresMinutes <= 0 ||
    expiresMinutes > 1440
  ) {
    fail('INVALID_DECLARATION', 'expiresMinutes must be within 1..1440');
  }
  return expiresMinutes;
}

function parsePlanStatus(workspaceRoot, planPath, options) {
  if (options.planStatus) return options.planStatus;
  const absolutePlan = path.resolve(
    workspaceRoot,
    ...planPath.split('/'),
  );
  try {
    return JSON.parse(
      execFileSync(
        process.execPath,
        [
          PLANCTL_SCRIPT,
          'status',
          '--plan',
          absolutePlan,
          '--repo-root',
          workspaceRoot,
        ],
        {
          cwd: workspaceRoot,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      ),
    );
  } catch (error) {
    fail('PLAN_LOCATOR_INVALID', 'declared Plan Package is unavailable', {
      cause:
        error?.stderr?.toString().trim() ||
        error?.stdout?.toString().trim() ||
        String(error),
    });
  }
}

function parsePlanExecution(workspaceRoot, options) {
  if (Object.hasOwn(options, 'planExecution')) {
    return options.planExecution;
  }
  const arguments_ = [
    PLAN_MOUNT_SCRIPT,
    'status',
    '--repo-root',
    workspaceRoot,
  ];
  if (options.home) arguments_.push('--home', options.home);
  try {
    const payload = JSON.parse(
      execFileSync(process.execPath, arguments_, {
        cwd: workspaceRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
    return {
      mount: payload.mount,
      snapshot: payload.snapshot,
      run: payload.run,
    };
  } catch (error) {
    let payload;
    try {
      payload = JSON.parse(error?.stderr?.toString() ?? '');
    } catch {
      payload = null;
    }
    fail(
      payload?.error?.code ?? 'PLAN_MOUNT_REQUIRED',
      payload?.error?.message ?? 'workspace Plan mount is unavailable',
      payload?.error?.details,
    );
  }
}

function assertUntrackedWorkspace(options, identity) {
  try {
    const execution = parsePlanExecution(identity.workspaceRoot, options);
    if (execution === null) return;
    fail(
      'WORKSPACE_PLAN_DECLARATION_REQUIRED',
      'a Plan-mounted workspace cannot publish untracked work',
    );
  } catch (error) {
    if (error?.code !== 'PLAN_MOUNT_REQUIRED') throw error;
  }
}

function resolvePlanLocator(options, existing, identity) {
  const supplied = [
    options.planPath,
    options.planId,
    options.taskId,
  ].some((value) => value !== undefined);
  const existingHasLocator =
    existing !== null &&
    existing !== undefined &&
    existing.planPath !== null;
  if (!supplied && !existingHasLocator) {
    assertUntrackedWorkspace(options, identity);
    return null;
  }

  const planPath =
    options.planPath === undefined ? existing?.planPath : options.planPath;
  const planId =
    options.planId === undefined ? existing?.planId : options.planId;
  const taskId =
    options.taskId === undefined ? existing?.taskId : options.taskId;
  const values = [planPath, planId, taskId];
  if (values.every((value) => value === null)) {
    assertUntrackedWorkspace(options, identity);
    return {
      planPath: null,
      planId: null,
      planDigest: null,
      mountId: null,
      runId: null,
      taskId: null,
    };
  }
  if (
    typeof planPath !== 'string' ||
    planPath.trim() === '' ||
    typeof taskId !== 'string' ||
    taskId.trim() === '' ||
    (planId !== undefined &&
      planId !== null &&
      (typeof planId !== 'string' || planId.trim() === ''))
  ) {
    fail(
      'INVALID_PLAN_LOCATOR',
      'planPath and taskId must be supplied together',
    );
  }

  const normalizedPlanPath = normalizePlanPath(planPath);
  validateSourcePathContainment(identity.workspaceRoot, normalizedPlanPath);
  const normalizedTaskId = requiredIdentifier(taskId, 'taskId');
  const status = parsePlanStatus(
    identity.workspaceRoot,
    normalizedPlanPath,
    options,
  );
  const execution = parsePlanExecution(identity.workspaceRoot, options);
  const normalizedPlanId =
    planId === undefined || planId === null
      ? requiredIdentifier(status.planId, 'planId')
      : requiredIdentifier(planId, 'planId');
  const declaredTaskStatus = status.taskStatuses?.[normalizedTaskId];
  const taskMatchesLifecycle =
    status.currentTaskId === normalizedTaskId ||
    (status.status === 'completed' && declaredTaskStatus === 'done') ||
    (status.status === 'blocked' && declaredTaskStatus === 'blocked');
  const mismatches = {};
  for (const [field, expected, actual] of [
    ['planId', normalizedPlanId, status.planId],
    ['workspaceId', identity.workspaceId, status.workspaceId],
    ['branch', identity.branch, status.branch],
    ['mountedPlanId', normalizedPlanId, execution.mount.planId],
    ['mountedPlanPath', normalizedPlanPath, execution.mount.planPath],
    [
      'planDigest',
      status.planDigest,
      execution.snapshot.planDigest,
    ],
    ['mountId', status.mountId, execution.mount.mountId],
    ['runId', status.runId, execution.run.runId],
  ]) {
    if (expected !== actual) mismatches[field] = { expected, actual };
  }
  if (!taskMatchesLifecycle) {
    mismatches.taskId = {
      expected: normalizedTaskId,
      actual: status.currentTaskId,
      taskStatus: declaredTaskStatus ?? null,
      planStatus: status.status ?? null,
    };
  }
  if (existingHasLocator) {
    for (const [field, actual] of [
      ['mountId', status.mountId],
      ['runId', status.runId],
    ]) {
      if (existing[field] !== actual) {
        mismatches[field] = {
          expected: existing[field] ?? null,
          actual,
        };
      }
    }
  }
  if (Object.keys(mismatches).length > 0) {
    fail('PLAN_LOCATOR_MISMATCH', 'declared Plan locator does not match', {
      mismatches,
    });
  }
  return {
    planPath: normalizedPlanPath,
    planId: normalizedPlanId,
    planDigest: status.planDigest,
    mountId: status.mountId,
    runId: status.runId,
    taskId: normalizedTaskId,
  };
}

function buildDeclaration(options, existing, now) {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? repoRoot);
  const workspaceId = workspaceIdForRoot(workspaceRoot);
  const workItemId = requiredIdentifier(options.workItemId, 'workItemId');
  const sessionId = options.sessionId
    ? requiredIdentifier(options.sessionId, 'sessionId')
    : existing?.sessionId ??
      `${workItemId}-${now.toISOString().replace(/[^0-9]/g, '').slice(0, 14)}`;
  const expiresMinutes = validateExpiry(options.expiresMinutes);
  const sourceClaims =
    options.sourceClaims === undefined
      ? existing?.sourceClaims ?? []
      : parseSourceClaims(options.sourceClaims);
  const runtimeClaims =
    options.runtimeClaims === undefined
      ? existing?.runtimeClaims ?? []
      : parseRuntimeClaims(options.runtimeClaims);
  if (sourceClaims.length === 0) {
    fail('INVALID_DECLARATION', 'at least one source claim is required');
  }
  for (const claim of sourceClaims) {
    validateSourcePathContainment(workspaceRoot, claim.pathPrefix);
  }
  const branch =
    options.branch ??
    gitValue(workspaceRoot, ['branch', '--show-current'], 'branch');
  const sourceHead =
    options.sourceHead ??
    gitValue(workspaceRoot, ['rev-parse', 'HEAD'], 'sourceHead');
  const planLocator = resolvePlanLocator(options, existing, {
    workspaceRoot,
    workspaceId,
    branch,
    sourceHead,
  });
  const suppliedWorkflowOwner =
    options.workflowOwner === undefined ||
    options.workflowOwner === null
      ? null
      : validateWorkflowOwnerReference(options.workflowOwner);
  const existingWorkflowOwner = existing?.workflowOwner ?? null;
  if (
    existingWorkflowOwner !== null &&
    suppliedWorkflowOwner !== null &&
    !sameWorkflowOwnerReference(
      existingWorkflowOwner,
      suppliedWorkflowOwner,
    )
  ) {
    fail(
      'WORK_DECLARATION_OWNER_MISMATCH',
      'workflow OWNER does not own declaration',
      {
        expected: existingWorkflowOwner.rootBindingDigest,
        actual: suppliedWorkflowOwner.rootBindingDigest,
      },
    );
  }
  const workflowOwner = existingWorkflowOwner ?? suppliedWorkflowOwner;
  const declaration = {
    declarationId: declarationId(workItemId, workspaceId),
    workItemId,
    sessionId,
    workspaceId,
    branch,
    sourceHead,
    owner: requiredText(options.owner ?? existing?.owner, 'owner', 256),
    purpose: requiredText(options.purpose ?? existing?.purpose, 'purpose', 1024),
    journeyId: options.journeyId
      ? requiredIdentifier(options.journeyId, 'journeyId')
      : existing?.journeyId ?? null,
    state: existing?.state ?? 'DECLARED',
    createdAt: existing?.createdAt ?? now.toISOString(),
    heartbeatAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + expiresMinutes * 60_000).toISOString(),
    sourceClaims,
    runtimeClaims,
    planPath: null,
    planId: null,
    planDigest: null,
    mountId: null,
    runId: null,
    taskId: null,
    ...(workflowOwner === null ? {} : { workflowOwner }),
  };
  if (planLocator !== null) Object.assign(declaration, planLocator);
  declaration.declarationDigest = digestDeclaration(declaration);
  validateDeclaration(declaration);
  return declaration;
}

function mutateLedgerUnderFence(options, mutation) {
  const home = options.home ?? homedir();
  const file = options.ledgerPath ?? developmentWorkLedgerPath(home);
  const lockFile = options.lockPath ?? developmentWorkLockPath(home);
  const now = toOperationDate(options);
  ensurePrivateDirectory(path.dirname(file));
  ensurePrivateDirectory(path.dirname(lockFile));
  const release = acquireLock(lockFile, options.lockTimeoutMs, now);
  try {
    const ledger = readLedger(file, now);
    reconcileExpired(ledger, now);
    const output = mutation(ledger, now);
    ledger.updatedAt = now.toISOString();
    writeLedgerAtomic(file, ledger);
    const readback = readLedger(file, now);
    return { output, ledger: readback, file };
  } finally {
    release();
  }
}

function mutateLedger(options, mutation) {
  const identity =
    options.workspaceRoot === undefined && options.workspaceId !== undefined
      ? {
          workspaceId: requiredText(
            options.workspaceId,
            'workspaceId',
            16,
          ),
        }
      : {
          workspaceRoot: path.resolve(options.workspaceRoot ?? repoRoot),
        };
  if (
    identity.workspaceId !== undefined &&
    !WORKSPACE_ID.test(identity.workspaceId)
  ) {
    fail('INVALID_DECLARATION', 'workspaceId is invalid');
  }
  try {
    return withWorkspaceLifecycleLockSync(
      {
        home: options.home,
        ...identity,
        lifecycleLease: options.lifecycleLease,
        lockTimeoutMs:
          options.lifecycleLockTimeoutMs ?? options.lockTimeoutMs,
        lifecycleFailpoint: options.lifecycleFailpoint,
      },
      (lifecycleLease) =>
        mutateLedgerUnderFence(
          { ...options, ...identity, lifecycleLease },
          mutation,
        ),
    );
  } catch (error) {
    if (error instanceof WorkspaceLifecycleLockError) {
      fail(error.code, error.message, error.detail);
    }
    throw error;
  }
}

function inspectLedger(options, inspection) {
  const home = options.home ?? homedir();
  const file = options.ledgerPath ?? developmentWorkLedgerPath(home);
  const lockFile = options.lockPath ?? developmentWorkLockPath(home);
  const now = toOperationDate(options);
  ensurePrivateDirectory(path.dirname(file));
  ensurePrivateDirectory(path.dirname(lockFile));
  const release = acquireLock(lockFile, options.lockTimeoutMs, now);
  try {
    const ledger = readLedger(file, now);
    reconcileExpired(ledger, now);
    return inspection(ledger, now);
  } finally {
    release();
  }
}

export function startOrUpdateDeclaration(
  options,
  { requireExisting = false, onWarning = () => {} } = {},
) {
  const warnings = [];
  const declaration = mutateLedger(options, (ledger, now) => {
    const workspaceRoot = path.resolve(options.workspaceRoot ?? repoRoot);
    const workspaceId = workspaceIdForRoot(workspaceRoot);
    assertDevelopmentCloseAdmission({
      home: options.home,
      workspaceId,
    });
    const workItemId = requiredIdentifier(options.workItemId, 'workItemId');
    const activeWork = readActiveWorkRecord({
      home: options.home,
      workspaceId,
    });
    if (
      activeWork !== null &&
      activeWork.workItemId !== workItemId
    ) {
      fail(
        'DEVELOPMENT_CLOSE_REQUIRED',
        'previous workspace active-work must be closed before new declaration',
        {
          activeWorkItemId: activeWork.workItemId,
          requestedWorkItemId: workItemId,
          revision: activeWork.revision,
        },
      );
    }
    const id = declarationId(workItemId, workspaceId);
    const existing = ledger.declarations[id];
    if (requireExisting && !existing) {
      fail('WORK_DECLARATION_MISSING', 'declaration does not exist', {
        declarationId: id,
      });
    }
    if (requireExisting && !LIVE_STATES.has(existing.state)) {
      fail('WORK_DECLARATION_NOT_ACTIVE', 'declaration is not active', {
        declarationId: id,
        state: existing.state,
      });
    }
    if (
      existing &&
      LIVE_STATES.has(existing.state) &&
      options.sessionId !== undefined &&
      requiredIdentifier(options.sessionId, 'sessionId') !== existing.sessionId
    ) {
      fail('WORK_DECLARATION_OWNER_MISMATCH', 'session does not own declaration', {
        declarationId: id,
      });
    }
    if (
      existing &&
      LIVE_STATES.has(existing.state) &&
      options.owner !== undefined &&
      requiredText(options.owner, 'owner', 256) !== existing.owner
    ) {
      fail('WORK_DECLARATION_OWNER_MISMATCH', 'owner does not own declaration', {
        declarationId: id,
      });
    }
    const reusableExisting =
      existing && (requireExisting || LIVE_STATES.has(existing.state))
        ? existing
        : null;
    const candidate = buildDeclaration(options, reusableExisting, now);
    for (const current of Object.values(ledger.declarations)) {
      if (current.declarationId === id || !isLive(current, now)) continue;
      const conflict = conflictWith(candidate, current);
      if (conflict) {
        fail('RESOURCE_DECLARATION_CONFLICT', 'development resource conflict', {
          declarationId: current.declarationId,
          workspaceId: current.workspaceId,
          ...conflict,
        });
      }
      const warning = sourceOverlapWarning(candidate, current);
      if (warning) {
        warnings.push({
          declarationId: current.declarationId,
          workspaceId: current.workspaceId,
          branch: current.branch,
          ...warning,
        });
      }
    }
    ledger.declarations[id] = candidate;
    return candidate;
  }).output;
  for (const warning of warnings) {
    onWarning(warning);
  }
  return declaration;
}

function ownedDeclaration(options, ledger) {
  const workspaceId =
    options.workspaceRoot === undefined && options.workspaceId !== undefined
      ? requiredText(options.workspaceId, 'workspaceId', 16)
      : workspaceIdForRoot(path.resolve(options.workspaceRoot ?? repoRoot));
  if (!WORKSPACE_ID.test(workspaceId)) {
    fail('INVALID_DECLARATION', 'workspaceId is invalid');
  }
  const workItemId = requiredIdentifier(options.workItemId, 'workItemId');
  const id = declarationId(workItemId, workspaceId);
  const declaration = ledger.declarations[id];
  if (!declaration) {
    fail('WORK_DECLARATION_MISSING', 'declaration does not exist', {
      declarationId: id,
    });
  }
  if (options.sessionId && declaration.sessionId !== options.sessionId) {
    fail('WORK_DECLARATION_OWNER_MISMATCH', 'session does not own declaration', {
      declarationId: id,
    });
  }
  if (options.owner && declaration.owner !== options.owner) {
    fail('WORK_DECLARATION_OWNER_MISMATCH', 'owner does not own declaration', {
      declarationId: id,
      expected: declaration.owner,
      actual: options.owner,
    });
  }
  if (
    declaration.workflowOwner !== undefined &&
    options.workflowOwner !== undefined &&
    options.workflowOwner !== null &&
    !sameWorkflowOwnerReference(
      declaration.workflowOwner,
      validateWorkflowOwnerReference(options.workflowOwner),
    )
  ) {
    fail(
      'WORK_DECLARATION_OWNER_MISMATCH',
      'workflow OWNER does not own declaration',
      {
        declarationId: id,
        expected: declaration.workflowOwner.rootBindingDigest,
        actual: options.workflowOwner.rootBindingDigest,
      },
    );
  }
  return declaration;
}

export function requireActiveDeclaration(options) {
  return mutateLedger(options, (ledger) => {
    const declaration = ownedDeclaration(options, ledger);
    if (declaration.state !== 'ACTIVE') {
      fail('WORK_DECLARATION_NOT_ACTIVE', 'declaration is not ACTIVE', {
        declarationId: declaration.declarationId,
        state: declaration.state,
      });
    }
    return declaration;
  }).output;
}

export function heartbeatDeclaration(options) {
  return mutateLedger(options, (ledger, now) => {
    const declaration = ownedDeclaration(options, ledger);
    if (!LIVE_STATES.has(declaration.state)) {
      fail('WORK_DECLARATION_NOT_ACTIVE', 'declaration is not active');
    }
    const expiresMinutes = validateExpiry(options.expiresMinutes);
    declaration.heartbeatAt = now.toISOString();
    declaration.expiresAt = new Date(
      now.getTime() + expiresMinutes * 60_000,
    ).toISOString();
    declaration.declarationDigest = digestDeclaration(declaration);
    return declaration;
  }).output;
}

export function releaseDeclaration(options) {
  return mutateLedger(options, (ledger, now) => {
    const declaration = ownedDeclaration(options, ledger);
    declaration.state = 'RELEASED';
    declaration.heartbeatAt = now.toISOString();
    declaration.expiresAt = now.toISOString();
    declaration.declarationDigest = digestDeclaration(declaration);
    return declaration;
  }).output;
}

export function statusAll(options = {}) {
  return inspectLedger(options, (ledger, now) => ({
    observedAt: now.toISOString(),
    declarations: Object.values(ledger.declarations).sort((left, right) =>
      left.declarationId.localeCompare(right.declarationId),
    ),
  }));
}

export function statusCurrent(options) {
  const all = statusAll(options);
  const workspaceRoot = path.resolve(options.workspaceRoot ?? repoRoot);
  const workspaceId = workspaceIdForRoot(workspaceRoot);
  const declarations = all.declarations.filter(
    (declaration) =>
      declaration.workspaceId === workspaceId &&
      (!options.workItemId || declaration.workItemId === options.workItemId),
  );
  return { ...all, workspaceId, declarations };
}

export function checkDeclaration(options) {
  return mutateLedger(options, (ledger, now) => {
    const declaration = ownedDeclaration(options, ledger);
    if (!['DECLARED', 'ACTIVE'].includes(declaration.state)) {
      fail('WORK_DECLARATION_NOT_ACTIVE', 'declaration cannot become ACTIVE', {
        state: declaration.state,
      });
    }
    const workspaceRoot = path.resolve(options.workspaceRoot ?? repoRoot);
    const currentBranch = gitValue(
      workspaceRoot,
      ['branch', '--show-current'],
      'branch',
    );
    if (declaration.branch !== currentBranch) {
      fail(
        'WORKTREE_IDENTITY_MISMATCH',
        'declared branch does not match worktree',
        { declared: declaration.branch, actual: currentBranch },
      );
    }
    const currentHead = gitValue(
      workspaceRoot,
      ['rev-parse', 'HEAD'],
      'sourceHead',
    );
    if (declaration.sourceHead !== currentHead) {
      fail(
        'WORKTREE_IDENTITY_MISMATCH',
        'declared source HEAD does not match worktree',
        { declared: declaration.sourceHead, actual: currentHead },
      );
    }
    if (declaration.planPath !== null && declaration.planPath !== undefined) {
      resolvePlanLocator(
        {
          ...options,
          planPath: declaration.planPath,
          planId: declaration.planId,
          planDigest: declaration.planDigest,
          mountId: declaration.mountId,
          runId: declaration.runId,
          taskId: declaration.taskId,
        },
        declaration,
        {
          workspaceRoot,
          workspaceId: declaration.workspaceId,
          branch: currentBranch,
          sourceHead: currentHead,
        },
      );
    }
    declaration.state = 'ACTIVE';
    declaration.heartbeatAt = now.toISOString();
    declaration.declarationDigest = digestDeclaration(declaration);
    return declaration;
  }).output;
}
