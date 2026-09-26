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
  repoRoot,
} from '../../../tooling/scripts/lib/machine-dev-paths.mjs';
import { readAllActiveWorkRecords } from '../../../tooling/scripts/local-dev/active-work-store.mjs';
import { readLedger } from '../../../tooling/scripts/local-dev/dev-work-ledger.mjs';
import { loadWorkflowSnapshot } from '../../../tooling/scripts/local-dev/workflow-snapshot.mjs';
import {
  resetPolicyForProfile,
  statusAll as machineStatusAll,
} from '../../../tooling/scripts/local-dev/machine-dev-registry.mjs';

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
    workspaceId: declaration.workspaceId,
    branch: declaration.branch,
    owner: declaration.owner,
    purpose: declaration.purpose,
    journeyId: declaration.journeyId,
    planId: declaration.planId ?? null,
    taskId: declaration.taskId ?? null,
    state: declaration.state,
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

function workflowPlanProjection(snapshot) {
  const plan = snapshot?.owners?.plan;
  if (!plan) return null;
  const firstError = snapshot.findings.find(
    (finding) => finding.severity === 'error',
  );
  return {
    status: firstError ? 'mismatch' : 'available',
    locatorSource: 'workflow-snapshot',
    planId: plan.planId,
    taskId: plan.currentTaskId,
    planStatus: plan.status,
    currentTaskId: plan.currentTaskId,
    progress: plan.progress,
    errorCode: firstError?.code ?? null,
  };
}

export function deriveWorktrees(
  profiles,
  registrations,
  declarations,
  activeLeases,
  activeWorkRecords = [],
  workflowSnapshots = [],
) {
  const profileByName = new Map(
    profiles.map((profile) => [profile.name, profile]),
  );
  const registrationByWorkspace = new Map(
    registrations
      .filter((registration) => registration.workspaceId)
      .map((registration) => [registration.workspaceId, registration]),
  );
  const workflowByWorkspace = new Map(
    workflowSnapshots.map((snapshot) => [snapshot.workspaceId, snapshot]),
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
      const workflow = workflowByWorkspace.get(workspaceId) ?? null;
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
      const workState = workflow?.verdict === 'DRIFT'
        ? 'drift'
        : workflow?.verdict === 'BLOCKED'
          ? 'blocked'
          : workflow?.verdict === 'SUSPENDED' &&
              ['completed', 'superseded'].includes(
                workflow.owners.plan?.status,
              )
            ? 'completed'
            : activeWork
        ? activeWork.planStatus === 'blocked'
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
            : 'reserved';

      return {
        workspaceId,
        name: registration?.name ?? null,
        workflow,
        activeWork: activeWork ? safeActiveWork(activeWork) : null,
        branches: [
          ...new Set(
            activeWork
              ? [activeWork.branch]
              : work.length > 0
              ? work.map((declaration) => declaration.branch)
              : [registration?.branch].filter(Boolean),
          ),
        ],
        workState,
        activity: registration?.activity ?? 'unregistered',
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
  const activeLeases = (machine.activeLeases ?? []).map(safeLease);
  const workflowLoader = options.loadWorkflowSnapshot ?? loadWorkflowSnapshot;
  const workflowSnapshots =
    options.workflowSnapshots ??
    (
      await Promise.all(
        rawRegistrations
          .filter(
            (registration) =>
              typeof registration.canonicalRoot === 'string' &&
              existsSync(registration.canonicalRoot),
          )
          .map(async (registration) => {
            try {
              return await workflowLoader({
                home: options.home,
                envRepo,
                now,
                workspaceRoot: registration.canonicalRoot,
                ledger,
                activeWorkRecord:
                  activeWork.records.find(
                    (record) =>
                      record.workspaceId === registration.workspaceId,
                  ) ?? null,
                machineStatus: machine,
              });
            } catch (error) {
              return {
                kind: 'peers-touch-workflow-snapshot',
                observedAt: now.toISOString(),
                workspaceId: registration.workspaceId,
                verdict: 'DRIFT',
                findings: [
                  {
                    severity: 'error',
                    code: error?.code ?? 'WORKFLOW_SNAPSHOT_UNAVAILABLE',
                    owner: 'workflow-snapshot',
                    field: 'snapshot',
                    expected: 'available',
                    actual: 'unavailable',
                  },
                ],
                owners: {
                  git: null,
                  binding: null,
                  plan: null,
                  declaration: null,
                  session: null,
                  activeWork: null,
                  runtime: {
                    registration: null,
                    leases: [],
                  },
                  rollout: null,
                },
              };
            }
          }),
      )
    ).sort((left, right) =>
      String(left.workspaceId).localeCompare(String(right.workspaceId)),
    );
  const workflowByWorkspace = new Map(
    workflowSnapshots.map((snapshot) => [snapshot.workspaceId, snapshot]),
  );
  const rawDeclarations = Object.values(ledger.declarations ?? {}).sort(
    (left, right) => left.declarationId.localeCompare(right.declarationId),
  );
  const declarations = rawDeclarations.map((declaration) => {
      const safe = safeDeclaration(declaration);
      if (!VISIBLE_DECLARATION_STATES.has(declaration.state)) {
        return { ...safe, plan: null };
      }
      return {
        ...safe,
        plan: workflowPlanProjection(
          workflowByWorkspace.get(declaration.workspaceId),
        ),
      };
    });

  return {
    kind: 'peers-touch-dev-snapshot',
    observedAt: now.toISOString(),
    server: options.server ?? null,
    authority: machine.authority ?? 'missing',
    profiles,
    registrations,
    declarations,
    activeWork: {
      records: activeWork.records.map(safeActiveWork),
      errors: activeWork.errors,
    },
    workflowSnapshots,
    activeLeases,
    staleLeaseCount: (machine.staleLeaseMetadata ?? []).length,
    unregisteredObservationCount: machine.unregisteredObservations ? 1 : 0,
    worktrees: deriveWorktrees(
      profiles,
      registrations,
      declarations,
      activeLeases,
      activeWork.records,
      workflowSnapshots,
    ),
    occupancy: deriveOccupancy(
      profiles,
      registrations,
      declarations,
      activeLeases,
    ),
  };
}
