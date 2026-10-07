import crypto, { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const PLAN_COMPLETION_KIND = 'peers-touch-plan-completion';

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const WORKSPACE_ID = /^[0-9a-f]{16}$/;
const COMPLETION_KEYS = new Set([
  'branch',
  'closureStatuses',
  'completedAt',
  'digest',
  'initialHead',
  'kind',
  'planContentDigest',
  'planDigest',
  'planId',
  'runId',
  'schemaVersion',
  'snapshotDigest',
  'taskStates',
  'workspaceId',
]);

export class PlanCompletionError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'PlanCompletionError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }

  toJSON() {
    return {
      ok: false,
      error: {
        type: this.name,
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

function fail(code, message, details) {
  throw new PlanCompletionError(code, message, details);
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

function digestRecord(record) {
  const unsigned = { ...record };
  delete unsigned.digest;
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalize(unsigned)))
    .digest('hex');
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

function canonicalTimestamp(value) {
  return (
    typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

export function planCompletionPath(planPackage) {
  return path.join(
    path.dirname(planPackage.path),
    'completions',
    `${planPackage.planDigest}.json`,
  );
}

function ensureCompletionDirectory(file) {
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true });
  if (fs.realpathSync(directory) !== directory) {
    fail(
      'PLAN_COMPLETION_INVALID',
      'Plan completion directory must not traverse a symlink',
      { directory },
    );
  }
}

export function validatePlanCompletion(record, planPackage) {
  const taskIds = planPackage.plan.tasks.map((task) => task.id).sort();
  const closureIds = [
    ...new Set(
      planPackage.tasks.map((task) => task.closureId),
    ),
  ].sort();
  if (
    !exactKeys(record, COMPLETION_KEYS) ||
    record.schemaVersion !== 1 ||
    record.kind !== PLAN_COMPLETION_KIND ||
    !IDENTIFIER.test(record.planId ?? '') ||
    !SHA256.test(record.planDigest ?? '') ||
    !SHA256.test(record.planContentDigest ?? '') ||
    !IDENTIFIER.test(record.runId ?? '') ||
    !SHA256.test(record.snapshotDigest ?? '') ||
    !WORKSPACE_ID.test(record.workspaceId ?? '') ||
    typeof record.branch !== 'string' ||
    record.branch.length === 0 ||
    !SHA1.test(record.initialHead ?? '') ||
    !canonicalTimestamp(record.completedAt) ||
    record.taskStates === null ||
    typeof record.taskStates !== 'object' ||
    Array.isArray(record.taskStates) ||
    record.closureStatuses === null ||
    typeof record.closureStatuses !== 'object' ||
    Array.isArray(record.closureStatuses)
  ) {
    fail('PLAN_COMPLETION_INVALID', 'Plan completion contract is invalid');
  }
  if (
    record.planId !== planPackage.plan.planId ||
    record.planDigest !== planPackage.planDigest ||
    record.planContentDigest !== planPackage.planContentDigest
  ) {
    fail(
      'PLAN_COMPLETION_STALE',
      'Plan completion contract does not match current Plan source',
    );
  }
  if (
    Object.keys(record.taskStates).sort().join('\0') !== taskIds.join('\0') ||
    Object.values(record.taskStates).some((state) => state !== 'done') ||
    Object.keys(record.closureStatuses).sort().join('\0') !==
      closureIds.join('\0') ||
    Object.values(record.closureStatuses).some((state) => state !== 'done')
  ) {
    fail(
      'PLAN_COMPLETION_INCOMPLETE',
      'Plan completion contract does not close every Task and closure',
    );
  }
  if (!SHA256.test(record.digest ?? '') || digestRecord(record) !== record.digest) {
    fail('PLAN_COMPLETION_INVALID', 'Plan completion digest is invalid');
  }
  return record;
}

export function readPlanCompletion(planPackage, options = {}) {
  const file = planCompletionPath(planPackage);
  if (!fs.existsSync(file)) {
    if (options.required === true) {
      fail(
        'PLAN_COMPLETION_REQUIRED',
        'repository Plan completion contract is missing',
        { file },
      );
    }
    return null;
  }
  ensureCompletionDirectory(file);
  const metadata = fs.lstatSync(file);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size > 256 * 1024
  ) {
    fail(
      'PLAN_COMPLETION_INVALID',
      'Plan completion path is not a bounded regular file',
      { file },
    );
  }
  let record;
  try {
    record = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail('PLAN_COMPLETION_INVALID', 'Plan completion is not valid JSON', {
      file,
      cause: String(error),
    });
  }
  return validatePlanCompletion(record, planPackage);
}

function writeCreateOnce(file, record) {
  ensureCompletionDirectory(file);
  const temporary = `${file}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  const bytes = `${JSON.stringify(canonicalize(record), null, 2)}\n`;
  try {
    const descriptor = fs.openSync(temporary, 'wx', 0o600);
    try {
      fs.writeFileSync(descriptor, bytes);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.linkSync(temporary, file);
    if (process.platform !== 'win32') {
      const directory = fs.openSync(path.dirname(file), 'r');
      try {
        fs.fsyncSync(directory);
      } finally {
        fs.closeSync(directory);
      }
    }
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = fs.readFileSync(file, 'utf8');
    if (existing !== bytes) {
      fail(
        'PLAN_COMPLETION_IMMUTABLE',
        'completion path already contains different evidence',
        { file },
      );
    }
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export function publishPlanCompletion(resolved) {
  if (resolved.run.state !== 'completed') {
    fail(
      'PLAN_COMPLETION_INCOMPLETE',
      'only a completed Execution Run may be sealed',
      { state: resolved.run.state },
    );
  }
  if (
    resolved.run.snapshotDigest !== resolved.snapshot.recordDigest ||
    resolved.snapshot.planDigest !== resolved.planPackage.planDigest ||
    resolved.snapshot.planContentDigest !==
      resolved.planPackage.planContentDigest
  ) {
    fail(
      'PLAN_COMPLETION_STALE',
      'completed run does not match current Plan source and snapshot',
    );
  }
  const taskStates = Object.fromEntries(
    Object.entries(resolved.run.taskStates).map(([taskId, state]) => [
      taskId,
      state.state,
    ]),
  );
  const closureStatuses = Object.fromEntries(
    resolved.planPackage.tasks.map((task) => [
      task.closureId,
      taskStates[task.taskId],
    ]),
  );
  const unsigned = {
    schemaVersion: 1,
    kind: PLAN_COMPLETION_KIND,
    planId: resolved.snapshot.planId,
    planDigest: resolved.snapshot.planDigest,
    planContentDigest: resolved.snapshot.planContentDigest,
    runId: resolved.run.runId,
    snapshotDigest: resolved.snapshot.recordDigest,
    workspaceId: resolved.snapshot.executionBinding.workspaceId,
    branch: resolved.snapshot.executionBinding.branch,
    initialHead: resolved.snapshot.executionBinding.initialHead,
    taskStates,
    closureStatuses,
    completedAt: resolved.run.updatedAt,
  };
  const record = { ...unsigned, digest: digestRecord(unsigned) };
  validatePlanCompletion(record, resolved.planPackage);
  const file = planCompletionPath(resolved.planPackage);
  writeCreateOnce(file, record);
  return { file, completion: record };
}
