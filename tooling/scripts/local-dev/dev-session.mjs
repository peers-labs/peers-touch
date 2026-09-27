#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';

import {
  isDirectInvocation,
  repoRoot,
  workspaceRuntimePath,
  workspaceWorkflowPath,
  workspaceIdForRoot,
} from '../lib/machine-dev-paths.mjs';
import { loadPlanPackage } from '../plan/plan-package.mjs';
import { resolveWorkspacePlanBinding } from '../plan/workspace-plan-binding.mjs';
import { canonicalize, isObject } from './dev-work-schema.mjs';
import { requireActiveDeclaration } from './dev-work-ledger.mjs';
import {
  DevSessionError,
  createInitialSessionState,
  sessionFail,
} from './dev-session-schema.mjs';
import {
  createSessionStore,
  loadSessionStore,
  readSessionJournal,
  sessionStorePaths,
  transitionSessionSequenceStore,
  transitionSessionStore,
  writeDurableFileAtomic,
} from './dev-session-store.mjs';

export {
  DevSessionError,
  createInitialSessionState,
  digestEvent,
  transitionSessionState,
  validateSession,
  validateSessionState,
  validateTransitionEvent,
} from './dev-session-schema.mjs';
export {
  MAX_SESSION_EVENTS,
  MAX_SESSION_EVENT_BYTES,
  createTransitionEvent,
  createSessionStore,
  loadSessionStore,
  readSessionJournal,
  sessionStorePaths,
  transitionSessionSequenceStore,
  transitionSessionStore,
  writeDurableFileAtomic,
} from './dev-session-store.mjs';

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

function asSessionError(error) {
  if (error instanceof DevSessionError) return error;
  if (typeof error?.code === 'string') {
    return new DevSessionError(
      error.code,
      error.message ?? String(error),
      error.detail ?? error.details ?? {},
    );
  }
  return error;
}

function segmentContains(prefix, candidate) {
  return candidate === prefix || candidate.startsWith(`${prefix}/`);
}

function assertDeclarationScope(declaration, task) {
  for (const target of task.writeSet) {
    const covered = declaration.sourceClaims.some(
      (claim) =>
        claim.mode === 'exclusive-write' &&
        segmentContains(claim.pathPrefix, target),
    );
    if (!covered) {
      sessionFail(
        'SESSION_SCOPE_MISMATCH',
        'Task writeSet escapes the ACTIVE declaration',
        { taskId: task.taskId, path: target },
      );
    }
  }
}

function repositoryRelative(root, target) {
  return path.relative(root, target).split(path.sep).join('/');
}

function assertPlanAndDeclaration(
  options,
  plan,
  declaration,
  workspacePlanBinding,
) {
  const { manifest, currentTask } = plan;
  if (manifest.status !== 'active' || currentTask === null) {
    sessionFail(
      'SESSION_PLAN_INVALID',
      'Session requires an active package with one current Task',
      { planId: manifest.planId, status: manifest.status },
    );
  }
  const currentEntries = manifest.tasks.filter(
    (task) => task.status === 'in_progress',
  );
  if (
    currentEntries.length !== 1 ||
    currentEntries[0].id !== currentTask.taskId
  ) {
    sessionFail(
      'SESSION_PLAN_INVALID',
      'manifest current Task does not match the loaded Task Slice',
    );
  }
  if (options.taskId !== undefined && currentTask.taskId !== options.taskId) {
    sessionFail('SESSION_IDENTITY_MISMATCH', 'requested Task is not current', {
      requested: options.taskId,
      current: currentTask.taskId,
    });
  }
  if (currentTask.planId !== manifest.planId) {
    sessionFail(
      'SESSION_IDENTITY_MISMATCH',
      'current Task does not match its Plan Package',
    );
  }
  if (
    options.journeyId !== undefined &&
    options.journeyId !== currentTask.journeyId
  ) {
    sessionFail('SESSION_IDENTITY_MISMATCH', 'requested Journey is not current', {
      requested: options.journeyId,
      current: currentTask.journeyId,
    });
  }
  const binding = manifest.binding;
  const planPath = repositoryRelative(plan.repoRoot, plan.path);
  const mismatches = {};
  for (const [field, actual] of [
    ['workspaceId', declaration.workspaceId],
    ['branch', declaration.branch],
  ]) {
    if (binding[field] !== actual) {
      mismatches[field] = { expected: binding[field], actual };
    }
  }
  for (const [field, expected, actual] of [
    ['declarationPlanId', manifest.planId, declaration.planId],
    ['declarationPlanPath', planPath, declaration.planPath],
    ['declarationTaskId', currentTask.taskId, declaration.taskId],
    ['boundPlanId', manifest.planId, workspacePlanBinding.planId],
    ['boundPlanPath', planPath, workspacePlanBinding.planPath],
  ]) {
    if (expected !== actual) {
      mismatches[field] = { expected, actual };
    }
  }
  if (
    declaration.journeyId !== null &&
    declaration.journeyId !== currentTask.journeyId
  ) {
    mismatches.journeyId = {
      expected: currentTask.journeyId,
      actual: declaration.journeyId,
    };
  }
  if (
    options.sessionId !== undefined &&
    options.sessionId !== declaration.sessionId
  ) {
    mismatches.sessionId = {
      expected: declaration.sessionId,
      actual: options.sessionId,
    };
  }
  if (Object.keys(mismatches).length > 0) {
    sessionFail(
      'SESSION_IDENTITY_MISMATCH',
      'Plan, declaration, and Session identity do not match',
      { mismatches },
    );
  }
  assertDeclarationScope(declaration, currentTask);
}

function defaultBindingVerifier({ repoRoot: root, binding, sourceHead }) {
  const verifier = path.join(root, 'tooling', 'scripts', 'verify-worktree-binding.py');
  let output;
  try {
    output = execFileSync(
      'python3',
      [
        verifier,
        '--root',
        root,
        '--branch',
        binding.branch,
        '--workspace-id',
        binding.workspaceId,
        '--head',
        sourceHead,
      ],
      {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  } catch (error) {
    sessionFail(
      'WORKTREE_IDENTITY_MISMATCH',
      'Plan identity and declared source HEAD do not match the worktree',
      { cause: error?.stderr?.trim?.() || String(error) },
    );
  }
  try {
    return JSON.parse(output);
  } catch (error) {
    sessionFail(
      'WORKTREE_IDENTITY_UNAVAILABLE',
      'worktree verifier returned invalid output',
      { cause: String(error) },
    );
  }
}

async function loadBoundContext(options, dependencies = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? repoRoot);
  let declaration;
  let plan;
  let workspacePlanBinding;
  try {
    declaration = requireActiveDeclaration({
      home: options.home,
      workspaceRoot,
      workItemId: options.workItemId,
      sessionId: options.sessionId,
      clock: options.clock,
      now: options.now,
      lockTimeoutMs: options.lockTimeoutMs,
    });
    const loader = dependencies.loadPlanPackage ?? loadPlanPackage;
    const planPath = options.planPath ?? declaration.planPath;
    plan = await loader(planPath, {
      repoRoot: workspaceRoot,
      declaration,
    });
    const resolvePlanBinding =
      dependencies.resolveWorkspacePlanBinding ?? resolveWorkspacePlanBinding;
    workspacePlanBinding = await resolvePlanBinding({
      repoRoot: workspaceRoot,
      home: options.home,
    });
  } catch (error) {
    throw asSessionError(error);
  }
  assertPlanAndDeclaration(
    options,
    plan,
    declaration,
    workspacePlanBinding,
  );
  const verifyBinding = dependencies.verifyBinding ?? defaultBindingVerifier;
  const verified = await verifyBinding({
    repoRoot: plan.repoRoot,
    binding: plan.manifest.binding,
    sourceHead: declaration.sourceHead,
  });
  if (
    verified?.workspaceId !== plan.manifest.binding.workspaceId ||
    verified?.branch !== plan.manifest.binding.branch ||
    verified?.head !== declaration.sourceHead
  ) {
    sessionFail(
      'WORKTREE_IDENTITY_MISMATCH',
      'worktree verifier result does not match Plan identity and declared source HEAD',
      {
        binding: plan.manifest.binding,
        sourceHead: declaration.sourceHead,
        verified,
      },
    );
  }
  return { declaration, plan, workspaceRoot };
}

function storeOptions(options, workspaceId) {
  return {
    home: options.home,
    workspaceRoot: options.workspaceRoot ?? repoRoot,
    workspaceId,
    workItemId: options.workItemId,
    clock: options.clock,
    now: options.now,
    lockTimeoutMs: options.lockTimeoutMs,
    maxEvents: options.maxEvents,
    maxBytes: options.maxBytes,
  };
}

export async function startDevelopmentSession(options, dependencies = {}) {
  if (typeof options.taskId !== 'string' || typeof options.journeyId !== 'string') {
    sessionFail('INVALID_ARGUMENT', 'start requires --task and --journey');
  }
  const { declaration, plan, workspaceRoot } = await loadBoundContext(
    options,
    dependencies,
  );
  const at = operationDate(options).toISOString();
  const state = createInitialSessionState(
    {
      sessionId: declaration.sessionId,
      workItemId: declaration.workItemId,
      planId: plan.manifest.planId,
      taskId: plan.currentTask.taskId,
      workspaceId: plan.manifest.binding.workspaceId,
      branch: plan.manifest.binding.branch,
      journeyId: plan.currentTask.journeyId,
      executionMode: plan.currentTask.executionMode,
    },
    at,
  );
  return createSessionStore(state, {
    ...storeOptions({ ...options, workspaceRoot }, state.workspaceId),
    reason: options.reason ?? 'Bound ACTIVE declaration to current Task',
  });
}

export function statusDevelopmentSession(options) {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? repoRoot);
  const workspaceId = options.workspaceId ?? workspaceIdForRoot(workspaceRoot);
  return loadSessionStore({
    ...storeOptions({ ...options, workspaceRoot }, workspaceId),
    expected: {
      workItemId: options.workItemId,
      workspaceId,
      sessionId: options.sessionId,
      planId: options.planId,
      taskId: options.taskId,
      branch: options.branch,
    },
  });
}

export async function transitionDevelopmentSession(options, dependencies = {}) {
  if (options.to === 'FUNCTIONAL_PASS') {
    sessionFail(
      'SESSION_OWNER_COMMAND_REQUIRED',
      'FUNCTIONAL_PASS must be committed by the owner-run Development runner',
    );
  }
  const { declaration, plan, workspaceRoot } = await loadBoundContext(
    options,
    dependencies,
  );
  return transitionSessionStore({
    ...storeOptions(
      { ...options, workspaceRoot },
      plan.manifest.binding.workspaceId,
    ),
    expected: {
      sessionId: declaration.sessionId,
      workItemId: declaration.workItemId,
      planId: plan.manifest.planId,
      taskId: plan.currentTask.taskId,
      workspaceId: plan.manifest.binding.workspaceId,
      branch: plan.manifest.binding.branch,
    },
    to: options.to,
    reason: options.reason,
    updates: options.updates ?? {},
    context: {
      task: plan.currentTask,
      acceptance: plan.acceptance,
      authorization: plan.manifest.authorization,
    },
  });
}

function functionalPassTransitions(
  current,
  options,
  context,
  declaration,
  plan,
  runnerResult,
) {
  if (
    typeof options.reason !== 'string' ||
    options.reason.trim() !== options.reason ||
    options.reason.length === 0
  ) {
    sessionFail('INVALID_ARGUMENT', 'functional result commit requires a reason');
  }
  const updates = functionalResultUpdates(
    current,
    options,
    declaration,
    plan,
    runnerResult,
    options.inspectSource ?? actualSource,
  );
  const verification = updates.verification;

  if (current.state !== 'FUNCTIONAL_RUNNING') {
    sessionFail(
      'SESSION_EVIDENCE_OUT_OF_SEQUENCE',
      'functional result may commit only from FUNCTIONAL_RUNNING',
      { state: current.state },
    );
  }
  const runtimeBacked = [
    'service',
    'browser',
    'native-desktop',
    'native-mobile',
  ].includes(context.task.runtimeClass);
  if (
    runtimeBacked &&
    (
      current.source?.commit !== declaration.sourceHead ||
      current.source?.branch !== declaration.branch ||
      current.runtimeBindingRef === null
    )
  ) {
    sessionFail(
      'SESSION_EVIDENCE_OUT_OF_SEQUENCE',
      'runtime-backed functional result requires matching source and runtime binding',
      {
        sourceCommit: current.source?.commit ?? null,
        sourceBranch: current.source?.branch ?? null,
        declarationSourceHead: declaration.sourceHead,
        declarationBranch: declaration.branch,
        runtimeBindingRef: current.runtimeBindingRef,
      },
    );
  }
  if (
    context.task.runtimeClass === 'source-only' &&
    current.runtimeBindingRef !== null
  ) {
    sessionFail(
      'SESSION_EVIDENCE_OUT_OF_SEQUENCE',
      'source-only functional result cannot consume a runtime binding',
    );
  }
  return {
    transitions: [
      {
        to: 'FUNCTIONAL_PASS',
        updates: { verification, failure: null },
        reason: `${options.reason}: FUNCTIONAL_PASS`,
      },
    ],
    seal: updates.seal,
    actualSource: updates.actualSource,
  };
}

function canonicalDigest(value) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function resultStartedAt(runId) {
  const match =
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{6})Z(?:-[0-9a-f]+)?$/
    .exec(runId);
  if (!match) {
    sessionFail(
      'SESSION_EVIDENCE_OUT_OF_SEQUENCE',
      'functional result artifactRunId is not a canonical UTC timestamp',
    );
  }
  const [, year, month, day, hour, minute, second, micros] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}.${micros.slice(0, 3)}Z`;
}

function containedPath(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' && !path.isAbsolute(relative);
}

function gitStatus(workspaceRoot) {
  return execFileSync(
    'git',
    ['status', '--porcelain=v2', '--branch', '--untracked-files=all'],
    {
      cwd: workspaceRoot,
      encoding: 'utf8',
    },
  );
}

function actualSource(workspaceRoot) {
  const firstStatus = gitStatus(workspaceRoot);
  const [commit, tree] = execFileSync(
    'git',
    ['show', '-s', '--format=%H%n%T', 'HEAD'],
    {
      cwd: workspaceRoot,
      encoding: 'utf8',
    },
  ).trim().split('\n');
  const secondStatus = gitStatus(workspaceRoot);
  const branch =
    secondStatus
      .split('\n')
      .find((line) => line.startsWith('# branch.head '))
      ?.slice('# branch.head '.length) ?? '';
  const statusCommit =
    secondStatus
      .split('\n')
      .find((line) => line.startsWith('# branch.oid '))
      ?.slice('# branch.oid '.length) ?? '';
  const entries = secondStatus
    .split('\n')
    .filter((line) => line !== '' && !line.startsWith('# '));
  return {
    commit,
    tree,
    branch,
    clean: entries.length === 0,
    stable: firstStatus === secondStatus && statusCommit === commit,
  };
}

function sameCanonical(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function referenceIdentity(reference) {
  if (!isObject(reference)) return null;
  return {
    artifactKind: reference.artifactKind,
    workspaceId: reference.workspaceId,
    gateId: reference.gateId,
    runId: reference.runId,
    path: reference.path,
    sha256: reference.sha256,
    mediaType: reference.mediaType,
  };
}

function manifestDeclares(manifest, reference) {
  return (
    isObject(manifest?.artifacts) &&
    Object.values(manifest.artifacts).some((candidate) =>
      sameCanonical(candidate, referenceIdentity(reference)),
    )
  );
}

function readArtifactReference(reference, artifactRoot, current) {
  if (
    !isObject(reference) ||
    reference.artifactKind !== 'acceptance-artifact-ref' ||
    reference.workspaceId !== current.workspaceId ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(reference.gateId ?? '') ||
    !/^\d{8}T\d{12}Z-[0-9a-f]{32}$/.test(reference.runId ?? '') ||
    typeof reference.path !== 'string' ||
    reference.path === '' ||
    path.isAbsolute(reference.path) ||
    reference.path.includes('\\') ||
    reference.path.split('/').some((part) => ['', '.', '..'].includes(part)) ||
    !/^[0-9a-f]{64}$/.test(reference.sha256 ?? '')
  ) {
    sessionFail(
      'SESSION_EVIDENCE_OUT_OF_SEQUENCE',
      'development result artifact reference is invalid',
    );
  }
  const runRoot = path.join(
    artifactRoot,
    reference.workspaceId,
    reference.gateId,
    reference.runId,
  );
  const expected = path.resolve(runRoot, reference.path);
  let candidate;
  let bytes;
  try {
    candidate = realpathSync(expected);
    bytes = readFileSync(candidate);
  } catch (error) {
    sessionFail(
      'SESSION_EVIDENCE_OUT_OF_SEQUENCE',
      'development result child artifact is unavailable',
      { cause: String(error) },
    );
  }
  if (
    candidate !== expected ||
    !containedPath(artifactRoot, candidate) ||
    !containedPath(runRoot, candidate)
  ) {
    sessionFail(
      'SESSION_EVIDENCE_OUT_OF_SEQUENCE',
      'development result artifact reference escapes its run',
    );
  }
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== reference.sha256) {
    sessionFail(
      'SESSION_EVIDENCE_OUT_OF_SEQUENCE',
      'development result artifact digest does not match',
      { path: candidate },
    );
  }
  try {
    return {
      value: JSON.parse(bytes.toString('utf8')),
      path: candidate,
      bytes,
      reference: referenceIdentity(reference),
    };
  } catch (error) {
    sessionFail(
      'SESSION_EVIDENCE_OUT_OF_SEQUENCE',
      'development result child artifact is not valid JSON',
      { cause: String(error) },
    );
  }
}

function normalizeStandardizedResult(
  result,
  artifactRoot,
  current,
  expectedGate,
) {
  if (
    result.id !== expectedGate ||
    result.status !== 'passed' ||
    result.completionStatus !== 'DONE' ||
    result.proofStatus !== 'NOT_APPLICABLE' ||
    result.verificationClass !== 'FUNCTIONAL_CHECK'
  ) {
    sessionFail(
      'SESSION_EVIDENCE_OUT_OF_SEQUENCE',
      'standardized Development result is not a passing current-closure result',
    );
  }
  const isStaticResult =
    result.cleanupStatus === 'not-required' &&
    result.cleanupArtifact === undefined;
  if (isStaticResult) {
    const artifacts = [];
    const emitsSourceEvidence =
      result.sourceArtifact !== undefined ||
      result.sourceArtifactKind !== undefined ||
      result.evidenceGateId !== undefined ||
      result.evidenceStatus !== undefined;
    if (
      (!emitsSourceEvidence &&
        result.traceability?.status !== 'not-required') ||
      (emitsSourceEvidence &&
        result.traceability?.status !== 'complete')
    ) {
      sessionFail(
        'SESSION_EVIDENCE_OUT_OF_SEQUENCE',
        'static Development Gate traceability is inconsistent',
      );
    }
    if (emitsSourceEvidence) {
      if (
        result.sourceArtifactKind !== 'acceptance-gate-evidence-report' ||
        result.evidenceGateId !== result.id ||
        !['PASS', 'passed'].includes(result.evidenceStatus)
      ) {
        sessionFail(
          'SESSION_EVIDENCE_OUT_OF_SEQUENCE',
          'static Development Gate evidence report is incomplete',
        );
      }
      const sourceArtifact = readArtifactReference(
        result.sourceArtifact,
        artifactRoot,
        current,
      );
      if (
        sourceArtifact.value?.artifactKind !==
          'acceptance-gate-evidence-report' ||
        sourceArtifact.value?.gateId !== result.id ||
        !['PASS', 'passed'].includes(sourceArtifact.value?.status) ||
        sourceArtifact.value?.completionStatus !== 'DONE' ||
        sourceArtifact.value?.proofStatus !== 'PROVEN'
      ) {
        sessionFail(
          'SESSION_EVIDENCE_OUT_OF_SEQUENCE',
          'static Development Gate evidence report is invalid',
        );
      }
      artifacts.push(sourceArtifact);
    }
    return {
      normalized: {
        ...result,
        schemaVersion: 1,
        artifactRunId: result.developmentRunId,
        workItemId: current.workItemId,
        journeyId: current.journeyId,
        result: 'PASS',
        source: null,
        runtimeIdentity: null,
        assertions: { gatePassed: true },
        failure: [],
        cleanup: { status: 'clean' },
        durationMs: Math.round(Number(result.duration_seconds ?? 0) * 1000),
      },
      artifacts,
    };
  }
  if (
    result.sourceArtifactKind !== 'acceptance-gate-evidence-report' ||
    result.evidenceGateId !== result.id ||
    !['PASS', 'passed'].includes(result.evidenceStatus) ||
    result.traceability?.status !== 'complete' ||
    result.cleanupStatus !== 'passed'
  ) {
    sessionFail(
      'SESSION_EVIDENCE_OUT_OF_SEQUENCE',
      'Development runtime Gate evidence is incomplete',
    );
  }
  const sourceArtifact = readArtifactReference(
    result.sourceArtifact,
    artifactRoot,
    current,
  );
  const manifestArtifact = readArtifactReference(
    result.manifest?._manifest_ref,
    artifactRoot,
    current,
  );
  const cleanupArtifact = readArtifactReference(
    result.cleanupArtifact,
    artifactRoot,
    current,
  );
  if (
    sourceArtifact.value?.gateId !== result.id ||
    sourceArtifact.value?.status !== 'PASS' ||
    sourceArtifact.value?.completionStatus !== 'DONE' ||
    sourceArtifact.value?.proofStatus !== 'PROVEN' ||
    manifestArtifact.value?.state !== 'FIXTURE_READY' ||
    manifestArtifact.value?.source?.workspaceDigest !== 'clean' ||
    cleanupArtifact.value?.status !== 'passed' ||
    cleanupArtifact.value?.completionStatus !== 'DONE'
  ) {
    sessionFail(
      'SESSION_EVIDENCE_OUT_OF_SEQUENCE',
      'standardized Development child evidence is incomplete',
    );
  }
  const runtime = manifestArtifact.value;
  return {
    normalized: {
      ...result,
      schemaVersion: 1,
      artifactRunId: result.sourceArtifact.runId,
      workItemId: current.workItemId,
      journeyId: current.journeyId,
      result: 'PASS',
      source: {
        ...runtime.source,
        canonicalWorktreeHash: current.workspaceId,
      },
      runtimeIdentity: {
        profile: runtime.profile?.resolvedName,
        stationBuildCommit: runtime.services?.station?.liveCommit,
        clientRuntimes: Array.isArray(runtime.clients)
          ? runtime.clients.map((client) => client.runtime)
          : [],
        services: runtime.services,
        clients: runtime.clients,
      },
      assertions: { gatePassed: true, childEvidenceVerified: true },
      failure: [],
      cleanup: { status: 'clean' },
      durationMs: Math.round(Number(result.duration_seconds ?? 0) * 1000),
    },
    artifacts: [sourceArtifact, manifestArtifact, cleanupArtifact],
  };
}

const RUNNER_RESULT = Symbol('development-runner-result');

function runDevelopmentClosure(
  options,
  plan,
  declaration,
  workspaceRoot,
  spawnDevelopmentRunner = spawnSync,
) {
  const expectedGates =
    plan.acceptance?.closures?.[plan.currentTask.closureId] ?? [];
  if (!Array.isArray(expectedGates) || expectedGates.length === 0) {
    sessionFail(
      'SESSION_EVIDENCE_OUT_OF_SEQUENCE',
      'current Task has no Development closure Gates',
    );
  }
  const controlRoot = path.join(
    workspaceWorkflowPath(declaration.workItemId, {
      home: options.home,
      repoRoot: workspaceRoot,
      workspaceId: plan.manifest.binding.workspaceId,
    }),
    'control',
  );
  mkdirSync(controlRoot, { recursive: true, mode: 0o700 });
  const controlDirectory = mkdtempSync(
    path.join(controlRoot, 'functional-run-'),
  );
  const outputFile = path.join(controlDirectory, 'manifest-ref.json');
  try {
    const arguments_ = [
      'tooling/scripts/acceptance-run.py',
      '--execution-plan',
      plan.path,
      '--execution-policy',
      'development',
      '--work-item',
      declaration.workItemId,
      '--development-journey-id',
      plan.currentTask.journeyId,
      '--development-manifest-out',
      outputFile,
    ];
    if (typeof options.runtimeCell === 'string' && options.runtimeCell !== '') {
      arguments_.push('--runtime-cell', options.runtimeCell);
    }
    const workspacePython = path.join(
      workspaceRuntimePath('acceptance-venv', {
        home: options.home,
        repoRoot: workspaceRoot,
        workspaceId: plan.manifest.binding.workspaceId,
      }),
      process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python3',
    );
    const runnerPython = existsSync(workspacePython)
      ? workspacePython
      : 'python3';
    const completed = spawnDevelopmentRunner(runnerPython, arguments_, {
      cwd: workspaceRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        ...(options.home
          ? {
              HOME: options.home,
              PT_MACHINE_DEV_ROOT: path.join(
                options.home,
                '.peers-touch',
                'dev',
              ),
            }
          : {}),
      },
      maxBuffer: 16 * 1024 * 1024,
    });
    if (completed.error || completed.status !== 0) {
      sessionFail(
        'FUNCTIONAL_RUN_FAILED',
        'Development runner did not produce a passing current-closure result',
        {
          status: completed.status ?? null,
          stdout: String(completed.stdout ?? '').slice(-4000),
          stderr: String(completed.stderr ?? completed.error ?? '').slice(-4000),
        },
      );
    }
    const reference = JSON.parse(readFileSync(outputFile, 'utf8'));
    return { [RUNNER_RESULT]: true, reference };
  } catch (error) {
    if (error instanceof DevSessionError) throw error;
    sessionFail(
      'SESSION_EVIDENCE_OUT_OF_SEQUENCE',
      'Development runner result reference is unavailable',
      { cause: String(error) },
    );
  } finally {
    rmSync(controlDirectory, { recursive: true, force: true });
  }
}

function validateAggregateReport(report, expectedGates) {
  const results = Array.isArray(report?.results) ? report.results : [];
  const gateIds = results.map((result) => result?.id);
  const summary = report?.summary;
  if (
    report?.artifactKind !== 'development-functional-run' ||
    report?.executionPolicy !== 'development' ||
    report?.completionStatus !== 'DONE' ||
    report?.proofStatus !== 'NOT_APPLICABLE' ||
    !sameCanonical(gateIds, expectedGates) ||
    !isObject(summary) ||
    summary.total !== expectedGates.length ||
    summary.passed !== expectedGates.length ||
    summary.failed !== 0 ||
    summary.blocked !== 0 ||
    summary.partial !== 0 ||
    summary.incomplete !== 0 ||
    report?.resultTraceabilityState?.status !== 'pass'
  ) {
    sessionFail(
      'SESSION_EVIDENCE_OUT_OF_SEQUENCE',
      'Development aggregate does not prove the complete current closure',
    );
  }
  return results;
}

function runtimeIdentityMatchesDeclaration(
  runtime,
  deployProfiles,
  runtimeClaims,
) {
  if (
    typeof runtime?.profile === 'string' &&
    deployProfiles.includes(runtime.profile)
  ) {
    return true;
  }
  if (!isObject(runtime?.services)) return false;
  const services = Object.values(runtime.services);
  if (services.length === 0) return false;
  const declaredResources = new Set(
    runtimeClaims
      .filter(
        (claim) =>
          isObject(claim) &&
          typeof claim.kind === 'string' &&
          typeof claim.resourceId === 'string',
      )
      .map((claim) => `${claim.kind}:${claim.resourceId}`),
  );
  return services.every((service) => {
    if (
      !isObject(service) ||
      typeof service.kind !== 'string' ||
      typeof service.deploymentEnvironment !== 'string' ||
      service.deploymentEnvironment === ''
    ) {
      return false;
    }
    return (
      declaredResources.has(
        `${service.kind}.connect:${service.deploymentEnvironment}`,
      ) ||
      declaredResources.has(
        `${service.kind}.deploy:${service.deploymentEnvironment}`,
      )
    );
  });
}

function runtimeIdentityIsLocalClientOnly(runtime) {
  if (
    !Array.isArray(runtime?.clientRuntimes) ||
    runtime.clientRuntimes.length === 0
  ) {
    return false;
  }
  return (
    !isObject(runtime?.services) ||
    Object.keys(runtime.services).length === 0
  );
}

export function runtimeIdentitiesMatchDeclaration(
  runtimes,
  deployProfiles,
  runtimeClaims,
) {
  let declaredRuntimeFound = false;
  for (const runtime of runtimes) {
    if (
      runtimeIdentityMatchesDeclaration(
        runtime,
        deployProfiles,
        runtimeClaims,
      )
    ) {
      declaredRuntimeFound = true;
      continue;
    }
    if (!runtimeIdentityIsLocalClientOnly(runtime)) return false;
  }
  return declaredRuntimeFound;
}

function runtimeServiceCommitsMatchSource(runtime, sourceCommit) {
  if (!isObject(runtime?.services)) return true;
  return Object.values(runtime.services).every(
    (service) =>
      isObject(service) &&
      (
        service.liveCommit === undefined ||
        service.liveCommit === sourceCommit
      ),
  );
}

function functionalResultUpdates(
  current,
  options,
  declaration,
  plan,
  runnerResult,
  inspectSource,
) {
  if (runnerResult?.[RUNNER_RESULT] !== true) {
    sessionFail(
      'SESSION_EVIDENCE_OUT_OF_SEQUENCE',
      'functional result must come from the owner-started Development runner',
    );
  }
  const workspaceRoot = realpathSync(options.workspaceRoot ?? repoRoot);
  let artifactRoot;
  try {
    artifactRoot = realpathSync(
      path.join(
        workspaceWorkflowPath(current.workItemId, {
          home: options.home,
          repoRoot: workspaceRoot,
          workspaceId: current.workspaceId,
        }),
        'artifacts',
      ),
    );
  } catch (error) {
    sessionFail(
      'SESSION_EVIDENCE_OUT_OF_SEQUENCE',
      'Development artifact root is unavailable',
      { cause: String(error) },
    );
  }
  const aggregateRun = readArtifactReference(
    runnerResult.reference,
    artifactRoot,
    current,
  );
  const aggregateEnvelope = aggregateRun.value;
  if (
    aggregateEnvelope?.artifactKind !== 'acceptance-run-manifest' ||
    aggregateEnvelope?.schemaVersion !== 1 ||
    aggregateEnvelope?.state !== 'DURABLE' ||
    aggregateEnvelope?.workspaceId !== current.workspaceId ||
    aggregateEnvelope?.gateId !== 'development-run' ||
    aggregateEnvelope?.runId !== aggregateRun.reference.runId ||
    aggregateRun.reference.path !== 'manifest.json' ||
    aggregateEnvelope?.result?.status !== 'passed' ||
    aggregateEnvelope?.result?.completionStatus !== 'DONE' ||
    aggregateEnvelope?.result?.proofStatus !== 'NOT_APPLICABLE' ||
    aggregateEnvelope?.result?.workItemId !== current.workItemId ||
    aggregateEnvelope?.result?.journeyId !== current.journeyId ||
    aggregateEnvelope?.source?.commit !== declaration.sourceHead ||
    aggregateEnvelope?.source?.workspaceDigest !== 'clean' ||
    aggregateEnvelope?.source?.canonicalWorktreeHash !== current.workspaceId
  ) {
    sessionFail(
      'SESSION_EVIDENCE_OUT_OF_SEQUENCE',
      'Development aggregate run identity is invalid',
    );
  }
  const developmentManifestReference =
    aggregateEnvelope?.artifacts?.['development-run-manifest'];
  if (
    !sameCanonical(
      developmentManifestReference,
      aggregateEnvelope?.runtime?.developmentManifest,
    ) ||
    !manifestDeclares(aggregateEnvelope, developmentManifestReference)
  ) {
    sessionFail(
      'SESSION_EVIDENCE_OUT_OF_SEQUENCE',
      'Development aggregate manifest references disagree',
    );
  }
  const developmentManifestArtifact = readArtifactReference(
    developmentManifestReference,
    artifactRoot,
    current,
  );
  const developmentManifest = developmentManifestArtifact.value;
  const expectedGates =
    plan.acceptance?.closures?.[plan.currentTask.closureId] ?? [];
  let resolvedPlanPath = null;
  try {
    resolvedPlanPath = path.resolve(
      workspaceRoot,
      developmentManifest?.planPath ?? '',
    );
  } catch {
    // The contract check below reports one typed evidence error.
  }
  if (
    developmentManifest?.artifactKind !== 'development-run-manifest' ||
    developmentManifest?.schemaVersion !== 2 ||
    developmentManifest?.state !== 'DURABLE' ||
    developmentManifest?.workspaceId !== current.workspaceId ||
    developmentManifest?.gateId !== aggregateRun.reference.gateId ||
    developmentManifest?.runId !== aggregateRun.reference.runId ||
    developmentManifest?.workItemId !== current.workItemId ||
    developmentManifest?.planId !== plan.manifest.planId ||
    resolvedPlanPath !== path.resolve(plan.path) ||
    developmentManifest?.taskId !== plan.currentTask.taskId ||
    developmentManifest?.closureId !== plan.currentTask.closureId ||
    developmentManifest?.journeyId !== current.journeyId ||
    !sameCanonical(developmentManifest?.gateIds, expectedGates) ||
    developmentManifest?.source?.commit !== declaration.sourceHead ||
    developmentManifest?.source?.workspaceDigest !== 'clean' ||
    developmentManifest?.source?.canonicalWorktreeHash !== current.workspaceId
  ) {
    sessionFail(
      'SESSION_EVIDENCE_OUT_OF_SEQUENCE',
      'Development closure manifest identity is invalid',
    );
  }
  const reportArtifact = readArtifactReference(
    developmentManifest.result,
    artifactRoot,
    current,
  );
  if (!manifestDeclares(aggregateEnvelope, developmentManifest.result)) {
    sessionFail(
      'SESSION_EVIDENCE_OUT_OF_SEQUENCE',
      'Development aggregate result is not registered in its run manifest',
    );
  }
  const reportResults = validateAggregateReport(
    reportArtifact.value,
    expectedGates,
  );
  const gateManifests = developmentManifest.gateManifests;
  if (
    !Array.isArray(gateManifests) ||
    gateManifests.length !== expectedGates.length
  ) {
    sessionFail(
      'SESSION_EVIDENCE_OUT_OF_SEQUENCE',
      'Development closure is missing Gate manifests',
    );
  }
  const normalizedResults = [];
  const bundleArtifacts = [
    aggregateRun,
    developmentManifestArtifact,
    reportArtifact,
  ];
  for (const [index, gateId] of expectedGates.entries()) {
    const gateManifestArtifact = readArtifactReference(
      gateManifests[index],
      artifactRoot,
      current,
    );
    const gateManifest = gateManifestArtifact.value;
    if (
      gateManifest?.artifactKind !== 'acceptance-run-manifest' ||
      gateManifest?.schemaVersion !== 1 ||
      gateManifest?.state !== 'DURABLE' ||
      gateManifest?.workspaceId !== current.workspaceId ||
      gateManifest?.gateId !== gateId ||
      gateManifest?.runId !== gateManifestArtifact.reference.runId ||
      gateManifestArtifact.reference.path !== 'manifest.json' ||
      gateManifest?.source?.commit !== declaration.sourceHead ||
      gateManifest?.source?.workspaceDigest !== 'clean' ||
      gateManifest?.source?.canonicalWorktreeHash !== current.workspaceId ||
      gateManifest?.result?.workItemId !== current.workItemId ||
      gateManifest?.result?.id !== gateId ||
      !sameCanonical(
        reportResults[index]?.developmentManifest,
        gateManifests[index],
      )
    ) {
      sessionFail(
        'SESSION_EVIDENCE_OUT_OF_SEQUENCE',
        'Development Gate manifest identity is invalid',
        { gateId },
      );
    }
    const resultArtifact = readArtifactReference(
      gateManifest.result.developmentArtifact,
      artifactRoot,
      current,
    );
    const normalized = normalizeStandardizedResult(
      resultArtifact.value,
      artifactRoot,
      current,
      gateId,
    );
    if (
      !manifestDeclares(gateManifest, gateManifest.result.developmentArtifact) ||
      normalized.artifacts.some(
        (artifact) => !manifestDeclares(gateManifest, artifact.reference),
      )
    ) {
      sessionFail(
        'SESSION_EVIDENCE_OUT_OF_SEQUENCE',
        'Development Gate evidence is not registered in its run manifest',
        { gateId },
      );
    }
    normalizedResults.push(normalized.normalized);
    bundleArtifacts.push(
      gateManifestArtifact,
      resultArtifact,
      ...normalized.artifacts,
    );
  }
  const runtimeIdentities = normalizedResults
    .map((result) => result.runtimeIdentity)
    .filter((runtime) => runtime !== null);
  const startedAt = resultStartedAt(aggregateRun.reference.runId);
  const runtimeNames = [
    ...runtimeIdentities.flatMap((runtime) =>
      Array.isArray(runtime?.clientRuntimes) ? runtime.clientRuntimes : [],
    ),
  ].filter((value) => typeof value === 'string');
  const invalid = [];
  const runtimeBacked = [
    'service',
    'browser',
    'native-desktop',
    'native-mobile',
  ].includes(options.context?.task?.runtimeClass);
  const deployProfiles = options.context?.authorization?.runtime?.deployProfiles;
  const runtimeClaims = Array.isArray(declaration.runtimeClaims)
    ? declaration.runtimeClaims
    : [];
  if (
    runtimeBacked &&
    (
      runtimeIdentities.length === 0 ||
      !Array.isArray(deployProfiles) ||
      !runtimeIdentitiesMatchDeclaration(
        runtimeIdentities,
        deployProfiles,
        runtimeClaims,
      )
    )
  ) {
    invalid.push('runtimeIdentity.profile');
  }
  if (
    options.context?.task?.runtimeClass === 'source-only' &&
    runtimeIdentities.length > 0
  ) {
    invalid.push('runtimeIdentity.unexpected');
  }
  if (
    runtimeIdentities.some(
      (runtime) =>
        (
          runtime?.stationBuildCommit !== undefined &&
          runtime.stationBuildCommit !== declaration.sourceHead
        ) ||
        !runtimeServiceCommitsMatchSource(
          runtime,
          declaration.sourceHead,
        ),
    )
  ) invalid.push('runtimeIdentity.stationBuildCommit');
  if (
    runtimeBacked &&
    normalizedResults.some(
      (result) =>
        result.source !== null &&
        (
        result?.source?.commit !== declaration.sourceHead ||
        result?.source?.workspaceDigest !== 'clean' ||
        result?.source?.canonicalWorktreeHash !== current.workspaceId
        ),
    )
  ) invalid.push('source');
  if (
    options.context?.task?.runtimeClass === 'native-desktop' &&
    !runtimeNames.some((value) => value.startsWith('native-tauri'))
  ) invalid.push('runtimeIdentity.clientRuntime');
  if (
    options.context?.task?.runtimeClass === 'native-mobile' &&
    !runtimeNames.some(
      (value) =>
        value.startsWith('tauri-ios') ||
        value.startsWith('tauri-android'),
    )
  ) invalid.push('runtimeIdentity.clientRuntime');
  if (
    options.context?.task?.runtimeClass === 'browser' &&
    !runtimeNames.some(
      (value) => value === 'browser' || value.startsWith('browser:'),
    )
  ) invalid.push('runtimeIdentity.clientRuntime');
  if (Date.parse(startedAt) < Date.parse(current.startedAt)) {
    invalid.push('artifactRunId');
  }
  if (invalid.length > 0) {
    sessionFail(
      'SESSION_EVIDENCE_OUT_OF_SEQUENCE',
      'functional result contract or identity is invalid',
      { invalid },
    );
  }
  const actual = inspectSource(workspaceRoot);
  if (
    actual.commit !== declaration.sourceHead ||
    actual.branch !== declaration.branch ||
    actual.clean !== true ||
    actual.stable !== true
  ) {
    sessionFail(
      'SESSION_EVIDENCE_OUT_OF_SEQUENCE',
      'functional result source no longer matches clean Git',
      {
        actualCommit: actual.commit,
        declarationSourceHead: declaration.sourceHead,
        actualBranch: actual.branch,
        declarationBranch: declaration.branch,
        clean: actual.clean,
        stable: actual.stable,
      },
    );
  }
  const bundle = {
    artifactKind: 'development-functional-evidence-bundle',
    schemaVersion: 1,
    workspaceId: current.workspaceId,
    workItemId: current.workItemId,
    planId: plan.manifest.planId,
    taskId: plan.currentTask.taskId,
    closureId: plan.currentTask.closureId,
    journeyId: current.journeyId,
    gateIds: expectedGates,
    artifacts: bundleArtifacts.map((artifact) => ({
      reference: artifact.reference,
      value: artifact.value,
    })),
  };
  const bundleBytes = Buffer.from(
    `${JSON.stringify(canonicalize(bundle), null, 2)}\n`,
  );
  const runtimeBindingDigest = canonicalDigest(runtimeIdentities);
  const artifactDigest = createHash('sha256').update(bundleBytes).digest('hex');
  const sealedDirectory = path.join(
    workspaceWorkflowPath(current.workItemId, {
      home: options.home,
      repoRoot: workspaceRoot,
      workspaceId: current.workspaceId,
    }),
    'checks',
  );
  const sealedResult = path.join(
    sealedDirectory,
    `functional-result-${artifactDigest}.json`,
  );
  return {
    actualSource: actual,
    seal: {
      path: sealedResult,
      bytes: bundleBytes,
    },
    source: {
      commit: actual.commit,
      tree: actual.tree,
      branch: declaration.branch,
      clean: true,
      createdAt: startedAt,
      purpose: 'development-runtime',
    },
    runtimeBindingRef: `development-result:${artifactDigest}`,
    verification: {
      id: aggregateRun.reference.runId,
      verificationClass: 'FUNCTIONAL_CHECK',
      result: 'PASS',
      startedAt,
      durationMs: normalizedResults.reduce(
        (total, result) => total + result.durationMs,
        0,
      ),
      artifactRefs: [sealedResult],
      commandDigest: artifactDigest,
      sourceCommit: actual.commit,
      journeyId: current.journeyId,
      runtimeBindingDigest,
    },
  };
}

export async function commitFunctionalResult(options, dependencies = {}) {
  const { declaration, plan, workspaceRoot } = await loadBoundContext(
    options,
    dependencies,
  );
  const store = {
    ...storeOptions(
      { ...options, workspaceRoot },
      plan.manifest.binding.workspaceId,
    ),
    expected: {
      sessionId: declaration.sessionId,
      workItemId: declaration.workItemId,
      planId: plan.manifest.planId,
      taskId: plan.currentTask.taskId,
      workspaceId: plan.manifest.binding.workspaceId,
      branch: plan.manifest.binding.branch,
    },
    reason: options.reason,
    context: {
      task: plan.currentTask,
      acceptance: plan.acceptance,
      authorization: plan.manifest.authorization,
    },
  };
  const preflightSession = loadSessionStore(store);
  const expectedIdentity = store.expected;
  for (const field of Object.keys(expectedIdentity)) {
    if (preflightSession.state[field] !== expectedIdentity[field]) {
      sessionFail(
        'SESSION_IDENTITY_MISMATCH',
        'Session identity does not match before Development execution',
        {
          field,
          expected: expectedIdentity[field],
          actual: preflightSession.state[field],
        },
      );
    }
  }
  if (preflightSession.state.state === 'FUNCTIONAL_PASS') {
    return preflightSession;
  }
  if (preflightSession.state.state !== 'FUNCTIONAL_RUNNING') {
    sessionFail(
      'SESSION_EVIDENCE_OUT_OF_SEQUENCE',
      'Development runner cannot start from the current Session state',
      { state: preflightSession.state.state },
    );
  }
  const runnerResult = runDevelopmentClosure(
    options,
    plan,
    declaration,
    workspaceRoot,
    dependencies.spawnDevelopmentRunner ?? spawnSync,
  );
  let prepared = null;
  return transitionSessionSequenceStore({
    ...store,
    expectedEventDigest: preflightSession.eventDigest,
    transitions: (current) => {
      prepared = functionalPassTransitions(
        current,
        {
          ...options,
          inspectSource: dependencies.inspectSource ?? actualSource,
          context: store.context,
        },
        store.context,
        declaration,
        plan,
        runnerResult,
      );
      return prepared.transitions;
    },
    beforeCommit: () => {
      if (prepared?.seal === null) return { created: false };
      const finalSource = (dependencies.inspectSource ?? actualSource)(
        workspaceRoot,
      );
      if (!sameCanonical(finalSource, prepared.actualSource)) {
        sessionFail(
          'SESSION_EVIDENCE_OUT_OF_SEQUENCE',
          'source changed between Development evidence validation and Session commit',
        );
      }
      if (existsSync(prepared.seal.path)) {
        if (!readFileSync(prepared.seal.path).equals(prepared.seal.bytes)) {
          sessionFail(
            'SESSION_EVIDENCE_OUT_OF_SEQUENCE',
            'sealed functional result digest collision',
          );
        }
        return { created: false };
      }
      (
        dependencies.writeDurableFileAtomic ?? writeDurableFileAtomic
      )(prepared.seal.path, prepared.seal.bytes);
      return { created: true, path: prepared.seal.path };
    },
  });
}

const OPTION_NAMES = {
  home: 'home',
  'workspace-root': 'workspaceRoot',
  'workspace-id': 'workspaceId',
  'work-item': 'workItemId',
  session: 'sessionId',
  plan: 'planPath',
  task: 'taskId',
  journey: 'journeyId',
  to: 'to',
  reason: 'reason',
  source: 'source',
  verification: 'verification',
  failure: 'failure',
  'runtime-binding-ref': 'runtimeBindingRef',
  'runtime-cell': 'runtimeCell',
};
const JSON_OPTIONS = new Set(['source', 'verification', 'failure']);

function parseArguments(argv) {
  const [action, ...rest] = argv;
  const options = {};
  const updates = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) {
      sessionFail('INVALID_ARGUMENT', `unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const optionKey = OPTION_NAMES[key];
    if (!optionKey) {
      sessionFail('INVALID_ARGUMENT', `unsupported option: --${key}`);
    }
    const raw = rest[index + 1];
    if (raw === undefined || raw.startsWith('--')) {
      sessionFail('INVALID_ARGUMENT', `missing value for --${key}`);
    }
    index += 1;
    let value = raw;
    if (JSON_OPTIONS.has(optionKey)) {
      try {
        value = JSON.parse(raw);
      } catch (error) {
        sessionFail('INVALID_ARGUMENT', `--${key} must be valid JSON`, {
          cause: String(error),
        });
      }
    }
    if (
      ['source', 'verification', 'failure', 'runtimeBindingRef'].includes(
        optionKey,
      )
    ) {
      updates[optionKey] = value;
    } else {
      options[optionKey] = value;
    }
  }
  if (Object.keys(updates).length > 0) options.updates = updates;
  return { action, options };
}

function output(value, stream = process.stdout) {
  stream.write(`${JSON.stringify(canonicalize(value), null, 2)}\n`);
}

export async function runCli(argv, io = {}) {
  const { action, options } = parseArguments(argv);
  const write = io.output ?? output;
  let session;
  switch (action) {
    case 'start':
      session = await startDevelopmentSession(options, io.dependencies);
      break;
    case 'status':
      session = statusDevelopmentSession(options);
      break;
    case 'transition':
      session = await transitionDevelopmentSession(options, io.dependencies);
      break;
    case 'functional-result':
      session = await commitFunctionalResult(options, io.dependencies);
      break;
    default:
      sessionFail(
        'INVALID_ARGUMENT',
        'action must be start, status, transition, or functional-result',
      );
  }
  const result = { status: 'PASS', action, session };
  write(result);
  return result;
}

function reportError(error) {
  const typed = asSessionError(error);
  const payload =
    typed instanceof DevSessionError
      ? {
          status: 'BLOCKED',
          code: typed.code,
          message: typed.message,
          detail: typed.detail,
        }
      : {
          status: 'BLOCKED',
          code: 'DEV_SESSION_INTERNAL_ERROR',
          message: String(typed),
        };
  output(payload, process.stderr);
  process.exitCode = 2;
}

if (isDirectInvocation(import.meta.url)) {
  runCli(process.argv.slice(2)).catch(reportError);
}
