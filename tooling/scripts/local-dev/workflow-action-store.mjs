#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import {
  isDirectInvocation,
  machineDevRoot,
} from '../lib/machine-dev-paths.mjs';

export const ACTION_STORE_KIND = 'peers-touch-workflow-action-store';
export const ACTION_RECEIPT_KIND = 'peers-touch-workflow-action';
export const MAX_ACTION_RECEIPTS = 256;
export const MAX_ACTION_STORE_BYTES = 256 * 1024;
export const MAX_ACTION_STREAMS = 128;
export const ACTION_LEASE_MS = 10_000;
export const ACTION_STALL_GRACE_MS = 30_000;
export const ACTION_LOOP_WINDOW_MS = 10 * 60_000;
export const ACTION_LOOP_THRESHOLD = 4;

const HOSTS = new Set(['trae', 'cursor', 'codex']);
const EVENTS = new Set(['STARTED', 'HEARTBEAT', 'FINISHED']);
const RESULTS = new Set([
  'RUNNING',
  'WAITING',
  'PASS',
  'FAIL',
  'BLOCKED',
  'DENIED',
  'CANCELLED',
]);
const TERMINAL_RESULTS = new Set([
  'PASS',
  'FAIL',
  'BLOCKED',
  'DENIED',
  'CANCELLED',
]);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const WORKSPACE_ID = /^[0-9a-f]{16}$/;
const OPERATION_TEXT = /^[A-Za-z0-9][A-Za-z0-9._:/ -]{0,127}$/;
const TARGET_REF = /^[A-Za-z0-9][A-Za-z0-9._/@+-]*(?:\/[A-Za-z0-9._@+-]+)*$/;

export class WorkflowActionError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'WorkflowActionError';
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, message, detail = {}) {
  throw new WorkflowActionError(code, message, detail);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function operationDate(value = new Date()) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    fail('WORKFLOW_ACTION_CLOCK_INVALID', 'action clock is invalid');
  }
  return date;
}

function ownedByCurrentUser(metadata) {
  return typeof process.getuid !== 'function' || metadata.uid === process.getuid();
}

function assertPrivateDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const metadata = lstatSync(directory);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    !ownedByCurrentUser(metadata) ||
    (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0)
  ) {
    fail(
      'WORKFLOW_ACTION_STORE_INVALID',
      'action store directory is not owner-controlled',
    );
  }
}

function requirePattern(value, pattern, field) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    fail('WORKFLOW_ACTION_INVALID', `${field} is invalid`, { field });
  }
  return value;
}

function nullableIdentifier(value, field) {
  return value === null ? null : requirePattern(value, IDENTIFIER, field);
}

function timestamp(value, field) {
  if (
    typeof value !== 'string' ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    fail('WORKFLOW_ACTION_INVALID', `${field} must be an ISO timestamp`);
  }
  return value;
}

function digest(value) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function receiptDigest(receipt) {
  const unsigned = { ...receipt };
  delete unsigned.digest;
  return digest(unsigned);
}

function validateOperation(operation) {
  if (
    operation === null ||
    typeof operation !== 'object' ||
    Array.isArray(operation) ||
    Object.keys(operation).sort().join(',') !== 'family,label,targetRef'
  ) {
    fail('WORKFLOW_ACTION_INVALID', 'operation shape is invalid');
  }
  requirePattern(operation.family, OPERATION_TEXT, 'operation.family');
  requirePattern(operation.label, OPERATION_TEXT, 'operation.label');
  if (
    operation.targetRef !== null &&
    (typeof operation.targetRef !== 'string' ||
      !TARGET_REF.test(operation.targetRef) ||
      operation.targetRef.includes('..'))
  ) {
    fail('WORKFLOW_ACTION_INVALID', 'operation.targetRef is invalid');
  }
}

export function validateWorkflowActionReceipt(receipt) {
  const keys = [
    'actionId',
    'actor',
    'at',
    'binding',
    'digest',
    'durationMs',
    'event',
    'fingerprint',
    'kind',
    'leaseUntil',
    'operation',
    'previousDigest',
    'progressStamp',
    'result',
    'schemaVersion',
    'sequence',
  ];
  if (
    receipt === null ||
    typeof receipt !== 'object' ||
    Array.isArray(receipt) ||
    Object.keys(receipt).sort().join(',') !== keys.sort().join(',') ||
    receipt.schemaVersion !== 1 ||
    receipt.kind !== ACTION_RECEIPT_KIND ||
    !Number.isInteger(receipt.sequence) ||
    receipt.sequence < 1 ||
    !EVENTS.has(receipt.event) ||
    !RESULTS.has(receipt.result)
  ) {
    fail('WORKFLOW_ACTION_INVALID', 'action receipt shape is invalid');
  }
  requirePattern(receipt.actionId, IDENTIFIER, 'actionId');
  if (
    receipt.actor === null ||
    typeof receipt.actor !== 'object' ||
    Array.isArray(receipt.actor) ||
    Object.keys(receipt.actor).sort().join(',') !==
      'assignmentDigest,bindingDigest,host,parentBindingDigest,role,rootBindingDigest' ||
    !HOSTS.has(receipt.actor.host) ||
    !SHA256.test(receipt.actor.bindingDigest) ||
    !SHA256.test(receipt.actor.rootBindingDigest) ||
    !new Set(['OWNER', 'WORKER', 'REVIEWER']).has(receipt.actor.role) ||
    (receipt.actor.role === 'OWNER' &&
      (receipt.actor.bindingDigest !== receipt.actor.rootBindingDigest ||
        receipt.actor.parentBindingDigest !== null ||
        receipt.actor.assignmentDigest !== null)) ||
    (receipt.actor.role !== 'OWNER' &&
      (!SHA256.test(receipt.actor.parentBindingDigest ?? '') ||
        !SHA256.test(receipt.actor.assignmentDigest ?? '')))
  ) {
    fail('WORKFLOW_ACTION_INVALID', 'action actor is invalid');
  }
  if (
    receipt.binding === null ||
    typeof receipt.binding !== 'object' ||
    Array.isArray(receipt.binding) ||
    Object.keys(receipt.binding).sort().join(',') !==
      'planId,sessionId,taskId,workItemId,workspaceId' ||
    !WORKSPACE_ID.test(receipt.binding.workspaceId)
  ) {
    fail('WORKFLOW_ACTION_INVALID', 'action binding is invalid');
  }
  for (const field of ['workItemId', 'planId', 'taskId', 'sessionId']) {
    nullableIdentifier(receipt.binding[field], `binding.${field}`);
  }
  validateOperation(receipt.operation);
  requirePattern(receipt.fingerprint, SHA256, 'fingerprint');
  requirePattern(receipt.progressStamp, SHA256, 'progressStamp');
  timestamp(receipt.at, 'at');
  if (receipt.leaseUntil !== null) timestamp(receipt.leaseUntil, 'leaseUntil');
  if (
    receipt.durationMs !== null &&
    (!Number.isInteger(receipt.durationMs) || receipt.durationMs < 0)
  ) {
    fail('WORKFLOW_ACTION_INVALID', 'durationMs is invalid');
  }
  if (receipt.previousDigest !== null && !SHA256.test(receipt.previousDigest)) {
    fail('WORKFLOW_ACTION_INVALID', 'previousDigest is invalid');
  }
  if (!SHA256.test(receipt.digest) || receipt.digest !== receiptDigest(receipt)) {
    fail('WORKFLOW_ACTION_INVALID', 'receipt digest is invalid');
  }
  const running = receipt.result === 'RUNNING' || receipt.result === 'WAITING';
  if (
    (receipt.event === 'FINISHED') !== TERMINAL_RESULTS.has(receipt.result) ||
    (running && receipt.leaseUntil === null) ||
    (!running && receipt.leaseUntil !== null)
  ) {
    fail('WORKFLOW_ACTION_INVALID', 'event and result lifecycle disagree');
  }
  return receipt;
}

function emptyStore(workspaceId, rootBindingDigest) {
  return {
    schemaVersion: 1,
    kind: ACTION_STORE_KIND,
    workspaceId,
    rootBindingDigest,
    compactedThrough: null,
    receipts: [],
  };
}

function validateStore(store, expected = {}) {
  const keys = [
    'compactedThrough',
    'kind',
    'receipts',
    'rootBindingDigest',
    'schemaVersion',
    'workspaceId',
  ];
  if (
    store === null ||
    typeof store !== 'object' ||
    Array.isArray(store) ||
    Object.keys(store).sort().join(',') !== keys.sort().join(',') ||
    store.schemaVersion !== 1 ||
    store.kind !== ACTION_STORE_KIND ||
    !WORKSPACE_ID.test(store.workspaceId) ||
    !SHA256.test(store.rootBindingDigest) ||
    (store.compactedThrough !== null && !SHA256.test(store.compactedThrough)) ||
    !Array.isArray(store.receipts) ||
    store.receipts.length > MAX_ACTION_RECEIPTS
  ) {
    fail('WORKFLOW_ACTION_STORE_INVALID', 'action store shape is invalid');
  }
  for (const [field, value] of Object.entries(expected)) {
    if (value !== undefined && store[field] !== value) {
      fail('WORKFLOW_ACTION_STORE_INVALID', `action store ${field} mismatches`);
    }
  }
  let previous = store.compactedThrough;
  let sequence = null;
  for (const receipt of store.receipts) {
    validateWorkflowActionReceipt(receipt);
    if (
      receipt.binding.workspaceId !== store.workspaceId ||
      receipt.actor.rootBindingDigest !== store.rootBindingDigest ||
      receipt.previousDigest !== previous ||
      (sequence !== null && receipt.sequence !== sequence + 1)
    ) {
      fail('WORKFLOW_ACTION_STORE_INVALID', 'action receipt chain is invalid');
    }
    previous = receipt.digest;
    sequence = receipt.sequence;
  }
  return store;
}

export function workflowActionPaths(options) {
  const workspaceId = requirePattern(
    options.workspaceId,
    WORKSPACE_ID,
    'workspaceId',
  );
  const rootBindingDigest = requirePattern(
    options.rootBindingDigest,
    SHA256,
    'rootBindingDigest',
  );
  const directory = path.join(
    options.machineRoot ? path.resolve(options.machineRoot) : machineDevRoot(options.home),
    'workspaces',
    workspaceId,
    'workflow',
    'actions',
  );
  const stem = rootBindingDigest;
  return {
    directory,
    store: path.join(directory, `${stem}.json`),
    lock: path.join(directory, `${stem}.lock`),
  };
}

function readStoreFile(file, expected, required = false) {
  if (!existsSync(file)) {
    if (required) fail('WORKFLOW_ACTION_STORE_MISSING', 'action store is missing');
    return null;
  }
  const metadata = lstatSync(file);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    !ownedByCurrentUser(metadata) ||
    (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) ||
    metadata.size > MAX_ACTION_STORE_BYTES
  ) {
    fail('WORKFLOW_ACTION_STORE_INVALID', 'action store file is unsafe');
  }
  try {
    return validateStore(JSON.parse(readFileSync(file, 'utf8')), expected);
  } catch (error) {
    if (error instanceof WorkflowActionError) throw error;
    fail('WORKFLOW_ACTION_STORE_INVALID', 'action store is not valid JSON');
  }
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function acquireLock(file, now, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      const descriptor = openSync(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      writeFileSync(descriptor, `${process.pid}\n${now.toISOString()}\n`);
      closeSync(descriptor);
      return () => {
        try {
          unlinkSync(file);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const age = Date.now() - statSync(file).mtimeMs;
      if (age > 30_000) {
        unlinkSync(file);
        continue;
      }
      if (Date.now() >= deadline) {
        fail('WORKFLOW_ACTION_LOCK_TIMEOUT', 'action store lock timed out');
      }
      sleep(10);
    }
  }
}

function writeStore(file, store) {
  const bytes = `${JSON.stringify(canonicalize(store), null, 2)}\n`;
  if (Buffer.byteLength(bytes) > MAX_ACTION_STORE_BYTES) {
    fail('WORKFLOW_ACTION_STORE_FULL', 'action store exceeds its byte budget');
  }
  const temporary = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(temporary, bytes, { mode: 0o600, flag: 'wx' });
  renameSync(temporary, file);
}

function compactStore(store) {
  while (store.receipts.length > MAX_ACTION_RECEIPTS) {
    store.compactedThrough = store.receipts.shift().digest;
  }
  while (
    store.receipts.length > 1 &&
    Buffer.byteLength(`${JSON.stringify(canonicalize(store), null, 2)}\n`) >
      MAX_ACTION_STORE_BYTES
  ) {
    store.compactedThrough = store.receipts.shift().digest;
  }
}

function normalizedBinding(binding) {
  if (binding === null || typeof binding !== 'object') {
    fail('WORKFLOW_ACTION_INVALID', 'action binding is required');
  }
  return {
    workspaceId: requirePattern(binding.workspaceId, WORKSPACE_ID, 'workspaceId'),
    workItemId: nullableIdentifier(binding.workItemId ?? null, 'workItemId'),
    planId: nullableIdentifier(binding.planId ?? null, 'planId'),
    taskId: nullableIdentifier(binding.taskId ?? null, 'taskId'),
    sessionId: nullableIdentifier(binding.sessionId ?? null, 'sessionId'),
  };
}

function normalizedActor(actor) {
  if (actor === null || typeof actor !== 'object' || Array.isArray(actor)) {
    fail('WORKFLOW_ACTION_INVALID', 'action actor is required');
  }
  const normalized = {
    host: requirePattern(actor.host, /^(trae|cursor|codex)$/, 'actor.host'),
    bindingDigest: requirePattern(
      actor.bindingDigest,
      SHA256,
      'actor.bindingDigest',
    ),
    role: requirePattern(
      actor.role,
      /^(OWNER|WORKER|REVIEWER)$/,
      'actor.role',
    ),
    rootBindingDigest: requirePattern(
      actor.rootBindingDigest,
      SHA256,
      'actor.rootBindingDigest',
    ),
    parentBindingDigest:
      actor.parentBindingDigest === null
        ? null
        : requirePattern(
            actor.parentBindingDigest,
            SHA256,
            'actor.parentBindingDigest',
          ),
    assignmentDigest:
      actor.assignmentDigest === null
        ? null
        : requirePattern(
            actor.assignmentDigest,
            SHA256,
            'actor.assignmentDigest',
          ),
  };
  if (
    (normalized.role === 'OWNER' &&
      (normalized.bindingDigest !== normalized.rootBindingDigest ||
        normalized.parentBindingDigest !== null ||
        normalized.assignmentDigest !== null)) ||
    (normalized.role !== 'OWNER' &&
      (normalized.parentBindingDigest === null ||
        normalized.assignmentDigest === null))
  ) {
    fail('WORKFLOW_ACTION_INVALID', 'action actor lineage is invalid');
  }
  return normalized;
}

export function recordWorkflowAction(options) {
  const now = operationDate(options.now);
  const binding = normalizedBinding(options.binding);
  const actor = normalizedActor(options.actor);
  if (actor.rootBindingDigest !== options.rootBindingDigest) {
    fail('WORKFLOW_ACTION_INVALID', 'action root binding digest mismatches');
  }
  const paths = workflowActionPaths({
    home: options.home,
    machineRoot: options.machineRoot,
    workspaceId: binding.workspaceId,
    rootBindingDigest: actor.rootBindingDigest,
  });
  assertPrivateDirectory(paths.directory);
  const release = acquireLock(paths.lock, now, options.lockTimeoutMs);
  try {
    const store =
      readStoreFile(paths.store, {
        workspaceId: binding.workspaceId,
        rootBindingDigest: actor.rootBindingDigest,
      }) ?? emptyStore(binding.workspaceId, actor.rootBindingDigest);
    const previous = store.receipts.at(-1) ?? null;
    const event = options.event ?? 'STARTED';
    const result = options.result ?? (event === 'FINISHED' ? 'PASS' : 'RUNNING');
    const operation = {
      family: requirePattern(options.operation?.family, OPERATION_TEXT, 'operation.family'),
      label: requirePattern(options.operation?.label, OPERATION_TEXT, 'operation.label'),
      targetRef:
        options.operation?.targetRef === undefined
          ? null
          : options.operation.targetRef,
    };
    validateOperation(operation);
    const actionId =
      options.actionId ??
      (event === 'STARTED'
        ? `action-${randomBytes(12).toString('hex')}`
        : previous?.actionId ?? `action-${randomBytes(12).toString('hex')}`);
    const oneShotDenied =
      event === 'FINISHED' && result === 'DENIED';
    const previousForAction = [...store.receipts]
      .reverse()
      .find((receipt) => receipt.actionId === actionId) ?? null;
    if (
      event !== 'STARTED' &&
      !oneShotDenied &&
      (previousForAction === null ||
        previousForAction.actor.bindingDigest !== actor.bindingDigest ||
        TERMINAL_RESULTS.has(previousForAction.result))
    ) {
      fail('WORKFLOW_ACTION_LIFECYCLE_INVALID', 'action lifecycle is not active');
    }

    const at = now.toISOString();
    const leaseUntil = TERMINAL_RESULTS.has(result)
      ? null
      : new Date(now.getTime() + (options.leaseMs ?? ACTION_LEASE_MS)).toISOString();
    const unsigned = {
      schemaVersion: 1,
      kind: ACTION_RECEIPT_KIND,
      sequence: (previous?.sequence ?? 0) + 1,
      actionId,
      actor,
      binding,
      event,
      result,
      operation,
      fingerprint: digest({ operation, result }),
      progressStamp: requirePattern(
        options.progressStamp,
        SHA256,
        'progressStamp',
      ),
      at,
      leaseUntil,
      durationMs:
        options.durationMs === undefined ? null : options.durationMs,
      previousDigest: previous?.digest ?? store.compactedThrough,
    };
    const receipt = { ...unsigned, digest: digest(unsigned) };
    validateWorkflowActionReceipt(receipt);
    store.receipts.push(receipt);
    compactStore(store);
    validateStore(store);
    writeStore(paths.store, store);
    return receipt;
  } finally {
    release();
  }
}

export function readWorkflowActions(options) {
  const paths = workflowActionPaths(options);
  return (
    readStoreFile(paths.store, {
      workspaceId: options.workspaceId,
      rootBindingDigest: options.rootBindingDigest,
    }) ?? emptyStore(options.workspaceId, options.rootBindingDigest)
  ).receipts;
}

export function readWorkspaceActions(options) {
  const workspaceId = requirePattern(options.workspaceId, WORKSPACE_ID, 'workspaceId');
  const directory = path.join(
    options.machineRoot ? path.resolve(options.machineRoot) : machineDevRoot(options.home),
    'workspaces',
    workspaceId,
    'workflow',
    'actions',
  );
  if (!existsSync(directory)) return [];
  const metadata = lstatSync(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || !ownedByCurrentUser(metadata)) {
    fail('WORKFLOW_ACTION_STORE_INVALID', 'action root is unsafe');
  }
  const files = readdirSync(directory)
    .filter((name) => /^[0-9a-f]{64}\.json$/.test(name))
    .sort()
    .slice(-MAX_ACTION_STREAMS);
  return files
    .flatMap((name) =>
      readStoreFile(path.join(directory, name), { workspaceId }, true).receipts,
    )
    .sort(
      (left, right) =>
        left.at.localeCompare(right.at) || left.sequence - right.sequence,
    );
}

export function reduceWorkflowActivity(receipts, options = {}) {
  const now = operationDate(options.now);
  const sorted = [...receipts].sort(
    (left, right) =>
      left.at.localeCompare(right.at) || left.sequence - right.sequence,
  );
  const latest = sorted.at(-1) ?? null;
  const loopWindowStart = now.getTime() - ACTION_LOOP_WINDOW_MS;
  const equivalentTerminal = latest
    ? sorted.filter(
        (receipt) =>
          TERMINAL_RESULTS.has(receipt.result) &&
          receipt.fingerprint === latest.fingerprint &&
          receipt.progressStamp === latest.progressStamp &&
          Date.parse(receipt.at) >= loopWindowStart,
      )
    : [];
  const stalled =
    latest !== null &&
    latest.leaseUntil !== null &&
    now.getTime() > Date.parse(latest.leaseUntil) + ACTION_STALL_GRACE_MS;
  const state = options.drift
    ? 'drift'
    : options.blocked || ['BLOCKED', 'DENIED'].includes(latest?.result)
      ? 'blocked'
      : options.completed
        ? 'complete'
        : equivalentTerminal.length >= ACTION_LOOP_THRESHOLD
          ? 'looping'
          : stalled
            ? 'stalled'
            : (latest?.result === 'PASS' && options.runningPlan) ||
                latest?.result === 'WAITING'
              ? 'waiting'
              : latest?.result === 'RUNNING'
                ? 'working'
                : 'idle';
  return {
    state,
    lastAction:
      latest === null
        ? null
        : {
            actionId: latest.actionId,
            operation: latest.operation,
            result: latest.result,
            at: latest.at,
            ageMs: Math.max(0, now.getTime() - Date.parse(latest.at)),
          },
    loopCount: equivalentTerminal.length,
    receiptCount: sorted.length,
  };
}

export async function runWorkflowActionHeartbeat(options) {
  const intervalMs = options.intervalMs ?? ACTION_LEASE_MS;
  const maximumHeartbeats = options.maximumHeartbeats ?? 60;
  for (let index = 0; index < maximumHeartbeats; index += 1) {
    await delay(intervalMs);
    const receipts = readWorkflowActions({
      ...options,
      workspaceId: options.workspaceId ?? options.binding?.workspaceId,
    });
    const latest = [...receipts]
      .reverse()
      .find((receipt) => receipt.actionId === options.actionId);
    if (
      latest?.actionId !== options.actionId ||
      TERMINAL_RESULTS.has(latest.result)
    ) {
      return;
    }
    try {
      recordWorkflowAction({
        ...options,
        event: 'HEARTBEAT',
        result: latest.result === 'WAITING' ? 'WAITING' : 'RUNNING',
        operation: latest.operation,
        progressStamp: latest.progressStamp,
        now: new Date(),
      });
    } catch (error) {
      if (error?.code === 'WORKFLOW_ACTION_LIFECYCLE_INVALID') return;
      throw error;
    }
  }
}

export function startWorkflowActionHeartbeat(options) {
  const script = fileURLToPath(import.meta.url);
  const payload = Buffer.from(JSON.stringify(options)).toString('base64url');
  const child = spawn(process.execPath, [script, 'heartbeat-loop', payload], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return child.pid;
}

if (isDirectInvocation(import.meta.url)) {
  try {
    const command = process.argv[2];
    if (command === 'heartbeat-loop') {
      const payload = JSON.parse(
        Buffer.from(process.argv[3] ?? '', 'base64url').toString('utf8'),
      );
      await runWorkflowActionHeartbeat(payload);
    } else if (command === 'self-check') {
      process.stdout.write(
        `${JSON.stringify({ ok: true, kind: ACTION_STORE_KIND })}\n`,
      );
    } else {
      fail(
        'WORKFLOW_ACTION_USAGE',
        'action must be self-check or heartbeat-loop',
      );
    }
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        ok: false,
        error: {
          code: error.code ?? 'WORKFLOW_ACTION_FAILED',
          message: error.message,
          detail: error.detail ?? {},
        },
      })}\n`,
    );
    process.exitCode = 2;
  }
}
