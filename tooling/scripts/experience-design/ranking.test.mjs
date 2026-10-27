import assert from 'node:assert/strict';
import test from 'node:test';

import { completeReviewFixture } from './fixtures/positive/complete-review.mjs';
import {
  orderJourneyStates,
  rankEligibleCandidates,
  recomputeCandidateLedger,
} from './ranking.mjs';

function state(id, origin, line, explicitOrder = undefined) {
  return {
    id,
    origin,
    inScope: true,
    ...(explicitOrder === undefined ? {} : { explicitOrder }),
    source: {
      path: 'source.md',
      lineStart: line,
      lineEnd: line,
    },
    visibleMeaning: id,
  };
}

test('orders states by shortest reachable action distance before explicit order', () => {
  const ordered = orderJourneyStates({
    entryStateId: 'state.entry',
    states: [
      state('state.entry', 'starting', 1),
      state('state.derived-trust', 'derived', 2),
      state('state.middle', 'derived', 3),
      state('state.explicit-late', 'explicit', 4, 0),
    ],
    edges: [
      {
        id: 'edge.trust',
        fromStateId: 'state.entry',
        toStateId: 'state.derived-trust',
      },
      {
        id: 'edge.middle',
        fromStateId: 'state.entry',
        toStateId: 'state.middle',
      },
      {
        id: 'edge.explicit',
        fromStateId: 'state.middle',
        toStateId: 'state.explicit-late',
      },
    ],
  });

  assert.equal(ordered[0].stateId, 'state.entry');
  assert.equal(ordered[1].stateId, 'state.derived-trust');
  assert.equal(ordered.at(-1).stateId, 'state.explicit-late');
  assert.equal(ordered.at(-1).distance, 2);
});

test('accepted contract blocker outranks an earlier rubric implementation risk', () => {
  const result = completeReviewFixture();
  const ledger = recomputeCandidateLedger({
    graph: result.journeyStateGraph,
    facts: result.facts,
    contracts: result.contracts,
    inferences: result.inferences,
    candidates: result.candidateLedger.map((entry) => entry.candidate),
  });
  const ranked = rankEligibleCandidates(ledger);

  assert.equal(ranked[0].candidate.id, 'candidate.primary');
  assert.deepEqual(ranked[0].priorityTuple.slice(0, 3), [0, 2, 1]);
  assert.equal(ranked[1].candidate.id, 'candidate.secondary');
  assert.deepEqual(ranked[1].priorityTuple.slice(0, 3), [1, 6, 0]);
});

test('source risk without a visible response is ineligible for primary ranking', () => {
  const result = completeReviewFixture();
  const candidate = {
    ...result.candidateLedger[1].candidate,
    factIds: ['fact.submit'],
  };
  const [entry] = recomputeCandidateLedger({
    graph: result.journeyStateGraph,
    facts: result.facts,
    contracts: result.contracts,
    inferences: result.inferences,
    candidates: [candidate],
  });

  assert.equal(entry.eligible, false);
  assert.equal(entry.priorityTuple, null);
  assert.deepEqual(entry.ineligibleReasons, ['visible-response-missing']);
});
