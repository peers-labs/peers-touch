import { canonicalDigest } from './canonical.mjs';

function makeContract() {
  return {
    productIntent: {
      capabilityIds: ['capability.connect'],
      journeyIds: ['journey.connect'],
      visibleStateIds: ['product-state.entry', 'product-state.success'],
      acceptanceIds: ['acceptance.connect'],
      actor: 'A signed-in Peers user',
      startingContext: 'Connection setup entry',
      promisedOutcome: 'Connect one account',
      firstUsefulResult: 'The connected account is visible',
      recurringValue: 'The connection can be reused',
      trustConstraints: ['The server remains authoritative'],
      privacyConstraints: ['No secret is rendered'],
      authorityConstraints: ['Success follows current-source readback'],
      nonGoals: ['Production runtime proof'],
    },
    semantics: {
      concepts: [
        {
          id: 'concept.connect',
          meaning: 'Connect the selected account',
          scope: 'scope.connect',
          maxOccurrences: 1,
          allowedRoles: ['title', 'accessible-name'],
          exceptionReasons: ['accessibility'],
        },
      ],
    },
    informationArchitecture: {
      surfaces: [
        {
          id: 'surface.connect',
          contextId: 'context.setup',
          mainSubjectId: 'subject.connection',
          allowedRegionRoles: ['content', 'action', 'navigation'],
        },
      ],
    },
    actions: [
      {
        id: 'action.connect',
        intent: 'Connect the account',
        risk: 'routine',
        frequency: 'periodic',
        mutation: 'local',
        optionCardinality: 'none',
        canonicalIconMeaning: false,
        repeatedTool: false,
        reversible: true,
        decisionCost: 1,
        interruption: 'none',
        confirmationPolicy: 'none',
        grammarRole: 'primary_commitment',
        allowedPlatformAdapters: {
          desktop: ['form-submit'],
          mobile: ['form-submit'],
          browser: ['form-submit'],
          dashboard: ['form-submit'],
        },
        equivalentSurfaceIds: ['surface.connect'],
      },
    ],
    platformDifferences: [],
    pathBudgets: [
      {
        journeyId: 'journey.connect',
        frequency: 'periodic',
        risk: 'low',
        max: {
          commitments: 0,
          contextSwitches: 0,
          decisionLoad: 1,
          interruptions: 0,
          recoveryDebt: 0,
        },
      },
    ],
    stateRequirements: [
      {
        journeyId: 'journey.connect',
        productStateIds: ['product-state.entry', 'product-state.success'],
        requiredKinds: ['entry', 'success'],
        preserveOnFailure: [],
        authoritativeReadbackOnUnknown: false,
        recoveryRequirements: [],
      },
    ],
    acceptedTrace: [
      {
        capabilityId: 'capability.connect',
        journeyId: 'journey.connect',
        productStateIds: ['product-state.entry', 'product-state.success'],
        acceptanceIds: ['acceptance.connect'],
        orderedStateKinds: ['entry', 'success'],
        requiredActionIds: ['action.connect'],
      },
    ],
    requiredEvidence: [
      {
        id: 'evidence-requirement.contract',
        claimId: 'acceptance.connect',
        level: 'L1_CONTRACT',
        platform: 'desktop',
        runtimeProfile: 'source-only',
        inputMode: 'source',
        locale: 'en-US',
        viewport: {
          widthCssPx: 1280,
          heightCssPx: 800,
          devicePixelRatio: 1,
        },
        resolvedTheme: 'light',
        contentMode: 'default',
        stateIds: ['state.entry', 'state.success'],
        assertionIds: ['assertion.trace'],
      },
    ],
    performanceBudgets: [],
  };
}

function makeCandidate() {
  return {
    platform: 'desktop',
    copyNodes: [
      {
        id: 'copy.connect-title',
        surfaceId: 'surface.connect',
        scope: 'scope.connect',
        conceptId: 'concept.connect',
        role: 'title',
        text: 'Connect account',
      },
    ],
    surfaces: [
      {
        id: 'surface.connect',
        contextId: 'context.setup',
        mainSubjectIds: ['subject.connection'],
        regions: [
          {
            id: 'region.content',
            role: 'content',
            supportsSubjectId: 'subject.connection',
          },
          {
            id: 'region.action',
            role: 'action',
            supportsSubjectId: 'subject.connection',
          },
        ],
      },
    ],
    actions: [
      {
        id: 'candidate-action.connect',
        contractActionId: 'action.connect',
        surfaceId: 'surface.connect',
        grammarRole: 'primary_commitment',
        representation: 'text-primary-button',
        platformAdapter: 'form-submit',
        primary: true,
        accessibleLabel: 'Connect account',
        confirmation: 'none',
      },
    ],
    authorityAssertions: [],
    states: [
      {
        id: 'state.entry',
        journeyId: 'journey.connect',
        surfaceId: 'surface.connect',
        kind: 'entry',
        visibleMeaning: 'The account can be connected',
      },
      {
        id: 'state.success',
        journeyId: 'journey.connect',
        surfaceId: 'surface.connect',
        kind: 'success',
        visibleMeaning: 'The account is connected',
      },
    ],
    transitions: [
      {
        id: 'transition.connect',
        journeyId: 'journey.connect',
        fromStateId: 'state.entry',
        toStateId: 'state.success',
        candidateActionId: 'candidate-action.connect',
        preserves: [],
        authoritativeReadback: false,
      },
    ],
    recoveryBranches: [],
    journeys: [
      {
        journeyId: 'journey.connect',
        startStateId: 'state.entry',
        successStateId: 'state.success',
        steps: [
          {
            id: 'step.connect',
            transitionId: 'transition.connect',
          },
        ],
      },
    ],
    traces: [
      {
        capabilityId: 'capability.connect',
        journeyId: 'journey.connect',
        surfaceIds: ['surface.connect'],
        stateIds: ['state.entry', 'state.success'],
        actionIds: ['candidate-action.connect'],
        wireflowNodeIds: ['wireflow.entry', 'wireflow.success'],
        evidenceIds: ['evidence.contract'],
      },
    ],
    evidence: [],
  };
}

export function createFixtureBundle({
  calibration = 'positive',
  caseId = `fixture.${calibration}.complete-setup`,
  title = 'Complete connection setup',
  expected = {
    disposition: 'ready-for-independent-review',
    expectedRuleIds: [],
    expectedFindingIds: [],
  },
  mutate = undefined,
  mutateEvidence = undefined,
} = {}) {
  const contract = makeContract();
  const candidate = makeCandidate();
  const expectation = structuredClone(expected);
  const mutable = { contract, candidate, expected: expectation };
  if (mutate !== undefined) mutate(mutable);

  const candidateSource = structuredClone(candidate);
  delete candidateSource.evidence;
  const candidateDigest = canonicalDigest(candidateSource);
  candidate.evidence = [
    {
      id: 'evidence.contract',
      requirementId: 'evidence-requirement.contract',
      level: 'L1_CONTRACT',
      status: 'observed',
      sourceDigest: candidateDigest,
      platform: 'desktop',
      runtimeProfile: 'source-only',
      inputMode: 'source',
      locale: 'en-US',
      viewport: {
        widthCssPx: 1280,
        heightCssPx: 800,
        devicePixelRatio: 1,
      },
      requestedTheme: 'system',
      resolvedTheme: 'light',
      contentMode: 'default',
      stateIds: ['state.entry', 'state.success'],
      assertionIds: ['assertion.trace'],
    },
  ];
  if (mutateEvidence !== undefined) {
    mutateEvidence({ contract, candidate, expected: expectation });
  }

  const authorship = {
    contractAuthorId: 'contract-author',
    candidateAuthorId: 'candidate-author',
    evidenceAuthorIds: ['evidence-author'],
    ...(calibration === 'blind'
      ? {}
      : { expectationAuthorId: 'expectation-author' }),
  };
  const experienceCase = {
    kind: 'peers-touch-experience-case',
    schemaVersion: 1,
    id: caseId,
    title,
    calibration,
    claim: 'wireflow',
    authorship,
    contract,
    candidate,
    ...(calibration === 'blind' ? {} : { expected: expectation }),
  };
  return { experienceCase };
}
