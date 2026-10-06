import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import path from 'node:path';

import {
  developmentWorkLedgerPath,
  machineDevRoot,
  repoRoot,
  isDirectInvocation,
} from '../lib/machine-dev-paths.mjs';
import { readAllActiveWorkRecords } from './active-work-store.mjs';
import { statusCompletionReviews } from './completion-review.mjs';
import { loadSessionStore } from './dev-session-store.mjs';
import { readLedger } from './dev-work-ledger.mjs';
import {
  resetPolicyForProfile,
  statusAll as machineStatusAll,
} from './machine-dev-registry.mjs';
import {
  readWorkspaceActions,
  reduceWorkflowActivity,
} from './workflow-action-store.mjs';
import { projectStages } from './workflow-snapshot-core.mjs';
import { resolvePlanExecution } from '../plan/plan-mount.mjs';
import { summarizeExecutionProgress } from '../plan/planctl.mjs';
import { readAllWorktreeObservations } from './worktree-observation-store.mjs';
import { discoverGitWorktrees } from './worktree-discovery.mjs';

const PROFILE_FIELDS = new Set([
  'PT_DEV_PROFILE',
  'PT_DEV_SLOT',
  'PT_STATION_MODE',
  'PT_STATION_NAME',
  'PT_STATION_URL',
  'PT_STATION_DEPLOY_ENV',
  'PT_RELAY_URL',
  'PT_RELAY_DEPLOY_ENV',
]);
const LIVE_DECLARATION_STATES = new Set(['DECLARED', 'ACTIVE', 'RELEASING']);
const VISIBLE_DECLARATION_STATES = new Set([
  ...LIVE_DECLARATION_STATES,
  'STALE',
]);
const SESSION_STATES = [
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
];

function parseSelectedProfile(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    if (!PROFILE_FIELDS.has(key)) continue;
    values[key] = line.slice(separator + 1).trim();
  }
  return values;
}

function publicEndpoint(value) {
  if (!value) return null;
  try {
    const endpoint = new URL(value);
    if (!['http:', 'https:'].includes(endpoint.protocol)) return null;
    const pathname = endpoint.pathname === '/' ? '' : endpoint.pathname;
    return `${endpoint.protocol}//${endpoint.host}${pathname}`;
  } catch {
    return null;
  }
}

function gitResult(envRepo, args) {
  try {
    return {
      ok: true,
      output: execFileSync('git', args, {
        cwd: envRepo,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim(),
    };
  } catch (error) {
    return {
      ok: false,
      output: error?.stderr?.toString().trim() || error.message,
    };
  }
}

function containedPath(root, relativePath) {
  const target = path.resolve(root, ...relativePath.split('/'));
  const relative = path.relative(root, target);
  if (
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return null;
  }
  return target;
}

function stateReached(state, target) {
  const stateIndex = SESSION_STATES.indexOf(state);
  const targetIndex = SESSION_STATES.indexOf(target);
  return stateIndex >= 0 && targetIndex >= 0 && stateIndex >= targetIndex;
}

function segmentState(done, active) {
  return done ? 'done' : active ? 'active' : 'pending';
}

function taskSegments(task, sessionState, reviewState, acceptanceRequired) {
  const sourceDone = stateReached(sessionState, 'FOCUSED_PASS');
  const sourceActive = ['IMPLEMENTING', 'FOCUSED_CHECKING'].includes(
    sessionState,
  );
  const functionalRequired = task?.completionClass !== 'source';
  const functionalDone = stateReached(sessionState, 'FUNCTIONAL_PASS');
  const functionalActive = [
    'CHECKPOINTING',
    'CHECKPOINTED',
    'DEPLOYING',
    'DEPLOYED',
    'FUNCTIONAL_RUNNING',
  ].includes(sessionState);
  const acceptanceDone = stateReached(sessionState, 'ACCEPTANCE_PASS');
  const acceptanceActive = [
    'ACCEPTANCE_READY',
    'ACCEPTANCE_UPDATING',
    'FINAL_CHECKPOINTED',
    'ACCEPTANCE_RUNNING',
  ].includes(sessionState);
  return [
    {
      id: 'source',
      label: 'Source',
      state: segmentState(sourceDone, sourceActive),
    },
    {
      id: 'functional',
      label: 'Functional',
      state: functionalRequired
        ? segmentState(functionalDone, functionalActive)
        : 'not_required',
    },
    {
      id: 'acceptance',
      label: 'Acceptance',
      state: acceptanceRequired
        ? segmentState(acceptanceDone, acceptanceActive)
        : 'not_required',
    },
    {
      id: 'review',
      label: 'Review',
      state:
        reviewState === 'PASS'
          ? 'done'
          : reviewState === 'PENDING'
            ? 'active'
            : ['FAIL', 'STALE'].includes(reviewState)
              ? 'blocked'
              : 'pending',
    },
  ];
}

function safeSession(session) {
  if (!session?.state) return null;
  return {
    state: session.state.state ?? null,
    updatedAt: session.state.updatedAt ?? null,
    eventDigest: session.eventDigest ?? null,
    lastVerification: session.state.lastVerification
      ? {
          verificationClass:
            session.state.lastVerification.verificationClass ?? null,
          result: session.state.lastVerification.result ?? null,
          durationMs: session.state.lastVerification.durationMs ?? null,
        }
      : null,
    currentFailure: session.state.currentFailure
      ? {
          kind: session.state.currentFailure.kind ?? null,
          stage: session.state.currentFailure.stage ?? null,
          owner: session.state.currentFailure.owner ?? null,
          retryable: session.state.currentFailure.retryable ?? false,
        }
      : null,
  };
}

async function readSessionProjection(declaration, workspaceRoot, options) {
  if (!declaration.sessionId) return { session: null, errorCode: null };
  try {
    const session = options.readSession
      ? await options.readSession({ declaration, workspaceRoot })
      : loadSessionStore({
          home: options.home,
          workspaceRoot,
          workspaceId: declaration.workspaceId,
          workItemId: declaration.workItemId,
          expected: {
            sessionId: declaration.sessionId,
            workItemId: declaration.workItemId,
            planId: declaration.planId,
            taskId: declaration.taskId,
            workspaceId: declaration.workspaceId,
            branch: declaration.branch,
          },
        });
    return { session, errorCode: null };
  } catch (error) {
    return {
      session: null,
      errorCode: error?.code ?? 'SESSION_UNAVAILABLE',
    };
  }
}

async function readReviewProjection(
  declaration,
  planPackage,
  workspaceRoot,
  session,
  options,
) {
  const missing = { state: 'MISSING', reviewedAt: null, reviewId: null };
  if (!['SOURCE_READY', 'DELIVERY_READY'].includes(session?.state?.state)) {
    return missing;
  }
  if (options.readReview) {
    return options.readReview({
      declaration,
      planPackage,
      workspaceRoot,
      session,
    });
  }
  try {
    const reviewStatus = await statusCompletionReviews(
      {
        repoRoot: workspaceRoot,
        workItemId: declaration.workItemId,
      },
      {
        machineRoot: options.machineRoot ?? machineDevRoot(options.home),
        loadPlanContext: async () => planPackage,
        loadSession: async () => session,
      },
    );
    const currentReviews = reviewStatus.reviews
      .filter(
        (review) =>
          review.scope === reviewStatus.current.scope &&
          review.taskId === reviewStatus.current.taskId,
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const selected =
      currentReviews.find((review) => review.state === 'PASS') ??
      currentReviews[0];
    return selected
      ? {
          state: reviewStatus.state,
          reviewedAt: selected.reviewedAt,
          reviewId: selected.reviewId,
        }
      : missing;
  } catch (error) {
    return {
      ...missing,
      state: 'UNAVAILABLE',
      errorCode: error?.code ?? 'COMPLETION_REVIEW_UNAVAILABLE',
    };
  }
}

async function resolveExecutionDetail(
  planPackage,
  declaration,
  workspaceRoot,
  options,
) {
  const sessionProjection = await readSessionProjection(
    declaration,
    workspaceRoot,
    options,
  );
  const review = await readReviewProjection(
    declaration,
    planPackage,
    workspaceRoot,
    sessionProjection.session,
    options,
  );
  const task = planPackage.currentTask;
  const acceptanceRequired =
    (planPackage.acceptance?.closures?.[task?.closureId] ?? []).length > 0;
  return {
    task:
      task == null
        ? null
        : {
            id: task.taskId,
            title: task.title,
            workstreamId: task.workstreamId,
            completionClass: task.completionClass,
            runtimeClass: task.runtimeClass,
            segments: taskSegments(
              task,
              sessionProjection.session?.state?.state ?? null,
              review.state,
              acceptanceRequired,
            ),
          },
    session: safeSession(sessionProjection.session),
    sessionErrorCode: sessionProjection.errorCode,
    review,
  };
}

function unavailablePlan(status, locator = {}, errorCode = null) {
  return {
    status,
    locatorSource: locator.locatorSource ?? null,
    planId: locator.planId ?? null,
    planDigest: null,
    amendmentCount: 0,
    latestAmendment: null,
    taskId: locator.taskId ?? null,
    planStatus: null,
    currentTaskId: null,
    stages: [],
    progress: null,
    task: null,
    session: null,
    sessionErrorCode: null,
    review: { state: 'MISSING', reviewedAt: null, reviewId: null },
    errorCode,
  };
}

export async function resolveDeclarationPlan(
  declaration,
  registration,
  options = {},
) {
  const workspaceRoot = registration?.canonicalRoot;
  if (!workspaceRoot || !existsSync(workspaceRoot)) {
    return unavailablePlan(
      registration ? 'missing' : 'unregistered',
      {},
      registration ? 'WORKTREE_ROOT_UNAVAILABLE' : 'WORKSPACE_UNREGISTERED',
    );
  }

  let mountedExecution;
  try {
    mountedExecution = await (
      options.resolvePlanExecution ?? resolvePlanExecution
    )({
      repoRoot: workspaceRoot,
      home: options.home,
    });
  } catch (error) {
    if (
      !declaration.planPath &&
      error?.code === 'PLAN_MOUNT_REQUIRED'
    ) {
      return unavailablePlan('untracked');
    }
    return unavailablePlan(
      'invalid',
      {},
      error?.code ?? 'PLAN_MOUNT_INVALID',
    );
  }

  if (!declaration.planPath) {
    return unavailablePlan(
      'mismatch',
      {
        locatorSource: 'mount',
        planId: mountedExecution.mount.planId,
      },
      'WORKSPACE_PLAN_DECLARATION_REQUIRED',
    );
  }

  const locator = {
    locatorSource: 'declaration',
    planId: declaration.planId,
    taskId: declaration.taskId,
  };
  let planFile = containedPath(workspaceRoot, declaration.planPath);
  if (!planFile || !existsSync(planFile)) {
    return unavailablePlan('missing', locator, 'PLAN_NOT_FOUND');
  }
  try {
    const canonicalRoot = realpathSync(workspaceRoot);
    const canonicalPlan = realpathSync(planFile);
    const relative = path.relative(canonicalRoot, canonicalPlan);
    if (
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      return unavailablePlan('invalid', locator, 'PLAN_PATH_ESCAPE');
    }
    planFile = canonicalPlan;
  } catch {
    return unavailablePlan('missing', locator, 'PLAN_NOT_FOUND');
  }

  const lifecycleTasks = mountedExecution.snapshot.plan.tasks.map((task) => ({
    ...task,
    status: mountedExecution.run.taskStates[task.id].state,
    blocker: mountedExecution.run.taskStates[task.id].blocker,
  }));
  const currentTaskId = mountedExecution.run.currentTaskId;
  const planPackage = {
    ...mountedExecution.planPackage,
    manifest: {
      ...mountedExecution.snapshot.plan,
      status: mountedExecution.run.state,
      tasks: lifecycleTasks,
      exhaustion: mountedExecution.run.exhaustion,
      binding: mountedExecution.snapshot.executionBinding,
    },
    currentTask: currentTaskId
      ? mountedExecution.planPackage.taskSlices.get(currentTaskId)
      : null,
    execution: mountedExecution,
  };

  const actualHead = gitResult(workspaceRoot, ['rev-parse', 'HEAD']);
  const expected = {
    planId: locator.planId,
    taskId: locator.taskId,
    workspaceId: declaration.workspaceId,
    branch: declaration.branch,
    declarationSourceHead: declaration.sourceHead,
    planDigest: declaration.planDigest,
    mountId: declaration.mountId,
    runId: declaration.runId,
    mountedPlanId: locator.planId,
    mountedPlanPath: declaration.planPath,
  };
  const actual = {
    planId: mountedExecution.snapshot.planId,
    taskId: currentTaskId,
    workspaceId: mountedExecution.snapshot.executionBinding.workspaceId,
    branch: mountedExecution.snapshot.executionBinding.branch,
    declarationSourceHead: actualHead.ok ? actualHead.output : null,
    planDigest: mountedExecution.snapshot.planDigest,
    mountId: mountedExecution.mount.mountId,
    runId: mountedExecution.run.runId,
    mountedPlanId: mountedExecution.mount.planId,
    mountedPlanPath: mountedExecution.mount.planPath,
  };
  if (
    Object.keys(expected).some((field) => expected[field] !== actual[field])
  ) {
    return unavailablePlan('mismatch', locator, 'PLAN_LOCATOR_MISMATCH');
  }

  const execution = await resolveExecutionDetail(
    planPackage,
    declaration,
    workspaceRoot,
    options,
  );
  return {
    status: 'available',
    locatorSource: locator.locatorSource,
    planId: locator.planId,
    planDigest: mountedExecution.snapshot.planDigest,
    amendmentCount: mountedExecution.snapshot.amendmentCount,
    latestAmendment:
      mountedExecution.snapshot.plan.amendments.at(-1) ?? null,
    taskId: locator.taskId,
    planStatus: mountedExecution.run.state,
    currentTaskId,
    stages: projectStages(mountedExecution.run.state),
    progress: summarizeExecutionProgress(mountedExecution),
    ...execution,
    errorCode: null,
  };
}

export function collectProfiles(envRepo) {
  const canonicalEnvRepo = realpathSync(envRepo);
  const profilesRoot = path.join(canonicalEnvRepo, 'peers-touch');
  if (!existsSync(profilesRoot)) return [];

  return readdirSync(profilesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const relativePath = `peers-touch/${entry.name}/profile.env.example`;
      const profileFile = path.join(canonicalEnvRepo, relativePath);
      if (!existsSync(profileFile) || !statSync(profileFile).isFile()) return null;

      const values = parseSelectedProfile(readFileSync(profileFile, 'utf8'));
      const tracked = gitResult(canonicalEnvRepo, [
        'ls-files',
        '--error-unmatch',
        relativePath,
      ]).ok;
      const dirty = tracked
        ? gitResult(canonicalEnvRepo, [
            'status',
            '--porcelain',
            '--',
            `peers-touch/${entry.name}`,
          ]).output !== ''
        : false;
      const sourceState = tracked
        ? dirty
          ? 'tracked-dirty'
          : 'tracked-clean'
        : 'untracked';
      const declaredName = values.PT_DEV_PROFILE ?? null;
      let resetPolicy = null;
      let error = null;
      if (declaredName !== entry.name) {
        error = {
          code: 'PROFILE_IDENTITY_MISMATCH',
          message: 'Profile directory and declared name differ',
        };
      } else {
        try {
          resetPolicy = resetPolicyForProfile(entry.name);
        } catch {
          error = {
            code: 'PROFILE_IDENTITY_INVALID',
            message: 'Profile name is not a canonical identifier',
          };
        }
      }
      if (!error && sourceState !== 'tracked-clean') {
        error = {
          code: 'PROFILE_SOURCE_UNREVIEWED',
          message: 'Profile source is not Git-tracked and clean',
        };
      }

      return {
        name: entry.name,
        slot: Number.isInteger(Number(values.PT_DEV_SLOT))
          ? Number(values.PT_DEV_SLOT)
          : null,
        resetPolicy,
        stationMode: values.PT_STATION_MODE ?? null,
        stationName: values.PT_STATION_NAME ?? null,
        stationUrl: publicEndpoint(values.PT_STATION_URL),
        stationDeployEnvironment: values.PT_STATION_DEPLOY_ENV || null,
        relayUrl: publicEndpoint(values.PT_RELAY_URL),
        relayDeployEnvironment: values.PT_RELAY_DEPLOY_ENV || null,
        sourceState,
        status: error ? 'blocked' : 'available',
        error,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function safeRegistration(registration) {
  return {
    workspaceId: registration.workspaceId ?? null,
    name: registration.name ?? null,
    branch: registration.branch ?? null,
    profile: registration.profile ?? null,
    slot: registration.slot ?? null,
    allowedCapabilities: registration.allowedCapabilities ?? [],
    purpose: registration.purpose ?? null,
    owner: registration.owner ?? null,
    updatedAt: registration.updatedAt ?? null,
    activity: registration.activity ?? 'stale',
    resetPolicy: registration.resetPolicy ?? null,
    profileState: registration.profileState ?? 'blocked',
    profileError: registration.profileError ?? null,
  };
}

function safeDeclaration(declaration) {
  return {
    declarationId: declaration.declarationId,
    workItemId: declaration.workItemId,
    sessionId: declaration.sessionId ?? null,
    workspaceId: declaration.workspaceId,
    branch: declaration.branch,
    owner: declaration.owner,
    purpose: declaration.purpose,
    journeyId: declaration.journeyId,
    planId: declaration.planId ?? null,
    taskId: declaration.taskId ?? null,
    state: declaration.state,
    heartbeatAt: declaration.heartbeatAt ?? null,
    expiresAt: declaration.expiresAt,
    runtimeClaims: declaration.runtimeClaims,
  };
}

function safeActiveWork(record) {
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

function safeLease(lease) {
  return {
    leaseId: lease.leaseId,
    resourceKind: lease.resourceKind,
    resourceId: lease.resourceId,
    workspaceId: lease.workspaceId,
    acquiredAt: lease.acquiredAt,
    expiresAt: lease.expiresAt ?? null,
  };
}

export function deriveOccupancy(
  profiles,
  registrations,
  declarations,
  activeLeases,
) {
  const duplicateSlots = new Set();
  const slotOwners = new Map();
  for (const registration of registrations) {
    if (!Number.isInteger(registration.slot)) continue;
    const owners = slotOwners.get(registration.slot) ?? [];
    owners.push(registration.workspaceId);
    slotOwners.set(registration.slot, owners);
    if (owners.length > 1) duplicateSlots.add(registration.slot);
  }

  return profiles.map((profile) => {
    const profileRegistrations = registrations.filter(
      (registration) => registration.profile === profile.name,
    );
    const workspaceIds = profileRegistrations.map(
      (registration) => registration.workspaceId,
    );
    const profileDeclarations = declarations.filter(
      (declaration) =>
        LIVE_DECLARATION_STATES.has(declaration.state) &&
        (workspaceIds.includes(declaration.workspaceId) ||
          declaration.runtimeClaims.some(
            (claim) =>
              claim.kind === 'profile' && claim.resourceId === profile.name,
          )),
    );
    const profileLeases = activeLeases.filter(
      (lease) =>
        workspaceIds.includes(lease.workspaceId) ||
        (lease.resourceKind === 'station.deploy' &&
          lease.resourceId === profile.stationDeployEnvironment),
    );
    const slots = [
      ...new Set(profileRegistrations.map((registration) => registration.slot)),
    ].filter(Number.isInteger);
    const conflict = slots.some((slot) => duplicateSlots.has(slot));
    const state =
      profile.status === 'blocked'
        ? 'blocked'
        : conflict
          ? 'conflict'
          : profileLeases.length > 0
            ? 'active'
            : profileDeclarations.length > 0 || profileRegistrations.length > 0
              ? 'reserved'
              : 'free';

    return {
      profile: profile.name,
      station: profile.stationUrl,
      resetPolicy: profile.resetPolicy,
      workspaceIds,
      slots,
      workItemIds: [
        ...new Set(
          profileDeclarations.map((declaration) => declaration.workItemId),
        ),
      ],
      leaseIds: profileLeases.map((lease) => lease.leaseId),
      state,
    };
  });
}

function projectRuntimeClaims(declarations) {
  const claims = new Map();
  for (const declaration of declarations) {
    for (const claim of declaration.runtimeClaims) {
      const key = `${claim.kind}:${claim.resourceId}:${claim.mode}`;
      const current = claims.get(key) ?? {
        kind: claim.kind,
        resourceId: claim.resourceId,
        mode: claim.mode,
        workItemIds: [],
      };
      if (!current.workItemIds.includes(declaration.workItemId)) {
        current.workItemIds.push(declaration.workItemId);
      }
      claims.set(key, current);
    }
  }
  return [...claims.values()].sort((left, right) =>
    `${left.kind}:${left.resourceId}:${left.mode}`.localeCompare(
      `${right.kind}:${right.resourceId}:${right.mode}`,
    ),
  );
}

function firstClaim(claims, kind) {
  return claims.find((claim) => claim.kind === kind) ?? null;
}

function latestTimestamp(values, fallback) {
  const valid = values
    .filter(Boolean)
    .map((value) => Date.parse(value))
    .filter(Number.isFinite);
  return valid.length > 0
    ? new Date(Math.max(...valid)).toISOString()
    : fallback;
}

function deriveFreshness({
  discovery,
  discoveryAvailable,
  observation,
  observationError,
  stateUpdatedAt,
  checkedAt,
}) {
  const issues = [];
  let state;
  if (observationError) {
    state = 'invalid';
    issues.push(observationError.code);
  } else if (discoveryAvailable && !discovery) {
    state = 'missing';
    issues.push('WORKTREE_MISSING');
  } else if (!observation) {
    state = 'unreported';
  } else {
    const identityMismatch =
      discovery &&
      (observation.head !== discovery.head ||
        (discovery.branch !== null &&
          observation.branch !== discovery.branch));
    const ageMs = Date.parse(checkedAt) - Date.parse(observation.reportedAt);
    if (identityMismatch) {
      state = 'stale';
      issues.push('WORKTREE_REPORT_STALE');
    } else if (ageMs <= 30_000) {
      state = 'fresh';
    } else if (ageMs <= 300_000) {
      state = 'recent';
    } else {
      state = 'stale';
    }
  }
  const lastReportedAt = observation?.reportedAt ?? null;
  return {
    state,
    issues,
    lastReportedAt,
    stateUpdatedAt,
    checkedAt,
    updatedAt: latestTimestamp(
      [lastReportedAt, stateUpdatedAt, checkedAt],
      checkedAt,
    ),
  };
}

function fallbackTask(activeWork, review) {
  if (!activeWork?.currentTaskId) return null;
  return {
    id: activeWork.currentTaskId,
    title: activeWork.currentTaskId,
    workstreamId: null,
    completionClass: null,
    runtimeClass: null,
    segments: taskSegments(
      null,
      activeWork.devState,
      review.state,
      true,
    ),
  };
}

export function workflowProjection({
  work,
  issues,
  freshness,
  activeWork,
  workspaceId,
  options,
}) {
  const primary =
    work.find(
      (declaration) =>
        LIVE_DECLARATION_STATES.has(declaration.state) &&
        declaration.plan?.status === 'available',
    ) ??
    work.find((declaration) => LIVE_DECLARATION_STATES.has(declaration.state)) ??
    work[0] ??
    null;
  const plan = primary?.plan ?? null;
  const review = plan?.review ?? {
    state: 'MISSING',
    reviewedAt: null,
    reviewId: null,
  };
  const planStatus = plan?.planStatus ?? activeWork?.planStatus ?? null;
  const session =
    plan?.session ??
    (activeWork?.devState
      ? {
          state: activeWork.devState,
          updatedAt: activeWork.updatedAt,
          eventDigest: null,
          lastVerification: null,
          currentFailure: null,
        }
      : null);
  const findings = issues.map((code) => ({
    code,
    owner: 'environment',
    severity: code === 'WORKSPACE_UNREGISTERED' ? 'warning' : 'error',
  }));
  for (const code of freshness.issues) {
    findings.push({
      code,
      owner: 'observation',
      severity: code === 'WORKFLOW_SOURCE_STALE' ? 'error' : 'warning',
    });
  }
  if (plan && plan.status !== 'available') {
    findings.push({
      code: plan.errorCode ?? 'PLAN_UNAVAILABLE',
      owner: 'plan',
      severity: 'error',
    });
  }
  if (plan?.sessionErrorCode) {
    findings.push({
      code: plan.sessionErrorCode,
      owner: 'session',
      severity: 'error',
    });
  }
  if (review.errorCode) {
    findings.push({
      code: review.errorCode,
      owner: 'completion-review',
      severity: 'warning',
    });
  }

  const terminalReviewMissing =
    planStatus === 'completed' && review.state !== 'PASS';
  const drift =
    plan?.status === 'mismatch' ||
    session?.state === 'STALE' ||
    review.state === 'STALE' ||
    freshness.issues.includes('WORKFLOW_SOURCE_STALE') ||
    issues.includes('WORKTREE_IDENTITY_MISMATCH');
  const blocked =
    planStatus === 'blocked' ||
    ['BLOCKED', 'FAILED'].includes(session?.state) ||
    review.state === 'FAIL' ||
    terminalReviewMissing;
  const completed =
    planStatus === 'superseded' ||
    (planStatus === 'completed' && review.state === 'PASS');

  let receipts = [];
  try {
    const readActions = options.readActions ?? readWorkspaceActions;
    receipts = readActions({
      home: options.home,
      workspaceId,
    });
  } catch (error) {
    findings.push({
      code: error?.code ?? 'WORKFLOW_ACTION_STORE_UNAVAILABLE',
      owner: 'action',
      severity: 'warning',
    });
  }
  const agentActivity = reduceWorkflowActivity(receipts, {
    now: options.now,
    drift,
    blocked,
    completed,
    runningPlan: planStatus === 'active',
  });
  const hasError = findings.some((finding) => finding.severity === 'error');
  const verdict = drift
    ? 'DRIFT'
    : blocked || hasError
      ? 'BLOCKED'
      : findings.length > 0
        ? 'SUSPENDED'
        : 'HEALTHY';
  const continuation = drift || blocked || hasError
    ? 'HARD_BLOCK'
    : completed
      ? 'COMPLETE'
      : 'CONTINUE';

  return {
    workflow: {
      verdict,
      continuation,
      stages:
        plan?.stages ??
        (planStatus ? projectStages(planStatus) : []),
      plan:
        plan?.status === 'available'
          ? {
              id: plan.planId,
              digest: plan.planDigest,
              amendmentCount: plan.amendmentCount,
              latestAmendment: plan.latestAmendment,
              status: plan.planStatus,
              progress: plan.progress,
            }
          : activeWork
            ? {
                id: activeWork.planId,
                digest: declaration?.planDigest ?? null,
                amendmentCount: null,
                latestAmendment: null,
                status: activeWork.planStatus,
                progress: null,
              }
            : null,
      task: plan?.task ?? fallbackTask(activeWork, review),
      session,
      review,
      action: agentActivity,
      findings,
    },
    agentActivity,
  };
}

export function deriveWorktrees(
  profiles,
  registrations,
  declarations,
  activeLeases,
  activeWorkRecords = [],
  discoveredWorktrees = [],
  observations = [],
  observationErrors = [],
  checkedAt = new Date().toISOString(),
  discoveryAvailable = true,
  projectionOptions = {},
) {
  const profileByName = new Map(
    profiles.map((profile) => [profile.name, profile]),
  );
  const registrationByWorkspace = new Map(
    registrations
      .filter((registration) => registration.workspaceId)
      .map((registration) => [registration.workspaceId, registration]),
  );
  const discoveryByWorkspace = new Map(
    discoveredWorktrees.map((record) => [record.workspaceId, record]),
  );
  const observationByWorkspace = new Map(
    observations.map((record) => [record.workspaceId, record]),
  );
  const observationErrorByWorkspace = new Map(
    observationErrors.map((error) => [error.workspaceId, error]),
  );
  const visibleDeclarations = declarations.filter((declaration) =>
    VISIBLE_DECLARATION_STATES.has(declaration.state),
  );
  const workspaceIds = new Set(registrationByWorkspace.keys());
  for (const declaration of visibleDeclarations) {
    workspaceIds.add(declaration.workspaceId);
  }
  for (const lease of activeLeases) {
    workspaceIds.add(lease.workspaceId);
  }
  for (const record of activeWorkRecords) {
    workspaceIds.add(record.workspaceId);
  }
  for (const record of discoveredWorktrees) {
    workspaceIds.add(record.workspaceId);
  }
  for (const record of observations) {
    workspaceIds.add(record.workspaceId);
  }
  for (const error of observationErrors) {
    workspaceIds.add(error.workspaceId);
  }

  const slotOwners = new Map();
  for (const registration of registrations) {
    if (!Number.isInteger(registration.slot)) continue;
    const owners = slotOwners.get(registration.slot) ?? [];
    owners.push(registration.workspaceId);
    slotOwners.set(registration.slot, owners);
  }

  return [...workspaceIds]
    .map((workspaceId) => {
      const registration = registrationByWorkspace.get(workspaceId) ?? null;
      const discovery = discoveryByWorkspace.get(workspaceId) ?? null;
      const observation = observationByWorkspace.get(workspaceId) ?? null;
      const observationError =
        observationErrorByWorkspace.get(workspaceId) ?? null;
      const work = visibleDeclarations.filter(
        (declaration) => declaration.workspaceId === workspaceId,
      );
      const liveWork = work.filter((declaration) =>
        LIVE_DECLARATION_STATES.has(declaration.state),
      );
      const leases = activeLeases.filter(
        (lease) => lease.workspaceId === workspaceId,
      );
      const activeWork =
        activeWorkRecords.find((record) => record.workspaceId === workspaceId) ??
        null;
      const activeWorkIdentityMismatch =
        activeWork &&
        discovery &&
        (activeWork.branch !== discovery.branch ||
          activeWork.expectedHead !== discovery.head);
      const claims = projectRuntimeClaims(liveWork);
      const profileClaim = firstClaim(claims, 'profile');
      const slotClaim = firstClaim(claims, 'local.slot');
      const profileName = registration?.profile ?? profileClaim?.resourceId ?? null;
      const profile = profileByName.get(profileName) ?? null;
      const slot = registration?.slot ?? slotClaim?.resourceId ?? null;
      const issues = [];
      if (!registration) issues.push('WORKSPACE_UNREGISTERED');
      if (registration?.activity === 'stale') {
        issues.push('WORKTREE_IDENTITY_MISMATCH');
      }
      if (registration?.profileError?.code) {
        issues.push(registration.profileError.code);
      } else if (profile?.error?.code) {
        issues.push(profile.error.code);
      }
      if (
        Number.isInteger(registration?.slot) &&
        (slotOwners.get(registration.slot)?.length ?? 0) > 1
      ) {
        issues.push('LOCAL_SLOT_CONFLICT');
      }

      const environmentState =
        issues.some((issue) => issue === 'LOCAL_SLOT_CONFLICT')
          ? 'conflict'
          : issues.some((issue) => issue !== 'WORKSPACE_UNREGISTERED')
            ? 'blocked'
            : !registration
              ? 'unregistered'
              : 'ready';
      const workState = activeWork
        ? activeWorkIdentityMismatch
          ? 'stale'
          : activeWork.planStatus === 'blocked'
          ? 'blocked'
          : ['completed', 'superseded'].includes(activeWork.planStatus)
            ? 'completed'
            : 'in-progress'
        : liveWork.length > 0
          ? liveWork.every(
              (declaration) => declaration.plan?.planStatus === 'blocked',
            )
            ? 'blocked'
            : 'in-progress'
          : work.some((declaration) => declaration.state === 'STALE')
            ? 'stale'
            : registration
              ? 'reserved'
              : 'observed';
      const stateUpdatedAt = latestTimestamp(
        [
          registration?.updatedAt,
          ...work.map((declaration) => declaration.heartbeatAt),
          activeWork?.updatedAt,
        ],
        null,
      );
      const freshness = deriveFreshness({
        discovery,
        discoveryAvailable,
        observation,
        observationError,
        stateUpdatedAt,
        checkedAt,
      });
      if (activeWorkIdentityMismatch) {
        freshness.state = 'stale';
        freshness.issues.push('WORKFLOW_SOURCE_STALE');
      }
      const observationMatchesGit =
        observation &&
        discovery &&
        observation.head === discovery.head &&
        (discovery.branch === null ||
          observation.branch === discovery.branch);
      const projection = workflowProjection({
        work,
        issues,
        freshness,
        activeWork,
        workspaceId,
        options: {
          ...projectionOptions,
          now: projectionOptions.now ?? new Date(checkedAt),
        },
      });

      return {
        workspaceId,
        name: discovery?.name ?? observation?.name ?? registration?.name ?? null,
        activeWork: activeWork ? safeActiveWork(activeWork) : null,
        git: discovery
          ? {
              branch: discovery.branch,
              head: discovery.head,
              detached: discovery.detached,
              dirty: observationMatchesGit ? observation.dirty : null,
            }
          : null,
        branches: [
          ...new Set(
            discovery
              ? [
                  discovery.branch ??
                    `detached@${discovery.head.slice(0, 8)}`,
                ]
              : activeWork
                ? [activeWork.branch]
              : work.length > 0
                ? work.map((declaration) => declaration.branch)
                : [
                    observation?.branch,
                    registration?.branch,
                  ].filter(Boolean),
          ),
        ],
        freshness,
        workState,
        activity: registration?.activity ?? 'unregistered',
        agentActivity: projection.agentActivity,
        workflow: projection.workflow,
        environmentHealth: {
          state: environmentState,
          issues,
        },
        requirements: work.map((declaration) => ({
          workItemId: declaration.workItemId,
          journeyId: declaration.journeyId,
          purpose: declaration.purpose,
          state: declaration.state,
          expiresAt: declaration.expiresAt,
          plan: declaration.plan,
        })),
        environment: {
          profile: profileName,
          slot,
          resetPolicy:
            registration?.resetPolicy ??
            profile?.resetPolicy ??
            null,
          sourceState: profile?.sourceState ?? null,
        },
        resources: {
          station: {
            url: profile?.stationUrl ?? null,
            deployEnvironment: profile?.stationDeployEnvironment ?? null,
            claims: claims.filter((claim) => claim.kind.startsWith('station.')),
          },
          relay: {
            url: profile?.relayUrl ?? null,
            deployEnvironment: profile?.relayDeployEnvironment ?? null,
            claims: claims.filter((claim) => claim.kind.startsWith('relay.')),
          },
          databases: claims.filter((claim) => claim.kind === 'database'),
          other: claims.filter(
            (claim) =>
              claim.kind !== 'profile' &&
              claim.kind !== 'local.slot' &&
              claim.kind !== 'database' &&
              !claim.kind.startsWith('station.') &&
              !claim.kind.startsWith('relay.'),
          ),
        },
        leases,
      };
    })
    .sort((left, right) => {
      const leftName = left.name ?? left.branches[0] ?? left.workspaceId;
      const rightName = right.name ?? right.branches[0] ?? right.workspaceId;
      return leftName.localeCompare(rightName);
    });
}

export async function buildDevSnapshot(options = {}) {
  const envRepo = realpathSync(
    options.envRepo ?? path.resolve(repoRoot, '..', 'env'),
  );
  const now = options.now ?? new Date();
  let discovery;
  if (options.discovery) {
    discovery = options.discovery;
  } else if (options.machineStatus) {
    discovery = {
      checkedAt: now.toISOString(),
      records: [],
      error: null,
      available: false,
    };
  } else {
    try {
      discovery = {
        ...discoverGitWorktrees({
          repoRoot: options.repoRoot ?? repoRoot,
          now,
        }),
        error: null,
        available: true,
      };
    } catch (error) {
      discovery = {
        checkedAt: now.toISOString(),
        records: [],
        error: {
          code: error.code ?? 'WORKTREE_DISCOVERY_UNAVAILABLE',
          message: error.message,
        },
        available: false,
      };
    }
  }
  const observations =
    options.observations ??
    (options.machineStatus
      ? { records: [], errors: [] }
      : readAllWorktreeObservations({ home: options.home }));
  const profiles = collectProfiles(envRepo);
  const machine =
    options.machineStatus ??
    machineStatusAll({
      home: options.home,
      envRepo,
    });
  const ledger =
    options.ledger ??
    readLedger(developmentWorkLedgerPath(options.home), now);
  const activeWork =
    options.activeWork ??
    readAllActiveWorkRecords({
      home: options.home,
    });
  const rawRegistrations = machine.registrations ?? [];
  const registrations = rawRegistrations.map(safeRegistration);
  const rawRegistrationByWorkspace = new Map(
    rawRegistrations.map((registration) => [
      registration.workspaceId,
      registration,
    ]),
  );
  const planResolver = options.resolvePlan ?? resolveDeclarationPlan;
  const rawDeclarations = Object.values(ledger.declarations ?? {}).sort(
    (left, right) => left.declarationId.localeCompare(right.declarationId),
  );
  const declarations = await Promise.all(
    rawDeclarations.map(async (declaration) => {
      const safe = safeDeclaration(declaration);
      if (!VISIBLE_DECLARATION_STATES.has(declaration.state)) {
        return { ...safe, plan: null };
      }
      return {
        ...safe,
        plan: await planResolver(
          declaration,
          rawRegistrationByWorkspace.get(declaration.workspaceId) ?? null,
          {
            home: options.home,
            readReview: options.readReview,
            readSession: options.readSession,
          },
        ),
      };
    }),
  );
  const activeLeases = (machine.activeLeases ?? []).map(safeLease);
  const worktrees = deriveWorktrees(
    profiles,
    registrations,
    declarations,
    activeLeases,
    activeWork.records,
    discovery.records,
    observations.records,
    observations.errors,
    discovery.checkedAt,
    discovery.available !== false,
    {
      home: options.home,
      now,
      readActions: options.readActions,
    },
  );
  const occupancy = deriveOccupancy(
    profiles,
    registrations,
    declarations,
    activeLeases,
  );
  const continuations = worktrees.map(
    (worktree) => worktree.workflow.continuation,
  );
  const continuation = continuations.includes('HARD_BLOCK')
    ? 'HARD_BLOCK'
    : continuations.length > 0 &&
        continuations.every((value) => value === 'COMPLETE')
      ? 'COMPLETE'
      : 'CONTINUE';
  const verdicts = worktrees.map((worktree) => worktree.workflow.verdict);
  const verdict = verdicts.includes('DRIFT')
    ? 'DRIFT'
    : verdicts.includes('BLOCKED')
      ? 'BLOCKED'
      : verdicts.includes('SUSPENDED')
        ? 'SUSPENDED'
        : 'HEALTHY';
  const findings = worktrees.flatMap((worktree) =>
    worktree.workflow.findings.map((finding) => ({
      workspaceId: worktree.workspaceId,
      ...finding,
    })),
  );
  const snapshot = {
    kind: 'peers-touch-dev-snapshot',
    observedAt: now.toISOString(),
    server: options.server ?? null,
    serverFreshness: options.serverFreshness ?? null,
    authority: machine.authority ?? 'missing',
    verdict,
    continuation,
    findings,
    discovery: {
      checkedAt: discovery.checkedAt,
      count: discovery.records.length,
      error: discovery.error,
    },
    observations,
    profiles,
    registrations,
    declarations,
    activeWork: {
      records: activeWork.records.map(safeActiveWork),
      errors: activeWork.errors,
    },
    activeLeases,
    staleLeaseCount: (machine.staleLeaseMetadata ?? []).length,
    unregisteredObservationCount: machine.unregisteredObservations ? 1 : 0,
    worktrees,
    occupancy,
  };
  const semantic = {
    ...snapshot,
    observedAt: null,
    server: snapshot.server
      ? { ...snapshot.server, startedAt: null }
      : null,
    serverFreshness: snapshot.serverFreshness
      ? { ...snapshot.serverFreshness, checkedAt: null }
      : null,
    discovery: { ...snapshot.discovery, checkedAt: null },
    worktrees: snapshot.worktrees.map((worktree) => ({
      ...worktree,
      freshness: {
        ...worktree.freshness,
        checkedAt: null,
        updatedAt: null,
      },
      agentActivity: {
        ...worktree.agentActivity,
        lastAction: worktree.agentActivity.lastAction
          ? { ...worktree.agentActivity.lastAction, ageMs: null }
          : null,
      },
      workflow: {
        ...worktree.workflow,
        action: {
          ...worktree.workflow.action,
          lastAction: worktree.workflow.action.lastAction
            ? { ...worktree.workflow.action.lastAction, ageMs: null }
            : null,
        },
      },
    })),
  };
  return {
    ...snapshot,
    digest: createHash('sha256')
      .update(JSON.stringify(semantic))
      .digest('hex'),
  };
}

export async function buildWorkflowSnapshot(options = {}) {
  return buildDevSnapshot(options);
}

if (isDirectInvocation(import.meta.url)) {
  try {
    const snapshot = await buildWorkflowSnapshot();
    process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        ok: false,
        error: {
          code: error?.code ?? 'WORKFLOW_SNAPSHOT_UNAVAILABLE',
          message: 'Workflow snapshot is unavailable',
        },
      })}\n`,
    );
    process.exitCode = 2;
  }
}
