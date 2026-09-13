import { randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';

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
  parseRuntimeClaims,
  parseSourceClaims,
  requiredIdentifier,
  requiredText,
  validateDeclaration,
} from './dev-work-schema.mjs';

const LOCK_TIMEOUT_MS = 5_000;
const LEDGER_KEYS = new Set([
  'schemaVersion',
  'kind',
  'updatedAt',
  'declarations',
]);
const LOCK_KEYS = new Set(['pid', 'processStart', 'createdAt']);

export function emptyLedger(now = new Date()) {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: LEDGER_KIND,
    updatedAt: now.toISOString(),
    declarations: {},
  };
}

export function readLedger(file, now = new Date()) {
  if (!existsSync(file)) {
    return emptyLedger(now);
  }
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
    ledger.schemaVersion !== SCHEMA_VERSION ||
    ledger.kind !== LEDGER_KIND ||
    !isObject(ledger.declarations) ||
    Object.keys(ledger).some((key) => !LEDGER_KEYS.has(key)) ||
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
  try {
    const value = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
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
    Object.keys(metadata).length !== LOCK_KEYS.size ||
    Object.keys(metadata).some((key) => !LOCK_KEYS.has(key)) ||
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

function acquireLock(lockFile, timeoutMs = LOCK_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      const processStart = processStartIdentity();
      if (!processStart) {
        fail(
          'MACHINE_WORK_LEDGER_LOCK_INVALID',
          'cannot establish lock process identity',
        );
      }
      publishLockAtomic(lockFile, {
        pid: process.pid,
        processStart,
        createdAt: new Date().toISOString(),
      });
      return () => {
        try {
          unlinkSync(lockFile);
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const metadata = readLockMetadata(lockFile);
      if (metadata === null) continue;
      const pid = metadata.pid;
      const live = processIsAlive(pid);
      const actualStart = processStartIdentity(pid);
      if (live && actualStart === null) {
        fail(
          'MACHINE_WORK_LEDGER_LOCK_INVALID',
          'live work ledger lock has no verifiable process identity',
        );
      }
      const stale = !live || actualStart !== metadata.processStart;
      if (stale) {
        try {
          unlinkSync(lockFile);
        } catch (unlinkError) {
          if (unlinkError?.code !== 'ENOENT') throw unlinkError;
        }
        continue;
      }
      if (Date.now() >= deadline) {
        fail('MACHINE_WORK_LEDGER_LOCKED', 'timed out acquiring work ledger lock');
      }
      sleep(50);
    }
  }
}

function syncDirectory(directory) {
  let fd;
  try {
    fd = openSync(directory, 'r');
    fsyncSync(fd);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function writeLedgerAtomic(file, ledger) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = path.join(
    path.dirname(file),
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
    syncDirectory(path.dirname(file));
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temp)) unlinkSync(temp);
  }
}

function pathsOverlap(left, right) {
  if (left === '.' || right === '.') return true;
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
  const declaration = {
    declarationId: declarationId(workItemId, workspaceId),
    workItemId,
    sessionId,
    workspaceId,
    branch:
      options.branch ??
      gitValue(workspaceRoot, ['branch', '--show-current'], 'branch'),
    sourceHead:
      options.sourceHead ??
      gitValue(workspaceRoot, ['rev-parse', 'HEAD'], 'sourceHead'),
    owner: requiredText(options.owner ?? existing?.owner, 'owner', 256),
    purpose: requiredText(options.purpose ?? existing?.purpose, 'purpose', 1024),
    journeyId: options.journeyId
      ? requiredIdentifier(options.journeyId, 'journeyId')
      : existing?.journeyId ?? null,
    state: options.state ?? existing?.state ?? 'DECLARED',
    createdAt: existing?.createdAt ?? now.toISOString(),
    heartbeatAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + expiresMinutes * 60_000).toISOString(),
    sourceClaims,
    runtimeClaims,
  };
  declaration.declarationDigest = digestDeclaration(declaration);
  return declaration;
}

function mutateLedger(options, mutation) {
  const home = options.home ?? homedir();
  const file = options.ledgerPath ?? developmentWorkLedgerPath(home);
  const lockFile = options.lockPath ?? developmentWorkLockPath(home);
  const now = options.now ?? new Date();
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const release = acquireLock(lockFile, options.lockTimeoutMs);
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

export function startOrUpdateDeclaration(
  options,
  { requireExisting = false } = {},
) {
  return mutateLedger(options, (ledger, now) => {
    const workspaceRoot = path.resolve(options.workspaceRoot ?? repoRoot);
    const workspaceId = workspaceIdForRoot(workspaceRoot);
    const workItemId = requiredIdentifier(options.workItemId, 'workItemId');
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
    }
    ledger.declarations[id] = candidate;
    return candidate;
  }).output;
}

function ownedDeclaration(options, ledger) {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? repoRoot);
  const workspaceId = workspaceIdForRoot(workspaceRoot);
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
  return declaration;
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
  return mutateLedger(options, (ledger, now) => ({
    observedAt: now.toISOString(),
    declarations: Object.values(ledger.declarations).sort((left, right) =>
      left.declarationId.localeCompare(right.declarationId),
    ),
  })).output;
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
    if (!LIVE_STATES.has(declaration.state)) {
      fail('WORK_DECLARATION_NOT_ACTIVE', 'declaration is not active', {
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
    declaration.state = 'ACTIVE';
    declaration.heartbeatAt = now.toISOString();
    declaration.declarationDigest = digestDeclaration(declaration);
    return declaration;
  }).output;
}
