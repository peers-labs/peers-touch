import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import {
  PlanPackageError,
  assertAtomicRenameSupport,
  assertRepositoryPathContained,
  atomicExchangeFiles,
  atomicMoveFileNoReplace,
  atomicReplaceFile,
  discoverPlanPackages,
  loadPlanPackage,
  validateRepositoryPath,
} from './plan-package.mjs';

const MIGRATION_PHASES = new Set([
  'PREPARED',
  'LOCKED',
  'APPLYING',
  'VERIFYING',
  'COMMITTED',
  'ROLLING_BACK',
  'ROLLED_BACK',
]);
const LOCKED_PHASES = new Set(['LOCKED', 'APPLYING', 'VERIFYING', 'ROLLING_BACK']);
const LIVE_PLAN_STATUSES = new Set(['active', 'blocked']);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SHA1_PATTERN = /^[0-9a-f]{40}$/;
const WORKSPACE_ID_PATTERN = /^[0-9a-f]{16}$/;
const WORKSPACE_DIGEST_PATTERN = /^(?:clean|sha256:[0-9a-f]{64})$/;
const ACTIVE_LOCK_OWNER_TOKENS = new Set();
const FILE_OPERATION_KINDS = new Set(['exchange', 'move-no-replace']);
const FILE_OPERATION_PURPOSES = new Set([
  'apply-replacement',
  'rollback-replacement',
  'remove-legacy',
  'restore-legacy',
]);
const CLEANUP_MODES = new Set(['commit', 'rollback']);
const CLEANUP_STATES = new Set([
  'CAPTURING',
  'CAPTURED',
  'RESTORING',
  'VALIDATED',
  'DONE',
]);
const CLEANUP_CAPTURE_STATES = new Set([
  'pending',
  'absent',
  'captured',
  'restored',
  'deleted',
]);
const CLEANUP_CAPTURE_PRESENCES = new Set([
  'required',
  'optional',
  'absent',
]);
const NON_LIVE_DIRECTORY_NAMES = new Set([
  '.git',
  '.machine',
  '.tmp',
  'archive',
  'dist',
  'node_modules',
  'target',
  'tmp',
]);

export class PlanMigrationError extends PlanPackageError {
  constructor(code, message, details = undefined) {
    super(code, message, details);
    this.name = 'PlanMigrationError';
  }
}

function fail(code, message, details) {
  throw new PlanMigrationError(code, message, details);
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function assertClosedObject(value, keys, context) {
  if (!isPlainObject(value)) {
    fail('PLAN_MIGRATION_JOURNAL_INVALID', `${context} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fail('PLAN_MIGRATION_JOURNAL_INVALID', `${context} has unknown or missing fields`, {
      actual,
      expected,
    });
  }
}

function assertString(value, context, pattern = undefined) {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    (pattern && !pattern.test(value))
  ) {
    fail('PLAN_MIGRATION_JOURNAL_INVALID', `${context} must be a valid non-empty string`);
  }
}

function assertTimestamp(value, context) {
  assertString(value, context);
  if (Number.isNaN(Date.parse(value))) {
    fail('PLAN_MIGRATION_JOURNAL_INVALID', `${context} must be an ISO-compatible timestamp`);
  }
}

function relativeToNative(repoRoot, relativePath) {
  return path.resolve(repoRoot, ...relativePath.split('/'));
}

async function exists(candidate) {
  try {
    await fsp.lstat(candidate);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw error;
  }
}

async function fsyncDirectory(directory) {
  try {
    const handle = await fsp.open(directory, fs.constants.O_RDONLY);
    await handle.sync();
    await handle.close();
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EISDIR'].includes(error.code)) throw error;
  }
}

async function atomicWrite(
  candidate,
  content,
  {
    mode = 0o600,
    expectedContent = undefined,
    expectedAbsent = false,
    beforeAtomicCommit = undefined,
  } = {},
) {
  const absolute = path.resolve(candidate);
  const directory = path.dirname(absolute);
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
  if (await exists(absolute)) {
    if (expectedAbsent) {
      fail(
        'PLAN_CONCURRENT_MODIFICATION',
        'File appeared before atomic creation',
        { path: absolute },
      );
    }
    await atomicReplaceFile(absolute, content, {
      expectedContent,
      beforeAtomicCommit,
    });
    return;
  }
  if (expectedContent !== undefined) {
    fail(
      'PLAN_CONCURRENT_MODIFICATION',
      'File disappeared before atomic replacement',
      { path: absolute },
    );
  }

  const temporary = path.join(
    directory,
    `.${path.basename(absolute)}.${process.pid}.${Date.now()}.${Math.random()
      .toString(16)
      .slice(2)}.tmp`,
  );
  let handle;
  try {
    handle = await fsp.open(temporary, 'wx', mode);
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    handle = null;
    try {
      await fsp.link(temporary, absolute);
    } catch (error) {
      if (error.code === 'EEXIST') {
        fail(
          'PLAN_CONCURRENT_MODIFICATION',
          'File appeared before atomic creation',
          { path: absolute },
        );
      }
      throw error;
    }
    await fsp.unlink(temporary);
    await fsyncDirectory(directory);
  } finally {
    if (handle) await handle.close();
    await fsp.rm(temporary, { force: true });
  }
}

function timestamp(clock) {
  const value = clock ? clock() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    fail('PLAN_MIGRATION_INVALID', 'Injected migration clock returned an invalid value');
  }
  return date.toISOString();
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function sha256File(candidate) {
  return sha256(await fsp.readFile(candidate));
}

function commandJson(command, args, cwd, code, description) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    fail(code, `${description} failed`, {
      status: result.status,
      stderr: result.stderr?.trim() || null,
    });
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    fail(code, `${description} returned invalid JSON`, {
      cause: error.message,
    });
  }
}

function defaultVerifyBinding(repoRoot, binding) {
  return commandJson(
    'python3',
    [
      path.join(repoRoot, 'tooling/scripts/verify-worktree-binding.py'),
      '--root',
      repoRoot,
      '--branch',
      binding.branch,
      '--workspace-id',
      binding.workspaceId,
      '--head',
      binding.expectedHead,
    ],
    repoRoot,
    'WORKTREE_IDENTITY_MISMATCH',
    'Worktree binding verification',
  );
}

function defaultCaptureSourceIdentity(repoRoot) {
  return commandJson(
    'python3',
    [
      '-c',
      [
        'import json, sys',
        'from pathlib import Path',
        'from tooling.acceptance.core import source_identity',
        'print(json.dumps(source_identity(Path(sys.argv[1])), sort_keys=True))',
      ].join('; '),
      repoRoot,
    ],
    repoRoot,
    'PLAN_MIGRATION_SOURCE_IDENTITY_UNAVAILABLE',
    'Source identity capture',
  );
}

async function assertMigrationIdentity(
  repoRoot,
  journal,
  options,
  { verifySourceDigest = false } = {},
) {
  const verifyBinding = options.verifyBinding ?? defaultVerifyBinding;
  const verified = await verifyBinding(repoRoot, journal.binding);
  const mismatches = {};
  for (const [field, expected, actual] of [
    ['branch', journal.binding.branch, verified?.branch],
    ['workspaceId', journal.binding.workspaceId, verified?.workspaceId],
    ['expectedHead', journal.binding.expectedHead, verified?.head],
  ]) {
    if (expected !== actual) mismatches[field] = { expected, actual };
  }
  if (Object.keys(mismatches).length > 0) {
    fail(
      'WORKTREE_IDENTITY_MISMATCH',
      'Actual worktree identity does not match the reviewed migration binding',
      { mismatches },
    );
  }
  if (!verifySourceDigest) return;

  const captureSourceIdentity =
    options.captureSourceIdentity ?? defaultCaptureSourceIdentity;
  const actualSource = await captureSourceIdentity(repoRoot);
  validateSourceIdentity(actualSource);
  if (
    actualSource.commit !== journal.sourceIdentity.commit ||
    actualSource.workspaceDigest !== journal.sourceIdentity.workspaceDigest ||
    actualSource.canonicalWorktreeHash !==
      journal.sourceIdentity.canonicalWorktreeHash
  ) {
    fail(
      'PLAN_MIGRATION_SOURCE_DRIFT',
      'Current source identity does not match the reviewed formal Gate source',
      {
        expected: journal.sourceIdentity,
        actual: actualSource,
      },
    );
  }
}

function reviewedJournalPath(journalPath) {
  return `${path.resolve(journalPath)}.reviewed`;
}

function reviewedJournalProjection(journal) {
  const projection = structuredClone(journal);
  projection.phase = 'PREPARED';
  projection.pendingOperation = null;
  projection.cleanup = null;
  projection.updatedAt = projection.createdAt;
  projection.activeWorkProjection.applied = false;
  for (const replacement of projection.replacements) {
    replacement.applied = false;
  }
  return projection;
}

function requireReviewedJournalDigest(options) {
  if (
    typeof options.reviewedJournalDigest !== 'string' ||
    !SHA256_PATTERN.test(options.reviewedJournalDigest)
  ) {
    fail(
      'PLAN_MIGRATION_REVIEW_REQUIRED',
      'Commit and recovery require the independently reviewed PREPARED journal SHA-256',
    );
  }
  return options.reviewedJournalDigest;
}

async function verifyPreparedJournalReview(options, journal) {
  const expectedDigest = requireReviewedJournalDigest(options);
  const bytes = await fsp.readFile(options.journalPath);
  const actualDigest = sha256(bytes);
  if (actualDigest !== expectedDigest || journal.phase !== 'PREPARED') {
    fail(
      'PLAN_MIGRATION_REVIEW_MISMATCH',
      'Current PREPARED journal does not match the independently reviewed digest',
      {
        expected: expectedDigest,
        actual: actualDigest,
        phase: journal.phase,
      },
    );
  }
  return bytes;
}

async function preserveReviewedJournal(options, reviewedBytes) {
  const snapshotPath = reviewedJournalPath(options.journalPath);
  if (await exists(snapshotPath)) {
    if ((await sha256File(snapshotPath)) !== requireReviewedJournalDigest(options)) {
      fail(
        'PLAN_MIGRATION_REVIEW_MISMATCH',
        'Reviewed journal snapshot does not match the approved digest',
        { snapshotPath },
      );
    }
    return;
  }
  await atomicWrite(snapshotPath, reviewedBytes);
}

async function verifyReviewedJournalLineage(options, journal) {
  const expectedDigest = requireReviewedJournalDigest(options);
  const snapshotPath = reviewedJournalPath(options.journalPath);
  if (!(await exists(snapshotPath))) {
    fail(
      'PLAN_MIGRATION_REVIEW_REQUIRED',
      'Reviewed journal snapshot is absent',
      { snapshotPath },
    );
  }
  const snapshotBytes = await fsp.readFile(snapshotPath);
  const actualDigest = sha256(snapshotBytes);
  if (actualDigest !== expectedDigest) {
    fail(
      'PLAN_MIGRATION_REVIEW_MISMATCH',
      'Reviewed journal snapshot digest does not match the approved digest',
      { expected: expectedDigest, actual: actualDigest },
    );
  }
  let reviewed;
  try {
    reviewed = validatePlanMigrationJournal(
      normalizeLegacyJournalBinding(JSON.parse(snapshotBytes.toString('utf8'))),
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      fail(
        'PLAN_MIGRATION_REVIEW_MISMATCH',
        'Reviewed journal snapshot is not valid JSON',
      );
    }
    throw error;
  }
  if (
    reviewed.phase !== 'PREPARED' ||
    JSON.stringify(reviewedJournalProjection(reviewed)) !==
      JSON.stringify(reviewedJournalProjection(journal))
  ) {
    fail(
      'PLAN_MIGRATION_REVIEW_MISMATCH',
      'Migration journal no longer derives from the reviewed PREPARED journal',
    );
  }
}

export function getPlanMigrationPaths(machineRoot, workspaceId) {
  assertString(machineRoot, 'machineRoot');
  assertString(workspaceId, 'workspaceId', ID_PATTERN);
  const directory = path.join(
    path.resolve(machineRoot),
    'workspaces',
    workspaceId,
    'workflow',
    'plan-migration',
  );
  return {
    directory,
    journalPath: path.join(directory, 'migration.json'),
    lockPath: path.join(directory, 'migration.lock'),
    reviewedJournalPath: path.join(directory, 'migration.json.reviewed'),
  };
}

export function planMigrationReadOptions(paths) {
  return {
    migrationJournalPath: paths.journalPath,
    migrationLockPath: paths.lockPath,
  };
}

function validateReplacement(replacement, context) {
  assertClosedObject(
    replacement,
    ['path', 'preparedPath', 'backupPath', 'beforeSha256', 'afterSha256', 'applied'],
    context,
  );
  validateRepositoryPath(replacement.path, `${context}.path`);
  validateRepositoryPath(replacement.preparedPath, `${context}.preparedPath`);
  validateRepositoryPath(replacement.backupPath, `${context}.backupPath`);
  if (replacement.beforeSha256 !== null) {
    assertString(replacement.beforeSha256, `${context}.beforeSha256`, SHA256_PATTERN);
  }
  assertString(replacement.afterSha256, `${context}.afterSha256`, SHA256_PATTERN);
  if (typeof replacement.applied !== 'boolean') {
    fail('PLAN_MIGRATION_JOURNAL_INVALID', `${context}.applied must be boolean`);
  }
  if (
    replacement.path === replacement.preparedPath ||
    replacement.path === replacement.backupPath ||
    replacement.preparedPath === replacement.backupPath
  ) {
    fail('PLAN_MIGRATION_JOURNAL_INVALID', `${context} paths must be distinct`);
  }
}

function validateFileIdentity(identity, context) {
  assertClosedObject(identity, ['device', 'inode'], context);
  assertString(identity.device, `${context}.device`, /^\d+$/);
  assertString(identity.inode, `${context}.inode`, /^\d+$/);
}

function validateFileVersion(version, context) {
  assertClosedObject(version, ['size', 'mtimeNs', 'ctimeNs'], context);
  assertString(version.size, `${context}.size`, /^\d+$/);
  assertString(version.mtimeNs, `${context}.mtimeNs`, /^\d+$/);
  assertString(version.ctimeNs, `${context}.ctimeNs`, /^\d+$/);
}

function validateFileSnapshot(snapshot, context) {
  assertClosedObject(snapshot, ['sha256', 'identity', 'version'], context);
  assertString(snapshot.sha256, `${context}.sha256`, SHA256_PATTERN);
  validateFileIdentity(snapshot.identity, `${context}.identity`);
  validateFileVersion(snapshot.version, `${context}.version`);
}

function validatePendingOperation(operation, replacementCount) {
  if (operation === null) return;
  assertClosedObject(
    operation,
    [
      'kind',
      'purpose',
      'replacementIndex',
      'sourcePath',
      'destinationPath',
      'source',
      'destination',
    ],
    'Plan Migration Journal.pendingOperation',
  );
  if (!FILE_OPERATION_KINDS.has(operation.kind)) {
    fail(
      'PLAN_MIGRATION_JOURNAL_INVALID',
      'Plan Migration Journal.pendingOperation.kind is unsupported',
    );
  }
  if (!FILE_OPERATION_PURPOSES.has(operation.purpose)) {
    fail(
      'PLAN_MIGRATION_JOURNAL_INVALID',
      'Plan Migration Journal.pendingOperation.purpose is unsupported',
    );
  }
  const replacementPurpose = operation.purpose.endsWith('-replacement');
  if (
    replacementPurpose
      ? !Number.isInteger(operation.replacementIndex) ||
        operation.replacementIndex < 0 ||
        operation.replacementIndex >= replacementCount
      : operation.replacementIndex !== null
  ) {
    fail(
      'PLAN_MIGRATION_JOURNAL_INVALID',
      'Plan Migration Journal.pendingOperation replacement index is invalid',
    );
  }
  validateRepositoryPath(
    operation.sourcePath,
    'Plan Migration Journal.pendingOperation.sourcePath',
  );
  validateRepositoryPath(
    operation.destinationPath,
    'Plan Migration Journal.pendingOperation.destinationPath',
  );
  if (operation.sourcePath === operation.destinationPath) {
    fail(
      'PLAN_MIGRATION_JOURNAL_INVALID',
      'Plan Migration Journal.pendingOperation paths must be distinct',
    );
  }
  validateFileSnapshot(
    operation.source,
    'Plan Migration Journal.pendingOperation.source',
  );
  if (operation.destination !== null) {
    validateFileSnapshot(
      operation.destination,
      'Plan Migration Journal.pendingOperation.destination',
    );
  }
  if (
    operation.kind === 'exchange' &&
    operation.destination === null
  ) {
    fail(
      'PLAN_MIGRATION_JOURNAL_INVALID',
      'Exchange operation requires an existing destination',
    );
  }
  if (
    operation.kind === 'move-no-replace' &&
    operation.destination !== null
  ) {
    fail(
      'PLAN_MIGRATION_JOURNAL_INVALID',
      'No-replace move requires an absent destination',
    );
  }
}

function validateCleanupFenceEntry(entry, context) {
  assertClosedObject(entry, ['path', 'expectedSha256', 'snapshot'], context);
  validateRepositoryPath(entry.path, `${context}.path`);
  if (entry.expectedSha256 !== null) {
    assertString(
      entry.expectedSha256,
      `${context}.expectedSha256`,
      SHA256_PATTERN,
    );
  }
  if (entry.snapshot !== null) {
    validateFileSnapshot(entry.snapshot, `${context}.snapshot`);
  }
  if (
    (entry.expectedSha256 === null) !== (entry.snapshot === null) ||
    (entry.snapshot !== null &&
      entry.snapshot.sha256 !== entry.expectedSha256)
  ) {
    fail(
      'PLAN_MIGRATION_JOURNAL_INVALID',
      `${context} snapshot contradicts its expected hash`,
    );
  }
}

function validateCleanupCapture(capture, context) {
  assertClosedObject(
    capture,
    [
      'sourcePath',
      'capturedPath',
      'deletePath',
      'expectedSha256',
      'presence',
      'snapshot',
      'state',
    ],
    context,
  );
  validateRepositoryPath(capture.sourcePath, `${context}.sourcePath`);
  validateRepositoryPath(capture.capturedPath, `${context}.capturedPath`);
  validateRepositoryPath(capture.deletePath, `${context}.deletePath`);
  assertString(
    capture.expectedSha256,
    `${context}.expectedSha256`,
    SHA256_PATTERN,
  );
  if (!CLEANUP_CAPTURE_PRESENCES.has(capture.presence)) {
    fail(
      'PLAN_MIGRATION_JOURNAL_INVALID',
      `${context}.presence is unsupported`,
    );
  }
  if (
    new Set([
      capture.sourcePath,
      capture.capturedPath,
      capture.deletePath,
    ]).size !== 3
  ) {
    fail(
      'PLAN_MIGRATION_JOURNAL_INVALID',
      `${context} source, captured and delete paths must be distinct`,
    );
  }
  if (capture.snapshot !== null) {
    validateFileSnapshot(capture.snapshot, `${context}.snapshot`);
    if (capture.snapshot.sha256 !== capture.expectedSha256) {
      fail(
        'PLAN_MIGRATION_JOURNAL_INVALID',
        `${context} snapshot does not match its expected hash`,
      );
    }
  } else if (capture.presence === 'required') {
    fail(
      'PLAN_MIGRATION_JOURNAL_INVALID',
      `${context} required capture has no source snapshot`,
    );
  }
  if (
    capture.presence === 'absent' &&
    capture.snapshot !== null
  ) {
    fail(
      'PLAN_MIGRATION_JOURNAL_INVALID',
      `${context} absent capture unexpectedly has a source snapshot`,
    );
  }
  if (!CLEANUP_CAPTURE_STATES.has(capture.state)) {
    fail(
      'PLAN_MIGRATION_JOURNAL_INVALID',
      `${context}.state is unsupported`,
    );
  }
  if (
    (capture.snapshot === null && !new Set(['pending', 'absent']).has(capture.state)) ||
    (capture.snapshot !== null && capture.state === 'absent')
  ) {
    fail(
      'PLAN_MIGRATION_JOURNAL_INVALID',
      `${context}.state contradicts its captured snapshot`,
    );
  }
}

function validateCleanup(cleanup) {
  if (cleanup === null) return;
  assertClosedObject(
    cleanup,
    ['mode', 'state', 'fence', 'captures'],
    'Plan Migration Journal.cleanup',
  );
  if (!CLEANUP_MODES.has(cleanup.mode)) {
    fail(
      'PLAN_MIGRATION_JOURNAL_INVALID',
      'Plan Migration Journal.cleanup.mode is unsupported',
    );
  }
  if (!CLEANUP_STATES.has(cleanup.state)) {
    fail(
      'PLAN_MIGRATION_JOURNAL_INVALID',
      'Plan Migration Journal.cleanup.state is unsupported',
    );
  }
  if (!Array.isArray(cleanup.fence) || !Array.isArray(cleanup.captures)) {
    fail(
      'PLAN_MIGRATION_JOURNAL_INVALID',
      'Plan Migration Journal.cleanup fence and captures must be arrays',
    );
  }
  const paths = new Set();
  for (const [index, entry] of cleanup.fence.entries()) {
    validateCleanupFenceEntry(
      entry,
      `Plan Migration Journal.cleanup.fence[${index}]`,
    );
    if (paths.has(entry.path)) {
      fail(
        'PLAN_MIGRATION_JOURNAL_INVALID',
        'Plan Migration Journal.cleanup fence path is duplicated',
        { path: entry.path },
      );
    }
    paths.add(entry.path);
  }
  const capturePaths = new Set();
  const allowedCaptureStates = {
    CAPTURING: new Set(['pending', 'absent', 'captured']),
    CAPTURED: new Set(['absent', 'captured']),
    RESTORING: new Set(['pending', 'absent', 'captured', 'restored']),
    VALIDATED: new Set(['absent', 'captured', 'deleted']),
    DONE: new Set(['absent', 'deleted']),
  }[cleanup.state];
  for (const [index, capture] of cleanup.captures.entries()) {
    validateCleanupCapture(
      capture,
      `Plan Migration Journal.cleanup.captures[${index}]`,
    );
    for (const candidate of [
      capture.sourcePath,
      capture.capturedPath,
      capture.deletePath,
    ]) {
      if (capturePaths.has(candidate)) {
        fail(
          'PLAN_MIGRATION_JOURNAL_INVALID',
          'Plan Migration Journal.cleanup capture path is duplicated',
          { path: candidate },
        );
      }
      capturePaths.add(candidate);
    }
    if (!allowedCaptureStates.has(capture.state)) {
      fail(
        'PLAN_MIGRATION_JOURNAL_INVALID',
        'Cleanup capture state contradicts the cleanup batch state',
        {
          cleanupState: cleanup.state,
          captureState: capture.state,
          path: capture.sourcePath,
        },
      );
    }
  }
}

function assertReplacementPathsGloballyUnique(
  replacements,
  code,
  context,
) {
  const occupied = new Map();
  for (const [index, replacement] of replacements.entries()) {
    for (const role of ['path', 'preparedPath', 'backupPath']) {
      const candidate = replacement[role];
      const prior = occupied.get(candidate);
      if (prior) {
        fail(
          code,
          'Migration replacement paths must be globally unique across roles',
          {
            path: candidate,
            first: prior,
            second: { index, role },
            context,
          },
        );
      }
      occupied.set(candidate, { index, role });
    }
  }
}

function validateOldPathReference(reference, context) {
  assertClosedObject(reference, ['path', 'occurrences'], context);
  validateRepositoryPath(reference.path, `${context}.path`);
  if (!Number.isInteger(reference.occurrences) || reference.occurrences < 1) {
    fail(
      'PLAN_MIGRATION_JOURNAL_INVALID',
      `${context}.occurrences must be a positive integer`,
    );
  }
}

function validateActiveWorkProjection(projection) {
  assertClosedObject(
    projection,
    [
      'disposition',
      'registryRef',
      'observedSha256',
      'before',
      'after',
      'applied',
    ],
    'Plan Migration Journal.activeWorkProjection',
  );
  assertString(
    projection.registryRef,
    'Plan Migration Journal.activeWorkProjection.registryRef',
  );
  assertString(
    projection.observedSha256,
    'Plan Migration Journal.activeWorkProjection.observedSha256',
    SHA256_PATTERN,
  );
  if (
    projection.disposition !== 'assert-absent' ||
    projection.before !== 'NONE' ||
    projection.after !== 'NONE'
  ) {
    fail(
      'PLAN_MIGRATION_JOURNAL_INVALID',
      'Pilot active_work projection must explicitly assert NONE -> NONE',
    );
  }
  if (typeof projection.applied !== 'boolean') {
    fail(
      'PLAN_MIGRATION_JOURNAL_INVALID',
      'Plan Migration Journal.activeWorkProjection.applied must be boolean',
    );
  }
}

function normalizeLegacyJournalBinding(journal) {
  if (
    !isPlainObject(journal) ||
    !isPlainObject(journal.binding) ||
    !Object.hasOwn(journal.binding, 'worktreeSetDigest')
  ) {
    return journal;
  }
  assertString(
    journal.binding.worktreeSetDigest,
    'Legacy Plan Migration Journal.binding.worktreeSetDigest',
    SHA256_PATTERN,
  );
  const normalized = structuredClone(journal);
  delete normalized.binding.worktreeSetDigest;
  return normalized;
}

function validateBinding(binding) {
  assertClosedObject(
    binding,
    ['branch', 'workspaceId', 'initialHead', 'expectedHead'],
    'Plan Migration Journal.binding',
  );
  assertString(binding.branch, 'Plan Migration Journal.binding.branch');
  assertString(
    binding.workspaceId,
    'Plan Migration Journal.binding.workspaceId',
    WORKSPACE_ID_PATTERN,
  );
  assertString(
    binding.initialHead,
    'Plan Migration Journal.binding.initialHead',
    SHA1_PATTERN,
  );
  assertString(
    binding.expectedHead,
    'Plan Migration Journal.binding.expectedHead',
    SHA1_PATTERN,
  );
}

function validateSourceIdentity(sourceIdentity) {
  assertClosedObject(
    sourceIdentity,
    ['commit', 'workspaceDigest', 'canonicalWorktreeHash'],
    'Plan Migration Journal.sourceIdentity',
  );
  assertString(
    sourceIdentity.commit,
    'Plan Migration Journal.sourceIdentity.commit',
    SHA1_PATTERN,
  );
  assertString(
    sourceIdentity.workspaceDigest,
    'Plan Migration Journal.sourceIdentity.workspaceDigest',
    WORKSPACE_DIGEST_PATTERN,
  );
  assertString(
    sourceIdentity.canonicalWorktreeHash,
    'Plan Migration Journal.sourceIdentity.canonicalWorktreeHash',
    WORKSPACE_ID_PATTERN,
  );
}

function validateCommitVerification(verification) {
  assertClosedObject(
    verification,
    ['discoveryRoot', 'expectedActivePlanCount', 'expectedPackageStatus'],
    'Plan Migration Journal.verification',
  );
  validateRepositoryPath(
    verification.discoveryRoot,
    'Plan Migration Journal.verification.discoveryRoot',
  );
  if (verification.expectedActivePlanCount !== 1) {
    fail(
      'PLAN_MIGRATION_JOURNAL_INVALID',
      'Plan migration must verify exactly one live Plan Package',
    );
  }
  if (!LIVE_PLAN_STATUSES.has(verification.expectedPackageStatus)) {
    fail(
      'PLAN_MIGRATION_JOURNAL_INVALID',
      'Plan migration target status must be active or blocked',
    );
  }
}

export function validatePlanMigrationJournal(journal) {
  assertClosedObject(
    journal,
    [
      'schemaVersion',
      'kind',
      'migrationId',
      'workspaceId',
      'legacyPlan',
      'packagePlan',
      'legacyBackupPath',
      'phase',
      'legacySha256',
      'archiveSha256',
      'crosswalkPath',
      'crosswalkDigest',
      'binding',
      'sourceIdentity',
      'pendingOperation',
      'cleanup',
      'oldPathReferences',
      'activeWorkProjection',
      'verification',
      'replacements',
      'createdAt',
      'updatedAt',
    ],
    'Plan Migration Journal',
  );
  if (journal.schemaVersion !== 1 || journal.kind !== 'peers-touch-plan-migration') {
    fail('PLAN_MIGRATION_JOURNAL_INVALID', 'Migration schemaVersion or kind is unsupported');
  }
  assertString(journal.migrationId, 'Plan Migration Journal.migrationId', ID_PATTERN);
  assertString(journal.workspaceId, 'Plan Migration Journal.workspaceId', ID_PATTERN);
  validateRepositoryPath(journal.legacyPlan, 'Plan Migration Journal.legacyPlan');
  validateRepositoryPath(journal.packagePlan, 'Plan Migration Journal.packagePlan');
  validateRepositoryPath(
    journal.legacyBackupPath,
    'Plan Migration Journal.legacyBackupPath',
  );
  if (!MIGRATION_PHASES.has(journal.phase)) {
    fail('PLAN_MIGRATION_JOURNAL_INVALID', 'Migration phase is unsupported', {
      phase: journal.phase,
    });
  }
  assertString(journal.legacySha256, 'Plan Migration Journal.legacySha256', SHA256_PATTERN);
  assertString(journal.archiveSha256, 'Plan Migration Journal.archiveSha256', SHA256_PATTERN);
  validateRepositoryPath(journal.crosswalkPath, 'Plan Migration Journal.crosswalkPath');
  assertString(journal.crosswalkDigest, 'Plan Migration Journal.crosswalkDigest', SHA256_PATTERN);
  validateBinding(journal.binding);
  validateSourceIdentity(journal.sourceIdentity);
  if (
    journal.binding.workspaceId !== journal.workspaceId ||
    journal.sourceIdentity.canonicalWorktreeHash !== journal.workspaceId ||
    journal.sourceIdentity.commit !== journal.binding.expectedHead
  ) {
    fail(
      'PLAN_MIGRATION_JOURNAL_INVALID',
      'Journal binding and reviewed source identity do not match',
    );
  }
  if (journal.legacySha256 !== journal.archiveSha256) {
    fail('PLAN_MIGRATION_JOURNAL_INVALID', 'Legacy and archive hashes must be identical');
  }
  if (!Array.isArray(journal.oldPathReferences)) {
    fail(
      'PLAN_MIGRATION_JOURNAL_INVALID',
      'Plan Migration Journal.oldPathReferences must be an array',
    );
  }
  const referencePaths = new Set();
  for (const [index, reference] of journal.oldPathReferences.entries()) {
    validateOldPathReference(
      reference,
      `Plan Migration Journal.oldPathReferences[${index}]`,
    );
    if (referencePaths.has(reference.path)) {
      fail('PLAN_MIGRATION_JOURNAL_INVALID', 'Old-path reference is duplicated', {
        path: reference.path,
      });
    }
    referencePaths.add(reference.path);
  }
  validateActiveWorkProjection(journal.activeWorkProjection);
  validateCommitVerification(journal.verification);
  if (!Array.isArray(journal.replacements)) {
    fail('PLAN_MIGRATION_JOURNAL_INVALID', 'Plan Migration Journal.replacements must be an array');
  }
  validatePendingOperation(journal.pendingOperation, journal.replacements.length);
  validateCleanup(journal.cleanup);
  if (
    journal.cleanup !== null &&
    (
      journal.pendingOperation !== null ||
      (journal.phase === 'COMMITTED' && journal.cleanup.mode !== 'commit') ||
      (journal.phase === 'ROLLED_BACK' && journal.cleanup.mode !== 'rollback') ||
      !new Set(['COMMITTED', 'ROLLED_BACK']).has(journal.phase)
    )
  ) {
    fail(
      'PLAN_MIGRATION_JOURNAL_INVALID',
      'Cleanup state contradicts the migration phase or pending operation',
    );
  }
  for (const [index, replacement] of journal.replacements.entries()) {
    validateReplacement(replacement, `Plan Migration Journal.replacements[${index}]`);
  }
  assertCleanupDerivedShape(journal);
  assertReplacementPathsGloballyUnique(
    journal.replacements,
    'PLAN_MIGRATION_JOURNAL_INVALID',
    'Plan Migration Journal.replacements',
  );
  assertTimestamp(journal.createdAt, 'Plan Migration Journal.createdAt');
  assertTimestamp(journal.updatedAt, 'Plan Migration Journal.updatedAt');
  return journal;
}

export async function readPlanMigrationJournal(journalPath) {
  let value;
  try {
    value = JSON.parse(await fsp.readFile(journalPath, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) {
      fail('PLAN_MIGRATION_JOURNAL_INVALID', 'Migration journal is not valid JSON', {
        journalPath,
      });
    }
    if (error.code === 'ENOENT') {
      fail('PLAN_MIGRATION_UNAVAILABLE', 'Migration journal does not exist', {
        journalPath,
      });
    }
    throw error;
  }
  return validatePlanMigrationJournal(normalizeLegacyJournalBinding(value));
}

async function writeJournal(journalPath, journal, clock) {
  journal.updatedAt = timestamp(clock);
  validatePlanMigrationJournal(journal);
  await atomicWrite(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
}

function identityFromStat(stat) {
  return {
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
  };
}

function versionFromStat(stat) {
  return {
    size: stat.size.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    ctimeNs: stat.ctimeNs.toString(),
  };
}

function sameFileIdentity(left, right) {
  return (
    left !== null &&
    right !== null &&
    left.device === right.device &&
    left.inode === right.inode
  );
}

function sameFileVersion(left, right) {
  return (
    left !== null &&
    right !== null &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

async function fileSnapshot(candidate) {
  let handle;
  try {
    handle = await fsp.open(candidate, 'r');
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
  try {
    const before = await handle.stat({ bigint: true });
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    let current;
    try {
      current = await fsp.lstat(candidate, { bigint: true });
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
        fail(
          'PLAN_CONCURRENT_MODIFICATION',
          'File disappeared while its identity was captured',
          { path: candidate },
        );
      }
      throw error;
    }
    const beforeIdentity = identityFromStat(before);
    const afterIdentity = identityFromStat(after);
    const currentIdentity = identityFromStat(current);
    const beforeVersion = versionFromStat(before);
    const afterVersion = versionFromStat(after);
    const currentVersion = versionFromStat(current);
    if (
      !sameFileIdentity(beforeIdentity, afterIdentity) ||
      !sameFileIdentity(beforeIdentity, currentIdentity) ||
      !sameFileVersion(beforeVersion, afterVersion) ||
      !sameFileVersion(beforeVersion, currentVersion)
    ) {
      fail(
        'PLAN_CONCURRENT_MODIFICATION',
        'File changed while its identity was captured',
        { path: candidate },
      );
    }
    return {
      sha256: sha256(bytes),
      identity: beforeIdentity,
      version: beforeVersion,
    };
  } finally {
    await handle.close();
  }
}

function sameFileSnapshot(actual, expected) {
  return (
    actual !== null &&
    expected !== null &&
    actual.sha256 === expected.sha256 &&
    sameFileIdentity(actual.identity, expected.identity) &&
    sameFileVersion(actual.version, expected.version)
  );
}

function sameFileObject(actual, expected) {
  return (
    actual !== null &&
    expected !== null &&
    actual.sha256 === expected.sha256 &&
    sameFileIdentity(actual.identity, expected.identity)
  );
}

function pendingOperationMatches(operation, expected) {
  return (
    operation.kind === expected.kind &&
    operation.purpose === expected.purpose &&
    operation.replacementIndex === expected.replacementIndex &&
    operation.sourcePath === expected.sourcePath &&
    operation.destinationPath === expected.destinationPath
  );
}

function applyPendingOperationOutcome(journal, operation) {
  if (operation.purpose === 'apply-replacement') {
    journal.replacements[operation.replacementIndex].applied = true;
  } else if (operation.purpose === 'rollback-replacement') {
    journal.replacements[operation.replacementIndex].applied = false;
  }
}

async function clearPendingOperation(options, journal, operation) {
  applyPendingOperationOutcome(journal, operation);
  journal.pendingOperation = null;
  await writeJournal(options.journalPath, journal, options.clock);
}

async function beginPendingOperation(
  repoRoot,
  journal,
  options,
  {
    kind,
    purpose,
    replacementIndex = null,
    sourcePath,
    destinationPath,
    sourceSha256,
    destinationSha256 = null,
  },
) {
  const expected = {
    kind,
    purpose,
    replacementIndex,
    sourcePath,
    destinationPath,
  };
  if (journal.pendingOperation !== null) {
    if (!pendingOperationMatches(journal.pendingOperation, expected)) {
      fail(
        'PLAN_MIGRATION_RECOVERY_REQUIRED',
        'A different filesystem operation is pending recovery',
        {
          pending: journal.pendingOperation,
          requested: expected,
        },
      );
    }
    return journal.pendingOperation;
  }

  const source = await fileSnapshot(relativeToNative(repoRoot, sourcePath));
  const destination = await fileSnapshot(
    relativeToNative(repoRoot, destinationPath),
  );
  if (
    source === null ||
    source.sha256 !== sourceSha256 ||
    (destinationSha256 === null
      ? destination !== null
      : destination === null || destination.sha256 !== destinationSha256)
  ) {
    fail(
      'PLAN_CONCURRENT_MODIFICATION',
      'Filesystem state changed before operation intent was journaled',
      {
        purpose,
        sourcePath,
        destinationPath,
        expectedSourceSha256: sourceSha256,
        actualSourceSha256: source?.sha256 ?? null,
        expectedDestinationSha256: destinationSha256,
        actualDestinationSha256: destination?.sha256 ?? null,
      },
    );
  }
  journal.pendingOperation = {
    ...expected,
    source,
    destination,
  };
  await writeJournal(options.journalPath, journal, options.clock);
  await invokeFailpoint(
    options,
    `after-file-operation-intent:${purpose}:${destinationPath}`,
    journal,
  );
  return journal.pendingOperation;
}

async function settlePendingOperation(
  repoRoot,
  journal,
  options,
  {
    execute,
    beforeAtomic,
    afterAtomic,
  } = {},
) {
  const operation = journal.pendingOperation;
  if (operation === null) return false;
  const sourcePath = relativeToNative(repoRoot, operation.sourcePath);
  const destinationPath = relativeToNative(repoRoot, operation.destinationPath);
  let source = await fileSnapshot(sourcePath);
  let destination = await fileSnapshot(destinationPath);

  const beforeState =
    sameFileSnapshot(source, operation.source) &&
    (operation.destination === null
      ? destination === null
      : sameFileSnapshot(destination, operation.destination));
  const afterState =
    operation.kind === 'exchange'
      ? sameFileObject(source, operation.destination) &&
        sameFileObject(destination, operation.source)
      : source === null && sameFileObject(destination, operation.source);

  if (afterState) {
    await clearPendingOperation(options, journal, operation);
    return true;
  }
  if (beforeState && !execute) {
    journal.pendingOperation = null;
    await writeJournal(options.journalPath, journal, options.clock);
    return false;
  }
  if (beforeState) {
    if (beforeAtomic) await invokeFailpoint(options, beforeAtomic, journal);
    source = await fileSnapshot(sourcePath);
    destination = await fileSnapshot(destinationPath);
    const stillBefore =
      sameFileSnapshot(source, operation.source) &&
      (operation.destination === null
        ? destination === null
        : sameFileSnapshot(destination, operation.destination));
    if (!stillBefore) {
      journal.pendingOperation = null;
      await writeJournal(options.journalPath, journal, options.clock);
      fail(
        'PLAN_CONCURRENT_MODIFICATION',
        'Filesystem state changed after operation intent and before the atomic operation',
        {
          purpose: operation.purpose,
          sourcePath: operation.sourcePath,
          destinationPath: operation.destinationPath,
          source,
          destination,
        },
      );
    }
    if (operation.kind === 'exchange') {
      await atomicExchangeFiles(sourcePath, destinationPath);
    } else {
      await atomicMoveFileNoReplace(sourcePath, destinationPath);
    }
    if (afterAtomic) await invokeFailpoint(options, afterAtomic, journal);
    source = await fileSnapshot(sourcePath);
    destination = await fileSnapshot(destinationPath);
    const completed =
      operation.kind === 'exchange'
        ? sameFileObject(source, operation.destination) &&
          sameFileObject(destination, operation.source)
        : source === null && sameFileObject(destination, operation.source);
    if (completed) {
      await clearPendingOperation(options, journal, operation);
      return true;
    }
  }

  if (sameFileSnapshot(source, operation.source)) {
    journal.pendingOperation = null;
    await writeJournal(options.journalPath, journal, options.clock);
  }

  fail(
    'PLAN_CONCURRENT_MODIFICATION',
    'Filesystem state does not match the journaled atomic operation',
    {
      purpose: operation.purpose,
      sourcePath: operation.sourcePath,
      destinationPath: operation.destinationPath,
      source,
      destination,
    },
  );
}

async function validateJournalPaths(repoRoot, journal) {
  await assertRepositoryPathContained(repoRoot, journal.legacyPlan, 'journal.legacyPlan');
  await assertRepositoryPathContained(repoRoot, journal.packagePlan, 'journal.packagePlan');
  await assertRepositoryPathContained(
    repoRoot,
    journal.legacyBackupPath,
    'journal.legacyBackupPath',
  );
  await assertRepositoryPathContained(
    repoRoot,
    journal.crosswalkPath,
    'journal.crosswalkPath',
  );
  await assertRepositoryPathContained(
    repoRoot,
    journal.verification.discoveryRoot,
    'journal.verification.discoveryRoot',
  );
  if (journal.pendingOperation !== null) {
    await assertRepositoryPathContained(
      repoRoot,
      journal.pendingOperation.sourcePath,
      'journal.pendingOperation.sourcePath',
    );
    await assertRepositoryPathContained(
      repoRoot,
      journal.pendingOperation.destinationPath,
      'journal.pendingOperation.destinationPath',
    );
  }
  if (journal.cleanup !== null) {
    for (const [index, entry] of journal.cleanup.fence.entries()) {
      await assertRepositoryPathContained(
        repoRoot,
        entry.path,
        `journal.cleanup.fence[${index}].path`,
      );
    }
    for (const [index, capture] of journal.cleanup.captures.entries()) {
      await assertRepositoryPathContained(
        repoRoot,
        capture.sourcePath,
        `journal.cleanup.captures[${index}].sourcePath`,
      );
      await assertRepositoryPathContained(
        repoRoot,
        capture.capturedPath,
        `journal.cleanup.captures[${index}].capturedPath`,
      );
      await assertRepositoryPathContained(
        repoRoot,
        capture.deletePath,
        `journal.cleanup.captures[${index}].deletePath`,
      );
    }
  }
  for (const [index, replacement] of journal.replacements.entries()) {
    await assertRepositoryPathContained(
      repoRoot,
      replacement.path,
      `journal.replacements[${index}].path`,
    );
    await assertRepositoryPathContained(
      repoRoot,
      replacement.preparedPath,
      `journal.replacements[${index}].preparedPath`,
    );
    await assertRepositoryPathContained(
      repoRoot,
      replacement.backupPath,
      `journal.replacements[${index}].backupPath`,
    );
  }
}

function archivePathFor(packagePlan) {
  return path.posix.join(path.posix.dirname(packagePlan), 'archive', 'legacy-plan.md');
}

function legacyBackupPathFor(packagePlan) {
  return path.posix.join(
    path.posix.dirname(packagePlan),
    'archive',
    '.legacy-plan.migration-backup',
  );
}

function defaultCrosswalkPath(packagePlan) {
  return path.posix.join(path.posix.dirname(packagePlan), 'migration-crosswalk.json');
}

async function readReviewedCrosswalk(repoRoot, journal) {
  const crosswalkPath = relativeToNative(repoRoot, journal.crosswalkPath);
  let bytes;
  let crosswalk;
  try {
    bytes = await fsp.readFile(crosswalkPath);
    crosswalk = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) {
      fail('PLAN_MIGRATION_CROSSWALK_INVALID', 'Reviewed crosswalk is missing or invalid', {
        path: journal.crosswalkPath,
      });
    }
    throw error;
  }
  const actualDigest = sha256(bytes);
  if (actualDigest !== journal.crosswalkDigest) {
    fail('PLAN_MIGRATION_CROSSWALK_MISMATCH', 'Reviewed crosswalk digest changed', {
      path: journal.crosswalkPath,
      expected: journal.crosswalkDigest,
      actual: actualDigest,
    });
  }
  if (
    !isPlainObject(crosswalk) ||
    crosswalk.legacyPlan !== journal.legacyPlan ||
    crosswalk.packagePlan !== journal.packagePlan ||
    !Array.isArray(crosswalk.liveReferences)
  ) {
    fail(
      'PLAN_MIGRATION_CROSSWALK_INVALID',
      'Reviewed crosswalk does not describe this migration',
      { path: journal.crosswalkPath },
    );
  }
  const liveReferencePaths = new Set();
  for (const [index, reference] of crosswalk.liveReferences.entries()) {
    if (!isPlainObject(reference)) {
      fail('PLAN_MIGRATION_CROSSWALK_INVALID', 'Crosswalk live reference must be an object', {
        index,
      });
    }
    validateRepositoryPath(reference.path, `crosswalk.liveReferences[${index}].path`);
    if (liveReferencePaths.has(reference.path)) {
      fail('PLAN_MIGRATION_CROSSWALK_INVALID', 'Crosswalk live reference is duplicated', {
        path: reference.path,
      });
    }
    liveReferencePaths.add(reference.path);
  }
  return liveReferencePaths;
}

function countBufferOccurrences(content, needle) {
  let count = 0;
  let offset = 0;
  while (offset <= content.length - needle.length) {
    const found = content.indexOf(needle, offset);
    if (found < 0) break;
    count += 1;
    offset = found + needle.length;
  }
  return count;
}

async function scanOldPathReferences(repoRoot, journal) {
  const needle = Buffer.from(path.posix.basename(journal.legacyPlan));
  const excludedFiles = new Set([
    journal.legacyPlan,
    journal.crosswalkPath,
    ...journal.replacements.flatMap((replacement) => [
      replacement.preparedPath,
      replacement.backupPath,
    ]),
    ...(journal.cleanup?.captures ?? []).flatMap((capture) => [
      capture.capturedPath,
      capture.deletePath,
    ]),
  ]);
  const references = [];

  async function walk(directory, relativeDirectory = '') {
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && NON_LIVE_DIRECTORY_NAMES.has(entry.name)) continue;
      const relative = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(candidate, relative);
      } else if (entry.isFile() && !excludedFiles.has(relative)) {
        const occurrences = countBufferOccurrences(await fsp.readFile(candidate), needle);
        if (occurrences > 0) references.push({ path: relative, occurrences });
      }
    }
  }

  await walk(repoRoot);
  return references.sort((left, right) => left.path.localeCompare(right.path));
}

function assertReferenceInventory(
  current,
  expected,
  declaredPaths,
  { allowRemoved = false } = {},
) {
  const unexpected = current.filter((reference) => !declaredPaths.has(reference.path));
  if (unexpected.length > 0) {
    fail(
      'PLAN_MIGRATION_REFERENCE_INVENTORY_CHANGED',
      'Old-path reference exists outside the reviewed crosswalk',
      { unexpected },
    );
  }
  const expectedByPath = new Map(
    expected.map((reference) => [reference.path, reference.occurrences]),
  );
  const changed = current.filter((reference) => {
    const prior = expectedByPath.get(reference.path);
    return prior === undefined || reference.occurrences > prior ||
      (!allowRemoved && reference.occurrences !== prior);
  });
  const currentByPath = new Map(
    current.map((reference) => [reference.path, reference.occurrences]),
  );
  const removed = allowRemoved
    ? []
    : expected.filter((reference) => !currentByPath.has(reference.path));
  if (changed.length > 0 || removed.length > 0) {
    fail(
      'PLAN_MIGRATION_REFERENCE_INVENTORY_CHANGED',
      'Old-path reference inventory changed after review',
      { changed, removed },
    );
  }
}

async function verifyReviewedInputs(
  repoRoot,
  journal,
  { allowRemovedReferences = false } = {},
) {
  const declaredPaths = await readReviewedCrosswalk(repoRoot, journal);
  const current = await scanOldPathReferences(repoRoot, journal);
  assertReferenceInventory(
    current,
    journal.oldPathReferences,
    declaredPaths,
    { allowRemoved: allowRemovedReferences },
  );
}

export function inspectActiveWorkRegistry(markdown) {
  if (typeof markdown !== 'string') {
    fail(
      'PLAN_MIGRATION_ACTIVE_WORK_CONTEXT_REQUIRED',
      'active_work registry reader must return Markdown',
    );
  }
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  const start = lines.findIndex((line) => /^##\s+active_work\s*$/i.test(line.trim()));
  if (start < 0) {
    return {
      state: 'NONE',
      observedSha256: sha256(Buffer.from('ABSENT\n')),
    };
  }
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index].trim())) {
      end = index;
      break;
    }
  }
  const sectionLines = lines.slice(start, end);
  const tableRows = sectionLines.filter((line) => /^\s*\|.*\|\s*$/.test(line));
  const dataRows = tableRows.filter((line, index) => {
    if (index === 0) return false;
    const cells = line
      .slice(line.indexOf('|') + 1, line.lastIndexOf('|'))
      .split('|')
      .map((cell) => cell.trim());
    return !cells.every((cell) => /^:?-{3,}:?$/.test(cell));
  });
  const canonicalSection = `${sectionLines.join('\n').trimEnd()}\n`;
  return {
    state: dataRows.length === 0 ? 'NONE' : 'PRESENT',
    observedSha256: sha256(Buffer.from(canonicalSection)),
  };
}

async function observeActiveWorkRegistry(options, expectedRegistryRef = undefined) {
  const registryRef = options.activeWorkRegistry;
  if (
    typeof registryRef !== 'string' ||
    registryRef.length === 0 ||
    typeof options.readActiveWorkRegistry !== 'function'
  ) {
    fail(
      'PLAN_MIGRATION_ACTIVE_WORK_CONTEXT_REQUIRED',
      'Migration must read the declared active_work registry source',
    );
  }
  if (expectedRegistryRef !== undefined && registryRef !== expectedRegistryRef) {
    fail(
      'PLAN_MIGRATION_ACTIVE_WORK_CONFLICT',
      'active_work registry source differs from the reviewed journal',
      { expected: expectedRegistryRef, actual: registryRef },
    );
  }
  let markdown;
  try {
    markdown = await options.readActiveWorkRegistry(registryRef);
  } catch (error) {
    fail(
      'PLAN_MIGRATION_ACTIVE_WORK_CONTEXT_REQUIRED',
      'active_work registry could not be read',
      { registryRef, cause: error.message },
    );
  }
  const observation = inspectActiveWorkRegistry(markdown);
  if (observation.state !== 'NONE') {
    fail(
      'PLAN_MIGRATION_ACTIVE_WORK_CONFLICT',
      'Pilot migration requires active_work to remain absent',
      { expected: 'NONE', actual: observation.state, registryRef },
    );
  }
  return { registryRef, ...observation };
}

async function assertActiveWorkProjection(options, journal) {
  const observation = await observeActiveWorkRegistry(
    options,
    journal.activeWorkProjection.registryRef,
  );
  const expected = journal.activeWorkProjection.applied
    ? journal.activeWorkProjection.after
    : journal.activeWorkProjection.before;
  if (
    observation.state !== expected ||
    observation.observedSha256 !== journal.activeWorkProjection.observedSha256
  ) {
    fail(
      'PLAN_MIGRATION_ACTIVE_WORK_CONFLICT',
      'Observed active_work registry contradicts the migration journal',
      {
        expected,
        actual: observation.state,
        expectedSha256: journal.activeWorkProjection.observedSha256,
        actualSha256: observation.observedSha256,
      },
    );
  }
}

async function ensureArchive(repoRoot, journal) {
  const legacyPath = relativeToNative(repoRoot, journal.legacyPlan);
  const archivePath = relativeToNative(repoRoot, archivePathFor(journal.packagePlan));
  if (!(await exists(legacyPath))) {
    fail('PLAN_MIGRATION_HASH_MISMATCH', 'Legacy plan is missing before preparation', {
      path: journal.legacyPlan,
    });
  }
  const legacyBytes = await fsp.readFile(legacyPath);
  const legacySha256 = sha256(legacyBytes);
  if (journal.legacySha256 && journal.legacySha256 !== legacySha256) {
    fail('PLAN_MIGRATION_HASH_MISMATCH', 'Legacy plan hash changed', {
      expected: journal.legacySha256,
      actual: legacySha256,
    });
  }
  if (await exists(archivePath)) {
    const archiveBytes = await fsp.readFile(archivePath);
    if (!archiveBytes.equals(legacyBytes)) {
      fail('PLAN_MIGRATION_HASH_MISMATCH', 'Existing archive is not byte-identical');
    }
  } else {
    await atomicWrite(archivePath, legacyBytes, { mode: 0o644 });
  }
  const archiveBytes = await fsp.readFile(archivePath);
  if (!archiveBytes.equals(legacyBytes)) {
    fail('PLAN_MIGRATION_HASH_MISMATCH', 'Archive copy is not byte-identical');
  }
  return legacySha256;
}

function normalizeReplacementInput(value, context) {
  assertClosedObject(value, ['path', 'preparedPath', 'backupPath'], context);
  validateRepositoryPath(value.path, `${context}.path`);
  validateRepositoryPath(value.preparedPath, `${context}.preparedPath`);
  validateRepositoryPath(value.backupPath, `${context}.backupPath`);
  return value;
}

export async function preparePlanMigration(options) {
  const repoRoot = await fsp.realpath(path.resolve(options.repoRoot));
  assertString(options.journalPath, 'journalPath');
  assertString(options.lockPath, 'lockPath');
  assertString(options.migrationId, 'migrationId', ID_PATTERN);
  assertString(options.workspaceId, 'workspaceId', ID_PATTERN);
  assertString(options.crosswalkDigest, 'crosswalkDigest', SHA256_PATTERN);
  validateRepositoryPath(options.legacyPlan, 'legacyPlan');
  validateRepositoryPath(options.packagePlan, 'packagePlan');
  if (
    typeof options.discoveryRoot !== 'string' ||
    options.expectedActivePlanCount !== 1 ||
    !LIVE_PLAN_STATUSES.has(options.expectedPackageStatus)
  ) {
    fail(
      'PLAN_MIGRATION_INVALID',
      'Preparation requires a discovery root, exactly one live package, and an active or blocked target',
    );
  }
  validateCommitVerification({
    discoveryRoot: options.discoveryRoot,
    expectedActivePlanCount: options.expectedActivePlanCount,
    expectedPackageStatus: options.expectedPackageStatus,
  });
  const crosswalkPath =
    options.crosswalkPath ?? defaultCrosswalkPath(options.packagePlan);
  const legacyBackupPath = legacyBackupPathFor(options.packagePlan);
  validateRepositoryPath(crosswalkPath, 'crosswalkPath');
  const activeWorkObservation = await observeActiveWorkRegistry(
    options,
    options.activeWorkRegistry,
  );
  validateSourceIdentity(options.sourceIdentity);
  if (!Array.isArray(options.replacements)) {
    fail('PLAN_MIGRATION_INVALID', 'replacements must be an array');
  }
  const reviewSnapshotPath = reviewedJournalPath(options.journalPath);
  if (
    (await exists(options.journalPath)) ||
    (await exists(options.lockPath)) ||
    (await exists(reviewSnapshotPath))
  ) {
    fail('PLAN_MIGRATION_ALREADY_EXISTS', 'Migration journal, lock, or review snapshot already exists', {
      journalPath: options.journalPath,
      lockPath: options.lockPath,
      reviewSnapshotPath,
    });
  }

  await assertRepositoryPathContained(repoRoot, options.legacyPlan, 'legacyPlan');
  await assertRepositoryPathContained(repoRoot, options.packagePlan, 'packagePlan');
  await assertRepositoryPathContained(repoRoot, legacyBackupPath, 'legacyBackupPath');
  await assertRepositoryPathContained(repoRoot, crosswalkPath, 'crosswalkPath');
  await assertRepositoryPathContained(repoRoot, options.discoveryRoot, 'discoveryRoot');
  if (await exists(relativeToNative(repoRoot, legacyBackupPath))) {
    fail('PLAN_MIGRATION_INVALID', 'Legacy migration backup path already exists', {
      path: legacyBackupPath,
    });
  }
  const packagePlanPath = relativeToNative(repoRoot, options.packagePlan);
  const planPackage = await loadPlanPackage(packagePlanPath, {
    repoRoot,
  });
  if (planPackage.manifest.status !== 'prepared') {
    fail('PLAN_MIGRATION_INVALID', 'Package must be prepared before migration', {
      status: planPackage.manifest.status,
    });
  }
  if (planPackage.manifest.binding.workspaceId !== options.workspaceId) {
    fail('PLAN_MIGRATION_INVALID', 'Package workspaceId does not match migration', {
      packageWorkspaceId: planPackage.manifest.binding.workspaceId,
      migrationWorkspaceId: options.workspaceId,
    });
  }
  if (
    options.sourceIdentity.commit !==
      planPackage.manifest.binding.expectedHead ||
    options.sourceIdentity.canonicalWorktreeHash !==
      planPackage.manifest.binding.workspaceId
  ) {
    fail(
      'PLAN_MIGRATION_INVALID',
      'Reviewed formal Gate source does not match the Plan Package binding',
      {
        binding: planPackage.manifest.binding,
        sourceIdentity: options.sourceIdentity,
      },
    );
  }

  const initial = timestamp(options.clock);
  const journal = {
    schemaVersion: 1,
    kind: 'peers-touch-plan-migration',
    migrationId: options.migrationId,
    workspaceId: options.workspaceId,
    legacyPlan: options.legacyPlan,
    packagePlan: options.packagePlan,
    legacyBackupPath,
    phase: 'PREPARED',
    legacySha256: '',
    archiveSha256: '',
    crosswalkPath,
    crosswalkDigest: options.crosswalkDigest,
    binding: structuredClone(planPackage.manifest.binding),
    sourceIdentity: structuredClone(options.sourceIdentity),
    pendingOperation: null,
    cleanup: null,
    oldPathReferences: [],
    activeWorkProjection: {
      disposition: 'assert-absent',
      registryRef: activeWorkObservation.registryRef,
      observedSha256: activeWorkObservation.observedSha256,
      before: 'NONE',
      after: 'NONE',
      applied: false,
    },
    verification: {
      discoveryRoot: options.discoveryRoot,
      expectedActivePlanCount: options.expectedActivePlanCount,
      expectedPackageStatus: options.expectedPackageStatus,
    },
    replacements: [],
    createdAt: initial,
    updatedAt: initial,
  };
  journal.legacySha256 = await ensureArchive(repoRoot, journal);
  journal.archiveSha256 = journal.legacySha256;

  const normalizedReplacements = options.replacements.map(
    (replacement, index) =>
      normalizeReplacementInput(replacement, `replacements[${index}]`),
  );
  assertReplacementPathsGloballyUnique(
    normalizedReplacements,
    'PLAN_MIGRATION_INVALID',
    'replacements',
  );
  for (const [index, replacement] of normalizedReplacements.entries()) {
    await assertRepositoryPathContained(repoRoot, replacement.path, `replacements[${index}].path`);
    await assertRepositoryPathContained(
      repoRoot,
      replacement.preparedPath,
      `replacements[${index}].preparedPath`,
    );
    await assertRepositoryPathContained(
      repoRoot,
      replacement.backupPath,
      `replacements[${index}].backupPath`,
    );
    const targetPath = relativeToNative(repoRoot, replacement.path);
    const preparedPath = relativeToNative(repoRoot, replacement.preparedPath);
    const backupPath = relativeToNative(repoRoot, replacement.backupPath);
    if (!(await exists(preparedPath))) {
      fail('PLAN_MIGRATION_INVALID', 'Prepared replacement file does not exist', {
        path: replacement.preparedPath,
      });
    }
    if (await exists(backupPath)) {
      fail('PLAN_MIGRATION_INVALID', 'Replacement backup path already exists', {
        path: replacement.backupPath,
      });
    }
    journal.replacements.push({
      ...replacement,
      beforeSha256: (await exists(targetPath)) ? await sha256File(targetPath) : null,
      afterSha256: await sha256File(preparedPath),
      applied: false,
    });
  }
  const declaredPaths = await readReviewedCrosswalk(repoRoot, journal);
  journal.oldPathReferences = await scanOldPathReferences(repoRoot, journal);
  assertReferenceInventory(
    journal.oldPathReferences,
    journal.oldPathReferences,
    declaredPaths,
  );
  validatePlanMigrationJournal(journal);
  await atomicWrite(options.journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  return journal;
}

function bootIdentity() {
  if (process.platform === 'linux') {
    try {
      return fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    } catch {
      return null;
    }
  }
  if (process.platform === 'darwin') {
    const result = spawnSync('sysctl', ['-n', 'kern.boottime'], {
      encoding: 'utf8',
      env: process.env,
    });
    return result.status === 0 ? result.stdout.trim() : null;
  }
  return null;
}

function processStartIdentity(pid) {
  if (process.platform === 'linux') {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
      return fields[19] ?? null;
    } catch {
      return null;
    }
  }
  if (process.platform === 'darwin') {
    const result = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
      env: process.env,
    });
    return result.status === 0
      ? result.stdout.trim().replace(/\s+/g, ' ')
      : null;
  }
  return null;
}

export function processIdentityForPid(pid) {
  const boot = bootIdentity();
  const started = processStartIdentity(pid);
  if (!boot || !started) return null;
  return sha256(Buffer.from(`${boot}\0${started}`));
}

function lockMetadata(journal, ownerToken) {
  const processIdentity = processIdentityForPid(process.pid);
  if (processIdentity === null) {
    fail(
      'PLAN_MIGRATION_LOCK_INVALID',
      'Current process identity cannot be established',
      { pid: process.pid },
    );
  }
  return {
    migrationId: journal.migrationId,
    workspaceId: journal.workspaceId,
    ownerToken,
    pid: process.pid,
    processIdentity,
    phase: journal.phase,
  };
}

function validateLockMetadata(metadata, context = 'migration lock') {
  if (
    !isPlainObject(metadata) ||
    Object.keys(metadata).sort().join(',') !==
      ['migrationId', 'ownerToken', 'phase', 'pid', 'processIdentity', 'workspaceId']
        .sort()
        .join(',') ||
    !ID_PATTERN.test(metadata.migrationId ?? '') ||
    !ID_PATTERN.test(metadata.workspaceId ?? '') ||
    !SHA256_PATTERN.test(metadata.ownerToken ?? '') ||
    !Number.isInteger(metadata.pid) ||
    metadata.pid < 1 ||
    !SHA256_PATTERN.test(metadata.processIdentity ?? '') ||
    !MIGRATION_PHASES.has(metadata.phase)
  ) {
    fail('PLAN_MIGRATION_LOCK_INVALID', `${context} metadata is invalid`);
  }
  return metadata;
}

async function readLockMetadata(lockPath, context = 'migration lock') {
  let raw;
  let metadata;
  try {
    raw = await fsp.readFile(lockPath);
    metadata = JSON.parse(raw.toString('utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) {
      fail('PLAN_MIGRATION_LOCK_INVALID', `${context} metadata is not valid JSON`);
    }
    throw error;
  }
  return { raw, metadata: validateLockMetadata(metadata, context) };
}

function ownerToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function createOwnedLock(lockPath, journal) {
  await fsp.mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  const token = ownerToken();
  let handle;
  try {
    handle = await fsp.open(lockPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(lockMetadata(journal, token))}\n`);
    await handle.sync();
    await handle.close();
    handle = null;
    ACTIVE_LOCK_OWNER_TOKENS.add(token);
    return { lockPath, ownerToken: token, recoveryClaim: null };
  } catch (error) {
    if (handle) await handle.close();
    if (error.code === 'EEXIST') {
      fail('PLAN_MIGRATION_LOCKED', 'Plan migration lock already exists', { lockPath });
    }
    throw error;
  }
}

async function assertLockOwned(lease) {
  const current = await readLockMetadata(lease.lockPath);
  if (!current || current.metadata.ownerToken !== lease.ownerToken) {
    fail(
      'PLAN_MIGRATION_LOCK_OWNERSHIP_MISMATCH',
      'Migration lock is not owned by this operation',
      {
        lockPath: lease.lockPath,
        expectedOwnerToken: lease.ownerToken,
        actualOwnerToken: current?.metadata.ownerToken ?? null,
      },
    );
  }
  return current;
}

function processIsLive(metadata) {
  if (
    metadata.pid === process.pid &&
    !ACTIVE_LOCK_OWNER_TOKENS.has(metadata.ownerToken)
  ) {
    return false;
  }
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

async function acquireRecoveryClaim(lockPath, journal, options) {
  const claimPath = `${lockPath}.recovery`;
  const token = ownerToken();
  const candidatePath = `${claimPath}.${token}`;
  await fsp.mkdir(path.dirname(claimPath), { recursive: true, mode: 0o700 });
  await fsp.writeFile(
    candidatePath,
    `${JSON.stringify(lockMetadata(journal, token))}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  try {
    while (true) {
      try {
        await fsp.link(candidatePath, claimPath);
        ACTIVE_LOCK_OWNER_TOKENS.add(token);
        return { lockPath: claimPath, ownerToken: token, candidatePath };
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const current = await readLockMetadata(claimPath, 'migration recovery claim');
        if (current && processIsLive(current.metadata)) {
          fail('PLAN_MIGRATION_LOCKED', 'Plan migration recovery is already active', {
            lockPath: claimPath,
          });
        }
        await invokeFailpoint(
          options,
          'after-stale-recovery-claim-observed',
          journal,
        );
        const stalePath = `${claimPath}.stale.${token}`;
        try {
          await atomicMoveFileNoReplace(claimPath, stalePath);
        } catch (moveError) {
          if (moveError.code === 'PLAN_CONCURRENT_MODIFICATION') continue;
          throw moveError;
        }
        const captured = await readLockMetadata(
          stalePath,
          'captured migration recovery claim',
        );
        if (
          !captured ||
          !current ||
          !captured.raw.equals(current.raw) ||
          processIsLive(captured.metadata)
        ) {
          try {
            await atomicMoveFileNoReplace(stalePath, claimPath);
          } catch (restoreError) {
            fail(
              'PLAN_MIGRATION_LOCKED',
              'A competing recovery claim changed during stale-claim takeover',
              {
                lockPath: claimPath,
                capturedPath: stalePath,
                cause: restoreError.code,
              },
            );
          }
          if (captured && processIsLive(captured.metadata)) {
            fail(
              'PLAN_MIGRATION_LOCKED',
              'Plan migration recovery became active during stale-claim takeover',
              { lockPath: claimPath, pid: captured.metadata.pid },
            );
          }
          continue;
        }
        await fsp.unlink(stalePath);
        await fsyncDirectory(path.dirname(stalePath));
      }
    }
  } catch (error) {
    await fsp.rm(candidatePath, { force: true });
    throw error;
  }
}

async function releaseOwnedFile(lease) {
  const releasePath = `${lease.lockPath}.release.${lease.ownerToken}`;
  await atomicMoveFileNoReplace(lease.lockPath, releasePath);
  const captured = await readLockMetadata(releasePath);
  if (!captured || captured.metadata.ownerToken !== lease.ownerToken) {
    try {
      await atomicMoveFileNoReplace(releasePath, lease.lockPath);
    } catch (restoreError) {
      fail(
        'PLAN_MIGRATION_LOCK_OWNERSHIP_MISMATCH',
        'Migration lock changed during owned release',
        {
          lockPath: lease.lockPath,
          capturedPath: releasePath,
          cause: restoreError.code,
        },
      );
    }
    fail(
      'PLAN_MIGRATION_LOCK_OWNERSHIP_MISMATCH',
      'Migration lock is not owned by this operation',
      {
        lockPath: lease.lockPath,
        expectedOwnerToken: lease.ownerToken,
        actualOwnerToken: captured?.metadata.ownerToken ?? null,
      },
    );
  }
  await fsp.unlink(releasePath);
  ACTIVE_LOCK_OWNER_TOKENS.delete(lease.ownerToken);
  if (lease.candidatePath) {
    await fsp.rm(lease.candidatePath, { force: true });
  }
  await fsyncDirectory(path.dirname(lease.lockPath));
}

async function acquireRecoveryLock(lockPath, journal, options) {
  const recoveryClaim = await acquireRecoveryClaim(lockPath, journal, options);
  try {
    const current = await readLockMetadata(lockPath);
    let lease;
    if (!current) {
      lease = await createOwnedLock(lockPath, journal);
    } else {
      if (
        current.metadata.migrationId !== journal.migrationId ||
        current.metadata.workspaceId !== journal.workspaceId
      ) {
        fail(
          'PLAN_MIGRATION_LOCK_OWNERSHIP_MISMATCH',
          'Existing migration lock belongs to a different migration',
          { lockPath },
        );
      }
      if (processIsLive(current.metadata)) {
        fail('PLAN_MIGRATION_LOCKED', 'Plan migration owner is still active', {
          lockPath,
          pid: current.metadata.pid,
        });
      }
      await invokeFailpoint(
        options,
        'after-stale-migration-lock-observed',
        journal,
      );
      const token = ownerToken();
      const stalePath = `${lockPath}.stale.${token}`;
      await atomicMoveFileNoReplace(lockPath, stalePath);
      const captured = await readLockMetadata(
        stalePath,
        'captured migration lock',
      );
      if (
        !captured ||
        !captured.raw.equals(current.raw) ||
        captured.metadata.migrationId !== journal.migrationId ||
        captured.metadata.workspaceId !== journal.workspaceId ||
        processIsLive(captured.metadata)
      ) {
        try {
          await atomicMoveFileNoReplace(stalePath, lockPath);
        } catch (restoreError) {
          fail(
            'PLAN_MIGRATION_LOCKED',
            'A competing migration lock changed during stale-lock takeover',
            {
              lockPath,
              capturedPath: stalePath,
              cause: restoreError.code,
            },
          );
        }
        fail(
          processIsLive(captured?.metadata ?? {})
            ? 'PLAN_MIGRATION_LOCKED'
            : 'PLAN_MIGRATION_LOCK_OWNERSHIP_MISMATCH',
          'Captured migration lock is not the stale reviewed lock',
          { lockPath },
        );
      }
      let owned;
      try {
        owned = await createOwnedLock(lockPath, journal);
      } finally {
        await fsp.rm(stalePath, { force: true });
      }
      lease = owned;
    }
    lease.recoveryClaim = recoveryClaim;
    return lease;
  } catch (error) {
    await releaseOwnedFile(recoveryClaim);
    throw error;
  }
}

async function releaseLease(lease) {
  try {
    await releaseOwnedFile(lease);
  } finally {
    if (lease.recoveryClaim) {
      await releaseOwnedFile(lease.recoveryClaim);
    }
  }
}

async function abandonLease(lease) {
  ACTIVE_LOCK_OWNER_TOKENS.delete(lease.ownerToken);
  if (lease.recoveryClaim) {
    await releaseOwnedFile(lease.recoveryClaim);
  }
}

async function invokeFailpoint(options, name, journal) {
  if (options.failpoint) {
    await options.failpoint(name, structuredClone(journal));
  }
}

async function verifyArchiveIntegrity(repoRoot, journal) {
  const archivePath = relativeToNative(repoRoot, archivePathFor(journal.packagePlan));
  if (
    !(await exists(archivePath)) ||
    (await sha256File(archivePath)) !== journal.archiveSha256
  ) {
    fail('PLAN_MIGRATION_HASH_MISMATCH', 'Migration archive hash is invalid');
  }
}

async function verifyLegacyPlanIntegrity(repoRoot, journal) {
  const legacyPath = relativeToNative(repoRoot, journal.legacyPlan);
  if (
    !(await exists(legacyPath)) ||
    (await sha256File(legacyPath)) !== journal.legacySha256
  ) {
    fail(
      'PLAN_MIGRATION_HASH_MISMATCH',
      'Legacy plan changed before the first migration write',
    );
  }
}

async function repairCommittedArchive(repoRoot, journal) {
  const archivePath = relativeToNative(repoRoot, archivePathFor(journal.packagePlan));
  if (
    !(await exists(archivePath)) ||
    (await sha256File(archivePath)) !== journal.archiveSha256
  ) {
    fail(
      'PLAN_MIGRATION_HASH_MISMATCH',
      'Committed archive changed before backup cleanup',
    );
  }
}

async function verifyPreparedState(repoRoot, journal) {
  await verifyArchiveIntegrity(repoRoot, journal);
  for (const replacement of journal.replacements) {
    const preparedPath = relativeToNative(repoRoot, replacement.preparedPath);
    if (
      !(await exists(preparedPath)) ||
      (await sha256File(preparedPath)) !== replacement.afterSha256
    ) {
      fail('PLAN_MIGRATION_HASH_MISMATCH', 'Prepared replacement hash is invalid', {
        path: replacement.preparedPath,
      });
    }
  }
}

async function preflightAtomicRenamePrimitives(
  repoRoot,
  journalPath,
  packagePlan,
  options,
) {
  const preflight = options.atomicRenamePreflight ?? assertAtomicRenameSupport;
  await preflight(
    path.dirname(relativeToNative(repoRoot, packagePlan)),
  );
  await preflight(path.dirname(path.resolve(journalPath)));
}

async function verifyReplacementTargets(repoRoot, journal) {
  for (const [replacementIndex, replacement] of journal.replacements.entries()) {
    const targetPath = relativeToNative(repoRoot, replacement.path);
    const targetHash = (await exists(targetPath)) ? await sha256File(targetPath) : null;
    const operation = journal.pendingOperation;
    const operationOwnsTarget =
      operation !== null &&
      operation.replacementIndex === replacementIndex;
    const acceptedHashes = operationOwnsTarget
      ? [replacement.beforeSha256, replacement.afterSha256]
      : replacement.applied
        ? [replacement.afterSha256]
        : [replacement.beforeSha256];
    if (!acceptedHashes.includes(targetHash)) {
      fail(
        'PLAN_MIGRATION_HASH_MISMATCH',
        'Replacement target changed before transaction-wide apply',
        {
          path: replacement.path,
          expected: acceptedHashes,
          actual: targetHash,
        },
      );
    }
  }
}

async function applyReplacement(
  repoRoot,
  replacement,
  replacementIndex,
  options,
  journal,
) {
  const targetPath = relativeToNative(repoRoot, replacement.path);
  const preparedPath = relativeToNative(repoRoot, replacement.preparedPath);
  const backupPath = relativeToNative(repoRoot, replacement.backupPath);
  const preparedBytes = await fsp.readFile(preparedPath);
  if (sha256(preparedBytes) !== replacement.afterSha256) {
    fail('PLAN_MIGRATION_HASH_MISMATCH', 'Prepared replacement hash is invalid', {
      path: replacement.preparedPath,
    });
  }

  if (journal.pendingOperation !== null) {
    if (
      journal.pendingOperation.purpose !== 'apply-replacement' ||
      journal.pendingOperation.replacementIndex !== replacementIndex
    ) {
      fail(
        'PLAN_MIGRATION_RECOVERY_REQUIRED',
        'Pending filesystem operation does not match the replacement being applied',
      );
    }
    await settlePendingOperation(repoRoot, journal, options, {
      execute: true,
      beforeAtomic: `before-replacement-exchange:${replacement.path}`,
      afterAtomic:
        `after-replacement-exchange-before-validation:${replacement.path}`,
    });
  }

  const target = await fileSnapshot(targetPath);
  const targetHash = target?.sha256 ?? null;
  if (targetHash === replacement.afterSha256) {
    if (!replacement.applied) {
      fail(
        'PLAN_MIGRATION_HASH_MISMATCH',
        'Unjournaled after-state has no pending filesystem operation',
        { path: replacement.path },
      );
    }
    return;
  }
  if (targetHash !== replacement.beforeSha256) {
    fail('PLAN_MIGRATION_HASH_MISMATCH', 'Replacement target does not match before hash', {
      path: replacement.path,
      expected: replacement.beforeSha256,
      actual: targetHash,
    });
  }

  await invokeFailpoint(
    options,
    `after-replacement-before-image:${replacement.path}`,
    journal,
  );
  if (await exists(backupPath)) {
    if ((await sha256File(backupPath)) !== replacement.afterSha256) {
      fail('PLAN_MIGRATION_HASH_MISMATCH', 'Replacement exchange carrier is invalid', {
        path: replacement.backupPath,
      });
    }
  } else {
    await atomicWrite(backupPath, preparedBytes, { expectedAbsent: true });
  }
  await beginPendingOperation(repoRoot, journal, options, {
    kind:
      replacement.beforeSha256 === null
        ? 'move-no-replace'
        : 'exchange',
    purpose: 'apply-replacement',
    replacementIndex,
    sourcePath: replacement.backupPath,
    destinationPath: replacement.path,
    sourceSha256: replacement.afterSha256,
    destinationSha256: replacement.beforeSha256,
  });
  await settlePendingOperation(repoRoot, journal, options, {
    execute: true,
    beforeAtomic:
      replacement.beforeSha256 === null
        ? `before-replacement-create:${replacement.path}`
        : `before-replacement-exchange:${replacement.path}`,
    afterAtomic:
      `after-replacement-operation-before-validation:${replacement.path}`,
  });
  if ((await sha256File(targetPath)) !== replacement.afterSha256) {
    fail('PLAN_MIGRATION_HASH_MISMATCH', 'Replacement target hash is invalid after write', {
      path: replacement.path,
    });
  }
}

async function removeLegacyPlan(repoRoot, journal, options) {
  const legacyPath = relativeToNative(repoRoot, journal.legacyPlan);
  const legacyBackupPath = relativeToNative(repoRoot, journal.legacyBackupPath);
  if (journal.pendingOperation !== null) {
    if (journal.pendingOperation.purpose !== 'remove-legacy') {
      fail(
        'PLAN_MIGRATION_RECOVERY_REQUIRED',
        'Pending filesystem operation does not match legacy removal',
      );
    }
    await settlePendingOperation(repoRoot, journal, options, {
      execute: true,
      beforeAtomic: 'before-legacy-move',
      afterAtomic: 'after-legacy-move-before-validation',
    });
  }
  if (!(await exists(legacyPath))) {
    if (
      !(await exists(legacyBackupPath)) ||
      (await sha256File(legacyBackupPath)) !== journal.legacySha256
    ) {
      fail(
        'PLAN_MIGRATION_HASH_MISMATCH',
        'Removed legacy plan has no valid migration backup',
        { path: journal.legacyBackupPath },
      );
    }
    return;
  }
  if (await exists(legacyBackupPath)) {
    fail(
      'PLAN_MIGRATION_HASH_MISMATCH',
      'Legacy plan and migration backup cannot both be live before removal',
      {
        legacyPath: journal.legacyPlan,
        backupPath: journal.legacyBackupPath,
      },
    );
  }
  if ((await sha256File(legacyPath)) !== journal.legacySha256) {
    fail('PLAN_MIGRATION_HASH_MISMATCH', 'Legacy plan changed before removal', {
      path: journal.legacyPlan,
    });
  }
  await invokeFailpoint(options, 'after-legacy-before-image', journal);
  await beginPendingOperation(repoRoot, journal, options, {
    kind: 'move-no-replace',
    purpose: 'remove-legacy',
    sourcePath: journal.legacyPlan,
    destinationPath: journal.legacyBackupPath,
    sourceSha256: journal.legacySha256,
  });
  await settlePendingOperation(repoRoot, journal, options, {
    execute: true,
    beforeAtomic: 'before-legacy-move',
    afterAtomic: 'after-legacy-move-before-validation',
  });
}

async function validateCommittedState(repoRoot, journal, options, lease) {
  await verifyReviewedJournalLineage(options, journal);
  await assertMigrationIdentity(repoRoot, journal, options);
  await verifyArchiveIntegrity(repoRoot, journal);
  await assertActiveWorkProjection(options, journal);
  if (!journal.activeWorkProjection.applied) {
    fail(
      'PLAN_MIGRATION_VERIFY_FAILED',
      'active_work projection disposition was not applied',
    );
  }
  if (journal.replacements.some((replacement) => !replacement.applied)) {
    fail(
      'PLAN_MIGRATION_VERIFY_FAILED',
      'Committed-state verification requires every replacement to be journaled as applied',
    );
  }
  await verifyReplacementTargets(repoRoot, journal);
  const packagePlanPath = relativeToNative(repoRoot, journal.packagePlan);
  const packagePlan = await loadPlanPackage(packagePlanPath, {
    repoRoot,
    migrationJournalPath: options.journalPath,
    migrationLockPath: options.lockPath,
    migrationOwnerToken: lease.ownerToken,
  });
  if (packagePlan.manifest.status !== journal.verification.expectedPackageStatus) {
    fail('PLAN_MIGRATION_VERIFY_FAILED', 'Package status does not match reviewed target', {
      expected: journal.verification.expectedPackageStatus,
      actual: packagePlan.manifest.status,
    });
  }
  if (await exists(relativeToNative(repoRoot, journal.legacyPlan))) {
    fail('PLAN_MIGRATION_VERIFY_FAILED', 'Legacy plan remains live after migration');
  }
  const remainingOldPathReferences = await scanOldPathReferences(repoRoot, journal);
  if (remainingOldPathReferences.length > 0) {
    fail(
      'PLAN_MIGRATION_VERIFY_FAILED',
      'Old-path references remain after migration',
      { remainingOldPathReferences },
    );
  }
  const packages = await discoverPlanPackages(
    relativeToNative(repoRoot, journal.verification.discoveryRoot),
    {
      repoRoot,
      migrationJournalPath: options.journalPath,
      migrationLockPath: options.lockPath,
      migrationOwnerToken: lease.ownerToken,
    },
  );
  const liveCount = packages.filter((candidate) =>
    LIVE_PLAN_STATUSES.has(candidate.manifest.status),
  ).length;
  if (liveCount !== journal.verification.expectedActivePlanCount) {
    fail('PLAN_MIGRATION_VERIFY_FAILED', 'Live Plan Package count is invalid', {
      expected: journal.verification.expectedActivePlanCount,
      actual: liveCount,
    });
  }
  await verifyArchiveIntegrity(repoRoot, journal);
  return packagePlan;
}

async function completeMigration(options, journal, lease) {
  const repoRoot = await fsp.realpath(path.resolve(options.repoRoot));
  await validateJournalPaths(repoRoot, journal);
  await assertLockOwned(lease);
  await verifyReviewedJournalLineage(options, journal);
  await assertMigrationIdentity(repoRoot, journal, options, {
    verifySourceDigest: journal.phase === 'PREPARED' || journal.phase === 'LOCKED',
  });
  await assertActiveWorkProjection(options, journal);
  await verifyReviewedInputs(repoRoot, journal, {
    allowRemovedReferences: journal.phase !== 'PREPARED',
  });

  if (journal.phase === 'PREPARED') {
    journal.phase = 'LOCKED';
    await writeJournal(options.journalPath, journal, options.clock);
    await invokeFailpoint(options, 'after-lock', journal);
  }
  await verifyPreparedState(repoRoot, journal);
  await verifyReplacementTargets(repoRoot, journal);

  if (journal.phase === 'LOCKED') {
    await assertMigrationIdentity(repoRoot, journal, options, {
      verifySourceDigest: true,
    });
    await verifyLegacyPlanIntegrity(repoRoot, journal);
    journal.phase = 'APPLYING';
    await writeJournal(options.journalPath, journal, options.clock);
  }
  if (journal.phase === 'APPLYING') {
    for (const [replacementIndex, replacement] of journal.replacements.entries()) {
      await assertLockOwned(lease);
      if (!replacement.applied) {
        await applyReplacement(
          repoRoot,
          replacement,
          replacementIndex,
          options,
          journal,
        );
        await writeJournal(options.journalPath, journal, options.clock);
        await invokeFailpoint(options, `after-replacement:${replacement.path}`, journal);
      } else {
        const targetPath = relativeToNative(repoRoot, replacement.path);
        if (!(await exists(targetPath)) || (await sha256File(targetPath)) !== replacement.afterSha256) {
          fail('PLAN_MIGRATION_HASH_MISMATCH', 'Applied replacement no longer matches journal', {
            path: replacement.path,
          });
        }
      }
    }
    await assertLockOwned(lease);
    await assertActiveWorkProjection(options, journal);
    if (!journal.activeWorkProjection.applied) {
      journal.activeWorkProjection.applied = true;
      await writeJournal(options.journalPath, journal, options.clock);
      await invokeFailpoint(options, 'after-active-work-projection', journal);
    }
    await invokeFailpoint(options, 'before-legacy-removal', journal);
    await assertLockOwned(lease);
    await removeLegacyPlan(repoRoot, journal, options);
    journal.phase = 'VERIFYING';
    await writeJournal(options.journalPath, journal, options.clock);
    await invokeFailpoint(options, 'after-legacy-removal', journal);
  }
  if (journal.phase === 'VERIFYING') {
    await assertLockOwned(lease);
    await validateCommittedState(repoRoot, journal, options, lease);
    await verifyArchiveIntegrity(repoRoot, journal);
    journal.phase = 'COMMITTED';
    await writeJournal(options.journalPath, journal, options.clock);
    await invokeFailpoint(options, 'after-commit-journal', journal);
  }
  return journal;
}

async function cleanupCommittedBackups(repoRoot, journal, options, lease) {
  if (journal.phase !== 'COMMITTED') return;
  await cleanupTerminalBackups(
    repoRoot,
    journal,
    options,
    lease,
    'commit',
  );
}

export async function commitPlanMigration(options) {
  const journal = await readPlanMigrationJournal(options.journalPath);
  if (journal.phase === 'COMMITTED') {
    return recoverPlanMigration({ ...options, strategy: 'complete' });
  }
  if (journal.phase !== 'PREPARED') {
    fail('PLAN_MIGRATION_RECOVERY_REQUIRED', 'Migration is not in PREPARED phase', {
      phase: journal.phase,
    });
  }
  const reviewedBytes = await verifyPreparedJournalReview(options, journal);
  const repoRoot = await fsp.realpath(path.resolve(options.repoRoot));
  await validateJournalPaths(repoRoot, journal);
  await assertMigrationIdentity(repoRoot, journal, options, {
    verifySourceDigest: true,
  });
  await assertActiveWorkProjection(options, journal);
  await verifyReviewedInputs(repoRoot, journal);
  await verifyPreparedState(repoRoot, journal);
  await verifyLegacyPlanIntegrity(repoRoot, journal);
  await verifyReplacementTargets(repoRoot, journal);
  await preflightAtomicRenamePrimitives(
    repoRoot,
    options.journalPath,
    journal.packagePlan,
    options,
  );
  await preserveReviewedJournal(options, reviewedBytes);
  const lease = await createOwnedLock(options.lockPath, journal);
  try {
    await verifyPreparedJournalReview(options, journal);
    await verifyReviewedJournalLineage(options, journal);
    await assertMigrationIdentity(repoRoot, journal, options, {
      verifySourceDigest: true,
    });
    await invokeFailpoint(options, 'after-owned-lock', journal);
    const result = await completeMigration(options, journal, lease);
    await cleanupCommittedBackups(repoRoot, result, options, lease);
    await invokeFailpoint(options, 'before-lock-release', result);
    await releaseLease(lease);
    return result;
  } catch (error) {
    await abandonLease(lease);
    throw error;
  }
}

async function restoreReplacement(
  repoRoot,
  replacement,
  replacementIndex,
  options,
  journal,
) {
  const targetPath = relativeToNative(repoRoot, replacement.path);
  const backupPath = relativeToNative(repoRoot, replacement.backupPath);
  if (journal.pendingOperation !== null) {
    if (
      journal.pendingOperation.purpose !== 'rollback-replacement' ||
      journal.pendingOperation.replacementIndex !== replacementIndex
    ) {
      fail(
        'PLAN_MIGRATION_RECOVERY_REQUIRED',
        'Pending filesystem operation does not match the replacement being rolled back',
      );
    }
    await settlePendingOperation(repoRoot, journal, options, {
      execute: true,
      beforeAtomic:
        replacement.beforeSha256 === null
          ? `before-rollback-move:${replacement.path}`
          : `before-rollback-exchange:${replacement.path}`,
      afterAtomic:
        `after-rollback-operation-before-validation:${replacement.path}`,
    });
  }

  const target = await fileSnapshot(targetPath);
  const targetHash = target?.sha256 ?? null;
  if (!replacement.applied) {
    if (targetHash !== replacement.beforeSha256) {
      fail('PLAN_MIGRATION_HASH_MISMATCH', 'Unapplied replacement target changed', {
        path: replacement.path,
      });
    }
    return;
  }
  if (targetHash !== replacement.afterSha256) {
    fail('PLAN_MIGRATION_HASH_MISMATCH', 'Applied replacement changed before rollback', {
      path: replacement.path,
    });
  }

  await invokeFailpoint(
    options,
    `after-rollback-before-image:${replacement.path}`,
    journal,
  );
  if (replacement.beforeSha256 === null) {
    await beginPendingOperation(repoRoot, journal, options, {
      kind: 'move-no-replace',
      purpose: 'rollback-replacement',
      replacementIndex,
      sourcePath: replacement.path,
      destinationPath: replacement.backupPath,
      sourceSha256: replacement.afterSha256,
    });
  } else {
    if (
      !(await exists(backupPath)) ||
      (await sha256File(backupPath)) !== replacement.beforeSha256
    ) {
      fail('PLAN_MIGRATION_HASH_MISMATCH', 'Rollback backup is missing or invalid', {
        path: replacement.backupPath,
      });
    }
    await beginPendingOperation(repoRoot, journal, options, {
      kind: 'exchange',
      purpose: 'rollback-replacement',
      replacementIndex,
      sourcePath: replacement.backupPath,
      destinationPath: replacement.path,
      sourceSha256: replacement.beforeSha256,
      destinationSha256: replacement.afterSha256,
    });
  }
  await settlePendingOperation(repoRoot, journal, options, {
    execute: true,
    beforeAtomic:
      replacement.beforeSha256 === null
        ? `before-rollback-move:${replacement.path}`
        : `before-rollback-exchange:${replacement.path}`,
    afterAtomic:
      `after-rollback-operation-before-validation:${replacement.path}`,
  });
}

async function rollbackMigration(options, journal, lease) {
  const repoRoot = await fsp.realpath(path.resolve(options.repoRoot));
  await validateJournalPaths(repoRoot, journal);
  await assertLockOwned(lease);
  await assertActiveWorkProjection(options, journal);
  if (journal.pendingOperation !== null) {
    await settlePendingOperation(repoRoot, journal, options, {
      execute: false,
    });
  }
  journal.phase = 'ROLLING_BACK';
  await writeJournal(options.journalPath, journal, options.clock);
  await invokeFailpoint(options, 'rollback-started', journal);

  for (const replacementIndex of [...journal.replacements.keys()].reverse()) {
    const replacement = journal.replacements[replacementIndex];
    await assertLockOwned(lease);
    await restoreReplacement(
      repoRoot,
      replacement,
      replacementIndex,
      options,
      journal,
    );
    await writeJournal(options.journalPath, journal, options.clock);
    await invokeFailpoint(options, `after-rollback:${replacement.path}`, journal);
  }
  const legacyPath = relativeToNative(repoRoot, journal.legacyPlan);
  const legacyBackupPath = relativeToNative(repoRoot, journal.legacyBackupPath);
  const archivePath = relativeToNative(repoRoot, archivePathFor(journal.packagePlan));
  if (await exists(legacyPath)) {
    if ((await sha256File(legacyPath)) !== journal.legacySha256) {
      fail('PLAN_MIGRATION_HASH_MISMATCH', 'Legacy plan changed before rollback');
    }
    if (await exists(legacyBackupPath)) {
      fail(
        'PLAN_MIGRATION_HASH_MISMATCH',
        'Legacy plan and migration backup are both live during rollback',
      );
    }
  } else {
    if (
      !(await exists(legacyBackupPath)) ||
      (await sha256File(legacyBackupPath)) !== journal.legacySha256
    ) {
      fail('PLAN_MIGRATION_HASH_MISMATCH', 'Legacy migration backup is invalid');
    }
    await beginPendingOperation(repoRoot, journal, options, {
      kind: 'move-no-replace',
      purpose: 'restore-legacy',
      sourcePath: journal.legacyBackupPath,
      destinationPath: journal.legacyPlan,
      sourceSha256: journal.legacySha256,
    });
    await settlePendingOperation(repoRoot, journal, options, {
      execute: true,
      beforeAtomic: 'before-legacy-restore',
      afterAtomic: 'after-legacy-restore-before-validation',
    });
  }
  if (
    !(await exists(archivePath)) ||
    (await sha256File(archivePath)) !== journal.archiveSha256
  ) {
    fail(
      'PLAN_MIGRATION_HASH_MISMATCH',
      'Migration archive changed before rollback completed',
    );
  }
  await validateRolledBackState(repoRoot, journal);
  journal.activeWorkProjection.applied = false;
  journal.phase = 'ROLLED_BACK';
  await writeJournal(options.journalPath, journal, options.clock);
  return journal;
}

async function validateRolledBackState(repoRoot, journal) {
  for (const replacement of journal.replacements) {
    const targetPath = relativeToNative(repoRoot, replacement.path);
    if (replacement.beforeSha256 === null) {
      if (await exists(targetPath)) {
        fail(
          'PLAN_MIGRATION_HASH_MISMATCH',
          'Created replacement remains after rollback',
          { path: replacement.path },
        );
      }
      continue;
    }
    if (
      !(await exists(targetPath)) ||
      (await sha256File(targetPath)) !== replacement.beforeSha256
    ) {
      fail(
        'PLAN_MIGRATION_HASH_MISMATCH',
        'Rolled-back replacement target is invalid',
        { path: replacement.path },
      );
    }
  }
  if (
    (await sha256File(relativeToNative(repoRoot, journal.legacyPlan))) !==
      journal.legacySha256 ||
    (await sha256File(
      relativeToNative(repoRoot, archivePathFor(journal.packagePlan)),
    )) !== journal.archiveSha256
  ) {
    fail(
      'PLAN_MIGRATION_HASH_MISMATCH',
      'Rolled-back legacy or archive bytes are invalid',
    );
  }
}

function cleanupCapturedPath(sourcePath, journal) {
  return `${sourcePath}.cleanup-${journal.migrationId}`;
}

function cleanupDeletePath(sourcePath, journal) {
  return `${cleanupCapturedPath(sourcePath, journal)}.delete`;
}

function cleanupFenceSpecifications(mode, journal) {
  return [
    ...journal.replacements.map((replacement) => ({
      path: replacement.path,
      expectedSha256:
        mode === 'commit'
          ? replacement.afterSha256
          : replacement.beforeSha256,
    })),
    {
      path: journal.legacyPlan,
      expectedSha256: mode === 'commit' ? null : journal.legacySha256,
    },
    {
      path: archivePathFor(journal.packagePlan),
      expectedSha256: journal.archiveSha256,
    },
  ];
}

function cleanupCaptureSpecifications(mode, journal) {
  return [
    ...journal.replacements.map((replacement) => ({
      sourcePath: replacement.backupPath,
      expectedSha256:
        mode === 'commit' && replacement.beforeSha256 !== null
          ? replacement.beforeSha256
          : replacement.afterSha256,
      presence:
        mode === 'rollback'
          ? 'optional'
          : replacement.beforeSha256 === null
            ? 'absent'
            : 'required',
    })),
    {
      sourcePath: journal.legacyBackupPath,
      expectedSha256: journal.legacySha256,
      presence: mode === 'commit' ? 'required' : 'absent',
    },
  ].map((specification) => ({
    ...specification,
    capturedPath: cleanupCapturedPath(specification.sourcePath, journal),
    deletePath: cleanupDeletePath(specification.sourcePath, journal),
  }));
}

function assertCleanupDerivedShape(journal) {
  if (journal.cleanup === null) return;
  const expectedFence = cleanupFenceSpecifications(
    journal.cleanup.mode,
    journal,
  );
  const actualFence = journal.cleanup.fence.map((entry) => ({
    path: entry.path,
    expectedSha256: entry.expectedSha256,
  }));
  const expectedCaptures = cleanupCaptureSpecifications(
    journal.cleanup.mode,
    journal,
  ).map((capture) => ({
    sourcePath: capture.sourcePath,
    capturedPath: capture.capturedPath,
    deletePath: capture.deletePath,
    expectedSha256: capture.expectedSha256,
    presence: capture.presence,
  }));
  const actualCaptures = journal.cleanup.captures.map((capture) => ({
    sourcePath: capture.sourcePath,
    capturedPath: capture.capturedPath,
    deletePath: capture.deletePath,
    expectedSha256: capture.expectedSha256,
    presence: capture.presence,
  }));
  if (
    JSON.stringify(actualFence) !== JSON.stringify(expectedFence) ||
    JSON.stringify(actualCaptures) !== JSON.stringify(expectedCaptures)
  ) {
    fail(
      'PLAN_MIGRATION_JOURNAL_INVALID',
      'Cleanup paths or expected hashes do not derive from the reviewed migration',
    );
  }
}

async function expectedFileSnapshot(
  repoRoot,
  relativePath,
  expectedSha256,
  context,
) {
  const snapshot = await fileSnapshot(relativeToNative(repoRoot, relativePath));
  if (
    (expectedSha256 === null && snapshot !== null) ||
    (expectedSha256 !== null &&
      (snapshot === null || snapshot.sha256 !== expectedSha256))
  ) {
    fail(
      'PLAN_MIGRATION_HASH_MISMATCH',
      `${context} does not match the terminal migration state`,
      {
        path: relativePath,
        expected: expectedSha256,
        actual: snapshot?.sha256 ?? null,
      },
    );
  }
  return snapshot;
}

async function initializeCleanupBatch(
  repoRoot,
  journal,
  options,
  mode,
) {
  if (journal.cleanup !== null) {
    assertCleanupDerivedShape(journal);
    return;
  }
  const fence = [];
  for (const specification of cleanupFenceSpecifications(mode, journal)) {
    fence.push({
      ...specification,
      snapshot: await expectedFileSnapshot(
        repoRoot,
        specification.path,
        specification.expectedSha256,
        `${mode} cleanup fence`,
      ),
    });
  }

  const captures = [];
  for (const specification of cleanupCaptureSpecifications(mode, journal)) {
    const captured = await fileSnapshot(
      relativeToNative(repoRoot, specification.capturedPath),
    );
    const deletion = await fileSnapshot(
      relativeToNative(repoRoot, specification.deletePath),
    );
    if (captured !== null || deletion !== null) {
      fail(
        'PLAN_CONCURRENT_MODIFICATION',
        'Cleanup private path already exists before the cleanup batch',
        {
          sourcePath: specification.sourcePath,
          capturedPath: specification.capturedPath,
          deletePath: specification.deletePath,
        },
      );
    }
    const snapshot = await fileSnapshot(
      relativeToNative(repoRoot, specification.sourcePath),
    );
    if (
      (specification.presence === 'required' && snapshot === null) ||
      (specification.presence === 'absent' && snapshot !== null) ||
      (snapshot !== null &&
        snapshot.sha256 !== specification.expectedSha256)
    ) {
      fail(
        'PLAN_MIGRATION_HASH_MISMATCH',
        'Cleanup backup does not match the terminal migration state',
        {
          path: specification.sourcePath,
          presence: specification.presence,
          expected: specification.expectedSha256,
          actual: snapshot?.sha256 ?? null,
        },
      );
    }
    captures.push({
      ...specification,
      snapshot,
      state: snapshot === null ? 'absent' : 'pending',
    });
  }

  journal.cleanup = {
    mode,
    state: 'CAPTURING',
    fence,
    captures,
  };
  await writeJournal(options.journalPath, journal, options.clock);
}

function cleanupCaptureFailpoint(journal, mode, capture) {
  if (capture.sourcePath === journal.legacyBackupPath) {
    return mode === 'commit'
      ? 'before-legacy-backup-cleanup'
      : 'before-legacy-rollback-backup-cleanup';
  }
  const replacement = journal.replacements.find(
    (candidate) => candidate.backupPath === capture.sourcePath,
  );
  return replacement
    ? `before-${mode === 'commit' ? 'commit' : 'rollback'}-backup-cleanup:${replacement.path}`
    : null;
}

async function captureCleanupBackups(
  repoRoot,
  journal,
  options,
  lease,
) {
  for (const capture of journal.cleanup.captures) {
    await assertLockOwned(lease);
    const sourcePath = relativeToNative(repoRoot, capture.sourcePath);
    const capturedPath = relativeToNative(repoRoot, capture.capturedPath);
    const deletePath = relativeToNative(repoRoot, capture.deletePath);
    let source = await fileSnapshot(sourcePath);
    let captured = await fileSnapshot(capturedPath);
    const deletion = await fileSnapshot(deletePath);
    if (deletion !== null) {
      fail(
        'PLAN_CONCURRENT_MODIFICATION',
        'Cleanup delete path appeared before validation',
        { path: capture.deletePath },
      );
    }
    if (capture.snapshot === null) {
      if (source !== null || captured !== null) {
        fail(
          'PLAN_CONCURRENT_MODIFICATION',
          'A cleanup backup appeared after the cleanup fence was recorded',
          {
            sourcePath: capture.sourcePath,
            capturedPath: capture.capturedPath,
          },
        );
      }
      capture.state = 'absent';
      continue;
    }

    if (
      sameFileSnapshot(source, capture.snapshot) &&
      captured === null
    ) {
      const compatibilityFailpoint = cleanupCaptureFailpoint(
        journal,
        journal.cleanup.mode,
        capture,
      );
      if (compatibilityFailpoint) {
        await invokeFailpoint(options, compatibilityFailpoint, journal);
      }
      await invokeFailpoint(
        options,
        `before-cleanup-backup-capture:${journal.cleanup.mode}:${capture.sourcePath}`,
        journal,
      );
      await atomicMoveFileNoReplace(sourcePath, capturedPath);
      await invokeFailpoint(
        options,
        `after-cleanup-backup-capture-before-journal:${journal.cleanup.mode}:${capture.sourcePath}`,
        journal,
      );
      source = await fileSnapshot(sourcePath);
      captured = await fileSnapshot(capturedPath);
    }
    if (
      source !== null ||
      !sameFileObject(captured, capture.snapshot)
    ) {
      fail(
        captured !== null &&
          captured.sha256 !== capture.expectedSha256
          ? 'PLAN_MIGRATION_HASH_MISMATCH'
          : 'PLAN_CONCURRENT_MODIFICATION',
        'Cleanup backup changed while it was captured',
        {
          sourcePath: capture.sourcePath,
          capturedPath: capture.capturedPath,
          source,
          captured,
        },
      );
    }
    capture.snapshot = captured;
    capture.state = 'captured';
    await writeJournal(options.journalPath, journal, options.clock);
  }
  journal.cleanup.state = 'CAPTURED';
  await writeJournal(options.journalPath, journal, options.clock);
  await invokeFailpoint(
    options,
    `after-cleanup-backups-captured:${journal.cleanup.mode}`,
    journal,
  );
}

async function assertCleanupFenceUnchanged(repoRoot, cleanup) {
  for (const entry of cleanup.fence) {
    const current = await fileSnapshot(
      relativeToNative(repoRoot, entry.path),
    );
    if (
      entry.snapshot === null
        ? current !== null
        : !sameFileSnapshot(current, entry.snapshot)
    ) {
      fail(
        current !== null &&
          entry.expectedSha256 !== null &&
          current.sha256 !== entry.expectedSha256
          ? 'PLAN_MIGRATION_HASH_MISMATCH'
          : 'PLAN_CONCURRENT_MODIFICATION',
        'Terminal migration state changed while backups were captured',
        {
          path: entry.path,
          expected: entry.snapshot,
          actual: current,
        },
      );
    }
  }
}

async function assertCleanupCapturesStable(repoRoot, cleanup) {
  for (const capture of cleanup.captures) {
    const source = await fileSnapshot(
      relativeToNative(repoRoot, capture.sourcePath),
    );
    const captured = await fileSnapshot(
      relativeToNative(repoRoot, capture.capturedPath),
    );
    const deletion = await fileSnapshot(
      relativeToNative(repoRoot, capture.deletePath),
    );
    const stable =
      capture.snapshot === null
        ? source === null && captured === null && deletion === null
        : source === null &&
          sameFileSnapshot(captured, capture.snapshot) &&
          deletion === null;
    if (!stable) {
      fail(
        captured !== null &&
          captured.sha256 !== capture.expectedSha256
          ? 'PLAN_MIGRATION_HASH_MISMATCH'
          : 'PLAN_CONCURRENT_MODIFICATION',
        'Captured cleanup backup changed before final validation',
        {
          sourcePath: capture.sourcePath,
          capturedPath: capture.capturedPath,
          deletePath: capture.deletePath,
          source,
          captured,
          deletion,
        },
      );
    }
  }
}

async function restoreCleanupBackups(
  repoRoot,
  journal,
  options,
  lease,
) {
  const stranded = [];
  for (const capture of [...journal.cleanup.captures].reverse()) {
    await assertLockOwned(lease);
    const sourcePath = relativeToNative(repoRoot, capture.sourcePath);
    const capturedPath = relativeToNative(repoRoot, capture.capturedPath);
    const deletePath = relativeToNative(repoRoot, capture.deletePath);
    const source = await fileSnapshot(sourcePath);
    const captured = await fileSnapshot(capturedPath);
    const deletion = await fileSnapshot(deletePath);
    if (deletion !== null || (captured !== null && source !== null)) {
      stranded.push({
        sourcePath: capture.sourcePath,
        capturedPath: capture.capturedPath,
        deletePath: capture.deletePath,
      });
      continue;
    }
    if (captured !== null) {
      await atomicMoveFileNoReplace(capturedPath, sourcePath);
    }
    capture.state =
      capture.snapshot === null ? 'absent' : 'restored';
    await writeJournal(options.journalPath, journal, options.clock);
  }
  if (stranded.length > 0) {
    fail(
      'PLAN_CONCURRENT_MODIFICATION',
      'Captured cleanup backups could not be restored without overwriting concurrent files',
      { stranded },
    );
  }
  journal.cleanup = null;
  await writeJournal(options.journalPath, journal, options.clock);
}

async function deleteValidatedCleanupCaptures(
  repoRoot,
  journal,
  options,
  lease,
) {
  for (const capture of journal.cleanup.captures) {
    await assertLockOwned(lease);
    if (capture.snapshot === null) {
      capture.state = 'absent';
      continue;
    }
    const capturedPath = relativeToNative(repoRoot, capture.capturedPath);
    const deletePath = relativeToNative(repoRoot, capture.deletePath);
    let captured = await fileSnapshot(capturedPath);
    let deletion = await fileSnapshot(deletePath);
    if (captured !== null && deletion !== null) {
      fail(
        'PLAN_CONCURRENT_MODIFICATION',
        'Cleanup capture and delete paths are both occupied',
        {
          capturedPath: capture.capturedPath,
          deletePath: capture.deletePath,
        },
      );
    }
    if (captured !== null) {
      if (!sameFileSnapshot(captured, capture.snapshot)) {
        fail(
          captured.sha256 !== capture.expectedSha256
            ? 'PLAN_MIGRATION_HASH_MISMATCH'
            : 'PLAN_CONCURRENT_MODIFICATION',
          'Cleanup capture changed before deletion',
          { path: capture.capturedPath },
        );
      }
      await invokeFailpoint(
        options,
        `before-cleanup-capture-delete:${journal.cleanup.mode}:${capture.sourcePath}`,
        journal,
      );
      await atomicMoveFileNoReplace(capturedPath, deletePath);
      await invokeFailpoint(
        options,
        `after-cleanup-capture-delete-before-unlink:${journal.cleanup.mode}:${capture.sourcePath}`,
        journal,
      );
      captured = await fileSnapshot(capturedPath);
      deletion = await fileSnapshot(deletePath);
    }
    if (captured !== null) {
      fail(
        'PLAN_CONCURRENT_MODIFICATION',
        'Cleanup capture path remained occupied after atomic deletion capture',
        { path: capture.capturedPath },
      );
    }
    if (deletion === null) {
      capture.state = 'deleted';
      await writeJournal(options.journalPath, journal, options.clock);
      continue;
    }
    if (!sameFileObject(deletion, capture.snapshot)) {
      try {
        await atomicMoveFileNoReplace(deletePath, capturedPath);
      } catch (restoreError) {
        fail(
          'PLAN_CONCURRENT_MODIFICATION',
          'Cleanup delete capture changed and could not be restored',
          {
            path: capture.deletePath,
            cause: restoreError.code,
          },
        );
      }
      fail(
        deletion.sha256 !== capture.expectedSha256
          ? 'PLAN_MIGRATION_HASH_MISMATCH'
          : 'PLAN_CONCURRENT_MODIFICATION',
        'Cleanup delete capture changed before unlink',
        { path: capture.deletePath },
      );
    }
    await fsp.unlink(deletePath);
    await fsyncDirectory(path.dirname(deletePath));
    capture.state = 'deleted';
    await writeJournal(options.journalPath, journal, options.clock);
  }
}

async function validateCleanupTerminalState(
  repoRoot,
  journal,
  options,
  lease,
  mode,
) {
  if (mode === 'commit') {
    await repairCommittedArchive(repoRoot, journal);
    await validateCommittedState(repoRoot, journal, options, lease);
  } else {
    await validateRolledBackState(repoRoot, journal);
  }
}

async function cleanupTerminalBackups(
  repoRoot,
  journal,
  options,
  lease,
  mode,
) {
  await assertLockOwned(lease);
  if (journal.cleanup?.state === 'DONE') {
    assertCleanupDerivedShape(journal);
    return;
  }
  if (journal.cleanup?.state === 'RESTORING') {
    await restoreCleanupBackups(repoRoot, journal, options, lease);
  }
  if (journal.cleanup === null) {
    await validateCleanupTerminalState(
      repoRoot,
      journal,
      options,
      lease,
      mode,
    );
    await initializeCleanupBatch(repoRoot, journal, options, mode);
  }
  assertCleanupDerivedShape(journal);
  if (journal.cleanup.mode !== mode) {
    fail(
      'PLAN_MIGRATION_JOURNAL_INVALID',
      'Cleanup mode does not match the requested terminal recovery',
    );
  }

  try {
    if (journal.cleanup.state === 'CAPTURING') {
      await captureCleanupBackups(
        repoRoot,
        journal,
        options,
        lease,
      );
    }
    if (journal.cleanup.state === 'CAPTURED') {
      await invokeFailpoint(
        options,
        `before-cleanup-final-validation:${mode}`,
        journal,
      );
      await validateCleanupTerminalState(
        repoRoot,
        journal,
        options,
        lease,
        mode,
      );
      await assertCleanupCapturesStable(repoRoot, journal.cleanup);
      await assertCleanupFenceUnchanged(repoRoot, journal.cleanup);
      await invokeFailpoint(
        options,
        `after-cleanup-final-validation-before-journal:${mode}`,
        journal,
      );
      journal.cleanup.state = 'VALIDATED';
      await writeJournal(options.journalPath, journal, options.clock);
    }
  } catch (error) {
    if (
      error instanceof PlanPackageError &&
      journal.cleanup !== null &&
      new Set(['CAPTURING', 'CAPTURED']).has(journal.cleanup.state)
    ) {
      journal.cleanup.state = 'RESTORING';
      await writeJournal(options.journalPath, journal, options.clock);
      await restoreCleanupBackups(repoRoot, journal, options, lease);
    }
    throw error;
  }

  if (journal.cleanup.state === 'VALIDATED') {
    await deleteValidatedCleanupCaptures(
      repoRoot,
      journal,
      options,
      lease,
    );
    journal.cleanup.state = 'DONE';
    await writeJournal(options.journalPath, journal, options.clock);
  }
}

async function cleanupRolledBackBackups(repoRoot, journal, options, lease) {
  if (journal.phase !== 'ROLLED_BACK') return;
  await cleanupTerminalBackups(
    repoRoot,
    journal,
    options,
    lease,
    'rollback',
  );
}

export async function recoverPlanMigration(options) {
  let journal = await readPlanMigrationJournal(options.journalPath);
  const strategy = options.strategy ?? 'auto';
  if (!new Set(['auto', 'complete', 'rollback']).has(strategy)) {
    fail('PLAN_MIGRATION_INVALID', 'Recovery strategy must be auto, complete, or rollback');
  }
  const repoRoot = await fsp.realpath(path.resolve(options.repoRoot));
  await validateJournalPaths(repoRoot, journal);
  await verifyReviewedJournalLineage(options, journal);
  await assertMigrationIdentity(repoRoot, journal, options, {
    verifySourceDigest: journal.phase === 'PREPARED' || journal.phase === 'LOCKED',
  });
  await assertActiveWorkProjection(options, journal);
  await verifyReviewedInputs(repoRoot, journal, {
    allowRemovedReferences: journal.phase !== 'PREPARED',
  });
  await preflightAtomicRenamePrimitives(
    repoRoot,
    options.journalPath,
    journal.packagePlan,
    options,
  );
  const lease = await acquireRecoveryLock(options.lockPath, journal, options);
  try {
    await verifyReviewedJournalLineage(options, journal);
    await assertMigrationIdentity(repoRoot, journal, options, {
      verifySourceDigest: journal.phase === 'PREPARED' || journal.phase === 'LOCKED',
    });
    await invokeFailpoint(options, 'after-recovery-lock', journal);
    if (journal.phase !== 'COMMITTED' && journal.phase !== 'ROLLED_BACK') {
      if (journal.phase === 'ROLLING_BACK') {
        if (strategy === 'complete') {
          fail(
            'PLAN_MIGRATION_RECOVERY_REQUIRED',
            'A rollback already in progress cannot switch to completion',
          );
        }
        journal = await rollbackMigration(options, journal, lease);
      } else if (strategy === 'rollback') {
        journal = await rollbackMigration(options, journal, lease);
      } else {
        try {
          journal = await completeMigration(options, journal, lease);
        } catch (error) {
          if (strategy === 'complete') throw error;
          journal = await readPlanMigrationJournal(options.journalPath);
          if (journal.phase !== 'COMMITTED') {
            journal = await rollbackMigration(options, journal, lease);
          }
        }
      }
    }
    await cleanupCommittedBackups(repoRoot, journal, options, lease);
    await cleanupRolledBackBackups(repoRoot, journal, options, lease);
    if (journal.phase === 'ROLLED_BACK') {
      await assertMigrationIdentity(repoRoot, journal, options, {
        verifySourceDigest: true,
      });
    }
    await invokeFailpoint(options, 'before-lock-release', journal);
    await releaseLease(lease);
    return journal;
  } catch (error) {
    await abandonLease(lease);
    throw error;
  }
}

export function migrationBlocksDiscovery(journal, lockExists) {
  validatePlanMigrationJournal(journal);
  return lockExists || LOCKED_PHASES.has(journal.phase);
}
