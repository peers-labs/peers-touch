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
  projectWorkflowBinding,
} from './workflow-binding-projection.mjs';

const HOSTS = new Set(['trae', 'cursor', 'codex']);
const CHILD_ROLES = new Set(['WORKER', 'REVIEWER']);
const TERMINAL_RESULTS = new Set(['PASS', 'FAIL', 'BLOCKED', 'CANCELLED']);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const OWNER_KEYS = new Set([
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
  return hostIdentityHash(host, 'root', rootChatId);
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

function publishCreateOnce(file, value, validator) {
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
    if (
      JSON.stringify(canonicalize(existing)) !==
      JSON.stringify(canonicalize(value))
    ) {
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
  validateDigestRecord(
    value,
    OWNER_KEYS,
    'peers-touch-workflow-owner-binding',
    'WORKFLOW_OWNER_BINDING_INVALID',
  );
  const canonicalRoot = realpathSync(value.executionRoot);
  if (
    !HOSTS.has(value.host) ||
    !SHA256.test(value.rootChatHash) ||
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
    role: 'OWNER',
    executionRoot: canonicalRoot,
    workspaceId: workspaceIdForRoot(canonicalRoot),
    boundAt: operationDate(options.now).toISOString(),
    bindingEvent: 'PRE_TOOL_USE',
  };
  const binding = { ...unsigned, digest: digest(unsigned) };
  validateWorkflowOwnerBinding(binding, {
    host,
    rootChatHash: unsigned.rootChatHash,
  });
  const file = workflowOwnerBindingPath(host, rootChatId, options);
  try {
    writeFileDurably(file, binding);
    fsyncDirectory(path.dirname(file));
    return { binding, created: true };
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = validateWorkflowOwnerBinding(
      readOwnedJson(file, 'WORKFLOW_OWNER_BINDING_INVALID', true),
      { host, rootChatHash: unsigned.rootChatHash },
    );
    return { binding: existing, created: false };
  }
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
  const unsigned = {
    kind: 'peers-touch-workflow-child-binding',
    host,
    executionSessionHash: executionSessionHash(host, executionSessionId),
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
  if (
    assignment === null ||
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

export function resolveEventWorkflowBinding(event, executionRoot, options = {}) {
  const identity = event.bindingIdentity;
  if (!identity?.rootChatId) return { mode: 'OBSERVE_ONLY', projection: null };
  let owner = readWorkflowOwnerBinding(
    event.host,
    identity.rootChatId,
    options,
  );
  if (owner === null) {
    if (event.event !== 'PRE_TOOL_USE') {
      return { mode: 'PREWARM', projection: null };
    }
    if (!executionRoot) return { mode: 'OUTSIDE_PROJECT', projection: null };
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
