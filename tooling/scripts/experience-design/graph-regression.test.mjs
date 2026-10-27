import assert from 'node:assert/strict';
import test from 'node:test';

import { completeReviewFixture } from './fixtures/positive/complete-review.mjs';
import {
  findingFromLedgerEntry,
  orderJourneyStates,
  rankEligibleCandidates,
  recomputeCandidateLedger,
} from './ranking.mjs';
import { ExperienceReviewError } from './review-result-schema.mjs';
import { validateReviewResult } from './validator.mjs';

function permutations(values) {
  if (values.length === 0) return [[]];
  return values.flatMap((value, index) =>
    permutations(values.filter((_value, otherIndex) => otherIndex !== index))
      .map((remaining) => [value, ...remaining]));
}

function journeyState(id, origin, line, explicitOrder, path = 'source.md') {
  return {
    id,
    origin,
    inScope: true,
    ...(explicitOrder === undefined ? {} : { explicitOrder }),
    source: { path, lineStart: line, lineEnd: line },
    visibleMeaning: id,
  };
}

function appendEdge(result, id, actionFactId, responseFactId) {
  const action = result.facts.find((fact) => fact.id === actionFactId);
  const response = result.facts.find((fact) => fact.id === responseFactId);
  result.journeyStateGraph.edges.push({
    id,
    fromStateId: action.stateId,
    toStateId: response.stateId,
    actionFactId,
    responseFactId,
    sourceRefs: [action.source, response.source],
  });
}

function appendDerivedState(result, id, line) {
  const state = journeyState(
    id,
    'derived',
    line,
    undefined,
    result.evaluationBinding.sourceBlobs[1].path,
  );
  const fact = {
    id: `fact.${id}`,
    stateId: state.id,
    source: state.source,
    statement: `The ${id} state exposes a visible continuation.`,
    visibleAction: `Continue from ${id}`,
    visibleResponse: `Entered ${id}`,
  };
  result.journeyStateGraph.states.push(state);
  result.facts.push(fact);
  return fact.id;
}

// Graph edits must not leave stale frozen ranking or coverage projections.
function refreshReviewProjection(result) {
  result.candidateLedger = recomputeCandidateLedger({
    graph: result.journeyStateGraph,
    facts: result.facts,
    contracts: result.contracts,
    inferences: result.inferences,
    candidates: result.candidateLedger.map((entry) => entry.candidate),
  });
  const ranked = rankEligibleCandidates(result.candidateLedger);
  const material = ranked.filter((entry) => entry.candidate.severity !== 'minor');
  result.primaryFinding = material.length > 0
    ? findingFromLedgerEntry(material[0])
    : null;
  result.secondaryFindings = material.slice(1).map((entry) => ({
    ...findingFromLedgerEntry(entry),
    deprioritizedBecause: 'An earlier material priority tuple is primary.',
  }));
  result.minorObservations = ranked
    .filter((entry) => entry.candidate.severity === 'minor')
    .map(findingFromLedgerEntry);
  result.verdict = result.primaryFinding === null
    ? 'NO_BLOCKING_FINDING'
    : 'FINDINGS';
  result.statesChecked = orderJourneyStates(result.journeyStateGraph)
    .map((state) => state.stateId);
}

function mixedOrderFixture() {
  const result = completeReviewFixture();
  const candidate = result.candidateLedger[0].candidate;
  const path = result.evaluationBinding.sourceBlobs[0].path;
  const branches = [
    { id: 'a', origin: 'explicit', line: 30, explicitOrder: 0 },
    { id: 'b', origin: 'derived', line: 20 },
    { id: 'c', origin: 'explicit', line: 10, explicitOrder: 1 },
  ];
  result.journeyStateGraph = {
    entryStateId: 'state.entry',
    states: [journeyState('state.entry', 'starting', 1, undefined, path)],
    edges: [],
  };
  result.facts = [result.facts[0]];
  result.inferences = [];
  result.recoveryPaths = [];
  result.exitAndRetryPaths = [];
  result.candidateLedger = branches.map((branch) => {
    const state = journeyState(
      `state.${branch.id}`,
      branch.origin,
      branch.line,
      branch.explicitOrder,
      path,
    );
    const fact = {
      id: `fact.${branch.id}`,
      stateId: state.id,
      source: state.source,
      statement: `Branch ${branch.id} exposes a material blocker.`,
      visibleResponse: `Branch ${branch.id} is blocked`,
    };
    result.journeyStateGraph.states.push(state);
    result.facts.push(fact);
    appendEdge(result, `edge.${branch.id}`, 'fact.submit', fact.id);
    return {
      candidate: {
        ...candidate,
        id: `candidate.${branch.id}`,
        stateId: state.id,
        factIds: ['fact.submit', fact.id],
        inferenceIds: [],
      },
    };
  });
  result.candidateLedger.push({
    candidate: {
      ...candidate,
      id: 'candidate.minor',
      stateId: 'state.entry',
      factIds: ['fact.submit', 'fact.a'],
      inferenceIds: [],
      severity: 'minor',
    },
  });
  return result;
}

function namedAdjacentRouteFixture() {
  const result = completeReviewFixture();
  const contextFactId = appendDerivedState(result, 'state.context', 5);
  const resumeFactId = appendDerivedState(result, 'state.resume', 6);
  result.journeyStateGraph.edges = result.journeyStateGraph.edges
    .filter((edge) => edge.id !== 'edge.recover');
  appendEdge(result, 'edge.choose-context', 'fact.recover', contextFactId);
  appendEdge(result, 'edge.resume-task', contextFactId, resumeFactId);
  appendEdge(result, 'edge.return-task', resumeFactId, 'fact.recovered');
  result.recoveryPaths[0] = {
    ...result.recoveryPaths[0],
    distance: 'named-adjacent',
    namedAdjacentPointerFactId: 'fact.recover',
    returnTarget: { kind: 'navigation', targetId: 'search.surface' },
  };
  result.exitAndRetryPaths[0].destinationStateId = 'state.context';
  refreshReviewProjection(result);
  return result;
}

function setPathKind(result, kind) {
  result.exitAndRetryPaths[0].kind = kind;
  if (kind === 'exit') {
    delete result.exitAndRetryPaths[0].recoveryPathId;
    result.recoveryPaths = [];
  }
}

function assertRecoveryRejected(result) {
  assert.throws(
    () => validateReviewResult(result),
    (error) =>
      error instanceof ExperienceReviewError
      && error.code === 'EDX_RECOVERY_INVALID',
  );
}

test('orders mixed explicit and derived states identically for every array permutation', () => {
  const { journeyStateGraph: graph } = mixedOrderFixture();
  const expected = [
    { stateId: 'state.entry', distance: 0, ordinal: 0 },
    { stateId: 'state.a', distance: 1, ordinal: 1 },
    { stateId: 'state.c', distance: 1, ordinal: 2 },
    { stateId: 'state.b', distance: 1, ordinal: 3 },
  ];
  const statePermutations = permutations(graph.states);
  const edgePermutations = permutations(graph.edges);
  assert.equal(statePermutations.length * edgePermutations.length, 144);

  for (const states of statePermutations) {
    for (const edges of edgePermutations) {
      assert.deepEqual(
        orderJourneyStates({ ...graph, states, edges }),
        expected,
        `states=${states.map((state) => state.id)} edges=${edges.map((edge) => edge.id)}`,
      );
    }
  }
});

test('orders by distance before origin and resolves remaining ties by source path, line, and ID', () => {
  const graph = {
    entryStateId: 'state.entry',
    states: [
      journeyState('state.entry', 'starting', 100),
      journeyState('state.path-late', 'derived', 1, undefined, 'z.md'),
      journeyState('state.line-late', 'derived', 2, undefined, 'a.md'),
      journeyState('state.B', 'derived', 1, undefined, 'a.md'),
      journeyState('state.A', 'derived', 1, undefined, 'a.md'),
      journeyState('state.explicit-far', 'explicit', 1, 0, 'a.md'),
      journeyState('state.unreachable', 'explicit', 1, 1, 'a.md'),
    ],
    edges: [
      { id: 'edge.path', fromStateId: 'state.entry', toStateId: 'state.path-late' },
      { id: 'edge.line', fromStateId: 'state.entry', toStateId: 'state.line-late' },
      { id: 'edge.B', fromStateId: 'state.entry', toStateId: 'state.B' },
      { id: 'edge.A', fromStateId: 'state.entry', toStateId: 'state.A' },
      { id: 'edge.far', fromStateId: 'state.A', toStateId: 'state.explicit-far' },
      { id: 'edge.cycle', fromStateId: 'state.explicit-far', toStateId: 'state.A' },
      { id: 'edge.loop', fromStateId: 'state.A', toStateId: 'state.A' },
    ],
  };

  assert.deepEqual(orderJourneyStates(graph), [
    { stateId: 'state.entry', distance: 0, ordinal: 0 },
    { stateId: 'state.A', distance: 1, ordinal: 1 },
    { stateId: 'state.B', distance: 1, ordinal: 2 },
    { stateId: 'state.line-late', distance: 1, ordinal: 3 },
    { stateId: 'state.path-late', distance: 1, ordinal: 4 },
    { stateId: 'state.explicit-far', distance: 2, ordinal: 5 },
  ]);
});

test('recomputes the same earliest material primary for every state and edge permutation', () => {
  const fixture = mixedOrderFixture();
  const graph = fixture.journeyStateGraph;

  for (const states of permutations(graph.states)) {
    for (const edges of permutations(graph.edges)) {
      const result = structuredClone(fixture);
      result.journeyStateGraph = structuredClone({ ...graph, states, edges });
      refreshReviewProjection(result);

      assert.deepEqual(
        result.candidateLedger.map((entry) => [
          entry.candidate.id,
          entry.eligible,
          entry.priorityTuple[2],
        ]),
        [
          ['candidate.a', true, 1],
          ['candidate.b', true, 3],
          ['candidate.c', true, 2],
          ['candidate.minor', true, 0],
        ],
      );
      assert.equal(result.primaryFinding.candidateId, 'candidate.a');
      assert.equal(result.primaryFinding.earliestStateId, 'state.a');
      assert.equal(result.primaryFinding.priorityBasis[2], 1);
      assert.deepEqual(
        result.secondaryFindings.map((finding) => finding.candidateId),
        ['candidate.c', 'candidate.b'],
      );
      assert.deepEqual(
        result.minorObservations.map((finding) => finding.candidateId),
        ['candidate.minor'],
      );
      assert.equal(validateReviewResult(result).primaryCandidateId, 'candidate.a');
    }
  }
});

for (const kind of ['exit', 'retry', 'recovery']) {
  test(`accepts a ${kind} step realized by the same graph source, action, and destination`, () => {
    const result = completeReviewFixture();
    setPathKind(result, kind);

    assert.equal(validateReviewResult(result).ok, true);
  });

  test(`rejects a ${kind} step that skips graph intermediaries despite an eventual route`, () => {
    const result = namedAdjacentRouteFixture();
    setPathKind(result, kind);
    assert.equal(validateReviewResult(result).ok, true);
    result.exitAndRetryPaths[0].destinationStateId = 'state.recovered';

    assertRecoveryRejected(result);
  });

  test(`rejects a ${kind} step whose visible source action differs from the graph edge`, () => {
    const result = completeReviewFixture();
    setPathKind(result, kind);
    const action = result.facts.find((fact) => fact.id === 'fact.recover');
    result.facts.push({
      ...action,
      id: 'fact.alternate-recovery',
      statement: 'Another action is visible but has no graph transition.',
      visibleAction: 'Use a different context',
    });
    result.exitAndRetryPaths[0].actionFactId = 'fact.alternate-recovery';

    assertRecoveryRejected(result);
  });

  test(`rejects a ${kind} step whose destination differs from the matching source and action edge`, () => {
    const result = completeReviewFixture();
    setPathKind(result, kind);
    result.exitAndRetryPaths[0].destinationStateId = 'state.entry';

    assertRecoveryRejected(result);
  });
}

for (const kind of ['retry', 'recovery']) {
  test(`rejects a ${kind} graph step whose source differs from its referenced RecoveryPath`, () => {
    const result = completeReviewFixture();
    setPathKind(result, kind);
    Object.assign(result.exitAndRetryPaths[0], {
      sourceStateId: 'state.entry',
      actionFactId: 'fact.submit',
      destinationStateId: 'state.blocked',
    });

    assertRecoveryRejected(result);
  });

  test(`accepts a named-adjacent ${kind} through multiple intermediaries to the eventual return`, () => {
    const result = namedAdjacentRouteFixture();
    setPathKind(result, kind);
    const graphStateIds = new Set(result.journeyStateGraph.states.map((state) => state.id));
    const recovery = result.recoveryPaths[0];

    assert.notEqual(result.exitAndRetryPaths[0].destinationStateId, recovery.returnStateId);
    assert.equal(graphStateIds.has(recovery.returnTarget.targetId), false);
    assert.equal(recovery.preservedState.every((id) => !graphStateIds.has(id)), true);
    assert.equal(validateReviewResult(result).ok, true);
  });

  test(`rejects a ${kind} return reachable from entry but unreachable from the blocked source`, () => {
    const result = completeReviewFixture();
    setPathKind(result, kind);
    const parallelFactId = appendDerivedState(result, 'state.parallel-return', 5);
    appendEdge(result, 'edge.parallel-return', 'fact.submit', parallelFactId);
    result.recoveryPaths[0].returnStateId = 'state.parallel-return';
    refreshReviewProjection(result);

    assert.equal(result.statesChecked.includes('state.parallel-return'), true);
    const fromBlocked = orderJourneyStates({
      ...result.journeyStateGraph,
      entryStateId: 'state.blocked',
    });
    assert.equal(fromBlocked.some((state) => state.stateId === 'state.parallel-return'), false);
    assertRecoveryRejected(result);
  });

  test(`rejects a ${kind} destination branch that cannot reach return even when the source can`, () => {
    const result = namedAdjacentRouteFixture();
    setPathKind(result, kind);
    const deadEndFactId = appendDerivedState(result, 'state.dead-end', 7);
    appendEdge(result, 'edge.dead-end', 'fact.recover', deadEndFactId);
    result.exitAndRetryPaths[0].destinationStateId = 'state.dead-end';
    refreshReviewProjection(result);

    const fromBlocked = orderJourneyStates({
      ...result.journeyStateGraph,
      entryStateId: 'state.blocked',
    });
    assert.equal(fromBlocked.some((state) => state.stateId === 'state.recovered'), true);
    const fromDestination = orderJourneyStates({
      ...result.journeyStateGraph,
      entryStateId: 'state.dead-end',
    });
    assert.equal(fromDestination.some((state) => state.stateId === 'state.recovered'), false);
    assertRecoveryRejected(result);
  });
}

test('rejects a recovery source unreachable from entry even when its return is reachable', () => {
  const result = completeReviewFixture();
  result.journeyStateGraph.edges = result.journeyStateGraph.edges
    .filter((edge) => edge.id !== 'edge.block');
  appendEdge(result, 'edge.direct-return', 'fact.submit', 'fact.recovered');
  refreshReviewProjection(result);

  assert.equal(result.statesChecked.includes('state.blocked'), false);
  assert.equal(result.statesChecked.includes('state.recovered'), true);
  assertRecoveryRejected(result);
});

test('rejects a recovery return unreachable from entry even when its source is reachable', () => {
  const result = completeReviewFixture();
  appendDerivedState(result, 'state.isolated-return', 5);
  result.recoveryPaths[0].returnStateId = 'state.isolated-return';
  refreshReviewProjection(result);

  assert.equal(result.statesChecked.includes('state.blocked'), true);
  assert.equal(result.statesChecked.includes('state.isolated-return'), false);
  assertRecoveryRejected(result);
});

for (const kind of ['keyboard-focus', 'touch-anchor', 'navigation']) {
  test(`accepts preserved business IDs and a ${kind} target that are not graph state IDs`, () => {
    const result = completeReviewFixture();
    result.recoveryPaths[0].preservedState = ['search.query', 'search.selection'];
    result.recoveryPaths[0].returnTarget = { kind, targetId: 'search.submit' };
    const graphStateIds = new Set(result.journeyStateGraph.states.map((state) => state.id));

    assert.equal(graphStateIds.has('search.submit'), false);
    assert.equal(graphStateIds.has('search.query'), false);
    assert.equal(graphStateIds.has('search.selection'), false);
    assert.equal(validateReviewResult(result).ok, true);
  });
}
