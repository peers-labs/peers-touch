import { randomBytes } from 'node:crypto';
import {
  chmodSync,
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
import path from 'node:path';

import { workspaceWorkflowPath } from '../lib/machine-dev-paths.mjs';
import { processStartIdentity } from './dev-work-ledger.mjs';
import { canonicalize, isObject } from './dev-work-schema.mjs';
import {
  DevSessionError,
  SESSION_KIND,
  SESSION_SCHEMA_VERSION,
  digestEvent,
  sessionFail,
  transitionSessionState,
  validateSession,
  validateTransitionEvent,
} from './dev-session-schema.mjs';

export const MAX_SESSION_EVENTS = 256;
export const MAX_SESSION_EVENT_BYTES = 1024 * 1024;

const LOCK_TIMEOUT_MS = 5_000;
const LOCK_KEYS = new Set(['pid', 'processStart', 'createdAt']);

function exactKeys(value, keys) {
  const actual = Object.keys(value);
  return actual.length === keys.size && actual.every((key) => keys.has(key));
}

function operationDate(options = {}) {
  const value =
    typeof options.clock === 'function'
      ? options.clock()
      : options.now ?? new Date();
  const now = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(now.getTime())) {
    sessionFail('INVALID_CLOCK', 'operation clock returned an invalid time');
  }
  return now;
}

function ensurePrivateDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
}

export function sessionStorePaths(options) {
  const directory = workspaceWorkflowPath(options.workItemId, {
    home: options.home,
    repoRoot: options.workspaceRoot,
    workspaceId: options.workspaceId,
  });
  return {
    directory,
    session: path.join(directory, 'session.json'),
    events: path.join(directory, 'events.ndjson'),
    lock: path.join(directory, 'session.lock'),
  };
}

function syncDirectory(directory) {
  if (process.platform === 'win32') return;
  let fd;
  try {
    fd = openSync(directory, 'r');
    fsyncSync(fd);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function writeAtomic(file, content) {
  const directory = path.dirname(file);
  ensurePrivateDirectory(directory);
  const temp = path.join(
    directory,
    `.${path.basename(file)}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`,
  );
  let fd;
  try {
    fd = openSync(temp, 'wx', 0o600);
    writeFileSync(fd, content);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temp, file);
    chmodSync(file, 0o600);
    syncDirectory(directory);
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temp)) unlinkSync(temp);
  }
}

export function writeDurableFileAtomic(file, content) {
  const directory = path.dirname(file);
  ensurePrivateDirectory(directory);
  const temp = path.join(
    directory,
    `.${path.basename(file)}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`,
  );
  let fd;
  try {
    fd = openSync(temp, 'wx', 0o600);
    writeFileSync(fd, content);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    try {
      linkSync(temp, file);
      chmodSync(file, 0o600);
      syncDirectory(directory);
    } catch (error) {
      if (
        error?.code !== 'EEXIST' ||
        !readFileSync(file).equals(Buffer.from(content))
      ) {
        throw error;
      }
    }
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temp)) unlinkSync(temp);
  }
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

function readLockMetadata(lockFile) {
  let raw;
  try {
    raw = readFileSync(lockFile, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    sessionFail('SESSION_LOCK_INVALID', 'Session lock cannot be read', {
      cause: String(error),
    });
  }
  let metadata;
  try {
    metadata = JSON.parse(raw);
  } catch (error) {
    sessionFail('SESSION_LOCK_INVALID', 'Session lock is not valid JSON', {
      cause: String(error),
    });
  }
  const createdAt = Date.parse(metadata?.createdAt);
  if (
    !isObject(metadata) ||
    !exactKeys(metadata, LOCK_KEYS) ||
    !Number.isInteger(metadata.pid) ||
    metadata.pid <= 0 ||
    typeof metadata.processStart !== 'string' ||
    metadata.processStart.trim() !== metadata.processStart ||
    metadata.processStart === '' ||
    !Number.isFinite(createdAt) ||
    new Date(createdAt).toISOString() !== metadata.createdAt
  ) {
    sessionFail('SESSION_LOCK_INVALID', 'Session lock schema is invalid');
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

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function acquireLock(lockFile, now, timeoutMs = LOCK_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      const processStart = processStartIdentity();
      if (!processStart) {
        sessionFail('SESSION_LOCK_INVALID', 'cannot verify lock process identity');
      }
      const owned = {
        pid: process.pid,
        processStart,
        createdAt: now.toISOString(),
      };
      publishLockAtomic(lockFile, owned);
      return () => {
        const current = readLockMetadata(lockFile);
        if (current && JSON.stringify(current) !== JSON.stringify(owned)) {
          sessionFail('SESSION_LOCK_INVALID', 'Session lock ownership changed');
        }
        try {
          unlinkSync(lockFile);
          syncDirectory(path.dirname(lockFile));
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const metadata = readLockMetadata(lockFile);
      if (metadata === null) continue;
      const live = processIsAlive(metadata.pid);
      const actualStart = processStartIdentity(metadata.pid);
      if (live && actualStart === null) {
        sessionFail(
          'SESSION_LOCK_INVALID',
          'live Session lock has no verifiable process identity',
        );
      }
      if (!live || actualStart !== metadata.processStart) {
        try {
          unlinkSync(lockFile);
          syncDirectory(path.dirname(lockFile));
        } catch (unlinkError) {
          if (unlinkError?.code !== 'ENOENT') throw unlinkError;
        }
        continue;
      }
      if (Date.now() >= deadline) {
        sessionFail('SESSION_LOCKED', 'timed out acquiring Session lock');
      }
      sleep(50);
    }
  }
}

function withSessionLock(options, operation) {
  const paths = sessionStorePaths(options);
  const now = operationDate(options);
  ensurePrivateDirectory(paths.directory);
  const release = acquireLock(paths.lock, now, options.lockTimeoutMs);
  try {
    return operation(paths, now);
  } finally {
    release();
  }
}

function parseEvents(file) {
  if (!existsSync(file)) return [];
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    sessionFail('SESSION_JOURNAL_INVALID', 'Session journal cannot be read', {
      cause: String(error),
    });
  }
  if (raw.length === 0 || !raw.endsWith('\n')) {
    sessionFail(
      'SESSION_JOURNAL_INVALID',
      'Session journal must contain complete newline-terminated events',
    );
  }
  const events = raw
    .slice(0, -1)
    .split('\n')
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        sessionFail('SESSION_JOURNAL_INVALID', 'Session event is not valid JSON', {
          line: index + 1,
          cause: String(error),
        });
      }
    });
  validateJournal(events);
  return events;
}

function validateJournal(events) {
  if (events.length === 0) {
    sessionFail('SESSION_JOURNAL_INVALID', 'Session journal is empty');
  }
  for (const event of events) validateTransitionEvent(event);
  const first = events[0];
  if (first.kind === 'SESSION_STARTED') {
    if (
      first.sequence !== 1 ||
      first.previousDigest !== null ||
      first.compactedThrough !== null
    ) {
      sessionFail('SESSION_JOURNAL_INVALID', 'Session start event is invalid');
    }
  } else if (first.kind === 'COMPACTED_BASELINE') {
    if (
      first.sequence < 2 ||
      first.previousDigest === null ||
      first.compactedThrough !== first.sequence
    ) {
      sessionFail('SESSION_JOURNAL_INVALID', 'compacted baseline is invalid');
    }
  } else {
    sessionFail('SESSION_JOURNAL_INVALID', 'Session journal has no valid baseline');
  }
  for (let index = 1; index < events.length; index += 1) {
    const previous = events[index - 1];
    const current = events[index];
    if (
      current.kind !== 'TRANSITIONED' ||
      current.sequence !== previous.sequence + 1 ||
      current.previousDigest !== previous.eventDigest ||
      current.compactedThrough !== null ||
      current.sessionId !== first.sessionId
    ) {
      sessionFail('SESSION_JOURNAL_INVALID', 'Session journal chain is invalid', {
        sequence: current.sequence,
      });
    }
  }
}

function parseSnapshot(file) {
  if (!existsSync(file)) return null;
  let snapshot;
  try {
    snapshot = JSON.parse(readFileSync(file, 'utf8'));
    validateSession(snapshot);
  } catch (error) {
    if (error instanceof DevSessionError) {
      sessionFail('SESSION_JOURNAL_INVALID', error.message, error.detail);
    }
    sessionFail('SESSION_JOURNAL_INVALID', 'Session snapshot is invalid', {
      cause: String(error),
    });
  }
  return snapshot;
}

function stateEquals(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function materialize(events) {
  const latest = events.at(-1);
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    kind: SESSION_KIND,
    state: latest.snapshot,
    eventCount: events.length,
    eventDigest: latest.eventDigest,
  };
}

function reconcileSnapshot(paths, events, snapshot) {
  const projected = materialize(events);
  if (snapshot === null) {
    writeAtomic(
      paths.session,
      `${JSON.stringify(canonicalize(projected), null, 2)}\n`,
    );
    return projected;
  }
  if (
    snapshot.eventCount === projected.eventCount &&
    snapshot.eventDigest === projected.eventDigest &&
    stateEquals(snapshot.state, projected.state)
  ) {
    return snapshot;
  }
  const snapshotEventIndex = events.findIndex(
    (event) => event.eventDigest === snapshot.eventDigest,
  );
  const compactedFromSnapshot =
    events[0].kind === 'COMPACTED_BASELINE' &&
    events[0].previousDigest === snapshot.eventDigest;
  if (
    (snapshotEventIndex >= 0 &&
      snapshot.eventCount === snapshotEventIndex + 1 &&
      stateEquals(snapshot.state, events[snapshotEventIndex].snapshot)) ||
    compactedFromSnapshot
  ) {
    writeAtomic(
      paths.session,
      `${JSON.stringify(canonicalize(projected), null, 2)}\n`,
    );
    return projected;
  }
  sessionFail(
    'SESSION_JOURNAL_INVALID',
    'Session snapshot is ahead of or inconsistent with its journal',
    {
      snapshotEventCount: snapshot.eventCount,
      journalEventCount: events.length,
      snapshotDigest: snapshot.eventDigest,
      journalDigest: projected.eventDigest,
    },
  );
}

function readAndRepair(paths) {
  const hasEvents = existsSync(paths.events);
  const hasSnapshot = existsSync(paths.session);
  if (!hasEvents && !hasSnapshot) {
    sessionFail('SESSION_UNAVAILABLE', 'Development Session does not exist');
  }
  if (!hasEvents) {
    sessionFail(
      'SESSION_JOURNAL_INVALID',
      'Session snapshot exists without its journal',
    );
  }
  const events = parseEvents(paths.events);
  const snapshot = parseSnapshot(paths.session);
  return { events, session: reconcileSnapshot(paths, events, snapshot) };
}

function assertIdentity(session, expected = {}) {
  const mismatches = {};
  for (const field of [
    'sessionId',
    'workItemId',
    'planId',
    'taskId',
    'workspaceId',
    'branch',
  ]) {
    if (
      expected[field] !== undefined &&
      session.state[field] !== expected[field]
    ) {
      mismatches[field] = {
        expected: expected[field],
        actual: session.state[field],
      };
    }
  }
  if (Object.keys(mismatches).length > 0) {
    sessionFail('SESSION_IDENTITY_MISMATCH', 'Session identity does not match', {
      mismatches,
    });
  }
}

export function createTransitionEvent({
  kind,
  sequence,
  sessionId,
  at,
  reason,
  previousDigest,
  compactedThrough,
  snapshot,
}) {
  const event = {
    schemaVersion: SESSION_SCHEMA_VERSION,
    kind,
    sequence,
    sessionId,
    at,
    reason,
    previousDigest,
    compactedThrough,
    snapshot,
  };
  event.eventDigest = digestEvent(event);
  validateTransitionEvent(event);
  return event;
}

function serializeEvents(events) {
  return `${events.map((event) => JSON.stringify(canonicalize(event))).join('\n')}\n`;
}

function boundedEvents(events, newEvent, options) {
  const proposed = [...events, newEvent];
  const maxEvents = options.maxEvents ?? MAX_SESSION_EVENTS;
  const maxBytes = options.maxBytes ?? MAX_SESSION_EVENT_BYTES;
  if (!Number.isInteger(maxEvents) || maxEvents < 1) {
    sessionFail('SESSION_STORE_INVALID', 'maxEvents must be a positive integer');
  }
  if (!Number.isInteger(maxBytes) || maxBytes < 1) {
    sessionFail('SESSION_STORE_INVALID', 'maxBytes must be a positive integer');
  }
  if (
    proposed.length <= maxEvents &&
    Buffer.byteLength(serializeEvents(proposed), 'utf8') <= maxBytes
  ) {
    return proposed;
  }
  const priorDigest = events.at(-1)?.eventDigest;
  if (!priorDigest) {
    sessionFail(
      'SESSION_JOURNAL_INVALID',
      'cannot compact a Session without a prior log digest',
    );
  }
  const baseline = createTransitionEvent({
    kind: 'COMPACTED_BASELINE',
    sequence: newEvent.sequence,
    sessionId: newEvent.sessionId,
    at: newEvent.at,
    reason: `Compacted through: ${newEvent.reason}`,
    previousDigest: priorDigest,
    compactedThrough: newEvent.sequence,
    snapshot: newEvent.snapshot,
  });
  const serialized = serializeEvents([baseline]);
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    sessionFail(
      'SESSION_BOUNDS_EXCEEDED',
      'compacted Session event exceeds the byte bound',
    );
  }
  return [baseline];
}

function writeSessionFiles(paths, events, hooks = {}) {
  const session = materialize(events);
  hooks.beforeCommit?.(paths);
  writeAtomic(paths.events, serializeEvents(events));
  writeAtomic(
    paths.session,
    `${JSON.stringify(canonicalize(session), null, 2)}\n`,
  );
  const readbackEvents = parseEvents(paths.events);
  const readback = parseSnapshot(paths.session);
  if (
    readback === null ||
    readback.eventDigest !== readbackEvents.at(-1).eventDigest ||
    readback.eventCount !== readbackEvents.length
  ) {
    sessionFail('SESSION_JOURNAL_INVALID', 'Session write readback failed');
  }
  return readback;
}

export function createSessionStore(initialState, options) {
  return withSessionLock(options, (paths) => {
    if (existsSync(paths.events) || existsSync(paths.session)) {
      sessionFail('SESSION_ALREADY_EXISTS', 'Development Session already exists');
    }
    const event = createTransitionEvent({
      kind: 'SESSION_STARTED',
      sequence: 1,
      sessionId: initialState.sessionId,
      at: initialState.updatedAt,
      reason: options.reason ?? 'Session started',
      previousDigest: null,
      compactedThrough: null,
      snapshot: initialState,
    });
    return writeSessionFiles(paths, [event]);
  });
}

export function loadSessionStore(options) {
  return withSessionLock(options, (paths) => {
    const { session } = readAndRepair(paths);
    assertIdentity(session, options.expected);
    return session;
  });
}

export function loadSessionStoreFromPath(sessionPath, options = {}) {
  const session = path.resolve(sessionPath);
  if (path.basename(session) !== 'session.json') {
    sessionFail(
      'SESSION_UNAVAILABLE',
      'Session handoff path must name session.json',
    );
  }
  const paths = {
    directory: path.dirname(session),
    session,
    events: path.join(path.dirname(session), 'events.ndjson'),
    lock: path.join(path.dirname(session), 'session.lock'),
  };
  const now = operationDate(options);
  ensurePrivateDirectory(paths.directory);
  const release = acquireLock(paths.lock, now, options.lockTimeoutMs);
  try {
    const { session: stored } = readAndRepair(paths);
    assertIdentity(stored, options.expected);
    return stored;
  } finally {
    release();
  }
}

export function readSessionJournal(options) {
  return withSessionLock(options, (paths) => {
    const { events, session } = readAndRepair(paths);
    assertIdentity(session, options.expected);
    return { events, session };
  });
}

export function transitionSessionStore(options) {
  return withSessionLock(options, (paths, now) => {
    const { events, session } = readAndRepair(paths);
    assertIdentity(session, options.expected);
    const nextState = transitionSessionState(
      session.state,
      options.to,
      options.updates ?? {},
      options.context,
      now.toISOString(),
    );
    const latest = events.at(-1);
    const event = createTransitionEvent({
      kind: 'TRANSITIONED',
      sequence: latest.sequence + 1,
      sessionId: nextState.sessionId,
      at: nextState.updatedAt,
      reason: options.reason,
      previousDigest: latest.eventDigest,
      compactedThrough: null,
      snapshot: nextState,
    });
    const bounded = boundedEvents(events, event, options);
    return writeSessionFiles(paths, bounded, {
      beforeCommit: options.beforeCommit,
    });
  });
}

export function transitionSessionSequenceStore(options) {
  return withSessionLock(options, (paths, now) => {
    const { events, session } = readAndRepair(paths);
    assertIdentity(session, options.expected);
    if (
      options.expectedEventDigest !== undefined &&
      session.eventDigest !== options.expectedEventDigest
    ) {
      sessionFail(
        'SESSION_EVIDENCE_OUT_OF_SEQUENCE',
        'Session changed after the owner runner started',
        {
          expectedEventDigest: options.expectedEventDigest,
          actualEventDigest: session.eventDigest,
        },
      );
    }
    const transitions = options.transitions(session.state);
    if (!Array.isArray(transitions) || transitions.length === 0) {
      return session;
    }

    let bounded = events;
    let current = session.state;
    for (const [index, transition] of transitions.entries()) {
      const at = new Date(now.getTime() + index).toISOString();
      const nextState = transitionSessionState(
        current,
        transition.to,
        transition.updates ?? {},
        options.context,
        at,
      );
      const latest = bounded.at(-1);
      const event = createTransitionEvent({
        kind: 'TRANSITIONED',
        sequence: latest.sequence + 1,
        sessionId: nextState.sessionId,
        at: nextState.updatedAt,
        reason: transition.reason ?? options.reason,
        previousDigest: latest.eventDigest,
        compactedThrough: null,
        snapshot: nextState,
      });
      bounded = boundedEvents(bounded, event, options);
      current = nextState;
    }
    return writeSessionFiles(paths, bounded, {
      beforeCommit: options.beforeCommit,
    });
  });
}
