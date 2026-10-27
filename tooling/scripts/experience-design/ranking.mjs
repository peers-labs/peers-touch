import {
  CONFIDENCES,
  ExperienceReviewError,
  IMPACT_CLASSES,
  SEVERITIES,
  fail,
} from './review-result-schema.mjs';

const IMPACT_RANK = new Map(
  IMPACT_CLASSES.map((value, index) => [value, index]),
);
const SEVERITY_RANK = new Map(
  SEVERITIES.map((value, index) => [value, index]),
);
const CONFIDENCE_RANK = new Map(
  CONFIDENCES.map((value, index) => [value, index]),
);

function compareAscii(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareStateOrder(left, right) {
  if (left.distance !== right.distance) {
    return left.distance - right.distance;
  }
  const leftExplicit = Number.isSafeInteger(left.state.explicitOrder);
  const rightExplicit = Number.isSafeInteger(right.state.explicitOrder);
  if (leftExplicit !== rightExplicit) return leftExplicit ? -1 : 1;
  if (leftExplicit && left.state.explicitOrder !== right.state.explicitOrder) {
    return left.state.explicitOrder - right.state.explicitOrder;
  }
  const pathOrder = compareAscii(left.state.source.path, right.state.source.path);
  if (pathOrder !== 0) return pathOrder;
  if (left.state.source.lineStart !== right.state.source.lineStart) {
    return left.state.source.lineStart - right.state.source.lineStart;
  }
  return compareAscii(left.state.id, right.state.id);
}

export function orderJourneyStates(graph) {
  const stateById = new Map(graph.states.map((state) => [state.id, state]));
  if (!stateById.has(graph.entryStateId)) {
    fail(
      'EDX_GRAPH_INVALID',
      `entry state ${graph.entryStateId} does not exist`,
    );
  }

  const adjacency = new Map(graph.states.map((state) => [state.id, []]));
  for (const edge of graph.edges) {
    if (!stateById.has(edge.fromStateId) || !stateById.has(edge.toStateId)) {
      fail(
        'EDX_GRAPH_INVALID',
        `edge ${edge.id} references an unknown state`,
      );
    }
    adjacency.get(edge.fromStateId).push(edge.toStateId);
  }

  const distances = new Map([[graph.entryStateId, 0]]);
  const queue = [graph.entryStateId];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    const nextDistance = distances.get(current) + 1;
    for (const target of adjacency.get(current)) {
      if (distances.has(target)) continue;
      distances.set(target, nextDistance);
      queue.push(target);
    }
  }

  return [...distances]
    .map(([stateId, distance]) => ({
      state: stateById.get(stateId),
      stateId,
      distance,
    }))
    .sort(compareStateOrder)
    .map((entry, ordinal) => ({
      stateId: entry.stateId,
      distance: entry.distance,
      ordinal,
    }));
}

function invalidReference(values, ids) {
  return ids.some((id) => !values.has(id));
}

function acceptedContractStrength(contracts) {
  if (
    contracts.some((contract) =>
      ['accepted-product', 'accepted-client'].includes(contract.authority))
  ) {
    return 0;
  }
  if (contracts.some((contract) => contract.authority === 'rubric')) {
    return 1;
  }
  return null;
}

export function comparePriorityTuples(left, right) {
  for (let index = 0; index < left.length - 1; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return compareAscii(left.at(-1), right.at(-1));
}

export function recomputeCandidateLedger({
  graph,
  facts,
  contracts,
  inferences,
  candidates,
}) {
  const orderedStates = orderJourneyStates(graph);
  const stateOrdinal = new Map(
    orderedStates.map((state) => [state.stateId, state.ordinal]),
  );
  const stateById = new Map(graph.states.map((state) => [state.id, state]));
  const factById = new Map(facts.map((fact) => [fact.id, fact]));
  const contractById = new Map(
    contracts.map((contract) => [contract.id, contract]),
  );
  const inferenceById = new Map(
    inferences.map((inference) => [inference.id, inference]),
  );

  return candidates.map((candidate) => {
    const reasons = [];
    const state = stateById.get(candidate.stateId);
    if (
      state === undefined
      || invalidReference(factById, candidate.factIds)
      || invalidReference(contractById, candidate.contractIds)
      || invalidReference(inferenceById, candidate.inferenceIds)
    ) {
      reasons.push('reference-invalid');
    }

    if (state !== undefined && !state.inScope) reasons.push('out-of-scope');
    if (state !== undefined && !stateOrdinal.has(state.id)) {
      reasons.push('unreachable');
    }

    const candidateFacts = candidate.factIds
      .map((id) => factById.get(id))
      .filter(Boolean);
    if (!candidateFacts.some((fact) => fact.visibleAction !== undefined)) {
      reasons.push('visible-action-missing');
    }
    if (!candidateFacts.some((fact) => fact.visibleResponse !== undefined)) {
      reasons.push('visible-response-missing');
    }

    const candidateContracts = candidate.contractIds
      .map((id) => contractById.get(id))
      .filter(Boolean);
    const contractStrength = acceptedContractStrength(candidateContracts);
    if (contractStrength === null) reasons.push('accepted-support-missing');

    const eligible = reasons.length === 0;
    const priorityTuple = eligible
      ? [
          contractStrength,
          IMPACT_RANK.get(candidate.impact),
          stateOrdinal.get(candidate.stateId),
          candidateContracts.some(
            (contract) => contract.caseCoverage === 'explicit',
          )
            ? 0
            : 1,
          SEVERITY_RANK.get(candidate.severity),
          CONFIDENCE_RANK.get(candidate.confidence),
          candidate.id,
        ]
      : null;

    return {
      candidate,
      eligible,
      ineligibleReasons: reasons,
      priorityTuple,
    };
  });
}

export function rankEligibleCandidates(candidateLedger) {
  return candidateLedger
    .filter((entry) => entry.eligible)
    .sort((left, right) =>
      comparePriorityTuples(left.priorityTuple, right.priorityTuple));
}

export function findingFromLedgerEntry(entry) {
  if (!entry.eligible || entry.priorityTuple === null) {
    throw new ExperienceReviewError(
      'EDX_RANK_INVALID',
      `candidate ${entry.candidate.id} is not eligible for a Finding`,
    );
  }
  const candidate = entry.candidate;
  return {
    candidateId: candidate.id,
    factIds: [...candidate.factIds],
    contractIds: [...candidate.contractIds],
    inferenceIds: [...candidate.inferenceIds],
    severity: candidate.severity,
    earliestStateId: candidate.stateId,
    brokenPromise: candidate.brokenPromise,
    causalMechanism: candidate.causalMechanism,
    userImpact: candidate.userImpact,
    ownerLayer: candidate.ownerLayer,
    correctionDirection: candidate.correctionDirection,
    confidence: candidate.confidence,
    priorityBasis: [...entry.priorityTuple],
  };
}
