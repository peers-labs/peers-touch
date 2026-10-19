import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import {
  ADMISSION_STAGES,
  CASE_COVERAGE,
  CONFIDENCES,
  CONTRACT_AUTHORITIES,
  EVIDENCE_LEVELS,
  ExperienceReviewError,
  IMPACT_CLASSES,
  INELIGIBLE_REASONS,
  RECOVERY_DISTANCES,
  RETURN_TARGET_KINDS,
  REVIEW_RESULT_KIND,
  REVIEW_RESULT_SCHEMA_VERSION,
  SEVERITIES,
  STATE_ORIGINS,
  VERDICTS,
  assertArray,
  assertBoolean,
  assertClosedObject,
  assertEnum,
  assertInteger,
  assertObjectShape,
  assertOptionalString,
  assertSha256Digest,
  assertSourceBlobDigest,
  assertSourceHead,
  assertSourceLocation,
  assertStableId,
  assertString,
  assertUniqueIds,
  assertUniqueStrings,
  fail,
  indexById,
  requireReference,
  requireReferences,
} from './schema.mjs';
import {
  findingFromLedgerEntry,
  orderJourneyStates,
  rankEligibleCandidates,
  recomputeCandidateLedger,
} from './ranking.mjs';

function assertDeepEqual(actual, expected, code, message) {
  if (!isDeepStrictEqual(actual, expected)) {
    fail(code, message, { actual, expected });
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function sha256Bytes(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export function digestReviewResult(value) {
  return sha256Bytes(Buffer.from(JSON.stringify(canonicalize(value)), 'utf8'));
}

function validateBinding(value) {
  assertClosedObject(
    value,
    [
      'packageId',
      'runEnvelopeDigest',
      'caseDigest',
      'sourceHead',
      'manifestDigest',
      'rubricDigest',
      'sourceBlobAlgorithm',
      'sourceBlobs',
    ],
    'evaluationBinding',
  );
  assertStableId(value.packageId, 'evaluationBinding.packageId');
  assertSha256Digest(
    value.runEnvelopeDigest,
    'evaluationBinding.runEnvelopeDigest',
  );
  assertSha256Digest(value.caseDigest, 'evaluationBinding.caseDigest');
  assertSourceHead(value.sourceHead, 'evaluationBinding.sourceHead');
  assertSha256Digest(value.manifestDigest, 'evaluationBinding.manifestDigest');
  assertSha256Digest(value.rubricDigest, 'evaluationBinding.rubricDigest');
  assertEnum(
    value.sourceBlobAlgorithm,
    ['git-sha1', 'sha256'],
    'evaluationBinding.sourceBlobAlgorithm',
  );
  assertArray(value.sourceBlobs, 'evaluationBinding.sourceBlobs', { min: 1 });
  const paths = [];
  value.sourceBlobs.forEach((blob, index) => {
    const context = `evaluationBinding.sourceBlobs[${index}]`;
    assertClosedObject(blob, ['path', 'digest'], context);
    assertString(blob.path, `${context}.path`);
    assertSourceBlobDigest(
      blob.digest,
      value.sourceBlobAlgorithm,
      `${context}.digest`,
    );
    paths.push(blob.path);
  });
  if (new Set(paths).size !== paths.length) {
    fail(
      'EDX_BINDING_INVALID',
      'evaluationBinding.sourceBlobs contains duplicate paths',
    );
  }
  const sorted = [...paths].sort();
  if (!isDeepStrictEqual(paths, sorted)) {
    fail(
      'EDX_BINDING_INVALID',
      'evaluationBinding.sourceBlobs must be sorted by path',
    );
  }
  return new Set(paths);
}

function validateFacts(values, sourcePaths) {
  assertArray(values, 'facts', { min: 1 });
  assertUniqueIds(values, 'facts');
  values.forEach((fact, index) => {
    const context = `facts[${index}]`;
    assertObjectShape(
      fact,
      ['id', 'stateId', 'source', 'statement'],
      ['visibleAction', 'visibleResponse'],
      context,
    );
    assertStableId(fact.stateId, `${context}.stateId`);
    assertSourceLocation(fact.source, `${context}.source`);
    if (!sourcePaths.has(fact.source.path)) {
      fail(
        'EDX_BINDING_INVALID',
        `${context}.source.path is absent from sourceBlobs`,
      );
    }
    assertString(fact.statement, `${context}.statement`);
    assertOptionalString(fact.visibleAction, `${context}.visibleAction`);
    assertOptionalString(fact.visibleResponse, `${context}.visibleResponse`);
  });
  return indexById(values, 'facts');
}

function validateContracts(values, sourcePaths) {
  assertArray(values, 'contracts', { min: 1 });
  assertUniqueIds(values, 'contracts');
  values.forEach((contract, index) => {
    const context = `contracts[${index}]`;
    assertClosedObject(
      contract,
      [
        'id',
        'authority',
        'caseCoverage',
        'source',
        'clause',
        'statement',
      ],
      context,
    );
    assertEnum(
      contract.authority,
      CONTRACT_AUTHORITIES,
      `${context}.authority`,
    );
    assertEnum(
      contract.caseCoverage,
      CASE_COVERAGE,
      `${context}.caseCoverage`,
    );
    assertSourceLocation(contract.source, `${context}.source`);
    if (!sourcePaths.has(contract.source.path)) {
      fail(
        'EDX_BINDING_INVALID',
        `${context}.source.path is absent from sourceBlobs`,
      );
    }
    assertString(contract.clause, `${context}.clause`);
    assertString(contract.statement, `${context}.statement`);
  });
  return indexById(values, 'contracts');
}

function validateInferences(values, factById, contractById) {
  assertArray(values, 'inferences');
  assertUniqueIds(values, 'inferences');
  values.forEach((inference, index) => {
    const context = `inferences[${index}]`;
    assertClosedObject(
      inference,
      ['id', 'factIds', 'contractIds', 'statement'],
      context,
    );
    requireReferences(factById, inference.factIds, `${context}.factIds`, {
      min: 1,
    });
    requireReferences(
      contractById,
      inference.contractIds,
      `${context}.contractIds`,
      { min: 1 },
    );
    assertString(inference.statement, `${context}.statement`);
  });
  return indexById(values, 'inferences');
}

function validateGraph(value, factById, sourcePaths) {
  assertClosedObject(value, ['entryStateId', 'states', 'edges'], 'journeyStateGraph');
  assertStableId(value.entryStateId, 'journeyStateGraph.entryStateId');
  assertArray(value.states, 'journeyStateGraph.states', { min: 1 });
  assertUniqueIds(value.states, 'journeyStateGraph.states');
  value.states.forEach((state, index) => {
    const context = `journeyStateGraph.states[${index}]`;
    assertObjectShape(
      state,
      ['id', 'origin', 'inScope', 'source', 'visibleMeaning'],
      ['explicitOrder'],
      context,
    );
    assertEnum(state.origin, STATE_ORIGINS, `${context}.origin`);
    assertBoolean(state.inScope, `${context}.inScope`);
    assertSourceLocation(state.source, `${context}.source`);
    if (!sourcePaths.has(state.source.path)) {
      fail(
        'EDX_BINDING_INVALID',
        `${context}.source.path is absent from sourceBlobs`,
      );
    }
    assertString(state.visibleMeaning, `${context}.visibleMeaning`);
    if (state.origin === 'explicit') {
      assertInteger(state.explicitOrder, `${context}.explicitOrder`, { min: 0 });
    } else if (state.explicitOrder !== undefined) {
      fail(
        'EDX_GRAPH_INVALID',
        `${context}.explicitOrder is legal only for explicit states`,
      );
    }
  });
  const stateById = indexById(value.states, 'journeyStateGraph.states');
  const starting = value.states.filter((state) => state.origin === 'starting');
  if (
    starting.length !== 1
    || starting[0].id !== value.entryStateId
  ) {
    fail(
      'EDX_GRAPH_INVALID',
      'journeyStateGraph requires exactly one starting entry state',
    );
  }
  const explicitOrders = value.states
    .filter((state) => state.origin === 'explicit')
    .map((state) => state.explicitOrder);
  if (new Set(explicitOrders).size !== explicitOrders.length) {
    fail(
      'EDX_GRAPH_INVALID',
      'explicit Journey states require unique explicitOrder values',
    );
  }

  assertArray(value.edges, 'journeyStateGraph.edges');
  assertUniqueIds(value.edges, 'journeyStateGraph.edges');
  value.edges.forEach((edge, index) => {
    const context = `journeyStateGraph.edges[${index}]`;
    assertClosedObject(
      edge,
      [
        'id',
        'fromStateId',
        'toStateId',
        'actionFactId',
        'responseFactId',
        'sourceRefs',
      ],
      context,
    );
    const from = requireReference(
      stateById,
      edge.fromStateId,
      `${context}.fromStateId`,
    );
    const to = requireReference(
      stateById,
      edge.toStateId,
      `${context}.toStateId`,
    );
    const actionFact = requireReference(
      factById,
      edge.actionFactId,
      `${context}.actionFactId`,
    );
    const responseFact = requireReference(
      factById,
      edge.responseFactId,
      `${context}.responseFactId`,
    );
    if (actionFact.visibleAction === undefined || actionFact.stateId !== from.id) {
      fail(
        'EDX_GRAPH_INVALID',
        `${context}.actionFactId must expose an action in the source state`,
      );
    }
    if (
      responseFact.visibleResponse === undefined
      || responseFact.stateId !== to.id
    ) {
      fail(
        'EDX_GRAPH_INVALID',
        `${context}.responseFactId must expose a response in the target state`,
      );
    }
    assertArray(edge.sourceRefs, `${context}.sourceRefs`, { min: 1 });
    edge.sourceRefs.forEach((source, sourceIndex) => {
      assertSourceLocation(source, `${context}.sourceRefs[${sourceIndex}]`);
      if (!sourcePaths.has(source.path)) {
        fail(
          'EDX_BINDING_INVALID',
          `${context}.sourceRefs[${sourceIndex}] is absent from sourceBlobs`,
        );
      }
    });
  });
  orderJourneyStates(value);
  return stateById;
}

function validateTrustBoundaryChecks(values, contractById) {
  assertArray(values, 'trustBoundaryChecks');
  assertUniqueIds(values, 'trustBoundaryChecks');
  values.forEach((check, index) => {
    const context = `trustBoundaryChecks[${index}]`;
    assertClosedObject(
      check,
      [
        'id',
        'contractTransitionRefs',
        'beforeScope',
        'candidateTarget',
        'diagnosticEvidenceKinds',
        'requiredIdentityEvidenceKinds',
        'scopeEffectMeaning',
        'nextGateMeaning',
        'failureMeaning',
        'visibleConsequences',
        'previousScopeExposure',
      ],
      context,
    );
    const contracts = requireReferences(
      contractById,
      check.contractTransitionRefs,
      `${context}.contractTransitionRefs`,
      { min: 1 },
    );
    if (contracts.some((contract) => contract.authority === 'rubric')) {
      fail(
        'EDX_TRUST_PROJECTION_INVALID',
        `${context} must project accepted Product or Client contracts`,
      );
    }
    [
      'beforeScope',
      'candidateTarget',
      'scopeEffectMeaning',
      'nextGateMeaning',
      'failureMeaning',
      'previousScopeExposure',
    ].forEach((field) => assertString(check[field], `${context}.${field}`));
    assertUniqueStrings(
      check.diagnosticEvidenceKinds,
      `${context}.diagnosticEvidenceKinds`,
    );
    assertUniqueStrings(
      check.requiredIdentityEvidenceKinds,
      `${context}.requiredIdentityEvidenceKinds`,
      { min: 1 },
    );
    assertUniqueStrings(
      check.visibleConsequences,
      `${context}.visibleConsequences`,
      { min: 1 },
    );
  });
  return indexById(values, 'trustBoundaryChecks');
}

function validateRecoveryPaths(
  values,
  stateById,
  reachableStateIds,
  factById,
  contractById,
) {
  assertArray(values, 'recoveryPaths');
  assertUniqueIds(values, 'recoveryPaths');
  values.forEach((recovery, index) => {
    const context = `recoveryPaths[${index}]`;
    assertObjectShape(
      recovery,
      [
        'id',
        'contractIds',
        'sourceStateId',
        'reason',
        'entryActionVisible',
        'distance',
        'preservedState',
        'returnStateId',
        'returnTarget',
      ],
      ['notApplicableReason', 'namedAdjacentPointerFactId'],
      context,
    );
    const contracts = requireReferences(
      contractById,
      recovery.contractIds,
      `${context}.contractIds`,
      { min: 1 },
    );
    if (contracts.some((contract) => contract.authority === 'rubric')) {
      fail(
        'EDX_RECOVERY_INVALID',
        `${context} must project accepted Product or Client contracts`,
      );
    }
    const sourceState = requireReference(
      stateById,
      recovery.sourceStateId,
      `${context}.sourceStateId`,
    );
    const returnState = requireReference(
      stateById,
      recovery.returnStateId,
      `${context}.returnStateId`,
    );
    if (
      !reachableStateIds.has(sourceState.id)
      || !reachableStateIds.has(returnState.id)
    ) {
      fail(
        'EDX_RECOVERY_INVALID',
        `${context} source and return states must be reachable`,
      );
    }
    assertString(recovery.reason, `${context}.reason`);
    assertBoolean(recovery.entryActionVisible, `${context}.entryActionVisible`);
    if (!recovery.entryActionVisible) {
      fail('EDX_RECOVERY_INVALID', `${context} requires a visible entry action`);
    }
    assertEnum(recovery.distance, RECOVERY_DISTANCES, `${context}.distance`);
    if (recovery.distance === 'implicit') {
      fail('EDX_RECOVERY_INVALID', `${context} cannot be implicit`);
    }
    assertUniqueStrings(
      recovery.preservedState,
      `${context}.preservedState`,
      { stableIds: true },
    );
    if (!returnState.inScope) {
      fail('EDX_RECOVERY_INVALID', `${context}.returnStateId must be in scope`);
    }

    if (recovery.returnTarget === null) {
      assertString(
        recovery.notApplicableReason,
        `${context}.notApplicableReason`,
      );
    } else {
      assertClosedObject(
        recovery.returnTarget,
        ['kind', 'targetId'],
        `${context}.returnTarget`,
      );
      assertEnum(
        recovery.returnTarget.kind,
        RETURN_TARGET_KINDS,
        `${context}.returnTarget.kind`,
      );
      assertStableId(
        recovery.returnTarget.targetId,
        `${context}.returnTarget.targetId`,
      );
      if (recovery.notApplicableReason !== undefined) {
        fail(
          'EDX_RECOVERY_INVALID',
          `${context}.notApplicableReason requires a null returnTarget`,
        );
      }
    }

    if (recovery.distance === 'same-surface') {
      const visibleAction = [...factById.values()].some(
        (fact) =>
          fact.stateId === sourceState.id && fact.visibleAction !== undefined,
      );
      if (!visibleAction) {
        fail(
          'EDX_RECOVERY_INVALID',
          `${context} has no same-surface visible action`,
        );
      }
      if (recovery.namedAdjacentPointerFactId !== undefined) {
        fail(
          'EDX_RECOVERY_INVALID',
          `${context}.namedAdjacentPointerFactId is only for named-adjacent recovery`,
        );
      }
    }

    if (recovery.distance === 'named-adjacent') {
      const pointer = requireReference(
        factById,
        recovery.namedAdjacentPointerFactId,
        `${context}.namedAdjacentPointerFactId`,
      );
      if (
        pointer.stateId !== sourceState.id
        || pointer.visibleAction === undefined
      ) {
        fail(
          'EDX_RECOVERY_INVALID',
          `${context} requires a visible named-adjacent pointer`,
        );
      }
    }
  });
  return indexById(values, 'recoveryPaths');
}

function validateCandidate(candidate, context, factById, contractById, inferenceById) {
  assertClosedObject(
    candidate,
    [
      'id',
      'stateId',
      'factIds',
      'contractIds',
      'inferenceIds',
      'severity',
      'impact',
      'confidence',
      'brokenPromise',
      'causalMechanism',
      'userImpact',
      'ownerLayer',
      'correctionDirection',
    ],
    context,
  );
  assertStableId(candidate.id, `${context}.id`);
  assertStableId(candidate.stateId, `${context}.stateId`);
  requireReferences(factById, candidate.factIds, `${context}.factIds`, {
    min: 1,
  });
  requireReferences(
    contractById,
    candidate.contractIds,
    `${context}.contractIds`,
    { min: 1 },
  );
  requireReferences(
    inferenceById,
    candidate.inferenceIds,
    `${context}.inferenceIds`,
  );
  assertEnum(candidate.severity, SEVERITIES, `${context}.severity`);
  assertEnum(candidate.impact, IMPACT_CLASSES, `${context}.impact`);
  assertEnum(candidate.confidence, CONFIDENCES, `${context}.confidence`);
  [
    'brokenPromise',
    'causalMechanism',
    'userImpact',
    'ownerLayer',
    'correctionDirection',
  ].forEach((field) => assertString(candidate[field], `${context}.${field}`));
}

function validatePriorityTuple(value, context) {
  assertArray(value, context, { min: 7 });
  if (value.length !== 7) {
    fail('EDX_RANK_INVALID', `${context} must contain exactly seven values`);
  }
  [
    [0, 1],
    [0, 7],
    [0, Number.MAX_SAFE_INTEGER],
    [0, 1],
    [0, 2],
    [0, 2],
  ].forEach(([min, max], index) => {
    assertInteger(value[index], `${context}[${index}]`, { min });
    if (value[index] > max) {
      fail('EDX_RANK_INVALID', `${context}[${index}] exceeds ${max}`);
    }
  });
  assertStableId(value[6], `${context}[6]`);
}

function validateCandidateLedger(
  values,
  stateById,
  factById,
  contractById,
  inferenceById,
) {
  assertArray(values, 'candidateLedger');
  const candidateIds = new Set();
  values.forEach((entry, index) => {
    const context = `candidateLedger[${index}]`;
    assertClosedObject(
      entry,
      ['candidate', 'eligible', 'ineligibleReasons', 'priorityTuple'],
      context,
    );
    validateCandidate(
      entry.candidate,
      `${context}.candidate`,
      factById,
      contractById,
      inferenceById,
    );
    requireReference(
      stateById,
      entry.candidate.stateId,
      `${context}.candidate.stateId`,
    );
    if (candidateIds.has(entry.candidate.id)) {
      fail(
        'EDX_REFERENCE_INVALID',
        `candidateLedger contains duplicate candidate ${entry.candidate.id}`,
      );
    }
    candidateIds.add(entry.candidate.id);
    assertBoolean(entry.eligible, `${context}.eligible`);
    assertUniqueStrings(
      entry.ineligibleReasons,
      `${context}.ineligibleReasons`,
    );
    entry.ineligibleReasons.forEach((reason, reasonIndex) =>
      assertEnum(
        reason,
        INELIGIBLE_REASONS,
        `${context}.ineligibleReasons[${reasonIndex}]`,
      ));
    if (entry.priorityTuple === null) {
      if (entry.eligible) {
        fail(
          'EDX_RANK_INVALID',
          `${context}.priorityTuple is required for an eligible candidate`,
        );
      }
    } else {
      validatePriorityTuple(entry.priorityTuple, `${context}.priorityTuple`);
    }
  });
}

function validateFinding(value, context, { secondary = false } = {}) {
  const keys = [
    'candidateId',
    'factIds',
    'contractIds',
    'inferenceIds',
    'severity',
    'earliestStateId',
    'brokenPromise',
    'causalMechanism',
    'userImpact',
    'ownerLayer',
    'correctionDirection',
    'confidence',
    'priorityBasis',
    ...(secondary ? ['deprioritizedBecause'] : []),
  ];
  assertClosedObject(value, keys, context);
  assertStableId(value.candidateId, `${context}.candidateId`);
  assertUniqueStrings(value.factIds, `${context}.factIds`, {
    min: 1,
    stableIds: true,
  });
  assertUniqueStrings(value.contractIds, `${context}.contractIds`, {
    min: 1,
    stableIds: true,
  });
  assertUniqueStrings(value.inferenceIds, `${context}.inferenceIds`, {
    stableIds: true,
  });
  assertEnum(value.severity, SEVERITIES, `${context}.severity`);
  assertStableId(value.earliestStateId, `${context}.earliestStateId`);
  [
    'brokenPromise',
    'causalMechanism',
    'userImpact',
    'ownerLayer',
    'correctionDirection',
  ].forEach((field) => assertString(value[field], `${context}.${field}`));
  assertEnum(value.confidence, CONFIDENCES, `${context}.confidence`);
  validatePriorityTuple(value.priorityBasis, `${context}.priorityBasis`);
  if (secondary) {
    assertString(
      value.deprioritizedBecause,
      `${context}.deprioritizedBecause`,
    );
  }
}

function validateExitAndRetryPaths(
  values,
  stateById,
  factById,
  recoveryById,
) {
  assertArray(values, 'exitAndRetryPaths');
  assertUniqueIds(values, 'exitAndRetryPaths');
  values.forEach((entry, index) => {
    const context = `exitAndRetryPaths[${index}]`;
    assertObjectShape(
      entry,
      ['id', 'sourceStateId', 'actionFactId', 'destinationStateId'],
      ['recoveryPathId'],
      context,
    );
    requireReference(stateById, entry.sourceStateId, `${context}.sourceStateId`);
    requireReference(
      stateById,
      entry.destinationStateId,
      `${context}.destinationStateId`,
    );
    const actionFact = requireReference(
      factById,
      entry.actionFactId,
      `${context}.actionFactId`,
    );
    if (
      actionFact.stateId !== entry.sourceStateId
      || actionFact.visibleAction === undefined
    ) {
      fail(
        'EDX_REFERENCE_INVALID',
        `${context}.actionFactId must expose an action in sourceStateId`,
      );
    }
    if (entry.recoveryPathId !== undefined) {
      requireReference(
        recoveryById,
        entry.recoveryPathId,
        `${context}.recoveryPathId`,
      );
    }
  });
}

function validateUnproven(values, contractById) {
  assertArray(values, 'unproven');
  assertUniqueIds(values, 'unproven');
  values.forEach((entry, index) => {
    const context = `unproven[${index}]`;
    assertClosedObject(
      entry,
      [
        'id',
        'contractIds',
        'requirement',
        'reason',
        'requiredEvidenceLevel',
        'requiredFor',
      ],
      context,
    );
    requireReferences(contractById, entry.contractIds, `${context}.contractIds`, {
      min: 1,
    });
    assertString(entry.requirement, `${context}.requirement`);
    assertString(entry.reason, `${context}.reason`);
    assertEnum(
      entry.requiredEvidenceLevel,
      EVIDENCE_LEVELS,
      `${context}.requiredEvidenceLevel`,
    );
    assertUniqueStrings(entry.requiredFor, `${context}.requiredFor`, { min: 1 });
    entry.requiredFor.forEach((stage, stageIndex) =>
      assertEnum(stage, ADMISSION_STAGES, `${context}.requiredFor[${stageIndex}]`));
  });
}

function withoutSecondaryReason(value) {
  const { deprioritizedBecause: _reason, ...finding } = value;
  return finding;
}

export function validateReviewResult(value) {
  assertClosedObject(
    value,
    [
      'kind',
      'schemaVersion',
      'authorId',
      'verdict',
      'evaluationBinding',
      'contracts',
      'facts',
      'inferences',
      'journeyStateGraph',
      'trustBoundaryChecks',
      'recoveryPaths',
      'candidateLedger',
      'primaryFinding',
      'secondaryFindings',
      'minorObservations',
      'statesChecked',
      'exitAndRetryPaths',
      'unproven',
    ],
    'ReviewResult',
  );
  if (
    value.kind !== REVIEW_RESULT_KIND
    || value.schemaVersion !== REVIEW_RESULT_SCHEMA_VERSION
  ) {
    fail('EDX_RESULT_INVALID', 'ReviewResult identity is invalid');
  }
  assertStableId(value.authorId, 'ReviewResult.authorId');
  assertEnum(value.verdict, VERDICTS, 'ReviewResult.verdict');

  const sourcePaths = validateBinding(value.evaluationBinding);
  const factById = validateFacts(value.facts, sourcePaths);
  const contractById = validateContracts(value.contracts, sourcePaths);
  const inferenceById = validateInferences(
    value.inferences,
    factById,
    contractById,
  );
  const stateById = validateGraph(
    value.journeyStateGraph,
    factById,
    sourcePaths,
  );
  value.facts.forEach((fact, index) =>
    requireReference(stateById, fact.stateId, `facts[${index}].stateId`));
  const reachableStateIds = new Set(
    orderJourneyStates(value.journeyStateGraph).map((state) => state.stateId),
  );
  validateTrustBoundaryChecks(value.trustBoundaryChecks, contractById);
  const recoveryById = validateRecoveryPaths(
    value.recoveryPaths,
    stateById,
    reachableStateIds,
    factById,
    contractById,
  );
  validateCandidateLedger(
    value.candidateLedger,
    stateById,
    factById,
    contractById,
    inferenceById,
  );

  const recomputedLedger = recomputeCandidateLedger({
    graph: value.journeyStateGraph,
    facts: value.facts,
    contracts: value.contracts,
    inferences: value.inferences,
    candidates: value.candidateLedger.map((entry) => entry.candidate),
  });
  assertDeepEqual(
    value.candidateLedger,
    recomputedLedger,
    'EDX_RANK_INVALID',
    'candidateLedger does not match recomputed eligibility and ranking',
  );

  const ranked = rankEligibleCandidates(recomputedLedger);
  const material = ranked.filter(
    (entry) => entry.candidate.severity !== 'minor',
  );
  const minor = ranked.filter((entry) => entry.candidate.severity === 'minor');
  const expectedPrimary = material.length > 0
    ? findingFromLedgerEntry(material[0])
    : null;
  const expectedSecondary = material
    .slice(1)
    .map((entry) => findingFromLedgerEntry(entry));
  const expectedMinor = minor.map((entry) => findingFromLedgerEntry(entry));

  if (value.primaryFinding !== null) {
    validateFinding(value.primaryFinding, 'primaryFinding');
  }
  assertArray(value.secondaryFindings, 'secondaryFindings');
  value.secondaryFindings.forEach((finding, index) =>
    validateFinding(finding, `secondaryFindings[${index}]`, {
      secondary: true,
    }));
  assertArray(value.minorObservations, 'minorObservations');
  value.minorObservations.forEach((finding, index) =>
    validateFinding(finding, `minorObservations[${index}]`));

  assertDeepEqual(
    value.primaryFinding,
    expectedPrimary,
    'EDX_RESULT_INVALID',
    'primaryFinding does not match the first material priority tuple',
  );
  assertDeepEqual(
    value.secondaryFindings.map(withoutSecondaryReason),
    expectedSecondary,
    'EDX_RESULT_INVALID',
    'secondaryFindings do not match remaining material candidates',
  );
  assertDeepEqual(
    value.minorObservations,
    expectedMinor,
    'EDX_RESULT_INVALID',
    'minorObservations do not match eligible minor candidates',
  );

  const expectedVerdict = expectedPrimary === null
    ? 'NO_BLOCKING_FINDING'
    : 'FINDINGS';
  if (value.verdict !== expectedVerdict) {
    fail(
      'EDX_RESULT_INVALID',
      `verdict must be ${expectedVerdict} for the recomputed candidate set`,
    );
  }

  assertUniqueStrings(value.statesChecked, 'statesChecked', {
    min: 1,
    stableIds: true,
  });
  value.statesChecked.forEach((stateId) =>
    requireReference(stateById, stateId, 'statesChecked'));
  const expectedCheckedStates = orderJourneyStates(value.journeyStateGraph)
    .map((state) => state.stateId)
    .sort();
  assertDeepEqual(
    [...value.statesChecked].sort(),
    expectedCheckedStates,
    'EDX_RESULT_INVALID',
    'statesChecked must cover every reachable state exactly once',
  );
  validateExitAndRetryPaths(
    value.exitAndRetryPaths,
    stateById,
    factById,
    recoveryById,
  );
  validateUnproven(value.unproven, contractById);

  return {
    ok: true,
    verdict: value.verdict,
    resultDigest: digestReviewResult(value),
    reachableStateCount: expectedCheckedStates.length,
    eligibleCandidateCount: ranked.length,
    primaryCandidateId: value.primaryFinding?.candidateId ?? null,
    unprovenCount: value.unproven.length,
  };
}

export function validateIndependentReviewDecision(result, decision) {
  const summary = validateReviewResult(result);
  assertClosedObject(
    decision,
    [
      'resultDigest',
      'reviewerId',
      'decision',
      'findingCandidateIds',
      'reviewNotes',
    ],
    'IndependentReviewDecision',
  );
  assertSha256Digest(decision.resultDigest, 'IndependentReviewDecision.resultDigest');
  if (decision.resultDigest !== summary.resultDigest) {
    fail(
      'EDX_BINDING_INVALID',
      'IndependentReviewDecision.resultDigest is stale',
    );
  }
  assertStableId(decision.reviewerId, 'IndependentReviewDecision.reviewerId');
  if (decision.reviewerId === result.authorId) {
    fail(
      'EDX_RESULT_INVALID',
      'independent reviewer must differ from ReviewResult author',
    );
  }
  assertEnum(
    decision.decision,
    ['accepted', 'changes-required', 'unproven'],
    'IndependentReviewDecision.decision',
  );
  assertUniqueStrings(
    decision.findingCandidateIds,
    'IndependentReviewDecision.findingCandidateIds',
    { stableIds: true },
  );
  assertArray(decision.reviewNotes, 'IndependentReviewDecision.reviewNotes');
  decision.reviewNotes.forEach((note, index) =>
    assertString(note, `IndependentReviewDecision.reviewNotes[${index}]`));

  const expectedCandidateIds = [
    ...(result.primaryFinding === null
      ? []
      : [result.primaryFinding.candidateId]),
    ...result.secondaryFindings.map((finding) => finding.candidateId),
    ...result.minorObservations.map((finding) => finding.candidateId),
  ].sort();
  assertDeepEqual(
    [...decision.findingCandidateIds].sort(),
    expectedCandidateIds,
    'EDX_REFERENCE_INVALID',
    'IndependentReviewDecision must bind every frozen Finding',
  );

  const admissionUnproven = result.unproven.some((entry) =>
    entry.requiredFor.some((stage) =>
      ['review', 'high-fidelity'].includes(stage)));
  if (
    result.verdict === 'FINDINGS'
    && decision.decision !== 'changes-required'
  ) {
    fail(
      'EDX_RESULT_INVALID',
      'FINDINGS requires an independent changes-required decision',
    );
  }
  if (
    decision.decision === 'accepted'
    && (result.verdict !== 'NO_BLOCKING_FINDING' || admissionUnproven)
  ) {
    fail(
      'EDX_RESULT_INVALID',
      'accepted review requires no blocking Finding or admission unproven point',
    );
  }
  return { ok: true, decision: decision.decision };
}

export function evaluatePrototypeAdmission(result, decision) {
  validateIndependentReviewDecision(result, decision);
  const blockedByUnproven = result.unproven.some((entry) =>
    entry.requiredFor.some((stage) =>
      ['review', 'high-fidelity'].includes(stage)));
  return {
    admitted:
      result.verdict === 'NO_BLOCKING_FINDING'
      && decision.decision === 'accepted'
      && !blockedByUnproven,
    resultDigest: digestReviewResult(result),
  };
}

export function parseReviewResult(text, label = 'ReviewResult') {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ExperienceReviewError(
      'EDX_RESULT_INVALID',
      `${label} is invalid JSON: ${error.message}`,
    );
  }
}
