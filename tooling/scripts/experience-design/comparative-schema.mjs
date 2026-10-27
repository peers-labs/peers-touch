import fs from 'node:fs';
import path from 'node:path';

import {
  ExperienceDesignError,
  canonicalDigest,
  equalStringSets,
  isPlainObject,
} from './canonical.mjs';

export const COMPARATIVE_SCHEMA_VERSION = 1;
export const ORACLE_KIND = 'peers-touch-outcome-oracle';
export const CONTEXT_KIND = 'peers-touch-comparison-context';
export const EVIDENCE_LEDGER_KIND = 'peers-touch-comparison-evidence-ledger';
export const OBSERVATION_KIND = 'peers-touch-journey-observation';
export const ORACLE_EVALUATION_KIND = 'peers-touch-oracle-evaluation';
export const LEG_REVIEW_KIND = 'peers-touch-comparison-leg-review';
export const PAIRED_CASE_KIND = 'peers-touch-paired-experience-case';

export const PLATFORMS = Object.freeze([
  'desktop',
  'mobile',
  'browser',
  'dashboard',
]);
export const STATE_KINDS = Object.freeze([
  'entry',
  'empty',
  'loading',
  'waiting',
  'pending',
  'partial-success',
  'success',
  'failure',
  'unknown-outcome',
  'recovery',
  'cancelled',
  'offline',
  'degraded',
  'restored',
  'long-content',
  'narrow',
]);
export const EVIDENCE_LEVELS = Object.freeze([
  'L1_CONTRACT',
  'L2_VISUAL',
  'L3_DYNAMIC',
  'L4_RUNTIME',
]);
export const ORACLE_CRITICALITIES = Object.freeze([
  'safety',
  'blocking',
  'required',
  'quality',
]);
export const ORACLE_RESULTS = Object.freeze(['met', 'not-met', 'unproven']);
export const REVIEW_DECISIONS = Object.freeze([
  'accepted',
  'changes-required',
  'unproven',
]);
export const BLINDED_ALIASES = Object.freeze(['A', 'B']);
export const SOURCE_KINDS = Object.freeze([
  'source',
  'prototype',
  'production',
]);

const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export function comparativeFail(code, message, details = undefined) {
  throw new ExperienceDesignError(code, message, details);
}

function assertObject(value, required, optional, context, code) {
  if (!isPlainObject(value)) {
    comparativeFail(code, `${context} must be an object`);
  }
  const allowed = new Set([...required, ...optional]);
  const missing = required
    .filter((key) => !Object.hasOwn(value, key))
    .sort();
  const unknown = Object.keys(value)
    .filter((key) => !allowed.has(key))
    .sort();
  if (missing.length > 0 || unknown.length > 0) {
    comparativeFail(code, `${context} has an invalid field set`, {
      missing,
      unknown,
    });
  }
}

function assertArray(value, context, code, { min = 0 } = {}) {
  if (!Array.isArray(value) || value.length < min) {
    comparativeFail(
      code,
      `${context} must be an array with at least ${min} item(s)`,
    );
  }
  return value;
}

function assertString(value, context, code, pattern = null) {
  if (
    typeof value !== 'string'
    || value.trim() === ''
    || (pattern !== null && !pattern.test(value))
  ) {
    comparativeFail(code, `${context} must be a valid non-empty string`);
  }
  return value;
}

function assertOptionalString(value, context, code) {
  if (value !== undefined) assertString(value, context, code);
}

export function assertComparativeStableId(value, context, code) {
  return assertString(value, context, code, STABLE_ID);
}

export function assertComparativeDigest(value, context, code) {
  return assertString(value, context, code, DIGEST);
}

function assertTimestamp(value, context, code) {
  if (
    typeof value !== 'string'
    || !TIMESTAMP.test(value)
    || new Date(value).toISOString() !== value
  ) {
    comparativeFail(code, `${context} must be a canonical UTC timestamp`);
  }
}

function assertBoolean(value, context, code) {
  if (typeof value !== 'boolean') {
    comparativeFail(code, `${context} must be a boolean`);
  }
}

function assertInteger(value, context, code, { min = 0 } = {}) {
  if (!Number.isSafeInteger(value) || value < min) {
    comparativeFail(
      code,
      `${context} must be an integer greater than or equal to ${min}`,
    );
  }
}

function assertEnum(value, values, context, code) {
  if (!values.includes(value)) {
    comparativeFail(code, `${context} must be one of ${values.join(', ')}`);
  }
}

function assertUniqueStrings(
  value,
  context,
  code,
  { min = 0, stableIds = false } = {},
) {
  assertArray(value, context, code, { min });
  value.forEach((item, index) => {
    if (stableIds) {
      assertComparativeStableId(item, `${context}[${index}]`, code);
    } else {
      assertString(item, `${context}[${index}]`, code);
    }
  });
  if (new Set(value).size !== value.length) {
    comparativeFail(code, `${context} must contain unique values`);
  }
  return value;
}

function indexById(values, context, code) {
  const result = new Map();
  values.forEach((value, index) => {
    const id = assertComparativeStableId(
      value?.id,
      `${context}[${index}].id`,
      code,
    );
    if (result.has(id)) {
      comparativeFail(code, `${context} contains duplicate id ${id}`);
    }
    result.set(id, value);
  });
  return result;
}

function requireReference(index, id, context, code) {
  if (!index.has(id)) {
    comparativeFail(code, `${context} references unknown id ${id}`);
  }
  return index.get(id);
}

function requireReferences(index, ids, context, code, { min = 0 } = {}) {
  assertUniqueStrings(ids, context, code, { min, stableIds: true });
  return ids.map((id) => requireReference(index, id, context, code));
}

function assertKind(value, kind, context, code) {
  if (value.kind !== kind || value.schemaVersion !== COMPARATIVE_SCHEMA_VERSION) {
    comparativeFail(code, `${context} kind or schemaVersion is unsupported`);
  }
}

export function validateArtifactRef(value, context, code) {
  assertObject(value, ['path', 'digest'], [], context, code);
  assertString(value.path, `${context}.path`, code);
  if (
    value.path.includes('\\')
    || path.posix.isAbsolute(value.path)
    || path.posix.normalize(value.path) !== value.path
    || value.path === '.'
    || value.path.startsWith('../')
  ) {
    comparativeFail(code, `${context}.path must be a normalized relative path`);
  }
  assertComparativeDigest(value.digest, `${context}.digest`, code);
  return value;
}

function resolveContainedPath(packageRoot, sourcePath, context, code) {
  let root;
  let candidate;
  try {
    root = fs.realpathSync(path.resolve(packageRoot));
    candidate = fs.realpathSync(
      path.isAbsolute(sourcePath)
        ? sourcePath
        : path.join(root, sourcePath),
    );
  } catch (error) {
    comparativeFail(code, `${context} cannot be resolved`, {
      reason: error.message,
    });
  }
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    comparativeFail(code, `${context} escapes package root`);
  }
  return candidate;
}

export function readContainedJson(
  packageRoot,
  sourcePath,
  context,
  code = 'EDX_COMPARE_LEG_INVALID',
) {
  const absolute = resolveContainedPath(
    packageRoot,
    sourcePath,
    context,
    code,
  );
  try {
    return {
      absolute,
      value: JSON.parse(fs.readFileSync(absolute, 'utf8')),
    };
  } catch (error) {
    comparativeFail(code, `${context} must be readable JSON`, {
      reason: error.message,
    });
  }
}

export function readComparativeArtifact(
  packageRoot,
  ref,
  context,
  validator,
  code = 'EDX_COMPARE_LEG_INVALID',
) {
  validateArtifactRef(ref, context, code);
  const loaded = readContainedJson(
    packageRoot,
    ref.path,
    `${context}.path`,
    code,
  );
  validator(loaded.value, context);
  const digest = canonicalDigest(loaded.value);
  if (digest !== ref.digest) {
    comparativeFail(code, `${context} digest is stale`, {
      expected: ref.digest,
      actual: digest,
    });
  }
  return { ...loaded, digest };
}

export function validateOutcomeOracle(value, context = 'OutcomeOracle') {
  const code = 'EDX_COMPARE_ORACLE_INVALID';
  assertObject(
    value,
    [
      'kind',
      'schemaVersion',
      'id',
      'journeyId',
      'productThesisDigest',
      'comparisonContextDigest',
      'assertions',
      'authoredById',
      'frozenAt',
    ],
    [],
    context,
    code,
  );
  assertKind(value, ORACLE_KIND, context, code);
  assertComparativeStableId(value.id, `${context}.id`, code);
  assertComparativeStableId(value.journeyId, `${context}.journeyId`, code);
  assertComparativeDigest(
    value.productThesisDigest,
    `${context}.productThesisDigest`,
    code,
  );
  assertComparativeDigest(
    value.comparisonContextDigest,
    `${context}.comparisonContextDigest`,
    code,
  );
  assertComparativeStableId(
    value.authoredById,
    `${context}.authoredById`,
    code,
  );
  assertTimestamp(value.frozenAt, `${context}.frozenAt`, code);
  assertArray(value.assertions, `${context}.assertions`, code, { min: 1 });
  indexById(value.assertions, `${context}.assertions`, code);
  value.assertions.forEach((assertion, index) => {
    const item = `${context}.assertions[${index}]`;
    assertObject(
      assertion,
      [
        'id',
        'promisedOutcome',
        'criticality',
        'observableStateKinds',
        'requiredEvidenceLevels',
        'disallowedSubstitutes',
      ],
      [],
      item,
      code,
    );
    assertString(assertion.promisedOutcome, `${item}.promisedOutcome`, code);
    assertEnum(
      assertion.criticality,
      ORACLE_CRITICALITIES,
      `${item}.criticality`,
      code,
    );
    assertUniqueStrings(
      assertion.observableStateKinds,
      `${item}.observableStateKinds`,
      code,
      { min: 1 },
    );
    assertion.observableStateKinds.forEach((kind, kindIndex) =>
      assertEnum(
        kind,
        STATE_KINDS,
        `${item}.observableStateKinds[${kindIndex}]`,
        code,
      ));
    assertUniqueStrings(
      assertion.requiredEvidenceLevels,
      `${item}.requiredEvidenceLevels`,
      code,
      { min: 1 },
    );
    assertion.requiredEvidenceLevels.forEach((level, levelIndex) =>
      assertEnum(
        level,
        EVIDENCE_LEVELS,
        `${item}.requiredEvidenceLevels[${levelIndex}]`,
        code,
      ));
    assertUniqueStrings(
      assertion.disallowedSubstitutes,
      `${item}.disallowedSubstitutes`,
      code,
    );
  });
  return value;
}

export function validateComparisonContext(
  value,
  context = 'ComparisonContext',
) {
  const code = 'EDX_COMPARE_CONTEXT_MISMATCH';
  assertObject(
    value,
    [
      'kind',
      'schemaVersion',
      'id',
      'journeyId',
      'actorArchetype',
      'startingState',
      'taskPrompt',
      'platform',
      'locale',
      'viewport',
      'inputMode',
      'dataFixtureDigest',
      'accountState',
      'capabilityAvailability',
      'networkProfile',
    ],
    ['timeBudgetMs'],
    context,
    code,
  );
  assertKind(value, CONTEXT_KIND, context, code);
  assertComparativeStableId(value.id, `${context}.id`, code);
  assertComparativeStableId(value.journeyId, `${context}.journeyId`, code);
  [
    'actorArchetype',
    'startingState',
    'taskPrompt',
    'locale',
    'inputMode',
    'accountState',
    'networkProfile',
  ].forEach((field) => assertString(value[field], `${context}.${field}`, code));
  assertEnum(value.platform, PLATFORMS, `${context}.platform`, code);
  assertObject(
    value.viewport,
    ['widthCssPx', 'heightCssPx', 'devicePixelRatio'],
    [],
    `${context}.viewport`,
    code,
  );
  assertInteger(
    value.viewport.widthCssPx,
    `${context}.viewport.widthCssPx`,
    code,
    { min: 1 },
  );
  assertInteger(
    value.viewport.heightCssPx,
    `${context}.viewport.heightCssPx`,
    code,
    { min: 1 },
  );
  if (
    typeof value.viewport.devicePixelRatio !== 'number'
    || !Number.isFinite(value.viewport.devicePixelRatio)
    || value.viewport.devicePixelRatio <= 0
  ) {
    comparativeFail(
      code,
      `${context}.viewport.devicePixelRatio must be positive`,
    );
  }
  assertComparativeDigest(
    value.dataFixtureDigest,
    `${context}.dataFixtureDigest`,
    code,
  );
  assertUniqueStrings(
    value.capabilityAvailability,
    `${context}.capabilityAvailability`,
    code,
    { stableIds: true },
  );
  if (value.timeBudgetMs !== undefined) {
    assertInteger(value.timeBudgetMs, `${context}.timeBudgetMs`, code, {
      min: 1,
    });
  }
  return value;
}

export function validateEvidenceLedger(
  value,
  context = 'EvidenceLedger',
) {
  const code = 'EDX_COMPARE_EVIDENCE_UNPROVEN';
  assertObject(
    value,
    ['kind', 'schemaVersion', 'id', 'legId', 'authoredByIds', 'records'],
    [],
    context,
    code,
  );
  assertKind(value, EVIDENCE_LEDGER_KIND, context, code);
  assertComparativeStableId(value.id, `${context}.id`, code);
  assertComparativeStableId(value.legId, `${context}.legId`, code);
  assertUniqueStrings(
    value.authoredByIds,
    `${context}.authoredByIds`,
    code,
    { min: 1, stableIds: true },
  );
  assertArray(value.records, `${context}.records`, code, { min: 1 });
  indexById(value.records, `${context}.records`, code);
  value.records.forEach((record, index) => {
    const item = `${context}.records[${index}]`;
    assertObject(
      record,
      [
        'id',
        'level',
        'status',
        'claimIds',
        'sourceDigest',
      ],
      [
        'artifact',
        'artifactDigest',
        'inspectedById',
        'observedAt',
        'reason',
      ],
      item,
      code,
    );
    assertEnum(record.level, EVIDENCE_LEVELS, `${item}.level`, code);
    assertEnum(
      record.status,
      ['observed', 'unproven'],
      `${item}.status`,
      code,
    );
    assertUniqueStrings(record.claimIds, `${item}.claimIds`, code, {
      min: 1,
      stableIds: true,
    });
    assertComparativeDigest(record.sourceDigest, `${item}.sourceDigest`, code);
    if (record.status === 'observed' && record.level !== 'L1_CONTRACT') {
      ['artifact', 'artifactDigest', 'inspectedById', 'observedAt']
        .forEach((field) => {
          if (record[field] === undefined) {
            comparativeFail(
              code,
              `${item}.${field} is required for observed ${record.level}`,
            );
          }
        });
    }
    assertOptionalString(record.artifact, `${item}.artifact`, code);
    if (record.artifactDigest !== undefined) {
      assertComparativeDigest(
        record.artifactDigest,
        `${item}.artifactDigest`,
        code,
      );
    }
    if (record.inspectedById !== undefined) {
      assertComparativeStableId(
        record.inspectedById,
        `${item}.inspectedById`,
        code,
      );
      if (!value.authoredByIds.includes(record.inspectedById)) {
        comparativeFail(
          code,
          `${item}.inspectedById must be an evidence author`,
        );
      }
    }
    if (record.observedAt !== undefined) {
      assertTimestamp(record.observedAt, `${item}.observedAt`, code);
    }
    if (record.status === 'unproven') {
      assertString(record.reason, `${item}.reason`, code);
    } else if (record.reason !== undefined) {
      comparativeFail(code, `${item}.reason is only legal for unproven data`);
    }
  });
  return value;
}

function validateObservationState(value, context, code) {
  assertObject(
    value,
    ['id', 'kind', 'contextId', 'ordinal', 'visibleMeaning', 'inScope'],
    [],
    context,
    code,
  );
  assertComparativeStableId(value.id, `${context}.id`, code);
  assertEnum(value.kind, STATE_KINDS, `${context}.kind`, code);
  assertComparativeStableId(value.contextId, `${context}.contextId`, code);
  assertInteger(value.ordinal, `${context}.ordinal`, code);
  assertString(value.visibleMeaning, `${context}.visibleMeaning`, code);
  assertBoolean(value.inScope, `${context}.inScope`, code);
}

export function validateJourneyObservation(
  value,
  context = 'JourneyObservation',
) {
  const code = 'EDX_COMPARE_LEG_INVALID';
  assertObject(
    value,
    [
      'kind',
      'schemaVersion',
      'id',
      'journeyId',
      'blindedAlias',
      'authoredById',
      'evidenceAuthorIds',
      'contextDigest',
      'evidenceLedgerDigest',
      'facts',
      'states',
      'edges',
      'observedActions',
      'recoveryObservations',
      'primaryPathEdgeIds',
      'evidenceIds',
    ],
    [],
    context,
    code,
  );
  assertKind(value, OBSERVATION_KIND, context, code);
  assertComparativeStableId(value.id, `${context}.id`, code);
  assertComparativeStableId(value.journeyId, `${context}.journeyId`, code);
  assertEnum(
    value.blindedAlias,
    BLINDED_ALIASES,
    `${context}.blindedAlias`,
    code,
  );
  assertComparativeStableId(
    value.authoredById,
    `${context}.authoredById`,
    code,
  );
  assertUniqueStrings(
    value.evidenceAuthorIds,
    `${context}.evidenceAuthorIds`,
    code,
    { min: 1, stableIds: true },
  );
  assertComparativeDigest(value.contextDigest, `${context}.contextDigest`, code);
  assertComparativeDigest(
    value.evidenceLedgerDigest,
    `${context}.evidenceLedgerDigest`,
    code,
  );
  assertArray(value.states, `${context}.states`, code, { min: 1 });
  value.states.forEach((state, index) =>
    validateObservationState(state, `${context}.states[${index}]`, code));
  const stateById = indexById(value.states, `${context}.states`, code);
  const ordinals = value.states.map((state) => state.ordinal).sort((a, b) => a - b);
  if (
    ordinals.some((ordinal, index) => ordinal !== index)
    || value.states.filter((state) => state.kind === 'entry').length !== 1
    || !value.states.some((state) => state.kind === 'entry' && state.ordinal === 0)
  ) {
    comparativeFail(
      code,
      `${context}.states must have contiguous ordinals and one entry at 0`,
    );
  }

  assertArray(value.facts, `${context}.facts`, code, { min: 1 });
  const factById = indexById(value.facts, `${context}.facts`, code);
  value.facts.forEach((fact, index) => {
    const item = `${context}.facts[${index}]`;
    assertObject(
      fact,
      ['id', 'stateId', 'statement', 'evidenceIds'],
      ['visibleAction', 'visibleResponse'],
      item,
      code,
    );
    requireReference(stateById, fact.stateId, `${item}.stateId`, code);
    assertString(fact.statement, `${item}.statement`, code);
    assertOptionalString(fact.visibleAction, `${item}.visibleAction`, code);
    assertOptionalString(fact.visibleResponse, `${item}.visibleResponse`, code);
    assertUniqueStrings(fact.evidenceIds, `${item}.evidenceIds`, code, {
      min: 1,
      stableIds: true,
    });
  });

  assertArray(value.edges, `${context}.edges`, code, { min: 1 });
  const edgeById = indexById(value.edges, `${context}.edges`, code);
  value.edges.forEach((edge, index) => {
    const item = `${context}.edges[${index}]`;
    assertObject(
      edge,
      ['id', 'fromStateId', 'toStateId', 'actionFactId', 'responseFactId'],
      [],
      item,
      code,
    );
    requireReference(stateById, edge.fromStateId, `${item}.fromStateId`, code);
    requireReference(stateById, edge.toStateId, `${item}.toStateId`, code);
    const action = requireReference(
      factById,
      edge.actionFactId,
      `${item}.actionFactId`,
      code,
    );
    const response = requireReference(
      factById,
      edge.responseFactId,
      `${item}.responseFactId`,
      code,
    );
    if (
      action.visibleAction === undefined
      || response.visibleResponse === undefined
      || action.stateId !== edge.fromStateId
      || response.stateId !== edge.toStateId
    ) {
      comparativeFail(
        code,
        `${item} requires visible action/response facts bound to its endpoints`,
      );
    }
  });

  assertArray(
    value.observedActions,
    `${context}.observedActions`,
    code,
    { min: 1 },
  );
  const actionByEdge = new Map();
  value.observedActions.forEach((action, index) => {
    const item = `${context}.observedActions[${index}]`;
    assertObject(
      action,
      ['id', 'edgeId', 'mutation', 'decisionCost', 'interruption'],
      [],
      item,
      code,
    );
    assertComparativeStableId(action.id, `${item}.id`, code);
    requireReference(edgeById, action.edgeId, `${item}.edgeId`, code);
    if (actionByEdge.has(action.edgeId)) {
      comparativeFail(code, `${context} has duplicate action for ${action.edgeId}`);
    }
    actionByEdge.set(action.edgeId, action);
    assertEnum(
      action.mutation,
      ['none', 'local', 'external-reversible', 'external-irreversible'],
      `${item}.mutation`,
      code,
    );
    assertInteger(action.decisionCost, `${item}.decisionCost`, code);
    if (action.decisionCost > 2) {
      comparativeFail(code, `${item}.decisionCost must be 0, 1, or 2`);
    }
    assertEnum(
      action.interruption,
      ['none', 'permission', 'authentication', 'setup'],
      `${item}.interruption`,
      code,
    );
  });
  if (actionByEdge.size !== edgeById.size) {
    comparativeFail(
      code,
      `${context} requires exactly one observed action per edge`,
    );
  }

  const reachable = new Set([
    value.states.find((state) => state.ordinal === 0).id,
  ]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of value.edges) {
      if (reachable.has(edge.fromStateId) && !reachable.has(edge.toStateId)) {
        reachable.add(edge.toStateId);
        changed = true;
      }
    }
  }
  const unreachable = value.states
    .filter((state) => state.inScope && !reachable.has(state.id))
    .map((state) => state.id);
  if (unreachable.length > 0) {
    comparativeFail(code, `${context} contains unreachable in-scope states`, {
      unreachable,
    });
  }

  assertUniqueStrings(
    value.primaryPathEdgeIds,
    `${context}.primaryPathEdgeIds`,
    code,
    { min: 1, stableIds: true },
  );
  const pathEdges = value.primaryPathEdgeIds.map((edgeId) =>
    requireReference(edgeById, edgeId, `${context}.primaryPathEdgeIds`, code));
  let currentState = value.states.find((state) => state.ordinal === 0).id;
  const visited = new Set([currentState]);
  pathEdges.forEach((edge, index) => {
    if (edge.fromStateId !== currentState || visited.has(edge.toStateId)) {
      comparativeFail(
        code,
        `${context}.primaryPathEdgeIds is not one contiguous acyclic path`,
        { edgeIndex: index },
      );
    }
    if (!actionByEdge.has(edge.id)) {
      comparativeFail(
        code,
        `${context}.primaryPathEdgeIds requires an observed action for ${edge.id}`,
      );
    }
    visited.add(edge.toStateId);
    currentState = edge.toStateId;
  });

  assertArray(
    value.recoveryObservations,
    `${context}.recoveryObservations`,
    code,
  );
  value.recoveryObservations.forEach((recovery, index) => {
    const item = `${context}.recoveryObservations[${index}]`;
    assertObject(
      recovery,
      [
        'sourceStateId',
        'entryActionVisible',
        'preservedState',
        'evidenceIds',
      ],
      ['returnStateId'],
      item,
      code,
    );
    requireReference(
      stateById,
      recovery.sourceStateId,
      `${item}.sourceStateId`,
      code,
    );
    assertBoolean(
      recovery.entryActionVisible,
      `${item}.entryActionVisible`,
      code,
    );
    assertUniqueStrings(
      recovery.preservedState,
      `${item}.preservedState`,
      code,
      { stableIds: true },
    );
    assertUniqueStrings(recovery.evidenceIds, `${item}.evidenceIds`, code, {
      min: 1,
      stableIds: true,
    });
    if (recovery.returnStateId !== undefined) {
      requireReference(
        stateById,
        recovery.returnStateId,
        `${item}.returnStateId`,
        code,
      );
    }
  });
  assertUniqueStrings(value.evidenceIds, `${context}.evidenceIds`, code, {
    min: 1,
    stableIds: true,
  });
  return value;
}

export function validateOracleEvaluation(
  value,
  context = 'OracleEvaluation',
) {
  const code = 'EDX_COMPARE_LEG_INVALID';
  assertObject(
    value,
    [
      'kind',
      'schemaVersion',
      'id',
      'legId',
      'blindedAlias',
      'oracleDigest',
      'contextDigest',
      'observationDigest',
      'evidenceLedgerDigest',
      'authorId',
      'results',
    ],
    [],
    context,
    code,
  );
  assertKind(value, ORACLE_EVALUATION_KIND, context, code);
  ['id', 'legId', 'authorId'].forEach((field) =>
    assertComparativeStableId(value[field], `${context}.${field}`, code));
  assertEnum(
    value.blindedAlias,
    BLINDED_ALIASES,
    `${context}.blindedAlias`,
    code,
  );
  [
    'oracleDigest',
    'contextDigest',
    'observationDigest',
    'evidenceLedgerDigest',
  ].forEach((field) =>
    assertComparativeDigest(value[field], `${context}.${field}`, code));
  assertArray(value.results, `${context}.results`, code, { min: 1 });
  indexById(value.results, `${context}.results`, code);
  value.results.forEach((result, index) => {
    const item = `${context}.results[${index}]`;
    assertObject(
      result,
      ['id', 'assertionId', 'result', 'factIds', 'evidenceIds', 'rationale'],
      [],
      item,
      code,
    );
    assertComparativeStableId(result.assertionId, `${item}.assertionId`, code);
    assertEnum(result.result, ORACLE_RESULTS, `${item}.result`, code);
    assertUniqueStrings(result.factIds, `${item}.factIds`, code, {
      stableIds: true,
    });
    assertUniqueStrings(result.evidenceIds, `${item}.evidenceIds`, code, {
      stableIds: true,
    });
    assertString(result.rationale, `${item}.rationale`, code);
    if (
      result.result !== 'unproven'
      && (result.factIds.length === 0 || result.evidenceIds.length === 0)
    ) {
      comparativeFail(
        code,
        `${item} requires facts and evidence for a proven result`,
      );
    }
  });
  return value;
}

export function validateLegReview(value, context = 'LegReview') {
  const code = 'EDX_COMPARE_REVIEW_REQUIRED';
  assertObject(
    value,
    [
      'kind',
      'schemaVersion',
      'legId',
      'evaluationDigest',
      'reviewerId',
      'reviewedAt',
      'decision',
      'reviewNotes',
      'reviewerFindings',
    ],
    [],
    context,
    code,
  );
  assertKind(value, LEG_REVIEW_KIND, context, code);
  assertComparativeStableId(value.legId, `${context}.legId`, code);
  assertComparativeDigest(
    value.evaluationDigest,
    `${context}.evaluationDigest`,
    code,
  );
  assertComparativeStableId(value.reviewerId, `${context}.reviewerId`, code);
  assertTimestamp(value.reviewedAt, `${context}.reviewedAt`, code);
  assertEnum(value.decision, REVIEW_DECISIONS, `${context}.decision`, code);
  assertUniqueStrings(value.reviewNotes, `${context}.reviewNotes`, code);
  assertArray(value.reviewerFindings, `${context}.reviewerFindings`, code);
  indexById(value.reviewerFindings, `${context}.reviewerFindings`, code);
  value.reviewerFindings.forEach((finding, index) => {
    const item = `${context}.reviewerFindings[${index}]`;
    assertObject(
      finding,
      ['id', 'severity', 'observed', 'correction'],
      [],
      item,
      code,
    );
    assertEnum(
      finding.severity,
      ['blocking', 'warning'],
      `${item}.severity`,
      code,
    );
    assertString(finding.observed, `${item}.observed`, code);
    assertString(finding.correction, `${item}.correction`, code);
  });
  return value;
}

export function validatePairedExperienceCase(
  value,
  context = 'PairedExperienceCase',
) {
  const code = 'EDX_COMPARE_PAIR_STALE';
  assertObject(
    value,
    [
      'kind',
      'schemaVersion',
      'id',
      'journeyId',
      'oracle',
      'comparisonContext',
      'legs',
      'pairingAuthorId',
    ],
    [],
    context,
    code,
  );
  assertKind(value, PAIRED_CASE_KIND, context, code);
  assertComparativeStableId(value.id, `${context}.id`, code);
  assertComparativeStableId(value.journeyId, `${context}.journeyId`, code);
  validateArtifactRef(value.oracle, `${context}.oracle`, code);
  validateArtifactRef(
    value.comparisonContext,
    `${context}.comparisonContext`,
    code,
  );
  assertComparativeStableId(
    value.pairingAuthorId,
    `${context}.pairingAuthorId`,
    code,
  );
  assertArray(value.legs, `${context}.legs`, code, { min: 2 });
  if (value.legs.length !== 2) {
    comparativeFail(code, `${context}.legs must contain exactly two legs`);
  }
  const aliases = [];
  value.legs.forEach((leg, index) => {
    const item = `${context}.legs[${index}]`;
    assertObject(
      leg,
      [
        'id',
        'blindedAlias',
        'sourceKind',
        'observation',
        'evidenceLedger',
        'oracleEvaluation',
        'legReview',
      ],
      [],
      item,
      code,
    );
    assertComparativeStableId(leg.id, `${item}.id`, code);
    assertEnum(leg.blindedAlias, BLINDED_ALIASES, `${item}.blindedAlias`, code);
    aliases.push(leg.blindedAlias);
    assertEnum(leg.sourceKind, SOURCE_KINDS, `${item}.sourceKind`, code);
    validateArtifactRef(leg.observation, `${item}.observation`, code);
    validateArtifactRef(leg.evidenceLedger, `${item}.evidenceLedger`, code);
    validateArtifactRef(leg.oracleEvaluation, `${item}.oracleEvaluation`, code);
    validateArtifactRef(leg.legReview, `${item}.legReview`, code);
  });
  if (!equalStringSets(aliases, BLINDED_ALIASES)) {
    comparativeFail(code, `${context}.legs must contain aliases A and B`);
  }
  if (new Set(value.legs.map((leg) => leg.id)).size !== 2) {
    comparativeFail(code, `${context}.legs must have unique IDs`);
  }
  return value;
}

function validateLegBindings({
  pair,
  leg,
  oracle,
  comparisonContext,
  observation,
  evidenceLedger,
  evaluation,
  review,
  inputAuthorIds,
}) {
  const code = 'EDX_COMPARE_LEG_INVALID';
  const contextDigest = canonicalDigest(comparisonContext);
  const oracleDigest = canonicalDigest(oracle);
  const observationDigest = canonicalDigest(observation);
  const evidenceDigest = canonicalDigest(evidenceLedger);
  const evaluationDigest = canonicalDigest(evaluation);
  if (
    observation.id !== leg.id
    || observation.blindedAlias !== leg.blindedAlias
    || observation.journeyId !== pair.journeyId
    || observation.contextDigest !== contextDigest
    || observation.evidenceLedgerDigest !== evidenceDigest
    || evidenceLedger.legId !== leg.id
    || evaluation.legId !== leg.id
    || evaluation.blindedAlias !== leg.blindedAlias
    || evaluation.oracleDigest !== oracleDigest
    || evaluation.contextDigest !== contextDigest
    || evaluation.observationDigest !== observationDigest
    || evaluation.evidenceLedgerDigest !== evidenceDigest
    || review.legId !== leg.id
    || review.evaluationDigest !== evaluationDigest
  ) {
    comparativeFail(code, `leg ${leg.blindedAlias} bindings are stale`);
  }
  if (
    !equalStringSets(observation.evidenceAuthorIds, evidenceLedger.authoredByIds)
  ) {
    comparativeFail(
      code,
      `leg ${leg.blindedAlias} evidence authors do not match`,
    );
  }
  const evidenceIds = evidenceLedger.records.map((record) => record.id);
  if (!equalStringSets(observation.evidenceIds, evidenceIds)) {
    comparativeFail(
      code,
      `leg ${leg.blindedAlias} evidence inventory is incomplete`,
    );
  }
  const factById = new Set(observation.facts.map((fact) => fact.id));
  const evidenceById = new Set(evidenceIds);
  for (const fact of observation.facts) {
    fact.evidenceIds.forEach((id) => {
      if (!evidenceById.has(id)) {
        comparativeFail(code, `fact ${fact.id} references unknown evidence ${id}`);
      }
    });
  }
  for (const recovery of observation.recoveryObservations) {
    recovery.evidenceIds.forEach((id) => {
      if (!evidenceById.has(id)) {
        comparativeFail(
          code,
          `recovery at ${recovery.sourceStateId} references unknown evidence ${id}`,
        );
      }
    });
  }
  const assertionIds = oracle.assertions.map((assertion) => assertion.id);
  if (
    !equalStringSets(
      assertionIds,
      evaluation.results.map((result) => result.assertionId),
    )
  ) {
    comparativeFail(
      code,
      `leg ${leg.blindedAlias} must evaluate every Oracle assertion exactly once`,
    );
  }
  for (const result of evaluation.results) {
    result.factIds.forEach((id) => {
      if (!factById.has(id)) {
        comparativeFail(
          code,
          `Oracle result ${result.id} references unknown fact ${id}`,
        );
      }
    });
    result.evidenceIds.forEach((id) => {
      if (!evidenceById.has(id)) {
        comparativeFail(
          code,
          `Oracle result ${result.id} references unknown evidence ${id}`,
        );
      }
    });
    const requiredLevels = oracle.assertions.find(
      (assertion) => assertion.id === result.assertionId,
    ).requiredEvidenceLevels;
    const suppliedRecords = result.evidenceIds.map((id) =>
      evidenceLedger.records.find((record) => record.id === id));
    if (
      suppliedRecords.some(
        (record) => !record.claimIds.includes(result.assertionId),
      )
    ) {
      comparativeFail(
        code,
        `Oracle result ${result.id} uses evidence for another claim`,
      );
    }
    const suppliedLevels = suppliedRecords
      .filter((record) => record.status === 'observed')
      .map((record) => record.level);
    if (
      result.result !== 'unproven'
      && requiredLevels.some((level) => !suppliedLevels.includes(level))
    ) {
      comparativeFail(
        'EDX_COMPARE_EVIDENCE_UNPROVEN',
        `Oracle result ${result.id} lacks required evidence levels`,
      );
    }
    const assertion = oracle.assertions.find(
      (candidate) => candidate.id === result.assertionId,
    );
    if (
      result.result === 'met'
      && !observation.states.some(
        (state) =>
          state.inScope
          && assertion.observableStateKinds.includes(state.kind),
      )
    ) {
      comparativeFail(
        code,
        `Oracle result ${result.id} has no observable satisfying state`,
      );
    }
    if (
      result.result !== 'unproven'
      && result.factIds.some((id) => {
        const fact = observation.facts.find((candidate) => candidate.id === id);
        return !observation.states.find(
          (state) => state.id === fact.stateId,
        ).inScope;
      })
    ) {
      comparativeFail(
        code,
        `Oracle result ${result.id} uses an out-of-scope fact`,
      );
    }
  }
  const hasUnproven = evaluation.results.some(
    (result) => result.result === 'unproven',
  );
  const hasBlocking = review.reviewerFindings.some(
    (finding) => finding.severity === 'blocking',
  );
  const expectedDecision = hasBlocking
    ? 'changes-required'
    : hasUnproven
      ? 'unproven'
      : 'accepted';
  if (review.decision !== expectedDecision || review.decision === 'changes-required') {
    comparativeFail(
      'EDX_COMPARE_REVIEW_REQUIRED',
      `leg ${leg.blindedAlias} review decision is incompatible or blocking`,
      { expectedDecision, actual: review.decision },
    );
  }
  const legInputAuthors = new Set([
    oracle.authoredById,
    observation.authoredById,
    ...observation.evidenceAuthorIds,
    evaluation.authorId,
  ]);
  if (legInputAuthors.has(review.reviewerId)) {
    comparativeFail(
      'EDX_COMPARE_REVIEW_REQUIRED',
      `leg ${leg.blindedAlias} reviewer overlaps an input author`,
    );
  }
  inputAuthorIds.add(observation.authoredById);
  observation.evidenceAuthorIds.forEach((id) => inputAuthorIds.add(id));
  inputAuthorIds.add(evaluation.authorId);
  inputAuthorIds.add(review.reviewerId);
}

export function loadPairedExperienceCase(casePath, packageRoot) {
  const loadedCase = readContainedJson(
    packageRoot,
    casePath,
    'PairedExperienceCase',
    'EDX_COMPARE_PAIR_STALE',
  );
  const pair = validatePairedExperienceCase(loadedCase.value);
  const oracleArtifact = readComparativeArtifact(
    packageRoot,
    pair.oracle,
    'PairedExperienceCase.oracle',
    validateOutcomeOracle,
    'EDX_COMPARE_ORACLE_INVALID',
  );
  const contextArtifact = readComparativeArtifact(
    packageRoot,
    pair.comparisonContext,
    'PairedExperienceCase.comparisonContext',
    validateComparisonContext,
    'EDX_COMPARE_CONTEXT_MISMATCH',
  );
  const oracle = oracleArtifact.value;
  const comparisonContext = contextArtifact.value;
  if (
    oracle.journeyId !== pair.journeyId
    || comparisonContext.journeyId !== pair.journeyId
    || oracle.comparisonContextDigest !== contextArtifact.digest
  ) {
    comparativeFail(
      'EDX_COMPARE_CONTEXT_MISMATCH',
      'Oracle, Context and Pair Journey bindings disagree',
    );
  }

  const inputAuthorIds = new Set([oracle.authoredById]);
  const legs = pair.legs.map((leg) => {
    const prefix = `PairedExperienceCase.legs.${leg.blindedAlias}`;
    const observation = readComparativeArtifact(
      packageRoot,
      leg.observation,
      `${prefix}.observation`,
      validateJourneyObservation,
    );
    const evidenceLedger = readComparativeArtifact(
      packageRoot,
      leg.evidenceLedger,
      `${prefix}.evidenceLedger`,
      validateEvidenceLedger,
      'EDX_COMPARE_EVIDENCE_UNPROVEN',
    );
    const evaluation = readComparativeArtifact(
      packageRoot,
      leg.oracleEvaluation,
      `${prefix}.oracleEvaluation`,
      validateOracleEvaluation,
    );
    const review = readComparativeArtifact(
      packageRoot,
      leg.legReview,
      `${prefix}.legReview`,
      validateLegReview,
      'EDX_COMPARE_REVIEW_REQUIRED',
    );
    validateLegBindings({
      pair,
      leg,
      oracle,
      comparisonContext,
      observation: observation.value,
      evidenceLedger: evidenceLedger.value,
      evaluation: evaluation.value,
      review: review.value,
      inputAuthorIds,
    });
    return {
      descriptor: leg,
      observation: observation.value,
      evidenceLedger: evidenceLedger.value,
      evaluation: evaluation.value,
      review: review.value,
      digests: {
        observation: observation.digest,
        evidenceLedger: evidenceLedger.digest,
        evaluation: evaluation.digest,
        review: review.digest,
      },
    };
  });
  const legAuthors = new Set(
    legs.flatMap((leg) => [
      leg.observation.authoredById,
      ...leg.observation.evidenceAuthorIds,
      leg.evaluation.authorId,
    ]),
  );
  if (legAuthors.has(oracle.authoredById)) {
    comparativeFail(
      'EDX_COMPARE_REVIEW_REQUIRED',
      'Oracle author must not author either comparison leg',
    );
  }
  for (const leg of legs) {
    if (legAuthors.has(leg.review.reviewerId)) {
      comparativeFail(
        'EDX_COMPARE_REVIEW_REQUIRED',
        `leg ${leg.descriptor.blindedAlias} reviewer overlaps a comparison author`,
      );
    }
  }
  if (inputAuthorIds.has(pair.pairingAuthorId)) {
    comparativeFail(
      'EDX_COMPARE_REVIEW_REQUIRED',
      'pairing author overlaps an Oracle, leg, evidence or review author',
    );
  }
  return {
    pair,
    oracle,
    comparisonContext,
    legs,
    digests: {
      pair: canonicalDigest(pair),
      oracle: oracleArtifact.digest,
      context: contextArtifact.digest,
    },
    authorIds: [...inputAuthorIds, pair.pairingAuthorId].sort(),
  };
}
