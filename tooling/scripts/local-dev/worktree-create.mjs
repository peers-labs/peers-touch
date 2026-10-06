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
  readWorkflowOwnerByDigest,
  workflowOwnerIsReleased,
} from './workflow-binding-store.mjs';
import { resolveCurrentWorkflowOwnerContext } from './workflow-owner-context.mjs';
import {
  sameWorkflowOwnerReference,
  validateWorkflowOwnerReference,
  workflowOwnerReferenceFromBinding,
} from './workflow-owner-reference.mjs';

export const WORKTREE_CREATION_KIND = 'peers-touch-worktree-creation';

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

function publishCreateOnce(file, record) {
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
    if (process.platform !== 'win32') {
      const descriptor = openSync(path.dirname(file), 'r');
      try {
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
    }
    return record;
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = readOwnedRecord(file, record.workspaceId);
    if (
      existing === null ||
      JSON.stringify(canonicalize(existing)) !==
        JSON.stringify(canonicalize(record))
    ) {
      fail(
        'WORKTREE_CREATION_IMMUTABLE',
        'worktree creation record already has different provenance',
      );
    }
    return existing;
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
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
  if (existsSync(targetRoot)) {
    fail('WORKTREE_CREATION_CONFLICT', 'target worktree path already exists', {
      targetRoot,
    });
  }
  try {
    execFileSync('git', ['check-ref-format', '--branch', branch], {
      cwd: sourceRoot,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    execFileSync(
      'git',
      ['worktree', 'add', '-b', branch, targetRoot, startPoint],
      {
        cwd: sourceRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  } catch (error) {
    fail('WORKTREE_CREATION_FAILED', 'git worktree creation failed', {
      cause: error?.stderr?.toString().trim() || String(error),
    });
  }

  try {
    const canonicalRoot = realpathSync(targetRoot);
    const workspaceId = workspaceIdForRoot(canonicalRoot);
    const actualRoot = realpathSync(
      gitValue(canonicalRoot, ['rev-parse', '--show-toplevel'], 'worktree root'),
    );
    const actualBranch = gitValue(
      canonicalRoot,
      ['branch', '--show-current'],
      'branch',
    );
    const head = gitValue(canonicalRoot, ['rev-parse', 'HEAD'], 'HEAD');
    if (actualRoot !== canonicalRoot || actualBranch !== branch) {
      fail(
        'WORKTREE_CREATION_FAILED',
        'created worktree identity does not match the request',
        { canonicalRoot, actualRoot, branch, actualBranch },
      );
    }
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
      creationActionReceiptDigest,
      createdAt: new Date(options.now ?? new Date()).toISOString(),
    };
    const record = { ...unsigned, digest: digestRecord(unsigned) };
    validateWorktreeCreation(record, workspaceId);
    return publishCreateOnce(
      creationPath({ home: options.home, workspaceId }),
      record,
    );
  } catch (error) {
    try {
      execFileSync('git', ['worktree', 'remove', '--force', targetRoot], {
        cwd: sourceRoot,
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      execFileSync('git', ['branch', '-D', branch], {
        cwd: sourceRoot,
        stdio: ['ignore', 'ignore', 'ignore'],
      });
    } catch {
      // The error below retains the original failure and target path.
    }
    if (error instanceof WorktreeCreationError) throw error;
    fail('WORKTREE_CREATION_FAILED', 'cannot persist worktree creation record', {
      targetRoot,
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
  const context = (
    dependencies.resolveCurrentWorkflowOwnerContext ??
    resolveCurrentWorkflowOwnerContext
  )({
    home: options.home,
    machineRoot: dependencies.machineRoot,
    workspaceRoot: sourceRoot,
    operationLabel: 'worktree-create',
  });
  if (
    context.workflowOwner === null ||
    context.actionReceiptDigest === null
  ) {
    fail(
      'WORKTREE_OWNER_CONTEXT_REQUIRED',
      'worktree creation requires the current main-session OWNER receipt',
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
