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
  readdirSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import {
  isDirectInvocation,
  machineWorkspacesPath,
  repoRoot,
  workspaceIdForRoot,
  workspaceWorkflowRootPath,
} from '../lib/machine-dev-paths.mjs';
import {
  WorkspaceLifecycleLockError,
  withWorkspaceLifecycleLockSync,
} from './workspace-lifecycle-lock.mjs';
import {
  readWorkflowOwnerByDigest,
  workflowOwnerIsReleased,
} from './workflow-binding-store.mjs';
import {
  resolveWorkflowOwnerCommandContext,
} from './workflow-owner-context.mjs';
import {
  sameWorkflowOwnerReference,
  validateWorkflowOwnerReference,
  workflowOwnerReferenceFromBinding,
} from './workflow-owner-reference.mjs';

export const WORKTREE_CREATION_KIND = 'peers-touch-worktree-creation';
export const WORKTREE_CREATION_TRANSACTION_KIND =
  'peers-touch-worktree-creation-transaction';

const WORKSPACE_ID = /^[0-9a-f]{16}$/;
const HEAD = /^[0-9a-f]{40,64}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const RECORD_KEYS = new Set([
  'branch',
  'createdAt',
  'createdBy',
  'creationActionReceiptDigest',
  'digest',
  'head',
  'kind',
  'name',
  'purpose',
  'schemaVersion',
  'sourceWorkspaceId',
  'workspaceId',
]);
const TRANSACTION_KEYS = new Set([
  'branch',
  'createdAt',
  'createdBy',
  'creationActionReceiptDigest',
  'digest',
  'head',
  'kind',
  'purpose',
  'schemaVersion',
  'sourceRoot',
  'sourceWorkspaceId',
  'targetRoot',
]);

export class WorktreeCreationError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'WorktreeCreationError';
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, message, detail = {}) {
  throw new WorktreeCreationError(code, message, detail);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
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

function requiredText(value, field, maxLength = 1024) {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value === '' ||
    value.length > maxLength ||
    value.includes('\0') ||
    value.includes('\n')
  ) {
    fail('WORKTREE_CREATION_INVALID', `${field} is invalid`, { field });
  }
  return value;
}

function validTimestamp(value) {
  return (
    typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function digestRecord(record) {
  const unsigned = { ...record };
  delete unsigned.digest;
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(unsigned)))
    .digest('hex');
}

function owned(metadata) {
  return typeof process.getuid !== 'function' || metadata.uid === process.getuid();
}

function ensurePrivateDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const metadata = lstatSync(directory);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    !owned(metadata)
  ) {
    fail(
      'WORKTREE_CREATION_STORE_INVALID',
      'worktree creation directory is not owner-controlled',
    );
  }
}

function creationPath(options = {}) {
  const workspaceId =
    options.workspaceId ??
    workspaceIdForRoot(path.resolve(options.workspaceRoot));
  if (!WORKSPACE_ID.test(workspaceId)) {
    fail('WORKTREE_CREATION_INVALID', 'workspaceId is invalid');
  }
  return path.join(
    workspaceWorkflowRootPath({
      home: options.home,
      workspaceId,
    }),
    'worktree-creation.json',
  );
}

function readOwnedRecord(file, expectedWorkspaceId) {
  if (!existsSync(file)) return null;
  const metadata = lstatSync(file);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    !owned(metadata) ||
    (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) ||
    metadata.size > 32 * 1024
  ) {
    fail(
      'WORKTREE_CREATION_STORE_INVALID',
      'worktree creation record is not owner-controlled',
    );
  }
  try {
    return validateWorktreeCreation(
      JSON.parse(readFileSync(file, 'utf8')),
      expectedWorkspaceId,
    );
  } catch (error) {
    if (error instanceof WorktreeCreationError) throw error;
    fail(
      'WORKTREE_CREATION_STORE_INVALID',
      'worktree creation record is not valid JSON',
    );
  }
}

function publishImmutable(
  file,
  record,
  readExisting,
  conflictCode,
  conflictMessage,
) {
  ensurePrivateDirectory(path.dirname(file));
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`,
  );
  try {
    const descriptor = openSync(temporary, 'wx', 0o600);
    try {
      writeFileSync(
        descriptor,
        `${JSON.stringify(canonicalize(record), null, 2)}\n`,
      );
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    linkSync(temporary, file);
    unlinkSync(temporary);
    chmodSync(file, 0o600);
    syncDirectory(path.dirname(file));
    return record;
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = readExisting(file);
    if (
      existing === null ||
      JSON.stringify(canonicalize(existing)) !==
        JSON.stringify(canonicalize(record))
    ) {
      fail(
        conflictCode,
        conflictMessage,
      );
    }
    return existing;
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function publishCreateOnce(file, record) {
  return publishImmutable(
    file,
    record,
    (candidate) => readOwnedRecord(candidate, record.workspaceId),
    'WORKTREE_CREATION_IMMUTABLE',
    'worktree creation record already has different provenance',
  );
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

function transactionPath(options) {
  const targetKey = createHash('sha256')
    .update(options.targetRoot)
    .digest('hex');
  return path.join(
    workspaceWorkflowRootPath({
      home: options.home,
      workspaceId: options.sourceWorkspaceId,
    }),
    'worktree-creation-transactions',
    `${targetKey}.json`,
  );
}

function validateCreationTransaction(transaction) {
  if (
    !exactKeys(transaction, TRANSACTION_KEYS) ||
    transaction.schemaVersion !== 1 ||
    transaction.kind !== WORKTREE_CREATION_TRANSACTION_KIND ||
    !WORKSPACE_ID.test(transaction.sourceWorkspaceId) ||
    !path.isAbsolute(transaction.sourceRoot) ||
    !path.isAbsolute(transaction.targetRoot) ||
    !HEAD.test(transaction.head) ||
    !SHA256.test(transaction.creationActionReceiptDigest) ||
    !validTimestamp(transaction.createdAt)
  ) {
    fail(
      'WORKTREE_CREATION_TRANSACTION_INVALID',
      'worktree creation transaction is invalid',
    );
  }
  for (const field of ['branch', 'purpose']) {
    requiredText(transaction[field], field);
  }
  validateWorkflowOwnerReference(transaction.createdBy);
  if (
    !SHA256.test(transaction.digest) ||
    digestRecord(transaction) !== transaction.digest
  ) {
    fail(
      'WORKTREE_CREATION_TRANSACTION_INVALID',
      'worktree creation transaction digest is invalid',
    );
  }
  return transaction;
}

function readCreationTransaction(file) {
  if (!existsSync(file)) return null;
  const metadata = lstatSync(file);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    !owned(metadata) ||
    (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) ||
    metadata.size > 32 * 1024
  ) {
    fail(
      'WORKTREE_CREATION_TRANSACTION_INVALID',
      'worktree creation transaction is not owner-controlled',
    );
  }
  let transaction;
  try {
    transaction = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    fail(
      'WORKTREE_CREATION_TRANSACTION_INVALID',
      'worktree creation transaction is not valid JSON',
      { cause: String(error) },
    );
  }
  return validateCreationTransaction(transaction);
}

function publishCreationTransaction(file, transaction) {
  const existing = readCreationTransaction(file);
  if (existing !== null) {
    if (
      JSON.stringify(canonicalize(existing)) !==
      JSON.stringify(canonicalize(transaction))
    ) {
      fail(
        'WORKTREE_CREATION_TRANSACTION_CONFLICT',
        'target path already has a different creation transaction',
        { targetRoot: transaction.targetRoot },
      );
    }
    return existing;
  }
  return publishImmutable(
    file,
    transaction,
    readCreationTransaction,
    'WORKTREE_CREATION_TRANSACTION_CONFLICT',
    'target path already has a different creation transaction',
  );
}

export function validateWorktreeCreation(record, expectedWorkspaceId) {
  if (
    !exactKeys(record, RECORD_KEYS) ||
    record.schemaVersion !== 1 ||
    record.kind !== WORKTREE_CREATION_KIND ||
    !WORKSPACE_ID.test(record.workspaceId) ||
    !WORKSPACE_ID.test(record.sourceWorkspaceId) ||
    !HEAD.test(record.head) ||
    !SHA256.test(record.creationActionReceiptDigest) ||
    !validTimestamp(record.createdAt)
  ) {
    fail('WORKTREE_CREATION_INVALID', 'worktree creation record is invalid');
  }
  for (const field of ['name', 'branch', 'purpose']) {
    requiredText(record[field], field);
  }
  validateWorkflowOwnerReference(record.createdBy);
  if (
    expectedWorkspaceId !== undefined &&
    record.workspaceId !== expectedWorkspaceId
  ) {
    fail(
      'WORKTREE_CREATION_INVALID',
      'worktree creation record belongs to another workspace',
    );
  }
  if (!SHA256.test(record.digest) || digestRecord(record) !== record.digest) {
    fail(
      'WORKTREE_CREATION_INVALID',
      'worktree creation record digest is invalid',
    );
  }
  return record;
}

export function readWorktreeCreation(options = {}) {
  const file = creationPath(options);
  const workspaceId = path.basename(path.dirname(path.dirname(file)));
  return readOwnedRecord(file, workspaceId);
}

export function readAllWorktreeCreations(options = {}) {
  const root = machineWorkspacesPath(options.home);
  if (!existsSync(root)) return { records: [], errors: [] };
  const records = [];
  const errors = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !WORKSPACE_ID.test(entry.name)) continue;
    try {
      const record = readWorktreeCreation({
        home: options.home,
        workspaceId: entry.name,
      });
      if (record) records.push(record);
    } catch (error) {
      errors.push({
        workspaceId: entry.name,
        code: error?.code ?? 'WORKTREE_CREATION_INVALID',
        message: error?.message ?? String(error),
      });
    }
  }
  records.sort((left, right) => left.workspaceId.localeCompare(right.workspaceId));
  errors.sort((left, right) => left.workspaceId.localeCompare(right.workspaceId));
  return { records, errors };
}

function gitValue(root, arguments_, field) {
  try {
    const value = execFileSync('git', arguments_, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    if (!value) throw new Error(`${field} is empty`);
    return value;
  } catch (error) {
    fail('WORKTREE_CREATION_FAILED', `cannot resolve ${field}`, {
      cause: error?.stderr?.toString().trim() || String(error),
    });
  }
}

function branchHead(sourceRoot, branch) {
  try {
    return execFileSync(
      'git',
      ['show-ref', '--verify', '--hash', `refs/heads/${branch}`],
      {
        cwd: sourceRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ).trim();
  } catch {
    return null;
  }
}

function sameCreationIntent(record, expected) {
  return (
    record.sourceWorkspaceId === expected.sourceWorkspaceId &&
    (record.sourceRoot === undefined ||
      record.sourceRoot === expected.sourceRoot) &&
    (record.targetRoot === undefined ||
      record.targetRoot === expected.targetRoot) &&
    record.branch === expected.branch &&
    record.head === expected.head &&
    record.purpose === expected.purpose &&
    sameWorkflowOwnerReference(record.createdBy, expected.createdBy)
  );
}

function verifyCreatedWorktree(targetRoot, branch, expectedHead) {
  let canonicalRoot;
  try {
    canonicalRoot = realpathSync(targetRoot);
  } catch (error) {
    fail(
      'WORKTREE_CREATION_RECOVERY_REQUIRED',
      'worktree creation transaction has no recoverable target',
      { targetRoot, cause: String(error) },
    );
  }
  const actualRoot = realpathSync(
    gitValue(canonicalRoot, ['rev-parse', '--show-toplevel'], 'worktree root'),
  );
  const actualBranch = gitValue(
    canonicalRoot,
    ['branch', '--show-current'],
    'branch',
  );
  const actualHead = gitValue(canonicalRoot, ['rev-parse', 'HEAD'], 'HEAD');
  if (
    actualRoot !== canonicalRoot ||
    actualBranch !== branch ||
    actualHead !== expectedHead
  ) {
    fail(
      'WORKTREE_CREATION_RECOVERY_REQUIRED',
      'created worktree identity does not match its durable transaction',
      {
        canonicalRoot,
        actualRoot,
        branch,
        actualBranch,
        expectedHead,
        actualHead,
      },
    );
  }
  return { canonicalRoot, workspaceId: workspaceIdForRoot(canonicalRoot) };
}

function createWorktreeUnderFence(options, sourceRoot, sourceWorkspaceId) {
  const requestedTargetRoot = requiredText(
    options.targetRoot,
    'targetRoot',
    4096,
  );
  if (!path.isAbsolute(requestedTargetRoot)) {
    fail(
      'WORKTREE_CREATION_INVALID',
      'targetRoot must be an absolute path',
    );
  }
  const targetRoot = path.resolve(requestedTargetRoot);
  const branch = requiredText(options.branch, 'branch');
  const startPoint = requiredText(options.startPoint ?? 'HEAD', 'startPoint');
  const purpose = requiredText(options.purpose, 'purpose');
  const createdBy = validateWorkflowOwnerReference(options.workflowOwner);
  const creationActionReceiptDigest = requiredText(
    options.creationActionReceiptDigest,
    'creationActionReceiptDigest',
    64,
  );
  if (!SHA256.test(creationActionReceiptDigest)) {
    fail(
      'WORKTREE_CREATION_INVALID',
      'creationActionReceiptDigest is invalid',
    );
  }
  const head = gitValue(
    sourceRoot,
    ['rev-parse', '--verify', '--end-of-options', `${startPoint}^{commit}`],
    'startPoint commit',
  );
  if (!HEAD.test(head)) {
    fail('WORKTREE_CREATION_INVALID', 'startPoint did not resolve to a commit');
  }
  execFileSync('git', ['check-ref-format', '--branch', branch], {
    cwd: sourceRoot,
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  const file = transactionPath({
    home: options.home,
    sourceWorkspaceId,
    targetRoot,
  });
  const existingTransaction = readCreationTransaction(file);
  const currentBranchHead = branchHead(sourceRoot, branch);
  const requestedIntent = {
    sourceWorkspaceId,
    sourceRoot,
    targetRoot,
    branch,
    head,
    purpose,
    createdBy,
  };
  if (existingTransaction === null && existsSync(targetRoot)) {
    const existingWorktree = verifyCreatedWorktree(targetRoot, branch, head);
    const existingRecord = readWorktreeCreation({
      home: options.home,
      workspaceId: existingWorktree.workspaceId,
    });
    if (
      existingRecord !== null &&
      sameCreationIntent(existingRecord, requestedIntent)
    ) {
      return existingRecord;
    }
  }
  if (
    existingTransaction === null &&
    (existsSync(targetRoot) || currentBranchHead !== null)
  ) {
    fail(
      'WORKTREE_CREATION_CONFLICT',
      'target path or branch already exists without a matching transaction',
      { targetRoot, branch },
    );
  }
  const unsignedTransaction = {
    schemaVersion: 1,
    kind: WORKTREE_CREATION_TRANSACTION_KIND,
    sourceWorkspaceId,
    sourceRoot,
    targetRoot,
    branch,
    head,
    purpose,
    createdBy,
    creationActionReceiptDigest:
      existingTransaction?.creationActionReceiptDigest ??
      creationActionReceiptDigest,
    createdAt:
      existingTransaction?.createdAt ??
      new Date(options.now ?? new Date()).toISOString(),
  };
  const transaction = {
    ...unsignedTransaction,
    digest: digestRecord(unsignedTransaction),
  };
  if (
    existingTransaction !== null &&
    !sameCreationIntent(existingTransaction, requestedIntent)
  ) {
    fail(
      'WORKTREE_CREATION_TRANSACTION_CONFLICT',
      'target path already has a different creation transaction',
      { targetRoot },
    );
  }
  validateCreationTransaction(transaction);
  publishCreationTransaction(file, transaction);

  if (!existsSync(targetRoot)) {
    const currentHead = branchHead(sourceRoot, branch);
    if (currentHead !== null && currentHead !== head) {
      fail(
        'WORKTREE_CREATION_RECOVERY_REQUIRED',
        'transaction branch no longer points at its resolved start commit',
        { branch, expectedHead: head, actualHead: currentHead },
      );
    }
    try {
      execFileSync(
        'git',
        currentHead === null
          ? ['worktree', 'add', '-b', branch, '--', targetRoot, head]
          : ['worktree', 'add', '--', targetRoot, branch],
        {
          cwd: sourceRoot,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
    } catch (error) {
      fail('WORKTREE_CREATION_RECOVERY_REQUIRED', 'git worktree creation failed', {
        targetRoot,
        branch,
        transaction: file,
        cause: error?.stderr?.toString().trim() || String(error),
      });
    }
  }

  const { canonicalRoot, workspaceId } = verifyCreatedWorktree(
    targetRoot,
    branch,
    head,
  );
  options.creationFailpoint?.('after-git-create', {
    transaction,
    workspaceId,
  });
  const unsigned = {
    schemaVersion: 1,
    kind: WORKTREE_CREATION_KIND,
    workspaceId,
    name: path.basename(canonicalRoot),
    branch,
    head,
    purpose,
    sourceWorkspaceId,
    createdBy,
    creationActionReceiptDigest: transaction.creationActionReceiptDigest,
    createdAt: transaction.createdAt,
  };
  const record = { ...unsigned, digest: digestRecord(unsigned) };
  validateWorktreeCreation(record, workspaceId);
  const published = publishCreateOnce(
    creationPath({ home: options.home, workspaceId }),
    record,
  );
  unlinkSync(file);
  syncDirectory(path.dirname(file));
  return published;
}

export function createWorktree(options = {}) {
  const requestedSourceRoot = realpathSync(
    path.resolve(options.sourceRoot ?? repoRoot),
  );
  const sourceRoot = realpathSync(
    gitValue(
      requestedSourceRoot,
      ['rev-parse', '--show-toplevel'],
      'source worktree root',
    ),
  );
  if (sourceRoot !== requestedSourceRoot) {
    fail(
      'WORKTREE_CREATION_INVALID',
      'sourceRoot must be the Git worktree root',
      { requestedSourceRoot, sourceRoot },
    );
  }
  const sourceWorkspaceId = workspaceIdForRoot(sourceRoot);
  const createdBy = validateWorkflowOwnerReference(options.workflowOwner);
  const owner = (options.readOwnerByDigest ?? readWorkflowOwnerByDigest)(
    createdBy.rootBindingDigest,
    {
      home: options.home,
      machineRoot: options.machineRoot,
    },
  );
  if (
    owner.executionRoot !== sourceRoot ||
    workflowOwnerIsReleased(owner, {
      home: options.home,
      machineRoot: options.machineRoot,
    }) ||
    !sameWorkflowOwnerReference(
      workflowOwnerReferenceFromBinding(owner),
      createdBy,
    )
  ) {
    fail(
      'WORKTREE_OWNER_CONTEXT_MISMATCH',
      'worktree creator does not match the live source-workspace OWNER',
      { sourceWorkspaceId, rootBindingDigest: createdBy.rootBindingDigest },
    );
  }
  try {
    return withWorkspaceLifecycleLockSync(
      {
        home: options.home,
        workspaceRoot: sourceRoot,
        workspaceId: sourceWorkspaceId,
        lockTimeoutMs: options.lockTimeoutMs,
      },
      () => createWorktreeUnderFence(options, sourceRoot, sourceWorkspaceId),
    );
  } catch (error) {
    if (error instanceof WorkspaceLifecycleLockError) {
      fail(error.code, error.message, error.detail);
    }
    if (error instanceof WorktreeCreationError) throw error;
    fail('WORKTREE_CREATION_FAILED', 'worktree creation transaction failed', {
      cause: String(error),
    });
  }
}

function parseArguments(argv) {
  const [action, ...tokens] = argv;
  const options = {};
  for (let index = 0; index < tokens.length; index += 2) {
    const token = tokens[index];
    const value = tokens[index + 1];
    if (!token?.startsWith('--') || value === undefined) {
      fail('WORKTREE_CREATION_USAGE', 'worktree command arguments are invalid');
    }
    options[token.slice(2)] = value;
  }
  if (!['create', 'status'].includes(action)) {
    fail('WORKTREE_CREATION_USAGE', 'action must be create or status');
  }
  return { action, options };
}

export function runWorktreeCreationCli(argv, dependencies = {}) {
  const { action, options } = parseArguments(argv);
  if (action === 'status') {
    return readWorktreeCreation({
      home: options.home,
      workspaceRoot: options['workspace-root'] ?? repoRoot,
      workspaceId: options['workspace-id'],
    });
  }
  const sourceRoot = options['source-root'] ?? repoRoot;
  let context;
  try {
    context = resolveWorkflowOwnerCommandContext(
      'worktree',
      'create',
      {
        home: options.home,
        machineRoot: dependencies.machineRoot,
        workspaceRoot: sourceRoot,
        resolveCurrentWorkflowOwnerContext:
          dependencies.resolveCurrentWorkflowOwnerContext,
      },
    );
  } catch (error) {
    if (error?.code !== 'WORKFLOW_OWNER_CONTEXT_REQUIRED') throw error;
    fail(
      'WORKTREE_OWNER_CONTEXT_REQUIRED',
      'worktree creation requires the current main-session OWNER receipt',
      error.detail,
    );
  }
  return (dependencies.createWorktree ?? createWorktree)({
    home: options.home,
    machineRoot: dependencies.machineRoot,
    sourceRoot,
    targetRoot: options.path,
    branch: options.branch,
    startPoint: options.start,
    purpose: options.purpose,
    workflowOwner: context.workflowOwner,
    creationActionReceiptDigest: context.actionReceiptDigest,
  });
}

if (isDirectInvocation(import.meta.url)) {
  try {
    process.stdout.write(
      `${JSON.stringify(runWorktreeCreationCli(process.argv.slice(2)), null, 2)}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        status: 'BLOCKED',
        code: error?.code ?? 'WORKTREE_CREATION_FAILED',
        message: error?.message ?? String(error),
        detail: error?.detail ?? {},
      })}\n`,
    );
    process.exitCode = 2;
  }
}
