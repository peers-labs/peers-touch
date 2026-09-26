import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  machineDevRoot,
  workspaceIdForRoot,
} from '../lib/machine-dev-paths.mjs';

const MANIFEST_MAX_LINES = 300;
const MANIFEST_MAX_BYTES = 20 * 1024;
const TASK_MAX_LINES = 200;
const TASK_MAX_BYTES = 12 * 1024;
const SNAPSHOT_MAX_LINES = 30;

const WORK_CLASSES = new Set([
  'product-behavior',
  'infrastructure',
  'refactor',
  'documentation',
]);
const COMPLETION_CLASSES = new Set([
  'source',
  'functional',
  'acceptance-aggregate',
]);
const PLAN_STATUSES = new Set([
  'draft',
  'prepared',
  'active',
  'blocked',
  'completed',
  'superseded',
]);
const TASK_STATUSES = new Set(['pending', 'in_progress', 'blocked', 'done']);
const RUNTIME_CLASSES = new Set([
  'source-only',
  'service',
  'browser',
  'native-desktop',
  'native-mobile',
]);
const VERIFICATION_CLASSES = new Set([
  'SOURCE_CHECK',
  'STRUCTURAL_CHECK',
  'UX_REVIEW',
  'FUNCTIONAL_CHECK',
  'ACCEPTANCE_PROOF',
]);
const FOCUSED_VERIFICATION_CLASSES = new Set([
  'SOURCE_CHECK',
  'STRUCTURAL_CHECK',
  'UX_REVIEW',
]);
const VERIFICATION_RESULTS = new Set(['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN']);
const LOCKED_MIGRATION_PHASES = new Set([
  'LOCKED',
  'APPLYING',
  'VERIFYING',
  'ROLLING_BACK',
]);
const MIGRATION_PHASES = new Set([
  'PREPARED',
  ...LOCKED_MIGRATION_PHASES,
  'COMMITTED',
  'ROLLED_BACK',
]);
const FORBIDDEN_SECTION_PATTERN =
  /^(?:context anchor|appendix|appendices|dated progress|progress (?:log|history|appendix)|execution log|attempt log|raw (?:command )?(?:output|log)|command output|run[- ]?ids?(?: list)?)$/i;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SHA1_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export const TASK_SLICES_COLLECTION = 'Map';

export class PlanPackageError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'PlanPackageError';
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
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
  throw new PlanPackageError(code, message, details);
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
    fail('PLAN_SCHEMA_INVALID', `${context} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fail('PLAN_SCHEMA_INVALID', `${context} has unknown or missing fields`, {
      expected,
      actual,
    });
  }
}

function assertArray(value, context, { min = 0 } = {}) {
  if (!Array.isArray(value) || value.length < min) {
    fail('PLAN_SCHEMA_INVALID', `${context} must be an array with at least ${min} item(s)`);
  }
}

function assertString(value, context, { pattern, allowEmpty = false } = {}) {
  if (
    typeof value !== 'string' ||
    (!allowEmpty && value.trim().length === 0) ||
    (pattern && !pattern.test(value))
  ) {
    fail('PLAN_SCHEMA_INVALID', `${context} must be a valid non-empty string`);
  }
  return value;
}

function assertInteger(value, context, { min = 0 } = {}) {
  if (!Number.isInteger(value) || value < min) {
    fail('PLAN_SCHEMA_INVALID', `${context} must be an integer >= ${min}`);
  }
}

function assertEnum(value, allowed, context) {
  if (!allowed.has(value)) {
    fail('PLAN_SCHEMA_INVALID', `${context} has unsupported value`, {
      value,
      allowed: [...allowed],
    });
  }
}

function assertUniqueStrings(values, context, { min = 0, pattern } = {}) {
  assertArray(values, context, { min });
  const seen = new Set();
  for (const [index, value] of values.entries()) {
    assertString(value, `${context}[${index}]`, { pattern });
    if (seen.has(value)) {
      fail('PLAN_DUPLICATE', `${context} contains duplicate value`, { value });
    }
    seen.add(value);
  }
}

function lineCount(text) {
  if (text.length === 0) return 0;
  const newlineCount = (text.match(/\n/g) ?? []).length;
  return newlineCount + (text.endsWith('\n') ? 0 : 1);
}

function assertBounds(text, kind, sourcePath) {
  const isManifest = kind === 'manifest';
  const maxLines = isManifest ? MANIFEST_MAX_LINES : TASK_MAX_LINES;
  const maxBytes = isManifest ? MANIFEST_MAX_BYTES : TASK_MAX_BYTES;
  const lines = lineCount(text);
  const bytes = Buffer.byteLength(text, 'utf8');
  if (lines > maxLines || bytes > maxBytes) {
    fail('PLAN_BOUNDS_EXCEEDED', `${kind} exceeds its mechanical bounds`, {
      path: sourcePath,
      lines,
      maxLines,
      bytes,
      maxBytes,
    });
  }
}

function markdownLines(text) {
  const result = [];
  let offset = 0;
  const matches = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  for (const raw of matches) {
    const withoutLf = raw.endsWith('\n') ? raw.slice(0, -1) : raw;
    const value = withoutLf.endsWith('\r') ? withoutLf.slice(0, -1) : withoutLf;
    result.push({ value, raw, offset });
    offset += raw.length;
  }
  return result;
}

function normalizeBlockLabel(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ');
}

export function findStructuredBlocks(text, requestedLabel) {
  const expected = normalizeBlockLabel(requestedLabel);
  const lines = markdownLines(text);
  const blocks = [];
  let nearestHeading = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line.value);
    if (heading) {
      nearestHeading = normalizeBlockLabel(heading[2]);
      continue;
    }

    const opening = /^```json(?:\s+(.+?))?\s*$/.exec(line.value);
    if (!opening) continue;

    let closeIndex = index + 1;
    while (closeIndex < lines.length && !/^```\s*$/.test(lines[closeIndex].value)) {
      closeIndex += 1;
    }
    if (closeIndex >= lines.length) {
      fail('PLAN_MARKDOWN_INVALID', 'JSON code fence is not closed', {
        label: requestedLabel,
        line: index + 1,
      });
    }

    const explicitLabel = opening[1] ? normalizeBlockLabel(opening[1]) : null;
    const blockLabel = explicitLabel ?? nearestHeading;
    if (blockLabel === expected) {
      blocks.push({
        label: requestedLabel,
        openLine: index + 1,
        closeLine: closeIndex + 1,
        contentStart: line.offset + line.raw.length,
        contentEnd: lines[closeIndex].offset,
        text: text.slice(line.offset + line.raw.length, lines[closeIndex].offset),
      });
    }
    index = closeIndex;
  }

  return blocks;
}

function parseStructuredBlock(text, label, sourcePath) {
  const blocks = findStructuredBlocks(text, label);
  if (blocks.length === 0) {
    fail('PLAN_BLOCK_MISSING', `${label} JSON block is missing`, {
      path: sourcePath,
    });
  }
  if (blocks.length !== 1) {
    fail('PLAN_BLOCK_DUPLICATE', `${label} JSON block must appear exactly once`, {
      path: sourcePath,
      count: blocks.length,
    });
  }
  try {
    return { value: JSON.parse(blocks[0].text), block: blocks[0] };
  } catch (error) {
    fail('PLAN_JSON_INVALID', `${label} JSON is invalid`, {
      path: sourcePath,
      message: error.message,
    });
  }
}

function assertNoForbiddenSections(text, sourcePath) {
  for (const [index, line] of markdownLines(text).entries()) {
    const heading = /^#{1,6}\s+(.+?)\s*$/.exec(line.value);
    if (heading && FORBIDDEN_SECTION_PATTERN.test(heading[1].trim())) {
      fail('PLAN_FORBIDDEN_SECTION', 'plan package contains a forbidden history section', {
        path: sourcePath,
        line: index + 1,
        heading: heading[1].trim(),
      });
    }
  }
}

function assertCurrentSnapshot(text, sourcePath) {
  const lines = markdownLines(text);
  const indexes = [];
  for (const [index, line] of lines.entries()) {
    if (/^#{1,6}\s+current snapshot\s*$/i.test(line.value)) {
      indexes.push(index);
    }
  }
  if (indexes.length !== 1) {
    fail('PLAN_SNAPSHOT_INVALID', 'Task Slice must contain exactly one Current Snapshot section', {
      path: sourcePath,
      count: indexes.length,
    });
  }
  const start = indexes[0];
  const headingLevel = /^(#{1,6})/.exec(lines[start].value)[1].length;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const heading = /^(#{1,6})\s+/.exec(lines[index].value);
    if (heading && heading[1].length <= headingLevel) {
      end = index;
      break;
    }
  }
  const count = end - start;
  if (count > SNAPSHOT_MAX_LINES) {
    fail('PLAN_SNAPSHOT_INVALID', 'Current Snapshot exceeds 30 lines', {
      path: sourcePath,
      lines: count,
      maxLines: SNAPSHOT_MAX_LINES,
    });
  }
}

function metadataKey(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function stripMetadataValue(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('`') && trimmed.endsWith('`') && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseMetadata(text, sourcePath) {
  const metadata = new Map();
  const pattern = /^>\s*\*\*([^*]+)\*\*:\s*(.*?)\s*$/gm;
  for (const match of text.matchAll(pattern)) {
    const key = metadataKey(match[1]);
    if (metadata.has(key)) {
      fail('PLAN_METADATA_MISMATCH', 'Markdown metadata key is duplicated', {
        path: sourcePath,
        key: match[1],
      });
    }
    metadata.set(key, stripMetadataValue(match[2]));
  }
  return metadata;
}

function assertMetadata(manifest, metadata, sourcePath) {
  if (metadata.has('worktreesetdigest')) {
    fail(
      'PLAN_METADATA_MISMATCH',
      'Obsolete Worktree-set Digest metadata must be removed',
      { path: sourcePath, key: 'Worktree-set Digest' },
    );
  }
  if (metadata.has('expectedhead')) {
    fail(
      'PLAN_METADATA_MISMATCH',
      'Obsolete Expected HEAD metadata must be removed',
      { path: sourcePath, key: 'Expected HEAD' },
    );
  }
  const expected = {
    status: manifest.status,
    branch: manifest.binding.branch,
    workspaceid: manifest.binding.workspaceId,
    initialhead: manifest.binding.initialHead,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (!metadata.has(key) || metadata.get(key) !== value) {
      fail('PLAN_METADATA_MISMATCH', 'Markdown metadata does not equal the Plan Package', {
        path: sourcePath,
        key,
        expected: value,
        actual: metadata.get(key) ?? null,
      });
    }
  }
}

export function validateRepositoryPath(value, context = 'repository path') {
  assertString(value, context);
  if (
    value.includes('\0') ||
    value.includes('\\') ||
    path.posix.isAbsolute(value) ||
    value !== path.posix.normalize(value)
  ) {
    fail('PLAN_PATH_INVALID', `${context} must be a canonical repository-relative POSIX path`, {
      path: value,
    });
  }
  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    fail('PLAN_PATH_INVALID', `${context} contains an invalid path segment`, {
      path: value,
    });
  }
  return value;
}

function isNativePathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function pathExists(candidate) {
  try {
    await fsp.lstat(candidate);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw error;
  }
}

export async function assertRepositoryPathContained(
  repoRoot,
  relativePath,
  context = 'repository path',
) {
  validateRepositoryPath(relativePath, context);
  const candidate = path.resolve(repoRoot, ...relativePath.split('/'));
  if (!isNativePathInside(repoRoot, candidate)) {
    fail('PLAN_PATH_ESCAPE', `${context} escapes the repository root`, {
      path: relativePath,
    });
  }

  let existing = candidate;
  while (!(await pathExists(existing))) {
    const parent = path.dirname(existing);
    if (parent === existing) {
      fail('PLAN_PATH_ESCAPE', `${context} has no containing repository parent`, {
        path: relativePath,
      });
    }
    existing = parent;
  }
  const realExisting = await fsp.realpath(existing);
  if (!isNativePathInside(repoRoot, realExisting)) {
    fail('PLAN_PATH_ESCAPE', `${context} resolves through a symlink outside the repository`, {
      path: relativePath,
      resolvedParent: realExisting,
    });
  }
}

function segmentContains(prefix, candidate) {
  return candidate === prefix || candidate.startsWith(`${prefix}/`);
}

function validateSourceClaim(value, context) {
  assertClosedObject(value, ['pathPrefix', 'mode'], context);
  validateRepositoryPath(value.pathPrefix, `${context}.pathPrefix`);
  assertEnum(value.mode, new Set(['shared-read', 'exclusive-write']), `${context}.mode`);
}

function validateAuthorization(value, context) {
  assertClosedObject(value, ['checkpoint', 'delivery', 'runtime', 'history'], context);
  assertClosedObject(value.checkpoint, ['localCommit', 'amend'], `${context}.checkpoint`);
  assertEnum(
    value.checkpoint.localCommit,
    new Set(['allowed', 'denied']),
    `${context}.checkpoint.localCommit`,
  );
  assertEnum(
    value.checkpoint.amend,
    new Set(['allowed', 'denied']),
    `${context}.checkpoint.amend`,
  );
  assertClosedObject(value.delivery, ['push', 'pullRequest'], `${context}.delivery`);
  assertEnum(value.delivery.push, new Set(['allowed', 'denied']), `${context}.delivery.push`);
  assertEnum(
    value.delivery.pullRequest,
    new Set(['allowed', 'denied']),
    `${context}.delivery.pullRequest`,
  );
  assertClosedObject(
    value.runtime,
    ['deployProfiles', 'destructiveResetScopes'],
    `${context}.runtime`,
  );
  assertUniqueStrings(value.runtime.deployProfiles, `${context}.runtime.deployProfiles`);
  assertUniqueStrings(
    value.runtime.destructiveResetScopes,
    `${context}.runtime.destructiveResetScopes`,
  );
  assertClosedObject(value.history, ['rewrite'], `${context}.history`);
  assertEnum(value.history.rewrite, new Set(['allowed', 'denied']), `${context}.history.rewrite`);
}

function validateBlocker(value, context) {
  assertClosedObject(value, ['code', 'owner', 'evidenceRef'], context);
  assertString(value.code, `${context}.code`);
  assertString(value.owner, `${context}.owner`);
  assertString(value.evidenceRef, `${context}.evidenceRef`);
}

function validateExhaustion(value, context) {
  assertClosedObject(
    value,
    ['recordedAt', 'blockedTaskIds', 'decisionRefs', 'evidenceRefs'],
    context,
  );
  assertString(value.recordedAt, `${context}.recordedAt`);
  if (Number.isNaN(Date.parse(value.recordedAt))) {
    fail('PLAN_SCHEMA_INVALID', `${context}.recordedAt must be an ISO-compatible timestamp`);
  }
  assertUniqueStrings(value.blockedTaskIds, `${context}.blockedTaskIds`, {
    min: 1,
    pattern: ID_PATTERN,
  });
  assertUniqueStrings(value.decisionRefs, `${context}.decisionRefs`, { min: 1 });
  assertUniqueStrings(value.evidenceRefs, `${context}.evidenceRefs`, { min: 1 });
}

function validateManifestSchema(manifest) {
  assertClosedObject(
    manifest,
    [
      'kind',
      'planId',
      'status',
      'binding',
      'workClass',
      'architecture',
      'scope',
      'tasks',
      'exhaustion',
      'authorization',
    ],
    'Plan Package',
  );
  if (manifest.kind !== 'peers-touch-plan-package') {
    fail('PLAN_SCHEMA_INVALID', 'Plan Package kind is unsupported');
  }
  assertString(manifest.planId, 'Plan Package.planId', { pattern: ID_PATTERN });
  assertEnum(manifest.status, PLAN_STATUSES, 'Plan Package.status');
  assertClosedObject(
    manifest.binding,
    ['branch', 'workspaceId', 'initialHead'],
    'Plan Package.binding',
  );
  assertString(manifest.binding.branch, 'Plan Package.binding.branch');
  assertString(manifest.binding.workspaceId, 'Plan Package.binding.workspaceId');
  assertString(manifest.binding.initialHead, 'Plan Package.binding.initialHead', {
    pattern: SHA1_PATTERN,
  });
  assertEnum(manifest.workClass, WORK_CLASSES, 'Plan Package.workClass');

  assertClosedObject(manifest.architecture, ['sources', 'decisions'], 'Plan Package.architecture');
  assertUniqueStrings(manifest.architecture.sources, 'Plan Package.architecture.sources', {
    min: 1,
  });
  manifest.architecture.sources.forEach((source, index) =>
    validateRepositoryPath(source, `Plan Package.architecture.sources[${index}]`),
  );
  assertUniqueStrings(manifest.architecture.decisions, 'Plan Package.architecture.decisions');

  assertClosedObject(manifest.scope, ['sourceClaims', 'nonGoals'], 'Plan Package.scope');
  assertArray(manifest.scope.sourceClaims, 'Plan Package.scope.sourceClaims', { min: 1 });
  const claimPaths = new Set();
  manifest.scope.sourceClaims.forEach((claim, index) => {
    validateSourceClaim(claim, `Plan Package.scope.sourceClaims[${index}]`);
    if (claimPaths.has(claim.pathPrefix)) {
      fail('PLAN_DUPLICATE', 'Plan Package source claim path is duplicated', {
        path: claim.pathPrefix,
      });
    }
    claimPaths.add(claim.pathPrefix);
  });
  assertUniqueStrings(manifest.scope.nonGoals, 'Plan Package.scope.nonGoals');

  assertArray(manifest.tasks, 'Plan Package.tasks', { min: 1 });
  const taskIds = new Set();
  const taskPaths = new Set();
  for (const [index, task] of manifest.tasks.entries()) {
    const context = `Plan Package.tasks[${index}]`;
    assertClosedObject(
      task,
      ['id', 'workstreamId', 'path', 'dependsOn', 'status', 'blocker'],
      context,
    );
    assertString(task.id, `${context}.id`, { pattern: ID_PATTERN });
    assertString(task.workstreamId, `${context}.workstreamId`, { pattern: ID_PATTERN });
    validateRepositoryPath(task.path, `${context}.path`);
    if (task.path !== `tasks/${task.id}.md`) {
      fail('PLAN_PATH_INVALID', 'Task path must equal tasks/<task-id>.md', {
        taskId: task.id,
        path: task.path,
      });
    }
    assertUniqueStrings(task.dependsOn, `${context}.dependsOn`, { pattern: ID_PATTERN });
    assertEnum(task.status, TASK_STATUSES, `${context}.status`);
    if (task.status === 'blocked') {
      validateBlocker(task.blocker, `${context}.blocker`);
    } else if (task.blocker !== null) {
      fail('PLAN_STATE_INVALID', 'Only a blocked Task may have blocker metadata', {
        taskId: task.id,
        status: task.status,
      });
    }
    if (taskIds.has(task.id)) {
      fail('PLAN_DUPLICATE', 'Task ID is duplicated', { taskId: task.id });
    }
    if (taskPaths.has(task.path)) {
      fail('PLAN_DUPLICATE', 'Task path is duplicated', { path: task.path });
    }
    taskIds.add(task.id);
    taskPaths.add(task.path);
  }

  if (manifest.exhaustion === null) {
    // Validated by lifecycle rules below.
  } else {
    validateExhaustion(manifest.exhaustion, 'Plan Package.exhaustion');
  }
  validateAuthorization(manifest.authorization, 'Plan Package.authorization');
}

function validateDagAndLifecycle(manifest) {
  const byId = new Map(manifest.tasks.map((task) => [task.id, task]));
  for (const task of manifest.tasks) {
    for (const dependency of task.dependsOn) {
      if (!byId.has(dependency)) {
        fail('PLAN_DAG_INVALID', 'Task dependency does not exist', {
          taskId: task.id,
          dependency,
        });
      }
      if (dependency === task.id) {
        fail('PLAN_DAG_INVALID', 'Task cannot depend on itself', { taskId: task.id });
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(taskId, trail) {
    if (visiting.has(taskId)) {
      fail('PLAN_DAG_INVALID', 'Task dependency graph contains a cycle', {
        cycle: [...trail, taskId],
      });
    }
    if (visited.has(taskId)) return;
    visiting.add(taskId);
    const task = byId.get(taskId);
    for (const dependency of task.dependsOn) {
      visit(dependency, [...trail, taskId]);
    }
    visiting.delete(taskId);
    visited.add(taskId);
  }
  for (const task of manifest.tasks) visit(task.id, []);

  const dependenciesDone = (task) =>
    task.dependsOn.every((dependency) => byId.get(dependency).status === 'done');
  for (const task of manifest.tasks) {
    if (['in_progress', 'blocked', 'done'].includes(task.status) && !dependenciesDone(task)) {
      fail('PLAN_STATE_INVALID', 'Started or terminal Task has an incomplete dependency', {
        taskId: task.id,
        dependsOn: task.dependsOn,
      });
    }
  }

  const current = manifest.tasks.filter((task) => task.status === 'in_progress');
  const blocked = manifest.tasks.filter((task) => task.status === 'blocked');
  const ready = manifest.tasks.filter(
    (task) => task.status === 'pending' && dependenciesDone(task),
  );

  if (manifest.status === 'active') {
    if (current.length !== 1 || manifest.exhaustion !== null) {
      fail('PLAN_STATE_INVALID', 'Active package must have one current Task and no exhaustion', {
        currentTaskIds: current.map((task) => task.id),
      });
    }
  } else if (manifest.status === 'blocked') {
    if (
      current.length !== 0 ||
      blocked.length === 0 ||
      ready.length !== 0 ||
      manifest.exhaustion === null
    ) {
      fail(
        'PLAN_STATE_INVALID',
        'Blocked package must have blocked Tasks, no current/ready Task, and exhaustion',
        {
          currentTaskIds: current.map((task) => task.id),
          blockedTaskIds: blocked.map((task) => task.id),
          readyTaskIds: ready.map((task) => task.id),
        },
      );
    }
    const actual = [...manifest.exhaustion.blockedTaskIds].sort();
    const expected = blocked.map((task) => task.id).sort();
    if (
      actual.length !== expected.length ||
      actual.some((taskId, index) => taskId !== expected[index])
    ) {
      fail('PLAN_STATE_INVALID', 'Exhaustion blockedTaskIds must equal blocked Task status', {
        expected,
        actual,
      });
    }
  } else if (manifest.status === 'completed') {
    if (
      current.length !== 0 ||
      manifest.exhaustion !== null ||
      manifest.tasks.some((task) => task.status !== 'done')
    ) {
      fail('PLAN_STATE_INVALID', 'Completed package requires every Task to be done');
    }
  } else if (
    ['draft', 'prepared', 'superseded'].includes(manifest.status) &&
    (current.length !== 0 || manifest.exhaustion !== null)
  ) {
    fail(
      'PLAN_STATE_INVALID',
      `${manifest.status} package must have no current Task or exhaustion`,
    );
  }

  return { byId, current, ready, blocked };
}

function validateTaskSliceSchema(task) {
  assertClosedObject(
    task,
    [
      'kind',
      'planId',
      'taskId',
      'workstreamId',
      'title',
      'workClass',
      'completionClass',
      'executionMode',
      'closureId',
      'journeyId',
      'runtimeClass',
      'writeSet',
      'readSet',
      'budgets',
      'checks',
      'doneWhen',
      'failureBehavior',
      'updatedAt',
      'durableEvidence',
    ],
    'Task Slice',
  );
  if (task.kind !== 'peers-touch-task-slice') {
    fail('PLAN_SCHEMA_INVALID', 'Task Slice kind is unsupported');
  }
  assertString(task.planId, 'Task Slice.planId', { pattern: ID_PATTERN });
  assertString(task.taskId, 'Task Slice.taskId', { pattern: ID_PATTERN });
  assertString(task.workstreamId, 'Task Slice.workstreamId', { pattern: ID_PATTERN });
  assertString(task.title, 'Task Slice.title');
  assertEnum(task.workClass, WORK_CLASSES, 'Task Slice.workClass');
  assertEnum(
    task.completionClass,
    COMPLETION_CLASSES,
    'Task Slice.completionClass',
  );
  assertEnum(task.executionMode, new Set(['build', 'fix']), 'Task Slice.executionMode');
  assertString(task.closureId, 'Task Slice.closureId', { pattern: ID_PATTERN });
  assertString(task.journeyId, 'Task Slice.journeyId');
  assertEnum(task.runtimeClass, RUNTIME_CLASSES, 'Task Slice.runtimeClass');
  if (task.completionClass === 'source' && task.runtimeClass !== 'source-only') {
    fail(
      'PLAN_TASK_RUNTIME_INVALID',
      'source completion requires source-only runtime',
      { taskId: task.taskId, runtimeClass: task.runtimeClass },
    );
  }
  if (
    task.completionClass === 'acceptance-aggregate' &&
    task.runtimeClass !== 'source-only'
  ) {
    fail(
      'PLAN_TASK_RUNTIME_INVALID',
      'acceptance aggregate requires source-only orchestration runtime',
      { taskId: task.taskId, runtimeClass: task.runtimeClass },
    );
  }
  if (
    task.completionClass === 'functional' &&
    task.runtimeClass === 'source-only' &&
    !['infrastructure', 'refactor'].includes(task.workClass)
  ) {
    fail(
      'PLAN_TASK_RUNTIME_INVALID',
      'functional source-only runtime is incompatible with the Task work class',
      {
        taskId: task.taskId,
        workClass: task.workClass,
        completionClass: task.completionClass,
      },
    );
  }
  assertUniqueStrings(task.writeSet, 'Task Slice.writeSet', { min: 1 });
  assertUniqueStrings(task.readSet, 'Task Slice.readSet');
  task.writeSet.forEach((value, index) =>
    validateRepositoryPath(value, `Task Slice.writeSet[${index}]`),
  );
  task.readSet.forEach((value, index) =>
    validateRepositoryPath(value, `Task Slice.readSet[${index}]`),
  );

  assertClosedObject(
    task.budgets,
    ['focusedCheckSeconds', 'functionalRunSeconds', 'cleanupSeconds'],
    'Task Slice.budgets',
  );
  assertInteger(task.budgets.focusedCheckSeconds, 'Task Slice.budgets.focusedCheckSeconds', {
    min: 1,
  });
  assertInteger(
    task.budgets.functionalRunSeconds,
    'Task Slice.budgets.functionalRunSeconds',
    { min: 1 },
  );
  assertInteger(task.budgets.cleanupSeconds, 'Task Slice.budgets.cleanupSeconds', { min: 1 });

  assertArray(task.checks, 'Task Slice.checks', { min: 1 });
  const checkIds = new Set();
  const checkClasses = new Set();
  for (const [index, check] of task.checks.entries()) {
    const context = `Task Slice.checks[${index}]`;
    assertClosedObject(check, ['id', 'command', 'verificationClass'], context);
    assertString(check.id, `${context}.id`, { pattern: ID_PATTERN });
    assertString(check.command, `${context}.command`);
    assertEnum(check.verificationClass, VERIFICATION_CLASSES, `${context}.verificationClass`);
    if (checkIds.has(check.id)) {
      fail('PLAN_DUPLICATE', 'Task check ID is duplicated', { checkId: check.id });
    }
    checkIds.add(check.id);
    checkClasses.add(check.verificationClass);
  }
  if (![...checkClasses].some((value) => FOCUSED_VERIFICATION_CLASSES.has(value))) {
    fail(
      'PLAN_TASK_CHECK_INVALID',
      'Task Slice must declare a focused source, structural, or UX check',
      { taskId: task.taskId },
    );
  }
  if (
    task.completionClass === 'source' &&
    (checkClasses.has('FUNCTIONAL_CHECK') ||
      checkClasses.has('ACCEPTANCE_PROOF'))
  ) {
    fail(
      'PLAN_TASK_CHECK_INVALID',
      'Source Task Slice cannot declare functional or Acceptance proof checks',
      { taskId: task.taskId },
    );
  }
  if (
    task.completionClass === 'functional' &&
    !checkClasses.has('FUNCTIONAL_CHECK')
  ) {
    fail(
      'PLAN_TASK_CHECK_INVALID',
      'Functional Task Slice must declare a functional check',
      { taskId: task.taskId },
    );
  }
  if (
    task.completionClass === 'acceptance-aggregate' &&
    (checkClasses.has('FUNCTIONAL_CHECK') ||
      !checkClasses.has('ACCEPTANCE_PROOF'))
  ) {
    fail(
      'PLAN_TASK_CHECK_INVALID',
      'Acceptance aggregate must declare proof checks without a functional check',
      { taskId: task.taskId },
    );
  }
  assertUniqueStrings(task.doneWhen, 'Task Slice.doneWhen', { min: 1 });
  assertUniqueStrings(task.failureBehavior, 'Task Slice.failureBehavior', { min: 1 });
  assertString(task.updatedAt, 'Task Slice.updatedAt');
  if (Number.isNaN(Date.parse(task.updatedAt))) {
    fail('PLAN_SCHEMA_INVALID', 'Task Slice.updatedAt must be an ISO-compatible timestamp');
  }
  assertArray(task.durableEvidence, 'Task Slice.durableEvidence');
  const evidenceClasses = new Set();
  for (const [index, evidence] of task.durableEvidence.entries()) {
    const context = `Task Slice.durableEvidence[${index}]`;
    assertClosedObject(evidence, ['verificationClass', 'result', 'ref'], context);
    assertEnum(
      evidence.verificationClass,
      VERIFICATION_CLASSES,
      `${context}.verificationClass`,
    );
    assertEnum(evidence.result, VERIFICATION_RESULTS, `${context}.result`);
    assertString(evidence.ref, `${context}.ref`);
    evidenceClasses.add(evidence.verificationClass);
  }
  if (
    task.completionClass === 'source' &&
    (evidenceClasses.has('FUNCTIONAL_CHECK') ||
      evidenceClasses.has('ACCEPTANCE_PROOF'))
  ) {
    fail(
      'PLAN_TASK_EVIDENCE_INVALID',
      'Source Task cannot own functional or Acceptance proof evidence',
      { taskId: task.taskId },
    );
  }
  if (
    task.completionClass === 'acceptance-aggregate' &&
    evidenceClasses.has('FUNCTIONAL_CHECK')
  ) {
    fail(
      'PLAN_TASK_EVIDENCE_INVALID',
      'Acceptance aggregate cannot own functional evidence',
      { taskId: task.taskId },
    );
  }
}

function validateAcceptanceSchema(acceptance) {
  assertClosedObject(
    acceptance,
    ['closures', 'completion', 'full'],
    'Acceptance Execution',
  );
  if (!isPlainObject(acceptance.closures)) {
    fail('PLAN_SCHEMA_INVALID', 'Acceptance Execution.closures must be an object');
  }
  for (const [closureId, gateIds] of Object.entries(acceptance.closures)) {
    assertString(closureId, 'Acceptance Execution closure ID', { pattern: ID_PATTERN });
    assertUniqueStrings(gateIds, `Acceptance Execution.closures.${closureId}`);
  }
  assertUniqueStrings(acceptance.completion, 'Acceptance Execution.completion');
  assertUniqueStrings(acceptance.full, 'Acceptance Execution.full');
}

function assertAcceptanceCrosswalk(manifest, taskSlices, acceptance) {
  const taskClosures = new Map();
  for (const task of taskSlices.values()) {
    if (taskClosures.has(task.closureId)) {
      fail('PLAN_ACCEPTANCE_MISMATCH', 'Task closureId is duplicated', {
        closureId: task.closureId,
        taskIds: [taskClosures.get(task.closureId), task.taskId],
      });
    }
    taskClosures.set(task.closureId, task.taskId);
  }
  const declaredClosures = Object.keys(acceptance.closures);
  const expectedClosures = [...taskClosures.keys()];
  const missing = expectedClosures.filter((closureId) => !declaredClosures.includes(closureId));
  const extra = declaredClosures.filter((closureId) => !taskClosures.has(closureId));
  if (missing.length > 0 || extra.length > 0) {
    fail('PLAN_ACCEPTANCE_MISMATCH', 'Task and Acceptance closure crosswalk is incomplete', {
      missing,
      extra,
    });
  }

  const completion = new Set(acceptance.completion);
  const full = new Set(acceptance.full);
  const closureGates = new Set(Object.values(acceptance.closures).flat());
  const missingFromCompletion = [...closureGates].filter((gateId) => !completion.has(gateId));
  const missingFromFull = acceptance.completion.filter((gateId) => !full.has(gateId));
  if (missingFromCompletion.length > 0 || missingFromFull.length > 0) {
    fail(
      'PLAN_ACCEPTANCE_MISMATCH',
      'Closure Gates must be in completion and completion Gates must be in full',
      { missingFromCompletion, missingFromFull },
    );
  }

  for (const task of taskSlices.values()) {
    const gates = acceptance.closures[task.closureId];
    const checkClasses = new Set(
      task.checks.map((check) => check.verificationClass),
    );
    if (task.completionClass === 'source' && gates.length > 0) {
      fail('PLAN_ACCEPTANCE_MISMATCH', 'Source Task must own an empty Gate closure', {
        taskId: task.taskId,
        gateIds: gates,
      });
    }
    if (
      task.completionClass === 'functional' &&
      gates.length > 0 &&
      !checkClasses.has('ACCEPTANCE_PROOF')
    ) {
      fail(
        'PLAN_ACCEPTANCE_MISMATCH',
        'Functional Task with formal Gates must declare an Acceptance proof check',
        { taskId: task.taskId, gateIds: gates },
      );
    }
    if (
      task.completionClass === 'functional' &&
      gates.length === 0 &&
      checkClasses.has('ACCEPTANCE_PROOF')
    ) {
      fail(
        'PLAN_ACCEPTANCE_MISMATCH',
        'Functional Task without formal Gates cannot declare an Acceptance proof check',
        { taskId: task.taskId },
      );
    }
    if (
      task.completionClass === 'acceptance-aggregate' &&
      gates.length === 0
    ) {
      fail(
        'PLAN_ACCEPTANCE_MISMATCH',
        'Acceptance aggregate must own a non-empty Gate closure',
        { taskId: task.taskId },
      );
    }
  }

  for (const task of taskSlices.values()) {
    if (
      task.completionClass !== 'source' ||
      task.workClass === 'documentation'
    ) {
      continue;
    }
    const successors = manifest.tasks.filter((candidate) => {
      if (!candidate.dependsOn.includes(task.taskId)) return false;
      const successor = taskSlices.get(candidate.id);
      return (
        successor.workstreamId === task.workstreamId &&
        successor.completionClass === 'functional'
      );
    });
    if (successors.length !== 1) {
      fail(
        'PLAN_TASK_SUCCESSOR_INVALID',
        'Source Task requires exactly one direct same-workstream functional successor',
        {
          taskId: task.taskId,
          successorTaskIds: successors.map((candidate) => candidate.id),
        },
      );
    }
  }

  for (const manifestTask of manifest.tasks) {
    if (!taskSlices.has(manifestTask.id)) {
      fail('PLAN_TASK_MISMATCH', 'Manifest Task has no Task Slice', {
        taskId: manifestTask.id,
      });
    }
  }
}

function claimsCoverPath(claims, targetPath, requiredMode) {
  return claims.some(
    (claim) =>
      segmentContains(claim.pathPrefix, targetPath) &&
      (requiredMode !== 'exclusive-write' || claim.mode === 'exclusive-write'),
  );
}

function validateTaskScope(task, manifest, declarationClaims) {
  for (const targetPath of task.writeSet) {
    if (!claimsCoverPath(manifest.scope.sourceClaims, targetPath, 'exclusive-write')) {
      fail('PLAN_SCOPE_MISMATCH', 'Task writeSet escapes Plan exclusive-write scope', {
        taskId: task.taskId,
        path: targetPath,
      });
    }
    if (
      declarationClaims &&
      !claimsCoverPath(declarationClaims, targetPath, 'exclusive-write')
    ) {
      fail('PLAN_SCOPE_MISMATCH', 'Task writeSet escapes declaration exclusive-write scope', {
        taskId: task.taskId,
        path: targetPath,
      });
    }
  }
  for (const targetPath of task.readSet) {
    if (!claimsCoverPath(manifest.scope.sourceClaims, targetPath, 'shared-read')) {
      fail('PLAN_SCOPE_MISMATCH', 'Task readSet escapes Plan source scope', {
        taskId: task.taskId,
        path: targetPath,
      });
    }
    if (declarationClaims && !claimsCoverPath(declarationClaims, targetPath, 'shared-read')) {
      fail('PLAN_SCOPE_MISMATCH', 'Task readSet escapes declaration source scope', {
        taskId: task.taskId,
        path: targetPath,
      });
    }
  }
}

async function validateDeclarationClaims(value, manifest, repoRoot) {
  if (value === undefined) return null;
  assertArray(value, 'declarationClaims', { min: 1 });
  const paths = new Set();
  for (const [index, claim] of value.entries()) {
    validateSourceClaim(claim, `declarationClaims[${index}]`);
    if (paths.has(claim.pathPrefix)) {
      fail('PLAN_DUPLICATE', 'Declaration source claim path is duplicated', {
        path: claim.pathPrefix,
      });
    }
    paths.add(claim.pathPrefix);
    await assertRepositoryPathContained(
      repoRoot,
      claim.pathPrefix,
      `declarationClaims[${index}].pathPrefix`,
    );
    const compatible = manifest.scope.sourceClaims.some(
      (planClaim) =>
        segmentContains(planClaim.pathPrefix, claim.pathPrefix) &&
        (claim.mode !== 'exclusive-write' || planClaim.mode === 'exclusive-write'),
    );
    if (!compatible) {
      fail('PLAN_SCOPE_MISMATCH', 'Declaration adds a source claim outside Plan scope', {
        claim,
      });
    }
  }
  return value;
}

async function findRepoRoot(startPath) {
  let candidate = path.resolve(startPath);
  while (true) {
    if (await pathExists(path.join(candidate, '.git'))) {
      return fsp.realpath(candidate);
    }
    const parent = path.dirname(candidate);
    if (parent === candidate) {
      fail('PLAN_REPO_ROOT_UNAVAILABLE', 'Could not infer repository root');
    }
    candidate = parent;
  }
}

async function resolveRepoRoot(planPath, explicitRoot) {
  let root;
  if (explicitRoot !== undefined) {
    assertString(explicitRoot, 'options.repoRoot');
    root = await fsp.realpath(path.resolve(explicitRoot));
  } else {
    root = await findRepoRoot(path.dirname(planPath));
  }
  const realPlan = await fsp.realpath(planPath);
  if (!isNativePathInside(root, realPlan)) {
    fail('PLAN_PATH_ESCAPE', 'Plan Package resolves outside the repository root', {
      planPath,
      repoRoot: root,
      resolvedPlanPath: realPlan,
    });
  }
  return { repoRoot: root, realPlan };
}

function migrationReadContexts(options, identity) {
  const hasJournal = options.migrationJournalPath !== undefined;
  const hasLock = options.migrationLockPath !== undefined;
  if (hasJournal !== hasLock) {
    fail(
      'PLAN_MIGRATION_CONTEXT_REQUIRED',
      'Migration journal and lock paths must be supplied together',
    );
  }

  const contexts = [];
  if (hasJournal) {
    contexts.push({
      journalPath: path.resolve(options.migrationJournalPath),
      lockPath: path.resolve(options.migrationLockPath),
    });
  }

  if (identity?.repoRoot) {
    const workspaceIds = new Set([
      identity.workspaceId,
      workspaceIdForRoot(identity.repoRoot),
    ]);
    const root = path.resolve(machineDevRoot());
    for (const workspaceId of workspaceIds) {
      if (workspaceId === undefined) continue;
      if (!ID_PATTERN.test(workspaceId)) {
        fail('PLAN_MIGRATION_CONTEXT_REQUIRED', 'Migration workspace ID is invalid', {
          workspaceId,
        });
      }
      const directory = path.join(
        root,
        'workspaces',
        workspaceId,
        'workflow',
        'plan-migration',
      );
      contexts.push({
        journalPath: path.join(directory, 'migration.json'),
        lockPath: path.join(directory, 'migration.lock'),
      });
    }
  }

  const deduplicated = new Map();
  for (const context of contexts) {
    deduplicated.set(`${context.journalPath}\0${context.lockPath}`, context);
  }
  if (deduplicated.size === 0) {
    fail(
      'PLAN_MIGRATION_CONTEXT_REQUIRED',
      'Plan discovery requires repository identity or explicit migration paths',
    );
  }
  return [...deduplicated.values()];
}

async function readOptionalFile(candidate) {
  try {
    return await fsp.readFile(candidate);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}

function digestOptionalFile(value) {
  return value === null
    ? null
    : crypto.createHash('sha256').update(value).digest('hex');
}

function parseMigrationMetadata(bytes, candidate, context) {
  if (bytes === null) return null;
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    fail('PLAN_MIGRATION_JOURNAL_INVALID', `${context} is not valid JSON`, {
      path: candidate,
    });
  }
}

function migrationLockOwnedBy(lock, lockPath, ownerToken) {
  if (lock === null) return false;
  if (
    !isPlainObject(lock) ||
    typeof lock.ownerToken !== 'string' ||
    !SHA256_PATTERN.test(lock.ownerToken)
  ) {
    fail('PLAN_MIGRATION_LOCK_INVALID', 'Migration lock metadata is invalid', {
      lockPath,
    });
  }
  return ownerToken !== undefined && lock.ownerToken === ownerToken;
}

export async function assertPlanDiscoveryReadable(options = {}, identity = undefined) {
  const fence = [];
  for (const context of migrationReadContexts(options, identity)) {
    const lockBefore = await readOptionalFile(context.lockPath);
    const journalBytes = await readOptionalFile(context.journalPath);
    const lockAfter = await readOptionalFile(context.lockPath);
    if (
      digestOptionalFile(lockBefore) !== digestOptionalFile(lockAfter)
    ) {
      fail(
        'PLAN_MIGRATION_IN_PROGRESS',
        'Plan migration lock changed during discovery fencing',
        { lockPath: context.lockPath },
      );
    }
    const lock = parseMigrationMetadata(
      lockAfter,
      context.lockPath,
      'migration lock',
    );
    const owned = migrationLockOwnedBy(
      lock,
      context.lockPath,
      options.migrationOwnerToken,
    );
    if (lock !== null && !owned) {
      fail('PLAN_MIGRATION_IN_PROGRESS', 'Plan migration lock is active', {
        lockPath: context.lockPath,
      });
    }
    if (journalBytes !== null) {
      const journal = parseMigrationMetadata(
        journalBytes,
        context.journalPath,
        'migration journal',
      );
      if (!isPlainObject(journal) || !MIGRATION_PHASES.has(journal.phase)) {
        fail(
          'PLAN_MIGRATION_JOURNAL_INVALID',
          'Migration journal phase is invalid',
          {
            journalPath: context.journalPath,
            phase: isPlainObject(journal) ? journal.phase : undefined,
          },
        );
      }
      if (LOCKED_MIGRATION_PHASES.has(journal.phase) && !owned) {
        fail('PLAN_MIGRATION_IN_PROGRESS', 'Plan migration journal is in a locked phase', {
          journalPath: context.journalPath,
          phase: journal.phase,
        });
      }
    }
    fence.push({
      journalPath: context.journalPath,
      lockPath: context.lockPath,
      journalDigest: digestOptionalFile(journalBytes),
      lockDigest: digestOptionalFile(lockAfter),
    });
  }
  return fence;
}

export async function assertPlanDiscoveryFenceUnchanged(
  initialFence,
  options,
  identity,
) {
  const finalFence = await assertPlanDiscoveryReadable(options, identity);
  if (JSON.stringify(finalFence) !== JSON.stringify(initialFence)) {
    fail(
      'PLAN_MIGRATION_IN_PROGRESS',
      'Plan migration state changed during package discovery',
      { initialFence, finalFence },
    );
  }
}

async function taskMarkdownFiles(tasksDirectory) {
  let entries;
  try {
    entries = await fsp.readdir(tasksDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      fail('PLAN_TASK_MISMATCH', 'Plan Package tasks directory does not exist', {
        path: tasksDirectory,
      });
    }
    throw error;
  }
  return entries
    .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort();
}

/**
 * Loads and validates one Plan Package.
 *
 * taskSlices is always a Map<string, TaskSlice>. currentTask and readyTasks
 * contain the same TaskSlice values, while lifecycle status remains owned by
 * manifest.tasks.
 */
export async function loadPlanPackage(planPath, options = {}) {
  assertString(planPath, 'planPath');
  const absolutePlan = path.resolve(planPath);
  const { repoRoot, realPlan } = await resolveRepoRoot(absolutePlan, options.repoRoot);
  const migrationFence = await assertPlanDiscoveryReadable(options, { repoRoot });
  const markdown = await fsp.readFile(realPlan, 'utf8');
  assertBounds(markdown, 'manifest', realPlan);
  assertNoForbiddenSections(markdown, realPlan);

  const { value: manifest } = parseStructuredBlock(markdown, 'Plan Package', realPlan);
  const { value: acceptance } = parseStructuredBlock(
    markdown,
    'Acceptance Execution',
    realPlan,
  );
  validateManifestSchema(manifest);
  validateAcceptanceSchema(acceptance);
  assertMetadata(manifest, parseMetadata(markdown, realPlan), realPlan);
  const lifecycle = validateDagAndLifecycle(manifest);
  await assertPlanDiscoveryFenceUnchanged(
    migrationFence,
    options,
    { repoRoot },
  );

  const planRelativePath = path.relative(repoRoot, realPlan).split(path.sep).join('/');
  validateRepositoryPath(planRelativePath, 'planPath');
  const packageDirectory = path.dirname(realPlan);
  const declarationClaims = await validateDeclarationClaims(
    options.declarationClaims ?? options.declaration?.sourceClaims,
    manifest,
    repoRoot,
  );

  for (const [index, source] of manifest.architecture.sources.entries()) {
    await assertRepositoryPathContained(
      repoRoot,
      source,
      `Plan Package.architecture.sources[${index}]`,
    );
  }
  for (const [index, claim] of manifest.scope.sourceClaims.entries()) {
    await assertRepositoryPathContained(
      repoRoot,
      claim.pathPrefix,
      `Plan Package.scope.sourceClaims[${index}].pathPrefix`,
    );
  }

  const indexedFiles = manifest.tasks.map((task) => path.posix.basename(task.path)).sort();
  const actualFiles = await taskMarkdownFiles(path.join(packageDirectory, 'tasks'));
  if (
    actualFiles.length !== indexedFiles.length ||
    actualFiles.some((file, index) => file !== indexedFiles[index])
  ) {
    fail('PLAN_TASK_MISMATCH', 'Task index and tasks directory do not match', {
      indexedFiles,
      actualFiles,
    });
  }

  const taskSlices = new Map();
  for (const manifestTask of manifest.tasks) {
    const taskPath = path.join(packageDirectory, ...manifestTask.path.split('/'));
    const relativeTaskPath = path.relative(repoRoot, taskPath).split(path.sep).join('/');
    await assertRepositoryPathContained(
      repoRoot,
      relativeTaskPath,
      `Task ${manifestTask.id} path`,
    );
    const taskMarkdown = await fsp.readFile(taskPath, 'utf8');
    assertBounds(taskMarkdown, 'task', taskPath);
    assertNoForbiddenSections(taskMarkdown, taskPath);
    assertCurrentSnapshot(taskMarkdown, taskPath);
    const { value: task } = parseStructuredBlock(taskMarkdown, 'Task Slice', taskPath);
    validateTaskSliceSchema(task);
    if (
      task.planId !== manifest.planId ||
      task.taskId !== manifestTask.id ||
      task.workstreamId !== manifestTask.workstreamId
    ) {
      fail('PLAN_TASK_MISMATCH', 'Task Slice metadata does not match its manifest entry', {
        taskPath: manifestTask.path,
        manifest: {
          planId: manifest.planId,
          taskId: manifestTask.id,
          workstreamId: manifestTask.workstreamId,
        },
        task: {
          planId: task.planId,
          taskId: task.taskId,
          workstreamId: task.workstreamId,
        },
      });
    }
    for (const [index, targetPath] of task.writeSet.entries()) {
      await assertRepositoryPathContained(
        repoRoot,
        targetPath,
        `Task ${task.taskId}.writeSet[${index}]`,
      );
    }
    for (const [index, targetPath] of task.readSet.entries()) {
      await assertRepositoryPathContained(
        repoRoot,
        targetPath,
        `Task ${task.taskId}.readSet[${index}]`,
      );
    }
    validateTaskScope(task, manifest, declarationClaims);
    taskSlices.set(task.taskId, task);
  }
  assertAcceptanceCrosswalk(manifest, taskSlices, acceptance);

  const currentTask =
    lifecycle.current.length === 1 ? taskSlices.get(lifecycle.current[0].id) : null;
  const readyTasks = lifecycle.ready.map((task) => taskSlices.get(task.id));
  await assertPlanDiscoveryFenceUnchanged(
    migrationFence,
    options,
    { repoRoot },
  );

  return {
    path: realPlan,
    repoRoot,
    manifest,
    acceptance,
    taskSlices,
    currentTask,
    readyTasks,
  };
}

export function allDeclaredGateIds(acceptance) {
  const ordered = [
    ...Object.values(acceptance.closures).flat(),
    ...acceptance.completion,
    ...acceptance.full,
  ];
  return [...new Set(ordered)];
}

function progressPercentage(completed, total) {
  return total === 0
    ? 100
    : Number(((completed / total) * 100).toFixed(2));
}

export function summarizePlanProgress(planPackage) {
  const tasks = planPackage.manifest.tasks;
  const completed = tasks.filter((task) => task.status === 'done').length;
  const total = tasks.length;
  const percentage = progressPercentage(completed, total);
  const currentTasks = tasks.filter((task) => task.status === 'in_progress');
  const current =
    planPackage.manifest.status === 'active' && currentTasks.length === 1
      ? currentTasks[0]
      : null;

  if (!current) {
    return {
      unit: 'task-closure',
      completed,
      total,
      percentage,
      currentTaskId: null,
      nextProgressBoundary: null,
    };
  }

  const completedAfter = completed + 1;
  const percentageAfter = progressPercentage(completedAfter, total);
  const doneAfter = new Set(
    tasks
      .filter((task) => task.status === 'done')
      .map((task) => task.id),
  );
  doneAfter.add(current.id);
  const readyBefore = new Set(
    tasks
      .filter(
        (task) =>
          task.status === 'pending' &&
          task.dependsOn.every((dependency) =>
            tasks.some(
              (candidate) =>
                candidate.id === dependency && candidate.status === 'done',
            ),
          ),
      )
      .map((task) => task.id),
  );
  const unlocksTaskIds = tasks
    .filter(
      (task) =>
        task.status === 'pending' &&
        !readyBefore.has(task.id) &&
        task.dependsOn.every((dependency) => doneAfter.has(dependency)),
    )
    .map((task) => task.id);

  return {
    unit: 'task-closure',
    completed,
    total,
    percentage,
    currentTaskId: current.id,
    nextProgressBoundary: {
      taskId: current.id,
      title: planPackage.taskSlices.get(current.id).title,
      transition: 'in_progress->done',
      completedDelta: 1,
      completedAfter,
      percentageAfter,
      percentagePointDelta: Number((percentageAfter - percentage).toFixed(2)),
      unlocksTaskIds,
    },
  };
}

export function summarizePlanPackage(planPackage) {
  const currentManifestTask =
    planPackage.manifest.tasks.find((task) => task.status === 'in_progress') ?? null;
  const taskStatuses = Object.fromEntries(
    planPackage.manifest.tasks.map((task) => [task.id, task.status]),
  );
  const closureStatuses = Object.fromEntries(
    planPackage.manifest.tasks.map((task) => [
      planPackage.taskSlices.get(task.id).closureId,
      task.status,
    ]),
  );
  return {
    ok: true,
    plan: planPackage.path,
    planId: planPackage.manifest.planId,
    status: planPackage.manifest.status,
    branch: planPackage.manifest.binding.branch,
    workspaceId: planPackage.manifest.binding.workspaceId,
    initialHead: planPackage.manifest.binding.initialHead,
    sourceClaims: planPackage.manifest.scope.sourceClaims.map((claim) => ({
      pathPrefix: claim.pathPrefix,
      mode: claim.mode,
    })),
    progress: summarizePlanProgress(planPackage),
    currentTaskId: currentManifestTask?.id ?? null,
    currentTaskPath: currentManifestTask?.path ?? null,
    currentClosure: planPackage.currentTask?.closureId ?? null,
    taskStatuses,
    acceptance: planPackage.acceptance,
    closureStatuses,
    closures: closureStatuses,
    completion: planPackage.acceptance.completion,
    full: planPackage.acceptance.full,
    allDeclaredGateIds: allDeclaredGateIds(planPackage.acceptance),
  };
}

export function renderPlanDocument(markdown, manifest) {
  validateManifestSchema(manifest);
  validateDagAndLifecycle(manifest);
  const { block } = parseStructuredBlock(markdown, 'Plan Package', '<memory>');
  if (parseMetadata(markdown, '<memory>').has('expectedhead')) {
    fail(
      'PLAN_METADATA_MISMATCH',
      'Obsolete Expected HEAD metadata must be removed before rendering',
      { path: '<memory>', key: 'Expected HEAD' },
    );
  }
  const replacements = new Map([
    ['status', manifest.status],
    ['branch', manifest.binding.branch],
    ['workspaceid', manifest.binding.workspaceId],
    ['initialhead', manifest.binding.initialHead],
  ]);

  function renderWith(serializedManifest) {
    let candidate =
      markdown.slice(0, block.contentStart) +
      `${serializedManifest}\n` +
      markdown.slice(block.contentEnd);
    const seen = new Set();
    candidate = candidate.replace(
      /^(\s*>\s*\*\*([^*]+)\*\*:\s*)(.*?)(\s*)$/gm,
      (whole, prefix, rawKey, _value, suffix) => {
        const key = metadataKey(rawKey);
        if (key === 'worktreesetdigest') return '';
        if (!replacements.has(key)) return whole;
        if (seen.has(key)) {
          fail('PLAN_METADATA_MISMATCH', 'Markdown metadata key is duplicated', {
            key: rawKey,
          });
        }
        seen.add(key);
        return `${prefix}${replacements.get(key)}${suffix}`;
      },
    );
    for (const key of replacements.keys()) {
      if (!seen.has(key)) {
        fail('PLAN_METADATA_MISMATCH', 'Required Markdown metadata is missing', { key });
      }
    }
    return candidate;
  }

  let rendered = renderWith(JSON.stringify(manifest, null, 2));
  try {
    assertBounds(rendered, 'manifest', '<memory>');
  } catch (error) {
    if (!(error instanceof PlanPackageError) || error.code !== 'PLAN_BOUNDS_EXCEEDED') {
      throw error;
    }
    rendered = renderWith(JSON.stringify(manifest));
    assertBounds(rendered, 'manifest', '<memory>');
  }
  assertNoForbiddenSections(rendered, '<memory>');
  return rendered;
}

const ATOMIC_RENAME_SCRIPT = [
  'import ctypes, errno, json, os, sys',
  'operation, source, destination = sys.argv[1:4]',
  'libc = ctypes.CDLL(None, use_errno=True)',
  'source_bytes = os.fsencode(source)',
  'destination_bytes = os.fsencode(destination)',
  'try:',
  '    if sys.platform == "darwin":',
  '        function = libc.renamex_np',
  '        function.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]',
  '        function.restype = ctypes.c_int',
  '        flags = 0x00000002 if operation == "exchange" else 0x00000004',
  '        result = function(source_bytes, destination_bytes, flags)',
  '    elif sys.platform.startswith("linux"):',
  '        function = libc.renameat2',
  '        function.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]',
  '        function.restype = ctypes.c_int',
  '        flags = 0x00000002 if operation == "exchange" else 0x00000001',
  '        result = function(-100, source_bytes, -100, destination_bytes, flags)',
  '    else:',
  '        raise OSError(errno.ENOTSUP, "atomic rename primitive is unavailable")',
  '    if result != 0:',
  '        error_number = ctypes.get_errno()',
  '        raise OSError(error_number, os.strerror(error_number))',
  '    sys.stdout.write(json.dumps({"ok": True}) + "\\n")',
  'except (AttributeError, OSError) as error:',
  '    error_number = getattr(error, "errno", None) or errno.ENOTSUP',
  '    sys.stdout.write(json.dumps({"ok": False, "errno": error_number, "code": errno.errorcode.get(error_number, "UNKNOWN"), "message": str(error)}) + "\\n")',
].join('\n');

function nativeAtomicRename(operation, sourcePath, destinationPath) {
  const result = spawnSync(
    'python3',
    [
      '-c',
      ATOMIC_RENAME_SCRIPT,
      operation,
      path.resolve(sourcePath),
      path.resolve(destinationPath),
    ],
    {
      encoding: 'utf8',
      env: process.env,
      maxBuffer: 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    fail(
      'PLAN_ATOMIC_RENAME_UNAVAILABLE',
      'Atomic rename helper failed',
      {
        operation,
        status: result.status,
        stderr: result.stderr?.trim() || null,
      },
    );
  }
  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    fail(
      'PLAN_ATOMIC_RENAME_UNAVAILABLE',
      'Atomic rename helper returned invalid output',
      { operation },
    );
  }
  if (payload.ok) return;
  if (payload.code === 'EEXIST' || payload.code === 'ENOENT') {
    fail(
      'PLAN_CONCURRENT_MODIFICATION',
      'File state changed before atomic rename',
      {
        operation,
        sourcePath: path.resolve(sourcePath),
        destinationPath: path.resolve(destinationPath),
        cause: payload.code,
      },
    );
  }
  fail(
    'PLAN_ATOMIC_RENAME_UNAVAILABLE',
    'Required atomic rename primitive failed',
    {
      operation,
      sourcePath: path.resolve(sourcePath),
      destinationPath: path.resolve(destinationPath),
      cause: payload.code,
      message: payload.message,
    },
  );
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

export async function atomicMoveFileNoReplace(sourcePath, destinationPath) {
  const source = path.resolve(sourcePath);
  const destination = path.resolve(destinationPath);
  await fsp.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  nativeAtomicRename('no-replace', source, destination);
  await fsyncDirectory(path.dirname(source));
  if (path.dirname(destination) !== path.dirname(source)) {
    await fsyncDirectory(path.dirname(destination));
  }
}

export async function atomicExchangeFiles(leftPath, rightPath) {
  const left = path.resolve(leftPath);
  const right = path.resolve(rightPath);
  nativeAtomicRename('exchange', left, right);
  await fsyncDirectory(path.dirname(left));
  if (path.dirname(right) !== path.dirname(left)) {
    await fsyncDirectory(path.dirname(right));
  }
}

export async function assertAtomicRenameSupport(directory) {
  const root = path.resolve(directory);
  await fsp.mkdir(root, { recursive: true, mode: 0o700 });
  const token = `${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
  const exchangeLeft = path.join(root, `.plan-atomic-probe.${token}.left`);
  const exchangeRight = path.join(root, `.plan-atomic-probe.${token}.right`);
  const moveSource = path.join(root, `.plan-atomic-probe.${token}.source`);
  const moveDestination = path.join(root, `.plan-atomic-probe.${token}.destination`);
  try {
    await fsp.writeFile(exchangeLeft, 'left', { flag: 'wx', mode: 0o600 });
    await fsp.writeFile(exchangeRight, 'right', { flag: 'wx', mode: 0o600 });
    await atomicExchangeFiles(exchangeLeft, exchangeRight);
    if (
      (await fsp.readFile(exchangeLeft, 'utf8')) !== 'right' ||
      (await fsp.readFile(exchangeRight, 'utf8')) !== 'left'
    ) {
      fail(
        'PLAN_ATOMIC_RENAME_UNAVAILABLE',
        'Atomic exchange probe produced an invalid result',
        { directory: root },
      );
    }

    await fsp.writeFile(moveSource, 'move', { flag: 'wx', mode: 0o600 });
    await atomicMoveFileNoReplace(moveSource, moveDestination);
    if ((await fsp.readFile(moveDestination, 'utf8')) !== 'move') {
      fail(
        'PLAN_ATOMIC_RENAME_UNAVAILABLE',
        'Atomic no-replace probe produced an invalid result',
        { directory: root },
      );
    }
  } finally {
    await Promise.all(
      [exchangeLeft, exchangeRight, moveSource, moveDestination].map(
        (candidate) => fsp.rm(candidate, { force: true }),
      ),
    );
    await fsyncDirectory(root);
  }
}

export async function atomicReplaceFile(targetPath, content, options = {}) {
  const absoluteTarget = path.resolve(targetPath);
  const directory = path.dirname(absoluteTarget);
  const current = await fsp.readFile(absoluteTarget);
  if (
    options.expectedContent !== undefined &&
    !current.equals(Buffer.from(options.expectedContent))
  ) {
    fail('PLAN_CONCURRENT_MODIFICATION', 'File changed before atomic replacement', {
      path: absoluteTarget,
    });
  }
  const stat = await fsp.stat(absoluteTarget);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(absoluteTarget)}.${process.pid}.${Date.now()}.${Math.random()
      .toString(16)
      .slice(2)}.tmp`,
  );
  let handle;
  try {
    handle = await fsp.open(temporaryPath, 'wx', stat.mode);
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    handle = null;
    if (options.expectedContent !== undefined) {
      if (options.beforeAtomicCommit) {
        await options.beforeAtomicCommit();
      }
      await atomicExchangeFiles(temporaryPath, absoluteTarget);
      const displaced = await fsp.readFile(temporaryPath);
      if (!displaced.equals(Buffer.from(options.expectedContent))) {
        await atomicExchangeFiles(temporaryPath, absoluteTarget);
        const postRestore = await fsp.readFile(temporaryPath);
        if (!postRestore.equals(Buffer.from(content))) {
          await atomicExchangeFiles(temporaryPath, absoluteTarget);
        }
        fail('PLAN_CONCURRENT_MODIFICATION', 'File changed before atomic replacement', {
          path: absoluteTarget,
        });
      }
      await fsp.rm(temporaryPath, { force: true });
      await fsyncDirectory(directory);
      return;
    }
    await fsp.rename(temporaryPath, absoluteTarget);
    try {
      const directoryHandle = await fsp.open(directory, fs.constants.O_RDONLY);
      await directoryHandle.sync();
      await directoryHandle.close();
    } catch (error) {
      if (!['EINVAL', 'ENOTSUP', 'EISDIR'].includes(error.code)) throw error;
    }
  } finally {
    if (handle) await handle.close();
    await fsp.rm(temporaryPath, { force: true });
  }
}

export async function discoverPlanPackages(root, options = {}) {
  const explicitRoot = options.repoRoot ? await fsp.realpath(path.resolve(options.repoRoot)) : null;
  const searchRoot = await fsp.realpath(path.resolve(root));
  if (explicitRoot && !isNativePathInside(explicitRoot, searchRoot)) {
    fail('PLAN_PATH_ESCAPE', 'Discovery root is outside the explicit repository root', {
      root: searchRoot,
      repoRoot: explicitRoot,
    });
  }
  const repoRoot = explicitRoot ?? await findRepoRoot(searchRoot);
  const migrationFence = await assertPlanDiscoveryReadable(options, { repoRoot });

  const planPaths = [];
  async function walk(directory) {
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.name === 'archive' ||
        entry.name === '.git' ||
        entry.name === 'node_modules' ||
        entry.name === 'target' ||
        entry.name === 'dist'
      ) {
        continue;
      }
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(candidate);
      } else if (entry.isFile() && entry.name === 'plan.md') {
        const text = await fsp.readFile(candidate, 'utf8');
        if (findStructuredBlocks(text, 'Plan Package').length > 0) {
          planPaths.push(candidate);
        }
      }
    }
  }
  await walk(searchRoot);

  const packages = [];
  for (const planPath of planPaths.sort()) {
    const planPackage = await loadPlanPackage(planPath, {
      ...options,
      repoRoot,
    });
    if (planPackage.manifest.status !== 'superseded') {
      packages.push(planPackage);
    }
  }
  await assertPlanDiscoveryFenceUnchanged(
    migrationFence,
    options,
    { repoRoot },
  );
  return packages;
}

export function isDirectInvocation(importMetaUrl, argvPath = process.argv[1]) {
  if (!argvPath) return false;
  try {
    return fs.realpathSync(path.resolve(argvPath)) === fs.realpathSync(fileURLToPath(importMetaUrl));
  } catch {
    return false;
  }
}
