#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
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
  realpathSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import {
  developmentWorkLedgerPath,
  isDirectInvocation,
  workspaceIdForRoot,
  workspaceStatePath,
} from '../lib/machine-dev-paths.mjs';
import {
  loadPlanPackage,
  validateRepositoryPath,
} from './plan-package.mjs';
import {
  WorkspaceLifecycleLockError,
  withWorkspaceLifecycleLock,
} from '../local-dev/workspace-lifecycle-lock.mjs';

export const WORKSPACE_PLAN_BINDING_KIND =
  'peers-touch-workspace-plan-binding';
export const WORKSPACE_PLAN_BINDING_SCHEMA_VERSION = 2;

const LEGACY_BINDING_KEYS = new Set([
  'schemaVersion',
  'kind',
  'workspaceId',
  'canonicalRoot',
  'planId',
  'planPath',
  'boundAt',
  'boundBy',
]);
const BINDING_KEYS = new Set([
  ...LEGACY_BINDING_KEYS,
  'generation',
  'recordDigest',
]);
const BINDING_HISTORY_DIRECTORY = 'plan-binding-history';
const LIVE_DECLARATION_STATES = new Set([
  'DECLARED',
  'ACTIVE',
  'RELEASING',
]);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SHA256 = /^[0-9a-f]{64}$/;

export class WorkspacePlanBindingError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'WorkspacePlanBindingError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details) {
  throw new WorkspacePlanBindingError(code, message, details);
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

function digestRecord(record) {
  const unsigned = { ...record };
  delete unsigned.recordDigest;
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(unsigned)))
    .digest('hex');
}

export function digestWorkspacePlanBinding(record) {
  return digestRecord(record);
}

function requiredText(value, field, pattern = undefined) {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.includes('\0') ||
    value.includes('\n') ||
    (pattern && !pattern.test(value))
  ) {
    fail('WORKSPACE_PLAN_BINDING_INVALID', `${field} is invalid`, { field });
  }
  return value;
}

function requiredGeneration(value, field = 'generation') {
  const generation =
    typeof value === 'string' && /^[1-9][0-9]*$/.test(value)
      ? Number(value)
      : value;
  if (!Number.isSafeInteger(generation) || generation < 1) {
    fail('WORKSPACE_PLAN_BINDING_INVALID', `${field} is invalid`, { field });
  }
  return generation;
}

function operationDate(options = {}) {
  const value =
    typeof options.clock === 'function'
      ? options.clock()
      : options.now ?? new Date();
  const now = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(now.getTime())) {
    fail('WORKSPACE_PLAN_BINDING_INVALID', 'operation clock is invalid');
  }
  return now;
}

function canonicalWorkspace(root) {
  let canonicalRoot;
  try {
    canonicalRoot = realpathSync(root);
  } catch (error) {
    fail(
      'WORKTREE_IDENTITY_UNAVAILABLE',
      'workspace root cannot be resolved',
      { root, cause: String(error) },
    );
  }
  let gitRoot;
  try {
    gitRoot = realpathSync(
      execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: canonicalRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim(),
    );
  } catch (error) {
    fail(
      'WORKTREE_IDENTITY_UNAVAILABLE',
      'workspace is not a Git worktree',
      { root: canonicalRoot, cause: String(error) },
    );
  }
  if (gitRoot !== canonicalRoot) {
    fail(
      'WORKTREE_IDENTITY_MISMATCH',
      'workspace root is not the Git worktree root',
      { requested: canonicalRoot, actual: gitRoot },
    );
  }
  let branch;
  try {
    branch = execFileSync('git', ['branch', '--show-current'], {
      cwd: canonicalRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    fail(
      'WORKTREE_IDENTITY_UNAVAILABLE',
      'workspace branch cannot be resolved',
      { root: canonicalRoot, cause: String(error) },
    );
  }
  if (!branch) {
    fail(
      'WORKTREE_IDENTITY_UNAVAILABLE',
      'detached worktree cannot own a Plan binding',
    );
  }
  return {
    branch,
    canonicalRoot,
    workspaceId: workspaceIdForRoot(canonicalRoot),
  };
}

function canonicalTimestamp(value) {
  const parsed = Date.parse(value);
  return (
    typeof value === 'string' &&
    Number.isFinite(parsed) &&
    new Date(parsed).toISOString() === value
  );
}

function validateBinding(value, workspace) {
  const schemaKeys =
    value?.schemaVersion === 1
      ? LEGACY_BINDING_KEYS
      : value?.schemaVersion === WORKSPACE_PLAN_BINDING_SCHEMA_VERSION
        ? BINDING_KEYS
        : null;
  if (
    !isObject(value) ||
    schemaKeys === null ||
    !exactKeys(value, schemaKeys) ||
    value.kind !== WORKSPACE_PLAN_BINDING_KIND ||
    typeof value.workspaceId !== 'string' ||
    !/^[0-9a-f]{16}$/.test(value.workspaceId) ||
    typeof value.canonicalRoot !== 'string' ||
    !path.isAbsolute(value.canonicalRoot) ||
    typeof value.planId !== 'string' ||
    !IDENTIFIER.test(value.planId) ||
    typeof value.planPath !== 'string' ||
    !canonicalTimestamp(value.boundAt)
  ) {
    fail(
      'WORKSPACE_PLAN_BINDING_INVALID',
      'workspace Plan binding schema is invalid',
    );
  }
  if (
    value.schemaVersion === WORKSPACE_PLAN_BINDING_SCHEMA_VERSION &&
    (requiredGeneration(value.generation) !== value.generation ||
      typeof value.recordDigest !== 'string' ||
      !SHA256.test(value.recordDigest) ||
      digestWorkspacePlanBinding(value) !== value.recordDigest)
  ) {
    fail(
      'WORKSPACE_PLAN_BINDING_INVALID',
      'workspace Plan binding generation or digest is invalid',
    );
  }
  requiredText(value.boundBy, 'boundBy');
  try {
    validateRepositoryPath(value.planPath, 'planPath');
  } catch (error) {
    fail(
      'WORKSPACE_PLAN_BINDING_INVALID',
      'workspace Plan binding path is invalid',
      { cause: String(error) },
    );
  }
  if (
    value.workspaceId !== workspace.workspaceId ||
    value.canonicalRoot !== workspace.canonicalRoot
  ) {
    fail(
      'WORKSPACE_PLAN_BINDING_MISMATCH',
      'workspace Plan binding belongs to another worktree',
      {
        boundWorkspaceId: value.workspaceId,
        actualWorkspaceId: workspace.workspaceId,
      },
    );
  }
  return value;
}

function ownerControls(metadata) {
  const ownedByCurrentUser =
    typeof process.getuid !== 'function' || metadata.uid === process.getuid();
  const privateMode =
    process.platform === 'win32' || (metadata.mode & 0o077) === 0;
  return ownedByCurrentUser && privateMode;
}

function readOwnedRegularText(file, code, message) {
  let metadata;
  try {
    metadata = lstatSync(file);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    fail(code, message, { file, cause: String(error) });
  }
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    !ownerControls(metadata)
  ) {
    fail(code, message, { file });
  }
  return readFileSync(file, 'utf8');
}

function readBindingRecord(file, workspace) {
  const raw = readOwnedRegularText(
    file,
    'WORKSPACE_PLAN_BINDING_INVALID',
    'workspace Plan binding must be an owner-controlled regular file',
  );
  if (raw === null) return null;
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    fail(
      'WORKSPACE_PLAN_BINDING_INVALID',
      'workspace Plan binding is not valid JSON',
      { cause: String(error) },
    );
  }
  return validateBinding(value, workspace);
}

function normalizedBinding(binding) {
  if (binding.schemaVersion !== 1) return binding;
  return v2Binding(binding, { generation: 1 });
}

function v2Binding(binding, overrides = {}) {
  const record = {
    schemaVersion: WORKSPACE_PLAN_BINDING_SCHEMA_VERSION,
    kind: WORKSPACE_PLAN_BINDING_KIND,
    generation: binding.generation ?? 1,
    workspaceId: binding.workspaceId,
    canonicalRoot: binding.canonicalRoot,
    planId: binding.planId,
    planPath: binding.planPath,
    boundAt: binding.boundAt,
    boundBy: binding.boundBy,
    ...overrides,
  };
  record.recordDigest = digestWorkspacePlanBinding(record);
  return record;
}

function historyDirectory(bindingFile) {
  return path.join(path.dirname(bindingFile), BINDING_HISTORY_DIRECTORY);
}

function historyRecordPath(bindingFile, generation) {
  return path.join(
    historyDirectory(bindingFile),
    `generation-${String(generation).padStart(10, '0')}.json`,
  );
}

function assertOwnedDirectory(directory, code, message) {
  let metadata;
  try {
    metadata = lstatSync(directory);
  } catch (error) {
    fail(code, message, { directory, cause: String(error) });
  }
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    !ownerControls(metadata)
  ) {
    fail(code, message, { directory });
  }
}

function ensurePrivateDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  assertOwnedDirectory(
    directory,
    'WORKSPACE_PLAN_BINDING_INVALID',
    'workspace Plan binding directory must be owner-controlled',
  );
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

function publishImmutable(file, value) {
  const directory = path.dirname(file);
  ensurePrivateDirectory(directory);
  const temporary = path.join(
    directory,
    `.${path.basename(file)}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`,
  );
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    linkSync(temporary, file);
    syncDirectory(directory);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    return false;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  return true;
}

function writeAtomic(file, value) {
  const directory = path.dirname(file);
  ensurePrivateDirectory(directory);
  const temporary = path.join(
    directory,
    `.${path.basename(file)}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`,
  );
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
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

function readBindingHistory(bindingFile, workspace) {
  const directory = historyDirectory(bindingFile);
  if (!existsSync(directory)) return [];
  assertOwnedDirectory(
    directory,
    'WORKSPACE_PLAN_BINDING_HISTORY_INVALID',
    'workspace Plan binding history directory is invalid',
  );
  const entries = readdirSync(directory, { withFileTypes: true });
  if (
    entries.some(
      (entry) => {
        const match = /^generation-([0-9]{10})\.json$/.exec(entry.name);
        return (
          !entry.isFile() ||
          entry.isSymbolicLink() ||
          match === null ||
          Number(match[1]) < 1
        );
      },
    )
  ) {
    fail(
      'WORKSPACE_PLAN_BINDING_HISTORY_INVALID',
      'workspace Plan binding history is not a closed generation sequence',
    );
  }
  const history = [];
  for (let generation = 1; generation <= entries.length; generation += 1) {
    const record = readBindingRecord(
      historyRecordPath(bindingFile, generation),
      workspace,
    );
    if (
      record === null ||
      record.schemaVersion !== WORKSPACE_PLAN_BINDING_SCHEMA_VERSION ||
      record.generation !== generation
    ) {
      fail(
        'WORKSPACE_PLAN_BINDING_HISTORY_INVALID',
        'workspace Plan binding history generation is invalid',
        { generation },
      );
    }
    history.push(record);
  }
  return history;
}

function sameBinding(left, right) {
  return (
    JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right))
  );
}

function validateBindingHistory(bindingFile, current, workspace) {
  if (current.schemaVersion === 1) return [];
  const history = readBindingHistory(bindingFile, workspace);
  if (history.length !== current.generation) {
    fail(
      'WORKSPACE_PLAN_BINDING_HISTORY_INVALID',
      'workspace Plan binding history is not a closed generation sequence',
      {
        pointerGeneration: current.generation,
        historyGenerations: history.length,
      },
    );
  }
  if (
    !sameBinding(history.at(-1), current)
  ) {
    fail(
      'WORKSPACE_PLAN_BINDING_HISTORY_INVALID',
      'current workspace Plan binding does not match its history',
      { generation: current.generation },
    );
  }
  return history;
}

function readBindingFile(file, workspace, options = {}) {
  const binding = readBindingRecord(file, workspace);
  if (binding === null) {
    fail(
      'WORKSPACE_PLAN_BINDING_REQUIRED',
      'workspace has no immutable Plan binding',
      { workspaceId: workspace.workspaceId },
    );
  }
  if (options.validateHistory !== false) {
    validateBindingHistory(file, binding, workspace);
  }
  return binding;
}

function ensureHistoryRecord(bindingFile, record, workspace) {
  const file = historyRecordPath(bindingFile, record.generation);
  if (!publishImmutable(file, record)) {
    const existing = readBindingRecord(file, workspace);
    if (
      existing === null ||
      JSON.stringify(canonicalize(existing)) !==
        JSON.stringify(canonicalize(record))
    ) {
      fail(
        'WORKSPACE_PLAN_BINDING_HISTORY_INVALID',
        'immutable workspace Plan binding history conflicts',
        { generation: record.generation },
      );
    }
  }
  return file;
}

export function workspacePlanBindingPath(options = {}) {
  return path.join(
    workspaceStatePath({
      home: options.home,
      repoRoot: options.repoRoot,
      workspaceId: options.workspaceId,
    }),
    'workflow',
    'plan-binding.json',
  );
}

export function workspacePlanBindingHistoryPath(options = {}) {
  const bindingFile = workspacePlanBindingPath(options);
  return historyRecordPath(
    bindingFile,
    requiredGeneration(options.generation),
  );
}

async function loadBoundPlan(workspace, binding) {
  const absolutePlan = path.resolve(
    workspace.canonicalRoot,
    ...binding.planPath.split('/'),
  );
  let planPackage;
  try {
    planPackage = await loadPlanPackage(absolutePlan, {
      repoRoot: workspace.canonicalRoot,
    });
  } catch (error) {
    fail(
      'WORKSPACE_BOUND_PLAN_UNAVAILABLE',
      'bound Plan Package is unavailable or invalid',
      {
        planId: binding.planId,
        planPath: binding.planPath,
        cause: error?.message ?? String(error),
      },
    );
  }
  const actualPlanPath = path
    .relative(workspace.canonicalRoot, planPackage.path)
    .split(path.sep)
    .join('/');
  const mismatches = {};
  for (const [field, expected, actual] of [
    ['planId', binding.planId, planPackage.manifest.planId],
    ['planPath', binding.planPath, actualPlanPath],
    [
      'workspaceId',
      workspace.workspaceId,
      planPackage.manifest.binding.workspaceId,
    ],
    ['branch', workspace.branch, planPackage.manifest.binding.branch],
  ]) {
    if (expected !== actual) mismatches[field] = { expected, actual };
  }
  if (Object.keys(mismatches).length > 0) {
    fail(
      'WORKSPACE_PLAN_BINDING_MISMATCH',
      'bound Plan Package identity does not match the workspace binding',
      { mismatches },
    );
  }
  return planPackage;
}

async function loadRequestedPlan(workspace, requestedPlan) {
  const absolutePlan = path.isAbsolute(requestedPlan)
    ? requestedPlan
    : path.resolve(workspace.canonicalRoot, requestedPlan);
  let planPackage;
  try {
    planPackage = await loadPlanPackage(absolutePlan, {
      repoRoot: workspace.canonicalRoot,
    });
  } catch (error) {
    fail(
      'WORKSPACE_BOUND_PLAN_UNAVAILABLE',
      'requested Plan Package is unavailable or invalid',
      { cause: error?.message ?? String(error) },
    );
  }
  const planPath = path
    .relative(workspace.canonicalRoot, planPackage.path)
    .split(path.sep)
    .join('/');
  const mismatches = {};
  for (const [field, expected, actual] of [
    [
      'workspaceId',
      workspace.workspaceId,
      planPackage.manifest.binding.workspaceId,
    ],
    ['branch', workspace.branch, planPackage.manifest.binding.branch],
  ]) {
    if (expected !== actual) mismatches[field] = { expected, actual };
  }
  if (Object.keys(mismatches).length > 0) {
    fail(
      'WORKSPACE_PLAN_BINDING_MISMATCH',
      'requested Plan Package belongs to another workspace',
      { mismatches },
    );
  }
  return { planPackage, planPath };
}

function assertSameTupleOrReject(current, requested) {
  if (
    current.planId === requested.planId &&
    current.planPath === requested.planPath
  ) {
    return;
  }
  fail(
    'WORKSPACE_PLAN_REBIND_DENIED',
    'workspace Plan binding can change only through explicit generation advance',
    {
      current: {
        generation: current.generation,
        planId: current.planId,
        planPath: current.planPath,
      },
      requested: {
        planId: requested.planId,
        planPath: requested.planPath,
      },
    },
  );
}

async function loadQuiescenceReaders() {
  const [ledgerModule, activeWorkModule, leaseModule] = await Promise.all([
    import('../local-dev/dev-work-ledger.mjs'),
    import('../local-dev/active-work-store.mjs'),
    import('../local-dev/machine-dev-registry.mjs'),
  ]);
  return {
    readLedger: ledgerModule.readLedger,
    readActiveWorkRecord: activeWorkModule.readActiveWorkRecord,
    observeLeases: leaseModule.observeLeases,
  };
}

function readResourceState(source, operation) {
  try {
    return operation();
  } catch (error) {
    fail(
      'WORKSPACE_PLAN_ADVANCE_RESOURCE_STATE_INVALID',
      `cannot verify ${source} before Plan generation advance`,
      {
        source,
        causeCode: error?.code ?? null,
        cause: error?.message ?? String(error),
      },
    );
  }
}

function assertWorkspaceQuiescent(workspace, options, readers, now) {
  const ledger = readResourceState('Development declarations', () =>
    readers.readLedger(
      options.ledgerPath ?? developmentWorkLedgerPath(options.home),
      now,
    ),
  );
  const liveDeclarations = Object.values(ledger.declarations).filter(
    (declaration) =>
      declaration.workspaceId === workspace.workspaceId &&
      LIVE_DECLARATION_STATES.has(declaration.state) &&
      Date.parse(declaration.expiresAt) > now.getTime(),
  );
  if (liveDeclarations.length > 0) {
    fail(
      'WORKSPACE_PLAN_ADVANCE_RESOURCES_LIVE',
      'workspace still has live Development declarations',
      {
        declarations: liveDeclarations.map((declaration) => ({
          declarationId: declaration.declarationId,
          state: declaration.state,
        })),
      },
    );
  }

  const activeWork = readResourceState('workspace active-work', () =>
    readers.readActiveWorkRecord({
      home: options.home,
      workspaceRoot: workspace.canonicalRoot,
      workspaceId: workspace.workspaceId,
      ...(options.activeWorkPath === undefined
        ? {}
        : { recordPath: options.activeWorkPath }),
    }),
  );
  if (activeWork !== null) {
    fail(
      'WORKSPACE_PLAN_ADVANCE_RESOURCES_LIVE',
      'workspace still has active-work',
      {
        activeWork: {
          workItemId: activeWork.workItemId,
          planId: activeWork.planId,
          revision: activeWork.revision,
        },
      },
    );
  }

  const leaseObservation = readResourceState('OS-held leases', () =>
    readers.observeLeases({
      home: options.home,
      ...(options.leaseRoot === undefined
        ? {}
        : { leaseRoot: options.leaseRoot }),
      ...(options.python === undefined ? {} : { python: options.python }),
    }),
  );
  const activeLeases = leaseObservation.activeLeases.filter(
    (lease) => lease.workspaceId === workspace.workspaceId,
  );
  if (activeLeases.length > 0) {
    fail(
      'WORKSPACE_PLAN_ADVANCE_RESOURCES_LIVE',
      'workspace still holds OS leases',
      {
        activeLeases: activeLeases.map((lease) => ({
          leaseId: lease.leaseId,
          resourceKind: lease.resourceKind,
          resourceId: lease.resourceId,
        })),
      },
    );
  }
}

async function invokeBindingFailpoint(options, name, detail = {}) {
  if (typeof options.failpoint === 'function') {
    await options.failpoint(name, detail);
  }
}

async function withBindingLifecycle(workspace, options, operation) {
  try {
    return await withWorkspaceLifecycleLock(
      {
        home: options.home,
        workspaceRoot: workspace.canonicalRoot,
        workspaceId: workspace.workspaceId,
        lifecycleLease: options.lifecycleLease,
        lockTimeoutMs:
          options.lifecycleLockTimeoutMs ?? options.lockTimeoutMs,
        lifecycleFailpoint: options.lifecycleFailpoint,
      },
      operation,
    );
  } catch (error) {
    if (error instanceof WorkspaceLifecycleLockError) {
      fail(error.code, error.message, error.detail);
    }
    throw error;
  }
}

function inspectAdvanceHistory(bindingFile, stored, workspace) {
  const current = normalizedBinding(stored);
  const history = readBindingHistory(bindingFile, workspace);
  if (history.length > current.generation + 1) {
    fail(
      'WORKSPACE_PLAN_BINDING_HISTORY_INVALID',
      'workspace Plan binding history is ahead by more than one generation',
      {
        pointerGeneration: current.generation,
        historyGenerations: history.length,
      },
    );
  }
  if (
    history.length >= current.generation &&
    !sameBinding(history[current.generation - 1], current)
  ) {
    fail(
      'WORKSPACE_PLAN_BINDING_HISTORY_INVALID',
      'current workspace Plan binding does not match its history',
      { generation: current.generation },
    );
  }
  if (
    stored.schemaVersion === WORKSPACE_PLAN_BINDING_SCHEMA_VERSION &&
    history.length < current.generation - 1
  ) {
    fail(
      'WORKSPACE_PLAN_BINDING_HISTORY_INVALID',
      'workspace Plan binding history is missing committed generations',
      {
        pointerGeneration: current.generation,
        historyGenerations: history.length,
      },
    );
  }
  return { current, history };
}

function assertRequestedTuple(binding, requestedPackage, planPath) {
  if (
    binding.planId !== requestedPackage.manifest.planId ||
    binding.planPath !== planPath
  ) {
    fail(
      'WORKSPACE_PLAN_GENERATION_MISMATCH',
      'workspace Plan generation does not match the requested next Plan',
      {
        current: {
          generation: binding.generation,
          planId: binding.planId,
          planPath: binding.planPath,
        },
        requested: {
          planId: requestedPackage.manifest.planId,
          planPath,
        },
      },
    );
  }
}

export async function resolveWorkspacePlanBinding(options = {}) {
  const workspace = canonicalWorkspace(options.repoRoot ?? process.cwd());
  const file = workspacePlanBindingPath({
    home: options.home,
    repoRoot: workspace.canonicalRoot,
  });
  const binding = readBindingFile(file, workspace);
  const planPackage = await loadBoundPlan(workspace, binding);
  return {
    ...normalizedBinding(binding),
    bindingFile: file,
    planStatus: planPackage.manifest.status,
    branch: planPackage.manifest.binding.branch,
  };
}

export async function bindWorkspacePlan(options = {}) {
  const workspace = canonicalWorkspace(options.repoRoot ?? process.cwd());
  const owner = requiredText(options.owner, 'owner');
  const requestedPlan = requiredText(options.plan, 'plan');
  const now = operationDate(options);
  const file = workspacePlanBindingPath({
    home: options.home,
    repoRoot: workspace.canonicalRoot,
  });
  return withBindingLifecycle(workspace, options, async () => {
    const { planPackage, planPath } = await loadRequestedPlan(
      workspace,
      requestedPlan,
    );
    const binding = v2Binding({
      generation: 1,
      workspaceId: workspace.workspaceId,
      canonicalRoot: workspace.canonicalRoot,
      planId: planPackage.manifest.planId,
      planPath,
      boundAt: now.toISOString(),
      boundBy: owner,
    });
    if (existsSync(file)) {
      const current = readBindingFile(file, workspace, {
        validateHistory: false,
      });
      const normalized = normalizedBinding(current);
      assertSameTupleOrReject(normalized, binding);
      await loadBoundPlan(workspace, current);
      const history = readBindingHistory(file, workspace);
      if (
        history.length > normalized.generation ||
        (history.length === normalized.generation &&
          !sameBinding(history.at(-1), normalized))
      ) {
        fail(
          'WORKSPACE_PLAN_BINDING_HISTORY_INVALID',
          'workspace Plan binding history conflicts with the current pointer',
        );
      }
      ensureHistoryRecord(file, normalized, workspace);
      validateBindingHistory(file, normalized, workspace);
      return { ...normalized, bindingFile: file, created: false };
    }
    await loadBoundPlan(workspace, binding);
    ensureHistoryRecord(file, binding, workspace);
    if (!publishImmutable(file, binding)) {
      const current = readBindingFile(file, workspace);
      const normalized = normalizedBinding(current);
      assertSameTupleOrReject(normalized, binding);
      return { ...normalized, bindingFile: file, created: false };
    }
    const readback = readBindingFile(file, workspace);
    return { ...readback, bindingFile: file, created: true };
  });
}

export async function advanceWorkspacePlan(options = {}) {
  const workspace = canonicalWorkspace(options.repoRoot ?? process.cwd());
  const owner = requiredText(options.owner, 'owner');
  const expectedGeneration = requiredGeneration(
    options.expectedGeneration,
    'expectedGeneration',
  );
  const requestedPlan = requiredText(options.plan, 'plan');
  const readers = await loadQuiescenceReaders();
  const now = operationDate(options);
  const file = workspacePlanBindingPath({
    home: options.home,
    repoRoot: workspace.canonicalRoot,
  });
  return withBindingLifecycle(workspace, options, async () => {
    const { planPackage: requestedPackage, planPath } = await loadRequestedPlan(
      workspace,
      requestedPlan,
    );
    const stored = readBindingFile(file, workspace, {
      validateHistory: false,
    });
    const { current, history } = inspectAdvanceHistory(
      file,
      stored,
      workspace,
    );

    if (current.generation === expectedGeneration + 1) {
      assertRequestedTuple(current, requestedPackage, planPath);
      if (
        history.length === current.generation &&
        sameBinding(history.at(-1), current)
      ) {
        fail(
          'WORKSPACE_PLAN_GENERATION_MISMATCH',
          'workspace Plan binding generation changed',
          { expected: expectedGeneration, actual: current.generation },
        );
      }
      if (history.length !== expectedGeneration) {
        fail(
          'WORKSPACE_PLAN_BINDING_HISTORY_INVALID',
          'interrupted generation pointer has an invalid history boundary',
          {
            pointerGeneration: current.generation,
            historyGenerations: history.length,
          },
        );
      }
      const previous = history.at(-1);
      if (previous === undefined) {
        fail(
          'WORKSPACE_PLAN_BINDING_HISTORY_INVALID',
          'interrupted generation pointer has no previous generation',
        );
      }
      const previousPackage = await loadBoundPlan(workspace, previous);
      if (previousPackage.manifest.status !== 'completed') {
        fail(
          'WORKSPACE_PLAN_ADVANCE_NOT_COMPLETED',
          'previous Plan must remain completed during generation recovery',
          { planStatus: previousPackage.manifest.status },
        );
      }
      assertWorkspaceQuiescent(workspace, options, readers, now);
      ensureHistoryRecord(file, current, workspace);
      const recovered = readBindingFile(file, workspace);
      return {
        ...recovered,
        bindingFile: file,
        previousGeneration: expectedGeneration,
        advanced: true,
        recovered: true,
      };
    }

    if (current.generation !== expectedGeneration) {
      fail(
        'WORKSPACE_PLAN_GENERATION_MISMATCH',
        'workspace Plan binding generation changed',
        { expected: expectedGeneration, actual: current.generation },
      );
    }
    if (
      history.length < current.generation - (stored.schemaVersion === 1 ? 1 : 0) ||
      history.length > current.generation + 1
    ) {
      fail(
        'WORKSPACE_PLAN_BINDING_HISTORY_INVALID',
        'workspace Plan binding history cannot be advanced',
        {
          pointerGeneration: current.generation,
          historyGenerations: history.length,
        },
      );
    }
    const currentPackage = await loadBoundPlan(workspace, current);
    if (currentPackage.manifest.status !== 'completed') {
      fail(
        'WORKSPACE_PLAN_ADVANCE_NOT_COMPLETED',
        'current Plan must be completed before generation advance',
        {
          generation: current.generation,
          planId: current.planId,
          planStatus: currentPackage.manifest.status,
        },
      );
    }
    if (
      current.planId === requestedPackage.manifest.planId &&
      current.planPath === planPath
    ) {
      fail(
        'WORKSPACE_PLAN_ADVANCE_INVALID',
        'next Plan generation must bind a different Plan tuple',
      );
    }
    assertWorkspaceQuiescent(workspace, options, readers, now);
    const nextGeneration = current.generation + 1;
    if (!Number.isSafeInteger(nextGeneration)) {
      fail(
        'WORKSPACE_PLAN_BINDING_INVALID',
        'workspace Plan binding generation overflow',
      );
    }
    const currentHistory = v2Binding(current);
    const orphanNext =
      history.length === nextGeneration ? history.at(-1) : null;
    if (orphanNext !== null) {
      assertRequestedTuple(orphanNext, requestedPackage, planPath);
    }
    const next =
      orphanNext ??
      v2Binding({
        generation: nextGeneration,
        workspaceId: workspace.workspaceId,
        canonicalRoot: workspace.canonicalRoot,
        planId: requestedPackage.manifest.planId,
        planPath,
        boundAt: now.toISOString(),
        boundBy: owner,
      });
    await loadBoundPlan(workspace, next);
    ensureHistoryRecord(file, currentHistory, workspace);

    const currentBeforeSwitch = await loadBoundPlan(workspace, current);
    if (currentBeforeSwitch.manifest.status !== 'completed') {
      fail(
        'WORKSPACE_PLAN_ADVANCE_NOT_COMPLETED',
        'current Plan changed before atomic generation switch',
        { planStatus: currentBeforeSwitch.manifest.status },
      );
    }
    assertWorkspaceQuiescent(workspace, options, readers, now);
    const beforeSwitch = normalizedBinding(
      readBindingFile(file, workspace, { validateHistory: false }),
    );
    if (
      beforeSwitch.generation !== expectedGeneration ||
      beforeSwitch.planId !== current.planId ||
      beforeSwitch.planPath !== current.planPath ||
      (stored.schemaVersion === WORKSPACE_PLAN_BINDING_SCHEMA_VERSION &&
        beforeSwitch.recordDigest !== stored.recordDigest)
    ) {
      fail(
        'WORKSPACE_PLAN_GENERATION_MISMATCH',
        'workspace Plan binding changed before atomic generation switch',
        { expected: expectedGeneration, actual: beforeSwitch.generation },
      );
    }
    await invokeBindingFailpoint(options, 'before-generation-pointer-publish', {
      current,
      next,
    });
    writeAtomic(file, next);
    await invokeBindingFailpoint(options, 'after-generation-pointer-published', {
      current,
      next,
    });
    ensureHistoryRecord(file, next, workspace);
    const readback = readBindingFile(file, workspace);
    return {
      ...readback,
      bindingFile: file,
      previousGeneration: current.generation,
      advanced: true,
      recovered: orphanNext !== null,
    };
  });
}

function parseArguments(argv) {
  const [action, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    const value = rest[index + 1];
    if (!token.startsWith('--') || value === undefined || value.startsWith('--')) {
      fail('WORKSPACE_PLAN_BINDING_USAGE', `invalid option: ${token}`);
    }
    const key = token.slice(2);
    if (
      ![
        'repo-root',
        'home',
        'plan',
        'owner',
        'expected-generation',
      ].includes(key)
    ) {
      fail('WORKSPACE_PLAN_BINDING_USAGE', `unsupported option: ${token}`);
    }
    options[
      {
        'repo-root': 'repoRoot',
        home: 'home',
        plan: 'plan',
        owner: 'owner',
        'expected-generation': 'expectedGeneration',
      }[key]
    ] = value;
    index += 1;
  }
  return { action, options };
}

function output(value, stream = process.stdout) {
  stream.write(`${JSON.stringify({ ok: true, binding: value }, null, 2)}\n`);
}

export async function runCli(argv) {
  const { action, options } = parseArguments(argv);
  if (action === 'bind') {
    output(await bindWorkspacePlan(options));
    return;
  }
  if (action === 'resolve') {
    output(await resolveWorkspacePlanBinding(options));
    return;
  }
  if (action === 'advance') {
    output(await advanceWorkspacePlan(options));
    return;
  }
  fail(
    'WORKSPACE_PLAN_BINDING_USAGE',
    'action must be bind, resolve, or advance',
  );
}

if (isDirectInvocation(import.meta.url)) {
  runCli(process.argv.slice(2)).catch((error) => {
    const payload =
      error instanceof WorkspacePlanBindingError
        ? {
            ok: false,
            error: {
              code: error.code,
              message: error.message,
              ...(error.details === undefined
                ? {}
                : { details: error.details }),
            },
          }
        : {
            ok: false,
            error: {
              code: 'WORKSPACE_PLAN_BINDING_INTERNAL_ERROR',
              message: String(error),
            },
          };
    process.stderr.write(`${JSON.stringify(payload)}\n`);
    process.exitCode = 2;
  });
}
