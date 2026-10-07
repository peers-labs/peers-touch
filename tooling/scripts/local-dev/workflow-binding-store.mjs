import { createHash, randomBytes } from 'node:crypto';
import {
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
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';

import {
  machineDevRoot,
  workspaceIdForRoot,
} from '../lib/machine-dev-paths.mjs';
import {
  hashWorkflowRootChatIdentity,
  workflowOwnerReferenceFromBinding,
} from './workflow-owner-reference.mjs';
import {
  projectWorkflowBinding,
} from './workflow-binding-projection.mjs';
import {
  validateActiveWorkRecord,
} from './active-work-store.mjs';
import {
  validateSession,
} from './dev-session-schema.mjs';

const HOSTS = new Set(['trae', 'cursor', 'codex']);
const CHILD_ROLES = new Set(['WORKER', 'REVIEWER']);
const TERMINAL_RESULTS = new Set(['PASS', 'FAIL', 'BLOCKED', 'CANCELLED']);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const LEGACY_OWNER_KEYS = new Set([
  'bindingEvent',
  'boundAt',
  'digest',
  'executionRoot',
  'host',
  'kind',
  'role',
  'rootChatHash',
  'workspaceId',
]);
const OWNER_KEYS = new Set([...LEGACY_OWNER_KEYS, 'rootChatId']);
const ASSIGNMENT_KEYS = new Set([
  'assignmentId',
  'digest',
  'issuedAt',
  'kind',
  'leaseUntil',
  'operationId',
  'parentBindingDigest',
  'role',
  'rootBindingDigest',
  'workflowSessionId',
]);
const ASSIGNMENT_CLAIM_KEYS = new Set([
  'assignmentDigest',
  'digest',
  'executionSessionHash',
  'host',
  'kind',
  'rootBindingDigest',
  'workflowSessionId',
]);
const CHILD_KEYS = new Set([
  'assignmentDigest',
  'boundAt',
  'digest',
  'executionRoot',
  'executionSessionHash',
  'host',
  'kind',
  'parentBindingDigest',
  'role',
  'rootBindingDigest',
  'workflowSessionId',
  'workspaceId',
]);
const TERMINAL_KEYS = new Set([
  'childBindingDigest',
  'digest',
  'kind',
  'result',
  'terminalAt',
]);
const ANCHOR_KEYS = new Set([
  'anchorDigest',
  'content',
  'digest',
  'kind',
  'renderedAt',
  'rootBindingDigest',
  'status',
]);
const RELEASE_KEYS = new Set([
  'anchorDigest',
  'digest',
  'kind',
  'releasedAt',
  'rootBindingDigest',
]);
const COMPACT_KEYS = new Set([
  'assignmentDigest',
  'bindingDigest',
  'compactId',
  'digest',
  'executionRoot',
  'kind',
  'parentBindingDigest',
  'postCompactAt',
  'preCompactAt',
  'role',
  'rootBindingDigest',
  'workflowSessionId',
  'workspaceId',
]);

export class WorkflowBindingError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'WorkflowBindingError';
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, message, detail = {}) {
  throw new WorkflowBindingError(code, message, detail);
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

function digest(value) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function hostIdentityHash(host, kind, value) {
  if (
    !HOSTS.has(host) ||
    !['root', 'execution'].includes(kind) ||
    typeof value !== 'string' ||
    !value
  ) {
    fail('WORKFLOW_BINDING_IDENTITY_INVALID', 'Host identity is invalid');
  }
  return createHash('sha256')
    .update(`${host}\0${kind}\0${value}`)
    .digest('hex');
}

export function rootChatHash(host, rootChatId) {
  return hashWorkflowRootChatIdentity(host, rootChatId);
}

export function executionSessionHash(host, executionSessionId) {
  return hostIdentityHash(host, 'execution', executionSessionId);
}

function operationDate(value = new Date()) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    fail('WORKFLOW_BINDING_CLOCK_INVALID', 'Workflow binding clock is invalid');
  }
  return date;
}

function owned(metadata) {
  return typeof process.getuid !== 'function' || metadata.uid === process.getuid();
}

function ensurePrivateDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const metadata = lstatSync(directory);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    !owned(metadata) ||
    (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0)
  ) {
    fail(
      'WORKFLOW_BINDING_STORE_INVALID',
      `${directory} is not an owner-controlled directory`,
    );
  }
}

function assertPrivateDirectory(directory) {
  const metadata = lstatSync(directory);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    !owned(metadata) ||
    (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0)
  ) {
    fail(
      'WORKFLOW_BINDING_STORE_INVALID',
      `${directory} is not an owner-controlled directory`,
    );
  }
}

function machineRoot(options = {}) {
  const root = path.resolve(options.machineRoot ?? machineDevRoot(options.home));
  ensurePrivateDirectory(root);
  return root;
}

function bindingsRoot(options = {}, create = true) {
  const root = path.join(
    path.resolve(options.machineRoot ?? machineDevRoot(options.home)),
    'bindings',
  );
  if (create) {
    machineRoot(options);
    ensurePrivateDirectory(root);
  } else if (existsSync(root)) {
    assertPrivateDirectory(root);
  }
  return root;
}

function ownerDirectory(host, hash, options = {}, create = true) {
  if (!HOSTS.has(host) || !SHA256.test(hash)) {
    fail('WORKFLOW_BINDING_IDENTITY_INVALID', 'Owner locator is invalid');
  }
  const root = bindingsRoot(options, create);
  const owners = path.join(root, 'owners');
  const hostRoot = path.join(owners, host);
  const directory = path.join(hostRoot, hash);
  if (create) {
    ensurePrivateDirectory(owners);
    ensurePrivateDirectory(hostRoot);
    ensurePrivateDirectory(directory);
  }
  return directory;
}

function childDirectory(
  rootBindingDigest,
  host,
  executionHash,
  options = {},
  create = true,
) {
  if (
    !SHA256.test(rootBindingDigest) ||
    !HOSTS.has(host) ||
    !SHA256.test(executionHash)
  ) {
    fail('WORKFLOW_BINDING_IDENTITY_INVALID', 'Child locator is invalid');
  }
  const root = bindingsRoot(options, create);
  const children = path.join(root, 'children');
  const lineage = path.join(children, rootBindingDigest);
  const hostRoot = path.join(lineage, host);
  const directory = path.join(hostRoot, executionHash);
  if (create) {
    ensurePrivateDirectory(children);
    ensurePrivateDirectory(lineage);
    ensurePrivateDirectory(hostRoot);
    ensurePrivateDirectory(directory);
  }
  return directory;
}

function readOwnedJson(file, code, required = false) {
  if (!existsSync(file)) {
    if (required) fail(code, `${file} is missing`);
    return null;
  }
  const metadata = lstatSync(file);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    !owned(metadata) ||
    (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) ||
    metadata.size > 128 * 1024
  ) {
    fail(code, `${file} is not an owner-controlled bounded file`);
  }
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    fail(code, `${file} is not valid JSON`);
  }
}

function writeFileDurably(file, value) {
  const descriptor = openSync(file, 'wx', 0o600);
  try {
    writeSync(descriptor, `${JSON.stringify(canonicalize(value), null, 2)}\n`);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function fsyncDirectory(directory) {
  if (process.platform === 'win32') return;
  const descriptor = openSync(directory, 'r');
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function temporaryPath(file) {
  return path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`,
  );
}

function publishCreateOnce(
  file,
  value,
  validator,
  equivalent = (left, right) =>
    JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right)),
) {
  const temporary = temporaryPath(file);
  try {
    writeFileDurably(temporary, value);
    linkSync(temporary, file);
    fsyncDirectory(path.dirname(file));
    return { created: true, value };
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = validator(
      readOwnedJson(file, 'WORKFLOW_BINDING_STORE_INVALID', true),
    );
    if (!equivalent(existing, value)) {
      fail(
        'WORKFLOW_BINDING_IMMUTABLE',
        'Create-once workflow binding record already has different bytes',
        { file },
      );
    }
    return { created: false, value: existing };
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function replaceCurrent(file, value) {
  if (existsSync(file)) {
    const metadata = lstatSync(file);
    if (!metadata.isFile() || metadata.isSymbolicLink() || !owned(metadata)) {
      fail(
        'WORKFLOW_BINDING_STORE_INVALID',
        `${file} is not an owner-controlled file`,
      );
    }
  }
  const temporary = temporaryPath(file);
  try {
    writeFileDurably(temporary, value);
    renameSync(temporary, file);
    fsyncDirectory(path.dirname(file));
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function hasExactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.size &&
    Object.keys(value).every((key) => keys.has(key))
  );
}

function timestamp(value) {
  return (
    typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function validateDigestRecord(value, keys, kind, code) {
  if (!hasExactKeys(value, keys) || value.kind !== kind) {
    fail(code, `${kind} has an invalid shape`);
  }
  const unsigned = { ...value };
  delete unsigned.digest;
  if (!SHA256.test(value.digest) || digest(unsigned) !== value.digest) {
    fail(code, `${kind} digest does not match`);
  }
  return value;
}

export function validateWorkflowOwnerBinding(value, expected = {}) {
  const legacy = hasExactKeys(value, LEGACY_OWNER_KEYS);
  if (!legacy && !hasExactKeys(value, OWNER_KEYS)) {
    fail(
      'WORKFLOW_OWNER_BINDING_INVALID',
      'peers-touch-workflow-owner-binding has an invalid shape',
    );
  }
  if (value.kind !== 'peers-touch-workflow-owner-binding') {
    fail(
      'WORKFLOW_OWNER_BINDING_INVALID',
      'peers-touch-workflow-owner-binding has an invalid shape',
    );
  }
  const unsigned = { ...value };
  delete unsigned.digest;
  delete unsigned.rootChatId;
  if (!SHA256.test(value.digest) || digest(unsigned) !== value.digest) {
    fail(
      'WORKFLOW_OWNER_BINDING_INVALID',
      'peers-touch-workflow-owner-binding digest does not match',
    );
  }
  const canonicalRoot = realpathSync(value.executionRoot);
  if (
    !HOSTS.has(value.host) ||
    !SHA256.test(value.rootChatHash) ||
    (!legacy &&
      rootChatHash(value.host, value.rootChatId) !== value.rootChatHash) ||
    value.role !== 'OWNER' ||
    value.bindingEvent !== 'PRE_TOOL_USE' ||
    !timestamp(value.boundAt) ||
    value.executionRoot !== canonicalRoot ||
    value.workspaceId !== workspaceIdForRoot(canonicalRoot) ||
    (expected.host !== undefined && expected.host !== value.host) ||
    (expected.rootChatHash !== undefined &&
      expected.rootChatHash !== value.rootChatHash) ||
    (expected.digest !== undefined && expected.digest !== value.digest)
  ) {
    fail('WORKFLOW_OWNER_BINDING_INVALID', 'Owner binding identity is invalid');
  }
  return value;
}

export function validateWorkflowBindingAssignment(value, expected = {}) {
  validateDigestRecord(
    value,
    ASSIGNMENT_KEYS,
    'peers-touch-workflow-binding-assignment',
    'WORKFLOW_BINDING_ASSIGNMENT_INVALID',
  );
  if (
    !IDENTIFIER.test(value.assignmentId) ||
    !CHILD_ROLES.has(value.role) ||
    !SHA256.test(value.rootBindingDigest) ||
    !SHA256.test(value.parentBindingDigest) ||
    !IDENTIFIER.test(value.workflowSessionId) ||
    !IDENTIFIER.test(value.operationId) ||
    !timestamp(value.issuedAt) ||
    !timestamp(value.leaseUntil) ||
    Date.parse(value.leaseUntil) <= Date.parse(value.issuedAt) ||
    (expected.assignmentId !== undefined &&
      expected.assignmentId !== value.assignmentId) ||
    (expected.digest !== undefined && expected.digest !== value.digest) ||
    (expected.rootBindingDigest !== undefined &&
      expected.rootBindingDigest !== value.rootBindingDigest)
  ) {
    fail(
      'WORKFLOW_BINDING_ASSIGNMENT_INVALID',
      'Workflow binding assignment fields are invalid',
    );
  }
  return value;
}

function validateWorkflowAssignmentClaim(value, expected = {}) {
  validateDigestRecord(
    value,
    ASSIGNMENT_CLAIM_KEYS,
    'peers-touch-workflow-assignment-claim',
    'WORKFLOW_BINDING_ASSIGNMENT_CLAIM_INVALID',
  );
  if (
    !SHA256.test(value.assignmentDigest) ||
    !SHA256.test(value.rootBindingDigest) ||
    !HOSTS.has(value.host) ||
    !SHA256.test(value.executionSessionHash) ||
    !IDENTIFIER.test(value.workflowSessionId) ||
    (expected.assignmentDigest !== undefined &&
      expected.assignmentDigest !== value.assignmentDigest) ||
    (expected.rootBindingDigest !== undefined &&
      expected.rootBindingDigest !== value.rootBindingDigest)
  ) {
    fail(
      'WORKFLOW_BINDING_ASSIGNMENT_CLAIM_INVALID',
      'Workflow assignment claim fields are invalid',
    );
  }
  return value;
}

export function validateWorkflowChildBinding(value, expected = {}) {
  validateDigestRecord(
    value,
    CHILD_KEYS,
    'peers-touch-workflow-child-binding',
    'WORKFLOW_CHILD_BINDING_INVALID',
  );
  const canonicalRoot = realpathSync(value.executionRoot);
  if (
    !HOSTS.has(value.host) ||
    !SHA256.test(value.executionSessionHash) ||
    !CHILD_ROLES.has(value.role) ||
    !SHA256.test(value.assignmentDigest) ||
    !SHA256.test(value.rootBindingDigest) ||
    !SHA256.test(value.parentBindingDigest) ||
    !IDENTIFIER.test(value.workflowSessionId) ||
    !timestamp(value.boundAt) ||
    value.executionRoot !== canonicalRoot ||
    value.workspaceId !== workspaceIdForRoot(canonicalRoot) ||
    (expected.host !== undefined && expected.host !== value.host) ||
    (expected.executionSessionHash !== undefined &&
      expected.executionSessionHash !== value.executionSessionHash) ||
    (expected.digest !== undefined && expected.digest !== value.digest)
  ) {
    fail('WORKFLOW_CHILD_BINDING_INVALID', 'Child binding identity is invalid');
  }
  return value;
}

function validateTerminal(value, expected = {}) {
  validateDigestRecord(
    value,
    TERMINAL_KEYS,
    'peers-touch-workflow-child-terminal',
    'WORKFLOW_CHILD_TERMINAL_INVALID',
  );
  if (
    !SHA256.test(value.childBindingDigest) ||
    !TERMINAL_RESULTS.has(value.result) ||
    !timestamp(value.terminalAt) ||
    (expected.childBindingDigest !== undefined &&
      expected.childBindingDigest !== value.childBindingDigest)
  ) {
    fail(
      'WORKFLOW_CHILD_TERMINAL_INVALID',
      'Child terminal receipt is invalid',
    );
  }
  return value;
}

function validateRelease(value, expected = {}) {
  validateDigestRecord(
    value,
    RELEASE_KEYS,
    'peers-touch-workflow-owner-release',
    'WORKFLOW_OWNER_RELEASE_INVALID',
  );
  if (
    !SHA256.test(value.rootBindingDigest) ||
    !SHA256.test(value.anchorDigest) ||
    !timestamp(value.releasedAt) ||
    (expected.rootBindingDigest !== undefined &&
      expected.rootBindingDigest !== value.rootBindingDigest)
  ) {
    fail('WORKFLOW_OWNER_RELEASE_INVALID', 'Owner release is invalid');
  }
  return value;
}

function validateCompactReceipt(value, expected = {}) {
  validateDigestRecord(
    value,
    COMPACT_KEYS,
    'peers-touch-workflow-compact-lineage',
    'WORKFLOW_COMPACT_RECEIPT_INVALID',
  );
  const child = value.role !== 'OWNER';
  if (
    !IDENTIFIER.test(value.compactId) ||
    !['OWNER', 'WORKER', 'REVIEWER'].includes(value.role) ||
    !SHA256.test(value.bindingDigest) ||
    !SHA256.test(value.rootBindingDigest) ||
    (child !== (value.parentBindingDigest !== null)) ||
    (child !== (value.assignmentDigest !== null)) ||
    (child !== (value.workflowSessionId !== null)) ||
    (value.parentBindingDigest !== null &&
      !SHA256.test(value.parentBindingDigest)) ||
    (value.assignmentDigest !== null &&
      !SHA256.test(value.assignmentDigest)) ||
    (value.workflowSessionId !== null &&
      !IDENTIFIER.test(value.workflowSessionId)) ||
    !timestamp(value.preCompactAt) ||
    (value.postCompactAt !== null && !timestamp(value.postCompactAt)) ||
    value.executionRoot !== realpathSync(value.executionRoot) ||
    value.workspaceId !== workspaceIdForRoot(value.executionRoot) ||
    (expected.rootBindingDigest !== undefined &&
      expected.rootBindingDigest !== value.rootBindingDigest)
  ) {
    fail(
      'WORKFLOW_COMPACT_RECEIPT_INVALID',
      'Workflow compact receipt fields are invalid',
    );
  }
  return value;
}

export function workflowOwnerBindingPath(host, rootChatId, options = {}) {
  return path.join(
    ownerDirectory(host, rootChatHash(host, rootChatId), options),
    'owner-binding.json',
  );
}

export function readWorkflowOwnerBinding(host, rootChatId, options = {}) {
  const hash = rootChatHash(host, rootChatId);
  const file = path.join(ownerDirectory(host, hash, options, false), 'owner-binding.json');
  const value = readOwnedJson(file, 'WORKFLOW_OWNER_BINDING_INVALID');
  return value === null
    ? null
    : validateWorkflowOwnerBinding(value, { host, rootChatHash: hash });
}

export function bindWorkflowOwner(host, rootChatId, executionRoot, options = {}) {
  const canonicalRoot = realpathSync(executionRoot);
  const unsigned = {
    kind: 'peers-touch-workflow-owner-binding',
    host,
    rootChatHash: rootChatHash(host, rootChatId),
    rootChatId,
    role: 'OWNER',
    executionRoot: canonicalRoot,
    workspaceId: workspaceIdForRoot(canonicalRoot),
    boundAt: operationDate(options.now).toISOString(),
    bindingEvent: 'PRE_TOOL_USE',
  };
  const digestInput = { ...unsigned };
  delete digestInput.rootChatId;
  const binding = { ...unsigned, digest: digest(digestInput) };
  validateWorkflowOwnerBinding(binding, {
    host,
    rootChatHash: unsigned.rootChatHash,
  });
  const file = workflowOwnerBindingPath(host, rootChatId, options);
  const result = publishCreateOnce(
    file,
    binding,
    (value) =>
      validateWorkflowOwnerBinding(value, {
        host,
        rootChatHash: unsigned.rootChatHash,
      }),
    (existing, candidate) =>
      existing.host === candidate.host &&
      existing.rootChatHash === candidate.rootChatHash &&
      existing.role === candidate.role &&
      existing.executionRoot === candidate.executionRoot &&
      existing.workspaceId === candidate.workspaceId &&
      existing.bindingEvent === candidate.bindingEvent,
  );
  if (typeof result.value.rootChatId !== 'string') {
    const migrated = { ...result.value, rootChatId };
    validateWorkflowOwnerBinding(migrated, {
      host,
      rootChatHash: unsigned.rootChatHash,
    });
    replaceCurrent(file, migrated);
    return { binding: migrated, created: false, migrated: true };
  }
  return { binding: result.value, created: result.created, migrated: false };
}

export function readWorkflowOwnerReferences(options = {}) {
  const records = [];
  const errors = [];
  for (const entry of ownerDirectories(options)) {
    try {
      const owner = validateWorkflowOwnerBinding(
        readOwnedJson(
          path.join(entry.directory, 'owner-binding.json'),
          'WORKFLOW_OWNER_BINDING_INVALID',
          true,
        ),
        {
          host: entry.host,
          rootChatHash: entry.rootChatHash,
        },
      );
      records.push({
        workspaceId: owner.workspaceId,
        boundAt: owner.boundAt,
        released: workflowOwnerIsReleased(owner, options),
        workflowOwner:
          typeof owner.rootChatId !== 'string'
            ? null
            : workflowOwnerReferenceFromBinding(owner),
        rootBindingDigest: owner.digest,
      });
    } catch (error) {
      errors.push({
        host: entry.host,
        rootChatHash: entry.rootChatHash,
        code: error?.code ?? 'WORKFLOW_OWNER_BINDING_INVALID',
        message: error?.message ?? String(error),
      });
    }
  }
  records.sort(
    (left, right) =>
      left.boundAt.localeCompare(right.boundAt) ||
      left.rootBindingDigest.localeCompare(right.rootBindingDigest),
  );
  errors.sort(
    (left, right) =>
      left.host.localeCompare(right.host) ||
      left.rootChatHash.localeCompare(right.rootChatHash),
  );
  return { records, errors };
}

function ownerDirectories(options = {}) {
  const owners = path.join(bindingsRoot(options, false), 'owners');
  if (!existsSync(owners)) return [];
  assertPrivateDirectory(owners);
  const directories = [];
  for (const hostEntry of readdirSync(owners, { withFileTypes: true })) {
    if (!hostEntry.isDirectory() || !HOSTS.has(hostEntry.name)) continue;
    const hostRoot = path.join(owners, hostEntry.name);
    assertPrivateDirectory(hostRoot);
    for (const rootEntry of readdirSync(hostRoot, { withFileTypes: true })) {
      if (!rootEntry.isDirectory() || !SHA256.test(rootEntry.name)) continue;
      const directory = path.join(hostRoot, rootEntry.name);
      assertPrivateDirectory(directory);
      directories.push({
        host: hostEntry.name,
        rootChatHash: rootEntry.name,
        directory,
      });
    }
  }
  return directories;
}

export function readWorkflowOwnerByDigest(rootBindingDigest, options = {}) {
  if (!SHA256.test(rootBindingDigest)) {
    fail('WORKFLOW_OWNER_BINDING_INVALID', 'Owner binding digest is invalid');
  }
  const matches = ownerDirectories(options)
    .map((entry) => {
      const value = readOwnedJson(
        path.join(entry.directory, 'owner-binding.json'),
        'WORKFLOW_OWNER_BINDING_INVALID',
      );
      return value === null
        ? null
        : validateWorkflowOwnerBinding(value, {
            host: entry.host,
            rootChatHash: entry.rootChatHash,
          });
    })
    .filter((binding) => binding?.digest === rootBindingDigest);
  if (matches.length !== 1) {
    fail(
      'WORKFLOW_OWNER_BINDING_NOT_FOUND',
      'Exact owner binding digest did not resolve once',
      { candidateCount: matches.length },
    );
  }
  return matches[0];
}

function releaseRecords(owner, options = {}) {
  const directory = path.join(
    ownerDirectory(owner.host, owner.rootChatHash, options, false),
    'releases',
  );
  if (!existsSync(directory)) return [];
  assertPrivateDirectory(directory);
  return readdirSync(directory, { withFileTypes: true })
    .map((entry) => {
      if (!entry.isFile() || !/^[0-9a-f]{64}\.json$/.test(entry.name)) {
        fail('WORKFLOW_OWNER_RELEASE_INVALID', 'Owner release entry is invalid');
      }
      return validateRelease(
        readOwnedJson(
          path.join(directory, entry.name),
          'WORKFLOW_OWNER_RELEASE_INVALID',
          true,
        ),
        { rootBindingDigest: owner.digest },
      );
    });
}

export function workflowOwnerIsReleased(owner, options = {}) {
  return releaseRecords(owner, options).length > 0;
}

function validateActiveWorkflowSession(owner, workflowSessionId, options = {}) {
  const workflowRoot = path.join(
    machineRoot(options),
    'workspaces',
    owner.workspaceId,
    'workflow',
  );
  try {
    const active = validateActiveWorkRecord(
      readOwnedJson(
        path.join(workflowRoot, 'active-work.json'),
        'WORKFLOW_BINDING_SESSION_INVALID',
        true,
      ),
      owner.workspaceId,
    );
    if (
      active.sessionId !== workflowSessionId ||
      active.planStatus !== 'active' ||
      active.taskStatus !== 'in_progress' ||
      active.devState === null
    ) {
      fail(
        'WORKFLOW_BINDING_SESSION_INVALID',
        'Assignment does not target the active Development Session',
      );
    }
    const session = validateSession(
      readOwnedJson(
        path.join(workflowRoot, active.workItemId, 'session.json'),
        'WORKFLOW_BINDING_SESSION_INVALID',
        true,
      ),
    );
    if (
      session.state.sessionId !== active.sessionId ||
      session.state.workItemId !== active.workItemId ||
      session.state.planId !== active.planId ||
      session.state.taskId !== active.currentTaskId ||
      session.state.workspaceId !== owner.workspaceId ||
      session.state.state !== active.devState
    ) {
      fail(
        'WORKFLOW_BINDING_SESSION_INVALID',
        'Active-work and Development Session identity do not match',
      );
    }
    return session;
  } catch (error) {
    if (
      error instanceof WorkflowBindingError &&
      error.code === 'WORKFLOW_BINDING_SESSION_INVALID'
    ) {
      throw error;
    }
    fail(
      'WORKFLOW_BINDING_SESSION_INVALID',
      'Active Development Session could not be validated',
      { cause: error?.code ?? error?.message ?? String(error) },
    );
  }
}

export function createWorkflowBindingAssignment(
  issuerProjection,
  input,
  options = {},
) {
  const now = operationDate(options.now);
  if (
    issuerProjection?.kind !== 'peers-touch-workflow-binding-projection' ||
    issuerProjection.released ||
    (issuerProjection.role !== 'OWNER' &&
      issuerProjection.childState !== 'LEASED')
  ) {
    fail(
      'WORKFLOW_BINDING_ASSIGNMENT_DENIED',
      'Only a current live lineage may issue a child assignment',
    );
  }
  const issuer = readWorkflowBindingContextByActor(
    {
      host: issuerProjection.host,
      bindingDigest: issuerProjection.bindingDigest,
      role: issuerProjection.role,
      rootBindingDigest: issuerProjection.rootBindingDigest,
      parentBindingDigest: issuerProjection.parentBindingDigest,
      assignmentDigest: issuerProjection.assignmentDigest,
    },
    options,
  );
  if (
    issuer.projection.released ||
    (issuer.projection.role !== 'OWNER' &&
      (issuer.projection.childState !== 'LEASED' ||
        issuer.projection.workflowSessionId !== input.workflowSessionId))
  ) {
    fail(
      'WORKFLOW_BINDING_ASSIGNMENT_DENIED',
      'Assignment issuer is not current',
    );
  }
  const owner = issuer.owner;
  if (workflowOwnerIsReleased(owner, options)) {
    fail(
      'WORKFLOW_BINDING_ASSIGNMENT_DENIED',
      'Released owner cannot issue child assignments',
    );
  }
  validateActiveWorkflowSession(owner, input.workflowSessionId, options);
  const leaseUntil = operationDate(
    input.leaseUntil ?? new Date(now.getTime() + (input.leaseMs ?? 30 * 60_000)),
  );
  const unsigned = {
    kind: 'peers-touch-workflow-binding-assignment',
    assignmentId:
      input.assignmentId ?? `assignment-${randomBytes(12).toString('hex')}`,
    role: input.role,
    rootBindingDigest: owner.digest,
    parentBindingDigest: issuerProjection.bindingDigest,
    workflowSessionId: input.workflowSessionId,
    operationId: input.operationId,
    issuedAt: now.toISOString(),
    leaseUntil: leaseUntil.toISOString(),
  };
  const assignment = { ...unsigned, digest: digest(unsigned) };
  validateWorkflowBindingAssignment(assignment, {
    rootBindingDigest: owner.digest,
  });
  const assignments = path.join(
    ownerDirectory(owner.host, owner.rootChatHash, options),
    'assignments',
  );
  ensurePrivateDirectory(assignments);
  const file = path.join(assignments, `${assignment.assignmentId}.json`);
  const result = publishCreateOnce(file, assignment, (value) =>
    validateWorkflowBindingAssignment(value, {
      assignmentId: assignment.assignmentId,
      rootBindingDigest: owner.digest,
    }));
  return { assignment: result.value, created: result.created };
}

export function readWorkflowBindingAssignment(
  owner,
  assignmentId,
  options = {},
) {
  if (!IDENTIFIER.test(assignmentId)) {
    fail(
      'WORKFLOW_BINDING_ASSIGNMENT_INVALID',
      'Workflow assignment ID is invalid',
    );
  }
  const file = path.join(
    ownerDirectory(owner.host, owner.rootChatHash, options, false),
    'assignments',
    `${assignmentId}.json`,
  );
  const value = readOwnedJson(file, 'WORKFLOW_BINDING_ASSIGNMENT_INVALID');
  return value === null
    ? null
    : validateWorkflowBindingAssignment(value, {
        assignmentId,
        rootBindingDigest: owner.digest,
      });
}

export function readWorkflowBindingAssignmentByDigest(
  owner,
  assignmentDigest,
  options = {},
) {
  if (!SHA256.test(assignmentDigest)) {
    fail(
      'WORKFLOW_BINDING_ASSIGNMENT_INVALID',
      'Workflow assignment digest is invalid',
    );
  }
  const directory = path.join(
    ownerDirectory(owner.host, owner.rootChatHash, options, false),
    'assignments',
  );
  if (!existsSync(directory)) return null;
  assertPrivateDirectory(directory);
  const matches = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) =>
      validateWorkflowBindingAssignment(
        readOwnedJson(
          path.join(directory, entry.name),
          'WORKFLOW_BINDING_ASSIGNMENT_INVALID',
          true,
        ),
        { rootBindingDigest: owner.digest },
      ))
    .filter((assignment) => assignment.digest === assignmentDigest);
  if (matches.length > 1) {
    fail(
      'WORKFLOW_BINDING_ASSIGNMENT_INVALID',
      'Assignment digest resolved more than once',
    );
  }
  return matches[0] ?? null;
}

function assignmentClaimPath(
  owner,
  assignmentDigest,
  options = {},
  create = true,
) {
  if (!SHA256.test(assignmentDigest)) {
    fail(
      'WORKFLOW_BINDING_ASSIGNMENT_CLAIM_INVALID',
      'Workflow assignment claim digest is invalid',
    );
  }
  const directory = path.join(
    ownerDirectory(owner.host, owner.rootChatHash, options, create),
    'assignment-claims',
  );
  if (create) {
    ensurePrivateDirectory(directory);
  } else if (existsSync(directory)) {
    assertPrivateDirectory(directory);
  }
  return path.join(directory, `${assignmentDigest}.json`);
}

function readWorkflowAssignmentClaim(owner, assignmentDigest, options = {}) {
  const file = assignmentClaimPath(owner, assignmentDigest, options, false);
  const value = readOwnedJson(
    file,
    'WORKFLOW_BINDING_ASSIGNMENT_CLAIM_INVALID',
  );
  return value === null
    ? null
    : validateWorkflowAssignmentClaim(value, {
        assignmentDigest,
        rootBindingDigest: owner.digest,
      });
}

export function readWorkflowChildBinding(
  rootBindingDigest,
  host,
  executionSessionId,
  options = {},
) {
  const hash = executionSessionHash(host, executionSessionId);
  const file = path.join(
    childDirectory(rootBindingDigest, host, hash, options, false),
    'child-binding.json',
  );
  const value = readOwnedJson(file, 'WORKFLOW_CHILD_BINDING_INVALID');
  return value === null
    ? null
    : validateWorkflowChildBinding(value, {
        host,
        executionSessionHash: hash,
      });
}

export function claimWorkflowChild(
  host,
  executionSessionId,
  owner,
  assignment,
  options = {},
) {
  const now = operationDate(options.now);
  validateWorkflowBindingAssignment(assignment, {
    rootBindingDigest: owner.digest,
  });
  if (
    workflowOwnerIsReleased(owner, options) ||
    now.getTime() > Date.parse(assignment.leaseUntil)
  ) {
    fail(
      'WORKFLOW_CHILD_BINDING_NOT_LIVE',
      'Child assignment is expired or its owner is released',
    );
  }
  const childExecutionSessionHash = executionSessionHash(
    host,
    executionSessionId,
  );
  const claimUnsigned = {
    kind: 'peers-touch-workflow-assignment-claim',
    assignmentDigest: assignment.digest,
    rootBindingDigest: owner.digest,
    host,
    executionSessionHash: childExecutionSessionHash,
    workflowSessionId: assignment.workflowSessionId,
  };
  const claim = { ...claimUnsigned, digest: digest(claimUnsigned) };
  validateWorkflowAssignmentClaim(claim, {
    assignmentDigest: assignment.digest,
    rootBindingDigest: owner.digest,
  });
  try {
    publishCreateOnce(
      assignmentClaimPath(owner, assignment.digest, options),
      claim,
      (value) =>
        validateWorkflowAssignmentClaim(value, {
          assignmentDigest: assignment.digest,
          rootBindingDigest: owner.digest,
        }),
    );
  } catch (error) {
    if (
      error instanceof WorkflowBindingError &&
      error.code === 'WORKFLOW_BINDING_IMMUTABLE'
    ) {
      fail(
        'WORKFLOW_BINDING_ASSIGNMENT_CLAIMED',
        'Workflow assignment already belongs to another execution session',
      );
    }
    throw error;
  }
  const unsigned = {
    kind: 'peers-touch-workflow-child-binding',
    host,
    executionSessionHash: childExecutionSessionHash,
    role: assignment.role,
    assignmentDigest: assignment.digest,
    rootBindingDigest: owner.digest,
    parentBindingDigest: assignment.parentBindingDigest,
    workflowSessionId: assignment.workflowSessionId,
    executionRoot: owner.executionRoot,
    workspaceId: owner.workspaceId,
    boundAt: now.toISOString(),
  };
  const binding = { ...unsigned, digest: digest(unsigned) };
  validateWorkflowChildBinding(binding, {
    host,
    executionSessionHash: unsigned.executionSessionHash,
  });
  const file = path.join(
    childDirectory(
      owner.digest,
      host,
      binding.executionSessionHash,
      options,
    ),
    'child-binding.json',
  );
  try {
    writeFileDurably(file, binding);
    fsyncDirectory(path.dirname(file));
    return { binding, created: true };
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = validateWorkflowChildBinding(
      readOwnedJson(file, 'WORKFLOW_CHILD_BINDING_INVALID', true),
      {
        host,
        executionSessionHash: binding.executionSessionHash,
      },
    );
    if (
      existing.assignmentDigest !== assignment.digest ||
      existing.rootBindingDigest !== owner.digest ||
      existing.parentBindingDigest !== assignment.parentBindingDigest ||
      existing.role !== assignment.role ||
      existing.workflowSessionId !== assignment.workflowSessionId ||
      existing.executionRoot !== owner.executionRoot ||
      existing.workspaceId !== owner.workspaceId
    ) {
      fail(
        'WORKFLOW_BINDING_IMMUTABLE',
        'Execution session already claimed a different child assignment',
      );
    }
    return { binding: existing, created: false };
  }
}

function childTerminal(binding, options = {}) {
  const file = path.join(
    childDirectory(
      binding.rootBindingDigest,
      binding.host,
      binding.executionSessionHash,
      options,
      false,
    ),
    'terminal.json',
  );
  const value = readOwnedJson(file, 'WORKFLOW_CHILD_TERMINAL_INVALID');
  return value === null
    ? null
    : validateTerminal(value, { childBindingDigest: binding.digest });
}

export function terminalizeWorkflowChild(binding, result, options = {}) {
  validateWorkflowChildBinding(binding);
  const unsigned = {
    kind: 'peers-touch-workflow-child-terminal',
    childBindingDigest: binding.digest,
    result,
    terminalAt: operationDate(options.now).toISOString(),
  };
  const terminal = { ...unsigned, digest: digest(unsigned) };
  validateTerminal(terminal, { childBindingDigest: binding.digest });
  const file = path.join(
    childDirectory(
      binding.rootBindingDigest,
      binding.host,
      binding.executionSessionHash,
      options,
    ),
    'terminal.json',
  );
  try {
    writeFileDurably(file, terminal);
    fsyncDirectory(path.dirname(file));
    return terminal;
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = validateTerminal(
      readOwnedJson(file, 'WORKFLOW_CHILD_TERMINAL_INVALID', true),
      { childBindingDigest: binding.digest },
    );
    if (existing.result !== result) {
      fail(
        'WORKFLOW_BINDING_IMMUTABLE',
        'Child already has a different terminal result',
      );
    }
    return existing;
  }
}

function childBindings(rootBindingDigest, host, options = {}) {
  const hostRoot = path.join(
    bindingsRoot(options, false),
    'children',
    rootBindingDigest,
    host,
  );
  if (!existsSync(hostRoot)) return [];
  assertPrivateDirectory(hostRoot);
  return readdirSync(hostRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && SHA256.test(entry.name))
    .map((entry) => {
      const directory = path.join(hostRoot, entry.name);
      assertPrivateDirectory(directory);
      return readOwnedJson(
        path.join(directory, 'child-binding.json'),
        'WORKFLOW_CHILD_BINDING_INVALID',
      );
    })
    .filter(Boolean)
    .map((value) =>
      validateWorkflowChildBinding(value, {
        host,
        executionSessionHash: value.executionSessionHash,
      }));
}

export function inspectWorkflowBindingLiveness(options = {}) {
  const now = operationDate(options.now);
  const root = bindingsRoot(options, false);
  if (!existsSync(root)) return { liveAssignments: [] };

  const ownersRoot = path.join(root, 'owners');
  if (existsSync(ownersRoot)) {
    assertPrivateDirectory(ownersRoot);
    for (const hostEntry of readdirSync(ownersRoot, { withFileTypes: true })) {
      if (!hostEntry.isDirectory() || !HOSTS.has(hostEntry.name)) {
        fail(
          'WORKFLOW_BINDING_STORE_INVALID',
          'Owner store contains an invalid host entry',
        );
      }
      const hostRoot = path.join(ownersRoot, hostEntry.name);
      assertPrivateDirectory(hostRoot);
      for (const ownerEntry of readdirSync(hostRoot, { withFileTypes: true })) {
        if (!ownerEntry.isDirectory() || !SHA256.test(ownerEntry.name)) {
          fail(
            'WORKFLOW_BINDING_STORE_INVALID',
            'Owner store contains an invalid identity entry',
          );
        }
      }
    }
  }

  const owners = ownerDirectories(options).map((entry) =>
    validateWorkflowOwnerBinding(
      readOwnedJson(
        path.join(entry.directory, 'owner-binding.json'),
        'WORKFLOW_OWNER_BINDING_INVALID',
        true,
      ),
      {
        host: entry.host,
        rootChatHash: entry.rootChatHash,
      },
    ));
  const ownersByDigest = new Map(owners.map((owner) => [owner.digest, owner]));
  const childrenByAssignment = new Map();
  const childrenRoot = path.join(root, 'children');
  if (existsSync(childrenRoot)) {
    assertPrivateDirectory(childrenRoot);
    for (const ownerEntry of readdirSync(childrenRoot, { withFileTypes: true })) {
      if (
        !ownerEntry.isDirectory() ||
        !SHA256.test(ownerEntry.name) ||
        !ownersByDigest.has(ownerEntry.name)
      ) {
        fail(
          'WORKFLOW_BINDING_STORE_INVALID',
          'Child store has no exact owner',
        );
      }
      const ownerRoot = path.join(childrenRoot, ownerEntry.name);
      assertPrivateDirectory(ownerRoot);
      for (const hostEntry of readdirSync(ownerRoot, { withFileTypes: true })) {
        if (!hostEntry.isDirectory() || !HOSTS.has(hostEntry.name)) {
          fail(
            'WORKFLOW_BINDING_STORE_INVALID',
            'Child store contains an invalid host entry',
          );
        }
        const hostRoot = path.join(ownerRoot, hostEntry.name);
        assertPrivateDirectory(hostRoot);
        for (const childEntry of readdirSync(hostRoot, { withFileTypes: true })) {
          if (!childEntry.isDirectory() || !SHA256.test(childEntry.name)) {
            fail(
              'WORKFLOW_BINDING_STORE_INVALID',
              'Child store contains an invalid identity entry',
            );
          }
        }
        for (const child of childBindings(
          ownerEntry.name,
          hostEntry.name,
          options,
        )) {
          const matches = childrenByAssignment.get(child.assignmentDigest) ?? [];
          matches.push(child);
          childrenByAssignment.set(child.assignmentDigest, matches);
        }
      }
    }
  }

  const assignmentsByDigest = new Map();
  const liveAssignments = [];
  for (const owner of owners) {
    const released = workflowOwnerIsReleased(owner, options);
    const assignmentsRoot = path.join(
      ownerDirectory(owner.host, owner.rootChatHash, options, false),
      'assignments',
    );
    if (!existsSync(assignmentsRoot)) continue;
    assertPrivateDirectory(assignmentsRoot);
    for (const entry of readdirSync(assignmentsRoot, { withFileTypes: true })) {
      const assignmentId = entry.name.endsWith('.json')
        ? entry.name.slice(0, -'.json'.length)
        : '';
      if (!entry.isFile() || !IDENTIFIER.test(assignmentId)) {
        fail(
          'WORKFLOW_BINDING_STORE_INVALID',
          'Assignment store contains an invalid entry',
        );
      }
      const assignment = validateWorkflowBindingAssignment(
        readOwnedJson(
          path.join(assignmentsRoot, entry.name),
          'WORKFLOW_BINDING_ASSIGNMENT_INVALID',
          true,
        ),
        {
          assignmentId,
          rootBindingDigest: owner.digest,
        },
      );
      if (assignmentsByDigest.has(assignment.digest)) {
        fail(
          'WORKFLOW_BINDING_STORE_INVALID',
          'Assignment digest resolves more than once',
        );
      }
      assignmentsByDigest.set(assignment.digest, assignment);
      const children = childrenByAssignment.get(assignment.digest) ?? [];
      if (children.length > 1) {
        fail(
          'WORKFLOW_BINDING_STORE_INVALID',
          'Assignment was claimed by more than one child',
        );
      }
      const terminal =
        children.length === 1 ? childTerminal(children[0], options) : null;
      if (
        !released &&
        Date.parse(assignment.leaseUntil) > now.getTime() &&
        terminal === null
      ) {
        liveAssignments.push({
          assignmentId: assignment.assignmentId,
          assignmentDigest: assignment.digest,
          rootBindingDigest: assignment.rootBindingDigest,
          role: assignment.role,
          leaseUntil: assignment.leaseUntil,
        });
      }
    }
  }
  for (const assignmentDigest of childrenByAssignment.keys()) {
    if (!assignmentsByDigest.has(assignmentDigest)) {
      fail(
        'WORKFLOW_BINDING_STORE_INVALID',
        'Child binding references no assignment',
      );
    }
  }
  return { liveAssignments };
}

export function readWorkflowBindingContextByActor(actor, options = {}) {
  if (
    actor === null ||
    typeof actor !== 'object' ||
    !HOSTS.has(actor.host) ||
    !['OWNER', 'WORKER', 'REVIEWER'].includes(actor.role) ||
    !SHA256.test(actor.bindingDigest) ||
    !SHA256.test(actor.rootBindingDigest)
  ) {
    fail('WORKFLOW_BINDING_PROJECTION_INVALID', 'Action actor is invalid');
  }
  const owner = readWorkflowOwnerByDigest(actor.rootBindingDigest, options);
  const released = workflowOwnerIsReleased(owner, options);
  if (actor.role === 'OWNER') {
    if (
      actor.bindingDigest !== owner.digest ||
      actor.parentBindingDigest !== null ||
      actor.assignmentDigest !== null
    ) {
      fail(
        'WORKFLOW_BINDING_LINEAGE_INVALID',
        'Action actor does not identify the exact owner',
      );
    }
    return {
      owner,
      binding: owner,
      assignment: null,
      terminal: null,
      projection: projectWorkflowBinding({ binding: owner, released }),
    };
  }
  const matches = childBindings(owner.digest, actor.host, options)
    .filter((binding) => binding.digest === actor.bindingDigest);
  if (matches.length !== 1) {
    fail(
      'WORKFLOW_CHILD_BINDING_NOT_FOUND',
      'Exact child binding digest did not resolve once',
      { candidateCount: matches.length },
    );
  }
  const binding = matches[0];
  const assignment = readWorkflowBindingAssignmentByDigest(
    owner,
    binding.assignmentDigest,
    options,
  );
  const assignmentClaim = readWorkflowAssignmentClaim(
    owner,
    binding.assignmentDigest,
    options,
  );
  if (
    assignment === null ||
    assignmentClaim === null ||
    assignmentClaim.host !== binding.host ||
    assignmentClaim.executionSessionHash !== binding.executionSessionHash ||
    assignmentClaim.workflowSessionId !== binding.workflowSessionId ||
    actor.rootBindingDigest !== binding.rootBindingDigest ||
    actor.parentBindingDigest !== binding.parentBindingDigest ||
    actor.assignmentDigest !== binding.assignmentDigest ||
    actor.role !== binding.role
  ) {
    fail(
      'WORKFLOW_BINDING_LINEAGE_INVALID',
      'Action actor child lineage does not match storage',
    );
  }
  const terminal = childTerminal(binding, options);
  return {
    owner,
    binding,
    assignment,
    terminal,
    projection: projectWorkflowBinding({
      binding,
      assignment,
      released,
      terminal: terminal !== null,
      now: options.now,
    }),
  };
}

export function readWorkflowProjectionByActor(actor, options = {}) {
  return readWorkflowBindingContextByActor(actor, options).projection;
}

function compactReceiptPath(owner, bindingDigest, options = {}, create = true) {
  if (!SHA256.test(bindingDigest)) {
    fail(
      'WORKFLOW_COMPACT_RECEIPT_INVALID',
      'Compact receipt binding digest is invalid',
    );
  }
  const directory = path.join(
    ownerDirectory(owner.host, owner.rootChatHash, options, create),
    'compact-lineage',
  );
  if (create) {
    ensurePrivateDirectory(directory);
  } else if (existsSync(directory)) {
    assertPrivateDirectory(directory);
  }
  return path.join(directory, `${bindingDigest}.json`);
}

function compactLineage(projection) {
  return {
    role: projection.role,
    bindingDigest: projection.bindingDigest,
    rootBindingDigest: projection.rootBindingDigest,
    parentBindingDigest: projection.parentBindingDigest,
    assignmentDigest: projection.assignmentDigest,
    workflowSessionId: projection.workflowSessionId,
    executionRoot: projection.executionRoot,
    workspaceId: projection.workspaceId,
  };
}

function currentProjection(projection, options = {}) {
  const context = readWorkflowBindingContextByActor(
    {
      host: projection.host,
      bindingDigest: projection.bindingDigest,
      role: projection.role,
      rootBindingDigest: projection.rootBindingDigest,
      parentBindingDigest: projection.parentBindingDigest,
      assignmentDigest: projection.assignmentDigest,
    },
    options,
  );
  if (
    context.projection.released ||
    (context.projection.role !== 'OWNER' &&
      context.projection.childState !== 'LEASED')
  ) {
    fail(
      'WORKFLOW_COMPACT_LINEAGE_MISMATCH',
      'Compact lineage is no longer live',
    );
  }
  return context;
}

export function recordWorkflowPreCompact(projection, options = {}) {
  const context = currentProjection(projection, options);
  const unsigned = {
    kind: 'peers-touch-workflow-compact-lineage',
    compactId: `compact-${randomBytes(12).toString('hex')}`,
    ...compactLineage(context.projection),
    preCompactAt: operationDate(options.now).toISOString(),
    postCompactAt: null,
  };
  const receipt = { ...unsigned, digest: digest(unsigned) };
  validateCompactReceipt(receipt, {
    rootBindingDigest: context.owner.digest,
  });
  replaceCurrent(
    compactReceiptPath(
      context.owner,
      context.projection.bindingDigest,
      options,
    ),
    receipt,
  );
  return receipt;
}

export function verifyWorkflowPostCompact(projection, options = {}) {
  let context;
  try {
    context = currentProjection(projection, options);
  } catch (error) {
    fail(
      'WORKFLOW_COMPACT_LINEAGE_MISMATCH',
      'PostCompact binding lineage cannot resolve to the PreCompact owner',
      { cause: error?.code ?? error?.message ?? String(error) },
    );
  }
  const file = compactReceiptPath(
    context.owner,
    context.projection.bindingDigest,
    options,
    false,
  );
  const receipt = validateCompactReceipt(
    readOwnedJson(file, 'WORKFLOW_COMPACT_RECEIPT_INVALID', true),
    { rootBindingDigest: context.owner.digest },
  );
  const expected = compactLineage(context.projection);
  if (
    Object.entries(expected).some(
      ([field, value]) => receipt[field] !== value,
    )
  ) {
    fail(
      'WORKFLOW_COMPACT_LINEAGE_MISMATCH',
      'PostCompact binding lineage differs from PreCompact',
    );
  }
  if (receipt.postCompactAt !== null) return receipt;
  const unsigned = {
    ...receipt,
    postCompactAt: operationDate(options.now).toISOString(),
  };
  delete unsigned.digest;
  const completed = { ...unsigned, digest: digest(unsigned) };
  validateCompactReceipt(completed, {
    rootBindingDigest: context.owner.digest,
  });
  replaceCurrent(file, completed);
  return completed;
}

export function resolveEventWorkflowBinding(event, executionRoot, options = {}) {
  const identity = event.bindingIdentity;
  if (!identity?.rootChatId) return { mode: 'OBSERVE_ONLY', projection: null };
  let owner = readWorkflowOwnerBinding(
    event.host,
    identity.rootChatId,
    options,
  );
  if (owner === null || typeof owner.rootChatId !== 'string') {
    if (event.event !== 'PRE_TOOL_USE') {
      return { mode: 'PREWARM', projection: null };
    }
    if (!executionRoot) return { mode: 'NEEDS_ROOT', projection: null };
    owner = bindWorkflowOwner(
      event.host,
      identity.rootChatId,
      executionRoot,
      options,
    ).binding;
  }
  const released = workflowOwnerIsReleased(owner, options);
  if (!identity.assignmentId) {
    return {
      mode: 'ENFORCED',
      projection: projectWorkflowBinding({ binding: owner, released }),
      owner,
      binding: owner,
      assignment: null,
    };
  }
  if (!identity.executionSessionId) {
    fail(
      'WORKFLOW_CHILD_IDENTITY_REQUIRED',
      'Assigned child requires the host execution-session identity',
    );
  }
  const assignment = readWorkflowBindingAssignment(
    owner,
    identity.assignmentId,
    options,
  );
  if (assignment === null) {
    fail(
      'WORKFLOW_BINDING_ASSIGNMENT_REQUIRED',
      'Assigned child references no create-once assignment',
    );
  }
  let child = readWorkflowChildBinding(
    owner.digest,
    event.host,
    identity.executionSessionId,
    options,
  );
  if (child === null) {
    if (!['SUBAGENT_START', 'PRE_TOOL_USE'].includes(event.event)) {
      return { mode: 'PREWARM', projection: null };
    }
    child = claimWorkflowChild(
      event.host,
      identity.executionSessionId,
      owner,
      assignment,
      options,
    ).binding;
  }
  return {
    mode: 'ENFORCED',
    projection: projectWorkflowBinding({
      binding: child,
      assignment,
      released,
      terminal: childTerminal(child, options) !== null,
      now: options.now,
    }),
    owner,
    binding: child,
    assignment,
  };
}

export function writeWorkflowAnchorReceipt(owner, anchor, options = {}) {
  validateWorkflowOwnerBinding(owner);
  if (
    !SHA256.test(anchor?.digest ?? '') ||
    typeof anchor.status !== 'string' ||
    typeof anchor.content !== 'string'
  ) {
    fail('WORKFLOW_ANCHOR_RECEIPT_INVALID', 'Workflow anchor is invalid');
  }
  const unsigned = {
    kind: 'peers-touch-workflow-anchor-receipt',
    rootBindingDigest: owner.digest,
    anchorDigest: anchor.digest,
    renderedAt: operationDate(options.now).toISOString(),
    status: anchor.status,
    content: anchor.content,
  };
  const value = { ...unsigned, digest: digest(unsigned) };
  validateDigestRecord(
    value,
    ANCHOR_KEYS,
    'peers-touch-workflow-anchor-receipt',
    'WORKFLOW_ANCHOR_RECEIPT_INVALID',
  );
  replaceCurrent(
    path.join(
      ownerDirectory(owner.host, owner.rootChatHash, options),
      'anchor-receipt.json',
    ),
    value,
  );
  return value;
}

export function releaseWorkflowOwner(owner, anchorDigest, options = {}) {
  validateWorkflowOwnerBinding(owner);
  if (!SHA256.test(anchorDigest)) {
    fail('WORKFLOW_OWNER_RELEASE_INVALID', 'Anchor digest is invalid');
  }
  const existing = releaseRecords(owner, options);
  if (existing.length > 0) {
    if (
      existing.length === 1 &&
      existing[0].anchorDigest === anchorDigest
    ) {
      return existing[0];
    }
    fail(
      'WORKFLOW_OWNER_RELEASE_CONFLICT',
      'Owner already has a different release receipt',
    );
  }
  const releases = path.join(
    ownerDirectory(owner.host, owner.rootChatHash, options),
    'releases',
  );
  ensurePrivateDirectory(releases);
  const unsigned = {
    kind: 'peers-touch-workflow-owner-release',
    rootBindingDigest: owner.digest,
    anchorDigest,
    releasedAt: operationDate(options.now).toISOString(),
  };
  const value = { ...unsigned, digest: digest(unsigned) };
  validateRelease(value, { rootBindingDigest: owner.digest });
  return publishCreateOnce(
    path.join(releases, `${anchorDigest}.json`),
    value,
    (record) =>
      validateRelease(record, { rootBindingDigest: owner.digest }),
  ).value;
}
