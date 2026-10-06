import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  ArchitectureGovernanceError,
  DEFAULT_REGISTRY_PATH,
  validatePlanArchitecture,
} from '../architecture/module-governance.mjs';

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
const RUNTIME_CLASSES = new Set([
  'source-only',
  'service',
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
const FORBIDDEN_SECTION_PATTERN =
  /^(?:context anchor|appendix|appendices|dated progress|progress (?:log|history|appendix)|execution log|attempt log|raw (?:command )?(?:output|log)|command output|run[- ]?ids?(?: list)?)$/i;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const TASK_SLICES_COLLECTION = 'Map';

export class PlanPackageError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'PlanPackageError';
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
    fail(
      'PLAN_SCHEMA_INVALID',
      `${context} must be an array with at least ${min} item(s)`,
    );
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
  values.forEach((value, index) => {
    assertString(value, `${context}[${index}]`, { pattern });
    if (seen.has(value)) {
      fail('PLAN_DUPLICATE', `${context} contains duplicate value`, { value });
    }
    seen.add(value);
  });
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
    const value = withoutLf.endsWith('\r')
      ? withoutLf.slice(0, -1)
      : withoutLf;
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
    while (
      closeIndex < lines.length &&
      !/^```\s*$/.test(lines[closeIndex].value)
    ) {
      closeIndex += 1;
    }
    if (closeIndex >= lines.length) {
      fail('PLAN_MARKDOWN_INVALID', 'JSON code fence is not closed', {
        label: requestedLabel,
        line: index + 1,
      });
    }

    const explicitLabel = opening[1]
      ? normalizeBlockLabel(opening[1])
      : null;
    if ((explicitLabel ?? nearestHeading) === expected) {
      blocks.push({
        label: requestedLabel,
        openLine: index + 1,
        closeLine: closeIndex + 1,
        contentStart: line.offset + line.raw.length,
        contentEnd: lines[closeIndex].offset,
        text: text.slice(
          line.offset + line.raw.length,
          lines[closeIndex].offset,
        ),
      });
    }
    index = closeIndex;
  }
  return blocks;
}

function parseStructuredBlock(text, label, sourcePath, { optional = false } = {}) {
  const blocks = findStructuredBlocks(text, label);
  if (blocks.length === 0 && optional) return null;
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
  markdownLines(text).forEach((line, index) => {
    const heading = /^#{1,6}\s+(.+?)\s*$/.exec(line.value);
    if (heading && FORBIDDEN_SECTION_PATTERN.test(heading[1].trim())) {
      fail(
        'PLAN_FORBIDDEN_SECTION',
        'plan package contains a forbidden history section',
        { path: sourcePath, line: index + 1, heading: heading[1].trim() },
      );
    }
  });
}

function assertCurrentSnapshot(text, sourcePath) {
  const lines = markdownLines(text);
  const indexes = [];
  lines.forEach((line, index) => {
    if (/^#{1,6}\s+current snapshot\s*$/i.test(line.value)) {
      indexes.push(index);
    }
  });
  if (indexes.length !== 1) {
    fail(
      'PLAN_SNAPSHOT_INVALID',
      'Task Slice must contain exactly one Current Snapshot section',
      { path: sourcePath, count: indexes.length },
    );
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
  if (end - start > SNAPSHOT_MAX_LINES) {
    fail('PLAN_SNAPSHOT_INVALID', 'Current Snapshot exceeds 30 lines', {
      path: sourcePath,
      lines: end - start,
      maxLines: SNAPSHOT_MAX_LINES,
    });
  }
}

function metadataKey(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function stripMetadataValue(value) {
  const trimmed = value.trim();
  return trimmed.startsWith('`') && trimmed.endsWith('`')
    ? trimmed.slice(1, -1)
    : trimmed;
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

function assertMetadata(plan, metadata, sourcePath) {
  for (const obsolete of [
    'status',
    'branch',
    'workspaceid',
    'initialhead',
    'expectedhead',
    'worktreesetdigest',
    'versionid',
  ]) {
    if (metadata.has(obsolete)) {
      fail(
        'PLAN_METADATA_MISMATCH',
        'execution and version metadata are forbidden in a Plan',
        { path: sourcePath, key: obsolete },
      );
    }
  }
  const expected = {
    planid: plan.planId,
    created: plan.createdAt,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (metadata.get(key) !== value) {
      fail(
        'PLAN_METADATA_MISMATCH',
        'Markdown metadata does not equal the Plan',
        {
          path: sourcePath,
          key,
          expected: value,
          actual: metadata.get(key) ?? null,
        },
      );
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
    fail(
      'PLAN_PATH_INVALID',
      `${context} must be a canonical repository-relative POSIX path`,
      { path: value },
    );
  }
  const segments = value.split('/');
  if (
    segments.some(
      (segment) => segment === '' || segment === '.' || segment === '..',
    )
  ) {
    fail('PLAN_PATH_INVALID', `${context} contains an invalid path segment`, {
      path: value,
    });
  }
  return value;
}

function isNativePathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  );
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
      fail(
        'PLAN_PATH_ESCAPE',
        `${context} has no containing repository parent`,
        { path: relativePath },
      );
    }
    existing = parent;
  }
  const realExisting = await fsp.realpath(existing);
  if (!isNativePathInside(repoRoot, realExisting)) {
    fail(
      'PLAN_PATH_ESCAPE',
      `${context} resolves through a symlink outside the repository`,
      { path: relativePath, resolvedParent: realExisting },
    );
  }
}

function segmentContains(prefix, candidate) {
  return candidate === prefix || candidate.startsWith(`${prefix}/`);
}

function validateSourceClaim(value, context) {
  assertClosedObject(value, ['pathPrefix', 'mode'], context);
  validateRepositoryPath(value.pathPrefix, `${context}.pathPrefix`);
  assertEnum(
    value.mode,
    new Set(['shared-read', 'exclusive-write']),
    `${context}.mode`,
  );
}

function validateAuthorization(value, context) {
  assertClosedObject(
    value,
    ['checkpoint', 'delivery', 'runtime', 'history'],
    context,
  );
  assertClosedObject(
    value.checkpoint,
    ['localCommit'],
    `${context}.checkpoint`,
  );
  assertEnum(
    value.checkpoint.localCommit,
    new Set(['allowed', 'denied']),
    `${context}.checkpoint.localCommit`,
  );
  assertClosedObject(
    value.delivery,
    ['push', 'pullRequest'],
    `${context}.delivery`,
  );
  assertEnum(
    value.delivery.push,
    new Set(['allowed', 'denied']),
    `${context}.delivery.push`,
  );
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
  assertUniqueStrings(
    value.runtime.deployProfiles,
    `${context}.runtime.deployProfiles`,
  );
  assertUniqueStrings(
    value.runtime.destructiveResetScopes,
    `${context}.runtime.destructiveResetScopes`,
  );
  assertClosedObject(value.history, ['rewrite'], `${context}.history`);
  assertEnum(
    value.history.rewrite,
    new Set(['allowed', 'denied']),
    `${context}.history.rewrite`,
  );
}

function validateRuntimeReuse(value, context) {
  assertClosedObject(
    value,
    [
      'scope',
      'entryCheckId',
      'scenarioIds',
      'maxProvisioningRuns',
      'maxClientLaunches',
      'minWarmReuseRate',
      'requireAttachOnlyScenarios',
      'requireReceiverVisibleProof',
      'allowClientReplacement',
    ],
    context,
  );
  assertEnum(value.scope, new Set(['suite']), `${context}.scope`);
  assertString(value.entryCheckId, `${context}.entryCheckId`, {
    pattern: ID_PATTERN,
  });
  assertUniqueStrings(value.scenarioIds, `${context}.scenarioIds`, {
    min: 2,
    pattern: ID_PATTERN,
  });
  assertInteger(value.maxProvisioningRuns, `${context}.maxProvisioningRuns`, {
    min: 1,
  });
  assertInteger(value.maxClientLaunches, `${context}.maxClientLaunches`, {
    min: 1,
  });
  if (
    typeof value.minWarmReuseRate !== 'number' ||
    !Number.isFinite(value.minWarmReuseRate) ||
    value.minWarmReuseRate < 0 ||
    value.minWarmReuseRate > 1
  ) {
    fail(
      'PLAN_SCHEMA_INVALID',
      `${context}.minWarmReuseRate must be a finite number between 0 and 1`,
    );
  }
  for (const field of [
    'requireAttachOnlyScenarios',
    'requireReceiverVisibleProof',
    'allowClientReplacement',
  ]) {
    if (typeof value[field] !== 'boolean') {
      fail('PLAN_SCHEMA_INVALID', `${context}.${field} must be a boolean`);
    }
  }
}

function validateNorthStar(value, context) {
  assertClosedObject(value, ['objective', 'successCriteria'], context);
  assertString(value.objective, `${context}.objective`);
  assertArray(value.successCriteria, `${context}.successCriteria`, {
    min: 1,
  });
  const criterionIds = new Set();
  value.successCriteria.forEach((criterion, index) => {
    const criterionContext = `${context}.successCriteria[${index}]`;
    assertClosedObject(
      criterion,
      ['id', 'statement', 'sourceRefs'],
      criterionContext,
    );
    assertString(criterion.id, `${criterionContext}.id`, {
      pattern: ID_PATTERN,
    });
    assertString(criterion.statement, `${criterionContext}.statement`);
    assertUniqueStrings(
      criterion.sourceRefs,
      `${criterionContext}.sourceRefs`,
      { min: 1 },
    );
    if (criterionIds.has(criterion.id)) {
      fail('PLAN_DUPLICATE', 'North Star criterion ID is duplicated', {
        criterionId: criterion.id,
      });
    }
    criterionIds.add(criterion.id);
  });
}

function validateNorthStarApproval(value, context) {
  if (value === null) return;
  assertClosedObject(
    value,
    ['northStarDigest', 'approvedBy', 'approvedAt', 'decisionRef'],
    context,
  );
  if (!/^[0-9a-f]{64}$/.test(value.northStarDigest ?? '')) {
    fail(
      'PLAN_SCHEMA_INVALID',
      `${context}.northStarDigest must be a SHA-256 digest`,
    );
  }
  assertString(value.approvedBy, `${context}.approvedBy`);
  assertString(value.approvedAt, `${context}.approvedAt`);
  if (
    Number.isNaN(Date.parse(value.approvedAt)) ||
    new Date(value.approvedAt).toISOString() !== value.approvedAt
  ) {
    fail(
      'PLAN_SCHEMA_INVALID',
      `${context}.approvedAt must be a canonical timestamp`,
    );
  }
  assertString(value.decisionRef, `${context}.decisionRef`);
}

function validateCriterionCoverage(value, context) {
  assertArray(value, context, { min: 1 });
  const criterionIds = new Set();
  value.forEach((coverage, index) => {
    const coverageContext = `${context}[${index}]`;
    assertClosedObject(
      coverage,
      ['criterionId', 'taskIds', 'closureIds', 'gateIds'],
      coverageContext,
    );
    assertString(coverage.criterionId, `${coverageContext}.criterionId`, {
      pattern: ID_PATTERN,
    });
    assertUniqueStrings(coverage.taskIds, `${coverageContext}.taskIds`, {
      min: 1,
      pattern: ID_PATTERN,
    });
    assertUniqueStrings(
      coverage.closureIds,
      `${coverageContext}.closureIds`,
      { min: 1, pattern: ID_PATTERN },
    );
    assertUniqueStrings(coverage.gateIds, `${coverageContext}.gateIds`, {
      pattern: ID_PATTERN,
    });
    if (criterionIds.has(coverage.criterionId)) {
      fail('PLAN_DUPLICATE', 'criterion coverage is duplicated', {
        criterionId: coverage.criterionId,
      });
    }
    criterionIds.add(coverage.criterionId);
  });
}

function validateAmendment(value, context) {
  assertClosedObject(
    value,
    [
      'id',
      'createdAt',
      'actor',
      'reason',
      'changes',
      'impact',
      'approval',
      'fromContentDigest',
      'toContentDigest',
    ],
    context,
  );
  assertString(value.id, `${context}.id`, { pattern: ID_PATTERN });
  assertString(value.createdAt, `${context}.createdAt`);
  if (
    Number.isNaN(Date.parse(value.createdAt)) ||
    new Date(value.createdAt).toISOString() !== value.createdAt
  ) {
    fail(
      'PLAN_SCHEMA_INVALID',
      `${context}.createdAt must be a canonical timestamp`,
    );
  }
  assertString(value.actor, `${context}.actor`);
  assertString(value.reason, `${context}.reason`);
  assertUniqueStrings(value.changes, `${context}.changes`, { min: 1 });
  assertClosedObject(
    value.impact,
    ['taskIds', 'gateIds'],
    `${context}.impact`,
  );
  assertUniqueStrings(value.impact.taskIds, `${context}.impact.taskIds`, {
    pattern: ID_PATTERN,
  });
  assertUniqueStrings(
    value.impact.gateIds,
    `${context}.impact.gateIds`,
    { pattern: ID_PATTERN },
  );
  assertClosedObject(
    value.approval,
    ['kind', 'decisionRef'],
    `${context}.approval`,
  );
  assertEnum(
    value.approval.kind,
    new Set(['agent', 'owner']),
    `${context}.approval.kind`,
  );
  if (value.approval.kind === 'agent') {
    if (value.approval.decisionRef !== null) {
      fail(
        'PLAN_SCHEMA_INVALID',
        `${context}.approval.decisionRef must be null for agent amendments`,
      );
    }
  } else {
    assertString(
      value.approval.decisionRef,
      `${context}.approval.decisionRef`,
    );
  }
  for (const field of ['fromContentDigest', 'toContentDigest']) {
    if (
      typeof value[field] !== 'string' ||
      !/^[0-9a-f]{64}$/.test(value[field])
    ) {
      fail(
        'PLAN_SCHEMA_INVALID',
        `${context}.${field} must be a SHA-256 digest`,
      );
    }
  }
  if (value.fromContentDigest === value.toContentDigest) {
    fail('PLAN_AMENDMENT_INVALID', `${context} cannot describe a no-op`);
  }
}

function validatePlan(plan) {
  assertClosedObject(
    plan,
    [
      'kind',
      'planId',
      'createdAt',
      'northStar',
      'northStarApproval',
      'criterionCoverage',
      'workClass',
      'architecture',
      'scope',
      'tasks',
      'authorization',
      'amendments',
    ],
    'Plan',
  );
  if (plan.kind !== 'peers-touch-plan') {
    fail('PLAN_SCHEMA_INVALID', 'Plan kind is unsupported');
  }
  assertString(plan.planId, 'Plan.planId', { pattern: ID_PATTERN });
  assertString(plan.createdAt, 'Plan.createdAt');
  if (
    Number.isNaN(Date.parse(plan.createdAt)) ||
    new Date(plan.createdAt).toISOString() !== plan.createdAt
  ) {
    fail(
      'PLAN_SCHEMA_INVALID',
      'Plan.createdAt must be a canonical timestamp',
    );
  }
  validateNorthStar(plan.northStar, 'Plan.northStar');
  validateNorthStarApproval(
    plan.northStarApproval,
    'Plan.northStarApproval',
  );
  validateCriterionCoverage(
    plan.criterionCoverage,
    'Plan.criterionCoverage',
  );
  assertEnum(plan.workClass, WORK_CLASSES, 'Plan.workClass');
  assertClosedObject(
    plan.architecture,
    ['sources', 'decisions'],
    'Plan.architecture',
  );
  assertUniqueStrings(
    plan.architecture.sources,
    'Plan.architecture.sources',
    { min: 1 },
  );
  plan.architecture.sources.forEach((source, index) =>
    validateRepositoryPath(
      source,
      `Plan.architecture.sources[${index}]`,
    ),
  );
  assertUniqueStrings(
    plan.architecture.decisions,
    'Plan.architecture.decisions',
  );

  assertClosedObject(
    plan.scope,
    ['sourceClaims', 'nonGoals'],
    'Plan.scope',
  );
  assertArray(plan.scope.sourceClaims, 'Plan.scope.sourceClaims', {
    min: 1,
  });
  const claimPaths = new Set();
  plan.scope.sourceClaims.forEach((claim, index) => {
    validateSourceClaim(claim, `Plan.scope.sourceClaims[${index}]`);
    if (claimPaths.has(claim.pathPrefix)) {
      fail('PLAN_DUPLICATE', 'Plan source claim path is duplicated', {
        path: claim.pathPrefix,
      });
    }
    claimPaths.add(claim.pathPrefix);
  });
  assertUniqueStrings(plan.scope.nonGoals, 'Plan.scope.nonGoals');

  assertArray(plan.tasks, 'Plan.tasks', { min: 1 });
  const taskIds = new Set();
  const taskPaths = new Set();
  plan.tasks.forEach((task, index) => {
    const context = `Plan.tasks[${index}]`;
    assertClosedObject(
      task,
      ['id', 'workstreamId', 'path', 'dependsOn'],
      context,
    );
    assertString(task.id, `${context}.id`, { pattern: ID_PATTERN });
    assertString(task.workstreamId, `${context}.workstreamId`, {
      pattern: ID_PATTERN,
    });
    validateRepositoryPath(task.path, `${context}.path`);
    if (task.path !== `tasks/${task.id}.md`) {
      fail('PLAN_PATH_INVALID', 'Task path must equal tasks/<task-id>.md', {
        taskId: task.id,
        path: task.path,
      });
    }
    assertUniqueStrings(task.dependsOn, `${context}.dependsOn`, {
      pattern: ID_PATTERN,
    });
    if (taskIds.has(task.id) || taskPaths.has(task.path)) {
      fail('PLAN_DUPLICATE', 'Plan Task identity is duplicated', {
        taskId: task.id,
        path: task.path,
      });
    }
    taskIds.add(task.id);
    taskPaths.add(task.path);
  });
  validateAuthorization(plan.authorization, 'Plan.authorization');
  assertArray(plan.amendments, 'Plan.amendments');
  const amendmentIds = new Set();
  let previous = null;
  plan.amendments.forEach((amendment, index) => {
    const context = `Plan.amendments[${index}]`;
    validateAmendment(amendment, context);
    if (amendmentIds.has(amendment.id)) {
      fail('PLAN_DUPLICATE', 'Plan amendment ID is duplicated', {
        amendmentId: amendment.id,
      });
    }
    if (
      previous !== null &&
      (amendment.fromContentDigest !== previous.toContentDigest ||
        Date.parse(amendment.createdAt) < Date.parse(previous.createdAt))
    ) {
      fail(
        'PLAN_AMENDMENT_INVALID',
        'Plan amendment log is not an ordered digest chain',
        { amendmentId: amendment.id },
      );
    }
    amendmentIds.add(amendment.id);
    previous = amendment;
  });
}

function validateDag(plan) {
  const tasksById = new Map(plan.tasks.map((task) => [task.id, task]));
  for (const task of plan.tasks) {
    for (const dependency of task.dependsOn) {
      if (!tasksById.has(dependency)) {
        fail('PLAN_DAG_INVALID', 'Task dependency does not exist', {
          taskId: task.id,
          dependency,
        });
      }
      if (dependency === task.id) {
        fail('PLAN_DAG_INVALID', 'Task cannot depend on itself', {
          taskId: task.id,
        });
      }
    }
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(taskId) {
    if (visited.has(taskId)) return;
    if (visiting.has(taskId)) {
      fail('PLAN_DAG_INVALID', 'Task dependency graph contains a cycle', {
        taskId,
      });
    }
    visiting.add(taskId);
    tasksById.get(taskId).dependsOn.forEach(visit);
    visiting.delete(taskId);
    visited.add(taskId);
  }
  plan.tasks.forEach((task) => visit(task.id));
}

function validateTaskSlice(task) {
  const optionalFields = 'runtimeReuse' in task ? ['runtimeReuse'] : [];
  assertClosedObject(
    task,
    [
      ...optionalFields,
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
    ],
    'Task Slice',
  );
  if (task.kind !== 'peers-touch-task-slice') {
    fail('PLAN_SCHEMA_INVALID', 'Task Slice kind is unsupported');
  }
  for (const field of ['planId', 'taskId', 'workstreamId', 'closureId']) {
    assertString(task[field], `Task Slice.${field}`, { pattern: ID_PATTERN });
  }
  assertString(task.title, 'Task Slice.title');
  assertString(task.journeyId, 'Task Slice.journeyId');
  assertEnum(task.workClass, WORK_CLASSES, 'Task Slice.workClass');
  assertEnum(
    task.completionClass,
    COMPLETION_CLASSES,
    'Task Slice.completionClass',
  );
  assertEnum(
    task.executionMode,
    new Set(['build', 'fix']),
    'Task Slice.executionMode',
  );
  assertEnum(task.runtimeClass, RUNTIME_CLASSES, 'Task Slice.runtimeClass');
  if (task.completionClass === 'source' && task.runtimeClass !== 'source-only') {
    fail(
      'PLAN_TASK_RUNTIME_INVALID',
      'source completion requires source-only runtime',
      { taskId: task.taskId },
    );
  }
  if (
    task.completionClass === 'acceptance-aggregate' &&
    task.runtimeClass !== 'source-only'
  ) {
    fail(
      'PLAN_TASK_RUNTIME_INVALID',
      'acceptance aggregate requires source-only runtime',
      { taskId: task.taskId },
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
      { taskId: task.taskId },
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
  assertInteger(
    task.budgets.focusedCheckSeconds,
    'Task Slice.budgets.focusedCheckSeconds',
    { min: 1 },
  );
  assertInteger(
    task.budgets.functionalRunSeconds,
    'Task Slice.budgets.functionalRunSeconds',
    { min: 1 },
  );
  assertInteger(
    task.budgets.cleanupSeconds,
    'Task Slice.budgets.cleanupSeconds',
    { min: 1 },
  );

  assertArray(task.checks, 'Task Slice.checks', { min: 1 });
  const checkIds = new Set();
  const checkClasses = new Set();
  task.checks.forEach((check, index) => {
    const context = `Task Slice.checks[${index}]`;
    assertClosedObject(check, ['id', 'command', 'verificationClass'], context);
    assertString(check.id, `${context}.id`, { pattern: ID_PATTERN });
    assertString(check.command, `${context}.command`);
    assertEnum(
      check.verificationClass,
      VERIFICATION_CLASSES,
      `${context}.verificationClass`,
    );
    if (checkIds.has(check.id)) {
      fail('PLAN_DUPLICATE', 'Task check ID is duplicated', {
        checkId: check.id,
      });
    }
    checkIds.add(check.id);
    checkClasses.add(check.verificationClass);
  });
  if (
    ![...checkClasses].some((value) =>
      FOCUSED_VERIFICATION_CLASSES.has(value),
    )
  ) {
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
      'Source Task Slice cannot declare runtime proof checks',
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
  if ('runtimeReuse' in task) {
    if (
      task.completionClass !== 'functional' ||
      task.runtimeClass === 'source-only'
    ) {
      fail(
        'PLAN_TASK_RUNTIME_INVALID',
        'runtimeReuse requires a functional executable-runtime Task',
        { taskId: task.taskId },
      );
    }
    validateRuntimeReuse(task.runtimeReuse, 'Task Slice.runtimeReuse');
    const entryCheck = task.checks.find(
      (check) => check.id === task.runtimeReuse.entryCheckId,
    );
    if (entryCheck?.verificationClass !== 'FUNCTIONAL_CHECK') {
      fail(
        'PLAN_TASK_CHECK_INVALID',
        'runtimeReuse.entryCheckId must reference one functional check',
        { taskId: task.taskId },
      );
    }
  }
  assertUniqueStrings(task.doneWhen, 'Task Slice.doneWhen', { min: 1 });
  assertUniqueStrings(task.failureBehavior, 'Task Slice.failureBehavior', {
    min: 1,
  });
  assertString(task.updatedAt, 'Task Slice.updatedAt');
  if (
    Number.isNaN(Date.parse(task.updatedAt)) ||
    new Date(task.updatedAt).toISOString() !== task.updatedAt
  ) {
    fail(
      'PLAN_SCHEMA_INVALID',
      'Task Slice.updatedAt must be a canonical timestamp',
    );
  }
}

function validateAcceptance(acceptance) {
  assertClosedObject(
    acceptance,
    ['closures', 'completion', 'full'],
    'Acceptance Execution',
  );
  if (!isPlainObject(acceptance.closures)) {
    fail(
      'PLAN_SCHEMA_INVALID',
      'Acceptance Execution.closures must be an object',
    );
  }
  for (const [closureId, gateIds] of Object.entries(acceptance.closures)) {
    assertString(closureId, 'Acceptance Execution closure ID', {
      pattern: ID_PATTERN,
    });
    assertUniqueStrings(
      gateIds,
      `Acceptance Execution.closures.${closureId}`,
    );
  }
  assertUniqueStrings(acceptance.completion, 'Acceptance Execution.completion');
  assertUniqueStrings(acceptance.full, 'Acceptance Execution.full');
}

function validateSourceInvalidationPolicy(policy, plan) {
  if (policy === null) return;
  assertClosedObject(
    policy,
    ['kind', 'sourceOwnerTaskId', 'rootTaskIds'],
    'Source Invalidation Policy',
  );
  if (policy.kind !== 'peers-touch-source-invalidation-policy') {
    fail(
      'PLAN_SCHEMA_INVALID',
      'Source Invalidation Policy kind is unsupported',
    );
  }
  assertString(
    policy.sourceOwnerTaskId,
    'Source Invalidation Policy.sourceOwnerTaskId',
    { pattern: ID_PATTERN },
  );
  assertUniqueStrings(
    policy.rootTaskIds,
    'Source Invalidation Policy.rootTaskIds',
    { min: 1, pattern: ID_PATTERN },
  );
  const ids = new Set(plan.tasks.map((task) => task.id));
  if (
    !ids.has(policy.sourceOwnerTaskId) ||
    policy.rootTaskIds.some((taskId) => !ids.has(taskId))
  ) {
    fail(
      'PLAN_DAG_INVALID',
      'Source Invalidation Policy references an unknown Task',
    );
  }
}

function validateTaskScope(task, plan) {
  const claims = plan.scope.sourceClaims;
  for (const target of task.writeSet) {
    const covered = claims.some(
      (claim) =>
        claim.mode === 'exclusive-write' &&
        segmentContains(claim.pathPrefix, target),
    );
    if (!covered) {
      fail('PLAN_SCOPE_INVALID', 'Task writeSet escapes Plan source claims', {
        taskId: task.taskId,
        path: target,
      });
    }
  }
  for (const target of task.readSet) {
    const covered = claims.some((claim) =>
      segmentContains(claim.pathPrefix, target),
    );
    if (!covered) {
      fail('PLAN_SCOPE_INVALID', 'Task readSet escapes Plan source claims', {
        taskId: task.taskId,
        path: target,
      });
    }
  }
}

function validateCrosswalk(plan, taskSlices, acceptance) {
  const closureIds = new Set();
  const taskClosureIds = new Map();
  for (const planTask of plan.tasks) {
    const task = taskSlices.get(planTask.id);
    if (closureIds.has(task.closureId)) {
      fail('PLAN_DUPLICATE', 'Task closure ID is duplicated', {
        closureId: task.closureId,
      });
    }
    closureIds.add(task.closureId);
    taskClosureIds.set(planTask.id, task.closureId);
  }
  const acceptanceClosureIds = Object.keys(acceptance.closures);
  if (
    acceptanceClosureIds.length !== closureIds.size ||
    acceptanceClosureIds.some((closureId) => !closureIds.has(closureId))
  ) {
    fail(
      'PLAN_ACCEPTANCE_INVALID',
      'Acceptance closures must equal Task closure IDs',
      {
        expected: [...closureIds].sort(),
        actual: acceptanceClosureIds.sort(),
      },
    );
  }
  for (const task of taskSlices.values()) {
    const gates = acceptance.closures[task.closureId];
    const classes = new Set(
      task.checks.map((check) => check.verificationClass),
    );
    if (task.completionClass === 'source' && gates.length !== 0) {
      fail(
        'PLAN_ACCEPTANCE_INVALID',
        'Source Task must own an empty Acceptance closure',
        { taskId: task.taskId },
      );
    }
    if (
      task.completionClass === 'functional' &&
      gates.length > 0 &&
      !classes.has('ACCEPTANCE_PROOF')
    ) {
      fail(
        'PLAN_ACCEPTANCE_INVALID',
        'Functional Task with Acceptance Gates must declare proof checks',
        { taskId: task.taskId },
      );
    }
    if (
      task.completionClass === 'acceptance-aggregate' &&
      gates.length === 0
    ) {
      fail(
        'PLAN_ACCEPTANCE_INVALID',
        'Acceptance aggregate must own a non-empty closure',
        { taskId: task.taskId },
      );
    }
  }

  const criterionIds = new Set(
    plan.northStar.successCriteria.map((criterion) => criterion.id),
  );
  const coveredCriterionIds = new Set(
    plan.criterionCoverage.map((coverage) => coverage.criterionId),
  );
  if (
    criterionIds.size !== coveredCriterionIds.size ||
    [...criterionIds].some(
      (criterionId) => !coveredCriterionIds.has(criterionId),
    ) ||
    [...coveredCriterionIds].some(
      (criterionId) => !criterionIds.has(criterionId),
    )
  ) {
    fail(
      'PLAN_CRITERION_COVERAGE_INVALID',
      'criterion coverage must contain every North Star criterion exactly once',
      {
        expected: [...criterionIds].sort(),
        actual: [...coveredCriterionIds].sort(),
      },
    );
  }

  for (const coverage of plan.criterionCoverage) {
    const expectedClosureIds = [
      ...new Set(
        coverage.taskIds.map((taskId) => taskClosureIds.get(taskId)),
      ),
    ];
    if (
      expectedClosureIds.some((closureId) => closureId === undefined) ||
      !sameStringSet(expectedClosureIds, coverage.closureIds)
    ) {
      fail(
        'PLAN_CRITERION_COVERAGE_INVALID',
        'criterion coverage closures must equal the closures owned by its Tasks',
        {
          criterionId: coverage.criterionId,
          expected: expectedClosureIds.filter(Boolean).sort(),
          actual: [...coverage.closureIds].sort(),
        },
      );
    }
    const expectedGateIds = [
      ...new Set(
        coverage.closureIds.flatMap(
          (closureId) => acceptance.closures[closureId] ?? [],
        ),
      ),
    ];
    if (!sameStringSet(expectedGateIds, coverage.gateIds)) {
      fail(
        'PLAN_CRITERION_COVERAGE_INVALID',
        'criterion coverage Gates must equal the Gates owned by its closures',
        {
          criterionId: coverage.criterionId,
          expected: expectedGateIds.sort(),
          actual: [...coverage.gateIds].sort(),
        },
      );
    }
  }
}

function sameStringSet(left, right) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

export function digestNorthStar(plan) {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify(
        canonicalize({
          kind: 'peers-touch-north-star',
          planId: plan.planId,
          northStar: plan.northStar,
        }),
      ),
    )
    .digest('hex');
}

export function inspectNorthStarApproval(plan) {
  const northStarDigest = digestNorthStar(plan);
  const approval = plan.northStarApproval;
  return {
    status:
      approval === null
        ? 'candidate'
        : approval.northStarDigest === northStarDigest
          ? 'approved'
          : 'stale',
    northStarDigest,
    approval,
  };
}

export function digestPlanContent({
  plan,
  tasks,
  acceptance,
  sourceInvalidationPolicy = null,
}) {
  const planContent = structuredClone(plan);
  delete planContent.amendments;
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify(
        canonicalize({
          plan: planContent,
          tasks: [...tasks].sort((left, right) =>
            left.taskId.localeCompare(right.taskId),
          ),
          acceptance,
          sourceInvalidationPolicy,
        }),
      ),
    )
    .digest('hex');
}

export function digestPlan({
  plan,
  tasks,
  acceptance,
  sourceInvalidationPolicy = null,
}) {
  const contentDigest = digestPlanContent({
    plan,
    tasks,
    acceptance,
    sourceInvalidationPolicy,
  });
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify(
        canonicalize({
          contentDigest,
          amendments: plan.amendments,
        }),
      ),
    )
    .digest('hex');
}

async function findRepoRoot(start) {
  let current = path.resolve(start);
  while (true) {
    if (await pathExists(path.join(current, '.git'))) return fsp.realpath(current);
    const parent = path.dirname(current);
    if (parent === current) {
      fail('PLAN_REPOSITORY_INVALID', 'Plan is not inside a Git repository', {
        path: start,
      });
    }
    current = parent;
  }
}

async function resolveRepoRoot(planPath, explicitRoot) {
  const realPlan = await fsp.realpath(planPath);
  const repoRoot = explicitRoot
    ? await fsp.realpath(path.resolve(explicitRoot))
    : await findRepoRoot(path.dirname(realPlan));
  if (!isNativePathInside(repoRoot, realPlan)) {
    fail('PLAN_PATH_ESCAPE', 'Plan path is outside the repository root', {
      planPath: realPlan,
      repoRoot,
    });
  }
  return { repoRoot, realPlan };
}

async function taskMarkdownFiles(tasksDirectory) {
  let entries;
  try {
    entries = await fsp.readdir(tasksDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      fail('PLAN_TASK_MISMATCH', 'Plan tasks directory does not exist', {
        path: tasksDirectory,
      });
    }
    throw error;
  }
  return entries
    .filter(
      (entry) =>
        (entry.isFile() || entry.isSymbolicLink()) &&
        entry.name.endsWith('.md'),
    )
    .map((entry) => entry.name)
    .sort();
}

async function validateRegisteredArchitecture(plan, repoRoot) {
  if (!fs.existsSync(path.join(repoRoot, ...DEFAULT_REGISTRY_PATH.split('/')))) {
    return null;
  }
  try {
    return await validatePlanArchitecture({
      repoRoot,
      registryPath: DEFAULT_REGISTRY_PATH,
      sources: plan.architecture.sources,
      decisions: plan.architecture.decisions,
    });
  } catch (error) {
    if (error instanceof ArchitectureGovernanceError || error?.code) {
      fail(
        error.code ?? 'ARCHITECTURE_REGISTRY_INVALID',
        error.message,
        error.details,
      );
    }
    throw error;
  }
}

export async function loadPlanPackage(planPath, options = {}) {
  assertString(planPath, 'planPath');
  const absolutePlan = path.resolve(planPath);
  const { repoRoot, realPlan } = await resolveRepoRoot(
    absolutePlan,
    options.repoRoot,
  );
  const markdown = await fsp.readFile(realPlan, 'utf8');
  assertBounds(markdown, 'manifest', realPlan);
  assertNoForbiddenSections(markdown, realPlan);

  const { value: plan, block: planBlock } = parseStructuredBlock(
    markdown,
    'Plan',
    realPlan,
  );
  const { value: acceptance } = parseStructuredBlock(
    markdown,
    'Acceptance Execution',
    realPlan,
  );
  const invalidationBlock = parseStructuredBlock(
    markdown,
    'Source Invalidation Policy',
    realPlan,
    { optional: true },
  );
  const sourceInvalidationPolicy = invalidationBlock?.value ?? null;
  validatePlan(plan);
  validateDag(plan);
  validateAcceptance(acceptance);
  validateSourceInvalidationPolicy(sourceInvalidationPolicy, plan);
  assertMetadata(plan, parseMetadata(markdown, realPlan), realPlan);

  const planRelativePath = path
    .relative(repoRoot, realPlan)
    .split(path.sep)
    .join('/');
  validateRepositoryPath(planRelativePath, 'planPath');
  const packageDirectory = path.dirname(realPlan);

  for (const [index, source] of plan.architecture.sources.entries()) {
    await assertRepositoryPathContained(
      repoRoot,
      source,
      `Plan.architecture.sources[${index}]`,
    );
  }
  const architectureGovernance = await validateRegisteredArchitecture(
    plan,
    repoRoot,
  );
  for (const [index, claim] of plan.scope.sourceClaims.entries()) {
    await assertRepositoryPathContained(
      repoRoot,
      claim.pathPrefix,
      `Plan.scope.sourceClaims[${index}].pathPrefix`,
    );
  }

  const indexedFiles = plan.tasks
    .map((task) => path.posix.basename(task.path))
    .sort();
  const actualFiles = await taskMarkdownFiles(
    path.join(packageDirectory, 'tasks'),
  );
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
  for (const planTask of plan.tasks) {
    const taskPath = path.join(
      packageDirectory,
      ...planTask.path.split('/'),
    );
    const relativeTaskPath = path
      .relative(repoRoot, taskPath)
      .split(path.sep)
      .join('/');
    await assertRepositoryPathContained(
      repoRoot,
      relativeTaskPath,
      `Task ${planTask.id} path`,
    );
    const taskMarkdown = await fsp.readFile(taskPath, 'utf8');
    assertBounds(taskMarkdown, 'task', taskPath);
    assertNoForbiddenSections(taskMarkdown, taskPath);
    assertCurrentSnapshot(taskMarkdown, taskPath);
    const { value: task } = parseStructuredBlock(
      taskMarkdown,
      'Task Slice',
      taskPath,
    );
    validateTaskSlice(task);
    if (
      task.planId !== plan.planId ||
      task.taskId !== planTask.id ||
      task.workstreamId !== planTask.workstreamId
    ) {
      fail(
        'PLAN_TASK_MISMATCH',
        'Task Slice metadata does not match its Plan entry',
        { taskPath: planTask.path, taskId: task.taskId },
      );
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
    validateTaskScope(task, plan);
    taskSlices.set(task.taskId, task);
  }
  validateCrosswalk(plan, taskSlices, acceptance);

  const tasks = plan.tasks.map((task) => taskSlices.get(task.id));
  const planContentDigest = digestPlanContent({
    plan,
    tasks,
    acceptance,
    sourceInvalidationPolicy,
  });
  const northStarApproval = inspectNorthStarApproval(plan);
  if (
    options.allowUnrecordedAmendment !== true &&
    northStarApproval.status === 'approved' &&
    plan.amendments.length > 0 &&
    plan.amendments.at(-1).toContentDigest !== planContentDigest
  ) {
    fail(
      'PLAN_AMENDMENT_REQUIRED',
      'Plan content changed without a matching amendment record',
      {
        recordedContentDigest: plan.amendments.at(-1).toContentDigest,
        currentContentDigest: planContentDigest,
      },
    );
  }
  const planDigest = digestPlan({
    plan,
    tasks,
    acceptance,
    sourceInvalidationPolicy,
  });
  return {
    path: realPlan,
    planPath: planRelativePath,
    repoRoot,
    plan,
    manifest: plan,
    acceptance,
    sourceInvalidationPolicy,
    architectureGovernance,
    taskSlices,
    tasks,
    planContentDigest,
    planDigest,
    northStarApproval,
    markdown,
    planBlock,
  };
}

export async function recordNorthStarApproval(planPackage, approval) {
  assertClosedObject(
    approval,
    ['approvedBy', 'approvedAt', 'decisionRef'],
    'North Star approval input',
  );
  const nextApproval = {
    northStarDigest: digestNorthStar(planPackage.plan),
    approvedBy: approval.approvedBy,
    approvedAt: approval.approvedAt,
    decisionRef: approval.decisionRef,
  };
  validateNorthStarApproval(nextApproval, 'Plan.northStarApproval');
  if (planPackage.northStarApproval.status === 'approved') {
    if (
      planPackage.plan.northStarApproval.approvedBy ===
        nextApproval.approvedBy &&
      planPackage.plan.northStarApproval.decisionRef ===
        nextApproval.decisionRef
    ) {
      return planPackage;
    }
    fail(
      'NORTH_STAR_ALREADY_APPROVED',
      'The current North Star already has a different explicit approval',
      {
        northStarDigest: nextApproval.northStarDigest,
        approval: planPackage.plan.northStarApproval,
      },
    );
  }
  const nextPlan = {
    ...planPackage.plan,
    northStarApproval: nextApproval,
  };
  validatePlan(nextPlan);
  const block = planPackage.planBlock;
  const nextMarkdown = [
    planPackage.markdown.slice(0, block.contentStart),
    `${JSON.stringify(nextPlan)}\n`,
    planPackage.markdown.slice(block.contentEnd),
  ].join('');
  assertBounds(nextMarkdown, 'manifest', planPackage.path);
  await atomicReplaceFile(planPackage.path, nextMarkdown, {
    expectedContent: planPackage.markdown,
  });
  return loadPlanPackage(planPackage.path, {
    repoRoot: planPackage.repoRoot,
    allowUnrecordedAmendment: true,
  });
}

export async function appendPlanAmendment(planPackage, amendment) {
  validateAmendment(amendment, 'Plan amendment');
  if (amendment.toContentDigest !== planPackage.planContentDigest) {
    fail(
      'PLAN_AMENDMENT_INVALID',
      'amendment target digest does not match current Plan content',
      {
        expected: planPackage.planContentDigest,
        actual: amendment.toContentDigest,
      },
    );
  }
  const prior = planPackage.plan.amendments.at(-1) ?? null;
  if (
    prior !== null &&
    amendment.fromContentDigest !== prior.toContentDigest
  ) {
    fail(
      'PLAN_AMENDMENT_INVALID',
      'amendment does not continue the recorded digest chain',
      {
        expected: prior.toContentDigest,
        actual: amendment.fromContentDigest,
      },
    );
  }
  if (
    planPackage.plan.amendments.some(
      (candidate) => candidate.id === amendment.id,
    )
  ) {
    fail('PLAN_DUPLICATE', 'Plan amendment ID is duplicated', {
      amendmentId: amendment.id,
    });
  }
  const nextPlan = {
    ...planPackage.plan,
    amendments: [...planPackage.plan.amendments, amendment],
  };
  validatePlan(nextPlan);
  const block = planPackage.planBlock;
  const nextMarkdown = [
    planPackage.markdown.slice(0, block.contentStart),
    `${JSON.stringify(nextPlan)}\n`,
    planPackage.markdown.slice(block.contentEnd),
  ].join('');
  assertBounds(nextMarkdown, 'manifest', planPackage.path);
  await atomicReplaceFile(planPackage.path, nextMarkdown, {
    expectedContent: planPackage.markdown,
  });
  return loadPlanPackage(planPackage.path, {
    repoRoot: planPackage.repoRoot,
  });
}

export function allDeclaredGateIds(acceptance) {
  return [
    ...new Set([
      ...Object.values(acceptance.closures).flat(),
      ...acceptance.completion,
      ...acceptance.full,
    ]),
  ];
}

export function summarizePlanPackage(planPackage) {
  return {
    ok: true,
    plan: planPackage.path,
    planPath: planPackage.planPath,
    planId: planPackage.plan.planId,
    createdAt: planPackage.plan.createdAt,
    planDigest: planPackage.planDigest,
    planContentDigest: planPackage.planContentDigest,
    northStarDigest: planPackage.northStarApproval.northStarDigest,
    northStarApprovalStatus: planPackage.northStarApproval.status,
    northStarApproval: planPackage.northStarApproval.approval,
    amendmentCount: planPackage.plan.amendments.length,
    workClass: planPackage.plan.workClass,
    sourceClaims: planPackage.plan.scope.sourceClaims.map((claim) => ({
      ...claim,
    })),
    taskIds: planPackage.plan.tasks.map((task) => task.id),
    acceptance: planPackage.acceptance,
    completion: planPackage.acceptance.completion,
    full: planPackage.acceptance.full,
    allDeclaredGateIds: allDeclaredGateIds(planPackage.acceptance),
  };
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
    { encoding: 'utf8', env: process.env, maxBuffer: 1024 * 1024 },
  );
  if (result.status !== 0) {
    fail('PLAN_ATOMIC_RENAME_UNAVAILABLE', 'Atomic rename helper failed', {
      operation,
      status: result.status,
      stderr: result.stderr?.trim() || null,
    });
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
    fail('PLAN_CONCURRENT_MODIFICATION', 'File state changed before atomic rename', {
      operation,
      sourcePath: path.resolve(sourcePath),
      destinationPath: path.resolve(destinationPath),
      cause: payload.code,
    });
  }
  fail('PLAN_ATOMIC_RENAME_UNAVAILABLE', 'Required atomic rename primitive failed', {
    operation,
    cause: payload.code,
    message: payload.message,
  });
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
  nativeAtomicRename('exchange', path.resolve(leftPath), path.resolve(rightPath));
  await fsyncDirectory(path.dirname(path.resolve(leftPath)));
  if (path.dirname(path.resolve(rightPath)) !== path.dirname(path.resolve(leftPath))) {
    await fsyncDirectory(path.dirname(path.resolve(rightPath)));
  }
}

export async function assertAtomicRenameSupport(directory) {
  const root = path.resolve(directory);
  await fsp.mkdir(root, { recursive: true, mode: 0o700 });
  const token = `${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
  const left = path.join(root, `.plan-atomic-probe.${token}.left`);
  const right = path.join(root, `.plan-atomic-probe.${token}.right`);
  const source = path.join(root, `.plan-atomic-probe.${token}.source`);
  const destination = path.join(root, `.plan-atomic-probe.${token}.destination`);
  try {
    await fsp.writeFile(left, 'left', { flag: 'wx', mode: 0o600 });
    await fsp.writeFile(right, 'right', { flag: 'wx', mode: 0o600 });
    await atomicExchangeFiles(left, right);
    await fsp.writeFile(source, 'move', { flag: 'wx', mode: 0o600 });
    await atomicMoveFileNoReplace(source, destination);
  } finally {
    await Promise.all(
      [left, right, source, destination].map((candidate) =>
        fsp.rm(candidate, { force: true }),
      ),
    );
    await fsyncDirectory(root);
  }
}

export async function atomicReplaceFile(targetPath, content, options = {}) {
  const absoluteTarget = path.resolve(targetPath);
  const directory = path.dirname(absoluteTarget);
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
  let current = null;
  try {
    current = await fsp.readFile(absoluteTarget);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (
    options.expectedContent !== undefined &&
    (current === null ||
      !current.equals(Buffer.from(options.expectedContent)))
  ) {
    fail(
      'PLAN_CONCURRENT_MODIFICATION',
      'File changed before atomic replacement',
      { path: absoluteTarget },
    );
  }
  const mode =
    current === null ? 0o600 : (await fsp.stat(absoluteTarget)).mode;
  const temporaryPath = path.join(
    directory,
    `.${path.basename(absoluteTarget)}.${process.pid}.${Date.now()}.${Math.random()
      .toString(16)
      .slice(2)}.tmp`,
  );
  let handle;
  try {
    handle = await fsp.open(temporaryPath, 'wx', mode);
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    handle = null;
    if (options.beforeAtomicCommit) await options.beforeAtomicCommit();
    if (current === null) {
      await atomicMoveFileNoReplace(temporaryPath, absoluteTarget);
    } else if (options.expectedContent !== undefined) {
      await atomicExchangeFiles(temporaryPath, absoluteTarget);
      const displaced = await fsp.readFile(temporaryPath);
      if (!displaced.equals(Buffer.from(options.expectedContent))) {
        await atomicExchangeFiles(temporaryPath, absoluteTarget);
        fail(
          'PLAN_CONCURRENT_MODIFICATION',
          'File changed before atomic replacement',
          { path: absoluteTarget },
        );
      }
      await fsp.rm(temporaryPath, { force: true });
      await fsyncDirectory(directory);
    } else {
      await fsp.rename(temporaryPath, absoluteTarget);
      await fsyncDirectory(directory);
    }
  } finally {
    if (handle) await handle.close();
    await fsp.rm(temporaryPath, { force: true });
  }
}

export async function discoverPlanPackages(root, options = {}) {
  const explicitRoot = options.repoRoot
    ? await fsp.realpath(path.resolve(options.repoRoot))
    : null;
  const searchRoot = await fsp.realpath(path.resolve(root));
  if (explicitRoot && !isNativePathInside(explicitRoot, searchRoot)) {
    fail(
      'PLAN_PATH_ESCAPE',
      'Discovery root is outside the explicit repository root',
      { root: searchRoot, repoRoot: explicitRoot },
    );
  }
  const repoRoot = explicitRoot ?? (await findRepoRoot(searchRoot));
  const planPaths = [];
  async function walk(directory) {
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (
        ['archive', '.git', 'node_modules', 'target', 'dist'].includes(
          entry.name,
        )
      ) {
        continue;
      }
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(candidate);
      } else if (entry.isFile() && entry.name === 'plan.md') {
        const text = await fsp.readFile(candidate, 'utf8');
        if (findStructuredBlocks(text, 'Plan').length > 0) {
          planPaths.push(candidate);
        }
      }
    }
  }
  await walk(searchRoot);
  const packages = [];
  for (const candidate of planPaths.sort()) {
    packages.push(
      await loadPlanPackage(candidate, { ...options, repoRoot }),
    );
  }
  return packages;
}

export function isDirectInvocation(importMetaUrl, argvPath = process.argv[1]) {
  if (!argvPath) return false;
  try {
    return (
      fs.realpathSync(path.resolve(argvPath)) ===
      fs.realpathSync(fileURLToPath(importMetaUrl))
    );
  } catch {
    return false;
  }
}
