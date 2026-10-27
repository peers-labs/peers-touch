import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ExperienceDesignError } from './canonical.mjs';
import { evaluateExperienceCase } from './evaluator.mjs';
import {
  loadGrammar,
  loadRuleCatalog,
  validateExperienceCaseValue,
} from './schema.mjs';
import { controlPlaneVersionDigest } from './source-version.mjs';
import { createFixtureBundle } from './test-fixture.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../../..');
const sources = {
  ruleCatalog: loadRuleCatalog(
    path.join(
      REPO_ROOT,
      'docs/architecture/engineering/experience-design/rules.json',
    ),
  ),
  grammar: loadGrammar(
    path.join(
      REPO_ROOT,
      'docs/client/common/ui-identity/grammar-bindings.json',
    ),
  ),
};
const evaluatorVersionDigest = controlPlaneVersionDigest();

function evaluateBundle(bundle) {
  const loaded = validateExperienceCaseValue(bundle.experienceCase, sources);
  return evaluateExperienceCase(loaded, {
    ...sources,
    evaluatorVersionDigest,
    repoRoot: REPO_ROOT,
  });
}

function ruleIds(result) {
  return [...new Set(result.findings.map((finding) => finding.ruleId))].sort();
}

function assertBlockedBy(result, expectedRuleIds) {
  assert.equal(result.disposition, 'changes-required');
  assert.deepEqual(ruleIds(result), [...expectedRuleIds].sort());
  assert.deepEqual(result.unprovenEvidenceRequirementIds, []);
}

function assertClean(result) {
  assert.equal(result.disposition, 'ready-for-independent-review');
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.unprovenEvidenceRequirementIds, []);
}

function assertPathCost(result, decisionLoad = 1) {
  assert.deepEqual(result.derivedPathCosts, {
    'journey.connect': {
      commitments: 0,
      contextSwitches: 0,
      decisionLoad,
      interruptions: 0,
      recoveryDebt: 0,
    },
  });
}

function assertContractRejected(bundle) {
  let result;
  try {
    result = evaluateBundle(bundle);
  } catch (error) {
    assert.ok(error instanceof ExperienceDesignError);
    assert.equal(error.code, 'ED-CONTRACT-001');
    return;
  }
  assertBlockedBy(result, ['ED-CONTRACT-001']);
}

function adapters(...ids) {
  return Object.fromEntries(
    ['desktop', 'mobile', 'browser', 'dashboard'].map(
      (platform) => [platform, [...ids]],
    ),
  );
}

function addSupportingAction(
  { contract, candidate },
  name,
  {
    grammarRole = 'secondary_command',
    representation = 'text-action',
    adapter = 'inline-action',
    contractFields = {},
  } = {},
) {
  const contractAction = {
    ...structuredClone(contract.actions[0]),
    id: `action.${name}`,
    intent: `Perform ${name}`,
    mutation: 'none',
    optionCardinality: 'none',
    decisionCost: 0,
    interruption: 'none',
    confirmationPolicy: 'none',
    grammarRole,
    allowedPlatformAdapters: adapters(adapter),
    equivalentSurfaceIds: ['surface.connect'],
    ...contractFields,
  };
  const candidateAction = {
    ...structuredClone(candidate.actions[0]),
    id: `candidate-action.${name}`,
    contractActionId: contractAction.id,
    grammarRole,
    representation,
    platformAdapter: adapter,
    primary: false,
    accessibleLabel: `Perform ${name}`,
    confirmation: 'none',
  };
  contract.actions.push(contractAction);
  candidate.actions.push(candidateAction);
  candidate.traces[0].actionIds.push(candidateAction.id);
  return { contractAction, candidateAction };
}

function addReachableBranch(
  mutable,
  name,
  actionOptions = {},
  fromStateId = 'state.entry',
) {
  const { candidate } = mutable;
  const action = addSupportingAction(mutable, name, actionOptions);
  const stateId = `state.${name}`;
  candidate.states.push({
    ...structuredClone(candidate.states[0]),
    id: stateId,
    kind: 'waiting',
    visibleMeaning: `The ${name} branch is visible`,
  });
  candidate.transitions.push(
    {
      ...structuredClone(candidate.transitions[0]),
      id: `transition.${name}-out`,
      fromStateId,
      toStateId: stateId,
      candidateActionId: action.candidateAction.id,
    },
    {
      ...structuredClone(candidate.transitions[0]),
      id: `transition.${name}-return`,
      fromStateId: stateId,
      toStateId: 'state.success',
      candidateActionId: action.candidateAction.id,
    },
  );
  candidate.traces[0].stateIds.push(stateId);
  candidate.traces[0].wireflowNodeIds.push(`wireflow.${name}`);
  return action;
}

const MODE_ACTION = {
  grammarRole: 'mode_selector',
  representation: 'tabs',
  adapter: 'tabs',
  contractFields: { optionCardinality: 'multiple', decisionCost: 2 },
};

test('confirmation obeys both canonical grammar and accepted action policy', async (t) => {
  for (const scenario of [
    {
      role: 'mode_selector',
      representation: 'tabs',
      adapter: 'tabs',
      optionCardinality: 'multiple',
      iconTool: false,
    },
    {
      role: 'icon_tool',
      representation: 'icon-button',
      adapter: 'toolbar-icon',
      optionCardinality: 'none',
      iconTool: true,
    },
  ]) {
    await t.test(`${scenario.role} rejects user confirmation despite required contract policy`, () => {
      assert.equal(
        sources.grammar.actionRoles.get(scenario.role).confirmation,
        'none',
      );
      const bundle = createFixtureBundle({
        calibration: 'negative',
        mutate: ({ contract, candidate }) => {
          Object.assign(contract.actions[0], {
            mutation: 'none',
            grammarRole: scenario.role,
            optionCardinality: scenario.optionCardinality,
            canonicalIconMeaning: scenario.iconTool,
            repeatedTool: scenario.iconTool,
            confirmationPolicy: 'required',
            allowedPlatformAdapters: adapters(scenario.adapter),
          });
          Object.assign(candidate.actions[0], {
            grammarRole: scenario.role,
            representation: scenario.representation,
            platformAdapter: scenario.adapter,
            primary: false,
            confirmation: 'user-confirmed',
          });
          if (scenario.iconTool) candidate.actions[0].tooltip = 'Connect account';
        },
      });

      const result = evaluateBundle(bundle);
      assertBlockedBy(result, ['ED-ACTION-001']);
      assert.ok(result.findings.some(
        (finding) => finding.location === 'candidate.actions.candidate-action.connect',
      ));
    });
  }

  await t.test('mode selector with no confirmation remains legal', () => {
    const bundle = createFixtureBundle({
      mutate: ({ contract, candidate }) => {
        Object.assign(contract.actions[0], {
          mutation: 'none',
          grammarRole: 'mode_selector',
          optionCardinality: 'multiple',
          allowedPlatformAdapters: adapters('tabs'),
        });
        Object.assign(candidate.actions[0], {
          grammarRole: 'mode_selector',
          representation: 'tabs',
          platformAdapter: 'tabs',
          primary: false,
        });
      },
    });

    const result = evaluateBundle(bundle);
    assertClean(result);
    assertPathCost(result);
  });

  await t.test('contract-owned grammar permits explicitly required confirmation', () => {
    const bundle = createFixtureBundle({
      mutate: ({ contract, candidate }) => {
        contract.actions[0].confirmationPolicy = 'required';
        candidate.actions[0].confirmation = 'user-confirmed';
      },
    });

    assertClean(evaluateBundle(bundle));
  });
});

function addEquivalentSurface({ contract, candidate }, differingAdapter) {
  contract.informationArchitecture.surfaces.push({
    ...structuredClone(contract.informationArchitecture.surfaces[0]),
    id: 'surface.secondary',
  });
  candidate.surfaces.push({
    ...structuredClone(candidate.surfaces[0]),
    id: 'surface.secondary',
  });
  contract.actions[0].equivalentSurfaceIds.push('surface.secondary');
  contract.actions[0].allowedPlatformAdapters.desktop.push('header-action');
  candidate.actions.push({
    ...structuredClone(candidate.actions[0]),
    id: 'candidate-action.secondary',
    surfaceId: 'surface.secondary',
    platformAdapter: differingAdapter ? 'header-action' : 'form-submit',
  });
  candidate.traces[0].surfaceIds.push('surface.secondary');
  candidate.traces[0].actionIds.push('candidate-action.secondary');
  contract.platformDifferences.push({
    actionContractId: 'action.connect',
    left: {
      platform: 'mobile',
      surfaceId: 'surface.connect',
      representation: 'text-primary-button',
      adapter: 'form-submit',
    },
    right: {
      platform: 'browser',
      surfaceId: 'surface.secondary',
      representation: 'text-primary-button',
      adapter: 'header-action',
    },
    rationale: 'Only mobile and browser adaptation was accepted',
  });
}

test('platform differences cannot waive another platform equivalent-surface tuple', async (t) => {
  for (const reverse of [false, true]) {
    await t.test(`desktop adapter mismatch is rejected with ${reverse ? 'reversed' : 'forward'} mobile/browser difference`, () => {
      const bundle = createFixtureBundle({
        calibration: 'negative',
        mutate: (mutable) => {
          addEquivalentSurface(mutable, true);
          if (reverse) {
            const difference = mutable.contract.platformDifferences[0];
            [difference.left, difference.right] = [
              difference.right,
              difference.left,
            ];
          }
        },
      });

      const result = evaluateBundle(bundle);
      assertBlockedBy(result, ['ED-ACTION-001']);
      assert.ok(result.findings.some(
        (finding) =>
          finding.location === 'candidate.actions[contractActionId=action.connect]',
      ));
      assertPathCost(result);
    });
  }

  await t.test('consistent desktop adapters need no cross-platform waiver', () => {
    const bundle = createFixtureBundle({
      mutate: (mutable) => addEquivalentSurface(mutable, false),
    });

    const result = evaluateBundle(bundle);
    assertClean(result);
    assertPathCost(result);
  });
});

test('reachable off-selected choices honor accepted intent without inflating selected-chain cost', async (t) => {
  const baseline = evaluateBundle(createFixtureBundle());
  assertClean(baseline);

  for (const scenario of [
    { name: 'mode-choice', options: MODE_ACTION },
    {
      name: 'decision-load',
      options: { contractFields: { decisionCost: 2 } },
    },
    {
      name: 'zero-cost-options',
      options: {
        grammarRole: 'option_selector',
        representation: 'select',
        adapter: 'select',
        contractFields: { optionCardinality: 'multiple' },
      },
    },
    {
      name: 'zero-cost-mode',
      options: {
        ...MODE_ACTION,
        contractFields: { optionCardinality: 'multiple', decisionCost: 0 },
      },
    },
    ...['permission', 'authentication', 'setup'].map((interruption) => ({
      name: `${interruption}-interruption`,
      options: { contractFields: { interruption } },
    })),
  ]) {
    await t.test(`unaccepted ${scenario.name} emits drift while success cost is unchanged`, () => {
      const bundle = createFixtureBundle({
        calibration: 'negative',
        mutate: (mutable) => {
          addReachableBranch(mutable, scenario.name, scenario.options);
        },
      });

      const result = evaluateBundle(bundle);
      assertBlockedBy(result, ['ED-DRIFT-001']);
      assert.deepEqual(result.derivedPathCosts, baseline.derivedPathCosts);
      assertPathCost(result);
    });
  }

  await t.test('zero-decision non-mutating navigation is a legal supporting branch', () => {
    const bundle = createFixtureBundle({
      mutate: (mutable) => {
        addReachableBranch(mutable, 'navigation', {
          grammarRole: 'navigation_back',
          representation: 'icon-text-button',
          adapter: 'header-back',
          contractFields: {
            canonicalIconMeaning: true,
            repeatedTool: true,
          },
        });
      },
    });

    const result = evaluateBundle(bundle);
    assertClean(result);
    assert.deepEqual(result.derivedPathCosts, baseline.derivedPathCosts);
  });

  await t.test('accepted mode intent permits an off-selected equivalent transition', () => {
    const bundle = createFixtureBundle({
      mutate: (mutable) => {
        const { contract, candidate } = mutable;
        const mode = addSupportingAction(mutable, 'mode', MODE_ACTION);
        candidate.states.push({
          ...structuredClone(candidate.states[0]),
          id: 'state.mode',
          kind: 'waiting',
          visibleMeaning: 'The accepted mode is selected',
        });
        candidate.transitions[0].fromStateId = 'state.mode';
        for (const name of ['selected-mode', 'alternate-mode']) {
          candidate.transitions.push({
            ...structuredClone(candidate.transitions[0]),
            id: `transition.${name}`,
            fromStateId: 'state.entry',
            toStateId: 'state.mode',
            candidateActionId: mode.candidateAction.id,
          });
        }
        candidate.journeys[0].steps.unshift({
          id: 'step.mode',
          transitionId: 'transition.selected-mode',
        });
        candidate.traces[0].stateIds.push('state.mode');
        candidate.traces[0].wireflowNodeIds.push('wireflow.mode');
        contract.acceptedTrace[0].orderedStateKinds = [
          'entry', 'waiting', 'success',
        ];
        contract.acceptedTrace[0].requiredActionIds = [
          mode.contractAction.id, 'action.connect',
        ];
        contract.pathBudgets[0].max.decisionLoad = 3;
      },
    });

    const result = evaluateBundle(bundle);
    assertClean(result);
    assertPathCost(result, 3);
  });

  await t.test('preserving failure recovery may own decision and interruption cost off the success chain', () => {
    const bundle = createFixtureBundle({
      mutate: (mutable) => {
        const { contract, candidate } = mutable;
        const failure = addSupportingAction(mutable, 'failure');
        const retry = addSupportingAction(mutable, 'retry', {
          grammarRole: 'recovery_action',
          adapter: 'inline-recovery',
          contractFields: {
            mutation: 'local',
            decisionCost: 2,
            interruption: 'authentication',
          },
        });
        candidate.states.push({
          ...structuredClone(candidate.states[0]),
          id: 'state.failure',
          kind: 'failure',
          visibleMeaning: 'Connection failed; account input is preserved',
        });
        candidate.transitions.push(
          {
            ...structuredClone(candidate.transitions[0]),
            id: 'transition.failure',
            toStateId: 'state.failure',
            candidateActionId: failure.candidateAction.id,
          },
          {
            ...structuredClone(candidate.transitions[0]),
            id: 'transition.retry',
            fromStateId: 'state.failure',
            toStateId: 'state.entry',
            candidateActionId: retry.candidateAction.id,
            preserves: ['input.account'],
          },
        );
        candidate.recoveryBranches.push({
          sourceStateId: 'state.failure',
          recoveryTransitionId: 'transition.retry',
          recoveryActionCandidateId: retry.candidateAction.id,
          preserves: ['input.account'],
          focusTargetId: 'focus.account',
          returnStateId: 'state.entry',
        });
        candidate.traces[0].stateIds.push('state.failure');
        candidate.traces[0].wireflowNodeIds.push('wireflow.failure');
        contract.stateRequirements[0].requiredKinds.push('failure');
        contract.stateRequirements[0].preserveOnFailure = ['input.account'];
        contract.stateRequirements[0].recoveryRequirements.push({
          sourceKind: 'failure',
          allowedRecoveryActionContractIds: [retry.contractAction.id],
          requiredFocusTargetId: 'focus.account',
          allowedReturnKinds: ['entry'],
          requiresAuthorityReconciliation: false,
        });
      },
    });

    const result = evaluateBundle(bundle);
    assertClean(result);
    assert.deepEqual(result.derivedPathCosts, baseline.derivedPathCosts);
  });

  await t.test('a reachable mode choice only after success is not pre-success drift', () => {
    const bundle = createFixtureBundle({
      mutate: (mutable) => {
        addReachableBranch(
          mutable, 'post-success-mode', MODE_ACTION, 'state.success',
        );
      },
    });

    const result = evaluateBundle(bundle);
    assertClean(result);
    assert.deepEqual(result.derivedPathCosts, baseline.derivedPathCosts);
  });
});

test('trace membership does not make disconnected graph material reachable', async (t) => {
  for (const selfLoop of [false, true]) {
    await t.test(`disconnected waiting state ${selfLoop ? 'with a self-loop' : 'without transitions'} is rejected`, () => {
      const bundle = createFixtureBundle({
        calibration: 'negative',
        mutate: ({ candidate }) => {
          candidate.states.push({
            ...structuredClone(candidate.states[0]),
            id: 'state.orphan',
            kind: 'waiting',
            visibleMeaning: 'This state has no path from entry',
          });
          candidate.traces[0].stateIds.push('state.orphan');
          candidate.traces[0].wireflowNodeIds.push('wireflow.orphan');
          if (selfLoop) {
            candidate.transitions.push({
              ...structuredClone(candidate.transitions[0]),
              id: 'transition.orphan',
              fromStateId: 'state.orphan',
              toStateId: 'state.orphan',
            });
          }
        },
      });

      assertContractRejected(bundle);
    });
  }
});

test('ordered state kinds are phases while selected-path cycle checks use stable IDs', async (t) => {
  await t.test('accepted trace still requires at least entry and result phases', () => {
    const bundle = createFixtureBundle({
      mutate: ({ contract }) => {
        contract.acceptedTrace[0].orderedStateKinds = ['entry'];
      },
    });
    assert.throws(
      () => validateExperienceCaseValue(bundle.experienceCase, sources),
      (error) => error.code === 'ED-CONTRACT-001',
    );
  });

  await t.test('acyclic entry/loading/waiting/loading/success with distinct IDs is accepted', () => {
    const kinds = ['entry', 'loading', 'waiting', 'loading', 'success'];
    const bundle = createFixtureBundle({
      mutate: (mutable) => {
        const { contract, candidate } = mutable;
        const phases = [
          { name: 'discover', kind: 'loading' },
          { name: 'choose', kind: 'waiting' },
          { name: 'connect', kind: 'loading' },
        ];
        const phaseStateIds = phases.map(
          (phase) => `state.phase-${phase.name}`,
        );
        candidate.states.splice(
          1,
          0,
          ...phases.map((phase, index) => ({
            ...structuredClone(candidate.states[0]),
            id: phaseStateIds[index],
            kind: phase.kind,
            visibleMeaning: `Connection ${phase.name} phase`,
          })),
        );
        candidate.transitions[0].toStateId = phaseStateIds[0];
        const actionIds = ['action.connect'];
        for (let index = 0; index < phases.length; index += 1) {
          const phase = phases[index];
          const action = addSupportingAction(
            mutable,
            `phase-${phase.name}`,
            { contractFields: { mutation: 'local', decisionCost: 1 } },
          );
          const transitionId = `transition.phase-${phase.name}`;
          candidate.transitions.push({
            ...structuredClone(candidate.transitions[0]),
            id: transitionId,
            fromStateId: phaseStateIds[index],
            toStateId: phaseStateIds[index + 1] ?? 'state.success',
            candidateActionId: action.candidateAction.id,
          });
          candidate.journeys[0].steps.push({
            id: `step.phase-${phase.name}`,
            transitionId,
          });
          actionIds.push(action.contractAction.id);
        }
        candidate.traces[0].stateIds.push(...phaseStateIds);
        candidate.traces[0].wireflowNodeIds.push(
          ...phases.map((phase) => `wireflow.phase-${phase.name}`),
        );
        contract.acceptedTrace[0].orderedStateKinds = [...kinds];
        contract.acceptedTrace[0].requiredActionIds = actionIds;
        contract.stateRequirements[0].requiredKinds.push('loading', 'waiting');
        contract.pathBudgets[0].max.decisionLoad = 4;
      },
    });

    const loaded = validateExperienceCaseValue(bundle.experienceCase, sources);
    assert.deepEqual(loaded.case.contract.acceptedTrace[0].orderedStateKinds, kinds);
    assert.equal(
      new Set(loaded.case.candidate.states.map((state) => state.id)).size,
      5,
    );
    const result = evaluateBundle(bundle);
    assertClean(result);
    assertPathCost(result, 4);
  });

  await t.test('returning to the same state ID still rejects a selected success cycle', () => {
    const bundle = createFixtureBundle({
      calibration: 'negative',
      mutate: ({ contract, candidate }) => {
        candidate.states.push({
          ...structuredClone(candidate.states[0]),
          id: 'state.waiting',
          kind: 'waiting',
          visibleMeaning: 'The path will return to the same entry state',
        });
        candidate.transitions.push(
          {
            ...structuredClone(candidate.transitions[0]),
            id: 'transition.wait',
            toStateId: 'state.waiting',
          },
          {
            ...structuredClone(candidate.transitions[0]),
            id: 'transition.back',
            fromStateId: 'state.waiting',
            toStateId: 'state.entry',
          },
        );
        candidate.journeys[0].steps.unshift(
          { id: 'step.wait', transitionId: 'transition.wait' },
          { id: 'step.back', transitionId: 'transition.back' },
        );
        candidate.traces[0].stateIds.push('state.waiting');
        candidate.traces[0].wireflowNodeIds.push('wireflow.waiting');
        contract.pathBudgets[0].max.decisionLoad = 3;
      },
    });

    const result = evaluateBundle(bundle);
    assertBlockedBy(result, ['ED-DRIFT-001', 'ED-TRACE-001']);
    assert.ok(result.findings.some(
      (finding) => finding.ruleId === 'ED-TRACE-001' && /cycle/.test(finding.observed),
    ));
  });
});
