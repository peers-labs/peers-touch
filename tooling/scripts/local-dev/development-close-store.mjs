import crypto, { randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import {
  workspaceWorkflowPath,
  workspaceWorkflowRootPath,
} from '../lib/machine-dev-paths.mjs';

export const DEVELOPMENT_CLOSE_KIND =
  'peers-touch-development-close-receipt';

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const WORKSPACE_ID = /^[0-9a-f]{16}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MODES = new Set(['tracked', 'standalone']);
const CLOSE_REASONS = new Set(['completed', 'cancelled', 'owner-abandon']);
const ENVIRONMENT_POLICIES = new Set(['retain', 'unregister']);
const STATES = new Set(['CLOSING', 'BLOCKED', 'CLOSED']);
const RESOURCE_KEYS = new Set([
  'runtimeLeases',
  'session',
  'activeWork',
  'declaration',
  'planMount',
  'environmentRegistration',
]);
const RESOURCE_STATES = {
  runtimeLeases: new Set(['PENDING', 'RELEASED']),
  session: new Set([
    'PENDING',
    'ARCHIVED',
    'ABANDONED',
    'NOT_APPLICABLE',
  ]),
  activeWork: new Set(['PENDING', 'CLOSED', 'NOT_APPLICABLE']),
  declaration: new Set(['PENDING', 'RELEASED', 'NOT_APPLICABLE']),
  planMount: new Set(['PENDING', 'RELEASED', 'NOT_APPLICABLE']),
  environmentRegistration: new Set([
    'PENDING',
    'RETAINED',
    'UNREGISTERED',
    'NOT_REGISTERED',
  ]),
};
const RECEIPT_KEYS = new Set([
  'kind',
  'receiptId',
  'workspaceId',
  'workItemId',
  'mode',
  'closeReason',
  'environmentPolicy',
  'owner',
  'mountId',
  'runId',
  'state',
  'resources',
  'blocker',
  'createdAt',
  'updatedAt',
  'revision',
  'recordDigest',
]);
const BLOCKER_KEYS = new Set(['code', 'message', 'details']);

export class DevelopmentCloseStoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DevelopmentCloseStoreError';
    this.code = code;
    this.details = details;
    this.detail = details;
  }
}

function fail(code, message, details = {}) {
  throw new DevelopmentCloseStoreError(code, message, details);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys) {
  if (!isObject(value)) return false;
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

export function digestDevelopmentCloseReceipt(record) {
  const unsigned = { ...record };
  delete unsigned.recordDigest;
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalize(unsigned)))
    .digest('hex');
}

function requiredText(value, field, pattern = undefined) {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value === '' ||
    value.includes('\0') ||
    value.includes('\n') ||
    (pattern && !pattern.test(value))
  ) {
    fail('DEVELOPMENT_CLOSE_RECEIPT_INVALID', `${field} is invalid`, {
      field,
    });
  }
  return value;
}

function canonicalTimestamp(value, field) {
  requiredText(value, field);
  if (
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    fail(
      'DEVELOPMENT_CLOSE_RECEIPT_INVALID',
      `${field} must be a canonical timestamp`,
    );
  }
  return value;
}

function operationDate(options = {}) {
  const value =
    typeof options.clock === 'function'
      ? options.clock()
      : options.now ?? new Date();
  const now = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(now.getTime())) {
    fail('DEVELOPMENT_CLOSE_RECEIPT_INVALID', 'operation clock is invalid');
  }
  return now;
}

export function developmentCloseReceiptPath(options = {}) {
  requiredText(options.workspaceId, 'workspaceId', WORKSPACE_ID);
  requiredText(options.workItemId, 'workItemId', IDENTIFIER);
  return path.join(
    workspaceWorkflowPath(options.workItemId, {
      home: options.home,
      workspaceId: options.workspaceId,
    }),
    'development-close.json',
  );
}

function validateBlocker(blocker) {
  if (blocker === null) return blocker;
  if (
    !exactKeys(blocker, BLOCKER_KEYS) ||
    !isObject(blocker.details)
  ) {
    fail(
      'DEVELOPMENT_CLOSE_RECEIPT_INVALID',
      'Development close blocker is invalid',
    );
  }
  requiredText(blocker.code, 'blocker.code', IDENTIFIER);
  requiredText(blocker.message, 'blocker.message');
  return blocker;
}

export function validateDevelopmentCloseReceipt(record, expected = {}) {
  if (
    !exactKeys(record, RECEIPT_KEYS) ||
    record.kind !== DEVELOPMENT_CLOSE_KIND ||
    !IDENTIFIER.test(record.receiptId ?? '') ||
    !WORKSPACE_ID.test(record.workspaceId ?? '') ||
    !IDENTIFIER.test(record.workItemId ?? '') ||
    !MODES.has(record.mode) ||
    !CLOSE_REASONS.has(record.closeReason) ||
    !ENVIRONMENT_POLICIES.has(record.environmentPolicy) ||
    !STATES.has(record.state) ||
    !Number.isInteger(record.revision) ||
    record.revision < 1 ||
    !SHA256.test(record.recordDigest ?? '') ||
    digestDevelopmentCloseReceipt(record) !== record.recordDigest ||
    !exactKeys(record.resources, RESOURCE_KEYS)
  ) {
    fail(
      'DEVELOPMENT_CLOSE_RECEIPT_INVALID',
      'Development close receipt is invalid',
    );
  }
  requiredText(record.owner, 'owner');
  canonicalTimestamp(record.createdAt, 'createdAt');
  canonicalTimestamp(record.updatedAt, 'updatedAt');
  for (const [resource, state] of Object.entries(record.resources)) {
    if (!RESOURCE_STATES[resource].has(state)) {
      fail(
        'DEVELOPMENT_CLOSE_RECEIPT_INVALID',
        'Development close resource state is invalid',
        { resource, state },
      );
    }
  }
  for (const field of ['mountId', 'runId']) {
    if (record[field] !== null) {
      requiredText(record[field], field, IDENTIFIER);
    }
  }
  validateBlocker(record.blocker);
  if (record.state === 'BLOCKED' && record.blocker === null) {
    fail(
      'DEVELOPMENT_CLOSE_RECEIPT_INVALID',
      'blocked Development close requires a blocker',
    );
  }
  if (record.state !== 'BLOCKED' && record.blocker !== null) {
    fail(
      'DEVELOPMENT_CLOSE_RECEIPT_INVALID',
      'only blocked Development close may contain a blocker',
    );
  }
  if (record.state === 'CLOSED') {
    const unfinished = Object.entries(record.resources).filter(
      ([, state]) => state === 'PENDING',
    );
    if (unfinished.length > 0) {
      fail(
        'DEVELOPMENT_CLOSE_RECEIPT_INVALID',
        'closed Development close has pending resources',
        { resources: unfinished.map(([resource]) => resource) },
      );
    }
  }
  for (const [field, value] of Object.entries(expected)) {
    if (value !== undefined && record[field] !== value) {
      fail(
        'DEVELOPMENT_CLOSE_RECEIPT_MISMATCH',
        'Development close receipt selector does not match',
        {
          field,
          expected: value,
          actual: record[field],
        },
      );
    }
  }
  return record;
}

function readOwnedRegularFile(file) {
  const metadata = lstatSync(file);
  const ownedByCurrentUser =
    typeof process.getuid !== 'function' || metadata.uid === process.getuid();
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    !ownedByCurrentUser
  ) {
    fail(
      'DEVELOPMENT_CLOSE_RECEIPT_INVALID',
      'Development close receipt must be an owner-controlled regular file',
      { file },
    );
  }
  return readFileSync(file, 'utf8');
}

export function readDevelopmentCloseReceipt(options = {}) {
  const file =
    options.receiptPath ?? developmentCloseReceiptPath(options);
  if (!existsSync(file)) return null;
  let record;
  try {
    record = JSON.parse(readOwnedRegularFile(file));
  } catch (error) {
    if (error instanceof DevelopmentCloseStoreError) throw error;
    fail(
      'DEVELOPMENT_CLOSE_RECEIPT_INVALID',
      'Development close receipt is not valid JSON',
      { file, cause: String(error) },
    );
  }
  return validateDevelopmentCloseReceipt(record, {
    workspaceId: options.workspaceId,
    workItemId: options.workItemId,
  });
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
      'DEVELOPMENT_CLOSE_RECEIPT_INVALID',
      'Development close directory must be owner-controlled',
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

function writeReceiptAtomic(file, record) {
  const directory = path.dirname(file);
  ensurePrivateDirectory(directory);
  const temporary = path.join(
    directory,
    `.${path.basename(file)}.${process.pid}.${randomBytes(16).toString('hex')}`,
  );
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(
      descriptor,
      `${JSON.stringify(canonicalize(record), null, 2)}\n`,
    );
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

export function writeDevelopmentCloseReceipt(record, options = {}) {
  validateDevelopmentCloseReceipt(record);
  const file =
    options.receiptPath ??
    developmentCloseReceiptPath({
      ...options,
      workspaceId: record.workspaceId,
      workItemId: record.workItemId,
    });
  writeReceiptAtomic(file, record);
  const readback = readDevelopmentCloseReceipt({
    receiptPath: file,
    workspaceId: record.workspaceId,
    workItemId: record.workItemId,
  });
  if (readback.recordDigest !== record.recordDigest) {
    fail(
      'DEVELOPMENT_CLOSE_RECEIPT_INVALID',
      'Development close receipt readback failed',
      { file },
    );
  }
  return readback;
}

function receiptId(workspaceId, workItemId) {
  const suffix = crypto
    .createHash('sha256')
    .update(`${workspaceId}\0${workItemId}`)
    .digest('hex')
    .slice(0, 32);
  return `close-${suffix}`;
}

export function createDevelopmentCloseReceipt(input, options = {}) {
  const now = operationDate(options).toISOString();
  const record = {
    kind: DEVELOPMENT_CLOSE_KIND,
    receiptId: receiptId(input.workspaceId, input.workItemId),
    workspaceId: input.workspaceId,
    workItemId: input.workItemId,
    mode: input.mode,
    closeReason: input.closeReason,
    environmentPolicy: input.environmentPolicy,
    owner: input.owner,
    mountId: input.mountId ?? null,
    runId: input.runId ?? null,
    state: 'CLOSING',
    resources: {
      runtimeLeases: 'PENDING',
      session: 'PENDING',
      activeWork: 'PENDING',
      declaration: 'PENDING',
      planMount: 'PENDING',
      environmentRegistration: 'PENDING',
    },
    blocker: null,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    recordDigest: '',
  };
  record.recordDigest = digestDevelopmentCloseReceipt(record);
  return validateDevelopmentCloseReceipt(record);
}

export function updateDevelopmentCloseReceipt(record, update, options = {}) {
  const now = operationDate(options).toISOString();
  const candidate = {
    ...record,
    ...update,
    resources: {
      ...record.resources,
      ...(update.resources ?? {}),
    },
    updatedAt: now,
    revision: record.revision + 1,
    recordDigest: '',
  };
  candidate.recordDigest = digestDevelopmentCloseReceipt(candidate);
  return validateDevelopmentCloseReceipt(candidate);
}

export function listOpenDevelopmentCloseReceipts(options = {}) {
  requiredText(options.workspaceId, 'workspaceId', WORKSPACE_ID);
  const root = workspaceWorkflowRootPath({
    home: options.home,
    workspaceId: options.workspaceId,
  });
  if (!existsSync(root)) return [];
  const records = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const file = path.join(root, entry.name, 'development-close.json');
    if (!existsSync(file)) continue;
    const record = readDevelopmentCloseReceipt({
      receiptPath: file,
      workspaceId: options.workspaceId,
      workItemId: entry.name,
    });
    if (record.state !== 'CLOSED') records.push(record);
  }
  return records.sort((left, right) =>
    left.workItemId.localeCompare(right.workItemId),
  );
}

export function assertDevelopmentCloseAdmission(options = {}) {
  const open = listOpenDevelopmentCloseReceipts(options);
  if (open.length === 0) return null;
  fail(
    'DEVELOPMENT_CLOSE_IN_PROGRESS',
    'workspace has an unfinished Development close',
    {
      workspaceId: options.workspaceId,
      receipts: open.map((record) => ({
        workItemId: record.workItemId,
        receiptId: record.receiptId,
        state: record.state,
        blocker: record.blocker,
      })),
    },
  );
}
