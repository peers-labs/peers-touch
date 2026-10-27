import {
  canonicalDigest,
} from './canonical.mjs';
import {
  ORACLE_CRITICALITIES,
  assertComparativeDigest,
  comparativeFail,
} from './comparative-schema.mjs';

export const COMPARISON_EVALUATION_KIND =
  'peers-touch-comparison-evaluation';
export const COMPARISON_EVALUATION_SCHEMA_VERSION = 1;

const CRITICALITY_RANK = new Map(
  ORACLE_CRITICALITIES.map((value, index) => [value, index]),
);

function indexBy(values, field) {
  return new Map(values.map((value) => [value[field], value]));
}

function orderedLegs(loaded) {
  return Object.fromEntries(
    loaded.legs.map((leg) => [leg.descriptor.blindedAlias, leg]),
  );
}

export function deriveObservedPathCost(observation) {
  const stateById = indexBy(observation.states, 'id');
  const edgeById = indexBy(observation.edges, 'id');
  const actionByEdgeId = indexBy(observation.observedActions, 'edgeId');
  const pathEdges = observation.primaryPathEdgeIds.map((id) => edgeById.get(id));
  let commitments = 0;
  let contextSwitches = 0;
  let decisionLoad = 0;
  let interruptions = 0;
  for (const edge of pathEdges) {
    const action = actionByEdgeId.get(edge.id);
    if (
      ['external-reversible', 'external-irreversible'].includes(
        action.mutation,
      )
    ) commitments += 1;
    if (
      stateById.get(edge.fromStateId).contextId
      !== stateById.get(edge.toStateId).contextId
    ) contextSwitches += 1;
    decisionLoad += action.decisionCost;
    if (action.interruption !== 'none') interruptions += 1;
  }
  const recoveryDebt = observation.recoveryObservations.filter(
    (recovery) =>
      !recovery.entryActionVisible || recovery.returnStateId === undefined,
  ).length;
  return {
    commitments,
    contextSwitches,
    decisionLoad,
    interruptions,
    recoveryDebt,
  };
}

function primaryPathProjection(observation) {
  const stateById = indexBy(observation.states, 'id');
  const edgeById = indexBy(observation.edges, 'id');
  const actionByEdgeId = indexBy(observation.observedActions, 'edgeId');
  const entry = observation.states.find((state) => state.ordinal === 0);
  const projection = [{
    stateId: entry.id,
    kind: entry.kind,
    contextId: entry.contextId,
    action: null,
  }];
  for (const edgeId of observation.primaryPathEdgeIds) {
    const edge = edgeById.get(edgeId);
    const state = stateById.get(edge.toStateId);
    const action = actionByEdgeId.get(edgeId);
    projection.push({
      stateId: state.id,
      kind: state.kind,
      contextId: state.contextId,
      action: {
        mutation: action.mutation,
        decisionCost: action.decisionCost,
        interruption: action.interruption,
      },
    });
  }
  return projection;
}

function sameAction(left, right) {
  if (left === null || right === null) return left === right;
  return (
    left.mutation === right.mutation
    && left.decisionCost === right.decisionCost
    && left.interruption === right.interruption
  );
}

export function earliestDivergence(leftObservation, rightObservation) {
  const left = primaryPathProjection(leftObservation);
  const right = primaryPathProjection(rightObservation);
  const count = Math.max(left.length, right.length);
  for (let index = 0; index < count; index += 1) {
    const a = left[index];
    const b = right[index];
    if (
      a === undefined
      || b === undefined
      || a.kind !== b.kind
      || a.contextId !== b.contextId
      || !sameAction(a.action, b.action)
    ) {
      return {
        ordinal: index,
        AStateId: a?.stateId ?? left.at(-1).stateId,
        BStateId: b?.stateId ?? right.at(-1).stateId,
      };
    }
  }
  return null;
}

function assertionResults(leg) {
  return indexBy(leg.evaluation.results, 'assertionId');
}

function earliestFactState(leg, factIds) {
  const factById = indexBy(leg.observation.facts, 'id');
  const stateById = indexBy(leg.observation.states, 'id');
  return factIds
    .map((id) => stateById.get(factById.get(id).stateId))
    .sort((left, right) => left.ordinal - right.ordinal)[0]?.id
    ?? leg.observation.states.find((state) => state.ordinal === 0).id;
}

function stateOrdinal(leg, stateId) {
  return leg.observation.states.find((state) => state.id === stateId).ordinal;
}

function criticality(assertion) {
  return CRITICALITY_RANK.get(assertion.criticality);
}

export function evaluatePairedExperienceCase(
  loaded,
  { evaluatorVersionDigest },
) {
  assertComparativeDigest(
    evaluatorVersionDigest,
    'comparison evaluator version',
    'EDX_COMPARE_PAIR_STALE',
  );
  const legs = orderedLegs(loaded);
  const results = {
    A: assertionResults(legs.A),
    B: assertionResults(legs.B),
  };
  const assertionDifferentials = loaded.oracle.assertions
    .map((assertion) => {
      const A = results.A.get(assertion.id);
      const B = results.B.get(assertion.id);
      const classification =
        A.result === 'unproven' || B.result === 'unproven'
          ? 'unproven'
          : A.result === B.result
            ? 'equivalent'
            : 'result-difference';
      const AStateId = earliestFactState(legs.A, A.factIds);
      const BStateId = earliestFactState(legs.B, B.factIds);
      return {
        id: `differential.${assertion.id}`,
        oracleAssertionId: assertion.id,
        criticality: assertion.criticality,
        AResult: A.result,
        BResult: B.result,
        classification,
        observableStateKinds: [...assertion.observableStateKinds].sort(),
        AFactIds: [...A.factIds].sort(),
        BFactIds: [...B.factIds].sort(),
        AEvidenceIds: [...A.evidenceIds].sort(),
        BEvidenceIds: [...B.evidenceIds].sort(),
        earliestDivergentStateRefs: {
          A: AStateId,
          B: BStateId,
        },
        earliestDivergentOrdinal: Math.min(
          stateOrdinal(legs.A, AStateId),
          stateOrdinal(legs.B, BStateId),
        ),
        priorityTuple: [criticality(assertion), assertion.id],
      };
    })
    .sort((left, right) => {
      if (left.priorityTuple[0] !== right.priorityTuple[0]) {
        return left.priorityTuple[0] - right.priorityTuple[0];
      }
      return left.priorityTuple[1].localeCompare(right.priorityTuple[1]);
    });
  const unprovenAssertionIds = assertionDifferentials
    .filter((entry) => entry.classification === 'unproven')
    .map((entry) => entry.oracleAssertionId);
  const materialDifferentialIds = assertionDifferentials
    .filter((entry) => entry.classification === 'result-difference')
    .map((entry) => entry.id);
  const disposition = unprovenAssertionIds.length > 0
    ? 'unproven'
    : materialDifferentialIds.length > 0
      ? 'material-differences'
      : 'no-material-difference';
  return {
    kind: COMPARISON_EVALUATION_KIND,
    schemaVersion: COMPARISON_EVALUATION_SCHEMA_VERSION,
    caseId: loaded.pair.id,
    caseDigest: loaded.digests.pair,
    oracleDigest: loaded.digests.oracle,
    contextDigest: loaded.digests.context,
    evaluatorVersionDigest,
    authorIds: [...loaded.authorIds],
    legBindings: {
      A: { ...legs.A.digests },
      B: { ...legs.B.digests },
    },
    pathCosts: {
      A: deriveObservedPathCost(legs.A.observation),
      B: deriveObservedPathCost(legs.B.observation),
    },
    earliestDivergence: earliestDivergence(
      legs.A.observation,
      legs.B.observation,
    ),
    assertionDifferentials,
    materialDifferentialIds,
    unprovenAssertionIds,
    disposition,
  };
}

export function digestComparisonEvaluation(value) {
  return canonicalDigest(value);
}

export function assertCurrentComparisonEvaluation(
  loaded,
  supplied,
  options,
) {
  const expected = evaluatePairedExperienceCase(loaded, options);
  const expectedDigest = digestComparisonEvaluation(expected);
  const actualDigest = digestComparisonEvaluation(supplied);
  if (actualDigest !== expectedDigest) {
    comparativeFail(
      'EDX_COMPARE_PAIR_STALE',
      'comparison evaluation is not current for the paired case',
      { expected: expectedDigest, actual: actualDigest },
    );
  }
  return expected;
}
