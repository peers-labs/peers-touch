import path from 'node:path';

import { canonicalDigest, equalStringSets, fail } from './canonical.mjs';
import {
  matchEvidenceRequirements,
  observedEvidenceAtOrAbove,
} from './evidence.mjs';

const SOURCE_EVALUATED_AT = '1970-01-01T00:00:00.000Z';
const PATH_DIMENSIONS = [
  'commitments',
  'contextSwitches',
  'decisionLoad',
  'interruptions',
  'recoveryDebt',
];

function includesAll(actual, required) {
  const values = new Set(actual);
  return required.every((item) => values.has(item));
}

function sameArray(left, right) {
  return (
    left.length === right.length
    && left.every((value, index) => value === right[index])
  );
}

function locationId(value) {
  return String(value)
    .replace(/[^A-Za-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function createFindingCollector(ruleCatalog) {
  const findings = new Map();
  function add(ruleId, key, location, observed, consequence, correction) {
    const rule = ruleCatalog.rules.get(ruleId);
    if (rule === undefined) {
      fail('ED_INTERNAL_ERROR', `evaluator emitted unknown rule ${ruleId}`);
    }
    const id = `${ruleId}:${locationId(key)}`;
    const finding = {
      id,
      ruleId,
      severity: rule.severity,
      owner: rule.owner,
      location,
      observed,
      consequence,
      correction,
    };
    const existing = findings.get(id);
    if (
      existing !== undefined
      && canonicalDigest(existing) !== canonicalDigest(finding)
    ) {
      fail('ED_INTERNAL_ERROR', `conflicting deterministic finding ${id}`);
    }
    findings.set(id, finding);
  }
  return {
    add,
    values() {
      return [...findings.values()].sort(
        (left, right) =>
          left.ruleId.localeCompare(right.ruleId)
          || left.id.localeCompare(right.id),
      );
    },
  };
}

function indexCase(experienceCase) {
  const { contract, candidate } = experienceCase;
  return {
    concepts: new Map(
      contract.semantics.concepts.map((item) => [item.id, item]),
    ),
    contractSurfaces: new Map(
      contract.informationArchitecture.surfaces.map((item) => [item.id, item]),
    ),
    contractActions: new Map(
      contract.actions.map((item) => [item.id, item]),
    ),
    pathBudgets: new Map(
      contract.pathBudgets.map((item) => [item.journeyId, item]),
    ),
    stateRequirements: new Map(
      contract.stateRequirements.map((item) => [item.journeyId, item]),
    ),
    acceptedTraces: new Map(
      contract.acceptedTrace.map((item) => [item.journeyId, item]),
    ),
    evidenceRequirements: new Map(
      contract.requiredEvidence.map((item) => [item.id, item]),
    ),
    surfaces: new Map(candidate.surfaces.map((item) => [item.id, item])),
    actions: new Map(candidate.actions.map((item) => [item.id, item])),
    states: new Map(candidate.states.map((item) => [item.id, item])),
    transitions: new Map(
      candidate.transitions.map((item) => [item.id, item]),
    ),
    authorityAssertions: new Map(
      candidate.authorityAssertions.map((item) => [item.id, item]),
    ),
    journeys: new Map(
      candidate.journeys.map((item) => [item.journeyId, item]),
    ),
    traces: new Map(
      candidate.traces.map((item) => [item.journeyId, item]),
    ),
    recoveryBranches: new Map(
      candidate.recoveryBranches.map((item) => [item.sourceStateId, item]),
    ),
  };
}

function evaluateSemantics(experienceCase, indexes, findings) {
  const grouped = new Map();
  for (const copy of experienceCase.candidate.copyNodes) {
    const concept = indexes.concepts.get(copy.conceptId);
    const key = `${copy.conceptId}\u0000${copy.scope}`;
    const current = grouped.get(key) ?? [];
    current.push(copy);
    grouped.set(key, current);
    if (copy.scope !== concept.scope) {
      findings.add(
        'ED-SEM-001',
        `${copy.id}:scope`,
        `candidate.copyNodes.${copy.id}.scope`,
        `Copy scope ${copy.scope} differs from accepted scope ${concept.scope}.`,
        'Concept occurrence accounting is split across incompatible scopes.',
        'Bind the copy node to the accepted concept scope.',
      );
    }
    if (!concept.allowedRoles.includes(copy.role)) {
      findings.add(
        'ED-SEM-001',
        `${copy.id}:role`,
        `candidate.copyNodes.${copy.id}.role`,
        `Role ${copy.role} is not accepted for concept ${concept.id}.`,
        'The same concept gains an unreviewed hierarchy meaning.',
        'Use an accepted copy role or amend the concept contract.',
      );
    }
    if (
      copy.exceptionReason !== undefined
      && !concept.exceptionReasons.includes(copy.exceptionReason)
    ) {
      findings.add(
        'ED-SEM-001',
        `${copy.id}:exception`,
        `candidate.copyNodes.${copy.id}.exceptionReason`,
        `Exception ${copy.exceptionReason} is not allowed by ${concept.id}.`,
        'An occurrence can bypass the reviewed semantic budget.',
        'Remove the exception or amend the concept through Product review.',
      );
    }
  }
  for (const [key, nodes] of grouped.entries()) {
    const [conceptId, scope] = key.split('\u0000');
    const concept = indexes.concepts.get(conceptId);
    const counted = nodes.filter(
      (node) =>
        node.exceptionReason === undefined
        || !concept.exceptionReasons.includes(node.exceptionReason),
    );
    if (counted.length > concept.maxOccurrences) {
      findings.add(
        'ED-SEM-001',
        `${conceptId}:${scope}`,
        `candidate.copyNodes[concept=${conceptId},scope=${scope}]`,
        `${counted.length} occurrences exceed the budget of ${concept.maxOccurrences}.`,
        'Repeated meaning competes with the main task and weakens hierarchy.',
        'Remove redundant occurrences or record a legal scoped exception.',
      );
    }
  }
}

function evaluateInformationArchitecture(
  experienceCase,
  indexes,
  grammar,
  findings,
) {
  for (const surface of experienceCase.candidate.surfaces) {
    const accepted = indexes.contractSurfaces.get(surface.id);
    if (
      surface.mainSubjectIds.length !== 1
      || surface.mainSubjectIds[0] !== accepted.mainSubjectId
    ) {
      findings.add(
        'ED-IA-001',
        `${surface.id}:main-subject`,
        `candidate.surfaces.${surface.id}.mainSubjectIds`,
        `Surface declares [${surface.mainSubjectIds.join(', ')}] instead of ${accepted.mainSubjectId}.`,
        'Attention and region ownership no longer have one accepted subject.',
        'Restore the single accepted main subject.',
      );
    }
    if (surface.contextId !== accepted.contextId) {
      findings.add(
        'ED-IA-001',
        `${surface.id}:context`,
        `candidate.surfaces.${surface.id}.contextId`,
        `Context ${surface.contextId} differs from ${accepted.contextId}.`,
        'Path-cost and return-context derivation become unreliable.',
        'Use the accepted context or amend the surface contract.',
      );
    }
    for (const region of surface.regions) {
      if (!accepted.allowedRegionRoles.includes(region.role)) {
        findings.add(
          'ED-IA-001',
          `${surface.id}:${region.id}:role`,
          `candidate.surfaces.${surface.id}.regions.${region.id}`,
          `Region role ${region.role} is not accepted on ${surface.id}.`,
          'The surface contains an unowned hierarchy region.',
          'Use an accepted region role or amend the surface contract.',
        );
      }
      const grammarRegion = grammar.value.regionRoles[region.role];
      if (grammarRegion === undefined) {
        findings.add(
          'ED-GRAMMAR-001',
          `${surface.id}:${region.id}`,
          `candidate.surfaces.${surface.id}.regions.${region.id}.role`,
          `Region role ${region.role} is absent from UI Grammar.`,
          'No shared subject-ownership rule can be applied.',
          'Register the role in UI Identity or use a canonical role.',
        );
      } else if (
        grammarRegion.requiresSubject
        && region.supportsSubjectId !== accepted.mainSubjectId
      ) {
        findings.add(
          'ED-IA-001',
          `${surface.id}:${region.id}:subject`,
          `candidate.surfaces.${surface.id}.regions.${region.id}.supportsSubjectId`,
          `Region does not support accepted subject ${accepted.mainSubjectId}.`,
          'The region becomes decorative or competes with the main subject.',
          'Bind the region to the accepted subject.',
        );
      }
    }
  }
}

function legalConfirmation(contract, candidate, policy = contract.confirmationPolicy) {
  if (policy === 'contract-owned') return true;
  if (policy === 'none') {
    return candidate.confirmation === 'none';
  }
  if (policy === 'required') {
    return candidate.confirmation === 'user-confirmed';
  }
  if (policy === 'required-when-irreversible') {
    return contract.mutation === 'external-irreversible'
      ? candidate.confirmation === 'user-confirmed'
      : candidate.confirmation !== 'server-authorized';
  }
  return candidate.confirmation === 'server-authorized';
}

function allowedDifference(contract, left, right, differences, platform) {
  return differences.some((difference) => {
    if (difference.actionContractId !== contract.id) return false;
    const orientations = [
      [difference.left, difference.right],
      [difference.right, difference.left],
    ];
    return orientations.some(
      ([acceptedLeft, acceptedRight]) =>
        acceptedLeft.platform === platform
        && acceptedRight.platform === platform
        && acceptedLeft.surfaceId === left.surfaceId
        && acceptedLeft.representation === left.representation
        && acceptedLeft.adapter === left.platformAdapter
        && acceptedRight.surfaceId === right.surfaceId
        && acceptedRight.representation === right.representation
        && acceptedRight.adapter === right.platformAdapter,
    );
  });
}

function evaluateActions(
  experienceCase,
  indexes,
  grammar,
  findings,
  options,
) {
  const byContract = new Map();
  for (const candidate of experienceCase.candidate.actions) {
    const contract = indexes.contractActions.get(candidate.contractActionId);
    const current = byContract.get(contract.id) ?? [];
    current.push(candidate);
    byContract.set(contract.id, current);
    const role = grammar.actionRoles.get(candidate.grammarRole);
    if (role === undefined) {
      findings.add(
        'ED-GRAMMAR-001',
        `${candidate.id}:role`,
        `candidate.actions.${candidate.id}.grammarRole`,
        `Action role ${candidate.grammarRole} is absent from UI Grammar.`,
        'The action has no canonical representation or platform adapter.',
        'Use a canonical role or update UI Identity before high fidelity.',
      );
      continue;
    }
    const representation = role.representations[candidate.representation];
    if (representation === undefined) {
      findings.add(
        'ED-GRAMMAR-001',
        `${candidate.id}:representation`,
        `candidate.actions.${candidate.id}.representation`,
        `Representation ${candidate.representation} is not allowed for ${candidate.grammarRole}.`,
        'The action bypasses the shared representation contract.',
        'Choose a representation registered for the action role.',
      );
    }
    const platformAdapters = role[`${experienceCase.candidate.platform}Adapters`];
    const violations = [];
    if (candidate.grammarRole !== contract.grammarRole) {
      violations.push(
        `role ${candidate.grammarRole} differs from ${contract.grammarRole}`,
      );
    }
    if (!role.allowedMutations.includes(contract.mutation)) {
      violations.push(`mutation ${contract.mutation} is not allowed`);
    }
    if (!role.allowedOptionCardinality.includes(contract.optionCardinality)) {
      violations.push(
        `option shape ${contract.optionCardinality} is not allowed`,
      );
    }
    if (
      !platformAdapters.includes(candidate.platformAdapter)
      || !contract.allowedPlatformAdapters[
        experienceCase.candidate.platform
      ].includes(candidate.platformAdapter)
    ) {
      violations.push(
        `adapter ${candidate.platformAdapter} is not allowed on ${experienceCase.candidate.platform}`,
      );
    }
    if (!legalConfirmation(contract, candidate)) {
      violations.push(
        `confirmation ${candidate.confirmation} violates ${contract.confirmationPolicy}`,
      );
    }
    if (!legalConfirmation(contract, candidate, role.confirmation)) {
      violations.push(`confirmation ${candidate.confirmation} violates grammar ${role.confirmation}`);
    }
    if (
      candidate.grammarRole === 'primary_commitment'
      && !candidate.primary
    ) {
      violations.push('primary_commitment must own primary surface emphasis');
    }
    if (
      contract.risk === 'destructive'
      && candidate.grammarRole !== 'destructive_command'
    ) {
      violations.push('destructive risk requires destructive_command');
    }
    if (
      contract.mutation === 'external-irreversible'
      && (
        contract.risk !== 'destructive'
        || candidate.confirmation !== 'user-confirmed'
      )
    ) {
      violations.push(
        'external-irreversible mutation requires destructive risk and user confirmation',
      );
    }
    if (representation !== undefined) {
      if (
        representation.accessibleLabel
        && candidate.accessibleLabel === undefined
      ) {
        violations.push('accessible label is required');
      }
      if (representation.tooltip && candidate.tooltip === undefined) {
        violations.push('tooltip is required');
      }
      if (
        representation.iconOnly
        && (
          !contract.canonicalIconMeaning
          || !contract.repeatedTool
          || !representation.canonicalIconMeaning
          || !representation.repeatedTool
        )
      ) {
        violations.push(
          'icon-only requires canonical meaning and repeated-tool semantics',
        );
      }
    }

    if (contract.confirmationPolicy === 'server-authoritative') {
      const assertions = experienceCase.candidate.authorityAssertions.filter(
        (item) => item.actionCandidateId === candidate.id,
      );
      const assertion = assertions[0];
      const transition = assertion === undefined
        ? undefined
        : indexes.transitions.get(assertion.transitionId);
      if (
        assertions.length !== 1
        || contract.authoritativeOwner === undefined
        || contract.readbackContract === undefined
        || contract.expectedAuthorityResultId === undefined
        || assertion.authoritativeOwner !== contract.authoritativeOwner
        || assertion.readbackContract !== contract.readbackContract
        || assertion.expectedAuthorityResultId
          !== contract.expectedAuthorityResultId
        || transition?.candidateActionId !== candidate.id
      ) {
        violations.push('server authority assertion is missing or stale');
      } else if (
        !observedEvidenceAtOrAbove(
          experienceCase.contract,
          experienceCase.candidate,
          assertion.evidenceRequirementId,
          assertion.minimumEvidenceLevel,
          options,
        )
      ) {
        violations.push(
          'server authority assertion lacks exact observed runtime evidence',
        );
      }
    } else if (
      experienceCase.candidate.authorityAssertions.some(
        (item) => item.actionCandidateId === candidate.id,
      )
    ) {
      violations.push('non-authoritative action owns an authority assertion');
    }

    if (violations.length > 0) {
      findings.add(
        'ED-ACTION-001',
        candidate.id,
        `candidate.actions.${candidate.id}`,
        violations.join('; '),
        'Risk, mutation, representation, adapter, confirmation, and authority no longer form one accepted tuple.',
        'Restore the accepted action tuple or amend the Product/UI Identity contract.',
      );
    }
  }

  for (const surface of experienceCase.candidate.surfaces) {
    const primary = experienceCase.candidate.actions.filter(
      (action) => action.surfaceId === surface.id && action.primary,
    );
    if (primary.length > 1) {
      findings.add(
        'ED-ACTION-001',
        `${surface.id}:primary-count`,
        `candidate.surfaces.${surface.id}`,
        `${primary.length} actions claim primary ownership.`,
        'The surface has competing main commitments.',
        'Keep one primary commitment and demote supporting commands.',
      );
    }
    const roleCounts = new Map();
    for (const action of experienceCase.candidate.actions.filter(
      (candidate) => candidate.surfaceId === surface.id,
    )) {
      const role = grammar.actionRoles.get(action.grammarRole);
      if (role?.maxPerSurface === null || role === undefined) continue;
      const count = (roleCounts.get(action.grammarRole) ?? 0) + 1;
      roleCounts.set(action.grammarRole, count);
      if (count > role.maxPerSurface) {
        findings.add(
          'ED-ACTION-001',
          `${surface.id}:${action.grammarRole}:max`,
          `candidate.surfaces.${surface.id}`,
          `${count} ${action.grammarRole} actions exceed the grammar maximum of ${role.maxPerSurface}.`,
          'The surface gains competing actions with the same exclusive role.',
          'Keep the role within its UI Grammar maximum.',
        );
      }
    }
  }
  for (const [contractId, candidates] of byContract.entries()) {
    const contract = indexes.contractActions.get(contractId);
    const actualSurfaceIds = candidates.map((candidate) => candidate.surfaceId);
    if (
      new Set(actualSurfaceIds).size !== actualSurfaceIds.length
      || !equalStringSets(actualSurfaceIds, contract.equivalentSurfaceIds)
    ) {
      findings.add(
        'ED-ACTION-001',
        `${contractId}:surface-coverage`,
        `candidate.actions[contractActionId=${contractId}]`,
        `Candidate surfaces [${actualSurfaceIds.join(', ')}] do not exactly cover [${contract.equivalentSurfaceIds.join(', ')}].`,
        'Equivalent surfaces can omit the accepted action or own duplicate forms.',
        'Provide exactly one candidate action on every accepted equivalent surface.',
      );
    }
    for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < candidates.length;
        rightIndex += 1
      ) {
        const left = candidates[leftIndex];
        const right = candidates[rightIndex];
        if (
          (
            left.representation !== right.representation
            || left.platformAdapter !== right.platformAdapter
          )
          && !allowedDifference(
            contract,
            left,
            right,
            experienceCase.contract.platformDifferences,
            experienceCase.candidate.platform,
          )
        ) {
          findings.add(
            'ED-ACTION-001',
            `${contractId}:${left.surfaceId}:${right.surfaceId}`,
            `candidate.actions[contractActionId=${contractId}]`,
            `Equivalent surfaces use ${left.representation}/${left.platformAdapter} and ${right.representation}/${right.platformAdapter}.`,
            'The same intent changes form without an accepted platform rationale.',
            'Use one representation/adapter or add an accepted PlatformDifference.',
          );
        }
      }
    }
  }
}

function transitionsFrom(indexes, stateId, journeyId) {
  return [...indexes.transitions.values()].filter(
    (transition) =>
      transition.fromStateId === stateId
      && transition.journeyId === journeyId,
  );
}

function reachableStateIds(indexes, startStateId, journeyId) {
  const visited = new Set();
  const queue = [startStateId];
  while (queue.length > 0) {
    const stateId = queue.shift();
    if (visited.has(stateId)) continue;
    visited.add(stateId);
    for (const transition of transitionsFrom(indexes, stateId, journeyId)) {
      if (!visited.has(transition.toStateId)) queue.push(transition.toStateId);
    }
  }
  return visited;
}

function reachableBeforeSuccess(indexes, journey) {
  const visited = new Set();
  const queue = [journey.startStateId];
  while (queue.length > 0) {
    const stateId = queue.shift();
    if (visited.has(stateId) || stateId === journey.successStateId) continue;
    visited.add(stateId);
    for (const transition of transitionsFrom(
      indexes,
      stateId,
      journey.journeyId,
    )) {
      if (!visited.has(transition.toStateId)) queue.push(transition.toStateId);
    }
  }
  return visited;
}

function evaluateStateAndRecovery(experienceCase, indexes, findings) {
  const requiredBranchSources = new Set();
  for (const journey of experienceCase.candidate.journeys) {
    const requirement = indexes.stateRequirements.get(journey.journeyId);
    const start = indexes.states.get(journey.startStateId);
    if (start.kind !== 'entry') {
      findings.add(
        'ED-STATE-001',
        `${journey.journeyId}:entry`,
        `candidate.journeys.${journey.journeyId}.startStateId`,
        `Journey starts at ${start.kind} instead of entry.`,
        'Reachability is not rooted in the canonical entry state.',
        'Start the Journey at an entry state.',
      );
    }
    const reachable = reachableStateIds(
      indexes,
      journey.startStateId,
      journey.journeyId,
    );
    const reachableStates = [...reachable].map((id) => indexes.states.get(id));
    for (const kind of requirement.requiredKinds) {
      if (!reachableStates.some((state) => state.kind === kind)) {
        findings.add(
          'ED-STATE-001',
          `${journey.journeyId}:missing-${kind}`,
          `candidate.journeys.${journey.journeyId}`,
          `Required ${kind} state is not reachable from entry.`,
          'The Journey omits an accepted visible state.',
          `Add a reachable ${kind} state and transition trace.`,
        );
      }
    }
    for (const state of reachableStates.filter((item) =>
      ['failure', 'unknown-outcome'].includes(item.kind))) {
      requiredBranchSources.add(state.id);
      const branch = indexes.recoveryBranches.get(state.id);
      const recovery = requirement.recoveryRequirements.find(
        (item) => item.sourceKind === state.kind,
      );
      const violations = [];
      if (branch === undefined || recovery === undefined) {
        violations.push('recovery branch or requirement is missing');
      } else {
        const transition = indexes.transitions.get(
          branch.recoveryTransitionId,
        );
        const action = indexes.actions.get(
          branch.recoveryActionCandidateId,
        );
        const contractAction = indexes.contractActions.get(
          action.contractActionId,
        );
        const returnState = indexes.states.get(branch.returnStateId);
        if (
          transition.fromStateId !== state.id
          || transition.toStateId !== branch.returnStateId
          || transition.candidateActionId !== branch.recoveryActionCandidateId
        ) {
          violations.push('recovery transition is not bound to the branch');
        }
        if (
          !recovery.allowedRecoveryActionContractIds.includes(contractAction.id)
        ) {
          violations.push(`action ${contractAction.id} is not allowed`);
        }
        if (
          branch.focusTargetId !== recovery.requiredFocusTargetId
          || !recovery.allowedReturnKinds.includes(returnState.kind)
        ) {
          violations.push('focus or return state violates the requirement');
        }
        if (
          !includesAll(branch.preserves, requirement.preserveOnFailure)
          || !includesAll(transition.preserves, requirement.preserveOnFailure)
        ) {
          violations.push('required input or durable state is not preserved');
        }
        if (
          recovery.requiresAuthorityReconciliation
          && (
            branch.authorityAssertionId === undefined
            || !indexes.authorityAssertions.has(branch.authorityAssertionId)
            || !transition.authoritativeReadback
          )
        ) {
          violations.push('authority reconciliation is missing');
        }
        if (
          state.kind === 'unknown-outcome'
          && requirement.authoritativeReadbackOnUnknown
          && !transition.authoritativeReadback
        ) {
          violations.push('unknown outcome lacks authoritative readback');
        }
      }
      if (violations.length > 0) {
        findings.add(
          'ED-STATE-001',
          `${journey.journeyId}:${state.id}`,
          `candidate.recoveryBranches.${state.id}`,
          violations.join('; '),
          'Failure can strand the user, lose work, or repeat an uncertain side effect.',
          'Implement the exact preservation, focus, return, and authority recovery contract.',
        );
      }
    }
  }
  for (const branch of experienceCase.candidate.recoveryBranches) {
    if (requiredBranchSources.has(branch.sourceStateId)) continue;
    findings.add(
      'ED-STATE-001',
      `${branch.sourceStateId}:orphan-recovery`,
      `candidate.recoveryBranches.${branch.sourceStateId}`,
      'Recovery branch source is not a reachable failure or unknown-outcome state.',
      'The candidate contains an unowned recovery path outside the accepted state lifecycle.',
      'Remove the branch or connect its source through the accepted Journey state graph.',
    );
  }
}

function orderedJourney(indexes, journey) {
  const transitions = journey.steps.map((step) =>
    indexes.transitions.get(step.transitionId));
  const violations = [];
  if (transitions[0]?.fromStateId !== journey.startStateId) {
    violations.push('first transition does not start at startStateId');
  }
  transitions.forEach((transition, index) => {
    if (transition.journeyId !== journey.journeyId) {
      violations.push(`step ${index} belongs to another Journey`);
    }
    if (
      index > 0
      && transitions[index - 1].toStateId !== transition.fromStateId
    ) {
      violations.push(`steps ${index - 1} and ${index} are not contiguous`);
    }
  });
  if (
    transitions.length > 0
    && transitions.at(-1).toStateId !== journey.successStateId
  ) {
    violations.push('final transition does not end at successStateId');
  }
  const stateIds = [
    journey.startStateId,
    ...transitions.map((transition) => transition.toStateId),
  ];
  if (new Set(stateIds).size !== stateIds.length) {
    violations.push('selected success path contains a cycle');
  }
  return { transitions, stateIds, violations };
}

function branchRecoveryDebt(
  experienceCase,
  indexes,
  transition,
  successStateId,
) {
  const contractAction = indexes.contractActions.get(
    indexes.actions.get(transition.candidateActionId).contractActionId,
  );
  if (contractAction.mutation === 'none') return 0;
  const requirement = indexes.stateRequirements.get(transition.journeyId);
  const reachable = reachableStateIds(
    indexes,
    transition.toStateId,
    transition.journeyId,
  );
  reachable.delete(successStateId);
  let debt = 0;
  for (const stateId of reachable) {
    const state = indexes.states.get(stateId);
    if (!['failure', 'unknown-outcome'].includes(state.kind)) continue;
    const branch = indexes.recoveryBranches.get(stateId);
    if (
      branch === undefined
      || !includesAll(branch.preserves, requirement.preserveOnFailure)
    ) {
      debt += 1;
    }
  }
  return debt;
}

function derivePathCost(experienceCase, indexes, journey, ordered) {
  const cost = {
    commitments: 0,
    contextSwitches: 0,
    decisionLoad: 0,
    interruptions: 0,
    recoveryDebt: 0,
  };
  for (const transition of ordered.transitions) {
    const candidateAction = indexes.actions.get(transition.candidateActionId);
    const contractAction = indexes.contractActions.get(
      candidateAction.contractActionId,
    );
    if (
      contractAction.mutation === 'external-irreversible'
      || (
        contractAction.mutation === 'external-reversible'
        && candidateAction.confirmation === 'none'
      )
    ) {
      cost.commitments += 1;
    }
    const fromSurface = indexes.contractSurfaces.get(
      indexes.states.get(transition.fromStateId).surfaceId,
    );
    const toSurface = indexes.contractSurfaces.get(
      indexes.states.get(transition.toStateId).surfaceId,
    );
    if (fromSurface.contextId !== toSurface.contextId) {
      cost.contextSwitches += 1;
    }
    cost.decisionLoad += contractAction.decisionCost;
    if (contractAction.interruption !== 'none') cost.interruptions += 1;
    cost.recoveryDebt += branchRecoveryDebt(
      experienceCase,
      indexes,
      transition,
      journey.successStateId,
    );
  }
  return cost;
}

function evaluatePathAndTrace(experienceCase, indexes, findings) {
  const derivedPathCosts = {};
  for (const journey of experienceCase.candidate.journeys) {
    const ordered = orderedJourney(indexes, journey);
    if (ordered.violations.length > 0) {
      findings.add(
        'ED-TRACE-001',
        `${journey.journeyId}:path-chain`,
        `candidate.journeys.${journey.journeyId}.steps`,
        ordered.violations.join('; '),
        'The evaluator cannot derive one contiguous start-to-success Journey.',
        'Provide one acyclic contiguous ordered success path.',
      );
    }
    const selectedTransitionIds = new Set(
      ordered.transitions.map((transition) => transition.id),
    );
    const recoveryTransitionIds = new Set(
      experienceCase.candidate.recoveryBranches.map(
        (branch) => branch.recoveryTransitionId,
      ),
    );
    const beforeSuccess = reachableBeforeSuccess(indexes, journey);
    const accepted = indexes.acceptedTraces.get(journey.journeyId);
    for (const transition of experienceCase.candidate.transitions.filter(
      (candidateTransition) =>
        candidateTransition.journeyId === journey.journeyId
        && beforeSuccess.has(candidateTransition.fromStateId)
        && !selectedTransitionIds.has(candidateTransition.id)
        && !recoveryTransitionIds.has(candidateTransition.id),
    )) {
      const action = indexes.actions.get(transition.candidateActionId);
      const contractAction = indexes.contractActions.get(
        action.contractActionId,
      );
      if (contractAction.mutation === 'none') {
        const decision = contractAction.decisionCost > 0
          || contractAction.optionCardinality !== 'none'
          || contractAction.grammarRole === 'mode_selector'
          || contractAction.interruption !== 'none';
        if (decision && !accepted.requiredActionIds.includes(contractAction.id)) {
          findings.add(
            'ED-DRIFT-001',
            `${journey.journeyId}:${transition.id}:off-path-decision`,
            `candidate.transitions.${transition.id}`,
            `Reachable decision ${contractAction.id} is absent from the accepted trace.`,
            'An alternate decision surface can add unreviewed modes or interruptions.',
            'Remove the decision branch or accept its intent in the Product trace.',
          );
        }
        continue;
      }
      findings.add(
        'ED-CONTRACT-001',
        `${journey.journeyId}:${transition.id}:off-path-mutation`,
        `candidate.transitions.${transition.id}`,
        `Mutating action ${contractAction.id} is reachable before success but absent from the selected success path.`,
        'Derived path cost and accepted commitments omit a reachable side effect.',
        'Include the transition in the contiguous success path or remove the reachable mutation.',
      );
    }
    const cost = derivePathCost(experienceCase, indexes, journey, ordered);
    derivedPathCosts[journey.journeyId] = cost;
    const budget = indexes.pathBudgets.get(journey.journeyId);
    for (const dimension of PATH_DIMENSIONS) {
      if (cost[dimension] > budget.max[dimension]) {
        findings.add(
          'ED-PATH-001',
          `${journey.journeyId}:${dimension}`,
          `candidate.journeys.${journey.journeyId}`,
          `${dimension}=${cost[dimension]} exceeds ${budget.max[dimension]}.`,
          'The Journey exceeds its accepted component-wise path budget.',
          `Reduce ${dimension} or amend the Journey budget with product evidence.`,
        );
      }
    }

    const trace = indexes.traces.get(journey.journeyId);
    const stateKinds = ordered.stateIds.map(
      (stateId) => indexes.states.get(stateId).kind,
    );
    const contractActionIds = ordered.transitions.map(
      (transition) =>
        indexes.actions.get(transition.candidateActionId).contractActionId,
    );
    if (
      !sameArray(stateKinds, accepted.orderedStateKinds)
      || !sameArray(contractActionIds, accepted.requiredActionIds)
    ) {
      findings.add(
        'ED-DRIFT-001',
        journey.journeyId,
        `candidate.journeys.${journey.journeyId}`,
        `Candidate states/actions are [${stateKinds.join(', ')}] / [${contractActionIds.join(', ')}], accepted trace is [${accepted.orderedStateKinds.join(', ')}] / [${accepted.requiredActionIds.join(', ')}].`,
        'The candidate inserts, removes, reorders, or changes accepted Journey commitments.',
        'Restore the accepted trace or amend the Product contract before prototyping.',
      );
    }
    const journeyStateIds = new Set(
      experienceCase.candidate.states
        .filter((state) => state.journeyId === journey.journeyId)
        .map((state) => state.id),
    );
    const journeyActionIds = new Set(
      experienceCase.candidate.transitions
        .filter((transition) => transition.journeyId === journey.journeyId)
        .map((transition) => transition.candidateActionId),
    );
    const traceViolations = [];
    if (trace.capabilityId !== accepted.capabilityId) {
      traceViolations.push('capability ID differs from accepted trace');
    }
    if (!includesAll(trace.stateIds, [...journeyStateIds])) {
      traceViolations.push('trace omits Journey states');
    }
    if (!includesAll(trace.actionIds, [...journeyActionIds])) {
      traceViolations.push('trace omits Journey actions');
    }
    const surfaceIds = new Set(
      [...journeyStateIds].map((stateId) => indexes.states.get(stateId).surfaceId),
    );
    if (!includesAll(trace.surfaceIds, [...surfaceIds])) {
      traceViolations.push('trace omits Journey surfaces');
    }
    if (trace.evidenceIds.length === 0 || trace.wireflowNodeIds.length === 0) {
      traceViolations.push('trace omits Wireflow or evidence links');
    }
    if (traceViolations.length > 0) {
      findings.add(
        'ED-TRACE-001',
        journey.journeyId,
        `candidate.traces.${journey.journeyId}`,
        traceViolations.join('; '),
        'Product-to-Wireflow-to-evidence trace is incomplete.',
        'Bind every Journey state, action, surface, Wireflow node, and evidence record.',
      );
    }
  }
  return derivedPathCosts;
}

function evaluateEvidence(
  experienceCase,
  loadedCase,
  findings,
  options,
) {
  const evidence = matchEvidenceRequirements(
    experienceCase.contract,
    experienceCase.candidate,
    {
      candidateDigest: loadedCase.digests.candidate,
      repoRoot: options.repoRoot,
    },
  );
  for (const requirementId of evidence.unmatched) {
    findings.add(
      'ED-EVIDENCE-001',
      requirementId,
      `contract.requiredEvidence.${requirementId}`,
      'No exact observed current-source evidence record matches this cell.',
      'The claimed platform, state, interaction, visual, or runtime behavior remains unproven.',
      'Collect an exact digest-bound evidence record or narrow the claim.',
    );
  }
  return evidence;
}

function dispositionFor(findings, ruleCatalog) {
  for (const severity of ruleCatalog.value.precedence) {
    const matching = findings.filter(
      (finding) => finding.severity === severity,
    );
    if (matching.length === 0) continue;
    const dispositions = new Set(
      matching.map(
        (finding) => ruleCatalog.rules.get(finding.ruleId).disposition,
      ),
    );
    if (dispositions.size !== 1) {
      fail(
        'ED_INTERNAL_ERROR',
        `rule catalog maps ${severity} findings to conflicting dispositions`,
      );
    }
    return [...dispositions][0];
  }
  return ruleCatalog.value.readyDisposition;
}

export function exitCodeForDisposition(disposition, ruleCatalog) {
  if (disposition === ruleCatalog.value.readyDisposition) {
    return ruleCatalog.value.readyExitCode;
  }
  const exits = [...ruleCatalog.rules.values()]
    .filter((rule) => rule.disposition === disposition)
    .map((rule) => rule.exitCode);
  return exits.length === 0 ? 1 : Math.max(...exits);
}

export function evaluateExperienceCase(
  loadedCase,
  {
    ruleCatalog,
    grammar,
    evaluatorVersionDigest,
    repoRoot = process.cwd(),
  },
) {
  if (
    typeof evaluatorVersionDigest !== 'string'
    || !/^sha256:[0-9a-f]{64}$/.test(evaluatorVersionDigest)
  ) {
    fail(
      'ED_INTERNAL_ERROR',
      'evaluation requires the exact control-plane source digest',
    );
  }
  const experienceCase = loadedCase.case;
  const indexes = indexCase(experienceCase);
  const findings = createFindingCollector(ruleCatalog);
  const options = {
    candidateDigest: loadedCase.digests.candidate,
    repoRoot: path.resolve(repoRoot),
  };

  evaluateSemantics(experienceCase, indexes, findings);
  evaluateInformationArchitecture(
    experienceCase,
    indexes,
    grammar,
    findings,
  );
  evaluateActions(
    experienceCase,
    indexes,
    grammar,
    findings,
    options,
  );
  evaluateStateAndRecovery(experienceCase, indexes, findings);
  const derivedPathCosts = evaluatePathAndTrace(
    experienceCase,
    indexes,
    findings,
  );
  const evidence = evaluateEvidence(
    experienceCase,
    loadedCase,
    findings,
    options,
  );
  const findingValues = findings.values();
  const disposition = dispositionFor(findingValues, ruleCatalog);

  return {
    kind: 'peers-touch-experience-findings',
    schemaVersion: 1,
    caseId: experienceCase.id,
    evaluatedAt: SOURCE_EVALUATED_AT,
    evaluatorVersionDigest: canonicalDigest({
      source: evaluatorVersionDigest,
      rules: ruleCatalog.digest,
      grammar: grammar.digest,
    }),
    caseDigest: loadedCase.digests.case,
    contractDigest: loadedCase.digests.contract,
    candidateDigest: loadedCase.digests.candidate,
    disposition,
    derivedPathCosts,
    findings: findingValues,
    unprovenEvidenceRequirementIds: evidence.unmatched,
  };
}

export function assertExpectedCalibration(result, expected) {
  const actualRuleIds = [...new Set(result.findings.map((item) => item.ruleId))]
    .sort();
  const actualFindingIds = result.findings.map((item) => item.id).sort();
  if (
    result.disposition !== expected.disposition
    || !equalStringSets(actualRuleIds, expected.expectedRuleIds)
    || !equalStringSets(actualFindingIds, expected.expectedFindingIds)
  ) {
    fail('CALIBRATION_INCOMPLETE', 'calibration expectation mismatch', {
      expected,
      actual: {
        disposition: result.disposition,
        expectedRuleIds: actualRuleIds,
        expectedFindingIds: actualFindingIds,
      },
    });
  }
}
