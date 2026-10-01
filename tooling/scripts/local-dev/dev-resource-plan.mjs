import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import {
  repoRoot,
  workspaceWorkflowPath,
} from '../lib/machine-dev-paths.mjs';
import {
  canonicalize,
  DevWorkError,
  parseRuntimeClaims,
  RUNTIME_KINDS,
} from './dev-work-schema.mjs';
import {
  requireActiveDeclaration,
  startOrUpdateDeclaration,
  statusCurrent,
} from './dev-work-ledger.mjs';
import { inspectGitWorkspace } from './git-workspace.mjs';
import {
  WorkspaceLifecycleLockError,
  withWorkspaceLifecycleLockSync,
} from './workspace-lifecycle-lock.mjs';

export const MODULE_IMPACT_KIND = 'peers-touch-module-impact';
export const RESOURCE_REQUEST_KIND = 'peers-touch-plan-resource-request';
export const RESOURCE_PLAN_KIND = 'peers-touch-plan-resource-plan';
export const RESOURCE_RESULT_KIND = 'peers-touch-resource-owner-result';
export const RESOURCE_SCHEMA_VERSION = 1;

const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const IMPACT_STATES = new Set([
  'DECIDED',
  'POLICY_REQUIRED',
  'OWNERSHIP_SPLIT_REQUIRED',
  'NOT_APPLICABLE',
]);
const PROOF_ACTIONS = new Set([
  'REUSE_CANDIDATE',
  'REUSE_ALLOWED',
  'REPROVE_REQUIRED',
  'POLICY_REQUIRED',
]);
const PROOF_PRECEDENCE = new Map([
  ['REUSE_CANDIDATE', 0],
  ['REUSE_ALLOWED', 1],
  ['REPROVE_REQUIRED', 2],
  ['POLICY_REQUIRED', 3],
]);
const RESOURCE_MODES = new Set(['shared', 'exclusive']);
const PLANNABLE_RESOURCE_KINDS = new Set(
  [...RUNTIME_KINDS].filter((kind) => kind !== 'resource.plan'),
);
const LIFECYCLE_SCOPES = new Set(['task', 'suite', 'scenario']);
const REUSE_POLICIES = new Set([
  'REUSE_IF_HEALTHY',
  'RESTART_IF_COMPATIBLE',
  'BUILD_IF_SOURCE_DRIFT',
  'FRESH',
]);
const RESOURCE_STATES = new Set([
  'HEALTHY',
  'STALE',
  'ABSENT',
  'QUARANTINED',
  'UNAVAILABLE',
]);
const RESOURCE_ACTIONS = new Set([
  'REUSE',
  'RESTART',
  'BUILD',
  'PROVISION',
]);
const RESULT_STATES = new Set(['READY', 'QUARANTINED']);
const ACTION_PRECEDENCE = new Map([
  ['REUSE', 0],
  ['RESTART', 1],
  ['BUILD', 2],
  ['PROVISION', 3],
]);
const MODULE_IMPACT_KEYS = new Set([
  'kind',
  'schemaVersion',
  'moduleId',
  'state',
  'changedPaths',
  'changeKinds',
  'moduleDependencies',
  'requirements',
  'classification',
  'proof',
]);
const MODULE_REQUIREMENTS_KEYS = new Set([
  'focusedCheckSelectors',
  'targetSelectors',
  'journeySelectors',
  'gateSelectors',
  'resourceRequirements',
]);
const TARGET_KEYS = new Set([
  'targetId',
  'dependsOn',
  'focusedCheckSelectors',
  'journeySelectors',
  'gateSelectors',
  'resourceRequirements',
]);
const RESOURCE_REQUIREMENT_KEYS = new Set([
  'requirementId',
  'resourceKind',
  'quantity',
  'mode',
  'lifecycleScope',
  'isolationKey',
  'compatibilityKey',
  'reusePolicy',
  'readinessProbe',
  'mandatory',
  'candidateIds',
  'expectedDigests',
]);
const READINESS_PROBE_KEYS = new Set(['kind', 'ref']);
const DIGEST_KEYS = new Set(['source', 'artifact', 'runtime']);
const INVENTORY_KEYS = new Set([
  'resourceId',
  'resourceKind',
  'compatibilityKey',
  'state',
  'capacity',
  'reusable',
  'provisionable',
  'owner',
  'manifestRef',
  'digests',
]);
const REQUEST_KEYS = new Set([
  'kind',
  'schemaVersion',
  'planId',
  'taskId',
  'source',
  'satisfiedModuleIds',
  'moduleImpacts',
  'targets',
  'inventory',
]);
const SOURCE_KEYS = new Set(['commit', 'workspaceDigest']);
const RESULT_KEYS = new Set([
  'kind',
  'schemaVersion',
  'allocationDigest',
  'fencingToken',
  'resourceKind',
  'resourceId',
  'owner',
  'status',
  'manifestRef',
  'digests',
]);

export class ResourcePlanError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'ResourcePlanError';
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, message, detail = {}) {
  throw new ResourcePlanError(code, message, detail);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertClosedObject(value, keys, field) {
  if (
    !isObject(value)
    || Object.keys(value).length !== keys.size
    || Object.keys(value).some((key) => !keys.has(key))
  ) {
    fail('RESOURCE_PLAN_INVALID', `${field} fields are invalid`, {
      field,
      actual: isObject(value) ? Object.keys(value).sort() : null,
      expected: [...keys].sort(),
    });
  }
  return value;
}

function requiredText(value, field, maxLength = 1024) {
  if (
    typeof value !== 'string'
    || value.trim() !== value
    || value.length === 0
    || value.length > maxLength
    || value.includes('\0')
  ) {
    fail('RESOURCE_PLAN_INVALID', `${field} must be a valid non-empty string`);
  }
  return value;
}

function requiredIdentifier(value, field) {
  const normalized = requiredText(value, field, 128);
  if (!IDENTIFIER.test(normalized)) {
    fail('RESOURCE_PLAN_INVALID', `${field} must be a valid identifier`);
  }
  return normalized;
}

function uniqueStrings(value, field, { allowEmpty = true } = {}) {
  if (
    !Array.isArray(value)
    || (!allowEmpty && value.length === 0)
    || value.some((item) => typeof item !== 'string' || item.length === 0)
    || new Set(value).size !== value.length
  ) {
    fail('RESOURCE_PLAN_INVALID', `${field} must be a unique string array`);
  }
  return [...value].sort();
}

function requiredArray(value, field, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    fail('RESOURCE_PLAN_INVALID', `${field} must be an array`);
  }
  return value;
}

function optionalDigest(value, field) {
  if (value === null) return null;
  if (typeof value !== 'string' || !DIGEST.test(value)) {
    fail(
      'RESOURCE_PLAN_INVALID',
      `${field} must be null or a sha256 digest`,
    );
  }
  return value;
}

function requiredDigest(value, field) {
  const normalized = optionalDigest(value, field);
  if (normalized === null) {
    fail('RESOURCE_PLAN_INVALID', `${field} must be a sha256 digest`);
  }
  return normalized;
}

function requiredWorkspaceDigest(value, field) {
  if (value === 'clean') return value;
  return requiredDigest(value, field);
}

function validateDigests(value, field) {
  assertClosedObject(value, DIGEST_KEYS, field);
  return {
    source: optionalDigest(value.source, `${field}.source`),
    artifact: optionalDigest(value.artifact, `${field}.artifact`),
    runtime: optionalDigest(value.runtime, `${field}.runtime`),
  };
}

function validateRequirement(value, field) {
  assertClosedObject(value, RESOURCE_REQUIREMENT_KEYS, field);
  const resourceKind = requiredIdentifier(
    value.resourceKind,
    `${field}.resourceKind`,
  );
  if (!PLANNABLE_RESOURCE_KINDS.has(resourceKind)) {
    fail(
      'RESOURCE_PLAN_INVALID',
      `${field}.resourceKind is not a supported declaration kind`,
    );
  }
  const quantity = Number(value.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 128) {
    fail(
      'RESOURCE_PLAN_INVALID',
      `${field}.quantity must be an integer within 1..128`,
    );
  }
  if (!RESOURCE_MODES.has(value.mode)) {
    fail('RESOURCE_PLAN_INVALID', `${field}.mode is invalid`);
  }
  if (!LIFECYCLE_SCOPES.has(value.lifecycleScope)) {
    fail('RESOURCE_PLAN_INVALID', `${field}.lifecycleScope is invalid`);
  }
  if (!REUSE_POLICIES.has(value.reusePolicy)) {
    fail('RESOURCE_PLAN_INVALID', `${field}.reusePolicy is invalid`);
  }
  if (typeof value.mandatory !== 'boolean') {
    fail('RESOURCE_PLAN_INVALID', `${field}.mandatory must be boolean`);
  }
  assertClosedObject(
    value.readinessProbe,
    READINESS_PROBE_KEYS,
    `${field}.readinessProbe`,
  );
  const probeKind = requiredIdentifier(
    value.readinessProbe.kind,
    `${field}.readinessProbe.kind`,
  );
  if (
    value.readinessProbe.ref !== null
    && typeof value.readinessProbe.ref !== 'string'
  ) {
    fail(
      'RESOURCE_PLAN_INVALID',
      `${field}.readinessProbe.ref must be null or a string`,
    );
  }
  if (probeKind === 'none' && value.readinessProbe.ref !== null) {
    fail(
      'RESOURCE_PLAN_INVALID',
      `${field}.readinessProbe.ref must be null for kind=none`,
    );
  }
  if (probeKind !== 'none') {
    requiredText(
      value.readinessProbe.ref,
      `${field}.readinessProbe.ref`,
      2048,
    );
  }
  return {
    requirementId: requiredIdentifier(
      value.requirementId,
      `${field}.requirementId`,
    ),
    resourceKind,
    quantity,
    mode: value.mode,
    lifecycleScope: value.lifecycleScope,
    isolationKey: requiredIdentifier(
      value.isolationKey,
      `${field}.isolationKey`,
    ),
    compatibilityKey: requiredText(
      value.compatibilityKey,
      `${field}.compatibilityKey`,
      512,
    ),
    reusePolicy: value.reusePolicy,
    readinessProbe: {
      kind: probeKind,
      ref: value.readinessProbe.ref,
    },
    mandatory: value.mandatory,
    candidateIds: uniqueStrings(
      value.candidateIds,
      `${field}.candidateIds`,
    ).map((candidateId, index) =>
      requiredIdentifier(
        candidateId,
        `${field}.candidateIds[${index}]`,
      )),
    expectedDigests: validateDigests(
      value.expectedDigests,
      `${field}.expectedDigests`,
    ),
  };
}

function validateModuleImpact(value, position) {
  const field = `moduleImpacts[${position}]`;
  assertClosedObject(value, MODULE_IMPACT_KEYS, field);
  if (
    value.kind !== MODULE_IMPACT_KIND
    || value.schemaVersion !== RESOURCE_SCHEMA_VERSION
    || !IMPACT_STATES.has(value.state)
  ) {
    fail('RESOURCE_PLAN_INVALID', `${field} identity or state is invalid`);
  }
  assertClosedObject(
    value.requirements,
    MODULE_REQUIREMENTS_KEYS,
    `${field}.requirements`,
  );
  if (!isObject(value.classification) || !isObject(value.proof)) {
    fail(
      'RESOURCE_PLAN_INVALID',
      `${field} classification and proof must be objects`,
    );
  }
  if (!PROOF_ACTIONS.has(value.proof.action)) {
    fail('RESOURCE_PLAN_INVALID', `${field}.proof.action is invalid`);
  }
  return {
    ...value,
    moduleId: requiredIdentifier(value.moduleId, `${field}.moduleId`),
    changedPaths: uniqueStrings(
      value.changedPaths,
      `${field}.changedPaths`,
      { allowEmpty: false },
    ),
    changeKinds: uniqueStrings(
      value.changeKinds,
      `${field}.changeKinds`,
      { allowEmpty: false },
    ),
    moduleDependencies: uniqueStrings(
      value.moduleDependencies,
      `${field}.moduleDependencies`,
    ),
    requirements: {
      focusedCheckSelectors: uniqueStrings(
        value.requirements.focusedCheckSelectors,
        `${field}.requirements.focusedCheckSelectors`,
      ),
      targetSelectors: uniqueStrings(
        value.requirements.targetSelectors,
        `${field}.requirements.targetSelectors`,
      ),
      journeySelectors: uniqueStrings(
        value.requirements.journeySelectors,
        `${field}.requirements.journeySelectors`,
      ),
      gateSelectors: uniqueStrings(
        value.requirements.gateSelectors,
        `${field}.requirements.gateSelectors`,
      ),
      resourceRequirements: requiredArray(
        value.requirements.resourceRequirements,
        `${field}.requirements.resourceRequirements`,
      ).map(
        (requirement, index) =>
          validateRequirement(
            requirement,
            `${field}.requirements.resourceRequirements[${index}]`,
          ),
      ),
    },
  };
}

function validateTarget(value, position) {
  const field = `targets[${position}]`;
  assertClosedObject(value, TARGET_KEYS, field);
  return {
    targetId: requiredIdentifier(value.targetId, `${field}.targetId`),
    dependsOn: uniqueStrings(value.dependsOn, `${field}.dependsOn`),
    focusedCheckSelectors: uniqueStrings(
      value.focusedCheckSelectors,
      `${field}.focusedCheckSelectors`,
    ),
    journeySelectors: uniqueStrings(
      value.journeySelectors,
      `${field}.journeySelectors`,
    ),
    gateSelectors: uniqueStrings(
      value.gateSelectors,
      `${field}.gateSelectors`,
    ),
    resourceRequirements: requiredArray(
      value.resourceRequirements,
      `${field}.resourceRequirements`,
    ).map(
      (requirement, index) =>
        validateRequirement(
          requirement,
          `${field}.resourceRequirements[${index}]`,
        ),
    ),
  };
}

function validateInventoryResource(value, position) {
  const field = `inventory[${position}]`;
  assertClosedObject(value, INVENTORY_KEYS, field);
  const resourceKind = requiredIdentifier(
    value.resourceKind,
    `${field}.resourceKind`,
  );
  if (!PLANNABLE_RESOURCE_KINDS.has(resourceKind)) {
    fail(
      'RESOURCE_PLAN_INVALID',
      `${field}.resourceKind is not a supported declaration kind`,
    );
  }
  const capacity = Number(value.capacity);
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 128) {
    fail(
      'RESOURCE_PLAN_INVALID',
      `${field}.capacity must be an integer within 1..128`,
    );
  }
  if (!RESOURCE_STATES.has(value.state)) {
    fail('RESOURCE_PLAN_INVALID', `${field}.state is invalid`);
  }
  if (
    typeof value.reusable !== 'boolean'
    || typeof value.provisionable !== 'boolean'
  ) {
    fail(
      'RESOURCE_PLAN_INVALID',
      `${field} reusable and provisionable must be boolean`,
    );
  }
  if (
    value.manifestRef !== null
    && typeof value.manifestRef !== 'string'
  ) {
    fail(
      'RESOURCE_PLAN_INVALID',
      `${field}.manifestRef must be null or a string`,
    );
  }
  return {
    resourceId: requiredIdentifier(
      value.resourceId,
      `${field}.resourceId`,
    ),
    resourceKind,
    compatibilityKey: requiredText(
      value.compatibilityKey,
      `${field}.compatibilityKey`,
      512,
    ),
    state: value.state,
    capacity,
    reusable: value.reusable,
    provisionable: value.provisionable,
    owner: requiredIdentifier(value.owner, `${field}.owner`),
    manifestRef:
      value.manifestRef === null
        ? null
        : requiredText(value.manifestRef, `${field}.manifestRef`, 2048),
    digests: validateDigests(value.digests, `${field}.digests`),
  };
}

function validateRequest(value) {
  assertClosedObject(value, REQUEST_KEYS, 'resource request');
  if (
    value.kind !== RESOURCE_REQUEST_KIND
    || value.schemaVersion !== RESOURCE_SCHEMA_VERSION
  ) {
    fail('RESOURCE_PLAN_INVALID', 'resource request identity is invalid');
  }
  assertClosedObject(value.source, SOURCE_KEYS, 'resource request source');
  const commit = requiredText(value.source.commit, 'source.commit', 128);
  if (!/^[0-9a-f]{40,64}$/.test(commit)) {
    fail('RESOURCE_PLAN_INVALID', 'source.commit must be a Git object ID');
  }
  const source = {
    commit,
    workspaceDigest: requiredWorkspaceDigest(
      value.source.workspaceDigest,
      'source.workspaceDigest',
    ),
  };
  const moduleImpacts = requiredArray(
    value.moduleImpacts,
    'moduleImpacts',
    { allowEmpty: false },
  ).map(validateModuleImpact);
  const moduleIds = moduleImpacts.map((impact) => impact.moduleId);
  if (moduleIds.length !== new Set(moduleIds).size) {
    fail('RESOURCE_PLAN_INVALID', 'module impact IDs must be unique');
  }
  const targets = requiredArray(value.targets, 'targets').map(validateTarget);
  const targetIds = targets.map((target) => target.targetId);
  if (targetIds.length !== new Set(targetIds).size) {
    fail('RESOURCE_PLAN_INVALID', 'target IDs must be unique');
  }
  const inventory = requiredArray(
    value.inventory,
    'inventory',
  ).map(validateInventoryResource);
  const resourceKeys = inventory.map(
    (resource) => `${resource.resourceKind}:${resource.resourceId}`,
  );
  if (resourceKeys.length !== new Set(resourceKeys).size) {
    fail('RESOURCE_PLAN_INVALID', 'inventory resource identities must be unique');
  }
  return {
    kind: value.kind,
    schemaVersion: value.schemaVersion,
    planId: requiredIdentifier(value.planId, 'planId'),
    taskId: requiredIdentifier(value.taskId, 'taskId'),
    source,
    satisfiedModuleIds: uniqueStrings(
      value.satisfiedModuleIds,
      'satisfiedModuleIds',
    ),
    moduleImpacts,
    targets,
    inventory,
  };
}

export function digestValue(value) {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex')}`;
}

function requirementSignature(requirement) {
  const comparable = { ...requirement };
  delete comparable.quantity;
  delete comparable.ownerIds;
  return JSON.stringify(canonicalize(comparable));
}

function mergeRequirement(target, requirement, ownerId) {
  const current = target.get(requirement.requirementId);
  if (!current) {
    target.set(requirement.requirementId, {
      ...requirement,
      ownerIds: [ownerId],
    });
    return;
  }
  if (requirementSignature(current) !== requirementSignature(requirement)) {
    fail(
      'RESOURCE_REQUIREMENT_CONFLICT',
      'one requirement ID has incompatible definitions',
      {
        requirementId: requirement.requirementId,
        ownerIds: [...current.ownerIds, ownerId],
      },
    );
  }
  current.quantity = Math.max(current.quantity, requirement.quantity);
  current.ownerIds = [...new Set([...current.ownerIds, ownerId])].sort();
}

function resolveTargetClosure(targetMap, selectedTargetIds) {
  const selected = new Set();
  const visiting = new Set();

  function visit(targetId) {
    const target = targetMap.get(targetId);
    if (!target) {
      fail('RESOURCE_TARGET_UNRESOLVED', 'module impact target is unknown', {
        targetId,
      });
    }
    if (selected.has(targetId)) return;
    if (visiting.has(targetId)) {
      fail('RESOURCE_TARGET_CYCLE', 'runtime target dependencies contain a cycle', {
        targetId,
      });
    }
    visiting.add(targetId);
    target.dependsOn.forEach(visit);
    visiting.delete(targetId);
    selected.add(targetId);
  }

  [...selectedTargetIds].sort().forEach(visit);
  return selected;
}

function targetWaves(targetMap, selected) {
  const remaining = new Set(selected);
  const completed = new Set();
  const waves = [];
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((targetId) =>
        targetMap
          .get(targetId)
          .dependsOn.every((dependency) => completed.has(dependency)))
      .sort();
    if (ready.length === 0) {
      fail('RESOURCE_TARGET_CYCLE', 'runtime target dependencies contain a cycle');
    }
    waves.push(ready);
    ready.forEach((targetId) => {
      remaining.delete(targetId);
      completed.add(targetId);
    });
  }
  return waves;
}

function digestsMatch(expected, actual) {
  return ['source', 'artifact', 'runtime'].every(
    (field) => expected[field] === null || expected[field] === actual[field],
  );
}

function selectAction(requirement, resource) {
  if (['QUARANTINED', 'UNAVAILABLE'].includes(resource.state)) return null;
  if (requirement.reusePolicy === 'FRESH') {
    return resource.provisionable ? 'PROVISION' : null;
  }
  if (resource.state === 'ABSENT') {
    return resource.provisionable ? 'PROVISION' : null;
  }
  const sourceMismatch =
    requirement.expectedDigests.source !== null
    && requirement.expectedDigests.source !== resource.digests.source;
  const artifactMismatch =
    requirement.expectedDigests.artifact !== null
    && requirement.expectedDigests.artifact !== resource.digests.artifact;
  const runtimeMismatch =
    requirement.expectedDigests.runtime !== null
    && requirement.expectedDigests.runtime !== resource.digests.runtime;
  if (sourceMismatch || artifactMismatch) {
    if (
      requirement.reusePolicy === 'BUILD_IF_SOURCE_DRIFT'
      && resource.provisionable
    ) {
      return 'BUILD';
    }
    return resource.provisionable ? 'PROVISION' : null;
  }
  if (runtimeMismatch || resource.state === 'STALE') {
    if (
      ['RESTART_IF_COMPATIBLE', 'BUILD_IF_SOURCE_DRIFT'].includes(
        requirement.reusePolicy,
      )
      && resource.provisionable
    ) {
      return 'RESTART';
    }
    return resource.provisionable ? 'PROVISION' : null;
  }
  if (
    resource.state === 'HEALTHY'
    && resource.reusable
    && resource.manifestRef !== null
    && digestsMatch(requirement.expectedDigests, resource.digests)
  ) {
    return 'REUSE';
  }
  return resource.provisionable ? 'PROVISION' : null;
}

function candidateResources(requirement, inventory) {
  const allowed = new Set(requirement.candidateIds);
  return inventory
    .filter(
      (resource) =>
        resource.resourceKind === requirement.resourceKind
        && resource.compatibilityKey === requirement.compatibilityKey
        && (allowed.size === 0 || allowed.has(resource.resourceId)),
    )
    .map((resource) => ({
      resource,
      action: selectAction(requirement, resource),
    }))
    .filter((candidate) => RESOURCE_ACTIONS.has(candidate.action))
    .sort((left, right) => {
      const actionDelta =
        ACTION_PRECEDENCE.get(left.action)
        - ACTION_PRECEDENCE.get(right.action);
      return actionDelta !== 0
        ? actionDelta
        : left.resource.resourceId.localeCompare(right.resource.resourceId);
    });
}

function requirementReservationKey(requirement) {
  return [
    requirement.lifecycleScope,
    requirement.requirementId,
    requirement.compatibilityKey,
    requirement.isolationKey,
  ].join(':');
}

function allocateTarget(target, inventory, usedCapacity, reservations) {
  const provisional = [];
  const capacityDelta = new Map();
  const reservationDelta = new Map();
  const blockers = [];

  for (const requirement of target.resourceRequirements) {
    const reservationKey = requirementReservationKey(requirement);
    const reusableSelection = reservations.get(reservationKey) ?? [];
    let remaining =
      requirement.quantity
      - reusableSelection.reduce((total, item) => total + item.units, 0);
    const selected = [...reusableSelection];
    for (const candidate of candidateResources(requirement, inventory)) {
      const key =
        `${candidate.resource.resourceKind}:${candidate.resource.resourceId}`;
      if (
        selected.some(
          (item) =>
            item.resourceKind === candidate.resource.resourceKind
            && item.resourceId === candidate.resource.resourceId,
        )
      ) {
        continue;
      }
      const alreadyUsed = usedCapacity.get(key) ?? 0;
      const pendingUse = capacityDelta.get(key) ?? 0;
      const available = candidate.resource.capacity - alreadyUsed - pendingUse;
      if (available <= 0) continue;
      const units = Math.min(available, remaining);
      selected.push({
        resourceKind: candidate.resource.resourceKind,
        resourceId: candidate.resource.resourceId,
        owner: candidate.resource.owner,
        manifestRef: candidate.resource.manifestRef,
        units,
        action: candidate.action,
        digests: candidate.resource.digests,
      });
      capacityDelta.set(key, pendingUse + units);
      remaining -= units;
      if (remaining === 0) break;
    }
    if (remaining > 0 && requirement.mandatory) {
      blockers.push({
        code: 'RESOURCE_CAPACITY_UNAVAILABLE',
        targetId: target.targetId,
        requirementId: requirement.requirementId,
        resourceKind: requirement.resourceKind,
        compatibilityKey: requirement.compatibilityKey,
        required: requirement.quantity,
        available: requirement.quantity - remaining,
      });
      continue;
    }
    if (remaining > 0) {
      provisional.push({
        requirement,
        selections: selected,
        optionalShortfall: remaining,
      });
      continue;
    }
    provisional.push({
      requirement,
      selections: selected,
      optionalShortfall: 0,
    });
  }

  if (blockers.length > 0) {
    return { state: 'PARKED', allocations: [], blockers };
  }
  for (const [key, units] of capacityDelta) {
    usedCapacity.set(key, (usedCapacity.get(key) ?? 0) + units);
  }
  for (const item of provisional) {
    reservationDelta.set(
      requirementReservationKey(item.requirement),
      item.selections,
    );
  }
  for (const [key, selections] of reservationDelta) {
    reservations.set(key, selections);
  }
  return {
    state: 'ALLOCATED',
    allocations: provisional,
    blockers: [],
  };
}

function resourceCapacityKey(resource) {
  return `${resource.resourceKind}:${resource.resourceId}`;
}

function cloneReservations(reservations) {
  return new Map(
    [...reservations].map(([key, selections]) => [
      key,
      selections.map((selection) => ({
        ...selection,
        digests: { ...selection.digests },
      })),
    ]),
  );
}

function addFlowEdge(graph, from, to, capacity, metadata = null) {
  const forward = {
    to,
    reverse: graph[to].length,
    capacity,
    initialCapacity: capacity,
    metadata,
  };
  const reverse = {
    to: from,
    reverse: graph[from].length,
    capacity: 0,
    initialCapacity: 0,
    metadata: null,
  };
  graph[from].push(forward);
  graph[to].push(reverse);
}

function maximumFlow(graph, source, sink, targetFlow) {
  let flow = 0;
  while (flow < targetFlow) {
    const level = Array(graph.length).fill(-1);
    const queue = [source];
    level[source] = 0;
    for (let index = 0; index < queue.length; index += 1) {
      const node = queue[index];
      for (const edge of graph[node]) {
        if (edge.capacity > 0 && level[edge.to] < 0) {
          level[edge.to] = level[node] + 1;
          queue.push(edge.to);
        }
      }
    }
    if (level[sink] < 0) break;
    const nextEdge = Array(graph.length).fill(0);
    const send = (node, available) => {
      if (node === sink) return available;
      for (
        let index = nextEdge[node];
        index < graph[node].length;
        index += 1
      ) {
        nextEdge[node] = index;
        const edge = graph[node][index];
        if (edge.capacity <= 0 || level[edge.to] !== level[node] + 1) continue;
        const sent = send(edge.to, Math.min(available, edge.capacity));
        if (sent > 0) {
          edge.capacity -= sent;
          graph[edge.to][edge.reverse].capacity += sent;
          return sent;
        }
      }
      nextEdge[node] = graph[node].length;
      return 0;
    };
    while (flow < targetFlow) {
      const sent = send(source, targetFlow - flow);
      if (sent === 0) break;
      flow += sent;
    }
  }
  return flow;
}

function mandatoryDemandGroups(targets) {
  const groups = new Map();
  for (const target of targets) {
    for (const requirement of target.resourceRequirements) {
      const key = requirementReservationKey(requirement);
      const current = groups.get(key);
      if (!current) {
        groups.set(key, {
          key,
          requirement,
          quantity: requirement.quantity,
          targetIds: [target.targetId],
        });
        continue;
      }
      current.quantity = Math.max(current.quantity, requirement.quantity);
      current.targetIds = [
        ...new Set([...current.targetIds, target.targetId]),
      ].sort();
    }
  }
  return [...groups.values()].sort((left, right) =>
    left.key.localeCompare(right.key));
}

function solveMandatoryTargets(
  targets,
  inventory,
  baseUsedCapacity,
  baseReservations,
) {
  const demands = mandatoryDemandGroups(targets);
  const usedCapacity = new Map(baseUsedCapacity);
  const reservations = cloneReservations(baseReservations);
  const activeDemands = [];
  let totalDemand = 0;
  for (const demand of demands) {
    const selected = reservations.get(demand.key) ?? [];
    const reserved = selected.reduce((total, item) => total + item.units, 0);
    const remaining = Math.max(0, demand.quantity - reserved);
    if (remaining === 0) continue;
    const candidates = candidateResources(demand.requirement, inventory)
      .map((candidate) => ({
        ...candidate,
        available: Math.max(
          0,
          candidate.resource.capacity
            - (usedCapacity.get(resourceCapacityKey(candidate.resource)) ?? 0),
        ),
      }))
      .filter((candidate) => candidate.available > 0);
    activeDemands.push({ ...demand, remaining, candidates });
    totalDemand += remaining;
  }

  const resourceKeys = [
    ...new Set(
      activeDemands.flatMap((demand) =>
        demand.candidates.map((candidate) =>
          resourceCapacityKey(candidate.resource))),
    ),
  ].sort();
  const sourceNode = 0;
  const demandOffset = 1;
  const resourceOffset = demandOffset + activeDemands.length;
  const sinkNode = resourceOffset + resourceKeys.length;
  const graph = Array.from({ length: sinkNode + 1 }, () => []);
  const resourceNodes = new Map(
    resourceKeys.map((key, index) => [key, resourceOffset + index]),
  );
  const resourcesByKey = new Map(
    inventory.map((resource) => [resourceCapacityKey(resource), resource]),
  );

  activeDemands.forEach((demand, demandIndex) => {
    const demandNode = demandOffset + demandIndex;
    addFlowEdge(graph, sourceNode, demandNode, demand.remaining);
    for (const candidate of demand.candidates) {
      addFlowEdge(
        graph,
        demandNode,
        resourceNodes.get(resourceCapacityKey(candidate.resource)),
        Math.min(demand.remaining, candidate.available),
        { demandKey: demand.key, candidate },
      );
    }
  });
  for (const resourceKey of resourceKeys) {
    const resource = resourcesByKey.get(resourceKey);
    addFlowEdge(
      graph,
      resourceNodes.get(resourceKey),
      sinkNode,
      Math.max(
        0,
        resource.capacity - (usedCapacity.get(resourceKey) ?? 0),
      ),
    );
  }

  const allocated = maximumFlow(graph, sourceNode, sinkNode, totalDemand);
  const allocatedByDemand = new Map();
  activeDemands.forEach((demand, demandIndex) => {
    const demandNode = demandOffset + demandIndex;
    for (const edge of graph[demandNode]) {
      if (edge.metadata === null) continue;
      const units = edge.initialCapacity - edge.capacity;
      if (units <= 0) continue;
      const current = allocatedByDemand.get(demand.key) ?? [];
      current.push({ candidate: edge.metadata.candidate, units });
      allocatedByDemand.set(demand.key, current);
    }
  });
  const shortfalls = new Map();
  for (const demand of activeDemands) {
    const demandAllocated = (allocatedByDemand.get(demand.key) ?? [])
      .reduce((total, item) => total + item.units, 0);
    if (demandAllocated < demand.remaining) {
      shortfalls.set(demand.key, {
        required: demand.quantity,
        available: demand.quantity - demand.remaining + demandAllocated,
      });
    }
  }
  if (allocated !== totalDemand) {
    return {
      feasible: false,
      usedCapacity,
      reservations,
      allocationsByTarget: new Map(),
      shortfalls,
    };
  }

  for (const demand of activeDemands) {
    const selections = [
      ...(reservations.get(demand.key) ?? []).map((selection) => ({
        ...selection,
        digests: { ...selection.digests },
      })),
    ];
    for (const { candidate, units } of allocatedByDemand.get(demand.key) ?? []) {
      const key = resourceCapacityKey(candidate.resource);
      usedCapacity.set(key, (usedCapacity.get(key) ?? 0) + units);
      const existing = selections.find(
        (selection) =>
          selection.resourceKind === candidate.resource.resourceKind
          && selection.resourceId === candidate.resource.resourceId,
      );
      if (existing) {
        existing.units += units;
        existing.action = mergeResourceAction(existing.action, candidate.action);
      } else {
        selections.push({
          resourceKind: candidate.resource.resourceKind,
          resourceId: candidate.resource.resourceId,
          owner: candidate.resource.owner,
          manifestRef: candidate.resource.manifestRef,
          units,
          action: candidate.action,
          digests: candidate.resource.digests,
        });
      }
    }
    reservations.set(
      demand.key,
      selections.sort((left, right) =>
        resourceCapacityKey(left).localeCompare(resourceCapacityKey(right))),
    );
  }

  const allocationsByTarget = new Map();
  for (const target of targets) {
    allocationsByTarget.set(
      target.targetId,
      target.resourceRequirements.map((requirement) => ({
        requirement,
        selections:
          reservations.get(requirementReservationKey(requirement)) ?? [],
        optionalShortfall: 0,
      })),
    );
  }
  return {
    feasible: true,
    usedCapacity,
    reservations,
    allocationsByTarget,
    shortfalls,
  };
}

function targetConstraintScore(
  target,
  inventory,
  usedCapacity,
  reservations,
) {
  let minimumSlack = Number.POSITIVE_INFINITY;
  let minimumCandidateCount = Number.POSITIVE_INFINITY;
  let remainingTotal = 0;
  for (const requirement of target.resourceRequirements) {
    const reserved = (
      reservations.get(requirementReservationKey(requirement)) ?? []
    ).reduce((total, item) => total + item.units, 0);
    const remaining = Math.max(0, requirement.quantity - reserved);
    if (remaining === 0) continue;
    const available = candidateResources(requirement, inventory)
      .map((candidate) =>
        Math.max(
          0,
          candidate.resource.capacity
            - (usedCapacity.get(resourceCapacityKey(candidate.resource)) ?? 0),
        ))
      .filter((capacity) => capacity > 0);
    const availableTotal = available.reduce(
      (total, capacity) => total + capacity,
      0,
    );
    minimumSlack = Math.min(minimumSlack, availableTotal - remaining);
    minimumCandidateCount = Math.min(
      minimumCandidateCount,
      available.length,
    );
    remainingTotal += remaining;
  }
  return [
    minimumSlack,
    minimumCandidateCount,
    -remainingTotal,
    target.targetId,
  ];
}

function compareConstraintScores(left, right) {
  for (let index = 0; index < left.length - 1; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.at(-1).localeCompare(right.at(-1));
}

function mandatoryTargetBlockers(target, shortfalls) {
  const blocked = target.resourceRequirements
    .map((requirement) => {
      const shortfall = shortfalls.get(requirementReservationKey(requirement));
      if (!shortfall) return null;
      return {
        code: 'RESOURCE_CAPACITY_UNAVAILABLE',
        targetId: target.targetId,
        requirementId: requirement.requirementId,
        resourceKind: requirement.resourceKind,
        compatibilityKey: requirement.compatibilityKey,
        required: requirement.quantity,
        available: Math.min(requirement.quantity, shortfall.available),
      };
    })
    .filter(Boolean);
  if (blocked.length > 0) return blocked;
  const requirement = target.resourceRequirements[0];
  return [{
    code: 'RESOURCE_CAPACITY_UNAVAILABLE',
    targetId: target.targetId,
    requirementId: requirement.requirementId,
    resourceKind: requirement.resourceKind,
    compatibilityKey: requirement.compatibilityKey,
    required: requirement.quantity,
    available: 0,
  }];
}

function allocateMandatoryWave(
  targets,
  inventory,
  usedCapacity,
  reservations,
) {
  const baseUsedCapacity = new Map(usedCapacity);
  const baseReservations = cloneReservations(reservations);
  const ordered = [...targets].sort((left, right) =>
    compareConstraintScores(
      targetConstraintScore(
        left,
        inventory,
        baseUsedCapacity,
        baseReservations,
      ),
      targetConstraintScore(
        right,
        inventory,
        baseUsedCapacity,
        baseReservations,
      ),
    ));
  const accepted = [];
  const parked = new Map();
  let allocation = solveMandatoryTargets(
    accepted,
    inventory,
    baseUsedCapacity,
    baseReservations,
  );
  for (const target of ordered) {
    const attempt = solveMandatoryTargets(
      [...accepted, target],
      inventory,
      baseUsedCapacity,
      baseReservations,
    );
    if (attempt.feasible) {
      accepted.push(target);
      allocation = attempt;
    } else {
      parked.set(
        target.targetId,
        mandatoryTargetBlockers(target, attempt.shortfalls),
      );
    }
  }
  usedCapacity.clear();
  for (const [key, units] of allocation.usedCapacity) {
    usedCapacity.set(key, units);
  }
  reservations.clear();
  for (const [key, selections] of allocation.reservations) {
    reservations.set(key, selections);
  }
  return {
    allocationsByTarget: allocation.allocationsByTarget,
    parked,
  };
}

function carryPersistentReservations(reservations) {
  return new Map(
    [...reservations].filter(
      ([key]) => !key.startsWith('scenario:'),
    ),
  );
}

function capacityFromReservations(reservations) {
  const capacity = new Map();
  for (const selections of reservations.values()) {
    for (const selection of selections) {
      const key = `${selection.resourceKind}:${selection.resourceId}`;
      capacity.set(key, (capacity.get(key) ?? 0) + selection.units);
    }
  }
  return capacity;
}

function mergeResourceAction(current, next) {
  if (!current) return next;
  return ACTION_PRECEDENCE.get(current) >= ACTION_PRECEDENCE.get(next)
    ? current
    : next;
}

function runtimeClaimSpec(claims) {
  return claims
    .map((claim) => `${claim.mode}:${claim.kind}:${claim.resourceId}`)
    .join(';');
}

function idempotencyKey(planId, requirement) {
  return [
    planId,
    requirement.lifecycleScope,
    requirement.requirementId,
    requirement.compatibilityKey,
  ].join(':');
}

function buildDemandPlan(planId, targetMap, waves) {
  const requirements = new Map();
  const capacity = new Map();
  for (const [waveIndex, targetIds] of waves.entries()) {
    const waveDemand = new Map();
    for (const targetId of targetIds) {
      for (const requirement of targetMap.get(targetId).resourceRequirements) {
        const requirementKey = idempotencyKey(planId, requirement);
        const current = requirements.get(requirementKey) ?? {
          idempotencyKey: requirementKey,
          requirementId: requirement.requirementId,
          resourceKind: requirement.resourceKind,
          compatibilityKey: requirement.compatibilityKey,
          isolationKey: requirement.isolationKey,
          lifecycleScope: requirement.lifecycleScope,
          mode: requirement.mode,
          reusePolicy: requirement.reusePolicy,
          readinessProbe: requirement.readinessProbe,
          mandatory: requirement.mandatory,
          candidateIds: requirement.candidateIds,
          expectedDigests: requirement.expectedDigests,
          peakQuantity: 0,
          targetIds: [],
        };
        if (
          current.requirementId !== requirement.requirementId
          || current.resourceKind !== requirement.resourceKind
          || current.compatibilityKey !== requirement.compatibilityKey
          || current.isolationKey !== requirement.isolationKey
          || current.lifecycleScope !== requirement.lifecycleScope
          || current.mode !== requirement.mode
          || current.reusePolicy !== requirement.reusePolicy
          || JSON.stringify(current.readinessProbe)
            !== JSON.stringify(requirement.readinessProbe)
          || current.mandatory !== requirement.mandatory
          || JSON.stringify(current.candidateIds)
            !== JSON.stringify(requirement.candidateIds)
          || JSON.stringify(current.expectedDigests)
            !== JSON.stringify(requirement.expectedDigests)
        ) {
          fail(
            'RESOURCE_REQUIREMENT_CONFLICT',
            'one idempotency key has incompatible resource requirements',
            { idempotencyKey: requirementKey },
          );
        }
        current.peakQuantity = Math.max(
          current.peakQuantity,
          requirement.quantity,
        );
        current.targetIds = [...new Set([...current.targetIds, targetId])].sort();
        requirements.set(requirementKey, current);

        const capacityKey = [
          requirement.resourceKind,
          requirement.compatibilityKey,
          requirement.isolationKey,
          requirement.mode,
          requirement.lifecycleScope,
        ].join(':');
        const demandKey = `${capacityKey}:${requirement.requirementId}`;
        const prior = waveDemand.get(demandKey) ?? 0;
        waveDemand.set(
          demandKey,
          Math.max(prior, requirement.quantity),
        );
        if (!capacity.has(capacityKey)) {
          capacity.set(capacityKey, {
            resourceKind: requirement.resourceKind,
            compatibilityKey: requirement.compatibilityKey,
            isolationKey: requirement.isolationKey,
            mode: requirement.mode,
            lifecycleScope: requirement.lifecycleScope,
            peakQuantity: 0,
            waveQuantities: [],
          });
        }
      }
    }
    const totals = new Map();
    for (const [demandKey, quantity] of waveDemand) {
      const capacityKey = demandKey.slice(
        0,
        demandKey.lastIndexOf(':'),
      );
      totals.set(capacityKey, (totals.get(capacityKey) ?? 0) + quantity);
    }
    for (const [capacityKey, quantity] of totals) {
      const entry = capacity.get(capacityKey);
      entry.waveQuantities.push({ wave: waveIndex, quantity });
      entry.peakQuantity = Math.max(entry.peakQuantity, quantity);
    }
  }
  return {
    requirements: [...requirements.values()].sort((left, right) =>
      left.idempotencyKey.localeCompare(right.idempotencyKey)),
    capacity: [...capacity.values()].sort((left, right) =>
      [
        left.resourceKind,
        left.compatibilityKey,
        left.isolationKey,
        left.mode,
        left.lifecycleScope,
      ].join(':').localeCompare([
        right.resourceKind,
        right.compatibilityKey,
        right.isolationKey,
        right.mode,
        right.lifecycleScope,
      ].join(':'))),
  };
}

export function buildPlanResourcePlan(rawRequest) {
  const request = validateRequest(rawRequest);
  const blockedImpacts = request.moduleImpacts.filter(
    (impact) => impact.state !== 'DECIDED',
  );
  if (blockedImpacts.length > 0) {
    fail(
      'MODULE_IMPACT_NOT_READY',
      'every module impact must be DECIDED before resource planning',
      {
        modules: blockedImpacts.map((impact) => ({
          moduleId: impact.moduleId,
          state: impact.state,
        })),
      },
    );
  }

  const availableModules = new Set([
    ...request.satisfiedModuleIds,
    ...request.moduleImpacts.map((impact) => impact.moduleId),
  ]);
  const impactByModule = new Map(
    request.moduleImpacts.map((impact) => [impact.moduleId, impact]),
  );
  const missingModuleDependencies = request.moduleImpacts.flatMap((impact) =>
    impact.moduleDependencies
      .filter((moduleId) => !availableModules.has(moduleId))
      .map((moduleId) => ({
        moduleId: impact.moduleId,
        missingDependency: moduleId,
      })));
  if (missingModuleDependencies.length > 0) {
    fail(
      'MODULE_IMPACT_DEPENDENCY_MISSING',
      'module impact dependency closure is incomplete',
      { missingModuleDependencies },
    );
  }

  const targetMap = new Map(
    request.targets.map((target) => [target.targetId, target]),
  );
  const rootTargets = new Set(
    request.moduleImpacts.flatMap(
      (impact) => impact.requirements.targetSelectors,
    ),
  );
  const moduleTargetIds = new Map();
  for (const impact of request.moduleImpacts) {
    const ownedTargetIds = [...impact.requirements.targetSelectors];
    const directRequirements = new Map();
    for (const requirement of impact.requirements.resourceRequirements) {
      mergeRequirement(directRequirements, requirement, impact.moduleId);
    }
    if (directRequirements.size === 0) continue;
    const syntheticTargetId = `module-${impact.moduleId}-resources`;
    if (targetMap.has(syntheticTargetId)) {
      fail(
        'RESOURCE_TARGET_CONFLICT',
        `${syntheticTargetId} is reserved by the resource planner`,
      );
    }
    targetMap.set(syntheticTargetId, {
      targetId: syntheticTargetId,
      dependsOn: [],
      focusedCheckSelectors: [],
      journeySelectors: [],
      gateSelectors: [],
      resourceRequirements: [...directRequirements.values()].sort(
        (left, right) =>
          left.requirementId.localeCompare(right.requirementId),
      ),
    });
    rootTargets.add(syntheticTargetId);
    ownedTargetIds.push(syntheticTargetId);
    for (const targetId of impact.requirements.targetSelectors) {
      const target = targetMap.get(targetId);
      if (!target) continue;
      targetMap.set(targetId, {
        ...target,
        dependsOn: [...new Set([...target.dependsOn, syntheticTargetId])].sort(),
      });
    }
    moduleTargetIds.set(impact.moduleId, [...new Set(ownedTargetIds)].sort());
  }
  for (const impact of request.moduleImpacts) {
    if (!moduleTargetIds.has(impact.moduleId)) {
      moduleTargetIds.set(
        impact.moduleId,
        [...impact.requirements.targetSelectors],
      );
    }
  }
  const dependencyTargetsByModule = new Map();
  const resolvingDependencyTargets = new Set();
  function dependencyTargetsForModule(moduleId) {
    if (dependencyTargetsByModule.has(moduleId)) {
      return dependencyTargetsByModule.get(moduleId);
    }
    if (resolvingDependencyTargets.has(moduleId)) {
      fail(
        'MODULE_IMPACT_DEPENDENCY_CYCLE',
        'module impact dependencies contain a cycle',
        { moduleId },
      );
    }
    resolvingDependencyTargets.add(moduleId);
    const impact = impactByModule.get(moduleId);
    const dependencyTargets = new Set();
    for (const dependencyId of impact.moduleDependencies) {
      if (!impactByModule.has(dependencyId)) continue;
      for (const targetId of moduleTargetIds.get(dependencyId) ?? []) {
        dependencyTargets.add(targetId);
      }
      for (const targetId of dependencyTargetsForModule(dependencyId)) {
        dependencyTargets.add(targetId);
      }
    }
    resolvingDependencyTargets.delete(moduleId);
    const result = [...dependencyTargets].sort();
    dependencyTargetsByModule.set(moduleId, result);
    return result;
  }
  for (const impact of request.moduleImpacts) {
    const dependencyTargets = dependencyTargetsForModule(impact.moduleId);
    for (const targetId of moduleTargetIds.get(impact.moduleId)) {
      const target = targetMap.get(targetId);
      if (!target) continue;
      targetMap.set(targetId, {
        ...target,
        dependsOn: [
          ...new Set([
            ...target.dependsOn,
            ...dependencyTargets.filter(
              (dependencyTargetId) => dependencyTargetId !== targetId,
            ),
          ]),
        ].sort(),
      });
    }
  }
  const selectedTargets = resolveTargetClosure(targetMap, rootTargets);
  const waves = targetWaves(targetMap, selectedTargets);
  const demandPlan = buildDemandPlan(request.planId, targetMap, waves);

  const targetResults = [];
  const combinedResources = new Map();
  const parkedTargetIds = new Set();
  let carriedReservations = new Map();
  let carriedCapacity = new Map();

  for (const [waveIndex, targetIds] of waves.entries()) {
    const usedCapacity = new Map(carriedCapacity);
    const reservations = new Map(carriedReservations);
    const mandatoryCandidates = [];
    for (const targetId of targetIds) {
      const target = targetMap.get(targetId);
      const dependencyBlockers = target.dependsOn.filter((dependency) =>
        parkedTargetIds.has(dependency));
      if (dependencyBlockers.length > 0) {
        parkedTargetIds.add(targetId);
        targetResults.push({
          targetId,
          wave: waveIndex,
          state: 'PARKED',
          dependsOn: target.dependsOn,
          focusedCheckSelectors: target.focusedCheckSelectors,
          journeySelectors: target.journeySelectors,
          gateSelectors: target.gateSelectors,
          requirementIds: target.resourceRequirements.map(
            (requirement) => requirement.requirementId,
          ),
          blockers: [
            {
              code: 'RESOURCE_DEPENDENCY_PARKED',
              targetId,
              dependencyTargetIds: dependencyBlockers,
            },
          ],
        });
        continue;
      }
      const mergedRequirements = new Map();
      for (const requirement of target.resourceRequirements) {
        mergeRequirement(mergedRequirements, requirement, targetId);
      }
      const resolvedTarget = {
        ...target,
        resourceRequirements: [...mergedRequirements.values()].sort(
          (left, right) =>
            left.requirementId.localeCompare(right.requirementId),
        ),
      };
      mandatoryCandidates.push({
        target,
        resolvedTarget,
        mandatoryTarget: {
          ...resolvedTarget,
          resourceRequirements: resolvedTarget.resourceRequirements.filter(
            (requirement) => requirement.mandatory,
          ),
        },
      });
    }

    const mandatoryWave = allocateMandatoryWave(
      mandatoryCandidates.map((candidate) => candidate.mandatoryTarget),
      request.inventory,
      usedCapacity,
      reservations,
    );
    const readyTargets = [];
    for (const candidate of mandatoryCandidates) {
      const { target, resolvedTarget } = candidate;
      const blockers = mandatoryWave.parked.get(target.targetId);
      if (blockers) {
        parkedTargetIds.add(target.targetId);
        targetResults.push({
          targetId: target.targetId,
          wave: waveIndex,
          state: 'PARKED',
          dependsOn: target.dependsOn,
          focusedCheckSelectors: target.focusedCheckSelectors,
          journeySelectors: target.journeySelectors,
          gateSelectors: target.gateSelectors,
          requirementIds: resolvedTarget.resourceRequirements.map(
            (requirement) => requirement.requirementId,
          ),
          blockers,
        });
        continue;
      }
      readyTargets.push({
        target,
        resolvedTarget,
        allocations: [
          ...(mandatoryWave.allocationsByTarget.get(target.targetId) ?? []),
        ],
      });
    }

    for (const readyTarget of readyTargets) {
      const { target, resolvedTarget } = readyTarget;
      const optionalAllocation = allocateTarget(
        {
          ...resolvedTarget,
          resourceRequirements: resolvedTarget.resourceRequirements.filter(
            (requirement) => !requirement.mandatory,
          ),
        },
        request.inventory,
        usedCapacity,
        reservations,
      );
      const allocations = [
        ...readyTarget.allocations,
        ...optionalAllocation.allocations,
      ];
      targetResults.push({
        targetId: target.targetId,
        wave: waveIndex,
        state: 'ALLOCATED',
        dependsOn: target.dependsOn,
        focusedCheckSelectors: target.focusedCheckSelectors,
        journeySelectors: target.journeySelectors,
        gateSelectors: target.gateSelectors,
        requirementIds: resolvedTarget.resourceRequirements.map(
          (requirement) => requirement.requirementId,
        ),
        blockers: [],
      });
      for (const item of allocations) {
        for (const selection of item.selections) {
          const key = `${selection.resourceKind}:${selection.resourceId}`;
          const requirementKey = idempotencyKey(
            request.planId,
            item.requirement,
          );
          const current = combinedResources.get(key);
          combinedResources.set(key, {
            ...selection,
            action: mergeResourceAction(current?.action, selection.action),
            mode:
              current?.mode === 'exclusive'
              || item.requirement.mode === 'exclusive'
                ? 'exclusive'
                : 'shared',
            targetIds: [
              ...new Set([...(current?.targetIds ?? []), target.targetId]),
            ].sort(),
            requirementIds: [
              ...new Set([
                ...(current?.requirementIds ?? []),
                item.requirement.requirementId,
              ]),
            ].sort(),
            idempotencyKeys: [
              ...new Set([
                ...(current?.idempotencyKeys ?? []),
                requirementKey,
              ]),
            ].sort(),
          });
        }
      }
    }
    carriedReservations = carryPersistentReservations(reservations);
    carriedCapacity = capacityFromReservations(carriedReservations);
  }

  const allocatedTargetIds = new Set(
    targetResults
      .filter((target) => target.state === 'ALLOCATED')
      .map((target) => target.targetId),
  );
  const resources = [...combinedResources.values()]
    .filter((resource) =>
      resource.targetIds.some((targetId) => allocatedTargetIds.has(targetId)))
    .sort((left, right) =>
      `${left.resourceKind}:${left.resourceId}`.localeCompare(
        `${right.resourceKind}:${right.resourceId}`,
      ));
  const runtimeClaims = parseRuntimeClaims(
    runtimeClaimSpec(
      resources.map((resource) => ({
        kind: resource.resourceKind,
        resourceId: resource.resourceId,
        mode: resource.mode,
      })),
    ),
  );
  const resourceResults = resources.map((resource) => ({
    resourceKind: resource.resourceKind,
    resourceId: resource.resourceId,
    action: resource.action,
    status: resource.action === 'REUSE' ? 'READY' : 'PENDING',
    owner: resource.owner,
    manifestRef: resource.manifestRef,
    digests: resource.digests,
    targetIds: resource.targetIds,
    requirementIds: resource.requirementIds,
    idempotencyKeys: resource.idempotencyKeys,
  }));
  const blockedTargets = targetResults.filter(
    (target) => target.state === 'PARKED',
  );
  const allocationState =
    blockedTargets.length === 0
      ? 'READY'
      : allocatedTargetIds.size === 0
        ? 'PARKED'
        : 'PARTIALLY_READY';
  const moduleImpactDigests = request.moduleImpacts
    .map((impact) => ({
      moduleId: impact.moduleId,
      digest: digestValue(impact),
    }))
    .sort((left, right) => left.moduleId.localeCompare(right.moduleId));
  const proofDecisions = request.moduleImpacts
    .map((impact) => ({
      moduleId: impact.moduleId,
      action: impact.proof.action,
      proofDigest: digestValue(impact.proof),
    }))
    .sort((left, right) => left.moduleId.localeCompare(right.moduleId));
  const proofAction = proofDecisions.reduce(
    (current, item) =>
      PROOF_PRECEDENCE.get(item.action) > PROOF_PRECEDENCE.get(current)
        ? item.action
        : current,
    'REUSE_CANDIDATE',
  );
  const checks = new Set();
  const journeys = new Set();
  const gates = new Set();
  const targetState = new Map(
    targetResults.map((target) => [target.targetId, target.state]),
  );
  const moduleStateById = new Map();
  const resolvingModules = new Set();
  function resolveModuleState(moduleId) {
    if (moduleStateById.has(moduleId)) return moduleStateById.get(moduleId);
    if (resolvingModules.has(moduleId)) {
      fail(
        'MODULE_IMPACT_DEPENDENCY_CYCLE',
        'module impact dependencies contain a cycle',
        { moduleId },
      );
    }
    resolvingModules.add(moduleId);
    const impact = impactByModule.get(moduleId);
    const targetIds = moduleTargetIds.get(moduleId) ?? [];
    const blockedDependencyIds = impact.moduleDependencies.filter(
      (dependencyId) =>
        impactByModule.has(dependencyId)
        && resolveModuleState(dependencyId).state !== 'READY',
    );
    const blockedTargetIds = targetIds.filter(
      (targetId) => targetState.get(targetId) !== 'ALLOCATED',
    );
    const result = {
      moduleId,
      state:
        blockedTargetIds.length === 0 && blockedDependencyIds.length === 0
          ? 'READY'
          : 'PARKED',
      targetIds: [...targetIds].sort(),
      dependencyModuleIds: impact.moduleDependencies,
      blockedDependencyIds,
      blockedTargetIds,
    };
    resolvingModules.delete(moduleId);
    moduleStateById.set(moduleId, result);
    return result;
  }
  const moduleStates = request.moduleImpacts
    .map((impact) => resolveModuleState(impact.moduleId))
    .sort((left, right) => left.moduleId.localeCompare(right.moduleId));
  const readyModuleIds = new Set(
    moduleStates
      .filter((module) => module.state === 'READY')
      .map((module) => module.moduleId),
  );
  for (const impact of request.moduleImpacts) {
    impact.requirements.focusedCheckSelectors.forEach((value) =>
      checks.add(value));
    if (readyModuleIds.has(impact.moduleId)) {
      impact.requirements.journeySelectors.forEach((value) =>
        journeys.add(value));
      impact.requirements.gateSelectors.forEach((value) => gates.add(value));
    }
  }
  for (const targetId of allocatedTargetIds) {
    const target = targetMap.get(targetId);
    target.focusedCheckSelectors.forEach((value) => checks.add(value));
    target.journeySelectors.forEach((value) => journeys.add(value));
    target.gateSelectors.forEach((value) => gates.add(value));
  }

  const allocation = {
    kind: RESOURCE_PLAN_KIND,
    schemaVersion: RESOURCE_SCHEMA_VERSION,
    planId: request.planId,
    taskId: request.taskId,
    source: request.source,
    moduleImpactDigests,
    moduleStates,
    proofAction,
    proofDecisions,
    selectedTargetIds: [...selectedTargets].sort(),
    executionWaves: waves,
    targets: targetResults.sort((left, right) =>
      left.targetId.localeCompare(right.targetId)),
    requirements: demandPlan.requirements,
    capacity: demandPlan.capacity,
    focusedCheckSelectors: [...checks].sort(),
    journeySelectors: [...journeys].sort(),
    gateSelectors: [...gates].sort(),
    allocationState,
    runtimeClaims,
    acquisition: {
      reservation: 'atomic-per-target',
      order: runtimeClaims.map(
        (claim) => `${claim.kind}:${claim.resourceId}`,
      ),
      holdAndWait: 'forbidden',
      physicalLeaseOwner: 'runtime-owner',
      gatePolicy: 'attach-only',
    },
    resourceResults,
    blockers: blockedTargets.flatMap((target) => target.blockers),
  };
  return {
    ...allocation,
    allocationDigest: digestValue(allocation),
  };
}

export function planResourceReceiptPath(options) {
  return path.join(
    workspaceWorkflowPath(options.workItemId, {
      home: options.home,
      repoRoot: options.workspaceRoot,
    }),
    'resource-plan.json',
  );
}

function writeJsonAtomic(file, value) {
  const directory = path.dirname(file);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const temporary = path.join(
    directory,
    `.${path.basename(file)}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`,
  );
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(
      descriptor,
      `${JSON.stringify(canonicalize(value), null, 2)}\n`,
    );
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, file);
    chmodSync(file, 0o600);
    if (process.platform !== 'win32') {
      const directoryDescriptor = openSync(directory, 'r');
      try {
        fsyncSync(directoryDescriptor);
      } finally {
        closeSync(directoryDescriptor);
      }
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function receiptDigest(receipt) {
  const unsigned = { ...receipt };
  delete unsigned.receiptDigest;
  return digestValue(unsigned);
}

export function readPlanResourceReceipt(options) {
  const file = options.resourcePlanFile ?? planResourceReceiptPath(options);
  if (!existsSync(file)) {
    fail('RESOURCE_PLAN_MISSING', 'resource plan receipt does not exist');
  }
  const metadata = lstatSync(file);
  const ownedByCurrentUser =
    typeof process.getuid !== 'function' || metadata.uid === process.getuid();
  if (
    !metadata.isFile()
    || metadata.isSymbolicLink()
    || !ownedByCurrentUser
    || (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0)
  ) {
    fail(
      'RESOURCE_PLAN_INVALID',
      'resource plan receipt must be an owner-controlled regular file',
    );
  }
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    fail('RESOURCE_PLAN_INVALID', 'resource plan receipt is unreadable', {
      cause: String(error),
    });
  }
  if (
    receipt?.kind !== RESOURCE_PLAN_KIND
    || receipt?.schemaVersion !== RESOURCE_SCHEMA_VERSION
    || receipt.receiptDigest !== receiptDigest(receipt)
  ) {
    fail('RESOURCE_PLAN_INVALID', 'resource plan receipt identity is invalid');
  }
  return receipt;
}

function claimKey(claim) {
  return `${claim.kind}:${claim.resourceId}`;
}

function hasPlannerMarker(declaration) {
  return declaration.runtimeClaims.some(
    (claim) =>
      claim.kind === 'resource.plan'
      && claim.resourceId === declaration.workItemId,
  );
}

function assertPreviousReceiptProvenance(receipt, declaration) {
  if (
    receipt.workItemId !== declaration.workItemId
    || receipt.workspaceId !== declaration.workspaceId
    || receipt.declarationId !== declaration.declarationId
    || receipt.planId !== declaration.planId
  ) {
    fail(
      'RESOURCE_PLAN_IDENTITY_MISMATCH',
      'existing resource plan does not match the active declaration',
    );
  }
  if (
    !Array.isArray(receipt.baseRuntimeClaims)
    || !Array.isArray(receipt.plannedRuntimeClaims)
  ) {
    fail(
      'RESOURCE_PLAN_INVALID',
      'existing resource plan claim provenance is invalid',
    );
  }
}

function declarationClaimsForPlan(declaration, previousReceipt, nextClaims) {
  const previousKeys = new Set(
    (previousReceipt?.plannedRuntimeClaims ?? []).map(claimKey),
  );
  const previousBaseKeys = new Set(
    (previousReceipt?.baseRuntimeClaims ?? []).map(claimKey),
  );
  const baseRuntimeClaims = declaration.runtimeClaims.filter(
    (claim) =>
      !previousKeys.has(claimKey(claim))
      || previousBaseKeys.has(claimKey(claim)),
  );
  const plannedRuntimeClaims = nextClaims.filter((planned) => {
    const base = baseRuntimeClaims.find(
      (claim) => claimKey(claim) === claimKey(planned),
    );
    if (!base) return true;
    if (
      base.mode !== planned.mode
      && !(base.mode === 'exclusive' && planned.mode === 'shared')
    ) {
      fail(
        'RESOURCE_CLAIM_PROVENANCE_CONFLICT',
        'planner cannot strengthen a pre-existing declaration claim',
        {
          resource: claimKey(planned),
          baseMode: base.mode,
          plannedMode: planned.mode,
        },
      );
    }
    return false;
  });
  return {
    baseRuntimeClaims,
    declarationRuntimeClaims: parseRuntimeClaims(
      runtimeClaimSpec([...baseRuntimeClaims, ...plannedRuntimeClaims]),
    ),
    plannedRuntimeClaims,
  };
}

function runtimeState(resourceResults, targetResults) {
  if (resourceResults.some((result) => result.status === 'QUARANTINED')) {
    return 'QUARANTINED';
  }
  if (resourceResults.some((result) => result.status === 'PENDING')) {
    return 'PENDING';
  }
  return (
    targetResults.length > 0
    && targetResults.every((target) => target.state === 'PARKED')
  )
    ? 'PARKED'
    : 'READY';
}

function loadJsonFile(file, field) {
  try {
    const value = JSON.parse(readFileSync(path.resolve(file), 'utf8'));
    if (!isObject(value)) throw new Error('root value must be an object');
    return value;
  } catch (error) {
    fail('RESOURCE_PLAN_INVALID', `${field} is unreadable`, {
      file,
      cause: String(error),
    });
  }
}

function resourceIdentity(value) {
  const separator = value.indexOf(':');
  return separator === -1
    ? null
    : {
        resourceKind: value.slice(0, separator),
        resourceId: value.slice(separator + 1),
      };
}

function withResourcePlanLifecycleLock(options, dependencies, operation) {
  const withLock =
    dependencies.withWorkspaceLifecycleLockSync
    ?? withWorkspaceLifecycleLockSync;
  try {
    return withLock(
      {
        home: options.home,
        workspaceRoot: options.workspaceRoot ?? repoRoot,
        lifecycleLease: options.lifecycleLease,
        lockTimeoutMs: options.lifecycleLockTimeoutMs,
        lifecycleFailpoint: options.lifecycleFailpoint,
      },
      (lifecycleLease) =>
        operation({
          ...options,
          workspaceRoot: options.workspaceRoot ?? repoRoot,
          lifecycleLease,
        }),
    );
  } catch (error) {
    if (error instanceof WorkspaceLifecycleLockError) {
      fail(error.code, error.message, error.detail);
    }
    throw error;
  }
}

function inspectCurrentSource(options, dependencies) {
  return (dependencies.inspectGitWorkspace ?? inspectGitWorkspace)(
    options.workspaceRoot ?? repoRoot,
  );
}

function assertCurrentSource(expected, actual) {
  if (actual.stable === false) {
    fail(
      'RESOURCE_PLAN_SOURCE_UNSTABLE',
      'workspace source changed while resource identity was captured',
    );
  }
  const mismatches = {};
  for (const field of ['commit', 'workspaceDigest']) {
    if (expected[field] !== actual[field]) {
      mismatches[field] = {
        expected: expected[field],
        actual: actual[field],
      };
    }
  }
  if (Object.keys(mismatches).length > 0) {
    fail(
      'RESOURCE_PLAN_SOURCE_STALE',
      'resource request does not match the current workspace source',
      { mismatches },
    );
  }
}

function buildResourceReceipt({
  plan,
  previous,
  declaration,
  inputDigest,
  baseRuntimeClaims,
  plannedRuntimeClaims,
  runtimeClaims,
  preparationState,
  declarationDigest,
  now,
}) {
  const sameAllocation =
    previous?.inputDigest === inputDigest
    && previous?.sourceHead === declaration.sourceHead
    && previous?.allocationDigest === plan.allocationDigest;
  const fencingToken = sameAllocation
    ? previous.fencingToken
    : (previous?.fencingToken ?? 0) + 1;
  const resourceResults = sameAllocation
    ? previous.resourceResults
    : plan.resourceResults;
  const receipt = {
    ...plan,
    workItemId: declaration.workItemId,
    workspaceId: declaration.workspaceId,
    sourceHead: declaration.sourceHead,
    inputDigest,
    fencingToken,
    preparedAt:
      sameAllocation && previous?.preparedAt
        ? previous.preparedAt
        : now.toISOString(),
    preparationState,
    declarationId: declaration.declarationId,
    declarationDigest,
    baseRuntimeClaims,
    plannedRuntimeClaims,
    declarationRuntimeClaims: runtimeClaims,
    resourceResults,
    runtimeState: runtimeState(resourceResults, plan.targets),
  };
  receipt.receiptDigest = receiptDigest(receipt);
  return receipt;
}

function prepareDevelopmentResourcesUnderFence(options, dependencies) {
  const requireDeclaration =
    dependencies.requireActiveDeclaration ?? requireActiveDeclaration;
  const updateDeclaration =
    dependencies.startOrUpdateDeclaration ?? startOrUpdateDeclaration;
  const now = dependencies.now ?? new Date();
  const declaration = requireDeclaration(options);
  const request =
    options.resourceRequest
    ?? loadJsonFile(options.resourceInput, 'resource input');
  let plan = buildPlanResourcePlan(request);
  const actualSource = inspectCurrentSource(options, dependencies);
  assertCurrentSource(plan.source, actualSource);
  for (const [field, expected, actual] of [
    ['planId', declaration.planId, plan.planId],
    ['taskId', declaration.taskId, plan.taskId],
    ['source.commit', declaration.sourceHead, plan.source.commit],
  ]) {
    if (expected !== actual) {
      fail('RESOURCE_PLAN_IDENTITY_MISMATCH', `${field} does not match`, {
        expected,
        actual,
      });
    }
  }

  let previous = null;
  try {
    previous = readPlanResourceReceipt(options);
  } catch (error) {
    if (!(error instanceof ResourcePlanError) || error.code !== 'RESOURCE_PLAN_MISSING') {
      throw error;
    }
  }
  if (previous === null && hasPlannerMarker(declaration)) {
    fail(
      'RESOURCE_PLAN_MISSING',
      'planner-owned declaration claims require their prior resource plan receipt',
    );
  }
  if (previous !== null) {
    assertPreviousReceiptProvenance(previous, declaration);
  }
  const inputDigest = digestValue(request);
  let runtimeClaims;
  let baseRuntimeClaims;
  let plannedRuntimeClaims;
  let updatedDeclaration;
  let provisionalReceipt;
  const conflictedResources = new Set();
  while (true) {
    const requestedClaims =
      plan.runtimeClaims.length === 0
        ? []
        : parseRuntimeClaims(
            runtimeClaimSpec([
              ...plan.runtimeClaims,
              {
                kind: 'resource.plan',
                resourceId: declaration.workItemId,
                mode: 'shared',
              },
            ]),
          );
    const claimPlan = declarationClaimsForPlan(
      declaration,
      previous,
      requestedClaims,
    );
    baseRuntimeClaims = claimPlan.baseRuntimeClaims;
    plannedRuntimeClaims = claimPlan.plannedRuntimeClaims;
    runtimeClaims = claimPlan.declarationRuntimeClaims;
    const recoverablePlannedRuntimeClaims = parseRuntimeClaims(
      runtimeClaimSpec([
        ...(previous?.plannedRuntimeClaims ?? []),
        ...plannedRuntimeClaims,
      ]),
    );
    provisionalReceipt = buildResourceReceipt({
      plan,
      previous,
      declaration,
      inputDigest,
      baseRuntimeClaims,
      plannedRuntimeClaims: recoverablePlannedRuntimeClaims,
      runtimeClaims,
      preparationState: 'RESERVING',
      declarationDigest: null,
      now,
    });
    writeJsonAtomic(
      options.resourcePlanFile ?? planResourceReceiptPath(options),
      provisionalReceipt,
    );
    try {
      updatedDeclaration = updateDeclaration(
        {
          ...options,
          workItemId: declaration.workItemId,
          sessionId: declaration.sessionId,
          owner: declaration.owner,
          purpose: declaration.purpose,
          journeyId: declaration.journeyId ?? undefined,
          planPath: declaration.planPath ?? undefined,
          planId: declaration.planId ?? undefined,
          taskId: declaration.taskId ?? undefined,
          sourceClaims: declaration.sourceClaims
            .map((claim) => `${claim.mode}:${claim.pathPrefix}`)
            .join(';'),
          runtimeClaims: runtimeClaimSpec(runtimeClaims),
        },
        { requireExisting: true },
      );
      const sourceAfterDeclaration = inspectCurrentSource(
        options,
        dependencies,
      );
      assertCurrentSource(plan.source, sourceAfterDeclaration);
      if (updatedDeclaration.sourceHead !== sourceAfterDeclaration.commit) {
        fail(
          'RESOURCE_PLAN_SOURCE_STALE',
          'declaration source changed during resource preparation',
          {
            declared: updatedDeclaration.sourceHead,
            actual: sourceAfterDeclaration.commit,
          },
        );
      }
      break;
    } catch (error) {
      if (
        !(error instanceof DevWorkError)
        || error.code !== 'RESOURCE_DECLARATION_CONFLICT'
        || error.detail?.kind !== 'RUNTIME_RESOURCE_CONFLICT'
      ) {
        throw error;
      }
      const identity = resourceIdentity(error.detail.resource);
      if (!identity) throw error;
      const key = `${identity.resourceKind}:${identity.resourceId}`;
      if (conflictedResources.has(key)) throw error;
      conflictedResources.add(key);
      const inventory = request.inventory.map((resource) => {
        const resourceKey =
          `${resource.resourceKind}:${resource.resourceId}`;
        return conflictedResources.has(resourceKey)
          ? { ...resource, state: 'UNAVAILABLE' }
          : resource;
      });
      if (
        inventory.every(
          (resource, index) => resource.state === request.inventory[index].state,
        )
      ) {
        throw error;
      }
      plan = buildPlanResourcePlan({ ...request, inventory });
    }
  }
  const receipt = buildResourceReceipt({
    plan,
    previous: provisionalReceipt,
    declaration,
    inputDigest,
    baseRuntimeClaims,
    plannedRuntimeClaims,
    runtimeClaims,
    preparationState: 'COMMITTED',
    declarationDigest: updatedDeclaration.declarationDigest,
    now,
  });
  writeJsonAtomic(
    options.resourcePlanFile ?? planResourceReceiptPath(options),
    receipt,
  );
  return receipt;
}

export function prepareDevelopmentResources(options, dependencies = {}) {
  return withResourcePlanLifecycleLock(
    options,
    dependencies,
    (lockedOptions) =>
      prepareDevelopmentResourcesUnderFence(lockedOptions, dependencies),
  );
}

function validateOwnerResult(value) {
  assertClosedObject(value, RESULT_KEYS, 'resource result');
  if (
    value.kind !== RESOURCE_RESULT_KIND
    || value.schemaVersion !== RESOURCE_SCHEMA_VERSION
    || !Number.isInteger(value.fencingToken)
    || value.fencingToken < 1
    || !RESULT_STATES.has(value.status)
  ) {
    fail('RESOURCE_RESULT_INVALID', 'resource result identity is invalid');
  }
  return {
    ...value,
    allocationDigest: requiredDigest(
      value.allocationDigest,
      'resource result allocationDigest',
    ),
    resourceKind: requiredIdentifier(
      value.resourceKind,
      'resource result resourceKind',
    ),
    resourceId: requiredIdentifier(
      value.resourceId,
      'resource result resourceId',
    ),
    owner: requiredIdentifier(value.owner, 'resource result owner'),
    manifestRef: requiredText(
      value.manifestRef,
      'resource result manifestRef',
      2048,
    ),
    digests: validateDigests(value.digests, 'resource result digests'),
  };
}

function claimsCover(currentClaims, plannedClaims) {
  return plannedClaims.every((planned) => {
    const current = currentClaims.find(
      (claim) =>
        claim.kind === planned.kind
        && claim.resourceId === planned.resourceId,
    );
    return (
      current
      && (
        current.mode === planned.mode
        || (current.mode === 'exclusive' && planned.mode === 'shared')
      )
    );
  });
}

function declarationCoversPlan(declaration, receipt) {
  return claimsCover(
    declaration.runtimeClaims,
    receipt.plannedRuntimeClaims,
  );
}

export function validatePreparedResourceClaim(options, dependencies = {}) {
  const file = options.resourcePlanFile ?? planResourceReceiptPath(options);
  const declaration = options.declaration;
  const plannerMarker = declaration?.runtimeClaims?.some(
    (claim) =>
      claim.kind === 'resource.plan'
      && claim.resourceId === declaration.workItemId,
  );
  if (!existsSync(file)) {
    if (plannerMarker) {
      fail(
        'RESOURCE_PLAN_MISSING',
        'planner-owned runtime claims require their resource plan receipt',
      );
    }
    return { authority: 'declaration' };
  }
  const receipt = readPlanResourceReceipt({
    ...options,
    resourcePlanFile: file,
  });
  if (
    !Array.isArray(receipt.baseRuntimeClaims)
    || !Array.isArray(receipt.plannedRuntimeClaims)
    || !isObject(receipt.source)
  ) {
    fail('RESOURCE_PLAN_INVALID', 'resource plan admission data is invalid');
  }
  const planned = receipt.plannedRuntimeClaims.find(
    (claim) =>
      claim.kind === options.resourceKind
      && claim.resourceId === options.resourceId,
  );
  if (!planned) return { authority: 'declaration' };
  if (claimsCover(receipt.baseRuntimeClaims ?? [], [planned])) {
    return { authority: 'declaration' };
  }
  if (receipt.preparationState !== 'COMMITTED') {
    fail(
      'RESOURCE_PLAN_NOT_COMMITTED',
      'planner-owned runtime claim has no committed resource plan',
    );
  }
  if (
    !isObject(declaration)
    || receipt.declarationId !== declaration.declarationId
    || receipt.planId !== declaration.planId
    || receipt.taskId !== declaration.taskId
    || receipt.sourceHead !== declaration.sourceHead
    || !declarationCoversPlan(declaration, receipt)
  ) {
    fail(
      'RESOURCE_PLAN_DECLARATION_STALE',
      'planner-owned runtime claim does not match its declaration',
    );
  }
  const source = inspectCurrentSource(options, dependencies);
  assertCurrentSource(receipt.source, source);
  return {
    authority: 'resource-plan',
    allocationDigest: receipt.allocationDigest,
    fencingToken: receipt.fencingToken,
  };
}

function recordDevelopmentResourceResultUnderFence(options, dependencies) {
  const requireDeclaration =
    dependencies.requireActiveDeclaration ?? requireActiveDeclaration;
  const declaration = requireDeclaration(options);
  const receipt = readPlanResourceReceipt(options);
  if (
    !Array.isArray(receipt.requirements)
    || !Array.isArray(receipt.resourceResults)
    || !Array.isArray(receipt.plannedRuntimeClaims)
    || !isObject(receipt.source)
  ) {
    fail('RESOURCE_PLAN_INVALID', 'resource plan result data is invalid');
  }
  const actualSource = inspectCurrentSource(options, dependencies);
  assertCurrentSource(receipt.source, actualSource);
  const result = validateOwnerResult(
    options.resourceResult
    ?? loadJsonFile(options.resourceResultFile, 'resource result'),
  );
  if (
    receipt.planId !== declaration.planId
    || receipt.taskId !== declaration.taskId
    || receipt.sourceHead !== declaration.sourceHead
    || receipt.declarationId !== declaration.declarationId
  ) {
    fail(
      'RESOURCE_PLAN_IDENTITY_MISMATCH',
      'resource plan no longer matches the active declaration',
    );
  }
  if (receipt.preparationState !== 'COMMITTED') {
    fail(
      'RESOURCE_PLAN_NOT_COMMITTED',
      'resource owner result requires a committed resource plan',
    );
  }
  if (!declarationCoversPlan(declaration, receipt)) {
    fail(
      'RESOURCE_PLAN_DECLARATION_STALE',
      'active declaration no longer contains the prepared resource claims',
    );
  }
  if (
    result.allocationDigest !== receipt.allocationDigest
    || result.fencingToken !== receipt.fencingToken
  ) {
    fail('RESOURCE_RESULT_STALE', 'resource result fencing is stale', {
      expectedAllocationDigest: receipt.allocationDigest,
      expectedFencingToken: receipt.fencingToken,
    });
  }
  const index = receipt.resourceResults.findIndex(
    (candidate) =>
      candidate.resourceKind === result.resourceKind
      && candidate.resourceId === result.resourceId,
  );
  if (index === -1) {
    fail(
      'RESOURCE_RESULT_UNPLANNED',
      'resource result does not belong to the prepared plan',
    );
  }
  const existing = receipt.resourceResults[index];
  if (result.owner !== existing.owner) {
    fail(
      'RESOURCE_RESULT_OWNER_MISMATCH',
      'resource result owner does not match the selected runtime owner',
      { expected: existing.owner, actual: result.owner },
    );
  }
  if (result.status === 'READY') {
    if (!Array.isArray(existing.idempotencyKeys)) {
      fail(
        'RESOURCE_PLAN_INVALID',
        'resource result is missing exact requirement provenance',
      );
    }
    const requirementKeys = new Set(existing.idempotencyKeys);
    const requirements = receipt.requirements.filter((requirement) =>
      requirementKeys.has(requirement.idempotencyKey));
    if (requirements.length !== requirementKeys.size) {
      fail(
        'RESOURCE_PLAN_INVALID',
        'resource result references unknown requirement provenance',
      );
    }
    const mismatch = requirements.find(
      (requirement) =>
        !digestsMatch(requirement.expectedDigests, result.digests),
    );
    if (mismatch) {
      fail(
        'RESOURCE_RESULT_IDENTITY_MISMATCH',
        'resource result does not satisfy the planned digest identity',
        { requirementId: mismatch.requirementId },
      );
    }
  }
  const recorded = {
    ...existing,
    status: result.status,
    manifestRef: result.manifestRef,
    digests: result.digests,
  };
  if (
    existing.status !== 'PENDING'
    && JSON.stringify(canonicalize(existing))
      !== JSON.stringify(canonicalize(recorded))
  ) {
    fail(
      'RESOURCE_RESULT_CONFLICT',
      'resource result was already recorded with different content',
    );
  }
  receipt.resourceResults[index] = recorded;
  receipt.runtimeState = runtimeState(
    receipt.resourceResults,
    receipt.targets,
  );
  receipt.receiptDigest = receiptDigest(receipt);
  writeJsonAtomic(
    options.resourcePlanFile ?? planResourceReceiptPath(options),
    receipt,
  );
  return receipt;
}

export function recordDevelopmentResourceResult(options, dependencies = {}) {
  return withResourcePlanLifecycleLock(
    options,
    dependencies,
    (lockedOptions) =>
      recordDevelopmentResourceResultUnderFence(lockedOptions, dependencies),
  );
}

export function statusDevelopmentResources(options, dependencies = {}) {
  const receipt = readPlanResourceReceipt(options);
  const source = inspectCurrentSource(options, dependencies);
  const current =
    (dependencies.statusCurrent ?? statusCurrent)(options).declarations.find(
      (declaration) => declaration.workItemId === options.workItemId,
    ) ?? null;
  const staleReasons = [];
  if (receipt.preparationState !== 'COMMITTED') {
    staleReasons.push('RESOURCE_PLAN_NOT_COMMITTED');
  }
  if (!source.stable) staleReasons.push('WORKSPACE_SOURCE_UNSTABLE');
  for (const field of ['commit', 'workspaceDigest']) {
    if (receipt.source[field] !== source[field]) {
      staleReasons.push(
        field === 'commit'
          ? 'SOURCE_COMMIT_MISMATCH'
          : 'SOURCE_WORKSPACE_DIGEST_MISMATCH',
      );
    }
  }
  if (
    current === null
    || current.state !== 'ACTIVE'
    || current.planId !== receipt.planId
    || current.taskId !== receipt.taskId
    || current.sourceHead !== receipt.sourceHead
  ) {
    staleReasons.push('DECLARATION_IDENTITY_MISMATCH');
  } else if (!declarationCoversPlan(current, receipt)) {
    staleReasons.push('DECLARATION_RESOURCE_SCOPE_MISMATCH');
  }
  return {
    status: staleReasons.length === 0 ? 'CURRENT' : 'STALE',
    staleReasons: [...new Set(staleReasons)].sort(),
    receipt,
  };
}
