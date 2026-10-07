import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { workspaceIdForRoot } from '../lib/machine-dev-paths.mjs';
import {
  checkDeclaration,
  startOrUpdateDeclaration,
} from './dev-work.mjs';
import { canonicalize } from './dev-work-schema.mjs';
import { processStartIdentity } from './dev-work-ledger.mjs';
import {
  archiveDevelopmentSession,
  commitFunctionalResult,
  createInitialSessionState,
  createTransitionEvent,
  DevSessionError,
  readSessionJournal,
  runCli,
  sessionStorePaths,
  startDevelopmentSession,
  statusDevelopmentSession,
  transitionDevelopmentSession,
  transitionSessionSequenceStore,
  validateTaskRuntimeSourceProjection,
  validateSessionState,
  writeDurableFileAtomic,
} from './dev-session.mjs';
import {
  inspectSessionJournal,
  summarizeSessionJournal,
} from './dev-session-store.mjs';
import {
  hashWorkflowRootChatIdentity,
  WORKFLOW_OWNER_REFERENCE_KIND,
} from './workflow-owner-reference.mjs';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);
const BRANCH = execFileSync('git', ['branch', '--show-current'], {
  cwd: REPO_ROOT,
  encoding: 'utf8',
}).trim();
const EXPECTED_HEAD = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: REPO_ROOT,
  encoding: 'utf8',
}).trim();
const INITIAL_HEAD =
  EXPECTED_HEAD === '0'.repeat(40) ? '1'.repeat(40) : '0'.repeat(40);
const WORKSPACE_ID = workspaceIdForRoot(REPO_ROOT);
const START_TIME = Date.parse('2026-09-16T12:00:00.000Z');

function workflowOwner() {
  const rootChatId = 'main-chat-session';
  return {
    kind: WORKFLOW_OWNER_REFERENCE_KIND,
    host: 'trae',
    rootChatId,
    rootChatHash: hashWorkflowRootChatIdentity('trae', rootChatId),
    rootBindingDigest: 'a'.repeat(64),
  };
}

function fixture({
  workClass = 'refactor',
  planWorkClass,
  completionClass = 'functional',
  executionMode = 'build',
  runtimeClass = 'source-only',
  gates = [],
  deployProfiles = [],
  runtimeClaims = '',
} = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'pt-dev-session-'));
  const home = path.join(root, 'home');
  let tick = 0;
  const clock = () => new Date(START_TIME + tick++ * 1_000);
  const workItemId = 'dwf-b1';
  const sessionId = 'dwf-b1-session';
  const journeyId = 'DWF-AS03';
  const taskId = 'DWF-B1';
  const planDigest = 'a'.repeat(64);
  const mountId = 'mount-fixture';
  const runId = 'run-fixture';
  const task = {
    kind: 'peers-touch-task-slice',
    planId: 'mobile-shell',
    taskId,
    workstreamId: 'DWF-B',
    title: 'Development workflow control plane',
    workClass,
    completionClass,
    executionMode,
    closureId: 'dwf-b1',
    journeyId,
    runtimeClass,
    writeSet: ['tooling/scripts/local-dev'],
    readSet: ['docs/architecture/engineering/development-workflow'],
    budgets: {
      focusedCheckSeconds: 30,
      functionalRunSeconds: 30,
      cleanupSeconds: 30,
    },
    checks: [
      {
        id: 'node-test',
        command: 'node --test',
        verificationClass: 'SOURCE_CHECK',
      },
    ],
    doneWhen: ['tests pass'],
    failureBehavior: ['fail closed'],
    updatedAt: '2026-09-16T00:00:00.000Z',
    durableEvidence: [],
  };
  const manifest = {
    kind: 'peers-touch-plan-package',
    planId: 'mobile-shell',
    status: 'active',
    binding: {
      branch: BRANCH,
      workspaceId: WORKSPACE_ID,
      initialHead: INITIAL_HEAD,
    },
    workClass: planWorkClass ?? workClass,
    tasks: [
      {
        id: taskId,
        workstreamId: 'DWF-B',
        path: `tasks/${taskId}.md`,
        dependsOn: [],
        status: 'in_progress',
        blocker: null,
      },
    ],
    authorization: {
      checkpoint: { localCommit: 'allowed', amend: 'denied' },
      delivery: { push: 'denied', pullRequest: 'denied' },
      runtime: { deployProfiles, destructiveResetScopes: [] },
      history: { rewrite: 'denied' },
    },
  };
  const plan = {
    path: path.join(REPO_ROOT, 'fake-plan.md'),
    planPath: 'fake-plan.md',
    repoRoot: REPO_ROOT,
    plan: manifest,
    manifest,
    acceptance: {
      closures: { 'dwf-b1': gates },
      completion: [...gates],
      full: [...gates],
    },
    taskSlices: new Map([[taskId, task]]),
    currentTask: task,
    readyTasks: [],
    planDigest,
  };
  const executionBinding = {
    mountId,
    workspaceId: WORKSPACE_ID,
    canonicalRoot: REPO_ROOT,
    branch: BRANCH,
    initialHead: INITIAL_HEAD,
  };
  const planExecution = {
    mount: {
      mountId,
      planId: manifest.planId,
      planPath: 'fake-plan.md',
      planDigest,
    },
    snapshot: {
      executionBinding,
      planDigest,
    },
    run: {
      runId,
      state: 'active',
      currentTaskId: taskId,
      taskStates: {
        [taskId]: {
          state: 'in_progress',
          blocker: null,
        },
      },
    },
    planPackage: plan,
  };
  const dependencies = {
    async loadPlanPackage(planPath, options) {
      assert.equal(path.resolve(planPath), path.join(REPO_ROOT, 'fake-plan.md'));
      assert.equal(options.repoRoot, REPO_ROOT);
      assert.equal(options.declaration.state, 'ACTIVE');
      return plan;
    },
    async verifyBinding({ repoRoot, binding, sourceHead }) {
      assert.equal(repoRoot, REPO_ROOT);
      assert.equal(binding.initialHead, INITIAL_HEAD);
      assert.equal(sourceHead, EXPECTED_HEAD);
      return {
        root: REPO_ROOT,
        branch: binding.branch,
        workspaceId: binding.workspaceId,
        head: sourceHead,
      };
    },
    async resolvePlanExecution({ repoRoot, home: resolvedHome }) {
      assert.equal(repoRoot, REPO_ROOT);
      assert.equal(resolvedHome, home);
      return planExecution;
    },
    inspectSource() {
      return {
        commit: EXPECTED_HEAD,
        tree: '8'.repeat(40),
        branch: BRANCH,
        clean: true,
        stable: true,
        workspaceDigest: 'clean',
      };
    },
  };
  const baseOptions = {
    home,
    workspaceRoot: REPO_ROOT,
    workItemId,
    sessionId,
    planPath: plan.path,
    taskId,
    journeyId,
    workflowOwner: workflowOwner(),
    clock,
  };
  return {
    root,
    home,
    clock,
    workItemId,
    sessionId,
    task,
    plan,
    planExecution,
    runtimeClaims,
    dependencies,
    baseOptions,
    close() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function declarationOptions(scope, overrides = {}) {
  return {
    home: scope.home,
    workspaceRoot: REPO_ROOT,
    workItemId: scope.workItemId,
    sessionId: scope.sessionId,
    owner: 'lane-b',
    purpose: 'implement DWF-B1',
    journeyId: scope.task.journeyId,
    branch: BRANCH,
    sourceHead: EXPECTED_HEAD,
    sourceClaims: 'exclusive-write:tooling/scripts/local-dev',
    runtimeClaims: scope.runtimeClaims,
    workflowOwner: scope.baseOptions.workflowOwner,
    planPath: 'fake-plan.md',
    planId: scope.plan.manifest.planId,
    taskId: scope.task.taskId,
    planStatus: {
      planId: scope.plan.manifest.planId,
      currentTaskId: scope.task.taskId,
      workspaceId: WORKSPACE_ID,
      branch: BRANCH,
      status: 'active',
      taskStatuses: {
        [scope.task.taskId]: 'in_progress',
      },
      planDigest: scope.plan.planDigest,
      mountId: scope.planExecution.mount.mountId,
      runId: scope.planExecution.run.runId,
    },
    planExecution: scope.planExecution,
    clock: scope.clock,
    ...overrides,
  };
}

function activateDeclaration(scope) {
  startOrUpdateDeclaration(declarationOptions(scope));
  return checkDeclaration(declarationOptions(scope));
}

async function start(scope) {
  activateDeclaration(scope);
  return startDevelopmentSession(scope.baseOptions, scope.dependencies);
}

async function transition(scope, to, updates = {}, overrides = {}) {
  return transitionDevelopmentSession(
    {
      ...scope.baseOptions,
      planPath: undefined,
      taskId: undefined,
      journeyId: undefined,
      to,
      reason: `advance to ${to}`,
      updates,
      ...overrides,
    },
    scope.dependencies,
  );
}

async function advanceRuntimeToFunctionalRunning(scope) {
  await transition(scope, 'CHECKPOINTING');
  await transition(scope, 'CHECKPOINTED', { source: sourceCheckpoint() });
  await transition(scope, 'DEPLOYING');
  await transition(scope, 'DEPLOYED', {
    runtimeBindingRef: 'runtime/dwf-local/lease-1',
  });
  return transition(scope, 'FUNCTIONAL_RUNNING');
}

function restartFunctionalAttempt(scope) {
  return transitionSessionSequenceStore({
    home: scope.home,
    workspaceRoot: REPO_ROOT,
    workspaceId: WORKSPACE_ID,
    workItemId: scope.workItemId,
    clock: scope.clock,
    expected: {
      sessionId: scope.sessionId,
      workItemId: scope.workItemId,
      planId: scope.plan.manifest.planId,
      taskId: scope.task.taskId,
      workspaceId: WORKSPACE_ID,
      branch: BRANCH,
    },
    context: {
      task: scope.task,
      acceptance: scope.plan.acceptance,
      authorization: scope.plan.manifest.authorization,
    },
    transitions: () => [
      {
        to: 'FAILED',
        reason: 'first functional attempt failed',
        updates: {
          failure: failure(
            'FUNCTIONAL_RUNNING',
            'source',
            'SOURCE_CHECK_FAILED',
          ),
        },
      },
      {
        to: 'IMPLEMENTING',
        reason: 'repair first attempt',
        updates: { failure: null },
      },
      {
        to: 'FOCUSED_CHECKING',
        reason: 'recheck repaired source',
      },
      {
        to: 'FOCUSED_PASS',
        reason: 'focused checks pass',
        updates: {
          verification: verification('SOURCE_CHECK', 'PASS'),
        },
      },
      {
        to: 'CHECKPOINTING',
        reason: 'checkpoint repaired source',
      },
      {
        to: 'CHECKPOINTED',
        reason: 'checkpoint repaired source',
        updates: { source: sourceCheckpoint() },
      },
      {
        to: 'DEPLOYING',
        reason: 'deploy repaired source',
      },
      {
        to: 'DEPLOYED',
        reason: 'deployed repaired source',
        updates: { runtimeBindingRef: 'runtime/dwf-local/lease-2' },
      },
      {
        to: 'FUNCTIONAL_RUNNING',
        reason: 'start second functional attempt',
      },
    ],
  });
}

async function commitFunctionalPass(scope, overrides = {}) {
  return commitStandardizedFunctionalPass(scope, overrides);
}

async function commitStandardizedFunctionalPass(scope, overrides = {}) {
  const runId = `20260916T130000000000Z-${'a'.repeat(32)}`;
  const aggregateRunId = `20260916T130100000000Z-${'b'.repeat(32)}`;
  const gateId = scope.plan.acceptance.closures[scope.task.closureId][0];
  const artifactRoot = path.join(
    sessionStorePaths({
      home: scope.home,
      workspaceRoot: REPO_ROOT,
      workspaceId: WORKSPACE_ID,
      workItemId: scope.workItemId,
    }).directory,
    'artifacts',
  );
  const writeArtifact = (artifactGate, artifactRun, relative, value) => {
    const target = path.join(
      artifactRoot,
      WORKSPACE_ID,
      artifactGate,
      artifactRun,
      relative,
    );
    mkdirSync(path.dirname(target), { recursive: true });
    const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
    writeFileSync(target, bytes);
    return {
      artifactKind: 'acceptance-artifact-ref',
      gateId: artifactGate,
      runId: artifactRun,
      workspaceId: WORKSPACE_ID,
      path: relative,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      mediaType: 'application/json',
    };
  };
  const runtimeEvidence =
    overrides.runtimeEvidence ?? scope.task.runtimeClass !== 'source-only';
  const emitsEvidenceReport =
    runtimeEvidence || overrides.staticEvidenceReport === true;
  const sourceArtifact = emitsEvidenceReport
    ? writeArtifact(gateId, runId, 'reports/gate.json', {
        gateId,
        artifactKind: 'acceptance-gate-evidence-report',
        status: 'PASS',
        completionStatus: 'DONE',
        proofStatus: 'PROVEN',
        ...(overrides.sourceArtifact ?? {}),
      })
    : null;
  const genericStaticArtifact = overrides.genericStaticArtifact
    ? writeArtifact(gateId, runId, 'reports/static.json', {
        artifactKind: 'acceptance-plan',
        status: 'PASS',
      })
    : null;
  const manifestRef = runtimeEvidence
    ? writeArtifact(
        gateId,
        runId,
        'runtime/environment-manifest.json',
        {
          state: 'FIXTURE_READY',
          profile: { resolvedName: 'dwf-local' },
          source: { commit: EXPECTED_HEAD, workspaceDigest: 'clean' },
          services: { station: { liveCommit: EXPECTED_HEAD } },
          clients: [{ runtime: 'native-tauri' }],
          ...(overrides.manifest ?? {}),
        },
      )
    : null;
  const cleanupArtifact = runtimeEvidence
    ? writeArtifact(gateId, runId, 'reports/cleanup.json', {
        status: 'passed',
        completionStatus: 'DONE',
        ...(overrides.cleanupArtifact ?? {}),
      })
    : null;
  const standardizedResult = {
    artifactKind: 'development-functional-result',
    id: gateId,
    status: 'passed',
    completionStatus: 'DONE',
    proofStatus: 'NOT_APPLICABLE',
    verificationClass: 'FUNCTIONAL_CHECK',
    cleanupStatus: runtimeEvidence ? 'passed' : 'not-required',
    duration_seconds: 1,
    traceability: {
      status: runtimeEvidence ? 'complete' : 'not-required',
    },
    ...(emitsEvidenceReport
      ? {
          sourceArtifact,
          sourceArtifactKind: 'acceptance-gate-evidence-report',
          evidenceGateId: gateId,
          evidenceStatus: 'PASS',
        }
      : {}),
    ...(genericStaticArtifact
      ? { sourceArtifact: genericStaticArtifact }
      : {}),
    ...(runtimeEvidence
      ? {
          cleanupArtifact,
          manifest: { _manifest_ref: manifestRef },
        }
      : {}),
    ...(overrides.result ?? {}),
  };
  const resultRef = writeArtifact(
    gateId,
    runId,
    'development/result.json',
    standardizedResult,
  );
  const gateManifestRef = writeArtifact(gateId, runId, 'manifest.json', {
    artifactKind: 'acceptance-run-manifest',
    schemaVersion: 1,
    workspaceId: WORKSPACE_ID,
    gateId,
    runId,
    state: 'DURABLE',
    source: {
      commit: EXPECTED_HEAD,
      workspaceDigest: 'clean',
      canonicalWorktreeHash: WORKSPACE_ID,
    },
    runtime: runtimeEvidence ? { _manifest_ref: manifestRef } : {},
    result: {
      ...standardizedResult,
      workItemId: scope.workItemId,
      developmentArtifact: resultRef,
    },
    artifacts: {
      'development-result': resultRef,
      ...(emitsEvidenceReport
        ? {
            'source-report': sourceArtifact,
          }
        : {}),
      ...(runtimeEvidence
        ? {
            'runtime-manifest': manifestRef,
            cleanup: cleanupArtifact,
          }
        : {}),
    },
  });
  const reportResult = {
    ...standardizedResult,
    developmentArtifact: resultRef,
    developmentManifest: gateManifestRef,
    developmentRunId: runId,
  };
  const reportRef = writeArtifact(
    'development-run',
    aggregateRunId,
    'reports/run.json',
    {
      artifactKind: 'development-functional-run',
      executionPolicy: 'development',
      source: {
        commit: EXPECTED_HEAD,
        workspaceDigest: 'clean',
        canonicalWorktreeHash: WORKSPACE_ID,
      },
      summary: {
        total: 1,
        passed: 1,
        failed: 0,
        blocked: 0,
        dryRun: 0,
        partial: 0,
        unproven: 0,
        incomplete: 0,
        passedButUnproven: 0,
        missingResultTraceability: 0,
        sampleEmissionAllowed: false,
      },
      completionStatus: 'DONE',
      proofStatus: 'NOT_APPLICABLE',
      sampleEmissionAllowed: false,
      resultTraceabilityState: { status: 'pass' },
      results: [reportResult],
    },
  );
  const developmentManifestRef = writeArtifact(
    'development-run',
    aggregateRunId,
    'development/manifest.json',
    {
      artifactKind: 'development-run-manifest',
      schemaVersion: 2,
      state: 'DURABLE',
      workspaceId: WORKSPACE_ID,
      gateId: 'development-run',
      runId: aggregateRunId,
      workItemId: scope.workItemId,
      planId: scope.plan.manifest.planId,
      planPath: 'fake-plan.md',
      taskId: scope.task.taskId,
      closureId: scope.task.closureId,
      journeyId: scope.task.journeyId,
      gateIds: [gateId],
      gateManifests: [gateManifestRef],
      source: {
        commit: EXPECTED_HEAD,
        workspaceDigest: 'clean',
        canonicalWorktreeHash: WORKSPACE_ID,
      },
      result: reportRef,
      createdAt: '2026-09-16T13:01:00.000Z',
    },
  );
  const aggregateManifestRef = writeArtifact(
    'development-run',
    aggregateRunId,
    'manifest.json',
    {
      artifactKind: 'acceptance-run-manifest',
      schemaVersion: 1,
      state: 'DURABLE',
      workspaceId: WORKSPACE_ID,
      gateId: 'development-run',
      runId: aggregateRunId,
      source: {
        commit: EXPECTED_HEAD,
        workspaceDigest: 'clean',
        canonicalWorktreeHash: WORKSPACE_ID,
      },
      runtime: { developmentManifest: developmentManifestRef },
      result: {
        status: 'passed',
        completionStatus: 'DONE',
        proofStatus: 'NOT_APPLICABLE',
        workItemId: scope.workItemId,
        journeyId: scope.task.journeyId,
      },
      artifacts: {
        'development-run-manifest': developmentManifestRef,
        run: reportRef,
      },
    },
  );
  return commitFunctionalResult(
    {
      ...scope.baseOptions,
      planPath: undefined,
      taskId: undefined,
      journeyId: undefined,
      reason: 'commit standardized functional result',
      ...(overrides.options ?? {}),
    },
    {
      ...scope.dependencies,
      spawnDevelopmentRunner(_command, arguments_) {
        assert.equal(_command, 'python3');
        assert.notEqual(arguments_.indexOf('--execution-plan'), -1);
        assert.equal(arguments_.includes('--gate'), false);
        assert.equal(arguments_.includes('--result-file'), false);
        const outputIndex = arguments_.indexOf('--development-manifest-out');
        assert.notEqual(outputIndex, -1);
        writeFileSync(
          arguments_[outputIndex + 1],
          `${JSON.stringify(aggregateManifestRef)}\n`,
        );
        overrides.beforeRunnerReturn?.(arguments_);
        return { status: 0, stdout: '', stderr: '' };
      },
      ...(overrides.dependencies ?? {}),
    },
  );
}

function verification(
  verificationClass,
  result,
  id = `${verificationClass.toLowerCase()}-${result.toLowerCase()}`,
) {
  return {
    id,
    verificationClass,
    result,
    startedAt: '2026-09-16T12:00:00.000Z',
    durationMs: 10,
    artifactRefs: [],
  };
}

function sourceCheckpoint() {
  return {
    commit: EXPECTED_HEAD,
    tree: '8'.repeat(40),
    branch: BRANCH,
    clean: true,
    createdAt: '2026-09-16T12:00:00.000Z',
    purpose: 'development-runtime',
  };
}

function failure(stage, owner = 'source', kind = 'SOURCE_CHECK_FAILED') {
  return {
    kind,
    stage,
    owner,
    summary: 'deterministic failure',
    retryable: true,
  };
}

function hostFailureIdentity(scope) {
  return {
    sessionId: scope.sessionId,
    workItemId: scope.workItemId,
    planId: scope.plan.manifest.planId,
    taskId: scope.task.taskId,
    workspaceId: WORKSPACE_ID,
    journeyId: scope.task.journeyId,
    sourceCommit: 'UNCOMMITTED',
    runtimeBindingRef: 'UNBOUND',
  };
}

function expectCode(code, operation) {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof DevSessionError);
    assert.equal(error.code, code);
    return true;
  });
}

test('initial Session state carries the verified main-session owner', () => {
  const owner = workflowOwner();
  const state = createInitialSessionState(
    {
      sessionId: 'session-owner',
      workItemId: 'WORK-OWNER',
      planId: 'PLAN-OWNER',
      taskId: 'TASK-OWNER',
      workspaceId: WORKSPACE_ID,
      branch: BRANCH,
      journeyId: 'JOURNEY-OWNER',
      executionMode: 'build',
      workflowOwner: owner,
    },
    '2026-10-07T00:00:00.000Z',
  );
  assert.deepEqual(state.workflowOwner, owner);
  assert.equal(validateSessionState(state), state);
});

test('legacy Session state without host request history remains readable', () => {
  const scope = fixture();
  try {
    const state = {
      sessionId: scope.sessionId,
      workItemId: scope.workItemId,
      planId: scope.plan.manifest.planId,
      taskId: scope.task.taskId,
      workspaceId: WORKSPACE_ID,
      branch: BRANCH,
      journeyId: scope.task.journeyId,
      executionMode: scope.task.executionMode,
      state: 'BOUND',
      source: null,
      runtimeBindingRef: null,
      currentFailure: null,
      lastVerification: null,
      startedAt: '2026-09-16T12:00:00.000Z',
      updatedAt: '2026-09-16T12:00:00.000Z',
    };
    assert.equal(validateSessionState(state), state);
  } finally {
    scope.close();
  }
});

test('archive preserves a terminal Session and clears the work-item slot', async () => {
  const scope = fixture();
  try {
    await start(scope);
    await transition(scope, 'CLEANING');
    await transition(scope, 'CANCELLED');
    const paths = sessionStorePaths({
      home: scope.home,
      workspaceRoot: REPO_ROOT,
      workspaceId: WORKSPACE_ID,
      workItemId: scope.workItemId,
    });
    assert.throws(
      () =>
        archiveDevelopmentSession({
          ...scope.baseOptions,
          workflowOwner: {
            ...scope.baseOptions.workflowOwner,
            rootBindingDigest: 'b'.repeat(64),
          },
        }),
      (error) =>
        error instanceof DevSessionError &&
        error.code === 'SESSION_IDENTITY_MISMATCH',
    );

    const archived = archiveDevelopmentSession(scope.baseOptions);

    assert.equal(archived.sessionId, scope.sessionId);
    assert.equal(archived.state, 'CANCELLED');
    assert.equal(existsSync(paths.session), false);
    assert.equal(existsSync(paths.events), false);
    assert.equal(
      existsSync(path.join(archived.archiveDirectory, 'session.json')),
      true,
    );
    assert.equal(
      existsSync(path.join(archived.archiveDirectory, 'events.ndjson')),
      true,
    );
  } finally {
    scope.close();
  }
});

test('archive preserves a prior Session when the same sessionId is reused', async () => {
  const scope = fixture();
  try {
    await start(scope);
    await transition(scope, 'CLEANING');
    await transition(scope, 'CANCELLED');
    const first = archiveDevelopmentSession(scope.baseOptions);

    await start(scope);
    await transition(scope, 'CLEANING');
    await transition(scope, 'CANCELLED');
    const second = archiveDevelopmentSession(scope.baseOptions);
    const paths = sessionStorePaths({
      home: scope.home,
      workspaceRoot: REPO_ROOT,
      workspaceId: WORKSPACE_ID,
      workItemId: scope.workItemId,
    });
    const historyDirectory = path.join(
      paths.directory,
      'archive-history',
      scope.sessionId,
      first.eventDigest,
    );

    assert.notEqual(first.eventDigest, second.eventDigest);
    assert.equal(
      existsSync(path.join(historyDirectory, 'session.json')),
      true,
    );
    assert.equal(
      existsSync(path.join(historyDirectory, 'events.ndjson')),
      true,
    );
    assert.equal(
      existsSync(path.join(second.archiveDirectory, 'session.json')),
      true,
    );
    assert.equal(
      existsSync(path.join(second.archiveDirectory, 'events.ndjson')),
      true,
    );
  } finally {
    scope.close();
  }
});

test('archive tolerates an identical displaced Session already in history', async () => {
  const scope = fixture();
  try {
    await start(scope);
    await transition(scope, 'CLEANING');
    await transition(scope, 'CANCELLED');
    archiveDevelopmentSession(scope.baseOptions);

    await start(scope);
    await transition(scope, 'CLEANING');
    await transition(scope, 'CANCELLED');
    const second = archiveDevelopmentSession(scope.baseOptions);
    const paths = sessionStorePaths({
      home: scope.home,
      workspaceRoot: REPO_ROOT,
      workspaceId: WORKSPACE_ID,
      workItemId: scope.workItemId,
    });
    const duplicateHistory = path.join(
      paths.directory,
      'archive-history',
      scope.sessionId,
      second.eventDigest,
    );
    mkdirSync(duplicateHistory, { recursive: true });
    copyFileSync(
      path.join(second.archiveDirectory, 'session.json'),
      path.join(duplicateHistory, 'session.json'),
    );
    copyFileSync(
      path.join(second.archiveDirectory, 'events.ndjson'),
      path.join(duplicateHistory, 'events.ndjson'),
    );

    await start(scope);
    await transition(scope, 'CLEANING');
    await transition(scope, 'CANCELLED');
    const third = archiveDevelopmentSession(scope.baseOptions);

    assert.notEqual(second.eventDigest, third.eventDigest);
    assert.equal(
      existsSync(path.join(duplicateHistory, 'session.json')),
      true,
    );
    assert.equal(
      existsSync(path.join(duplicateHistory, 'events.ndjson')),
      true,
    );
    assert.equal(
      existsSync(path.join(third.archiveDirectory, 'session.json')),
      true,
    );
    assert.equal(
      existsSync(path.join(third.archiveDirectory, 'events.ndjson')),
      true,
    );
  } finally {
    scope.close();
  }
});

test('task result admission revalidates a frozen runtime source projection', () => {
  const planPath = path.join(
    REPO_ROOT,
    'docs/architecture/shared/security/secure-content/execution-plans/'
      + '20260913-secure-content-hard-cut/plan.md',
  );
  const validation = spawnSync(
    'python3',
    [
      '-m',
      'tooling.scripts.plan_lifecycle_source',
      '--repo-root',
      REPO_ROOT,
      '--plan',
      planPath,
      '--runtime-source',
      EXPECTED_HEAD,
      '--control-head',
      EXPECTED_HEAD,
    ],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  assert.equal(validation.status, 0, validation.stderr);
  const projection = JSON.parse(validation.stdout);

  assert.equal(
    validateTaskRuntimeSourceProjection(
      {
        kind: 'secure-content-development-result-aggregate',
        sourceCommit: EXPECTED_HEAD,
        runtimeSourceCommit: EXPECTED_HEAD,
        controlHead: EXPECTED_HEAD,
        sourceTransitionCount: 0,
        sourceProjectionDigest: projection.transitionDigest,
      },
      { sourceHead: EXPECTED_HEAD },
      { path: planPath },
      REPO_ROOT,
    ),
    null,
  );
});

async function rejectCode(code, operation) {
  await assert.rejects(operation, (error) => {
    assert.ok(error instanceof DevSessionError);
    assert.equal(error.code, code);
    return true;
  });
}

test('start requires an ACTIVE declaration and preserves Plan baseline/source identity', async () => {
  const scope = fixture();
  try {
    startOrUpdateDeclaration(declarationOptions(scope));
    await rejectCode('WORK_DECLARATION_NOT_ACTIVE', () =>
      startDevelopmentSession(scope.baseOptions, scope.dependencies),
    );
    checkDeclaration(declarationOptions(scope));
    const session = await startDevelopmentSession(
      scope.baseOptions,
      scope.dependencies,
    );
    assert.equal(session.state.state, 'BOUND');
    assert.equal(session.state.workspaceId, WORKSPACE_ID);
    assert.notEqual(INITIAL_HEAD, EXPECTED_HEAD);
    assert.equal(workspaceIdForRoot(REPO_ROOT), WORKSPACE_ID);
    const paths = sessionStorePaths({
      home: scope.home,
      workspaceId: WORKSPACE_ID,
      workItemId: scope.workItemId,
    });
    assert.equal(statSync(paths.directory).mode & 0o777, 0o700);
    assert.equal(statSync(paths.session).mode & 0o777, 0o600);
    assert.equal(statSync(paths.events).mode & 0o777, 0o600);
  } finally {
    scope.close();
  }
});

test('Session transition policy follows the current Task work class', async () => {
  const scope = fixture({
    workClass: 'infrastructure',
    planWorkClass: 'product-behavior',
  });
  try {
    const session = await start(scope);
    assert.equal(session.state.state, 'BOUND');
    await transition(scope, 'IMPLEMENTING');
  } finally {
    scope.close();
  }
});

test('start rejects task, journey, declaration scope, and binding mismatch', async () => {
  const taskScope = fixture();
  try {
    activateDeclaration(taskScope);
    await rejectCode('SESSION_IDENTITY_MISMATCH', () =>
      startDevelopmentSession(
        { ...taskScope.baseOptions, taskId: 'DWF-B2' },
        taskScope.dependencies,
      ),
    );
    await rejectCode('SESSION_IDENTITY_MISMATCH', () =>
      startDevelopmentSession(
        { ...taskScope.baseOptions, journeyId: 'DWF-AS04' },
        taskScope.dependencies,
      ),
    );
  } finally {
    taskScope.close();
  }

  const scopeMismatch = fixture();
  try {
    startOrUpdateDeclaration(
      declarationOptions(scopeMismatch, {
        sourceClaims: 'exclusive-write:apps/desktop',
      }),
    );
    checkDeclaration(declarationOptions(scopeMismatch));
    await rejectCode('SESSION_SCOPE_MISMATCH', () =>
      startDevelopmentSession(
        scopeMismatch.baseOptions,
        scopeMismatch.dependencies,
      ),
    );
  } finally {
    scopeMismatch.close();
  }

  const locatorMismatch = fixture();
  try {
    activateDeclaration(locatorMismatch);
    locatorMismatch.plan.path = path.join(REPO_ROOT, 'other-plan.md');
    await rejectCode('SESSION_IDENTITY_MISMATCH', () =>
      startDevelopmentSession(
        locatorMismatch.baseOptions,
        locatorMismatch.dependencies,
      ),
    );
  } finally {
    locatorMismatch.close();
  }

  const planMountMismatch = fixture();
  try {
    activateDeclaration(planMountMismatch);
    planMountMismatch.dependencies.resolvePlanExecution = async () => ({
      ...planMountMismatch.planExecution,
      mount: {
        ...planMountMismatch.planExecution.mount,
        mountId: 'mount-foreign',
      },
    });
    await rejectCode('SESSION_IDENTITY_MISMATCH', () =>
      startDevelopmentSession(
        planMountMismatch.baseOptions,
        planMountMismatch.dependencies,
      ),
    );
  } finally {
    planMountMismatch.close();
  }

  const bindingScope = fixture();
  try {
    activateDeclaration(bindingScope);
    bindingScope.dependencies.verifyBinding = async ({
      repoRoot,
      binding,
    }) => ({
      root: repoRoot,
      branch: binding.branch,
      workspaceId: binding.workspaceId,
      head: '9'.repeat(40),
    });
    await rejectCode('WORKTREE_IDENTITY_MISMATCH', () =>
      startDevelopmentSession(
        bindingScope.baseOptions,
        bindingScope.dependencies,
      ),
    );
  } finally {
    bindingScope.close();
  }
});

test('build source-only refactor follows its legal completion path', async () => {
  const scope = fixture({ gates: ['chat-gate'] });
  try {
    await start(scope);
    await rejectCode('SESSION_TRANSITION_INVALID', () =>
      transition(scope, 'REPRODUCING'),
    );
    await transition(scope, 'IMPLEMENTING');
    await transition(scope, 'FOCUSED_CHECKING');
    await rejectCode('SESSION_VERIFICATION_REQUIRED', () =>
      transition(scope, 'FOCUSED_PASS'),
    );
    await transition(scope, 'FOCUSED_PASS', {
      verification: verification('SOURCE_CHECK', 'PASS'),
    });
    await transition(scope, 'FUNCTIONAL_RUNNING');
    await rejectCode('SESSION_OWNER_COMMAND_REQUIRED', () =>
      transition(scope, 'FUNCTIONAL_PASS'),
    );
    const committed = await commitFunctionalPass(scope);
    assert.equal(committed.state.runtimeBindingRef, null);
    await transition(scope, 'ACCEPTANCE_READY');
    await transition(scope, 'FINAL_CHECKPOINTED', {
      source: sourceCheckpoint(),
    });
    await transition(scope, 'ACCEPTANCE_RUNNING');
    await transition(scope, 'ACCEPTANCE_PASS', {
      verification: verification('ACCEPTANCE_PROOF', 'PASS'),
    });
    const complete = await transition(scope, 'DELIVERY_READY');
    assert.equal(complete.state.state, 'DELIVERY_READY');
    await rejectCode('SESSION_TRANSITION_INVALID', () =>
      transition(scope, 'CLEANING'),
    );
  } finally {
    scope.close();
  }
});

test('source-only functional result rejects runtime-backed evidence', async () => {
  const scope = fixture({ gates: ['chat-gate'] });
  try {
    await start(scope);
    await transition(scope, 'IMPLEMENTING');
    await transition(scope, 'FOCUSED_CHECKING');
    await transition(scope, 'FOCUSED_PASS', {
      verification: verification('SOURCE_CHECK', 'PASS'),
    });
    await transition(scope, 'FUNCTIONAL_RUNNING');
    await rejectCode('SESSION_EVIDENCE_OUT_OF_SEQUENCE', () =>
      commitFunctionalPass(scope, { runtimeEvidence: true }),
    );
  } finally {
    scope.close();
  }
});

test('source-only functional result requires static traceability semantics', async () => {
  const scope = fixture({ gates: ['chat-gate'] });
  try {
    await start(scope);
    await transition(scope, 'IMPLEMENTING');
    await transition(scope, 'FOCUSED_CHECKING');
    await transition(scope, 'FOCUSED_PASS', {
      verification: verification('SOURCE_CHECK', 'PASS'),
    });
    await transition(scope, 'FUNCTIONAL_RUNNING');
    await rejectCode('SESSION_EVIDENCE_OUT_OF_SEQUENCE', () =>
      commitFunctionalPass(scope, {
        result: { traceability: { status: 'complete' } },
      }),
    );
  } finally {
    scope.close();
  }
});

test('static functional result accepts and seals an emitted acceptance report', async () => {
  const scope = fixture({ gates: ['chat-gate'] });
  try {
    await start(scope);
    await transition(scope, 'IMPLEMENTING');
    await transition(scope, 'FOCUSED_CHECKING');
    await transition(scope, 'FOCUSED_PASS', {
      verification: verification('SOURCE_CHECK', 'PASS'),
    });
    await transition(scope, 'FUNCTIONAL_RUNNING');
    const committed = await commitFunctionalPass(scope, {
      staticEvidenceReport: true,
    });
    assert.equal(committed.state.state, 'FUNCTIONAL_PASS');
    const bundle = JSON.parse(
      readFileSync(committed.state.lastVerification.artifactRefs[0], 'utf8'),
    );
    assert.ok(
      bundle.artifacts.some(
        (artifact) => artifact.reference.path === 'reports/gate.json',
      ),
    );
  } finally {
    scope.close();
  }
});

test('static functional result accepts a generic source artifact without evidence claims', async () => {
  const scope = fixture({ gates: ['chat-gate'] });
  try {
    await start(scope);
    await transition(scope, 'IMPLEMENTING');
    await transition(scope, 'FOCUSED_CHECKING');
    await transition(scope, 'FOCUSED_PASS', {
      verification: verification('SOURCE_CHECK', 'PASS'),
    });
    await transition(scope, 'FUNCTIONAL_RUNNING');
    const committed = await commitFunctionalPass(scope, {
      genericStaticArtifact: true,
    });
    assert.equal(committed.state.state, 'FUNCTIONAL_PASS');
  } finally {
    scope.close();
  }
});

test('source completion terminates at SOURCE_READY without functional proof', async () => {
  const scope = fixture({
    workClass: 'product-behavior',
    completionClass: 'source',
  });
  try {
    await start(scope);
    await transition(scope, 'IMPLEMENTING');
    await transition(scope, 'FOCUSED_CHECKING');
    await transition(scope, 'FOCUSED_PASS', {
      verification: verification('SOURCE_CHECK', 'PASS'),
    });
    await rejectCode('SESSION_TRANSITION_INVALID', () =>
      transition(scope, 'FUNCTIONAL_RUNNING'),
    );
    const sourceReady = await transition(scope, 'SOURCE_READY');
    assert.equal(sourceReady.state.state, 'SOURCE_READY');
    await rejectCode('SESSION_TRANSITION_INVALID', () =>
      transition(scope, 'DELIVERY_READY'),
    );
  } finally {
    scope.close();
  }
});

test('Session journal timing is derived without persistent metrics state', async () => {
  const scope = fixture({
    workClass: 'product-behavior',
    completionClass: 'source',
  });
  try {
    await start(scope);
    await transition(scope, 'IMPLEMENTING');
    await transition(scope, 'FOCUSED_CHECKING');
    await transition(scope, 'FOCUSED_PASS', {
      verification: verification('SOURCE_CHECK', 'PASS'),
    });
    const terminal = await transition(scope, 'SOURCE_READY');
    const journal = readSessionJournal({
      home: scope.home,
      workspaceRoot: REPO_ROOT,
      workItemId: scope.workItemId,
      clock: scope.clock,
    });

    const timing = summarizeSessionJournal(
      journal.events,
      terminal.state.updatedAt,
    );

    assert.equal(timing.completeness, 'complete');
    assert.equal(timing.observedAt, terminal.state.updatedAt);
    assert.ok(timing.elapsedMs > 0);
    assert.ok(timing.phaseMs.implement > 0);
    assert.ok(timing.phaseMs.test > 0);
    assert.equal(timing.evidence.SOURCE_CHECK, 'PASS');
    assert.equal(timing.evidence.STRUCTURAL_CHECK, 'UNPROVEN');
    assert.equal(timing.evidence.UX_REVIEW, 'UNPROVEN');
    assert.equal(timing.evidence.FUNCTIONAL_CHECK, 'UNPROVEN');
    assert.equal(timing.evidence.ACCEPTANCE_PROOF, 'UNPROVEN');
  } finally {
    scope.close();
  }
});

test('Session timing becomes unknown when event timestamps move backward', async () => {
  const scope = fixture({
    workClass: 'product-behavior',
    completionClass: 'source',
  });
  try {
    await start(scope);
    await transition(scope, 'IMPLEMENTING');
    await transition(scope, 'FOCUSED_CHECKING');
    await transition(scope, 'FOCUSED_PASS', {
      verification: verification('SOURCE_CHECK', 'PASS'),
    });
    await transition(scope, 'SOURCE_READY');
    const journal = readSessionJournal({
      home: scope.home,
      workspaceRoot: REPO_ROOT,
      workItemId: scope.workItemId,
      clock: scope.clock,
    });
    const journalStart = Date.parse(journal.events[0].snapshot.startedAt);
    const eventTimes = [
      journalStart,
      journalStart + 10_000,
      journalStart + 5_000,
      journalStart + 12_000,
      journalStart + 15_000,
    ];
    let previousDigest = null;
    const nonMonotonic = journal.events.map((event, index) => {
      const at = new Date(eventTimes[index]).toISOString();
      const rebuilt = createTransitionEvent({
        kind: event.kind,
        sequence: event.sequence,
        sessionId: event.sessionId,
        at,
        reason: event.reason,
        previousDigest,
        compactedThrough: event.compactedThrough,
        snapshot: { ...event.snapshot, updatedAt: at },
      });
      previousDigest = rebuilt.eventDigest;
      return rebuilt;
    });

    const timing = summarizeSessionJournal(
      nonMonotonic,
      new Date(journalStart + 15_000),
    );

    assert.equal(timing.completeness, 'unknown');
    assert.equal(timing.elapsedMs, null);
    assert.ok(Object.values(timing.phaseMs).every((value) => value === null));
    assert.equal(timing.evidence.SOURCE_CHECK, 'PASS');
  } finally {
    scope.close();
  }
});

test('fix mode requires reproduction evidence and first-failure ownership', async () => {
  const scope = fixture({ executionMode: 'fix' });
  try {
    await start(scope);
    await transition(scope, 'REPRODUCING');
    await rejectCode('SESSION_VERIFICATION_REQUIRED', () =>
      transition(scope, 'REPRODUCED'),
    );
    await transition(scope, 'REPRODUCED', {
      verification: verification('FUNCTIONAL_CHECK', 'FAIL'),
      failure: failure('REPRODUCING', 'product', 'PRODUCT_ASSERTION_FAILED'),
    });
    const implementing = await transition(scope, 'IMPLEMENTING');
    assert.equal(implementing.state.currentFailure.owner, 'product');
  } finally {
    scope.close();
  }
});

test('runtime and formal Acceptance paths enforce checkpoint and proof fences', async () => {
  const scope = fixture({
    workClass: 'product-behavior',
    runtimeClass: 'service',
    gates: ['development-workflow-control-plane'],
    deployProfiles: ['dwf-local'],
  });
  try {
    await start(scope);
    await transition(scope, 'IMPLEMENTING');
    await transition(scope, 'FOCUSED_CHECKING');
    await transition(scope, 'FOCUSED_PASS', {
      verification: verification('STRUCTURAL_CHECK', 'PASS'),
    });
    await transition(scope, 'CHECKPOINTING');
    await rejectCode('SESSION_CHECKPOINT_REQUIRED', () =>
      transition(scope, 'CHECKPOINTED'),
    );
    await transition(scope, 'CHECKPOINTED', { source: sourceCheckpoint() });
    await transition(scope, 'DEPLOYING');
    await rejectCode('SESSION_RUNTIME_REQUIRED', () =>
      transition(scope, 'DEPLOYED'),
    );
    await transition(scope, 'DEPLOYED', {
      runtimeBindingRef: 'runtime/dwf-local/lease-1',
    });
    await transition(scope, 'FUNCTIONAL_RUNNING');
    await commitFunctionalPass(scope);
    await transition(scope, 'ACCEPTANCE_READY');
    await transition(scope, 'FINAL_CHECKPOINTED');
    await transition(scope, 'ACCEPTANCE_RUNNING');
    await rejectCode('SESSION_VERIFICATION_REQUIRED', () =>
      transition(scope, 'ACCEPTANCE_PASS'),
    );
    await transition(scope, 'ACCEPTANCE_PASS', {
      verification: verification('ACCEPTANCE_PROOF', 'PASS'),
    });
    assert.equal(
      (await transition(scope, 'DELIVERY_READY')).state.state,
      'DELIVERY_READY',
    );
  } finally {
    scope.close();
  }
});

test('functional result rejects a stale runtime projection', async () => {
  const scope = fixture({
    workClass: 'product-behavior',
    runtimeClass: 'native-desktop',
    deployProfiles: ['dwf-local'],
    gates: ['chat-gate'],
  });
  try {
    await start(scope);
    await transition(scope, 'IMPLEMENTING');
    await transition(scope, 'FOCUSED_CHECKING');
    await transition(scope, 'FOCUSED_PASS', {
      verification: verification('SOURCE_CHECK', 'PASS'),
    });
    await transition(scope, 'CHECKPOINTING');

    await rejectCode('SESSION_EVIDENCE_OUT_OF_SEQUENCE', () =>
      commitFunctionalPass(scope),
    );

    const journal = readSessionJournal({
      home: scope.home,
      workspaceRoot: REPO_ROOT,
      workItemId: scope.workItemId,
      clock: scope.clock,
    });
    assert.equal(journal.events.at(-1).snapshot.state, 'CHECKPOINTING');
  } finally {
    scope.close();
  }
});

test('functional result commit rejects substituted source evidence', async () => {
  const scope = fixture({
    workClass: 'product-behavior',
    runtimeClass: 'native-desktop',
    deployProfiles: ['dwf-local'],
    gates: ['chat-gate'],
  });
  try {
    await start(scope);
    await transition(scope, 'IMPLEMENTING');
    await transition(scope, 'FOCUSED_CHECKING');
    await transition(scope, 'FOCUSED_PASS', {
      verification: verification('SOURCE_CHECK', 'PASS'),
    });
    await advanceRuntimeToFunctionalRunning(scope);

    await rejectCode('SESSION_EVIDENCE_OUT_OF_SEQUENCE', () =>
      commitFunctionalPass(scope, {
        manifest: {
          source: {
            commit: '9'.repeat(40),
            workspaceDigest: 'clean',
          },
        },
      }),
    );
  } finally {
    scope.close();
  }
});

test('functional result commit accepts the standard development policy envelope', async () => {
  const scope = fixture({
    workClass: 'product-behavior',
    runtimeClass: 'native-desktop',
    deployProfiles: ['dwf-local'],
    gates: ['chat-gate'],
  });
  try {
    await start(scope);
    await transition(scope, 'IMPLEMENTING');
    await transition(scope, 'FOCUSED_CHECKING');
    await transition(scope, 'FOCUSED_PASS', {
      verification: verification('SOURCE_CHECK', 'PASS'),
    });
    await advanceRuntimeToFunctionalRunning(scope);
    const committed = await commitStandardizedFunctionalPass(scope);
    assert.equal(committed.state.state, 'FUNCTIONAL_PASS');
    assert.match(
      committed.state.lastVerification.artifactRefs[0],
      /checks\/functional-result-/,
    );
    rmSync(
      path.join(
        sessionStorePaths({
          home: scope.home,
          workspaceRoot: REPO_ROOT,
          workspaceId: WORKSPACE_ID,
          workItemId: scope.workItemId,
        }).directory,
        'artifacts',
      ),
      { recursive: true, force: true },
    );
    const sealed = JSON.parse(
      readFileSync(
        committed.state.lastVerification.artifactRefs[0],
        'utf8',
      ),
    );
    assert.equal(
      sealed.artifactKind,
      'development-functional-evidence-bundle',
    );
    assert.ok(sealed.artifacts.length >= 7);
  } finally {
    scope.close();
  }
});

test('functional result accepts the Gate-owned runtime manifest reference', async () => {
  const scope = fixture({
    workClass: 'product-behavior',
    runtimeClass: 'native-desktop',
    deployProfiles: ['dwf-local'],
    gates: ['chat-gate'],
  });
  try {
    await start(scope);
    await transition(scope, 'IMPLEMENTING');
    await transition(scope, 'FOCUSED_CHECKING');
    await transition(scope, 'FOCUSED_PASS', {
      verification: verification('SOURCE_CHECK', 'PASS'),
    });
    await advanceRuntimeToFunctionalRunning(scope);
    const committed = await commitStandardizedFunctionalPass(scope, {
      result: { manifest: undefined },
    });
    assert.equal(committed.state.state, 'FUNCTIONAL_PASS');
  } finally {
    scope.close();
  }
});

test('functional result rejects a conflicting child runtime manifest reference', async () => {
  const scope = fixture({
    workClass: 'product-behavior',
    runtimeClass: 'native-desktop',
    deployProfiles: ['dwf-local'],
    gates: ['chat-gate'],
  });
  try {
    await start(scope);
    await transition(scope, 'IMPLEMENTING');
    await transition(scope, 'FOCUSED_CHECKING');
    await transition(scope, 'FOCUSED_PASS', {
      verification: verification('SOURCE_CHECK', 'PASS'),
    });
    await advanceRuntimeToFunctionalRunning(scope);
    await rejectCode('SESSION_EVIDENCE_OUT_OF_SEQUENCE', () =>
      commitStandardizedFunctionalPass(scope, {
        result: { manifest: { _manifest_ref: {} } },
      }),
    );
  } finally {
    scope.close();
  }
});

test('functional result accepts lowercase passed Gate evidence', async () => {
  const scope = fixture({
    workClass: 'product-behavior',
    runtimeClass: 'native-desktop',
    deployProfiles: ['dwf-local'],
    gates: ['chat-gate'],
  });
  try {
    await start(scope);
    await transition(scope, 'IMPLEMENTING');
    await transition(scope, 'FOCUSED_CHECKING');
    await transition(scope, 'FOCUSED_PASS', {
      verification: verification('SOURCE_CHECK', 'PASS'),
    });
    await advanceRuntimeToFunctionalRunning(scope);
    const committed = await commitStandardizedFunctionalPass(scope, {
      sourceArtifact: { status: 'passed' },
    });
    assert.equal(committed.state.state, 'FUNCTIONAL_PASS');
  } finally {
    scope.close();
  }
});

test('functional result forwards authorized and claimed Station profiles', async () => {
  const scope = fixture({
    workClass: 'product-behavior',
    runtimeClass: 'native-desktop',
    deployProfiles: ['dwf-local', 'chat-four', 'chat-five'],
    runtimeClaims: [
      'shared:profile:chat-four',
      'shared:profile:chat-five',
    ].join(';'),
    gates: ['chat-gate'],
  });
  try {
    await start(scope);
    await transition(scope, 'IMPLEMENTING');
    await transition(scope, 'FOCUSED_CHECKING');
    await transition(scope, 'FOCUSED_PASS', {
      verification: verification('SOURCE_CHECK', 'PASS'),
    });
    await advanceRuntimeToFunctionalRunning(scope);
    const committed = await commitStandardizedFunctionalPass(scope, {
      options: {
        stationProfiles: [
          'station-four=chat-four',
          'station-five=chat-five',
        ],
      },
      beforeRunnerReturn(arguments_) {
        assert.deepEqual(
          arguments_.filter(
            (argument, index) =>
              argument === '--station-profile' ||
              arguments_[index - 1] === '--station-profile',
          ),
          [
            '--station-profile',
            'station-four=chat-four',
            '--station-profile',
            'station-five=chat-five',
          ],
        );
      },
    });
    assert.equal(committed.state.state, 'FUNCTIONAL_PASS');
  } finally {
    scope.close();
  }
});

test('functional result rejects invalid Station profile handoffs before launch', async () => {
  for (const candidate of [
    {
      stationProfiles: ['station-four =chat-four'],
      deployProfiles: ['chat-four'],
      runtimeClaims: 'shared:profile:chat-four',
      code: 'INVALID_ARGUMENT',
    },
    {
      stationProfiles: [
        'station-four=chat-four',
        'station-four=chat-five',
      ],
      deployProfiles: ['chat-four', 'chat-five'],
      runtimeClaims:
        'shared:profile:chat-four;shared:profile:chat-five',
      code: 'INVALID_ARGUMENT',
    },
    {
      stationProfiles: ['station-five=chat-five'],
      deployProfiles: ['chat-four'],
      runtimeClaims:
        'shared:profile:chat-four;shared:profile:chat-five',
      code: 'SESSION_AUTHORIZATION_REQUIRED',
    },
    {
      stationProfiles: ['station-five=chat-five'],
      deployProfiles: ['chat-four', 'chat-five'],
      runtimeClaims: 'shared:profile:chat-four',
      code: 'SESSION_RUNTIME_REQUIRED',
    },
  ]) {
    const scope = fixture({
      workClass: 'product-behavior',
      runtimeClass: 'native-desktop',
      deployProfiles: candidate.deployProfiles,
      runtimeClaims: candidate.runtimeClaims,
      gates: ['chat-gate'],
    });
    try {
      await start(scope);
      await transition(scope, 'IMPLEMENTING');
      await transition(scope, 'FOCUSED_CHECKING');
      await transition(scope, 'FOCUSED_PASS', {
        verification: verification('SOURCE_CHECK', 'PASS'),
      });
      await advanceRuntimeToFunctionalRunning(scope);
      let runnerCalls = 0;
      await rejectCode(candidate.code, () =>
        commitFunctionalResult(
          {
            ...scope.baseOptions,
            planPath: undefined,
            taskId: undefined,
            journeyId: undefined,
            reason: 'reject invalid Station profile handoff',
            stationProfiles: candidate.stationProfiles,
          },
          {
            ...scope.dependencies,
            spawnDevelopmentRunner() {
              runnerCalls += 1;
              return { status: 1, stdout: '', stderr: '' };
            },
          },
        ),
      );
      assert.equal(runnerCalls, 0);
    } finally {
      scope.close();
    }
  }
});

test('functional result commit accepts the normal FUNCTIONAL_RUNNING state', async () => {
  const scope = fixture({
    workClass: 'product-behavior',
    runtimeClass: 'native-desktop',
    deployProfiles: ['dwf-local'],
    gates: ['chat-gate'],
  });
  try {
    await start(scope);
    await transition(scope, 'IMPLEMENTING');
    await transition(scope, 'FOCUSED_CHECKING');
    await transition(scope, 'FOCUSED_PASS', {
      verification: verification('SOURCE_CHECK', 'PASS'),
    });
    await advanceRuntimeToFunctionalRunning(scope);
    const committed = await commitStandardizedFunctionalPass(scope);
    assert.equal(committed.state.state, 'FUNCTIONAL_PASS');
    assert.equal(
      committed.state.runtimeBindingRef,
      'runtime/dwf-local/lease-1',
    );
  } finally {
    scope.close();
  }
});

test('functional result binds the native mobile runtime class', async () => {
  const scope = fixture({
    workClass: 'product-behavior',
    runtimeClass: 'native-mobile',
    deployProfiles: ['dwf-local'],
    gates: ['chat-gate'],
  });
  try {
    await start(scope);
    await transition(scope, 'IMPLEMENTING');
    await transition(scope, 'FOCUSED_CHECKING');
    await transition(scope, 'FOCUSED_PASS', {
      verification: verification('SOURCE_CHECK', 'PASS'),
    });
    await advanceRuntimeToFunctionalRunning(scope);
    await rejectCode('SESSION_EVIDENCE_OUT_OF_SEQUENCE', () =>
      commitFunctionalPass(scope),
    );
    assert.equal(
      (
        await commitFunctionalPass(scope, {
          manifest: { clients: [{ runtime: 'tauri-ios-simulator' }] },
        })
      ).state.state,
      'FUNCTIONAL_PASS',
    );
  } finally {
    scope.close();
  }
});

test('functional result rejects an illegal Session state before runner launch', async () => {
  const scope = fixture({
    workClass: 'product-behavior',
    runtimeClass: 'native-desktop',
    deployProfiles: ['dwf-local'],
    gates: ['chat-gate'],
  });
  try {
    await start(scope);
    await transition(scope, 'IMPLEMENTING');
    let runnerCalls = 0;
    await rejectCode('SESSION_EVIDENCE_OUT_OF_SEQUENCE', () =>
      commitFunctionalResult(
        {
          ...scope.baseOptions,
          reason: 'must not launch',
        },
        {
          ...scope.dependencies,
          spawnDevelopmentRunner() {
            runnerCalls += 1;
            return { status: 1, stdout: '', stderr: '' };
          },
        },
      ),
    );
    assert.equal(runnerCalls, 0);
  } finally {
    scope.close();
  }
});

test('functional result seals an owner-validated task aggregate without Gates', async () => {
  const scope = fixture({
    workClass: 'infrastructure',
    runtimeClass: 'service',
    deployProfiles: ['dwf-local'],
    gates: [],
  });
  try {
    await start(scope);
    await transition(scope, 'IMPLEMENTING');
    await transition(scope, 'FOCUSED_CHECKING');
    await transition(scope, 'FOCUSED_PASS', {
      verification: verification('SOURCE_CHECK', 'PASS'),
    });
    await advanceRuntimeToFunctionalRunning(scope);

    const resultRef = 'secure-content/W12A/source/result.json';
    const resultPath = path.join(
      scope.home,
      '.peers-touch/dev/workspaces',
      WORKSPACE_ID,
      'development',
      resultRef,
    );
    mkdirSync(path.dirname(resultPath), { recursive: true });
    const result = {
      kind: 'secure-content-schema-activation-aggregate',
      planId: scope.plan.manifest.planId,
      taskId: scope.task.taskId,
      workstreamId: scope.task.workstreamId,
      workspaceId: WORKSPACE_ID,
      sourceCommit: EXPECTED_HEAD,
      completedAt: '2026-09-16T13:00:00.12345Z',
      verificationClass: 'FUNCTIONAL_CHECK',
      result: 'PASS',
    };
    let runnerCalls = 0;
    const writeResult = () => {
      delete result.resultDigest;
      result.resultDigest = createHash('sha256')
        .update(JSON.stringify(canonicalize(result)))
        .digest('hex');
      writeFileSync(resultPath, `${JSON.stringify(result)}\n`, { mode: 0o600 });
    };
    const dependencies = {
      ...scope.dependencies,
      spawnDevelopmentRunner() {
        runnerCalls += 1;
        return { status: 1, stdout: '', stderr: '' };
      },
    };
    result.taskId = 'OTHER-TASK';
    writeResult();
    await rejectCode('SESSION_EVIDENCE_OUT_OF_SEQUENCE', () =>
      commitFunctionalResult(
        {
          ...scope.baseOptions,
          reason: 'reject mismatched task aggregate',
          taskResultRef: resultRef,
        },
        dependencies,
      ),
    );

    result.taskId = scope.task.taskId;
    writeResult();
    const committed = await commitFunctionalResult(
      {
        ...scope.baseOptions,
        reason: 'commit task aggregate',
        taskResultRef: resultRef,
      },
      dependencies,
    );

    assert.equal(runnerCalls, 0);
    assert.equal(committed.state.state, 'FUNCTIONAL_PASS');
    assert.equal(
      committed.state.lastVerification.startedAt,
      '2026-09-16T13:00:00.123Z',
    );
    assert.deepEqual(committed.state.lastVerification.artifactRefs, [resultRef]);
  } finally {
    scope.close();
  }
});

test('functional result CLI rejects a caller-authored result file', async () => {
  await rejectCode('INVALID_ARGUMENT', () =>
    runCli([
      'functional-result',
      '--work-item',
      'dwf-b1',
      '--reason',
      'reject caller result',
      '--result-file',
      '/tmp/forged-result.json',
    ]),
  );
});

test('functional result requires every Gate in the current closure', async () => {
  const scope = fixture({
    workClass: 'product-behavior',
    runtimeClass: 'native-desktop',
    deployProfiles: ['dwf-local'],
    gates: ['chat-gate', 'second-gate'],
  });
  try {
    await start(scope);
    await transition(scope, 'IMPLEMENTING');
    await transition(scope, 'FOCUSED_CHECKING');
    await transition(scope, 'FOCUSED_PASS', {
      verification: verification('SOURCE_CHECK', 'PASS'),
    });
    await advanceRuntimeToFunctionalRunning(scope);
    await rejectCode('SESSION_EVIDENCE_OUT_OF_SEQUENCE', () =>
      commitFunctionalPass(scope),
    );
  } finally {
    scope.close();
  }
});

test('functional result commit rejects dirty source and failed cleanup evidence', async () => {
  const scope = fixture({
    workClass: 'product-behavior',
    runtimeClass: 'native-desktop',
    deployProfiles: ['dwf-local'],
    gates: ['chat-gate'],
  });
  try {
    await start(scope);
    await transition(scope, 'IMPLEMENTING');
    await transition(scope, 'FOCUSED_CHECKING');
    await transition(scope, 'FOCUSED_PASS', {
      verification: verification('SOURCE_CHECK', 'PASS'),
    });
    await advanceRuntimeToFunctionalRunning(scope);

    await rejectCode('SESSION_EVIDENCE_OUT_OF_SEQUENCE', () =>
      commitFunctionalPass(scope, {
        dependencies: {
          inspectSource() {
            return {
              commit: EXPECTED_HEAD,
              tree: '8'.repeat(40),
              branch: BRANCH,
              clean: false,
              stable: true,
            };
          },
        },
      }),
    );
    await rejectCode('SESSION_EVIDENCE_OUT_OF_SEQUENCE', () =>
      commitFunctionalPass(scope, {
        cleanupArtifact: { status: 'failed' },
      }),
    );
  } finally {
    scope.close();
  }
});

test('functional result commit rejects source drift before journal commit', async () => {
  const scope = fixture({
    workClass: 'product-behavior',
    runtimeClass: 'native-desktop',
    deployProfiles: ['dwf-local'],
    gates: ['chat-gate'],
  });
  try {
    await start(scope);
    await transition(scope, 'IMPLEMENTING');
    await transition(scope, 'FOCUSED_CHECKING');
    await transition(scope, 'FOCUSED_PASS', {
      verification: verification('SOURCE_CHECK', 'PASS'),
    });
    await advanceRuntimeToFunctionalRunning(scope);
    let observations = 0;
    await rejectCode('SESSION_EVIDENCE_OUT_OF_SEQUENCE', () =>
      commitFunctionalPass(scope, {
        dependencies: {
          inspectSource() {
            observations += 1;
            return {
              commit: EXPECTED_HEAD,
              tree: '8'.repeat(40),
              branch: BRANCH,
              clean: observations === 1,
              stable: true,
            };
          },
        },
      }),
    );
    const current = statusDevelopmentSession({
      home: scope.home,
      workspaceRoot: REPO_ROOT,
      workItemId: scope.workItemId,
      clock: scope.clock,
    });
    assert.equal(current.state.state, 'FUNCTIONAL_RUNNING');
  } finally {
    scope.close();
  }
});

test('functional result rejects evidence from an earlier functional attempt', async () => {
  const scope = fixture({
    workClass: 'product-behavior',
    runtimeClass: 'native-desktop',
    deployProfiles: ['dwf-local'],
    gates: ['chat-gate'],
  });
  try {
    await start(scope);
    await transition(scope, 'IMPLEMENTING');
    await transition(scope, 'FOCUSED_CHECKING');
    await transition(scope, 'FOCUSED_PASS', {
      verification: verification('SOURCE_CHECK', 'PASS'),
    });
    await advanceRuntimeToFunctionalRunning(scope);
    await rejectCode('SESSION_EVIDENCE_OUT_OF_SEQUENCE', () =>
      commitFunctionalPass(scope, {
        beforeRunnerReturn() {
          restartFunctionalAttempt(scope);
        },
      }),
    );
    const current = statusDevelopmentSession({
      home: scope.home,
      workspaceRoot: REPO_ROOT,
      workItemId: scope.workItemId,
      clock: scope.clock,
    });
    assert.equal(current.state.state, 'FUNCTIONAL_RUNNING');
    assert.equal(current.state.runtimeBindingRef, 'runtime/dwf-local/lease-2');
  } finally {
    scope.close();
  }
});

test('functional result commit leaves no partial transitions when a guard fails', async () => {
  const scope = fixture({
    workClass: 'product-behavior',
    runtimeClass: 'native-desktop',
    deployProfiles: ['dwf-local'],
    gates: ['chat-gate'],
  });
  try {
    await start(scope);
    await transition(scope, 'IMPLEMENTING');
    await transition(scope, 'FOCUSED_CHECKING');
    await transition(scope, 'FOCUSED_PASS', {
      verification: verification('SOURCE_CHECK', 'PASS'),
    });
    await advanceRuntimeToFunctionalRunning(scope);

    await rejectCode('SESSION_BOUNDS_EXCEEDED', () =>
      commitFunctionalPass(scope, { options: { maxBytes: 1 } }),
    );
    const current = statusDevelopmentSession({
      home: scope.home,
      workspaceRoot: REPO_ROOT,
      workItemId: scope.workItemId,
      clock: scope.clock,
    });
    assert.equal(current.state.state, 'FUNCTIONAL_RUNNING');
    assert.equal(current.state.source.commit, EXPECTED_HEAD);
    assert.equal(current.state.runtimeBindingRef, 'runtime/dwf-local/lease-1');
    const checks = path.join(
      sessionStorePaths({
        home: scope.home,
        workspaceRoot: REPO_ROOT,
        workspaceId: WORKSPACE_ID,
        workItemId: scope.workItemId,
      }).directory,
      'checks',
    );
    assert.equal(existsSync(checks), false);
  } finally {
    scope.close();
  }
});

test('functional result retains a published seal when Session commit fails', async () => {
  const scope = fixture({
    workClass: 'product-behavior',
    runtimeClass: 'native-desktop',
    deployProfiles: ['dwf-local'],
    gates: ['chat-gate'],
  });
  try {
    await start(scope);
    await transition(scope, 'IMPLEMENTING');
    await transition(scope, 'FOCUSED_CHECKING');
    await transition(scope, 'FOCUSED_PASS', {
      verification: verification('SOURCE_CHECK', 'PASS'),
    });
    await advanceRuntimeToFunctionalRunning(scope);
    let sealPath = null;
    await assert.rejects(
      commitFunctionalPass(scope, {
        dependencies: {
          writeDurableFileAtomic(file, bytes) {
            sealPath = file;
            writeDurableFileAtomic(file, bytes);
            throw new Error('simulated post-publish failure');
          },
        },
      }),
      /simulated post-publish failure/,
    );
    assert.equal(
      statusDevelopmentSession({
        home: scope.home,
        workspaceRoot: REPO_ROOT,
        workItemId: scope.workItemId,
        clock: scope.clock,
      }).state.state,
      'FUNCTIONAL_RUNNING',
    );
    assert.equal(typeof sealPath, 'string');
    assert.equal(existsSync(sealPath), true);
    assert.equal(
      (await commitFunctionalPass(scope)).state.state,
      'FUNCTIONAL_PASS',
    );
  } finally {
    scope.close();
  }
});

test('documentation closes after focused checks without a functional claim', async () => {
  const scope = fixture({
    workClass: 'documentation',
    completionClass: 'source',
    runtimeClass: 'source-only',
  });
  try {
    await start(scope);
    await transition(scope, 'IMPLEMENTING');
    await transition(scope, 'FOCUSED_CHECKING');
    await transition(scope, 'FOCUSED_PASS', {
      verification: verification('SOURCE_CHECK', 'PASS'),
    });
    assert.equal(
      (await transition(scope, 'SOURCE_READY')).state.state,
      'SOURCE_READY',
    );
  } finally {
    scope.close();
  }
});

test('acceptance aggregate skips functional execution and requires formal proof', async () => {
  const scope = fixture({
    completionClass: 'acceptance-aggregate',
    gates: ['development-workflow-control-plane'],
  });
  try {
    await start(scope);
    await transition(scope, 'IMPLEMENTING');
    await transition(scope, 'FOCUSED_CHECKING');
    await transition(scope, 'FOCUSED_PASS', {
      verification: verification('STRUCTURAL_CHECK', 'PASS'),
    });
    await rejectCode('SESSION_TRANSITION_INVALID', () =>
      transition(scope, 'FUNCTIONAL_RUNNING'),
    );
    await transition(scope, 'ACCEPTANCE_RUNNING');
    await rejectCode('SESSION_VERIFICATION_REQUIRED', () =>
      transition(scope, 'ACCEPTANCE_PASS'),
    );
    await transition(scope, 'ACCEPTANCE_PASS', {
      verification: verification('ACCEPTANCE_PROOF', 'PASS'),
    });
    assert.equal(
      (await transition(scope, 'DELIVERY_READY')).state.state,
      'DELIVERY_READY',
    );
  } finally {
    scope.close();
  }
});

test('acceptance aggregate requires a non-empty formal Gate closure', async () => {
  const scope = fixture({
    completionClass: 'acceptance-aggregate',
  });
  try {
    await start(scope);
    await transition(scope, 'IMPLEMENTING');
    await transition(scope, 'FOCUSED_CHECKING');
    await transition(scope, 'FOCUSED_PASS', {
      verification: verification('SOURCE_CHECK', 'PASS'),
    });
    await rejectCode('SESSION_TRANSITION_INVALID', () =>
      transition(scope, 'ACCEPTANCE_RUNNING'),
    );
  } finally {
    scope.close();
  }
});

test('failure recovery, cleanup, and cancellation remain explicit', async () => {
  const scope = fixture();
  try {
    await start(scope);
    await transition(scope, 'IMPLEMENTING');
    await rejectCode('SESSION_TRANSITION_INVALID', () =>
      transition(scope, 'FAILED', {
        failure: failure('DEPLOYING'),
      }),
    );
    await transition(scope, 'FAILED', {
      failure: failure('IMPLEMENTING'),
    });
    await rejectCode('SESSION_TRANSITION_INVALID', () =>
      transition(scope, 'IMPLEMENTING'),
    );
    await transition(scope, 'IMPLEMENTING', { failure: null });
    await transition(scope, 'CLEANING', {
      failure: failure('IMPLEMENTING', 'source', 'CANCELLED'),
    });
    const cancelled = await transition(scope, 'CANCELLED');
    assert.equal(cancelled.state.state, 'CANCELLED');
    await rejectCode('SESSION_TRANSITION_INVALID', () =>
      transition(scope, 'BOUND'),
    );
  } finally {
    scope.close();
  }
});

test('host cleanup quarantine requires complete non-retryable identity', async () => {
  const scope = fixture();
  try {
    await start(scope);
    await transition(scope, 'IMPLEMENTING');
    await rejectCode('SESSION_SCHEMA_INVALID', () =>
      transition(scope, 'BLOCKED', {
        failure: {
          ...failure(
            'IMPLEMENTING',
            'host-adapter',
            'HOST_CLEANUP_QUARANTINED',
          ),
          retryable: false,
          ...hostFailureIdentity(scope),
          requestId: 'request-1',
          actionId: 'action-1',
          host: 'trae',
          capability: 'worker',
          nativeAttempted: false,
          adapterAttempted: true,
          resourceId: 'host-tool:worker-1',
          cleanupHandle: 'cleanup-1',
          cleanupAttempt: 1,
          leaseExpiresAt: '2026-09-16T12:05:00.000Z',
        },
      }),
    );
    const blocked = await transition(scope, 'BLOCKED', {
      failure: {
        ...failure(
          'IMPLEMENTING',
          'host-adapter',
          'HOST_CLEANUP_QUARANTINED',
        ),
        retryable: false,
        ...hostFailureIdentity(scope),
        requestId: 'request-1',
        actionId: 'action-1',
        host: 'trae',
        capability: 'worker',
        nativeAttempted: false,
        adapterAttempted: true,
        resourceId: 'host-tool:worker-1',
        cleanupHandle: 'cleanup-1',
        cleanupAttempt: 1,
        leaseExpiresAt: '2026-09-16T12:05:00.000Z',
        observationRef: 'host-observation:worker-1',
      },
    });
    assert.equal(
      blocked.state.currentFailure.kind,
      'HOST_CLEANUP_QUARANTINED',
    );
    await rejectCode('SESSION_TRANSITION_INVALID', () =>
      transition(scope, 'BLOCKED', {
        failure: blocked.state.currentFailure,
      }),
    );
    await rejectCode('SESSION_TRANSITION_INVALID', () =>
      transition(scope, 'BOUND', { failure: null }),
    );
    const releasedFailure = {
      ...blocked.state.currentFailure,
      kind: 'HOST_CLEANUP_RELEASED',
      summary: 'post-expiry inspection confirmed release',
      observationRef: 'host-observation:worker-1-released',
    };
    await rejectCode('SESSION_TRANSITION_INVALID', () =>
      transition(scope, 'BLOCKED', { failure: releasedFailure }),
    );
    await transition(
      scope,
      'BLOCKED',
      { failure: releasedFailure },
      { clock: () => new Date('2026-09-16T12:06:00.000Z') },
    );
    await transition(scope, 'BOUND', { failure: null });
    await rejectCode('SESSION_TRANSITION_INVALID', () =>
      transition(scope, 'BLOCKED', {
        failure: blocked.state.currentFailure,
      }),
    );
  } finally {
    scope.close();
  }
});

test('host capability exhaustion requires a new availability observation', async () => {
  const scope = fixture();
  try {
    await start(scope);
    await transition(scope, 'IMPLEMENTING');
    const unavailable = {
      ...failure(
        'IMPLEMENTING',
        'host-adapter',
        'HOST_CAPABILITY_UNAVAILABLE',
      ),
      retryable: false,
      ...hostFailureIdentity(scope),
      requestId: 'request-2',
      actionId: 'action-2',
      host: 'codex',
      capability: 'desktop-ui',
      nativeAttempted: true,
      adapterAttempted: true,
      observationRef: 'host-observation:desktop-ui-unavailable',
    };
    await rejectCode('SESSION_TRANSITION_INVALID', () =>
      transition(scope, 'BLOCKED', {
        failure: {
          ...unavailable,
          kind: 'HOST_CAPABILITY_AVAILABLE',
          observationRef: 'host-observation:desktop-ui-available',
        },
      }),
    );
    await transition(scope, 'BLOCKED', { failure: unavailable });
    await rejectCode('SESSION_TRANSITION_INVALID', () =>
      transition(scope, 'BLOCKED', { failure: unavailable }),
    );
    await rejectCode('SESSION_TRANSITION_INVALID', () =>
      transition(scope, 'BOUND', { failure: null }),
    );
    await transition(scope, 'BLOCKED', {
      failure: {
        ...unavailable,
        kind: 'HOST_CAPABILITY_AVAILABLE',
        summary: 'external capability observation changed',
        observationRef: 'host-observation:desktop-ui-available',
      },
    });
    assert.equal(
      (await transition(scope, 'BOUND', { failure: null })).state.state,
      'BOUND',
    );
    await rejectCode('SESSION_TRANSITION_INVALID', () =>
      transition(scope, 'BLOCKED', { failure: unavailable }),
    );
  } finally {
    scope.close();
  }
});

test('replay repairs a journal-ahead snapshot and rejects snapshot-ahead state', async () => {
  const repairScope = fixture();
  try {
    const initial = await start(repairScope);
    await transition(repairScope, 'IMPLEMENTING');
    const paths = sessionStorePaths({
      home: repairScope.home,
      workspaceId: WORKSPACE_ID,
      workItemId: repairScope.workItemId,
    });
    writeFileSync(
      paths.session,
      `${JSON.stringify(initial, null, 2)}\n`,
      { mode: 0o600 },
    );
    const repaired = statusDevelopmentSession({
      home: repairScope.home,
      workspaceRoot: REPO_ROOT,
      workItemId: repairScope.workItemId,
      clock: repairScope.clock,
    });
    assert.equal(repaired.state.state, 'IMPLEMENTING');
    assert.equal(repaired.eventCount, 2);
  } finally {
    repairScope.close();
  }

  const aheadScope = fixture();
  try {
    await start(aheadScope);
    const paths = sessionStorePaths({
      home: aheadScope.home,
      workspaceId: WORKSPACE_ID,
      workItemId: aheadScope.workItemId,
    });
    const snapshot = JSON.parse(readFileSync(paths.session, 'utf8'));
    snapshot.eventCount += 1;
    writeFileSync(paths.session, `${JSON.stringify(snapshot)}\n`);
    expectCode('SESSION_JOURNAL_INVALID', () =>
      statusDevelopmentSession({
        home: aheadScope.home,
        workspaceRoot: REPO_ROOT,
        workItemId: aheadScope.workItemId,
        clock: aheadScope.clock,
      }),
    );
  } finally {
    aheadScope.close();
  }
});

test('read-only Session inspection reports stale projection without repair', async () => {
  const scope = fixture();
  try {
    await start(scope);
    const paths = sessionStorePaths({
      home: scope.home,
      workspaceId: WORKSPACE_ID,
      workItemId: scope.workItemId,
    });
    rmSync(paths.session);

    expectCode('SESSION_PROJECTION_STALE', () =>
      inspectSessionJournal({
        home: scope.home,
        workspaceRoot: REPO_ROOT,
        workItemId: scope.workItemId,
      }),
    );

    assert.equal(existsSync(paths.session), false);
    assert.equal(existsSync(paths.lock), false);
  } finally {
    scope.close();
  }
});

test('read-only Session inspection waits for an in-flight writer', async () => {
  const scope = fixture();
  try {
    await start(scope);
    const paths = sessionStorePaths({
      home: scope.home,
      workspaceId: WORKSPACE_ID,
      workItemId: scope.workItemId,
    });
    const currentSnapshot = readFileSync(paths.session, 'utf8');
    const staleSnapshot = JSON.parse(currentSnapshot);
    staleSnapshot.eventCount += 1;
    writeFileSync(paths.session, `${JSON.stringify(staleSnapshot)}\n`);
    writeFileSync(
      paths.lock,
      `${JSON.stringify({
        pid: process.pid,
        processStart: processStartIdentity(),
        createdAt: new Date().toISOString(),
      })}\n`,
    );

    const childScript = `
      const { inspectSessionJournal } = await import(
        ${JSON.stringify(new URL('./dev-session-store.mjs', import.meta.url).href)}
      );
      try {
        const result = inspectSessionJournal(JSON.parse(process.argv[1]));
        process.stdout.write(JSON.stringify({
          eventDigest: result.session.eventDigest,
          eventCount: result.session.eventCount,
        }));
      } catch (error) {
        process.stderr.write(JSON.stringify({
          code: error?.code,
          message: error?.message,
        }));
        process.exitCode = 2;
      }
    `;
    const child = spawn(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        childScript,
        JSON.stringify({
          home: scope.home,
          workspaceRoot: REPO_ROOT,
          workspaceId: WORKSPACE_ID,
          workItemId: scope.workItemId,
          lockTimeoutMs: 2_000,
        }),
      ],
      { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const exited = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    writeFileSync(paths.session, currentSnapshot);
    rmSync(paths.lock);

    const exit = await exited;
    assert.equal(exit.signal, null);
    assert.equal(exit.code, 0, stderr);
    const inspected = JSON.parse(stdout);
    const expected = JSON.parse(currentSnapshot);
    assert.equal(inspected.eventDigest, expected.eventDigest);
    assert.equal(inspected.eventCount, expected.eventCount);
    assert.equal(existsSync(paths.lock), false);
  } finally {
    scope.close();
  }
});

test('journal corruption is rejected without snapshot replacement', async () => {
  const scope = fixture();
  try {
    await start(scope);
    const paths = sessionStorePaths({
      home: scope.home,
      workspaceId: WORKSPACE_ID,
      workItemId: scope.workItemId,
    });
    const event = JSON.parse(readFileSync(paths.events, 'utf8').trim());
    event.reason = 'tampered';
    writeFileSync(paths.events, `${JSON.stringify(event)}\n`);
    const before = readFileSync(paths.session, 'utf8');
    expectCode('SESSION_JOURNAL_INVALID', () =>
      statusDevelopmentSession({
        home: scope.home,
        workspaceRoot: REPO_ROOT,
        workItemId: scope.workItemId,
        clock: scope.clock,
      }),
    );
    assert.equal(readFileSync(paths.session, 'utf8'), before);
  } finally {
    scope.close();
  }
});

test('compaction preserves the prior digest and continuing sequence', async () => {
  const scope = fixture();
  try {
    await start(scope);
    await transition(scope, 'IMPLEMENTING', {}, { maxEvents: 2 });
    const before = readSessionJournal({
      home: scope.home,
      workspaceRoot: REPO_ROOT,
      workItemId: scope.workItemId,
      clock: scope.clock,
    });
    const priorDigest = before.events.at(-1).eventDigest;
    await transition(scope, 'FOCUSED_CHECKING', {}, { maxEvents: 2 });
    let journal = readSessionJournal({
      home: scope.home,
      workspaceRoot: REPO_ROOT,
      workItemId: scope.workItemId,
      clock: scope.clock,
    });
    assert.equal(journal.events.length, 1);
    assert.equal(journal.events[0].kind, 'COMPACTED_BASELINE');
    assert.equal(journal.events[0].sequence, 3);
    assert.equal(journal.events[0].compactedThrough, 3);
    assert.equal(journal.events[0].previousDigest, priorDigest);
    await transition(
      scope,
      'FOCUSED_PASS',
      { verification: verification('SOURCE_CHECK', 'PASS') },
      { maxEvents: 2 },
    );
    journal = readSessionJournal({
      home: scope.home,
      workspaceRoot: REPO_ROOT,
      workItemId: scope.workItemId,
      clock: scope.clock,
    });
    assert.deepEqual(
      journal.events.map((event) => event.sequence),
      [3, 4],
    );
    assert.equal(
      journal.events[1].previousDigest,
      journal.events[0].eventDigest,
    );
    const timing = summarizeSessionJournal(
      journal.events,
      journal.session.state.updatedAt,
    );
    assert.equal(timing.completeness, 'partial');
    assert.equal(timing.evidence.SOURCE_CHECK, 'PASS');
    assert.equal(timing.evidence.STRUCTURAL_CHECK, 'UNKNOWN');
    assert.equal(timing.evidence.FUNCTIONAL_CHECK, 'UNKNOWN');
  } finally {
    scope.close();
  }
});

test('status rejects Session identity mismatch', async () => {
  const scope = fixture();
  try {
    await start(scope);
    expectCode('SESSION_IDENTITY_MISMATCH', () =>
      statusDevelopmentSession({
        home: scope.home,
        workspaceRoot: REPO_ROOT,
        workItemId: scope.workItemId,
        taskId: 'DWF-B2',
        clock: scope.clock,
      }),
    );
  } finally {
    scope.close();
  }
});

test('direct and symlinked Session CLI invocations both execute', async () => {
  const scope = fixture();
  try {
    await start(scope);
    const cli = fileURLToPath(new URL('./dev-session.mjs', import.meta.url));
    const link = path.join(scope.root, 'dev-session-link.mjs');
    symlinkSync(cli, link);
    assert.ok(lstatSync(link).isSymbolicLink());
    for (const entrypoint of [cli, link]) {
      const result = spawnSync(
        process.execPath,
        [
          entrypoint,
          'status',
          '--home',
          scope.home,
          '--workspace-root',
          REPO_ROOT,
          '--work-item',
          scope.workItemId,
        ],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            DEVELOPER_DIR: '/Library/Developer/CommandLineTools',
          },
        },
      );
      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.status, 'PASS');
      assert.equal(payload.session.state.state, 'BOUND');
    }
  } finally {
    scope.close();
  }
});
