export function completeReviewFixture() {
  const sourceBlobs = [
    {
      path: 'docs/architecture/platform/station/access/experience-contract.md',
      digest: '1111111111111111111111111111111111111111',
    },
    {
      path: 'docs/client/common/ui-identity/interaction.md',
      digest: '2222222222222222222222222222222222222222',
    },
  ];
  const contracts = [
    {
      id: 'contract.scope',
      authority: 'accepted-product',
      caseCoverage: 'explicit',
      source: {
        path: sourceBlobs[0].path,
        lineStart: 57,
        lineEnd: 65,
      },
      clause: 'SAL-J03',
      statement: 'A scoped action requires an explicit valid context.',
    },
    {
      id: 'contract.recovery',
      authority: 'accepted-client',
      caseCoverage: 'explicit',
      source: {
        path: sourceBlobs[1].path,
        lineStart: 40,
        lineEnd: 43,
      },
      clause: 'Recovery',
      statement: 'A blocked task exposes a local recovery action.',
    },
    {
      id: 'contract.rubric',
      authority: 'rubric',
      caseCoverage: 'supporting',
      source: {
        path: sourceBlobs[1].path,
        lineStart: 46,
        lineEnd: 48,
      },
      clause: 'Implementation risk',
      statement: 'Async completion should preserve the latest intent.',
    },
  ];
  const facts = [
    {
      id: 'fact.submit',
      stateId: 'state.entry',
      source: {
        path: sourceBlobs[0].path,
        lineStart: 1,
        lineEnd: 1,
      },
      statement: 'The user submits a scoped search.',
      visibleAction: 'Submit search',
    },
    {
      id: 'fact.blocked',
      stateId: 'state.blocked',
      source: {
        path: sourceBlobs[0].path,
        lineStart: 2,
        lineEnd: 2,
      },
      statement: 'The search action is disabled without a visible local route.',
      visibleResponse: 'Search unavailable',
    },
    {
      id: 'fact.recover',
      stateId: 'state.blocked',
      source: {
        path: sourceBlobs[1].path,
        lineStart: 3,
        lineEnd: 3,
      },
      statement: 'The surface exposes a named recovery action.',
      visibleAction: 'Choose context',
    },
    {
      id: 'fact.recovered',
      stateId: 'state.recovered',
      source: {
        path: sourceBlobs[1].path,
        lineStart: 4,
        lineEnd: 4,
      },
      statement: 'The task returns to an actionable state.',
      visibleResponse: 'Search available',
    },
  ];
  const inferences = [
    {
      id: 'inference.primary',
      factIds: ['fact.submit', 'fact.blocked'],
      contractIds: ['contract.scope', 'contract.recovery'],
      statement: 'The bounded journey reaches a blocker before recovery.',
    },
    {
      id: 'inference.secondary',
      factIds: ['fact.submit', 'fact.blocked'],
      contractIds: ['contract.rubric'],
      statement: 'An async implementation may preserve stale intent.',
    },
  ];
  const primaryCandidate = {
    id: 'candidate.primary',
    stateId: 'state.blocked',
    factIds: ['fact.submit', 'fact.blocked'],
    contractIds: ['contract.scope', 'contract.recovery'],
    inferenceIds: ['inference.primary'],
    severity: 'blocking',
    impact: 'recovery-absent',
    confidence: 'high',
    brokenPromise: 'The user can recover from a blocked scoped action.',
    causalMechanism: 'The blocker is visible before a usable recovery route.',
    userImpact: 'The journey cannot continue from the failure surface.',
    ownerLayer: 'state-and-recovery',
    correctionDirection: 'Expose a contract-backed recovery action locally.',
  };
  const secondaryCandidate = {
    id: 'candidate.secondary',
    stateId: 'state.entry',
    factIds: ['fact.submit', 'fact.blocked'],
    contractIds: ['contract.rubric'],
    inferenceIds: ['inference.secondary'],
    severity: 'major',
    impact: 'implementation-risk',
    confidence: 'medium',
    brokenPromise: 'The latest submitted intent remains authoritative.',
    causalMechanism: 'Async completion is not visibly fenced.',
    userImpact: 'A stale result may appear after a later action.',
    ownerLayer: 'implementation',
    correctionDirection: 'Fence completion by the current submitted intent.',
  };
  const primaryTuple = [
    0,
    2,
    1,
    0,
    0,
    0,
    'candidate.primary',
  ];
  const secondaryTuple = [
    1,
    6,
    0,
    1,
    1,
    1,
    'candidate.secondary',
  ];

  return {
    kind: 'peers-touch-experience-review-result',
    schemaVersion: 1,
    authorId: 'agent.fixture-author',
    verdict: 'FINDINGS',
    evaluationBinding: {
      packageId: 'EDX-FIXTURE',
      runEnvelopeDigest: `sha256:${'a'.repeat(64)}`,
      caseDigest: `sha256:${'b'.repeat(64)}`,
      sourceHead: 'c'.repeat(40),
      manifestDigest: `sha256:${'d'.repeat(64)}`,
      rubricDigest: `sha256:${'e'.repeat(64)}`,
      sourceBlobAlgorithm: 'git-sha1',
      sourceBlobs,
    },
    contracts,
    facts,
    inferences,
    journeyStateGraph: {
      entryStateId: 'state.entry',
      states: [
        {
          id: 'state.entry',
          origin: 'starting',
          inScope: true,
          source: {
            path: sourceBlobs[0].path,
            lineStart: 1,
            lineEnd: 1,
          },
          visibleMeaning: 'Ready to submit',
        },
        {
          id: 'state.blocked',
          origin: 'explicit',
          inScope: true,
          explicitOrder: 0,
          source: {
            path: sourceBlobs[0].path,
            lineStart: 2,
            lineEnd: 2,
          },
          visibleMeaning: 'Scoped action blocked',
        },
        {
          id: 'state.recovered',
          origin: 'derived',
          inScope: true,
          source: {
            path: sourceBlobs[1].path,
            lineStart: 4,
            lineEnd: 4,
          },
          visibleMeaning: 'Action available after recovery',
        },
      ],
      edges: [
        {
          id: 'edge.block',
          fromStateId: 'state.entry',
          toStateId: 'state.blocked',
          actionFactId: 'fact.submit',
          responseFactId: 'fact.blocked',
          sourceRefs: [facts[0].source, facts[1].source],
        },
        {
          id: 'edge.recover',
          fromStateId: 'state.blocked',
          toStateId: 'state.recovered',
          actionFactId: 'fact.recover',
          responseFactId: 'fact.recovered',
          sourceRefs: [facts[2].source, facts[3].source],
        },
      ],
    },
    trustBoundaryChecks: [],
    recoveryPaths: [
      {
        id: 'recovery.local',
        contractIds: ['contract.recovery'],
        sourceStateId: 'state.blocked',
        reason: 'The scoped action is blocked.',
        entryActionVisible: true,
        distance: 'same-surface',
        preservedState: ['search.query'],
        returnStateId: 'state.recovered',
        returnTarget: {
          kind: 'keyboard-focus',
          targetId: 'search.submit',
        },
      },
    ],
    candidateLedger: [
      {
        candidate: primaryCandidate,
        eligible: true,
        ineligibleReasons: [],
        priorityTuple: primaryTuple,
      },
      {
        candidate: secondaryCandidate,
        eligible: true,
        ineligibleReasons: [],
        priorityTuple: secondaryTuple,
      },
    ],
    primaryFinding: {
      candidateId: primaryCandidate.id,
      factIds: primaryCandidate.factIds,
      contractIds: primaryCandidate.contractIds,
      inferenceIds: primaryCandidate.inferenceIds,
      severity: primaryCandidate.severity,
      earliestStateId: primaryCandidate.stateId,
      brokenPromise: primaryCandidate.brokenPromise,
      causalMechanism: primaryCandidate.causalMechanism,
      userImpact: primaryCandidate.userImpact,
      ownerLayer: primaryCandidate.ownerLayer,
      correctionDirection: primaryCandidate.correctionDirection,
      confidence: primaryCandidate.confidence,
      priorityBasis: primaryTuple,
    },
    secondaryFindings: [
      {
        candidateId: secondaryCandidate.id,
        factIds: secondaryCandidate.factIds,
        contractIds: secondaryCandidate.contractIds,
        inferenceIds: secondaryCandidate.inferenceIds,
        severity: secondaryCandidate.severity,
        earliestStateId: secondaryCandidate.stateId,
        brokenPromise: secondaryCandidate.brokenPromise,
        causalMechanism: secondaryCandidate.causalMechanism,
        userImpact: secondaryCandidate.userImpact,
        ownerLayer: secondaryCandidate.ownerLayer,
        correctionDirection: secondaryCandidate.correctionDirection,
        confidence: secondaryCandidate.confidence,
        priorityBasis: secondaryTuple,
        deprioritizedBecause:
          'Accepted product recovery contract outranks rubric implementation risk.',
      },
    ],
    minorObservations: [],
    statesChecked: ['state.entry', 'state.blocked', 'state.recovered'],
    exitAndRetryPaths: [
      {
        id: 'path.recover',
        kind: 'recovery',
        sourceStateId: 'state.blocked',
        actionFactId: 'fact.recover',
        destinationStateId: 'state.recovered',
        recoveryPathId: 'recovery.local',
      },
    ],
    unproven: [],
  };
}
