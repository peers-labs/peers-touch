import { createHash } from 'node:crypto';

import {
  canonicalize,
  isObject,
} from './dev-work-schema.mjs';

export const SESSION_SCHEMA_VERSION = 1;
export const SESSION_KIND = 'peers-touch-development-session';
export const EVENT_KINDS = new Set([
  'SESSION_STARTED',
  'TRANSITIONED',
  'COMPACTED_BASELINE',
]);
export const EXECUTION_MODES = new Set(['build', 'fix']);
export const COMPLETION_CLASSES = new Set([
  'source',
  'functional',
  'acceptance-aggregate',
]);
export const DEVELOPMENT_STATES = new Set([
  'BOUND',
  'REPRODUCING',
  'REPRODUCED',
  'IMPLEMENTING',
  'FOCUSED_CHECKING',
  'FOCUSED_PASS',
  'SOURCE_READY',
  'CHECKPOINTING',
  'CHECKPOINTED',
  'DEPLOYING',
  'DEPLOYED',
  'FUNCTIONAL_RUNNING',
  'FUNCTIONAL_PASS',
  'ACCEPTANCE_READY',
  'ACCEPTANCE_UPDATING',
  'FINAL_CHECKPOINTED',
  'ACCEPTANCE_RUNNING',
  'ACCEPTANCE_PASS',
  'DELIVERY_READY',
  'FAILED',
  'BLOCKED',
  'STALE',
  'CLEANING',
  'CANCELLED',
]);
export const TERMINAL_STATES = new Set([
  'SOURCE_READY',
  'DELIVERY_READY',
  'CANCELLED',
]);
export const VERIFICATION_CLASSES = new Set([
  'SOURCE_CHECK',
  'STRUCTURAL_CHECK',
  'UX_REVIEW',
  'FUNCTIONAL_CHECK',
  'ACCEPTANCE_PROOF',
]);
export const VERIFICATION_RESULTS = new Set([
  'PASS',
  'FAIL',
  'BLOCKED',
  'NOT_RUN',
]);
export const FAILURE_KINDS = new Set([
  'REPRODUCTION_NOT_OBSERVED',
  'SOURCE_CHECK_FAILED',
  'CHECKPOINT_REQUIRED',
  'AUTHORIZATION_REQUIRED',
  'PROFILE_UNAVAILABLE',
  'RESOURCE_CONFLICT',
  'DEPLOYMENT_FAILED',
  'SOURCE_IDENTITY_MISMATCH',
  'RUNTIME_START_FAILED',
  'PRODUCT_ASSERTION_FAILED',
  'DRIVER_FAILED',
  'TIMEOUT',
  'CLEANUP_FAILED',
  'CANCELLED',
]);
export const FAILURE_OWNERS = new Set([
  'product',
  'source',
  'local-dev-control-plane',
  'runtime',
  'journey-driver',
  'authorization',
]);

const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const SHA = /^[0-9a-f]{40,64}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SESSION_KEYS = new Set([
  'schemaVersion',
  'kind',
  'state',
  'eventCount',
  'eventDigest',
]);
const STATE_KEYS = new Set([
  'sessionId',
  'workItemId',
  'planId',
  'taskId',
  'workspaceId',
  'branch',
  'journeyId',
  'executionMode',
  'state',
  'source',
  'runtimeBindingRef',
  'currentFailure',
  'lastVerification',
  'startedAt',
  'updatedAt',
]);
const SOURCE_KEYS = new Set([
  'commit',
  'tree',
  'branch',
  'clean',
  'createdAt',
  'purpose',
]);
const VERIFICATION_REQUIRED_KEYS = new Set([
  'id',
  'verificationClass',
  'result',
  'startedAt',
  'durationMs',
  'artifactRefs',
]);
const VERIFICATION_OPTIONAL_KEYS = new Set([
  'commandDigest',
  'sourceCommit',
  'journeyId',
  'runtimeBindingDigest',
]);
const FAILURE_REQUIRED_KEYS = new Set([
  'kind',
  'stage',
  'owner',
  'summary',
  'retryable',
]);
const FAILURE_OPTIONAL_KEYS = new Set(['journeyStepId', 'diagnosticRef']);
const EVENT_KEYS = new Set([
  'schemaVersion',
  'kind',
  'sequence',
  'sessionId',
  'at',
  'reason',
  'previousDigest',
  'compactedThrough',
  'snapshot',
  'eventDigest',
]);
const UPDATE_KEYS = new Set([
  'source',
  'runtimeBindingRef',
  'failure',
  'verification',
]);

export class DevSessionError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'DevSessionError';
    this.code = code;
    this.detail = detail;
  }
}

export function sessionFail(code, message, detail = {}) {
  throw new DevSessionError(code, message, detail);
}

function exactKeys(value, keys) {
  const actual = Object.keys(value);
  return actual.length === keys.size && actual.every((key) => keys.has(key));
}

function requiredAndOptionalKeys(value, required, optional) {
  const actual = Object.keys(value);
  return (
    [...required].every((key) => actual.includes(key)) &&
    actual.every((key) => required.has(key) || optional.has(key))
  );
}

function requiredText(value, field, maxLength = 1024) {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value.length === 0 ||
    value.length > maxLength ||
    value.includes('\0')
  ) {
    sessionFail('SESSION_SCHEMA_INVALID', `${field} is invalid`, { field });
  }
  return value;
}

function requiredIdentifier(value, field) {
  const text = requiredText(value, field, 128);
  if (!IDENTIFIER.test(text)) {
    sessionFail('SESSION_SCHEMA_INVALID', `${field} is not an identifier`, {
      field,
    });
  }
  return text;
}

function validateIsoTimestamp(value, field) {
  requiredText(value, field);
  const milliseconds = Date.parse(value);
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  ) {
    sessionFail('SESSION_SCHEMA_INVALID', `${field} is not an ISO timestamp`, {
      field,
    });
  }
}

function validateStringArray(value, field) {
  if (!Array.isArray(value)) {
    sessionFail('SESSION_SCHEMA_INVALID', `${field} must be an array`, { field });
  }
  for (const [index, item] of value.entries()) {
    requiredText(item, `${field}[${index}]`, 2048);
  }
}

export function validateSourceCheckpoint(source) {
  if (!isObject(source) || !exactKeys(source, SOURCE_KEYS)) {
    sessionFail('SESSION_SCHEMA_INVALID', 'source checkpoint fields are invalid');
  }
  if (!SHA.test(requiredText(source.commit, 'source.commit', 64))) {
    sessionFail('SESSION_SCHEMA_INVALID', 'source.commit is invalid');
  }
  if (!SHA.test(requiredText(source.tree, 'source.tree', 64))) {
    sessionFail('SESSION_SCHEMA_INVALID', 'source.tree is invalid');
  }
  requiredText(source.branch, 'source.branch');
  if (source.clean !== true) {
    sessionFail('SESSION_SCHEMA_INVALID', 'source.clean must be true');
  }
  validateIsoTimestamp(source.createdAt, 'source.createdAt');
  if (source.purpose !== 'development-runtime') {
    sessionFail('SESSION_SCHEMA_INVALID', 'source.purpose is invalid');
  }
  return source;
}

export function validateVerificationRecord(record) {
  if (
    !isObject(record) ||
    !requiredAndOptionalKeys(
      record,
      VERIFICATION_REQUIRED_KEYS,
      VERIFICATION_OPTIONAL_KEYS,
    )
  ) {
    sessionFail('SESSION_SCHEMA_INVALID', 'verification fields are invalid');
  }
  requiredIdentifier(record.id, 'verification.id');
  if (!VERIFICATION_CLASSES.has(record.verificationClass)) {
    sessionFail('SESSION_SCHEMA_INVALID', 'verificationClass is invalid');
  }
  if (!VERIFICATION_RESULTS.has(record.result)) {
    sessionFail('SESSION_SCHEMA_INVALID', 'verification result is invalid');
  }
  if (
    !Number.isInteger(record.durationMs) ||
    record.durationMs < 0
  ) {
    sessionFail('SESSION_SCHEMA_INVALID', 'verification durationMs is invalid');
  }
  validateIsoTimestamp(record.startedAt, 'verification.startedAt');
  validateStringArray(record.artifactRefs, 'verification.artifactRefs');
  if (
    record.commandDigest !== undefined &&
    !SHA256.test(requiredText(record.commandDigest, 'verification.commandDigest', 64))
  ) {
    sessionFail('SESSION_SCHEMA_INVALID', 'verification.commandDigest is invalid');
  }
  if (
    record.sourceCommit !== undefined &&
    !SHA.test(requiredText(record.sourceCommit, 'verification.sourceCommit', 64))
  ) {
    sessionFail('SESSION_SCHEMA_INVALID', 'verification.sourceCommit is invalid');
  }
  if (record.journeyId !== undefined) {
    requiredText(record.journeyId, 'verification.journeyId');
  }
  if (
    record.runtimeBindingDigest !== undefined &&
    !SHA256.test(
      requiredText(
        record.runtimeBindingDigest,
        'verification.runtimeBindingDigest',
        64,
      ),
    )
  ) {
    sessionFail(
      'SESSION_SCHEMA_INVALID',
      'verification.runtimeBindingDigest is invalid',
    );
  }
  return record;
}

export function validateFailure(failure) {
  if (
    !isObject(failure) ||
    !requiredAndOptionalKeys(
      failure,
      FAILURE_REQUIRED_KEYS,
      FAILURE_OPTIONAL_KEYS,
    )
  ) {
    sessionFail('SESSION_SCHEMA_INVALID', 'failure fields are invalid');
  }
  if (!FAILURE_KINDS.has(failure.kind)) {
    sessionFail('SESSION_SCHEMA_INVALID', 'failure kind is invalid');
  }
  if (!DEVELOPMENT_STATES.has(failure.stage)) {
    sessionFail('SESSION_SCHEMA_INVALID', 'failure stage is invalid');
  }
  if (!FAILURE_OWNERS.has(failure.owner)) {
    sessionFail('SESSION_SCHEMA_INVALID', 'failure owner is invalid');
  }
  requiredText(failure.summary, 'failure.summary', 2048);
  if (typeof failure.retryable !== 'boolean') {
    sessionFail('SESSION_SCHEMA_INVALID', 'failure.retryable must be boolean');
  }
  if (failure.journeyStepId !== undefined) {
    requiredText(failure.journeyStepId, 'failure.journeyStepId');
  }
  if (failure.diagnosticRef !== undefined) {
    requiredText(failure.diagnosticRef, 'failure.diagnosticRef', 2048);
  }
  return failure;
}

export function validateSessionState(state) {
  if (!isObject(state) || !exactKeys(state, STATE_KEYS)) {
    sessionFail('SESSION_SCHEMA_INVALID', 'session state fields are invalid');
  }
  for (const field of [
    'sessionId',
    'workItemId',
    'planId',
    'taskId',
  ]) {
    requiredIdentifier(state[field], field);
  }
  if (!/^[0-9a-f]{16}$/.test(state.workspaceId)) {
    sessionFail('SESSION_SCHEMA_INVALID', 'workspaceId is invalid');
  }
  requiredText(state.branch, 'branch');
  requiredText(state.journeyId, 'journeyId');
  if (!EXECUTION_MODES.has(state.executionMode)) {
    sessionFail('SESSION_SCHEMA_INVALID', 'executionMode is invalid');
  }
  if (!DEVELOPMENT_STATES.has(state.state)) {
    sessionFail('SESSION_SCHEMA_INVALID', 'development state is invalid');
  }
  if (state.source !== null) validateSourceCheckpoint(state.source);
  if (state.runtimeBindingRef !== null) {
    requiredText(state.runtimeBindingRef, 'runtimeBindingRef', 2048);
  }
  if (state.currentFailure !== null) validateFailure(state.currentFailure);
  if (state.lastVerification !== null) {
    validateVerificationRecord(state.lastVerification);
  }
  validateIsoTimestamp(state.startedAt, 'startedAt');
  validateIsoTimestamp(state.updatedAt, 'updatedAt');
  if (Date.parse(state.startedAt) > Date.parse(state.updatedAt)) {
    sessionFail('SESSION_SCHEMA_INVALID', 'session timestamps are out of order');
  }
  return state;
}

export function validateSession(session) {
  if (!isObject(session) || !exactKeys(session, SESSION_KEYS)) {
    sessionFail('SESSION_SCHEMA_INVALID', 'session fields are invalid');
  }
  if (
    session.schemaVersion !== SESSION_SCHEMA_VERSION ||
    session.kind !== SESSION_KIND
  ) {
    sessionFail('SESSION_SCHEMA_INVALID', 'session kind or version is invalid');
  }
  validateSessionState(session.state);
  if (!Number.isInteger(session.eventCount) || session.eventCount < 1) {
    sessionFail('SESSION_SCHEMA_INVALID', 'eventCount is invalid');
  }
  if (!SHA256.test(session.eventDigest)) {
    sessionFail('SESSION_SCHEMA_INVALID', 'eventDigest is invalid');
  }
  return session;
}

export function digestEvent(event) {
  const unsigned = { ...event };
  delete unsigned.eventDigest;
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(unsigned)))
    .digest('hex');
}

export function validateTransitionEvent(event) {
  if (!isObject(event) || !exactKeys(event, EVENT_KEYS)) {
    sessionFail('SESSION_JOURNAL_INVALID', 'transition event fields are invalid');
  }
  if (
    event.schemaVersion !== SESSION_SCHEMA_VERSION ||
    !EVENT_KINDS.has(event.kind) ||
    !Number.isInteger(event.sequence) ||
    event.sequence < 1
  ) {
    sessionFail('SESSION_JOURNAL_INVALID', 'transition event header is invalid');
  }
  requiredIdentifier(event.sessionId, 'event.sessionId');
  validateIsoTimestamp(event.at, 'event.at');
  requiredText(event.reason, 'event.reason', 2048);
  if (event.previousDigest !== null && !SHA256.test(event.previousDigest)) {
    sessionFail('SESSION_JOURNAL_INVALID', 'event previousDigest is invalid');
  }
  if (
    event.compactedThrough !== null &&
    (!Number.isInteger(event.compactedThrough) ||
      event.compactedThrough < 1)
  ) {
    sessionFail('SESSION_JOURNAL_INVALID', 'event compactedThrough is invalid');
  }
  try {
    validateSessionState(event.snapshot);
  } catch (error) {
    if (error instanceof DevSessionError) {
      sessionFail('SESSION_JOURNAL_INVALID', error.message, error.detail);
    }
    throw error;
  }
  if (
    event.sessionId !== event.snapshot.sessionId ||
    event.at !== event.snapshot.updatedAt
  ) {
    sessionFail('SESSION_JOURNAL_INVALID', 'event snapshot identity is invalid');
  }
  if (!SHA256.test(event.eventDigest) || digestEvent(event) !== event.eventDigest) {
    sessionFail('SESSION_JOURNAL_INVALID', 'event digest mismatch', {
      sequence: event.sequence,
    });
  }
  return event;
}

export function createInitialSessionState(input, at) {
  const state = {
    sessionId: input.sessionId,
    workItemId: input.workItemId,
    planId: input.planId,
    taskId: input.taskId,
    workspaceId: input.workspaceId,
    branch: input.branch,
    journeyId: input.journeyId,
    executionMode: input.executionMode,
    state: 'BOUND',
    source: null,
    runtimeBindingRef: null,
    currentFailure: null,
    lastVerification: null,
    startedAt: at,
    updatedAt: at,
  };
  return validateSessionState(state);
}

function focusedVerificationPasses(record) {
  return (
    record?.result === 'PASS' &&
    ['SOURCE_CHECK', 'STRUCTURAL_CHECK', 'UX_REVIEW'].includes(
      record.verificationClass,
    )
  );
}

function hasFormalGates(task, acceptance) {
  const gates = acceptance?.closures?.[task.closureId];
  return Array.isArray(gates) && gates.length > 0;
}

function normalTargets(state, context) {
  const task = context.task;
  switch (state.state) {
    case 'BOUND':
      return new Set([
        state.executionMode === 'fix' ? 'REPRODUCING' : 'IMPLEMENTING',
      ]);
    case 'REPRODUCING':
      return new Set(['REPRODUCED']);
    case 'REPRODUCED':
      return new Set(['IMPLEMENTING']);
    case 'IMPLEMENTING':
      return new Set(['FOCUSED_CHECKING']);
    case 'FOCUSED_CHECKING':
      return new Set(['FOCUSED_PASS']);
    case 'FOCUSED_PASS':
      if (task.completionClass === 'source') {
        return new Set(['SOURCE_READY']);
      }
      if (task.completionClass === 'acceptance-aggregate') {
        return new Set(
          hasFormalGates(task, context.acceptance)
            ? ['ACCEPTANCE_RUNNING']
            : [],
        );
      }
      if (
        task.completionClass === 'functional' &&
        task.runtimeClass === 'source-only' &&
        ['infrastructure', 'refactor'].includes(task.workClass)
      ) {
        return new Set(['FUNCTIONAL_RUNNING']);
      }
      if (
        task.completionClass === 'functional' &&
        ['service', 'browser', 'native-desktop', 'native-mobile'].includes(
          task.runtimeClass,
        )
      ) {
        return new Set(['CHECKPOINTING']);
      }
      return new Set();
    case 'CHECKPOINTING':
      return new Set(['CHECKPOINTED']);
    case 'CHECKPOINTED':
      return new Set(['DEPLOYING']);
    case 'DEPLOYING':
      return new Set(['DEPLOYED']);
    case 'DEPLOYED':
      return new Set(['FUNCTIONAL_RUNNING']);
    case 'FUNCTIONAL_RUNNING':
      return new Set(['FUNCTIONAL_PASS']);
    case 'FUNCTIONAL_PASS':
      return new Set([
        hasFormalGates(task, context.acceptance)
          ? 'ACCEPTANCE_READY'
          : 'DELIVERY_READY',
      ]);
    case 'ACCEPTANCE_READY':
      return new Set(['ACCEPTANCE_UPDATING', 'FINAL_CHECKPOINTED']);
    case 'ACCEPTANCE_UPDATING':
      return new Set(['FINAL_CHECKPOINTED']);
    case 'FINAL_CHECKPOINTED':
      return new Set(['ACCEPTANCE_RUNNING']);
    case 'ACCEPTANCE_RUNNING':
      return new Set(['ACCEPTANCE_PASS']);
    case 'ACCEPTANCE_PASS':
      return new Set(['DELIVERY_READY']);
    case 'FAILED':
      return new Set(['IMPLEMENTING']);
    case 'BLOCKED':
      return new Set(['BOUND', 'IMPLEMENTING', 'DEPLOYING']);
    case 'STALE':
      return new Set(['FOCUSED_CHECKING', 'CHECKPOINTING', 'DEPLOYING']);
    case 'CLEANING':
      return new Set(['CANCELLED']);
    default:
      return new Set();
  }
}

function expectedBlockedRecovery(owner) {
  if (owner === 'source') return 'IMPLEMENTING';
  if (
    ['local-dev-control-plane', 'runtime', 'journey-driver'].includes(owner)
  ) {
    return 'DEPLOYING';
  }
  return 'BOUND';
}

function assertTransitionGuard(current, next, context) {
  if (!isObject(context.task) || !isObject(context.acceptance)) {
    sessionFail(
      'SESSION_TRANSITION_INVALID',
      'transition requires Task and Acceptance context',
    );
  }
  if (!COMPLETION_CLASSES.has(context.task.completionClass)) {
    sessionFail(
      'SESSION_TRANSITION_INVALID',
      'Task completion class is invalid',
      { completionClass: context.task.completionClass ?? null },
    );
  }
  if (
    context.task.taskId !== current.taskId ||
    context.task.planId !== current.planId ||
    context.task.executionMode !== current.executionMode ||
    context.task.journeyId !== current.journeyId
  ) {
    sessionFail('SESSION_IDENTITY_MISMATCH', 'Task context does not match Session');
  }
  if (TERMINAL_STATES.has(current.state)) {
    sessionFail('SESSION_TRANSITION_INVALID', 'terminal Session cannot transition', {
      from: current.state,
      to: next.state,
    });
  }
  if (next.state === 'CLEANING') return;
  if (['FAILED', 'BLOCKED', 'STALE'].includes(next.state)) {
    if (
      ['FAILED', 'BLOCKED'].includes(next.state) &&
      next.currentFailure === null
    ) {
      sessionFail(
        'SESSION_TRANSITION_INVALID',
        `${next.state} requires a first failure`,
      );
    }
    return;
  }
  if (!normalTargets(current, context).has(next.state)) {
    sessionFail('SESSION_TRANSITION_INVALID', 'illegal Session transition', {
      from: current.state,
      to: next.state,
      workClass: context.task.workClass,
      completionClass: context.task.completionClass,
      runtimeClass: context.task.runtimeClass,
    });
  }
  if (
    current.state === 'REPRODUCING' &&
    !(
      next.lastVerification?.verificationClass === 'FUNCTIONAL_CHECK' &&
      next.lastVerification.result === 'FAIL'
    )
  ) {
    sessionFail(
      'SESSION_VERIFICATION_REQUIRED',
      'REPRODUCED requires a failing functional reproduction record',
    );
  }
  if (
    current.state === 'REPRODUCED' &&
    next.currentFailure === null
  ) {
    sessionFail(
      'SESSION_TRANSITION_INVALID',
      'IMPLEMENTING after reproduction requires the first failure',
    );
  }
  if (
    current.state === 'FOCUSED_CHECKING' &&
    !focusedVerificationPasses(next.lastVerification)
  ) {
    sessionFail(
      'SESSION_VERIFICATION_REQUIRED',
      'FOCUSED_PASS requires a passing focused verification',
    );
  }
  if (
    current.state === 'FOCUSED_PASS' &&
    next.state === 'CHECKPOINTING' &&
    context.authorization?.checkpoint?.localCommit !== 'allowed'
  ) {
    sessionFail(
      'SESSION_AUTHORIZATION_REQUIRED',
      'checkpoint authorization is required',
    );
  }
  if (current.state === 'CHECKPOINTING' && next.source === null) {
    sessionFail(
      'SESSION_CHECKPOINT_REQUIRED',
      'CHECKPOINTED requires a clean source checkpoint',
    );
  }
  if (
    current.state === 'CHECKPOINTED' &&
    (!Array.isArray(context.authorization?.runtime?.deployProfiles) ||
      context.authorization.runtime.deployProfiles.length === 0)
  ) {
    sessionFail(
      'SESSION_AUTHORIZATION_REQUIRED',
      'deployment authorization is required',
    );
  }
  if (
    current.state === 'DEPLOYING' &&
    next.runtimeBindingRef === null
  ) {
    sessionFail(
      'SESSION_RUNTIME_REQUIRED',
      'DEPLOYED requires a runtime binding reference',
    );
  }
  if (
    current.state === 'FUNCTIONAL_RUNNING' &&
    !(
      next.lastVerification?.verificationClass === 'FUNCTIONAL_CHECK' &&
      next.lastVerification.result === 'PASS'
    )
  ) {
    sessionFail(
      'SESSION_VERIFICATION_REQUIRED',
      'FUNCTIONAL_PASS requires FUNCTIONAL_CHECK/PASS',
    );
  }
  if (
    ['ACCEPTANCE_READY', 'ACCEPTANCE_UPDATING'].includes(current.state) &&
    next.state === 'FINAL_CHECKPOINTED' &&
    next.source === null
  ) {
    sessionFail(
      'SESSION_CHECKPOINT_REQUIRED',
      'FINAL_CHECKPOINTED requires a clean source checkpoint',
    );
  }
  if (
    current.state === 'ACCEPTANCE_UPDATING' &&
    !focusedVerificationPasses(next.lastVerification)
  ) {
    sessionFail(
      'SESSION_VERIFICATION_REQUIRED',
      'updated Acceptance coverage must pass a focused verification',
    );
  }
  if (current.state === 'FINAL_CHECKPOINTED' && next.source === null) {
    sessionFail(
      'SESSION_CHECKPOINT_REQUIRED',
      'ACCEPTANCE_RUNNING requires final source identity',
    );
  }
  if (
    current.state === 'ACCEPTANCE_RUNNING' &&
    !(
      next.lastVerification?.verificationClass === 'ACCEPTANCE_PROOF' &&
      next.lastVerification.result === 'PASS'
    )
  ) {
    sessionFail(
      'SESSION_VERIFICATION_REQUIRED',
      'ACCEPTANCE_PASS requires ACCEPTANCE_PROOF/PASS',
    );
  }
  if (
    ['FAILED', 'STALE'].includes(current.state) &&
    next.currentFailure !== null
  ) {
    sessionFail(
      'SESSION_TRANSITION_INVALID',
      'recovery must clear the current failure',
    );
  }
  if (current.state === 'BLOCKED') {
    const expected = expectedBlockedRecovery(current.currentFailure?.owner);
    if (next.state !== expected || next.currentFailure !== null) {
      sessionFail(
        'SESSION_TRANSITION_INVALID',
        'blocked recovery does not match the failure owner',
        { owner: current.currentFailure?.owner, expected: [expected] },
      );
    }
  }
}

export function transitionSessionState(
  current,
  to,
  updates,
  context,
  at,
) {
  validateSessionState(current);
  if (!DEVELOPMENT_STATES.has(to)) {
    sessionFail('SESSION_TRANSITION_INVALID', 'target state is invalid', { to });
  }
  if (!isObject(updates)) {
    sessionFail('SESSION_SCHEMA_INVALID', 'transition updates must be an object');
  }
  const unknown = Object.keys(updates).filter((key) => !UPDATE_KEYS.has(key));
  if (unknown.length > 0) {
    sessionFail('SESSION_SCHEMA_INVALID', 'transition updates are invalid', {
      unknown,
    });
  }
  validateIsoTimestamp(at, 'transition.at');
  const next = {
    ...current,
    state: to,
    updatedAt: at,
    source:
      Object.prototype.hasOwnProperty.call(updates, 'source')
        ? updates.source
        : current.source,
    runtimeBindingRef:
      Object.prototype.hasOwnProperty.call(updates, 'runtimeBindingRef')
        ? updates.runtimeBindingRef
        : current.runtimeBindingRef,
    currentFailure:
      Object.prototype.hasOwnProperty.call(updates, 'failure')
        ? updates.failure
        : current.currentFailure,
    lastVerification:
      Object.prototype.hasOwnProperty.call(updates, 'verification')
        ? updates.verification
        : current.lastVerification,
  };
  validateSessionState(next);
  assertTransitionGuard(current, next, context);
  return next;
}
