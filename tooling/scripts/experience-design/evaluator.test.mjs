import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertExpectedCalibration,
  evaluateExperienceCase,
} from './evaluator.mjs';
import {
  loadGrammar,
  loadRuleCatalog,
  validateExperienceCaseValue,
} from './schema.mjs';
import { controlPlaneVersionDigest } from './source-version.mjs';
import { createFixtureBundle } from './test-fixture.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../../..');
const ruleCatalog = loadRuleCatalog(
  path.join(
    REPO_ROOT,
    'docs/architecture/engineering/experience-design/rules.json',
  ),
);
const grammar = loadGrammar(
  path.join(
    REPO_ROOT,
    'docs/client/common/ui-identity/grammar-bindings.json',
  ),
);
const evaluatorVersionDigest = controlPlaneVersionDigest();

function evaluateBundle(_t, bundle) {
  const loaded = validateExperienceCaseValue(bundle.experienceCase, {
    ruleCatalog,
    grammar,
  });
  return evaluateExperienceCase(loaded, {
    ruleCatalog,
    grammar,
    evaluatorVersionDigest,
    repoRoot: REPO_ROOT,
  });
}

function ruleIds(result) {
  return [...new Set(result.findings.map((finding) => finding.ruleId))].sort();
}

test('clean case is ready for independent review, never passed', (t) => {
  const bundle = createFixtureBundle();
  const result = evaluateBundle(t, bundle);

  assert.equal(result.disposition, 'ready-for-independent-review');
  assert.deepEqual(result.findings, []);
  assert.notEqual(result.disposition, 'passed');
  assertExpectedCalibration(result, bundle.experienceCase.expected);
});

test('semantic repetition is concept-scoped rather than lexical', (t) => {
  const bundle = createFixtureBundle({
    calibration: 'negative',
    mutate: ({ candidate }) => {
      candidate.copyNodes.push({
        id: 'copy.same-meaning',
        surfaceId: 'surface.connect',
        scope: 'scope.connect',
        conceptId: 'concept.connect',
        role: 'title',
        text: 'Choose the account that should become connected',
      });
    },
  });

  const result = evaluateBundle(t, bundle);

  assert.deepEqual(ruleIds(result), ['ED-SEM-001']);
});

test('legal accessibility repetition remains clean at the boundary', (t) => {
  const bundle = createFixtureBundle({
    calibration: 'boundary',
    mutate: ({ candidate }) => {
      candidate.copyNodes.push({
        id: 'copy.accessible-name',
        surfaceId: 'surface.connect',
        scope: 'scope.connect',
        conceptId: 'concept.connect',
        role: 'accessible-name',
        text: 'Connect account',
        exceptionReason: 'accessibility',
      });
    },
  });

  const result = evaluateBundle(t, bundle);

  assert.equal(result.disposition, 'ready-for-independent-review');
  assert.deepEqual(result.findings, []);
});

test('information architecture detects a changed main subject', (t) => {
  const bundle = createFixtureBundle({
    calibration: 'negative',
    mutate: ({ candidate }) => {
      candidate.surfaces[0].mainSubjectIds = ['subject.other'];
    },
  });

  assert.deepEqual(ruleIds(evaluateBundle(t, bundle)), ['ED-IA-001']);
});

test('path budget compares every derived dimension independently', (t) => {
  const bundle = createFixtureBundle({
    calibration: 'negative',
    mutate: ({ contract }) => {
      contract.pathBudgets[0].max.decisionLoad = 0;
    },
  });
  const result = evaluateBundle(t, bundle);

  assert.deepEqual(ruleIds(result), ['ED-PATH-001']);
  assert.equal(result.derivedPathCosts['journey.connect'].decisionLoad, 1);
});

test('state evaluation detects a required unreachable state', (t) => {
  const bundle = createFixtureBundle({
    calibration: 'negative',
    mutate: ({ contract }) => {
      contract.stateRequirements[0].requiredKinds.push('failure');
    },
  });

  assert.deepEqual(ruleIds(evaluateBundle(t, bundle)), ['ED-STATE-001']);
});

test('action evaluation binds confirmation to the accepted tuple', (t) => {
  const bundle = createFixtureBundle({
    calibration: 'negative',
    mutate: ({ candidate }) => {
      candidate.actions[0].confirmation = 'user-confirmed';
    },
  });

  assert.deepEqual(ruleIds(evaluateBundle(t, bundle)), ['ED-ACTION-001']);
});

test('equivalent surfaces require exactly one action candidate each', (t) => {
  const bundle = createFixtureBundle({
    calibration: 'negative',
    mutate: ({ contract, candidate }) => {
      contract.informationArchitecture.surfaces.push({
        id: 'surface.connect-secondary',
        contextId: 'context.setup',
        mainSubjectId: 'subject.connection',
        allowedRegionRoles: ['content', 'action'],
      });
      contract.actions[0].equivalentSurfaceIds.push(
        'surface.connect-secondary',
      );
      candidate.surfaces.push({
        id: 'surface.connect-secondary',
        contextId: 'context.setup',
        mainSubjectIds: ['subject.connection'],
        regions: [
          {
            id: 'region.secondary-content',
            role: 'content',
            supportsSubjectId: 'subject.connection',
          },
        ],
      });
      candidate.traces[0].surfaceIds.push('surface.connect-secondary');
    },
  });

  assert.deepEqual(ruleIds(evaluateBundle(t, bundle)), ['ED-ACTION-001']);
});

test('unknown action roles fail through UI Grammar ownership', (t) => {
  const bundle = createFixtureBundle({
    calibration: 'negative',
    mutate: ({ contract, candidate }) => {
      contract.actions[0].grammarRole = 'unregistered_role';
      candidate.actions[0].grammarRole = 'unregistered_role';
    },
  });

  assert.deepEqual(ruleIds(evaluateBundle(t, bundle)), ['ED-GRAMMAR-001']);
});

test('a disconnected success chain is rejected at the case boundary', () => {
  const bundle = createFixtureBundle({
    calibration: 'negative',
    mutate: ({ candidate }) => {
      candidate.transitions[0].fromStateId = 'state.success';
    },
  });
  assert.throws(() => validateExperienceCaseValue(bundle.experienceCase, {
    ruleCatalog,
    grammar,
  }), (error) => error.code === 'ED-CONTRACT-001');
});

test('reachable mutating branches cannot hide outside the costed success path', (t) => {
  const bundle = createFixtureBundle({
    calibration: 'negative',
    mutate: ({ contract, candidate }) => {
      contract.actions.push({
        ...structuredClone(contract.actions[0]),
        id: 'action.hidden-mutation',
        grammarRole: 'secondary_command',
        allowedPlatformAdapters: {
          desktop: ['inline-action'],
          mobile: ['inline-action'],
          browser: ['inline-action'],
          dashboard: ['inline-action'],
        },
      });
      candidate.actions.push({
        ...structuredClone(candidate.actions[0]),
        id: 'candidate-action.hidden-mutation',
        contractActionId: 'action.hidden-mutation',
        grammarRole: 'secondary_command',
        representation: 'text-action',
        platformAdapter: 'inline-action',
        primary: false,
      });
      candidate.transitions.push({
        id: 'transition.hidden-mutation',
        journeyId: 'journey.connect',
        fromStateId: 'state.entry',
        toStateId: 'state.success',
        candidateActionId: 'candidate-action.hidden-mutation',
        preserves: [],
        authoritativeReadback: false,
      });
      candidate.traces[0].actionIds.push(
        'candidate-action.hidden-mutation',
      );
    },
  });
  const result = evaluateBundle(t, bundle);

  assert.ok(ruleIds(result).includes('ED-CONTRACT-001'));
});

test('recovery branches cannot exist outside reachable failure ownership', (t) => {
  const bundle = createFixtureBundle({
    calibration: 'negative',
    mutate: ({ candidate }) => {
      candidate.recoveryBranches.push({
        sourceStateId: 'state.entry',
        recoveryTransitionId: 'transition.connect',
        recoveryActionCandidateId: 'candidate-action.connect',
        preserves: [],
        focusTargetId: 'focus.connect',
        returnStateId: 'state.success',
      });
    },
  });

  assert.deepEqual(ruleIds(evaluateBundle(t, bundle)), ['ED-STATE-001']);
});

test('unmatched exact evidence remains unproven', (t) => {
  const bundle = createFixtureBundle({
    calibration: 'boundary',
    mutateEvidence: ({ candidate }) => {
      candidate.evidence[0].status = 'unproven';
    },
  });
  const result = evaluateBundle(t, bundle);

  assert.equal(result.disposition, 'unproven');
  assert.deepEqual(ruleIds(result), ['ED-EVIDENCE-001']);
});

test('inserted state and action are contract drift', (t) => {
  const bundle = createFixtureBundle({
    calibration: 'negative',
    mutate: ({ contract, candidate }) => {
      contract.pathBudgets[0].max.decisionLoad = 2;
      contract.actions.push({
        id: 'action.choose-mode',
        intent: 'Choose a connection mode',
        risk: 'routine',
        frequency: 'rare',
        mutation: 'none',
        optionCardinality: 'multiple',
        canonicalIconMeaning: false,
        repeatedTool: false,
        reversible: true,
        decisionCost: 1,
        interruption: 'none',
        confirmationPolicy: 'none',
        grammarRole: 'mode_selector',
        allowedPlatformAdapters: {
          desktop: ['tabs'],
          mobile: ['tabs'],
          browser: ['tabs'],
          dashboard: ['tabs'],
        },
        equivalentSurfaceIds: ['surface.connect'],
      });
      candidate.actions.push({
        id: 'candidate-action.inserted',
        contractActionId: 'action.choose-mode',
        surfaceId: 'surface.connect',
        grammarRole: 'mode_selector',
        representation: 'tabs',
        platformAdapter: 'tabs',
        primary: false,
        accessibleLabel: 'Choose connection mode',
        confirmation: 'none',
      });
      candidate.states.push({
        id: 'state.inserted',
        journeyId: 'journey.connect',
        surfaceId: 'surface.connect',
        kind: 'waiting',
        visibleMeaning: 'An unaccepted decision is inserted',
      });
      candidate.transitions[0].toStateId = 'state.inserted';
      candidate.transitions.push({
        id: 'transition.inserted',
        journeyId: 'journey.connect',
        fromStateId: 'state.inserted',
        toStateId: 'state.success',
        candidateActionId: 'candidate-action.inserted',
        preserves: [],
        authoritativeReadback: false,
      });
      candidate.journeys[0].steps.push({
        id: 'step.inserted',
        transitionId: 'transition.inserted',
      });
      candidate.traces[0].stateIds.push('state.inserted');
      candidate.traces[0].actionIds.push('candidate-action.inserted');
    },
  });

  assert.deepEqual(ruleIds(evaluateBundle(t, bundle)), ['ED-DRIFT-001']);
});

test('evaluation output is deterministic for the same inputs', (t) => {
  const bundle = createFixtureBundle();
  const first = evaluateBundle(t, bundle);
  const second = evaluateBundle(t, bundle);

  assert.deepEqual(second, first);
});
