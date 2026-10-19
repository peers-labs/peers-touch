import { completeReviewFixture } from '../positive/complete-review.mjs';

export function minorOnlyBoundaryFixture() {
  const result = completeReviewFixture();
  const candidate = {
    id: 'candidate.minor',
    stateId: 'state.entry',
    factIds: ['fact.submit', 'fact.blocked'],
    contractIds: ['contract.scope'],
    inferenceIds: [],
    severity: 'minor',
    impact: 'polish',
    confidence: 'high',
    brokenPromise: 'The action label should remain locally clear.',
    causalMechanism: 'The label omits a small amount of supporting context.',
    userImpact: 'The journey remains completable with minor local ambiguity.',
    ownerLayer: 'content',
    correctionDirection: 'Clarify the local action label.',
  };
  const priorityTuple = [
    0,
    7,
    0,
    0,
    2,
    0,
    candidate.id,
  ];

  result.verdict = 'NO_BLOCKING_FINDING';
  result.candidateLedger = [
    {
      candidate,
      eligible: true,
      ineligibleReasons: [],
      priorityTuple,
    },
  ];
  result.primaryFinding = null;
  result.secondaryFindings = [];
  result.minorObservations = [
    {
      candidateId: candidate.id,
      factIds: candidate.factIds,
      contractIds: candidate.contractIds,
      inferenceIds: candidate.inferenceIds,
      severity: candidate.severity,
      earliestStateId: candidate.stateId,
      brokenPromise: candidate.brokenPromise,
      causalMechanism: candidate.causalMechanism,
      userImpact: candidate.userImpact,
      ownerLayer: candidate.ownerLayer,
      correctionDirection: candidate.correctionDirection,
      confidence: candidate.confidence,
      priorityBasis: priorityTuple,
    },
  ];
  result.recoveryPaths[0] = {
    ...result.recoveryPaths[0],
    distance: 'named-adjacent',
    namedAdjacentPointerFactId: 'fact.recover',
    returnTarget: {
      kind: 'navigation',
      targetId: 'search.surface',
    },
  };
  return result;
}
