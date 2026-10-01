#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  isDirectInvocation,
  machineDevRoot,
  workspaceIdForRoot,
} from '../lib/machine-dev-paths.mjs';
import {
  loadPlanPackage,
  renderPlanDocument,
} from '../plan/plan-package.mjs';
import {
  resolveWorkspacePlanBinding,
} from '../plan/workspace-plan-binding.mjs';
import { canonicalize } from './dev-work-schema.mjs';
import {
  loadSessionStore,
} from './dev-session-store.mjs';
import { inspectGitWorkspace } from './git-workspace.mjs';
import {
  createWorkflowBindingAssignment,
  readWorkflowProjectionByActor,
} from './workflow-binding-store.mjs';
import { readWorkspaceActions } from './workflow-action-store.mjs';

export const COMPLETION_REVIEW_CHECK_IDS = Object.freeze([
  'plan-task-schema',
  'declared-evidence',
  'changed-file-containment',
  'forbidden-reference-inventory',
  'docs-source-consistency',
  'required-check-results',
  'generated-evidence-trust',
]);

const REQUEST_KIND = 'peers-touch-completion-review-request';
const RECEIPT_KIND = 'peers-touch-completion-review-receipt';
const ASSESSMENT_KIND = 'peers-touch-completion-review-assessment';
const REVIEW_SCHEMA_VERSION = 1;
const REVIEW_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA = /^[0-9a-f]{40,64}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const WORKSPACE_DIGEST = /^(?:clean|sha256:[0-9a-f]{64})$/;
const REQUEST_KEYS = new Set([
  'schemaVersion',
  'kind',
  'reviewId',
  'scope',
  'planId',
  'taskId',
  'workItemId',
  'implementationSessionIds',
  'executorContextDigests',
  'ownerBindingDigest',
  'reviewerAssignmentDigest',
  'source',
  'obligationsDigest',
  'candidatePlanDigest',
  'evidenceDigest',
  'createdAt',
  'requestDigest',
]);
const RECEIPT_KEYS = new Set([
  'schemaVersion',
  'kind',
  'reviewId',
  'requestDigest',
  'reviewerContextDigest',
  'rootBindingDigest',
  'parentBindingDigest',
  'assignmentDigest',
  'verdict',
  'findings',
  'reviewedAt',
  'receiptDigest',
]);
const SOURCE_KEYS = new Set([
  'branch',
  'commit',
  'tree',
  'workspaceDigest',
]);
const FINDING_KEYS = new Set([
  'id',
  'blocking',
  'status',
  'evidenceRefs',
]);
const ASSESSMENT_KEYS = new Set([
  'schemaVersion',
  'kind',
  'findings',
]);
const SUCCESSFUL_SESSION_STATES = new Set([
  'SOURCE_READY',
  'DELIVERY_READY',
]);

export class CompletionReviewError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'CompletionReviewError';
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
  throw new CompletionReviewError(code, message, details);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return (
    isObject(value) &&
    Object.keys(value).length === keys.size &&
    Object.keys(value).every((key) => keys.has(key))
  );
}

function digest(value) {
  const bytes =
    Buffer.isBuffer(value) || typeof value === 'string'
      ? value
      : JSON.stringify(canonicalize(value));
  return createHash('sha256').update(bytes).digest('hex');
}

function withoutDigest(value, field) {
  const unsigned = { ...value };
  delete unsigned[field];
  return unsigned;
}

function validateTimestamp(value, field) {
  const parsed = Date.parse(value);
  if (
    typeof value !== 'string' ||
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString() !== value
  ) {
    fail('COMPLETION_REVIEW_INVALID', `${field} must be an ISO timestamp`);
  }
}

function requireIdentifier(value, field) {
  if (typeof value !== 'string' || !REVIEW_ID.test(value)) {
    fail('COMPLETION_REVIEW_INVALID', `${field} is invalid`, { field });
  }
  return value;
}

function validateUniqueIdentifiers(values, field) {
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.length > 64
  ) {
    fail('COMPLETION_REVIEW_INVALID', `${field} is invalid`, { field });
  }
  const normalized = values.map((value, index) =>
    requireIdentifier(value, `${field}[${index}]`));
  if (new Set(normalized).size !== normalized.length) {
    fail('COMPLETION_REVIEW_INVALID', `${field} contains duplicates`, { field });
  }
}

function validateDigestArray(values, field) {
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.length > 64 ||
    values.some((value) => !SHA256.test(value)) ||
    new Set(values).size !== values.length
  ) {
    fail('COMPLETION_REVIEW_INVALID', `${field} is invalid`, { field });
  }
}

function validateSource(source) {
  if (
    !hasExactKeys(source, SOURCE_KEYS) ||
    typeof source.branch !== 'string' ||
    source.branch.length === 0 ||
    !SHA.test(source.commit) ||
    !SHA.test(source.tree) ||
    !WORKSPACE_DIGEST.test(source.workspaceDigest)
  ) {
    fail('COMPLETION_REVIEW_INVALID', 'review source identity is invalid');
  }
}

function validateFinding(finding, index) {
  if (!hasExactKeys(finding, FINDING_KEYS)) {
    fail('COMPLETION_REVIEW_INVALID', 'review finding shape is invalid', {
      index,
    });
  }
  requireIdentifier(finding.id, `findings[${index}].id`);
  if (
    typeof finding.blocking !== 'boolean' ||
    !new Set(['OPEN', 'RESOLVED']).has(finding.status) ||
    !Array.isArray(finding.evidenceRefs) ||
    finding.evidenceRefs.length === 0 ||
    finding.evidenceRefs.length > 64 ||
    finding.evidenceRefs.some(
      (value) =>
        typeof value !== 'string' ||
        value.length === 0 ||
        value.length > 2048 ||
        value.includes('\0'),
    )
  ) {
    fail('COMPLETION_REVIEW_INVALID', 'review finding fields are invalid', {
      index,
    });
  }
}

function validateFindings(findings, requireChecklist = true) {
  if (!Array.isArray(findings) || findings.length === 0 || findings.length > 64) {
    fail('COMPLETION_REVIEW_INVALID', 'review findings are invalid');
  }
  findings.forEach(validateFinding);
  const ids = findings.map((finding) => finding.id);
  if (new Set(ids).size !== ids.length) {
    fail('COMPLETION_REVIEW_INVALID', 'review finding IDs must be unique');
  }
  if (
    requireChecklist &&
    COMPLETION_REVIEW_CHECK_IDS.some((id) => {
      const finding = findings.find((candidate) => candidate.id === id);
      return !finding || finding.blocking !== true;
    })
  ) {
    fail(
      'COMPLETION_REVIEW_INCOMPLETE',
      'review assessment omits or weakens a mandatory completeness check',
      {
        required: COMPLETION_REVIEW_CHECK_IDS,
        actual: ids,
      },
    );
  }
}

export function validateCompletionReviewRequest(request) {
  if (
    !hasExactKeys(request, REQUEST_KEYS) ||
    request.schemaVersion !== REVIEW_SCHEMA_VERSION ||
    request.kind !== REQUEST_KIND ||
    !new Set(['task', 'plan']).has(request.scope)
  ) {
    fail('COMPLETION_REVIEW_INVALID', 'completion review request is invalid');
  }
  requireIdentifier(request.reviewId, 'reviewId');
  requireIdentifier(request.planId, 'planId');
  requireIdentifier(request.workItemId, 'workItemId');
  if (
    (request.scope === 'task' &&
      (typeof request.taskId !== 'string' || !REVIEW_ID.test(request.taskId))) ||
    (request.scope === 'plan' && request.taskId !== null)
  ) {
    fail('COMPLETION_REVIEW_INVALID', 'request task scope is invalid');
  }
  validateUniqueIdentifiers(
    request.implementationSessionIds,
    'implementationSessionIds',
  );
  validateDigestArray(request.executorContextDigests, 'executorContextDigests');
  if (
    !SHA256.test(request.ownerBindingDigest) ||
    !SHA256.test(request.reviewerAssignmentDigest) ||
    !request.executorContextDigests.includes(request.ownerBindingDigest)
  ) {
    fail('COMPLETION_REVIEW_INVALID', 'request binding lineage is invalid');
  }
  validateSource(request.source);
  for (const field of [
    'obligationsDigest',
    'candidatePlanDigest',
    'evidenceDigest',
    'requestDigest',
  ]) {
    if (!SHA256.test(request[field])) {
      fail('COMPLETION_REVIEW_INVALID', `${field} is invalid`);
    }
  }
  validateTimestamp(request.createdAt, 'createdAt');
  if (digest(withoutDigest(request, 'requestDigest')) !== request.requestDigest) {
    fail('COMPLETION_REVIEW_INVALID', 'request digest does not match');
  }
  return request;
}

export function validateCompletionReviewReceipt(receipt) {
  if (
    !hasExactKeys(receipt, RECEIPT_KEYS) ||
    receipt.schemaVersion !== REVIEW_SCHEMA_VERSION ||
    receipt.kind !== RECEIPT_KIND ||
    !new Set(['PASS', 'FAIL']).has(receipt.verdict)
  ) {
    fail('COMPLETION_REVIEW_INVALID', 'completion review receipt is invalid');
  }
  requireIdentifier(receipt.reviewId, 'reviewId');
  for (const field of [
    'requestDigest',
    'reviewerContextDigest',
    'rootBindingDigest',
    'parentBindingDigest',
    'assignmentDigest',
    'receiptDigest',
  ]) {
    if (!SHA256.test(receipt[field])) {
      fail('COMPLETION_REVIEW_INVALID', `${field} is invalid`);
    }
  }
  validateFindings(receipt.findings);
  validateTimestamp(receipt.reviewedAt, 'reviewedAt');
  const derivedVerdict = receipt.findings.some(
    (finding) => finding.blocking && finding.status === 'OPEN',
  )
    ? 'FAIL'
    : 'PASS';
  if (receipt.verdict !== derivedVerdict) {
    fail('COMPLETION_REVIEW_INVALID', 'receipt verdict contradicts findings');
  }
  if (digest(withoutDigest(receipt, 'receiptDigest')) !== receipt.receiptDigest) {
    fail('COMPLETION_REVIEW_INVALID', 'receipt digest does not match');
  }
  return receipt;
}

function validateAssessment(assessment) {
  if (
    !hasExactKeys(assessment, ASSESSMENT_KEYS) ||
    assessment.schemaVersion !== REVIEW_SCHEMA_VERSION ||
    assessment.kind !== ASSESSMENT_KIND
  ) {
    fail('COMPLETION_REVIEW_INVALID', 'review assessment is invalid');
  }
  validateFindings(assessment.findings);
  return assessment;
}

function reviewRoot(workspaceId, dependencies = {}) {
  if (!/^[0-9a-f]{16}$/.test(workspaceId)) {
    fail('COMPLETION_REVIEW_INVALID', 'workspaceId is invalid');
  }
  return path.join(
    dependencies.machineRoot ?? machineDevRoot(),
    'workspaces',
    workspaceId,
    'workflow',
    'completion-reviews',
  );
}

export function completionReviewPaths(
  workspaceId,
  reviewId,
  dependencies = {},
) {
  requireIdentifier(reviewId, 'reviewId');
  const directory = path.join(reviewRoot(workspaceId, dependencies), reviewId);
  return {
    directory,
    request: path.join(directory, 'request.json'),
    receipt: path.join(directory, 'receipt.json'),
  };
}

function ownedByCurrentUser(metadata) {
  return typeof process.getuid !== 'function' || metadata.uid === process.getuid();
}

async function ensurePrivateDirectory(directory) {
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
  const metadata = await fsp.lstat(directory);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    !ownedByCurrentUser(metadata) ||
    (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0)
  ) {
    fail(
      'COMPLETION_REVIEW_STORE_INVALID',
      'review store directory is not owner-controlled',
      { directory },
    );
  }
}

async function syncDirectory(directory) {
  if (process.platform === 'win32') return;
  const handle = await fsp.open(directory, fs.constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function publishImmutable(file, value) {
  const directory = path.dirname(file);
  await ensurePrivateDirectory(directory);
  const bytes = Buffer.from(`${JSON.stringify(canonicalize(value), null, 2)}\n`);
  const temporary = path.join(
    directory,
    `.${path.basename(file)}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`,
  );
  let handle;
  try {
    handle = await fsp.open(temporary, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    try {
      await fsp.link(temporary, file);
      await syncDirectory(directory);
      return { created: true, value };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = await fsp.readFile(file);
      if (!existing.equals(bytes)) {
        fail(
          'COMPLETION_REVIEW_IMMUTABLE',
          'create-once review record already has different bytes',
          { file },
        );
      }
      return { created: false, value };
    }
  } finally {
    if (handle) await handle.close();
    await fsp.rm(temporary, { force: true });
  }
}

async function readOwnedJson(file, validator, required = true) {
  let metadata;
  try {
    metadata = await fsp.lstat(file);
  } catch (error) {
    if (error.code === 'ENOENT' && !required) return null;
    if (error.code === 'ENOENT') {
      fail('COMPLETION_REVIEW_UNAVAILABLE', 'review record is missing', { file });
    }
    throw error;
  }
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    !ownedByCurrentUser(metadata) ||
    (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) ||
    metadata.size > 128 * 1024
  ) {
    fail(
      'COMPLETION_REVIEW_STORE_INVALID',
      'review record is not an owner-controlled bounded file',
      { file },
    );
  }
  let value;
  try {
    value = JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (error) {
    fail('COMPLETION_REVIEW_INVALID', 'review record is not valid JSON', {
      file,
      cause: error.message,
    });
  }
  return validator(value);
}

async function loadBoundPlan(root, dependencies = {}) {
  if (typeof dependencies.loadPlanContext === 'function') {
    return dependencies.loadPlanContext(root);
  }
  const binding = await resolveWorkspacePlanBinding({ repoRoot: root });
  const planPath = path.resolve(root, ...binding.planPath.split('/'));
  return loadPlanPackage(planPath, { repoRoot: root });
}

function planRelativePath(planPackage) {
  return path
    .relative(planPackage.repoRoot, planPackage.path)
    .split(path.sep)
    .join('/');
}

function currentTaskEntry(planPackage) {
  const current = planPackage.manifest.tasks.find(
    (task) => task.status === 'in_progress',
  );
  if (!current || planPackage.currentTask?.taskId !== current.id) {
    fail(
      'COMPLETION_REVIEW_CONTEXT_INVALID',
      'review requires exactly one current Task',
    );
  }
  return current;
}

function expectedScope(planPackage, current) {
  return planPackage.manifest.tasks.every(
    (task) => task.id === current.id || task.status === 'done',
  )
    ? 'plan'
    : 'task';
}

function obligationsFor(planPackage, scope, taskId) {
  const selected =
    scope === 'plan'
      ? planPackage.manifest.tasks
      : planPackage.manifest.tasks.filter((task) => task.id === taskId);
  return {
    planId: planPackage.manifest.planId,
    scope,
    architecture: planPackage.manifest.architecture,
    planScope: planPackage.manifest.scope,
    workClass: planPackage.manifest.workClass,
    authorization: planPackage.manifest.authorization,
    tasks: selected.map((entry) => ({
      index: {
        id: entry.id,
        workstreamId: entry.workstreamId,
        path: entry.path,
        dependsOn: entry.dependsOn,
      },
      slice: planPackage.taskSlices.get(entry.id),
      gates: planPackage.acceptance.closures[
        planPackage.taskSlices.get(entry.id).closureId
      ],
    })),
    acceptance:
      scope === 'plan'
        ? planPackage.acceptance
        : {
            closures: Object.fromEntries(
              selected.map((entry) => {
                const closureId =
                  planPackage.taskSlices.get(entry.id).closureId;
                return [
                  closureId,
                  planPackage.acceptance.closures[closureId],
                ];
              }),
            ),
          },
  };
}

function evidenceFor(planPackage, scope, taskId, session) {
  const selected =
    scope === 'plan'
      ? planPackage.manifest.tasks
      : planPackage.manifest.tasks.filter((task) => task.id === taskId);
  return {
    implementationSession: session,
    taskEvidence: selected.map((entry) => ({
      taskId: entry.id,
      durableEvidence: planPackage.taskSlices.get(entry.id).durableEvidence,
    })),
  };
}

function assertSuccessfulSession(session, planPackage, current, workItemId) {
  const state = session?.state;
  const expectedState =
    planPackage.currentTask.completionClass === 'source'
      ? 'SOURCE_READY'
      : 'DELIVERY_READY';
  if (
    !isObject(session) ||
    !isObject(state) ||
    state.workItemId !== workItemId ||
    state.planId !== planPackage.manifest.planId ||
    state.taskId !== current.id ||
    state.workspaceId !== planPackage.manifest.binding.workspaceId ||
    state.branch !== planPackage.manifest.binding.branch ||
    !SUCCESSFUL_SESSION_STATES.has(state.state) ||
    state.state !== expectedState
  ) {
    fail(
      'COMPLETION_REVIEW_SESSION_INVALID',
      'review requires the current successful Development Session',
      {
        expectedState,
        actualState: state?.state ?? null,
      },
    );
  }
}

async function loadCurrentSession(
  root,
  planPackage,
  current,
  workItemId,
  dependencies,
) {
  if (typeof dependencies.loadSession === 'function') {
    return dependencies.loadSession({
      root,
      planPackage,
      current,
      workItemId,
    });
  }
  return loadSessionStore({
    workspaceRoot: root,
    workspaceId: planPackage.manifest.binding.workspaceId,
    workItemId,
    expected: {
      workItemId,
      planId: planPackage.manifest.planId,
      taskId: current.id,
      workspaceId: planPackage.manifest.binding.workspaceId,
      branch: planPackage.manifest.binding.branch,
    },
  });
}

async function inspectSource(root, planPackage, dependencies) {
  const inspect = dependencies.inspectWorkspace ?? inspectGitWorkspace;
  const planPath = planRelativePath(planPackage);
  const source = inspect(root, {
    excludePaths: [planPath],
    excludeGlobs: [`${planPath}.lock*`],
  });
  if (
    source.workspaceId !== planPackage.manifest.binding.workspaceId ||
    source.branch !== planPackage.manifest.binding.branch ||
    source.stable !== true
  ) {
    fail(
      'COMPLETION_REVIEW_SOURCE_INVALID',
      'review source does not match the bound stable workspace',
      {
        expectedWorkspaceId: planPackage.manifest.binding.workspaceId,
        actualWorkspaceId: source.workspaceId ?? null,
        expectedBranch: planPackage.manifest.binding.branch,
        actualBranch: source.branch ?? null,
        stable: source.stable ?? null,
      },
    );
  }
  return {
    branch: source.branch,
    commit: source.commit,
    tree: source.tree,
    workspaceDigest: source.workspaceDigest,
  };
}

async function planBytes(planPackage, dependencies) {
  if (typeof dependencies.readPlanBytes === 'function') {
    return dependencies.readPlanBytes(planPackage);
  }
  return fsp.readFile(planPackage.path);
}

function completionCandidateManifest(
  planPackage,
  requestedNextTaskId,
  recordedAt,
) {
  const manifest = structuredClone(planPackage.manifest);
  const current = manifest.tasks.find((task) => task.status === 'in_progress');
  if (!current) {
    fail(
      'COMPLETION_REVIEW_CONTEXT_INVALID',
      'completion candidate requires one current Task',
    );
  }
  current.status = 'done';
  current.blocker = null;
  const done = new Set(
    manifest.tasks
      .filter((task) => task.status === 'done')
      .map((task) => task.id),
  );
  const ready = manifest.tasks.filter(
    (task) =>
      task.status === 'pending' &&
      task.dependsOn.every((dependency) => done.has(dependency)),
  );
  if (manifest.tasks.every((task) => task.status === 'done')) {
    if (requestedNextTaskId !== undefined) {
      fail(
        'COMPLETION_REVIEW_CONTEXT_INVALID',
        'completed Plan candidate cannot select a successor',
      );
    }
    manifest.status = 'completed';
    manifest.exhaustion = null;
    return manifest;
  }
  let nextTaskId =
    requestedNextTaskId?.toLowerCase() === 'none'
      ? undefined
      : requestedNextTaskId;
  if (nextTaskId === undefined && ready.length === 1) {
    nextTaskId = ready[0].id;
  }
  const next = ready.find((task) => task.id === nextTaskId);
  if (!next) {
    const blocked = manifest.tasks.filter((task) => task.status === 'blocked');
    const evidenceRefs = [
      ...new Set(blocked.map((task) => task.blocker?.evidenceRef).filter(Boolean)),
    ];
    if (
      nextTaskId === undefined &&
      ready.length === 0 &&
      blocked.length > 0 &&
      manifest.architecture.decisions.length > 0 &&
      evidenceRefs.length > 0
    ) {
      validateTimestamp(recordedAt, 'completionCandidate.recordedAt');
      manifest.status = 'blocked';
      manifest.exhaustion = {
        recordedAt,
        blockedTaskIds: blocked.map((task) => task.id),
        decisionRefs: [...manifest.architecture.decisions],
        evidenceRefs,
      };
      return manifest;
    }
    fail(
      'COMPLETION_REVIEW_SUCCESSOR_REQUIRED',
      'review preparation requires the exact dependency-ready successor',
      {
        requestedNextTaskId: nextTaskId ?? null,
        readyTaskIds: ready.map((task) => task.id),
      },
    );
  }
  next.status = 'in_progress';
  next.blocker = null;
  manifest.status = 'active';
  manifest.exhaustion = null;
  return manifest;
}

export function digestCompletionCandidate(candidateDocument) {
  return digest(candidateDocument);
}

function describeCompletionCandidate(manifest) {
  return {
    to: 'done',
    nextTaskId:
      manifest.tasks.find((task) => task.status === 'in_progress')?.id ?? null,
    exhaustion: manifest.exhaustion,
  };
}

async function completionCandidate(
  planPackage,
  requestedNextTaskId,
  recordedAt,
  dependencies,
) {
  const currentDocument = (await planBytes(
    planPackage,
    dependencies,
  )).toString('utf8');
  const manifest = completionCandidateManifest(
    planPackage,
    requestedNextTaskId,
    recordedAt,
  );
  const candidate = renderPlanDocument(
    currentDocument,
    manifest,
  );
  return {
    digest: digestCompletionCandidate(candidate),
    transition: describeCompletionCandidate(manifest),
  };
}

async function currentReviewMaterial(options, dependencies = {}) {
  const root = await fsp.realpath(path.resolve(options.repoRoot ?? process.cwd()));
  const planPackage =
    options.planPackage ?? (await loadBoundPlan(root, dependencies));
  const current = currentTaskEntry(planPackage);
  const scope = expectedScope(planPackage, current);
  if (options.scope !== undefined && options.scope !== scope) {
    fail(
      'COMPLETION_REVIEW_SCOPE_MISMATCH',
      'review scope does not match the current completion boundary',
      { expected: scope, actual: options.scope },
    );
  }
  const workItemId = requireIdentifier(options.workItemId, 'workItemId');
  const session =
    options.session ??
    (await loadCurrentSession(
      root,
      planPackage,
      current,
      workItemId,
      dependencies,
    ));
  assertSuccessfulSession(session, planPackage, current, workItemId);
  const source = await inspectSource(root, planPackage, dependencies);
  const taskId = scope === 'task' ? current.id : null;
  const candidate =
    options.candidatePlanDigest === undefined
      ? await completionCandidate(
          planPackage,
          options.nextTaskId,
          session.state.updatedAt,
          dependencies,
        )
      : null;
  return {
    root,
    planPackage,
    current,
    scope,
    taskId,
    workItemId,
    session,
    source,
    obligationsDigest: digest(
      obligationsFor(planPackage, scope, taskId),
    ),
    candidatePlanDigest:
      options.candidatePlanDigest ??
      candidate.digest,
    candidateTransition: candidate?.transition ?? null,
    evidenceDigest: digest(
      evidenceFor(planPackage, scope, taskId, session),
    ),
  };
}

export function resolveCompletionReviewBinding(
  root,
  dependencies = {},
  context = null,
) {
  if (typeof dependencies.resolveBindingProjection === 'function') {
    return dependencies.resolveBindingProjection({
      root,
      context,
    });
  }
  if (!context?.workspaceId || !context?.ownerCommand) {
    fail(
      'COMPLETION_REVIEW_BINDING_REQUIRED',
      'Completion Review requires an exact owner-command context',
    );
  }
  const readActions =
    dependencies.readWorkspaceActions ?? readWorkspaceActions;
  const clock =
    typeof dependencies.clock === 'function'
      ? dependencies.clock()
      : new Date();
  const now = clock instanceof Date ? clock : new Date(clock);
  const latestByAction = new Map();
  for (const receipt of readActions({
    machineRoot: dependencies.machineRoot,
    workspaceId: context.workspaceId,
  })) {
    latestByAction.set(receipt.actionId, receipt);
  }
  const recent = [...latestByAction.values()]
    .filter(
      (receipt) =>
        receipt.operation.family === 'OWNER_CONTROL' &&
        receipt.operation.label === context.ownerCommand &&
        ['STARTED', 'HEARTBEAT'].includes(receipt.event) &&
        receipt.result === 'RUNNING' &&
        receipt.binding.workItemId === context.workItemId &&
        receipt.binding.planId === context.planId &&
        receipt.binding.taskId === context.taskId &&
        receipt.binding.sessionId === context.sessionId &&
        receipt.actor.role === context.expectedRole &&
        (context.assignmentDigest === undefined ||
          receipt.actor.assignmentDigest === context.assignmentDigest) &&
        receipt.leaseUntil !== null &&
        Date.parse(receipt.leaseUntil) >= now.getTime(),
    )
    .sort((left, right) => right.at.localeCompare(left.at));
  const selected = recent[0];
  if (!selected) {
    fail(
      'COMPLETION_REVIEW_BINDING_REQUIRED',
      'No live exact owner-command Action Receipt identifies this review action',
      {
        ownerCommand: context.ownerCommand,
        expectedRole: context.expectedRole,
      },
    );
  }
  const projection = (
    dependencies.readWorkflowProjectionByActor ??
    readWorkflowProjectionByActor
  )(selected.actor, {
    machineRoot: dependencies.machineRoot,
    now,
  });
  if (
    projection.bindingDigest !== selected.actor.bindingDigest ||
    projection.released ||
    (projection.role !== 'OWNER' && projection.childState !== 'LEASED')
  ) {
    fail(
      'COMPLETION_REVIEW_BINDING_INVALID',
      'Owner-command Action Receipt does not resolve to a current binding',
    );
  }
  return projection;
}

function assertBindingMatches(binding, material) {
  if (
    !isObject(binding) ||
    !SHA256.test(binding.bindingDigest ?? '') ||
    binding.executionRoot !== material.root ||
    binding.workspaceId !== material.planPackage.manifest.binding.workspaceId
  ) {
    fail(
      'COMPLETION_REVIEW_CONTEXT_INVALID',
      'conversation binding does not match the review workspace',
    );
  }
}

function operationTime(dependencies = {}) {
  const now =
    typeof dependencies.clock === 'function'
      ? dependencies.clock()
      : new Date();
  const value = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(value.getTime())) {
    fail('COMPLETION_REVIEW_INVALID', 'review clock is invalid');
  }
  return value.toISOString();
}

async function planImplementationContexts(material, dependencies = {}) {
  if (material.scope !== 'plan') {
    return {
      implementationSessionIds: [],
      executorContextDigests: [],
    };
  }
  if (typeof dependencies.planImplementationContexts === 'function') {
    return dependencies.planImplementationContexts(material);
  }
  const workspaceId = material.planPackage.manifest.binding.workspaceId;
  const reviewIds = await listReviewIds(workspaceId, dependencies);
  const implementationSessionIds = new Set();
  const executorContextDigests = new Set();
  for (const reviewId of reviewIds) {
    const record = await readCompletionReview(
      workspaceId,
      reviewId,
      dependencies,
    );
    if (
      record.request.planId !== material.planPackage.manifest.planId ||
      record.request.scope !== 'task'
    ) {
      continue;
    }
    for (const sessionId of record.request.implementationSessionIds) {
      implementationSessionIds.add(sessionId);
    }
    for (const digest of record.request.executorContextDigests) {
      executorContextDigests.add(digest);
    }
  }
  return {
    implementationSessionIds: [...implementationSessionIds].sort(),
    executorContextDigests: [...executorContextDigests].sort(),
  };
}

export async function prepareCompletionReview(options, dependencies = {}) {
  const material = await currentReviewMaterial(options, dependencies);
  const executorBinding = resolveCompletionReviewBinding(
    material.root,
    dependencies,
    {
      workspaceId: material.planPackage.manifest.binding.workspaceId,
      workItemId: material.workItemId,
      planId: material.planPackage.manifest.planId,
      taskId: material.current.id,
      sessionId: material.session.state.sessionId,
      ownerCommand: 'completion-review-prepare',
      expectedRole: 'OWNER',
    },
  );
  assertBindingMatches(executorBinding, material);
  const inheritedContexts = await planImplementationContexts(
    material,
    dependencies,
  );
  const reviewId =
    dependencies.reviewId ??
    `review-${randomBytes(16).toString('hex')}`;
  const assignmentResult = (
    dependencies.createWorkflowBindingAssignment ??
    createWorkflowBindingAssignment
  )(
    executorBinding,
    {
      assignmentId: reviewId,
      role: 'REVIEWER',
      workflowSessionId: material.session.state.sessionId,
      operationId: reviewId,
      leaseMs: dependencies.reviewerLeaseMs,
    },
    {
      machineRoot: dependencies.machineRoot,
      now: operationTime(dependencies),
    },
  );
  const unsigned = {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    kind: REQUEST_KIND,
    reviewId,
    scope: material.scope,
    planId: material.planPackage.manifest.planId,
    taskId: material.taskId,
    workItemId: material.workItemId,
    implementationSessionIds: [
      ...new Set([
        ...inheritedContexts.implementationSessionIds,
        material.session.state.sessionId,
      ]),
    ].sort(),
    executorContextDigests: [
      ...new Set([
        ...inheritedContexts.executorContextDigests,
        executorBinding.bindingDigest,
      ]),
    ].sort(),
    ownerBindingDigest: executorBinding.rootBindingDigest,
    reviewerAssignmentDigest: assignmentResult.assignment.digest,
    source: material.source,
    obligationsDigest: material.obligationsDigest,
    candidatePlanDigest: material.candidatePlanDigest,
    evidenceDigest: material.evidenceDigest,
    createdAt: operationTime(dependencies),
  };
  const request = {
    ...unsigned,
    requestDigest: digest(unsigned),
  };
  validateCompletionReviewRequest(request);
  const paths = completionReviewPaths(
    material.source.workspaceId ??
      material.planPackage.manifest.binding.workspaceId,
    request.reviewId,
    dependencies,
  );
  await publishImmutable(paths.request, request);
  return {
    request,
    paths,
    candidateTransition: material.candidateTransition,
  };
}

async function readAssessment(file) {
  if (typeof file !== 'string' || file.length === 0) {
    fail(
      'COMPLETION_REVIEW_INCOMPLETE',
      'review submission requires --assessment',
    );
  }
  return readOwnedJson(path.resolve(file), validateAssessment);
}

export async function readCompletionReview(
  workspaceId,
  reviewId,
  dependencies = {},
) {
  const paths = completionReviewPaths(workspaceId, reviewId, dependencies);
  const request = await readOwnedJson(
    paths.request,
    validateCompletionReviewRequest,
  );
  const receipt = await readOwnedJson(
    paths.receipt,
    validateCompletionReviewReceipt,
    false,
  );
  if (
    receipt !== null &&
    (receipt.reviewId !== request.reviewId ||
      receipt.requestDigest !== request.requestDigest ||
      receipt.rootBindingDigest !== request.ownerBindingDigest ||
      receipt.parentBindingDigest !== request.ownerBindingDigest ||
      receipt.assignmentDigest !== request.reviewerAssignmentDigest)
  ) {
    fail(
      'COMPLETION_REVIEW_INVALID',
      'review receipt does not belong to its request',
    );
  }
  return { request, receipt, paths };
}

function compareMaterial(request, material, options = {}) {
  const staleFields = [];
  if (
    request.source.branch !== material.source.branch ||
    request.source.commit !== material.source.commit ||
    request.source.tree !== material.source.tree ||
    request.source.workspaceDigest !== material.source.workspaceDigest
  ) {
    staleFields.push('source');
  }
  if (request.obligationsDigest !== material.obligationsDigest) {
    staleFields.push('obligations');
  }
  if (
    options.includeCandidate !== false &&
    request.candidatePlanDigest !== material.candidatePlanDigest
  ) {
    staleFields.push('candidatePlan');
  }
  if (
    options.includeEvidence !== false &&
    request.evidenceDigest !== material.evidenceDigest
  ) {
    staleFields.push('evidence');
  }
  return staleFields;
}

export function completionReviewState(record, material, options = {}) {
  if (compareMaterial(record.request, material, options).length > 0) {
    return 'STALE';
  }
  if (record.receipt === null) return 'PENDING';
  if (
    record.receipt.rootBindingDigest !==
      record.request.ownerBindingDigest ||
    record.receipt.parentBindingDigest !==
      record.request.ownerBindingDigest ||
    record.receipt.assignmentDigest !==
      record.request.reviewerAssignmentDigest ||
    record.request.executorContextDigests.includes(
      record.receipt.reviewerContextDigest,
    ) ||
    record.receipt.verdict === 'FAIL' ||
    record.receipt.findings.some(
      (finding) => finding.blocking && finding.status === 'OPEN',
    )
  ) {
    return 'FAIL';
  }
  return 'PASS';
}

function receiptMatchesSubmission(
  receipt,
  reviewerBinding,
  verdict,
  findings,
) {
  return (
    receipt.reviewerContextDigest === reviewerBinding.bindingDigest &&
    receipt.rootBindingDigest === reviewerBinding.rootBindingDigest &&
    receipt.parentBindingDigest === reviewerBinding.parentBindingDigest &&
    receipt.assignmentDigest === reviewerBinding.assignmentDigest &&
    receipt.verdict === verdict &&
    JSON.stringify(canonicalize(receipt.findings)) ===
      JSON.stringify(canonicalize(findings))
  );
}

export async function submitCompletionReview(options, dependencies = {}) {
  const root = await fsp.realpath(path.resolve(options.repoRoot ?? process.cwd()));
  const workspaceId = workspaceIdForRoot(root);
  const record = await readCompletionReview(
    workspaceId,
    requireIdentifier(options.reviewId, 'reviewId'),
    dependencies,
  );
  const material = await currentReviewMaterial(
    {
      repoRoot: root,
      workItemId: record.request.workItemId,
      scope: record.request.scope,
      nextTaskId: options.nextTaskId,
    },
    dependencies,
  );
  if (
    record.request.planId !== material.planPackage.manifest.planId ||
    record.request.taskId !== material.taskId
  ) {
    fail(
      'COMPLETION_REVIEW_CONTEXT_INVALID',
      'review request no longer identifies the current completion boundary',
    );
  }
  const staleFields = compareMaterial(record.request, material);
  if (staleFields.length > 0) {
    fail(
      'COMPLETION_REVIEW_STALE',
      'review request is stale before submission',
      { staleFields },
    );
  }
  const reviewerBinding = resolveCompletionReviewBinding(
    root,
    dependencies,
    {
      workspaceId: material.planPackage.manifest.binding.workspaceId,
      workItemId: material.workItemId,
      planId: material.planPackage.manifest.planId,
      taskId: material.current.id,
      sessionId: material.session.state.sessionId,
      ownerCommand: 'completion-review-submit',
      expectedRole: 'REVIEWER',
      assignmentDigest: record.request.reviewerAssignmentDigest,
    },
  );
  assertBindingMatches(reviewerBinding, material);
  if (
    record.request.executorContextDigests.includes(
      reviewerBinding.bindingDigest,
    )
  ) {
    fail(
      'COMPLETION_REVIEW_SELF_REVIEW',
      'implementation context cannot review its own completion',
    );
  }
  const assessment =
    dependencies.assessment ?? (await readAssessment(options.assessment));
  validateAssessment(assessment);
  const verdict = assessment.findings.some(
    (finding) => finding.blocking && finding.status === 'OPEN',
  )
    ? 'FAIL'
    : 'PASS';
  if (options.verdict !== undefined && options.verdict !== verdict) {
    fail(
      'COMPLETION_REVIEW_VERDICT_MISMATCH',
      'requested verdict contradicts the assessment',
      { expected: verdict, actual: options.verdict },
    );
  }
  if (record.receipt !== null) {
    if (!receiptMatchesSubmission(
      record.receipt,
      reviewerBinding,
      verdict,
      assessment.findings,
    )) {
      fail(
        'COMPLETION_REVIEW_IMMUTABLE',
        'existing review receipt conflicts with the new submission',
        { reviewId: record.request.reviewId },
      );
    }
    return { ...record, created: false };
  }
  const unsigned = {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    kind: RECEIPT_KIND,
    reviewId: record.request.reviewId,
    requestDigest: record.request.requestDigest,
    reviewerContextDigest: reviewerBinding.bindingDigest,
    rootBindingDigest: reviewerBinding.rootBindingDigest,
    parentBindingDigest: reviewerBinding.parentBindingDigest,
    assignmentDigest: reviewerBinding.assignmentDigest,
    verdict,
    findings: assessment.findings,
    reviewedAt: operationTime(dependencies),
  };
  const receipt = {
    ...unsigned,
    receiptDigest: digest(unsigned),
  };
  validateCompletionReviewReceipt(receipt);
  let published;
  try {
    published = await publishImmutable(record.paths.receipt, receipt);
  } catch (error) {
    if (
      !(error instanceof CompletionReviewError) ||
      error.code !== 'COMPLETION_REVIEW_IMMUTABLE'
    ) {
      throw error;
    }
    const winner = await readCompletionReview(
      workspaceId,
      record.request.reviewId,
      dependencies,
    );
    if (
      winner.receipt === null ||
      !receiptMatchesSubmission(
        winner.receipt,
        reviewerBinding,
        verdict,
        assessment.findings,
      )
    ) {
      throw error;
    }
    return { ...winner, created: false };
  }
  return {
    request: record.request,
    receipt,
    paths: record.paths,
    created: published.created,
  };
}

async function listReviewIds(workspaceId, dependencies = {}) {
  const root = reviewRoot(workspaceId, dependencies);
  let entries;
  try {
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isDirectory() && REVIEW_ID.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function matchingReviewRecords(material, dependencies = {}) {
  const workspaceId = material.planPackage.manifest.binding.workspaceId;
  const ids = await listReviewIds(workspaceId, dependencies);
  const records = [];
  for (const reviewId of ids) {
    const record = await readCompletionReview(
      workspaceId,
      reviewId,
      dependencies,
    );
    if (
      record.request.planId === material.planPackage.manifest.planId &&
      record.request.workItemId === material.workItemId &&
      record.request.scope === material.scope &&
      record.request.taskId === material.taskId
    ) {
      records.push(record);
    }
  }
  return records;
}

async function historicalReviewRecords(
  planPackage,
  workItemId,
  scope,
  taskId,
  dependencies = {},
) {
  const workspaceId = planPackage.manifest.binding.workspaceId;
  const ids = await listReviewIds(workspaceId, dependencies);
  const records = [];
  for (const reviewId of ids) {
    const record = await readCompletionReview(
      workspaceId,
      reviewId,
      dependencies,
    );
    if (
      record.request.planId === planPackage.manifest.planId &&
      record.request.workItemId === workItemId &&
      record.request.scope === scope &&
      record.request.taskId === taskId
    ) {
      records.push(record);
    }
  }
  return records;
}

export async function requireCurrentCompletionReview(
  options,
  dependencies = {},
) {
  const material = await currentReviewMaterial(options, dependencies);
  const records = await matchingReviewRecords(material, dependencies);
  const states = records.map((record) => ({
    reviewId: record.request.reviewId,
    state: completionReviewState(record, material),
  }));
  const passing = states.find((entry) => entry.state === 'PASS');
  if (!passing) {
    fail(
      'COMPLETION_REVIEW_REQUIRED',
      'Task or Plan completion requires a current independent PASS review',
      {
        planId: material.planPackage.manifest.planId,
        taskId: material.taskId,
        scope: material.scope,
        reviews: states,
      },
    );
  }
  return {
    reviewId: passing.reviewId,
    scope: material.scope,
    taskId: material.taskId,
    state: 'PASS',
  };
}

function historicalReviewPasses(record, source, obligationsDigest) {
  if (record.receipt === null) return false;
  const material = {
    source,
    obligationsDigest,
    candidatePlanDigest: record.request.candidatePlanDigest,
    evidenceDigest: record.request.evidenceDigest,
  };
  return (
    completionReviewState(record, material, {
      includeCandidate: false,
      includeEvidence: false,
    }) === 'PASS'
  );
}

function topologicalTasks(tasks) {
  const index = new Map(tasks.map((task, position) => [task.id, position]));
  const remaining = new Map(
    tasks.map((task) => [task.id, new Set(task.dependsOn)]),
  );
  const ordered = [];
  while (remaining.size > 0) {
    const ready = tasks
      .filter(
        (task) =>
          remaining.has(task.id) && remaining.get(task.id).size === 0,
      )
      .sort((left, right) => index.get(left.id) - index.get(right.id));
    if (ready.length === 0) {
      fail(
        'COMPLETION_REVIEW_CONTEXT_INVALID',
        'Plan dependency graph cannot be ordered',
      );
    }
    for (const task of ready) {
      ordered.push(task);
      remaining.delete(task.id);
      for (const dependencies of remaining.values()) {
        dependencies.delete(task.id);
      }
    }
  }
  return ordered;
}

export async function findEarliestInvalidCompletionReview(
  options,
  dependencies = {},
) {
  const root = await fsp.realpath(path.resolve(options.repoRoot ?? process.cwd()));
  const planPackage =
    options.planPackage ?? (await loadBoundPlan(root, dependencies));
  const workItemId = requireIdentifier(options.workItemId, 'workItemId');
  const source = await inspectSource(root, planPackage, dependencies);
  const planObligations = digest(obligationsFor(planPackage, 'plan', null));
  const planRecords = await historicalReviewRecords(
    planPackage,
    workItemId,
    'plan',
    null,
    dependencies,
  );
  if (
    planRecords.some((record) =>
      historicalReviewPasses(record, source, planObligations))
  ) {
    return null;
  }

  for (const task of topologicalTasks(planPackage.manifest.tasks)) {
    if (task.status !== 'done') continue;
    const obligationsDigest = digest(
      obligationsFor(planPackage, 'task', task.id),
    );
    const records = await historicalReviewRecords(
      planPackage,
      workItemId,
      'task',
      task.id,
      dependencies,
    );
    if (
      !records.some((record) =>
        historicalReviewPasses(record, source, obligationsDigest))
    ) {
      return {
        taskId: task.id,
        source,
        obligationsDigest,
        reviews: records.map((record) => ({
          reviewId: record.request.reviewId,
          state:
            record.receipt === null
              ? 'PENDING'
              : completionReviewState(
                  record,
                  {
                    source,
                    obligationsDigest,
                    candidatePlanDigest: record.request.candidatePlanDigest,
                    evidenceDigest: record.request.evidenceDigest,
                  },
                  {
                    includeCandidate: false,
                    includeEvidence: false,
                  },
                ),
        })),
      };
    }
  }
  return null;
}

export async function inspectForbiddenPathInventory(
  repoRoot,
  forbiddenPaths,
) {
  const root = await fsp.realpath(path.resolve(repoRoot));
  if (
    !Array.isArray(forbiddenPaths) ||
    forbiddenPaths.length === 0 ||
    forbiddenPaths.length > 256
  ) {
    fail(
      'COMPLETION_REVIEW_INVALID',
      'forbidden path inventory must be a bounded non-empty array',
    );
  }
  const present = [];
  for (const value of forbiddenPaths) {
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      path.isAbsolute(value) ||
      value.split('/').some((segment) => segment === '.' || segment === '..')
    ) {
      fail(
        'COMPLETION_REVIEW_INVALID',
        'forbidden inventory path must be repository-relative',
        { path: value },
      );
    }
    const relative = path.posix.normalize(value.replaceAll('\\', '/'));
    const absolute = path.resolve(root, ...relative.split('/'));
    const contained = path.relative(root, absolute);
    if (
      contained === '..' ||
      contained.startsWith(`..${path.sep}`) ||
      path.isAbsolute(contained)
    ) {
      fail(
        'COMPLETION_REVIEW_INVALID',
        'forbidden inventory path escapes the repository',
        { path: value },
      );
    }
    try {
      await fsp.lstat(absolute);
      present.push(relative);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return {
    id: 'forbidden-reference-inventory',
    blocking: true,
    status: present.length === 0 ? 'RESOLVED' : 'OPEN',
    evidenceRefs:
      present.length === 0
        ? ['review://forbidden-reference-inventory/empty']
        : present.map((relative) => `repo://${relative}`),
  };
}

function assessmentForSelfTest(openForbiddenFinding) {
  return {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    kind: ASSESSMENT_KIND,
    findings: COMPLETION_REVIEW_CHECK_IDS.map((id) => ({
      id,
      blocking: true,
      status:
        id === 'forbidden-reference-inventory' && openForbiddenFinding
          ? 'OPEN'
          : 'RESOLVED',
      evidenceRefs: [
        id === 'forbidden-reference-inventory' && openForbiddenFinding
          ? 'fixture://social/legacy-route'
          : `self-test://${id}`,
      ],
    })),
  };
}

export async function runCompletionReviewSelfTest() {
  const requestUnsigned = {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    kind: REQUEST_KIND,
    reviewId: 'review-self-test',
    scope: 'task',
    planId: 'DWF-SELF-TEST',
    taskId: 'TASK-A',
    workItemId: 'WORK-A',
    implementationSessionIds: ['SESSION-A'],
    executorContextDigests: ['a'.repeat(64)],
    ownerBindingDigest: 'a'.repeat(64),
    reviewerAssignmentDigest: '3'.repeat(64),
    source: {
      branch: 'test',
      commit: 'b'.repeat(40),
      tree: 'c'.repeat(40),
      workspaceDigest: `sha256:${'d'.repeat(64)}`,
    },
    obligationsDigest: 'e'.repeat(64),
    candidatePlanDigest: 'f'.repeat(64),
    evidenceDigest: '1'.repeat(64),
    createdAt: '2026-09-26T00:00:00.000Z',
  };
  const request = {
    ...requestUnsigned,
    requestDigest: digest(requestUnsigned),
  };
  validateCompletionReviewRequest(request);
  const fixture = JSON.parse(
    await fsp.readFile(
      new URL('./fixtures/completion-review-social.json', import.meta.url),
      'utf8',
    ),
  );
  const temporary = await fsp.realpath(
    await fsp.mkdtemp(path.join(os.tmpdir(), 'completion-review-self-test-')),
  );
  let assessment;
  try {
    for (const relative of fixture.omittedLegacyPaths) {
      const target = path.join(temporary, ...relative.split('/'));
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, 'legacy\n');
    }
    const forbiddenFinding = await inspectForbiddenPathInventory(
      temporary,
      fixture.omittedLegacyPaths,
    );
    assessment = assessmentForSelfTest(false);
    assessment.findings = assessment.findings.map((finding) =>
      finding.id === forbiddenFinding.id ? forbiddenFinding : finding);
  } finally {
    await fsp.rm(temporary, { recursive: true, force: true });
  }
  validateAssessment(assessment);
  const verdict = assessment.findings.some(
    (finding) => finding.blocking && finding.status === 'OPEN',
  )
    ? 'FAIL'
    : 'PASS';
  if (verdict !== fixture.expectedVerdict) {
    fail(
      'COMPLETION_REVIEW_SELF_TEST_FAILED',
      'Social omission fixture did not produce the expected verdict',
    );
  }
  const receiptUnsigned = {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    kind: RECEIPT_KIND,
    reviewId: request.reviewId,
    requestDigest: request.requestDigest,
    reviewerContextDigest: '2'.repeat(64),
    rootBindingDigest: request.ownerBindingDigest,
    parentBindingDigest: request.ownerBindingDigest,
    assignmentDigest: request.reviewerAssignmentDigest,
    verdict,
    findings: assessment.findings,
    reviewedAt: '2026-09-26T00:00:01.000Z',
  };
  const receipt = {
    ...receiptUnsigned,
    receiptDigest: digest(receiptUnsigned),
  };
  validateCompletionReviewReceipt(receipt);
  return {
    ok: true,
    checks: {
      requestDigest: 'PASS',
      independentReviewer: request.executorContextDigests.includes(
        receipt.reviewerContextDigest,
      )
        ? 'FAIL'
        : 'PASS',
      socialLegacyOmission: receipt.verdict === 'FAIL' ? 'PASS' : 'FAIL',
      mandatoryChecklist:
        receipt.findings.length >= COMPLETION_REVIEW_CHECK_IDS.length
          ? 'PASS'
          : 'FAIL',
    },
  };
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  if (!command) fail('COMPLETION_REVIEW_USAGE', 'command is required');
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--') || token === '--') {
      fail('COMPLETION_REVIEW_USAGE', 'unexpected positional argument', {
        argument: token,
      });
    }
    const key = token.slice(2);
    const value = rest[index + 1];
    if (value === undefined || value.startsWith('--')) {
      fail('COMPLETION_REVIEW_USAGE', `--${key} requires a value`);
    }
    if (Object.hasOwn(options, key)) {
      fail('COMPLETION_REVIEW_USAGE', `--${key} may appear only once`);
    }
    options[key] = value;
    index += 1;
  }
  return { command, options };
}

function allowedOptions(options, allowed) {
  const accepted = new Set(allowed);
  const unknown = Object.keys(options).filter((key) => !accepted.has(key));
  if (unknown.length > 0) {
    fail('COMPLETION_REVIEW_USAGE', 'unknown command option', { unknown });
  }
}

function requiredOption(options, key) {
  const value = options[key];
  if (typeof value !== 'string' || value.length === 0) {
    fail('COMPLETION_REVIEW_USAGE', `--${key} is required`);
  }
  return value;
}

export async function statusCompletionReviews(options, dependencies = {}) {
  const root = await fsp.realpath(path.resolve(options.repoRoot ?? process.cwd()));
  const planPackage = await loadBoundPlan(root, dependencies);
  const current = currentTaskEntry(planPackage);
  const scope = expectedScope(planPackage, current);
  const taskId = scope === 'task' ? current.id : null;
  const workItemId = requireIdentifier(options.workItemId, 'workItemId');
  const workspaceId = planPackage.manifest.binding.workspaceId;
  const ids = await listReviewIds(workspaceId, dependencies);
  const reviews = [];
  let material;
  let materialError = null;
  try {
    material = await currentReviewMaterial(
      { repoRoot: root, workItemId, scope },
      dependencies,
    );
  } catch (error) {
    if (
      !(error instanceof CompletionReviewError) &&
      !String(error?.code ?? '').startsWith('SESSION_')
    ) {
      throw error;
    }
    materialError = error;
  }
  for (const reviewId of ids) {
    const record = await readCompletionReview(
      workspaceId,
      reviewId,
      dependencies,
    );
    if (
      record.request.planId !== planPackage.manifest.planId ||
      record.request.workItemId !== workItemId
    ) {
      continue;
    }
    const isCurrent =
      record.request.scope === scope && record.request.taskId === taskId;
    reviews.push({
      reviewId,
      scope: record.request.scope,
      taskId: record.request.taskId,
      createdAt: record.request.createdAt,
      state:
        isCurrent && material
          ? completionReviewState(record, material)
          : isCurrent && materialError
            ? 'STALE'
            : record.receipt?.verdict ?? 'PENDING',
      reviewedAt: record.receipt?.reviewedAt ?? null,
    });
  }
  const currentReviews = reviews
    .filter(
      (review) => review.scope === scope && review.taskId === taskId,
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return {
    ok: true,
    planId: planPackage.manifest.planId,
    current: { scope, taskId },
    state:
      currentReviews.find((review) => review.state === 'PASS')?.state ??
      currentReviews[0]?.state ??
      'MISSING',
    materialError:
      materialError === null
        ? null
        : {
            code: materialError.code,
            message: materialError.message,
          },
    reviews,
  };
}

export async function runCompletionReviewCli(
  argv = process.argv.slice(2),
  dependencies = {},
) {
  const { command, options } = parseArguments(argv);
  if (command === 'prepare') {
    allowedOptions(options, ['repo-root', 'work-item', 'scope', 'next']);
    const result = await prepareCompletionReview(
      {
        repoRoot: options['repo-root'],
        workItemId: requiredOption(options, 'work-item'),
        scope: options.scope,
        nextTaskId: options.next,
      },
      dependencies,
    );
    return {
      ok: true,
      action: 'prepare',
      request: result.request,
      candidateTransition: result.candidateTransition,
    };
  }
  if (command === 'submit') {
    allowedOptions(options, [
      'repo-root',
      'review',
      'verdict',
      'assessment',
      'next',
    ]);
    const result = await submitCompletionReview(
      {
        repoRoot: options['repo-root'],
        reviewId: requiredOption(options, 'review'),
        verdict: requiredOption(options, 'verdict'),
        assessment: requiredOption(options, 'assessment'),
        nextTaskId: options.next,
      },
      dependencies,
    );
    return {
      ok: true,
      action: 'submit',
      created: result.created,
      receipt: result.receipt,
    };
  }
  if (command === 'status') {
    allowedOptions(options, ['repo-root', 'work-item']);
    return statusCompletionReviews(
      {
        repoRoot: options['repo-root'],
        workItemId: requiredOption(options, 'work-item'),
      },
      dependencies,
    );
  }
  if (command === 'self-test') {
    allowedOptions(options, ['repo-root']);
    return runCompletionReviewSelfTest();
  }
  fail('COMPLETION_REVIEW_USAGE', 'unknown command', {
    command,
    commands: ['prepare', 'submit', 'status', 'self-test'],
  });
}

async function main() {
  try {
    const result = await runCompletionReviewCli();
    process.stdout.write(`${JSON.stringify(canonicalize(result), null, 2)}\n`);
  } catch (error) {
    const typed =
      error instanceof CompletionReviewError
        ? error
        : new CompletionReviewError(
            'COMPLETION_REVIEW_INTERNAL_ERROR',
            error?.message ?? String(error),
          );
    process.stderr.write(`${JSON.stringify(typed.toJSON())}\n`);
    process.exitCode = 1;
  }
}

if (isDirectInvocation(import.meta.url)) {
  await main();
}
