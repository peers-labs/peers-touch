#!/usr/bin/env node

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

import {
  developmentWorkLedgerPath,
  isDirectInvocation,
  repoRoot,
  workspaceStatePath,
} from '../lib/machine-dev-paths.mjs';
import {
  loadPlanPackage,
  summarizePlanProgress,
} from '../plan/plan-package.mjs';
import { resolveWorkspacePlanBinding } from '../plan/workspace-plan-binding.mjs';
import { readActiveWorkRecord } from './active-work-store.mjs';
import {
  inspectSessionJournal,
  summarizeSessionJournal,
} from './dev-session-store.mjs';
import { readLedger } from './dev-work-ledger.mjs';
import { inspectGitWorkspace, isAncestorOf } from './git-workspace.mjs';
import { statusAll as machineStatusAll } from './machine-dev-registry.mjs';

const LIVE_DECLARATION_STATES = new Set(['DECLARED', 'ACTIVE', 'RELEASING']);
const TERMINAL_PLAN_STATES = new Set(['completed', 'superseded']);
const CRITICAL_IDENTITY_OWNERS = new Set(['git', 'plan-binding', 'plan']);
const SNAPSHOT_KIND = 'peers-touch-workflow-snapshot';
const ANCHOR_FRONTIER_LIMIT = 8;
const ANCHOR_EVIDENCE_CLASSES = [
  'SOURCE_CHECK',
  'STRUCTURAL_CHECK',
  'UX_REVIEW',
  'FUNCTIONAL_CHECK',
  'ACCEPTANCE_PROOF',
];

function ownerError(error) {
  return {
    code: error?.code ?? 'WORKFLOW_OWNER_UNAVAILABLE',
    message: error?.message ?? String(error),
  };
}

async function capture(operation) {
  try {
    return { value: await operation(), error: null };
  } catch (error) {
    return { value: null, error: ownerError(error) };
  }
}

function safeBinding(binding) {
  if (!binding) return null;
  return {
    workspaceId: binding.workspaceId,
    planId: binding.planId,
    planPath: binding.planPath,
  };
}

function safePlan(plan, includeAnchorObservation = false) {
  if (!plan) return null;
  const current =
    plan.manifest.tasks.find((task) => task.status === 'in_progress') ?? null;
  const projection = {
    planId: plan.manifest.planId,
    planPath: path
      .relative(plan.repoRoot, plan.path)
      .split(path.sep)
      .join('/'),
    status: plan.manifest.status,
    branch: plan.manifest.binding.branch,
    workspaceId: plan.manifest.binding.workspaceId,
    initialHead: plan.manifest.binding.initialHead,
    currentTaskId: current?.id ?? null,
    currentTaskPath: current?.path ?? null,
    currentJourneyId: current
      ? plan.taskSlices.get(current.id)?.journeyId ?? null
      : null,
    tasks: plan.manifest.tasks.map((task) => ({
      id: task.id,
      status: task.status,
    })),
    progress: summarizePlanProgress(plan),
  };
  if (!includeAnchorObservation) return projection;

  const currentSlice = current ? plan.taskSlices.get(current.id) : null;
  const taskStatuses = new Map(
    plan.manifest.tasks.map((task) => [task.id, task.status]),
  );
  return {
    ...projection,
    currentBlocker: current?.blocker ?? null,
    currentCompletionClass: currentSlice?.completionClass ?? null,
    currentRuntimeClass: currentSlice?.runtimeClass ?? null,
    frontier: {
      readyTaskIds: plan.manifest.tasks
        .filter(
          (task) =>
            plan.manifest.status === 'active' &&
            task.status === 'pending' &&
            task.dependsOn.every(
              (dependency) => taskStatuses.get(dependency) === 'done',
            ),
        )
        .map((task) => task.id),
      blocked: plan.manifest.tasks
        .filter((task) => task.status === 'blocked')
        .map((task) => ({
          taskId: task.id,
          reason: task.blocker?.code ?? 'BLOCKED',
        })),
      waiting: plan.manifest.tasks
        .filter(
          (task) =>
            task.status === 'pending' &&
            task.dependsOn.some(
              (dependency) => taskStatuses.get(dependency) !== 'done',
            ),
        )
        .map((task) => ({
          taskId: task.id,
          reason: `depends:${task.dependsOn
            .filter(
              (dependency) => taskStatuses.get(dependency) !== 'done',
            )
            .join(',')}`,
        })),
    },
  };
}

function boundedFrontier(frontier, terminalState) {
  if (!frontier) return null;
  const bounded = (items) => ({
    items: items.slice(0, ANCHOR_FRONTIER_LIMIT),
    total: items.length,
    hidden: Math.max(0, items.length - ANCHOR_FRONTIER_LIMIT),
  });
  if (terminalState !== null) {
    return {
      ready: bounded([]),
      blocked: bounded([]),
      waiting: bounded([]),
      terminalState,
    };
  }
  return {
    ready: bounded(frontier.readyTaskIds),
    blocked: bounded(frontier.blocked),
    waiting: bounded(frontier.waiting),
    terminalState,
  };
}

function projectCurrentObservation(snapshot) {
  const { plan, session } = snapshot.owners;
  const taskId = plan?.currentTaskId ?? null;
  if (!taskId) {
    return {
      taskId: null,
      sessionId: null,
      status: 'none',
      evidence: null,
      timing: null,
    };
  }

  const sessionUnavailable = snapshot.findings.some(
    (finding) =>
      finding.owner === 'session' && finding.actual === 'unavailable',
  );
  if (!session) {
    return {
      taskId,
      sessionId: null,
      status: sessionUnavailable ? 'unavailable' : 'not-started',
      evidence: sessionUnavailable
        ? null
        : Object.fromEntries(
            ANCHOR_EVIDENCE_CLASSES.map((verificationClass) => [
              verificationClass,
              'NOT_RUN',
            ]),
          ),
      timing: null,
    };
  }

  const timing = session.taskId === taskId ? session.timing ?? null : null;
  if (!timing) {
    return {
      taskId,
      sessionId: session.sessionId,
      status: 'unavailable',
      evidence: null,
      timing: null,
    };
  }

  return {
    taskId,
    sessionId: session.sessionId,
    status:
      timing.completeness === 'unknown' ? 'unavailable' : 'measured',
    evidence: timing.evidence,
    timing: {
      completeness: timing.completeness,
      startedAt: timing.startedAt,
      observedAt: timing.observedAt,
      elapsedMs: timing.elapsedMs,
      phaseMs: timing.phaseMs,
    },
  };
}

function safeDeclaration(declaration) {
  if (!declaration) return null;
  return {
    declarationId: declaration.declarationId,
    workItemId: declaration.workItemId,
    sessionId: declaration.sessionId,
    workspaceId: declaration.workspaceId,
    planId: declaration.planId ?? null,
    planPath: declaration.planPath ?? null,
    taskId: declaration.taskId ?? null,
    journeyId: declaration.journeyId ?? null,
    branch: declaration.branch,
    sourceHead: declaration.sourceHead,
    state: declaration.state,
    expiresAt: declaration.expiresAt,
    runtimeClaims: declaration.runtimeClaims ?? [],
  };
}

function safeSession(session, observation = null) {
  if (!session) return null;
  const store = session.session ?? session;
  const state = store.state;
  const projection = {
    sessionId: state.sessionId,
    workItemId: state.workItemId,
    planId: state.planId,
    taskId: state.taskId,
    workspaceId: state.workspaceId,
    branch: state.branch,
    journeyId: state.journeyId,
    state: state.state,
    updatedAt: state.updatedAt,
    failure: state.currentFailure
      ? {
          kind: state.currentFailure.kind,
          owner: state.currentFailure.owner,
          summary: state.currentFailure.summary,
        }
      : null,
    verification: state.lastVerification
      ? {
          id: state.lastVerification.id,
          verificationClass: state.lastVerification.verificationClass,
          result: state.lastVerification.result,
        }
      : null,
  };
  if (!observation) return projection;
  return {
    ...projection,
    startedAt: state.startedAt,
    timing: Array.isArray(session.events)
      ? summarizeSessionJournal(session.events, observation.observedAt)
      : null,
  };
}

function safeActiveWork(record) {
  if (!record) return null;
  return {
    workspaceId: record.workspaceId,
    workItemId: record.workItemId,
    planId: record.planId,
    planPath: record.planPath,
    planStatus: record.planStatus,
    currentTaskId: record.currentTaskId,
    currentTaskPath: record.currentTaskPath,
    taskStatus: record.taskStatus,
    sessionId: record.sessionId,
    journeyId: record.journeyId,
    devState: record.devState,
    branch: record.branch,
    initialHead: record.initialHead,
    expectedHead: record.expectedHead,
    revision: record.revision,
    updatedAt: record.updatedAt,
  };
}

function safeRuntime(registration, leases) {
  return {
    registration: registration
      ? {
          workspaceId: registration.workspaceId,
          branch: registration.branch,
          profile: registration.profile ?? null,
          activity: registration.activity ?? null,
          profileState: registration.profileState ?? null,
          profileError: registration.profileError?.code ?? null,
        }
      : null,
    leases: leases.map((lease) => ({
      leaseId: lease.leaseId,
      resourceKind: lease.resourceKind,
      resourceId: lease.resourceId,
      workspaceId: lease.workspaceId,
    })),
  };
}

function safeRollout(receipt) {
  if (!receipt) return null;
  return {
    kind: receipt.kind ?? null,
    state: receipt.state ?? null,
    workspaceId: receipt.workspaceId ?? null,
    branch: receipt.branch ?? null,
    sourceHead: receipt.sourceHead ?? null,
    catalogDigest: receipt.catalogDigest ?? null,
    catalogGitState: receipt.catalogGitState ?? null,
    installedAt: receipt.installedAt ?? null,
  };
}

function addFinding(findings, severity, code, owner, field, expected, actual) {
  findings.push({
    severity,
    code,
    owner,
    field,
    expected: expected ?? null,
    actual: actual ?? null,
  });
}

function compare(findings, owner, field, expected, actual) {
  if (expected !== actual) {
    addFinding(
      findings,
      'error',
      'WORKFLOW_OWNER_MISMATCH',
      owner,
      field,
      expected,
      actual,
    );
  }
}

function ownerUnavailable(findings, owner, error, required) {
  if (!error || !required) return;
  addFinding(
    findings,
    'error',
    error.code,
    owner,
    owner,
    'available',
    'unavailable',
  );
}

function deriveContinuation(plan, findings) {
  const criticalIdentityFailure = findings.some(
    (finding) =>
      finding.severity === 'error' &&
      CRITICAL_IDENTITY_OWNERS.has(finding.owner),
  );
  if (criticalIdentityFailure) return 'HARD_BLOCK';
  if (TERMINAL_PLAN_STATES.has(plan?.status)) return 'COMPLETE';
  if (plan?.status === 'active' && plan.currentTaskId) return 'CONTINUE';
  return 'HARD_BLOCK';
}

export function deriveWorkflowSnapshot(input) {
  const findings = [];
  const git = input.git ?? null;
  const binding = input.binding ?? null;
  const plan = input.plan ?? null;
  const declarations = input.declarations ?? [];
  const declaration = declarations.length === 1 ? declarations[0] : null;
  const session = input.session ?? null;
  const activeWork = input.activeWork ?? null;
  const runtime = input.runtime ?? { registration: null, leases: [] };
  const rollout = input.rollout ?? null;
  const headLineage = input.headLineage ?? {};
  const tracked = binding !== null || plan !== null || activeWork !== null ||
    declarations.length > 0;

  ownerUnavailable(findings, 'git', input.errors?.git, true);
  ownerUnavailable(findings, 'plan-binding', input.errors?.binding, tracked);
  ownerUnavailable(findings, 'plan', input.errors?.plan, binding !== null);
  ownerUnavailable(findings, 'declaration', input.errors?.ledger, tracked);
  ownerUnavailable(
    findings,
    'active-work',
    input.errors?.activeWork,
    plan?.status === 'active' || plan?.status === 'blocked',
  );
  if (git?.stable === false) {
    addFinding(
      findings,
      'error',
      'WORKFLOW_GIT_UNSTABLE',
      'git',
      'stable',
      true,
      false,
    );
  }
  ownerUnavailable(
    findings,
    'session',
    input.errors?.session,
    plan?.status === 'active' || plan?.status === 'blocked',
  );

  if (declarations.length > 1) {
    addFinding(
      findings,
      'error',
      'WORKFLOW_DECLARATION_AMBIGUOUS',
      'declaration',
      'liveDeclarationCount',
      1,
      declarations.length,
    );
  } else if (
    declarations.length === 0 &&
    (plan?.status === 'active' || plan?.status === 'blocked')
  ) {
    addFinding(
      findings,
      'error',
      'WORKFLOW_DECLARATION_MISSING',
      'declaration',
      'liveDeclarationCount',
      1,
      0,
    );
  }

  if (git && binding) {
    compare(findings, 'plan-binding', 'workspaceId', git.workspaceId, binding.workspaceId);
  }
  if (git && plan) {
    compare(findings, 'plan', 'workspaceId', git.workspaceId, plan.workspaceId);
    compare(findings, 'plan', 'branch', git.branch, plan.branch);
  }
  if (binding && plan) {
    compare(findings, 'plan', 'planId', binding.planId, plan.planId);
    compare(findings, 'plan', 'planPath', binding.planPath, plan.planPath);
  }
  if (declaration && plan && git) {
    for (const [field, expected, actual] of [
      ['workspaceId', git.workspaceId, declaration.workspaceId],
      ['planId', plan.planId, declaration.planId],
      ['planPath', plan.planPath, declaration.planPath],
      ['branch', git.branch, declaration.branch],
    ]) {
      compare(findings, 'declaration', field, expected, actual);
    }
    if (
      declaration.sourceHead !== git.commit &&
      !headLineage.declarationSourceHeadIsAncestor
    ) {
      compare(findings, 'declaration', 'sourceHead', git.commit, declaration.sourceHead);
    }
    if (
      ['active', 'blocked'].includes(plan.status) &&
      declaration.state !== 'ACTIVE'
    ) {
      compare(findings, 'declaration', 'state', 'ACTIVE', declaration.state);
    }
    if (plan.status === 'active') {
      compare(
        findings,
        'declaration',
        'taskId',
        plan.currentTaskId,
        declaration.taskId,
      );
      compare(
        findings,
        'declaration',
        'journeyId',
        plan.currentJourneyId,
        declaration.journeyId,
      );
    }
  }

  if (declaration && session) {
    for (const [field, expected, actual] of [
      ['sessionId', declaration.sessionId, session.sessionId],
      ['workItemId', declaration.workItemId, session.workItemId],
      ['planId', declaration.planId, session.planId],
      ['taskId', declaration.taskId, session.taskId],
      ['workspaceId', declaration.workspaceId, session.workspaceId],
      ['branch', declaration.branch, session.branch],
      ['journeyId', declaration.journeyId, session.journeyId],
    ]) {
      compare(findings, 'session', field, expected, actual);
    }
  }

  if (activeWork && declaration && plan && git) {
    const task =
      plan.tasks.find((candidate) => candidate.id === declaration.taskId) ?? null;
    const taskPath = task && plan.planPath
      ? path.posix.join(path.posix.dirname(plan.planPath), `tasks/${task.id}.md`)
      : null;
    for (const [field, expected, actual] of [
      ['workspaceId', git.workspaceId, activeWork.workspaceId],
      ['workItemId', declaration.workItemId, activeWork.workItemId],
      ['planId', plan.planId, activeWork.planId],
      ['planPath', plan.planPath, activeWork.planPath],
      ['planStatus', plan.status, activeWork.planStatus],
      ['currentTaskId', declaration.taskId, activeWork.currentTaskId],
      ['currentTaskPath', taskPath, activeWork.currentTaskPath],
      ['taskStatus', task?.status ?? null, activeWork.taskStatus],
      ['sessionId', declaration.sessionId, activeWork.sessionId],
      ['journeyId', declaration.journeyId, activeWork.journeyId],
      ['devState', session?.state ?? null, activeWork.devState],
      ['branch', git.branch, activeWork.branch],
      ['initialHead', plan.initialHead, activeWork.initialHead],
    ]) {
      compare(findings, 'active-work', field, expected, actual);
    }
    if (
      activeWork.expectedHead !== git.commit &&
      !headLineage.expectedHeadIsAncestor
    ) {
      compare(findings, 'active-work', 'expectedHead', git.commit, activeWork.expectedHead);
    }
  } else if (
    !activeWork &&
    (plan?.status === 'active' || plan?.status === 'blocked')
  ) {
    addFinding(
      findings,
      'error',
      'WORKFLOW_ACTIVE_WORK_MISSING',
      'active-work',
      'record',
      'present',
      'missing',
    );
  }

  const registration = runtime.registration;
  if (registration && git) {
    compare(
      findings,
      'runtime',
      'registration.workspaceId',
      git.workspaceId,
      registration.workspaceId,
    );
    compare(
      findings,
      'runtime',
      'registration.branch',
      git.branch,
      registration.branch,
    );
  } else if (!registration) {
    addFinding(
      findings,
      'warning',
      'WORKFLOW_REGISTRATION_MISSING',
      'runtime',
      'registration',
      'present',
      'missing',
    );
  }
  const runtimeClaims = declaration?.runtimeClaims ?? [];
  if (input.errors?.runtime) {
    addFinding(
      findings,
      runtimeClaims.length > 0 ? 'error' : 'warning',
      input.errors.runtime.code,
      'runtime',
      'observation',
      'available',
      'unavailable',
    );
  }
  for (const lease of runtime.leases) {
    const claimed = runtimeClaims.some(
      (claim) =>
        claim.kind === lease.resourceKind &&
        claim.resourceId === lease.resourceId,
    );
    if (!claimed) {
      addFinding(
        findings,
        'error',
        'WORKFLOW_RUNTIME_LEASE_UNDECLARED',
        'runtime',
        `${lease.resourceKind}:${lease.resourceId}`,
        'declared',
        'unclaimed',
      );
    }
  }
  if (
    runtimeClaims.length > 0 &&
    registration?.profileState === 'blocked'
  ) {
    addFinding(
      findings,
      'blocker',
      registration.profileError ?? 'WORKFLOW_RUNTIME_BLOCKED',
      'runtime',
      'profileState',
      'available',
      'blocked',
    );
  }

  if (input.errors?.rollout) {
    addFinding(
      findings,
      'warning',
      input.errors.rollout.code,
      'rollout',
      'receipt',
      'readable',
      'invalid',
    );
  } else if (!rollout) {
    addFinding(
      findings,
      'warning',
      'WORKFLOW_ROLLOUT_OBSERVATION_MISSING',
      'rollout',
      'receipt',
      'present',
      'missing',
    );
  } else if (git) {
    for (const [field, expected, actual] of [
      ['state', 'INSTALLED', rollout.state],
      ['workspaceId', git.workspaceId, rollout.workspaceId],
      ['branch', git.branch, rollout.branch],
      ['sourceHead', git.commit, rollout.sourceHead],
    ]) {
      if (expected !== actual) {
        addFinding(
          findings,
          'warning',
          'WORKFLOW_ROLLOUT_DRIFT',
          'rollout',
          field,
          expected,
          actual,
        );
      }
    }
  }

  const explicitlyBlocked =
    plan?.status === 'blocked' ||
    session?.state === 'BLOCKED' ||
    findings.some((finding) => finding.severity === 'blocker');
  const hasDrift = findings.some((finding) => finding.severity === 'error');
  const suspended =
    !tracked ||
    TERMINAL_PLAN_STATES.has(plan?.status) ||
    plan?.status === 'prepared';
  const verdict = hasDrift
    ? 'DRIFT'
    : explicitlyBlocked
      ? 'BLOCKED'
      : suspended
        ? 'SUSPENDED'
        : 'HEALTHY';
  const continuation = deriveContinuation(plan, findings);

  return {
    kind: SNAPSHOT_KIND,
    observedAt: input.observedAt,
    workspaceId: git?.workspaceId ?? binding?.workspaceId ?? null,
    verdict,
    continuation,
    findings,
    owners: {
      git,
      binding,
      plan,
      declaration,
      session,
      activeWork,
      runtime,
      rollout,
    },
  };
}

export function projectContextAnchor(snapshot, options = {}) {
  const { git, plan, session, activeWork } = snapshot.owners;
  return {
    kind: 'peers-touch-context-anchor-projection',
    observedAt: snapshot.observedAt,
    verdict: snapshot.verdict,
    continuation: snapshot.continuation,
    findings: snapshot.findings,
    plan: plan
      ? {
          planId: plan.planId,
          planPath: plan.planPath,
          status: plan.status,
          progress: plan.progress,
        }
      : null,
    current: plan
      ? {
          taskId: plan.currentTaskId,
          taskPath: plan.currentTaskPath,
          journeyId: plan.currentJourneyId,
          sessionState: session?.state ?? null,
          completionClass: plan.currentCompletionClass,
          runtimeClass: plan.currentRuntimeClass,
          blocker: session?.failure ?? plan.currentBlocker,
        }
      : null,
    frontier: boundedFrontier(
      plan?.frontier,
      TERMINAL_PLAN_STATES.has(plan?.status) ? plan.status : null,
    ),
    currentObservation: projectCurrentObservation(snapshot),
    binding:
      git || plan || activeWork
        ? {
            worktreeName: options.worktreeName ?? null,
            branch: git?.branch ?? plan?.branch ?? activeWork?.branch ?? null,
            workspaceId: snapshot.workspaceId,
            initialHead: plan?.initialHead ?? activeWork?.initialHead ?? null,
            expectedHead: activeWork?.expectedHead ?? null,
            verifiedHead: git?.commit ?? null,
          }
        : null,
  };
}

function readRolloutReceipt(home, workspaceRoot, workspaceId) {
  const file = path.join(
    workspaceStatePath({ home, repoRoot: workspaceRoot, workspaceId }),
    'workflow',
    'skill-rollout.json',
  );
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

export async function loadWorkflowSnapshot(options = {}, dependencies = {}) {
  const observedAt = (options.now ?? new Date()).toISOString();
  const workspaceRoot = realpathSync(options.workspaceRoot ?? repoRoot);
  const includeAnchorObservation = options.projection === 'anchor';
  const inspectGit = dependencies.inspectGitWorkspace ?? inspectGitWorkspace;
  const gitResult = await capture(() => inspectGit(workspaceRoot));
  const workspaceId = gitResult.value?.workspaceId ?? options.workspaceId;
  const resolveBinding =
    dependencies.resolveWorkspacePlanBinding ?? resolveWorkspacePlanBinding;
  const bindingResult = await capture(() =>
    resolveBinding({ home: options.home, repoRoot: workspaceRoot }),
  );
  const binding = safeBinding(bindingResult.value);
  const loadPlan = dependencies.loadPlanPackage ?? loadPlanPackage;
  const planResult = binding
    ? await capture(() =>
        loadPlan(path.resolve(workspaceRoot, binding.planPath), {
          repoRoot: workspaceRoot,
        }),
      )
    : { value: null, error: null };
  const plan = safePlan(planResult.value, includeAnchorObservation);
  const readWorkLedger = dependencies.readLedger ?? readLedger;
  const ledgerResult = await capture(() =>
    options.ledger ??
    readWorkLedger(
      developmentWorkLedgerPath(options.home),
      options.now ?? new Date(),
    ),
  );
  const declarations = Object.values(
    ledgerResult.value?.declarations ?? {},
  )
    .filter(
      (declaration) =>
        declaration.workspaceId === workspaceId &&
        LIVE_DECLARATION_STATES.has(declaration.state) &&
        Date.parse(declaration.expiresAt) > Date.parse(observedAt),
    )
    .map(safeDeclaration);
  const declaration = declarations.length === 1 ? declarations[0] : null;
  const readActiveWork =
    dependencies.readActiveWorkRecord ?? readActiveWorkRecord;
  const activeWorkResult = workspaceId
    ? await capture(() =>
        options.activeWorkRecord ??
        readActiveWork({
          home: options.home,
          workspaceRoot,
          workspaceId,
        }),
      )
    : { value: null, error: null };
  const activeWork = safeActiveWork(activeWorkResult.value);
  const readSession =
    dependencies.inspectSessionJournal ?? inspectSessionJournal;
  const sessionResult = declaration
    ? await capture(() =>
        readSession({
          home: options.home,
          workspaceRoot,
          workspaceId: declaration.workspaceId,
          workItemId: declaration.workItemId,
          sessionId: declaration.sessionId,
          planId: declaration.planId,
          taskId: declaration.taskId,
          branch: declaration.branch,
          now: options.now,
        }),
      )
    : { value: null, error: null };
  const machineResult = await capture(() =>
    options.machineStatus ??
    (dependencies.machineStatusAll ?? machineStatusAll)({
      home: options.home,
      envRepo: options.envRepo,
    }),
  );
  const registration =
    machineResult.value?.registrations?.find(
      (candidate) => candidate.workspaceId === workspaceId,
    ) ?? null;
  const leases = (machineResult.value?.activeLeases ?? []).filter(
    (lease) => lease.workspaceId === workspaceId,
  );
  const rolloutResult = workspaceId
    ? await capture(() =>
        (dependencies.readRolloutReceipt ?? readRolloutReceipt)(
          options.home,
          workspaceRoot,
          workspaceId,
        ),
      )
    : { value: null, error: null };

  const checkAncestor = dependencies.isAncestorOf ?? isAncestorOf;
  const headLineage = {};
  function probeAncestry(recorded, current) {
    if (!recorded || recorded === current) return undefined;
    try {
      return checkAncestor(workspaceRoot, recorded, current);
    } catch {
      return false;
    }
  }
  if (gitResult.value) {
    const commit = gitResult.value.commit;
    const sourceResult = probeAncestry(declaration?.sourceHead, commit);
    if (sourceResult !== undefined) {
      headLineage.declarationSourceHeadIsAncestor = sourceResult;
    }
    const expectedResult = probeAncestry(activeWork?.expectedHead, commit);
    if (expectedResult !== undefined) {
      headLineage.expectedHeadIsAncestor = expectedResult;
    }
  }

  return deriveWorkflowSnapshot({
    observedAt,
    git: gitResult.value,
    binding,
    plan,
    declarations,
    session: safeSession(
      sessionResult.value,
      includeAnchorObservation ? { observedAt } : null,
    ),
    activeWork,
    runtime: safeRuntime(registration, leases),
    rollout: safeRollout(rolloutResult.value),
    headLineage,
    errors: {
      git: gitResult.error,
      binding: bindingResult.error,
      plan: planResult.error,
      ledger: ledgerResult.error,
      session: sessionResult.error,
      activeWork: activeWorkResult.error,
      runtime: machineResult.error,
      rollout: rolloutResult.error,
    },
  });
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (
      !['--workspace-root', '--home', '--env-repo', '--projection'].includes(
        token,
      )
    ) {
      throw new Error(`Unsupported option: ${token}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${token}`);
    }
    options[
      {
        '--workspace-root': 'workspaceRoot',
        '--home': 'home',
        '--env-repo': 'envRepo',
        '--projection': 'projection',
      }[token]
    ] = value;
    index += 1;
  }
  return options;
}

if (isDirectInvocation(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.projection && options.projection !== 'anchor') {
      throw new Error(`Unsupported projection: ${options.projection}`);
    }
    const snapshot = await loadWorkflowSnapshot(options);
    process.stdout.write(
      `${JSON.stringify(
        options.projection === 'anchor'
          ? projectContextAnchor(snapshot, {
              worktreeName: path.basename(
                realpathSync(options.workspaceRoot ?? repoRoot),
              ),
            })
          : snapshot,
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        status: 'BLOCKED',
        code: error?.code ?? 'WORKFLOW_SNAPSHOT_UNAVAILABLE',
        message: error?.message ?? String(error),
      })}\n`,
    );
    process.exitCode = 2;
  }
}
