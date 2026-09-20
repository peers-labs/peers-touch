import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import {
  developmentWorkLedgerPath,
  repoRoot,
} from '../../../tooling/scripts/lib/machine-dev-paths.mjs';
import { readLedger } from '../../../tooling/scripts/local-dev/dev-work-ledger.mjs';
import {
  AGENT_CONTROL_MODES,
  statusAll as machineStatusAll,
} from '../../../tooling/scripts/local-dev/machine-dev-registry.mjs';
import {
  loadPlanPackage,
  summarizePlanProgress,
} from '../../../tooling/scripts/plan/plan-package.mjs';
import { resolveWorkspacePlanBinding } from '../../../tooling/scripts/plan/workspace-plan-binding.mjs';

const PROFILE_FIELDS = new Set([
  'PT_DEV_PROFILE',
  'PT_DEV_SLOT',
  'PT_AGENT_CONTROL_MODE',
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

function unavailablePlan(status, locator = {}, errorCode = null) {
  return {
    status,
    locatorSource: locator.locatorSource ?? null,
    planId: locator.planId ?? null,
    taskId: locator.taskId ?? null,
    planStatus: null,
    currentTaskId: null,
    progress: null,
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

  const resolvePlanBinding =
    options.resolveWorkspacePlanBinding ?? resolveWorkspacePlanBinding;
  let workspacePlanBinding;
  try {
    workspacePlanBinding = await resolvePlanBinding({
      repoRoot: workspaceRoot,
      home: options.home,
    });
  } catch (error) {
    if (
      !declaration.planPath &&
      error?.code === 'WORKSPACE_PLAN_BINDING_REQUIRED'
    ) {
      return unavailablePlan('untracked');
    }
    return unavailablePlan(
      'invalid',
      {},
      error?.code ?? 'WORKSPACE_PLAN_BINDING_INVALID',
    );
  }

  if (!declaration.planPath) {
    return unavailablePlan(
      'mismatch',
      {
        locatorSource: 'binding',
        planId: workspacePlanBinding.planId,
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

  let planPackage;
  try {
    const loadPlan = options.loadPlanPackage ?? loadPlanPackage;
    planPackage = await loadPlan(planFile, {
      repoRoot: workspaceRoot,
    });
  } catch (error) {
    return unavailablePlan(
      'invalid',
      locator,
      error?.code ?? 'PLAN_INVALID',
    );
  }

  const actualHead = gitResult(workspaceRoot, ['rev-parse', 'HEAD']);
  const currentTaskId =
    planPackage.manifest.tasks.find((task) => task.status === 'in_progress')
      ?.id ?? null;
  const expected = {
    planId: locator.planId,
    taskId: locator.taskId,
    workspaceId: declaration.workspaceId,
    branch: declaration.branch,
    declarationSourceHead: declaration.sourceHead,
    boundPlanId: locator.planId,
    boundPlanPath: declaration.planPath,
  };
  const actual = {
    planId: planPackage.manifest.planId,
    taskId: currentTaskId,
    workspaceId: planPackage.manifest.binding.workspaceId,
    branch: planPackage.manifest.binding.branch,
    declarationSourceHead: actualHead.ok ? actualHead.output : null,
    boundPlanId: workspacePlanBinding.planId,
    boundPlanPath: workspacePlanBinding.planPath,
  };
  if (
    Object.keys(expected).some((field) => expected[field] !== actual[field])
  ) {
    return unavailablePlan('mismatch', locator, 'PLAN_LOCATOR_MISMATCH');
  }

  return {
    status: 'available',
    locatorSource: locator.locatorSource,
    planId: locator.planId,
    taskId: locator.taskId,
    planStatus: planPackage.manifest.status,
    currentTaskId,
    progress: summarizePlanProgress(planPackage),
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
      const agentControlMode = values.PT_AGENT_CONTROL_MODE ?? null;
      let error = null;
      if (declaredName !== entry.name) {
        error = {
          code: 'PROFILE_IDENTITY_MISMATCH',
          message: 'Profile directory and declared name differ',
        };
      } else if (!AGENT_CONTROL_MODES.has(agentControlMode)) {
        error = {
          code: 'PROFILE_AGENT_CONTROL_INVALID',
          message: 'Agent control mode is missing or unsupported',
        };
      } else if (sourceState !== 'tracked-clean') {
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
        agentControlMode: agentControlMode ?? 'invalid',
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
    agentControlMode: registration.agentControlMode ?? null,
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
      agentControlMode: profile.agentControlMode,
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

export function deriveWorktrees(
  profiles,
  registrations,
  declarations,
  activeLeases,
) {
  const profileByName = new Map(
    profiles.map((profile) => [profile.name, profile]),
  );
  const registrationByWorkspace = new Map(
    registrations
      .filter((registration) => registration.workspaceId)
      .map((registration) => [registration.workspaceId, registration]),
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
      const workState =
        liveWork.length > 0
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
        branches: [
          ...new Set(
            work.length > 0
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
          agentControlMode:
            registration?.agentControlMode ??
            profile?.agentControlMode ??
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
    readLedger(developmentWorkLedgerPath(options.home ?? homedir()), now);
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
          { home: options.home },
        ),
      };
    }),
  );
  const activeLeases = (machine.activeLeases ?? []).map(safeLease);

  return {
    schemaVersion: 2,
    kind: 'peers-touch-dev-snapshot',
    observedAt: now.toISOString(),
    server: options.server ?? null,
    authority: machine.authority ?? 'missing',
    profiles,
    registrations,
    declarations,
    activeLeases,
    staleLeaseCount: (machine.staleLeaseMetadata ?? []).length,
    unregisteredObservationCount: machine.unregisteredObservations ? 1 : 0,
    worktrees: deriveWorktrees(
      profiles,
      registrations,
      declarations,
      activeLeases,
    ),
    occupancy: deriveOccupancy(
      profiles,
      registrations,
      declarations,
      activeLeases,
    ),
  };
}
