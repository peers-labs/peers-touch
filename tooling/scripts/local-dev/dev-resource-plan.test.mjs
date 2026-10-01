import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  MODULE_IMPACT_KIND,
  RESOURCE_REQUEST_KIND,
  RESOURCE_RESULT_KIND,
  ResourcePlanError,
  buildPlanResourcePlan,
  prepareDevelopmentResources,
  readPlanResourceReceipt,
  recordDevelopmentResourceResult,
  statusDevelopmentResources,
  validatePreparedResourceClaim,
} from './dev-resource-plan.mjs';
import { DevWorkError } from './dev-work-schema.mjs';

function digest(character) {
  return `sha256:${character.repeat(64)}`;
}

function requirement(overrides = {}) {
  return {
    requirementId: 'station-runtime',
    resourceKind: 'service',
    quantity: 1,
    mode: 'shared',
    lifecycleScope: 'task',
    isolationKey: 'station-runtime',
    compatibilityKey: 'station-linux',
    reusePolicy: 'BUILD_IF_SOURCE_DRIFT',
    readinessProbe: {
      kind: 'owner',
      ref: 'station-check',
    },
    mandatory: true,
    candidateIds: [],
    expectedDigests: {
      source: digest('1'),
      artifact: digest('2'),
      runtime: digest('3'),
    },
    ...overrides,
  };
}

function impact(moduleId, targetSelectors, overrides = {}) {
  return {
    kind: MODULE_IMPACT_KIND,
    schemaVersion: 1,
    moduleId,
    state: 'DECIDED',
    changedPaths: [`modules/${moduleId}/source.ts`],
    changeKinds: ['RUNTIME'],
    moduleDependencies: [],
    requirements: {
      focusedCheckSelectors: [`${moduleId}-check`],
      targetSelectors,
      journeySelectors: [`${moduleId}-journey`],
      gateSelectors: [`${moduleId}-gate`],
      resourceRequirements: [],
    },
    classification: {},
    proof: {
      action: 'REPROVE_REQUIRED',
    },
    ...overrides,
  };
}

function target(targetId, resourceRequirements = [], overrides = {}) {
  return {
    targetId,
    dependsOn: [],
    focusedCheckSelectors: [`${targetId}-check`],
    journeySelectors: [],
    gateSelectors: [],
    resourceRequirements,
    ...overrides,
  };
}

function resource(resourceId, overrides = {}) {
  return {
    resourceId,
    resourceKind: 'service',
    compatibilityKey: 'station-linux',
    state: 'HEALTHY',
    capacity: 1,
    reusable: true,
    provisionable: true,
    owner: 'runtime-owner',
    manifestRef: `runtime://${resourceId}`,
    digests: {
      source: digest('1'),
      artifact: digest('2'),
      runtime: digest('3'),
    },
    ...overrides,
  };
}

function request(overrides = {}) {
  return {
    kind: RESOURCE_REQUEST_KIND,
    schemaVersion: 1,
    planId: 'PLAN-1',
    taskId: 'TASK-1',
    source: {
      commit: 'a'.repeat(40),
      workspaceDigest: digest('a'),
    },
    satisfiedModuleIds: [],
    moduleImpacts: [impact('agent', ['station'])],
    targets: [target('station', [requirement()])],
    inventory: [resource('station-four')],
    ...overrides,
  };
}

function sourceIdentity() {
  return {
    commit: 'a'.repeat(40),
    workspaceDigest: digest('a'),
    stable: true,
  };
}

function activeDeclaration(overrides = {}) {
  return {
    declarationId: 'WORK-1-0123456789abcdef',
    workItemId: 'WORK-1',
    sessionId: 'SESSION-1',
    workspaceId: '0123456789abcdef',
    branch: 'feat/test',
    sourceHead: 'a'.repeat(40),
    owner: 'owner@example.invalid',
    purpose: 'test resource planning',
    journeyId: 'DEV-J04',
    state: 'ACTIVE',
    sourceClaims: [
      {
        mode: 'exclusive-write',
        pathPrefix: 'tooling/scripts/local-dev',
      },
    ],
    runtimeClaims: [],
    planPath: 'docs/plan.md',
    planId: 'PLAN-1',
    taskId: 'TASK-1',
    ...overrides,
  };
}

function expectCode(code, operation) {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof ResourcePlanError);
    assert.equal(error.code, code);
    return true;
  });
}

test('single module resolves target requirements and reuses healthy runtime', () => {
  const plan = buildPlanResourcePlan(request());

  assert.equal(plan.allocationState, 'READY');
  assert.deepEqual(plan.selectedTargetIds, ['station']);
  assert.deepEqual(plan.executionWaves, [['station']]);
  assert.deepEqual(plan.runtimeClaims, [
    {
      kind: 'service',
      resourceId: 'station-four',
      mode: 'shared',
    },
  ]);
  assert.equal(plan.resourceResults[0].action, 'REUSE');
  assert.equal(plan.resourceResults[0].status, 'PENDING');
  assert.equal(plan.proofAction, 'REPROVE_REQUIRED');
  assert.equal(plan.acquisition.reservation, 'atomic-per-target');
  assert.equal(plan.acquisition.holdAndWait, 'forbidden');
  assert.equal(plan.acquisition.gatePolicy, 'attach-only');
});

test('healthy reuse remains pending until its runtime owner confirms it', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pt-resource-reuse-owner-'));
  const home = path.join(root, 'home');
  const workspaceRoot = path.join(root, 'workspace');
  const receiptFile = path.join(root, 'resource-plan.json');
  mkdirSync(home);
  mkdirSync(workspaceRoot);
  const declaration = activeDeclaration();
  const dependencies = {
    requireActiveDeclaration: () => declaration,
    inspectGitWorkspace: sourceIdentity,
    startOrUpdateDeclaration: (options) => {
      declaration.runtimeClaims = options.runtimeClaims
        .split(';')
        .filter(Boolean)
        .map((claim) => {
          const [mode, kind, resourceId] = claim.split(':');
          return { kind, resourceId, mode };
        });
      return {
        ...declaration,
        declarationDigest: digest('d').slice('sha256:'.length),
      };
    },
    now: new Date('2026-10-01T00:00:00.000Z'),
  };
  try {
    const options = {
      home,
      workspaceRoot,
      workItemId: 'WORK-1',
      sessionId: 'SESSION-1',
      resourcePlanFile: receiptFile,
      resourceRequest: request(),
    };
    const prepared = prepareDevelopmentResources(options, dependencies);

    assert.equal(prepared.resourceResults[0].action, 'REUSE');
    assert.equal(prepared.resourceResults[0].status, 'PENDING');
    assert.equal(prepared.runtimeState, 'PENDING');

    const recorded = recordDevelopmentResourceResult(
      {
        ...options,
        resourceResult: {
          kind: RESOURCE_RESULT_KIND,
          schemaVersion: 1,
          allocationDigest: prepared.allocationDigest,
          fencingToken: prepared.fencingToken,
          resourceKind: 'service',
          resourceId: 'station-four',
          owner: 'runtime-owner',
          status: 'READY',
          manifestRef: 'runtime://station-four',
          digests: requirement().expectedDigests,
        },
      },
      {
        requireActiveDeclaration: () => declaration,
        inspectGitWorkspace: sourceIdentity,
      },
    );

    assert.equal(recorded.resourceResults[0].status, 'READY');
    assert.equal(recorded.runtimeState, 'READY');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('consumes the Agent domain policy through the standard ModuleImpact contract', () => {
  const script = fileURLToPath(
    new URL(
      '../../skills/pt-agent-development/scripts/impact.py',
      import.meta.url,
    ),
  );
  const agentImpact = JSON.parse(
    execFileSync(
      'python3',
      [
        script,
        'impact',
        '--changed-file',
        'apps/station/app/subserver/agent/service/turn_service.go',
      ],
      { encoding: 'utf8' },
    ),
  );
  const plan = buildPlanResourcePlan(
    request({ moduleImpacts: [agentImpact] }),
  );

  assert.equal(agentImpact.kind, MODULE_IMPACT_KIND);
  assert.deepEqual(plan.selectedTargetIds, ['station']);
  assert.deepEqual(plan.gateSelectors, ['affected-agent-gate']);
});

test('multi-module target closure is dependency ordered and deduplicated', () => {
  const shared = requirement({
    requirementId: 'shared-station',
    mode: 'shared',
  });
  const plan = buildPlanResourcePlan(
    request({
      moduleImpacts: [
        impact('agent', ['station']),
        impact('desktop', ['desktop-native'], {
          moduleDependencies: ['agent'],
        }),
      ],
      targets: [
        target('station', [shared]),
        target('desktop-native', [shared]),
      ],
    }),
  );

  assert.deepEqual(plan.executionWaves, [
    ['station'],
    ['desktop-native'],
  ]);
  assert.deepEqual(plan.moduleImpactDigests.map((item) => item.moduleId), [
    'agent',
    'desktop',
  ]);
  assert.equal(plan.runtimeClaims.length, 1);
  assert.deepEqual(plan.resourceResults[0].targetIds, [
    'desktop-native',
    'station',
  ]);
  assert.equal(plan.capacity[0].peakQuantity, 1);
  assert.deepEqual(plan.capacity[0].waveQuantities, [
    { wave: 0, quantity: 1 },
    { wave: 1, quantity: 1 },
  ]);
});

test('rejects one resource allocated to incompatible digest identities', () => {
  const firstRequirement = requirement({
    requirementId: 'first-runtime',
    lifecycleScope: 'scenario',
  });
  const secondRequirement = requirement({
    requirementId: 'second-runtime',
    lifecycleScope: 'scenario',
    expectedDigests: {
      source: digest('4'),
      artifact: digest('2'),
      runtime: digest('3'),
    },
  });

  assert.throws(
    () =>
      buildPlanResourcePlan(
        request({
          moduleImpacts: [
            impact('agent', ['first']),
            impact('desktop', ['second']),
          ],
          targets: [
            target('first', [firstRequirement]),
            target('second', [secondRequirement], {
              dependsOn: ['first'],
            }),
          ],
        }),
      ),
    (error) => {
      assert.ok(error instanceof ResourcePlanError);
      assert.equal(error.code, 'RESOURCE_REQUIREMENT_CONFLICT');
      assert.deepEqual(error.detail, {
        resourceKind: 'service',
        resourceId: 'station-four',
        digestKind: 'source',
        current: digest('1'),
        incoming: digest('4'),
      });
      return true;
    },
  );
});

test('duplicate account demand reuses one compatible account', () => {
  const account = requirement({
    requirementId: 'actor-alice',
    resourceKind: 'account',
    mode: 'exclusive',
    lifecycleScope: 'suite',
    isolationKey: 'alice',
    compatibilityKey: 'station-user',
    reusePolicy: 'REUSE_IF_HEALTHY',
    readinessProbe: {
      kind: 'owner',
      ref: 'account-session-check',
    },
    expectedDigests: {
      source: null,
      artifact: null,
      runtime: digest('4'),
    },
  });
  const plan = buildPlanResourcePlan(
    request({
      moduleImpacts: [
        impact('agent', ['agent-ui']),
        impact('chat', ['chat-ui']),
      ],
      targets: [
        target('agent-ui', [account]),
        target('chat-ui', [account]),
      ],
      inventory: [
        resource('alice', {
          resourceKind: 'account',
          compatibilityKey: 'station-user',
          owner: 'acceptance-suite-runtime',
          digests: {
            source: null,
            artifact: null,
            runtime: digest('4'),
          },
        }),
      ],
    }),
  );

  assert.equal(plan.runtimeClaims.length, 1);
  assert.equal(plan.runtimeClaims[0].kind, 'account');
  assert.deepEqual(plan.resourceResults[0].targetIds, [
    'agent-ui',
    'chat-ui',
  ]);
});

test('module resource intents become dependency roots for its targets', () => {
  const agent = impact('agent', ['station']);
  agent.requirements.resourceRequirements = [
    requirement({
      requirementId: 'agent-provider-account',
      resourceKind: 'account',
      compatibilityKey: 'agent-provider',
      isolationKey: 'agent-provider',
      expectedDigests: {
        source: null,
        artifact: null,
        runtime: null,
      },
    }),
  ];
  const plan = buildPlanResourcePlan(
    request({
      moduleImpacts: [agent],
      inventory: [resource('station-four')],
    }),
  );

  assert.deepEqual(plan.executionWaves, [
    ['module-agent-resources'],
    ['station'],
  ]);
  assert.deepEqual(
    plan.targets.map((item) => [item.targetId, item.state]),
    [
      ['module-agent-resources', 'PARKED'],
      ['station', 'PARKED'],
    ],
  );
  assert.equal(plan.blockers[0].requirementId, 'agent-provider-account');
});

test('module dependencies propagate through a no-target module', () => {
  const bridge = impact('workflow', [], {
    moduleDependencies: ['agent'],
  });
  const dependent = impact('desktop', ['desktop'], {
    moduleDependencies: ['workflow'],
  });
  const plan = buildPlanResourcePlan(
    request({
      moduleImpacts: [
        impact('agent', ['station']),
        bridge,
        dependent,
      ],
      targets: [
        target('station', [requirement()]),
        target('desktop'),
      ],
      inventory: [],
    }),
  );

  assert.deepEqual(
    plan.moduleStates.map((item) => [
      item.moduleId,
      item.state,
      item.blockedDependencyIds,
    ]),
    [
      ['agent', 'PARKED', []],
      ['desktop', 'PARKED', ['workflow']],
      ['workflow', 'PARKED', ['agent']],
    ],
  );
  assert.deepEqual(
    plan.targets.map((item) => [item.targetId, item.state]),
    [
      ['desktop', 'PARKED'],
      ['station', 'PARKED'],
    ],
  );
  assert.deepEqual(plan.journeySelectors, []);
  assert.deepEqual(plan.gateSelectors, []);
  assert.deepEqual(plan.focusedCheckSelectors, [
    'agent-check',
    'desktop-check',
    'workflow-check',
  ]);
});

test('source drift selects build while runtime drift selects restart', () => {
  const sourceDrift = buildPlanResourcePlan(
    request({
      inventory: [
        resource('station-four', {
          digests: {
            source: digest('9'),
            artifact: digest('2'),
            runtime: digest('3'),
          },
        }),
      ],
    }),
  );
  assert.equal(sourceDrift.resourceResults[0].action, 'BUILD');

  const runtimeDrift = buildPlanResourcePlan(
    request({
      targets: [
        target('station', [
          requirement({ reusePolicy: 'RESTART_IF_COMPATIBLE' }),
        ]),
      ],
      inventory: [
        resource('station-four', {
          digests: {
            source: digest('1'),
            artifact: digest('2'),
            runtime: digest('9'),
          },
        }),
      ],
    }),
  );
  assert.equal(runtimeDrift.resourceResults[0].action, 'RESTART');
});

test('capacity shortage parks only the conflicting parallel target', () => {
  const exclusiveAccount = requirement({
    requirementId: 'exclusive-account',
    resourceKind: 'account',
    mode: 'exclusive',
    lifecycleScope: 'suite',
    isolationKey: 'exclusive-user',
    compatibilityKey: 'station-user',
    reusePolicy: 'REUSE_IF_HEALTHY',
    readinessProbe: {
      kind: 'owner',
      ref: 'account-session-check',
    },
    expectedDigests: {
      source: null,
      artifact: null,
      runtime: digest('4'),
    },
  });
  const plan = buildPlanResourcePlan(
    request({
      moduleImpacts: [
        impact('agent', ['a-target']),
        impact('chat', ['b-target']),
      ],
      targets: [
        target('a-target', [exclusiveAccount]),
        target('b-target', [
          requirement({
            ...exclusiveAccount,
            requirementId: 'exclusive-account-b',
          }),
        ]),
      ],
      inventory: [
        resource('alice', {
          resourceKind: 'account',
          compatibilityKey: 'station-user',
          owner: 'acceptance-suite-runtime',
          digests: {
            source: null,
            artifact: null,
            runtime: digest('4'),
          },
        }),
      ],
    }),
  );

  assert.equal(plan.allocationState, 'PARTIALLY_READY');
  assert.deepEqual(
    plan.targets.map((item) => [item.targetId, item.state]),
    [
      ['a-target', 'ALLOCATED'],
      ['b-target', 'PARKED'],
    ],
  );
  assert.equal(plan.runtimeClaims.length, 1);
  assert.equal(plan.blockers[0].code, 'RESOURCE_CAPACITY_UNAVAILABLE');
  assert.deepEqual(plan.journeySelectors, ['agent-journey']);
  assert.deepEqual(plan.gateSelectors, ['agent-gate']);
  assert.deepEqual(plan.moduleStates, [
    {
      blockedDependencyIds: [],
      blockedTargetIds: [],
      dependencyModuleIds: [],
      moduleId: 'agent',
      state: 'READY',
      targetIds: ['a-target'],
    },
    {
      blockedDependencyIds: [],
      blockedTargetIds: ['b-target'],
      dependencyModuleIds: [],
      moduleId: 'chat',
      state: 'PARKED',
      targetIds: ['b-target'],
    },
  ]);
});

test('mandatory allocation rematches flexible demand around a pinned target', () => {
  const flexibleAccount = requirement({
    requirementId: 'flexible-account',
    resourceKind: 'account',
    mode: 'exclusive',
    lifecycleScope: 'scenario',
    isolationKey: 'flexible-user',
    compatibilityKey: 'station-user',
    candidateIds: [],
    expectedDigests: {
      source: null,
      artifact: null,
      runtime: null,
    },
  });
  const pinnedAccount = requirement({
    requirementId: 'pinned-account',
    resourceKind: 'account',
    mode: 'exclusive',
    lifecycleScope: 'scenario',
    isolationKey: 'pinned-user',
    compatibilityKey: 'station-user',
    candidateIds: ['alice'],
    expectedDigests: {
      source: null,
      artifact: null,
      runtime: null,
    },
  });
  const plan = buildPlanResourcePlan(
    request({
      moduleImpacts: [
        impact('flexible', ['a-flexible']),
        impact('pinned', ['b-pinned']),
      ],
      targets: [
        target('a-flexible', [flexibleAccount]),
        target('b-pinned', [pinnedAccount]),
      ],
      inventory: [
        resource('alice', {
          resourceKind: 'account',
          compatibilityKey: 'station-user',
          digests: {
            source: null,
            artifact: null,
            runtime: null,
          },
        }),
        resource('bob', {
          resourceKind: 'account',
          compatibilityKey: 'station-user',
          digests: {
            source: null,
            artifact: null,
            runtime: null,
          },
        }),
      ],
    }),
  );

  assert.equal(plan.allocationState, 'READY');
  assert.deepEqual(
    plan.targets.map((item) => [item.targetId, item.state]),
    [
      ['a-flexible', 'ALLOCATED'],
      ['b-pinned', 'ALLOCATED'],
    ],
  );
  assert.deepEqual(
    plan.resourceResults.map((item) => [item.resourceId, item.targetIds]),
    [
      ['alice', ['b-pinned']],
      ['bob', ['a-flexible']],
    ],
  );
});

test('optional demand cannot starve a mandatory target in the same wave', () => {
  const optionalAccount = requirement({
    requirementId: 'optional-account',
    resourceKind: 'account',
    mode: 'exclusive',
    lifecycleScope: 'scenario',
    isolationKey: 'optional-user',
    compatibilityKey: 'station-user',
    mandatory: false,
    expectedDigests: {
      source: null,
      artifact: null,
      runtime: null,
    },
  });
  const mandatoryAccount = requirement({
    requirementId: 'mandatory-account',
    resourceKind: 'account',
    mode: 'exclusive',
    lifecycleScope: 'scenario',
    isolationKey: 'mandatory-user',
    compatibilityKey: 'station-user',
    expectedDigests: {
      source: null,
      artifact: null,
      runtime: null,
    },
  });
  const plan = buildPlanResourcePlan(
    request({
      moduleImpacts: [
        impact('optional', ['a-optional']),
        impact('mandatory', ['b-mandatory']),
      ],
      targets: [
        target('a-optional', [optionalAccount]),
        target('b-mandatory', [mandatoryAccount]),
      ],
      inventory: [
        resource('alice', {
          resourceKind: 'account',
          compatibilityKey: 'station-user',
          digests: {
            source: null,
            artifact: null,
            runtime: null,
          },
        }),
      ],
    }),
  );

  assert.equal(plan.allocationState, 'READY');
  assert.deepEqual(
    plan.targets.map((item) => [item.targetId, item.state]),
    [
      ['a-optional', 'ALLOCATED'],
      ['b-mandatory', 'ALLOCATED'],
    ],
  );
  assert.deepEqual(plan.resourceResults[0].targetIds, ['b-mandatory']);
});

test('suite-scoped exclusive capacity remains reserved across dependent waves', () => {
  const firstAccount = requirement({
    requirementId: 'actor-alice',
    resourceKind: 'account',
    mode: 'exclusive',
    lifecycleScope: 'suite',
    isolationKey: 'alice',
    compatibilityKey: 'station-user',
    reusePolicy: 'REUSE_IF_HEALTHY',
    readinessProbe: {
      kind: 'owner',
      ref: 'account-session-check',
    },
    expectedDigests: {
      source: null,
      artifact: null,
      runtime: digest('4'),
    },
  });
  const secondAccount = requirement({
    ...firstAccount,
    requirementId: 'actor-bob',
    isolationKey: 'bob',
  });
  const plan = buildPlanResourcePlan(
    request({
      moduleImpacts: [
        impact('agent', ['first']),
        impact('chat', ['second'], {
          moduleDependencies: ['agent'],
        }),
      ],
      targets: [
        target('first', [firstAccount]),
        target('second', [secondAccount]),
      ],
      inventory: [
        resource('only-account', {
          resourceKind: 'account',
          compatibilityKey: 'station-user',
          owner: 'acceptance-suite-runtime',
          digests: {
            source: null,
            artifact: null,
            runtime: digest('4'),
          },
        }),
      ],
    }),
  );

  assert.deepEqual(plan.executionWaves, [['first'], ['second']]);
  assert.deepEqual(
    plan.targets.map((item) => [item.targetId, item.state]),
    [
      ['first', 'ALLOCATED'],
      ['second', 'PARKED'],
    ],
  );
});

test('one target is reserved all-or-none without hold-and-wait', () => {
  const account = requirement({
    requirementId: 'account',
    resourceKind: 'account',
    compatibilityKey: 'station-user',
    expectedDigests: {
      source: null,
      artifact: null,
      runtime: null,
    },
  });
  const device = requirement({
    requirementId: 'device',
    resourceKind: 'device',
    compatibilityKey: 'ios-simulator',
    expectedDigests: {
      source: null,
      artifact: null,
      runtime: null,
    },
  });
  const plan = buildPlanResourcePlan(
    request({
      moduleImpacts: [impact('agent', ['native-journey'])],
      targets: [target('native-journey', [account, device])],
      inventory: [
        resource('alice', {
          resourceKind: 'account',
          compatibilityKey: 'station-user',
          digests: {
            source: null,
            artifact: null,
            runtime: null,
          },
        }),
      ],
    }),
  );

  assert.equal(plan.allocationState, 'PARKED');
  assert.deepEqual(plan.runtimeClaims, []);
  assert.deepEqual(plan.acquisition.order, []);
});

test('quarantined resource is replaced by the next compatible candidate', () => {
  const plan = buildPlanResourcePlan(
    request({
      inventory: [
        resource('station-four', { state: 'QUARANTINED' }),
        resource('station-five'),
      ],
    }),
  );

  assert.equal(plan.resourceResults[0].resourceId, 'station-five');
  assert.equal(plan.resourceResults[0].action, 'REUSE');
});

test('internal resource-plan markers cannot be requested as resources', () => {
  expectCode('RESOURCE_PLAN_INVALID', () =>
    buildPlanResourcePlan(
      request({
        targets: [
          target('station', [
            requirement({
              resourceKind: 'resource.plan',
            }),
          ]),
        ],
      }),
    ),
  );
  expectCode('RESOURCE_PLAN_INVALID', () =>
    buildPlanResourcePlan(
      request({
        inventory: [
          resource('forged-plan', {
            resourceKind: 'resource.plan',
          }),
        ],
      }),
    ),
  );
});

test('missing module dependency fails before target allocation', () => {
  const agent = impact('agent', ['station']);
  agent.moduleDependencies = ['desktop'];
  expectCode('MODULE_IMPACT_DEPENDENCY_MISSING', () =>
    buildPlanResourcePlan(request({ moduleImpacts: [agent] })),
  );
});

test('prepare updates one declaration atomically and records an idempotent fence', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pt-resource-plan-'));
  const home = path.join(root, 'home');
  const workspaceRoot = path.join(root, 'workspace');
  const receiptFile = path.join(root, 'resource-plan.json');
  mkdirSync(home);
  mkdirSync(workspaceRoot);
  const declaration = {
    declarationId: 'WORK-1-0123456789abcdef',
    workItemId: 'WORK-1',
    sessionId: 'SESSION-1',
    workspaceId: '0123456789abcdef',
    branch: 'feat/test',
    sourceHead: 'a'.repeat(40),
    owner: 'owner@example.invalid',
    purpose: 'test resource preparation',
    journeyId: 'DEV-J04',
    state: 'ACTIVE',
    sourceClaims: [
      {
        mode: 'exclusive-write',
        pathPrefix: 'tooling/scripts/local-dev',
      },
    ],
    runtimeClaims: [
      {
        kind: 'profile',
        resourceId: 'four',
        mode: 'shared',
      },
    ],
    planPath: 'docs/plan.md',
    planId: 'PLAN-1',
    taskId: 'TASK-1',
  };
  const updates = [];
  const dependencies = {
    requireActiveDeclaration: () => declaration,
    inspectGitWorkspace: sourceIdentity,
    startOrUpdateDeclaration: (options) => {
      updates.push(options);
      return {
        ...declaration,
        declarationDigest: digest('d').slice('sha256:'.length),
      };
    },
    now: new Date('2026-09-30T00:00:00.000Z'),
  };
  try {
    const options = {
      home,
      workspaceRoot,
      workItemId: 'WORK-1',
      sessionId: 'SESSION-1',
      resourcePlanFile: receiptFile,
      resourceRequest: request(),
    };
    const first = prepareDevelopmentResources(options, dependencies);
    const second = prepareDevelopmentResources(options, dependencies);
    const changed = prepareDevelopmentResources(
      {
        ...options,
        resourceRequest: request({
          inventory: [
            resource('station-four'),
            resource('station-five'),
          ],
        }),
      },
      dependencies,
    );
    const sourceOnly = prepareDevelopmentResources(
      {
        ...options,
        resourceRequest: request({
          moduleImpacts: [impact('agent', [], {
            changeKinds: ['DOCS_ONLY'],
            requirements: {
              focusedCheckSelectors: ['agent-docs-consistency'],
              targetSelectors: [],
              journeySelectors: [],
              gateSelectors: [],
              resourceRequirements: [],
            },
            proof: {
              action: 'REUSE_CANDIDATE',
            },
          })],
          targets: [],
          inventory: [],
        }),
      },
      dependencies,
    );

    assert.equal(first.fencingToken, 1);
    assert.equal(first.preparationState, 'COMMITTED');
    assert.equal(second.fencingToken, 1);
    assert.equal(changed.fencingToken, 2);
    assert.equal(sourceOnly.fencingToken, 3);
    assert.equal(updates.length, 4);
    assert.match(updates[0].runtimeClaims, /shared:profile:four/);
    assert.match(updates[0].runtimeClaims, /shared:service:station-four/);
    assert.deepEqual(first.plannedRuntimeClaims, [
      {
        kind: 'resource.plan',
        resourceId: 'WORK-1',
        mode: 'shared',
      },
      {
        kind: 'service',
        resourceId: 'station-four',
        mode: 'shared',
      },
    ]);
    assert.equal(first.declarationRuntimeClaims.length, 3);
    assert.deepEqual(sourceOnly.plannedRuntimeClaims, []);
    assert.deepEqual(sourceOnly.declarationRuntimeClaims, [
      {
        kind: 'profile',
        resourceId: 'four',
        mode: 'shared',
      },
    ]);
    assert.equal(
      JSON.parse(readFileSync(receiptFile, 'utf8')).receiptDigest,
      sourceOnly.receiptDigest,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('failed declaration update leaves a recoverable non-authorizing receipt', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pt-resource-interrupt-'));
  const home = path.join(root, 'home');
  const workspaceRoot = path.join(root, 'workspace');
  const receiptFile = path.join(root, 'resource-plan.json');
  mkdirSync(home);
  mkdirSync(workspaceRoot);
  const declaration = {
    declarationId: 'WORK-1-0123456789abcdef',
    workItemId: 'WORK-1',
    sessionId: 'SESSION-1',
    workspaceId: '0123456789abcdef',
    branch: 'feat/test',
    sourceHead: 'a'.repeat(40),
    owner: 'owner@example.invalid',
    purpose: 'test interrupted resource preparation',
    journeyId: 'DEV-J04',
    state: 'ACTIVE',
    sourceClaims: [
      {
        mode: 'exclusive-write',
        pathPrefix: 'tooling/scripts/local-dev',
      },
    ],
    runtimeClaims: [],
    planPath: 'docs/plan.md',
    planId: 'PLAN-1',
    taskId: 'TASK-1',
  };
  try {
    assert.throws(
      () =>
        prepareDevelopmentResources(
          {
            home,
            workspaceRoot,
            workItemId: 'WORK-1',
            sessionId: 'SESSION-1',
            resourcePlanFile: receiptFile,
            resourceRequest: request(),
          },
          {
            requireActiveDeclaration: () => declaration,
            inspectGitWorkspace: sourceIdentity,
            startOrUpdateDeclaration: () => {
              throw new DevWorkError(
                'WORKTREE_IDENTITY_MISMATCH',
                'source changed',
              );
            },
            now: new Date('2026-09-30T00:00:00.000Z'),
          },
        ),
      (error) =>
        error instanceof DevWorkError
        && error.code === 'WORKTREE_IDENTITY_MISMATCH',
    );
    assert.equal(
      readPlanResourceReceipt({
        home,
        workspaceRoot,
        workItemId: 'WORK-1',
        resourcePlanFile: receiptFile,
      }).preparationState,
      'RESERVING',
    );
    declaration.runtimeClaims = [
      {
        kind: 'service',
        resourceId: 'station-four',
        mode: 'shared',
      },
    ];
    expectCode('RESOURCE_PLAN_NOT_COMMITTED', () =>
      validatePreparedResourceClaim(
        {
          home,
          workspaceRoot,
          workItemId: 'WORK-1',
          resourcePlanFile: receiptFile,
          declaration,
          resourceKind: 'service',
          resourceId: 'station-four',
        },
        { inspectGitWorkspace: sourceIdentity },
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('prepare rejects caller-asserted workspace identity drift', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pt-resource-source-'));
  const home = path.join(root, 'home');
  const workspaceRoot = path.join(root, 'workspace');
  mkdirSync(home);
  mkdirSync(workspaceRoot);
  const declaration = {
    declarationId: 'WORK-1-0123456789abcdef',
    workItemId: 'WORK-1',
    sessionId: 'SESSION-1',
    workspaceId: '0123456789abcdef',
    branch: 'feat/test',
    sourceHead: 'a'.repeat(40),
    owner: 'owner@example.invalid',
    purpose: 'test source drift',
    journeyId: 'DEV-J04',
    state: 'ACTIVE',
    sourceClaims: [
      {
        mode: 'exclusive-write',
        pathPrefix: 'tooling/scripts/local-dev',
      },
    ],
    runtimeClaims: [],
    planPath: 'docs/plan.md',
    planId: 'PLAN-1',
    taskId: 'TASK-1',
  };
  try {
    expectCode('RESOURCE_PLAN_SOURCE_STALE', () =>
      prepareDevelopmentResources(
        {
          home,
          workspaceRoot,
          workItemId: 'WORK-1',
          sessionId: 'SESSION-1',
          resourcePlanFile: path.join(root, 'resource-plan.json'),
          resourceRequest: request(),
        },
        {
          requireActiveDeclaration: () => declaration,
          inspectGitWorkspace: () => ({
            ...sourceIdentity(),
            workspaceDigest: digest('9'),
          }),
          startOrUpdateDeclaration: () => {
            throw new Error('must not update a stale declaration');
          },
        },
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('source drift during declaration update cannot commit a resource plan', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pt-resource-race-'));
  const home = path.join(root, 'home');
  const workspaceRoot = path.join(root, 'workspace');
  const receiptFile = path.join(root, 'resource-plan.json');
  mkdirSync(home);
  mkdirSync(workspaceRoot);
  const declaration = {
    declarationId: 'WORK-1-0123456789abcdef',
    workItemId: 'WORK-1',
    sessionId: 'SESSION-1',
    workspaceId: '0123456789abcdef',
    branch: 'feat/test',
    sourceHead: 'a'.repeat(40),
    owner: 'owner@example.invalid',
    purpose: 'test source race',
    journeyId: 'DEV-J04',
    state: 'ACTIVE',
    sourceClaims: [
      {
        mode: 'exclusive-write',
        pathPrefix: 'tooling/scripts/local-dev',
      },
    ],
    runtimeClaims: [],
    planPath: 'docs/plan.md',
    planId: 'PLAN-1',
    taskId: 'TASK-1',
  };
  let sourceReads = 0;
  try {
    expectCode('RESOURCE_PLAN_SOURCE_STALE', () =>
      prepareDevelopmentResources(
        {
          home,
          workspaceRoot,
          workItemId: 'WORK-1',
          sessionId: 'SESSION-1',
          resourcePlanFile: receiptFile,
          resourceRequest: request(),
        },
        {
          requireActiveDeclaration: () => declaration,
          inspectGitWorkspace: () => {
            sourceReads += 1;
            return sourceReads === 1
              ? sourceIdentity()
              : {
                  ...sourceIdentity(),
                  workspaceDigest: digest('9'),
                };
          },
          startOrUpdateDeclaration: () => ({
            ...declaration,
            declarationDigest: digest('d').slice('sha256:'.length),
          }),
          now: new Date('2026-09-30T00:00:00.000Z'),
        },
      ),
    );
    assert.equal(
      readPlanResourceReceipt({
        home,
        workspaceRoot,
        workItemId: 'WORK-1',
        resourcePlanFile: receiptFile,
      }).preparationState,
      'RESERVING',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('status marks source and declaration drift without repairing owner state', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pt-resource-status-'));
  const home = path.join(root, 'home');
  const workspaceRoot = path.join(root, 'workspace');
  const receiptFile = path.join(root, 'resource-plan.json');
  mkdirSync(home);
  mkdirSync(workspaceRoot);
  const declaration = {
    declarationId: 'WORK-1-0123456789abcdef',
    workItemId: 'WORK-1',
    sessionId: 'SESSION-1',
    workspaceId: '0123456789abcdef',
    branch: 'feat/test',
    sourceHead: 'a'.repeat(40),
    owner: 'owner@example.invalid',
    purpose: 'test resource status',
    journeyId: 'DEV-J04',
    state: 'ACTIVE',
    sourceClaims: [
      {
        mode: 'exclusive-write',
        pathPrefix: 'tooling/scripts/local-dev',
      },
    ],
    runtimeClaims: [],
    planPath: 'docs/plan.md',
    planId: 'PLAN-1',
    taskId: 'TASK-1',
  };
  const dependencies = {
    requireActiveDeclaration: () => declaration,
    inspectGitWorkspace: sourceIdentity,
    startOrUpdateDeclaration: (options) => {
      declaration.runtimeClaims = options.runtimeClaims
        .split(';')
        .filter(Boolean)
        .map((claim) => {
          const [mode, kind, resourceId] = claim.split(':');
          return { kind, resourceId, mode };
        });
      return {
        ...declaration,
        declarationDigest: digest('d').slice('sha256:'.length),
      };
    },
    now: new Date('2026-09-30T00:00:00.000Z'),
  };
  try {
    const options = {
      home,
      workspaceRoot,
      workItemId: 'WORK-1',
      sessionId: 'SESSION-1',
      resourcePlanFile: receiptFile,
      resourceRequest: request(),
    };
    prepareDevelopmentResources(options, dependencies);
    const current = statusDevelopmentResources(options, {
      inspectGitWorkspace: sourceIdentity,
      statusCurrent: () => ({ declarations: [declaration] }),
    });
    assert.equal(current.status, 'CURRENT');

    const stale = statusDevelopmentResources(options, {
      inspectGitWorkspace: () => ({
        ...sourceIdentity(),
        workspaceDigest: digest('9'),
      }),
      statusCurrent: () => ({ declarations: [declaration] }),
    });
    assert.equal(stale.status, 'STALE');
    assert.deepEqual(stale.staleReasons, [
      'SOURCE_WORKSPACE_DIGEST_MISMATCH',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('prepare replans a concurrent conflict without holding a partial bundle', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pt-resource-conflict-'));
  const home = path.join(root, 'home');
  const workspaceRoot = path.join(root, 'workspace');
  const receiptFile = path.join(root, 'resource-plan.json');
  mkdirSync(home);
  mkdirSync(workspaceRoot);
  const declaration = {
    declarationId: 'WORK-1-0123456789abcdef',
    workItemId: 'WORK-1',
    sessionId: 'SESSION-1',
    workspaceId: '0123456789abcdef',
    branch: 'feat/test',
    sourceHead: 'a'.repeat(40),
    owner: 'owner@example.invalid',
    purpose: 'test concurrent resource planning',
    journeyId: 'DEV-J04',
    state: 'ACTIVE',
    sourceClaims: [
      {
        mode: 'exclusive-write',
        pathPrefix: 'tooling/scripts/local-dev',
      },
    ],
    runtimeClaims: [],
    planPath: 'docs/plan.md',
    planId: 'PLAN-1',
    taskId: 'TASK-1',
  };
  const updates = [];
  const dependencies = {
    requireActiveDeclaration: () => declaration,
    inspectGitWorkspace: sourceIdentity,
    startOrUpdateDeclaration: (options) => {
      updates.push(options.runtimeClaims);
      if (updates.length === 1) {
        throw new DevWorkError(
          'RESOURCE_DECLARATION_CONFLICT',
          'concurrent plan acquired the preferred resource',
          {
            kind: 'RUNTIME_RESOURCE_CONFLICT',
            resource: 'service:station-five',
          },
        );
      }
      return {
        ...declaration,
        declarationDigest: digest('d').slice('sha256:'.length),
      };
    },
    now: new Date('2026-09-30T00:00:00.000Z'),
  };
  try {
    const prepared = prepareDevelopmentResources(
      {
        home,
        workspaceRoot,
        workItemId: 'WORK-1',
        sessionId: 'SESSION-1',
        resourcePlanFile: receiptFile,
        resourceRequest: request({
          inventory: [
            resource('station-four'),
            resource('station-five'),
          ],
        }),
      },
      dependencies,
    );

    assert.equal(updates.length, 2);
    assert.match(updates[0], /service:station-five/);
    assert.doesNotMatch(updates[1], /service:station-five/);
    assert.match(updates[1], /service:station-four/);
    assert.equal(prepared.resourceResults[0].resourceId, 'station-four');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('planner does not adopt or remove a pre-existing declaration claim', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pt-resource-provenance-'));
  const home = path.join(root, 'home');
  const workspaceRoot = path.join(root, 'workspace');
  const receiptFile = path.join(root, 'resource-plan.json');
  mkdirSync(home);
  mkdirSync(workspaceRoot);
  const declaration = {
    declarationId: 'WORK-1-0123456789abcdef',
    workItemId: 'WORK-1',
    sessionId: 'SESSION-1',
    workspaceId: '0123456789abcdef',
    branch: 'feat/test',
    sourceHead: 'a'.repeat(40),
    owner: 'owner@example.invalid',
    purpose: 'test resource claim provenance',
    journeyId: 'DEV-J04',
    state: 'ACTIVE',
    sourceClaims: [
      {
        mode: 'exclusive-write',
        pathPrefix: 'tooling/scripts/local-dev',
      },
    ],
    runtimeClaims: [
      {
        kind: 'service',
        resourceId: 'station-four',
        mode: 'shared',
      },
    ],
    planPath: 'docs/plan.md',
    planId: 'PLAN-1',
    taskId: 'TASK-1',
  };
  const dependencies = {
    requireActiveDeclaration: () => declaration,
    inspectGitWorkspace: sourceIdentity,
    startOrUpdateDeclaration: (options) => {
      declaration.runtimeClaims = options.runtimeClaims
        .split(';')
        .filter(Boolean)
        .map((claim) => {
          const [mode, kind, resourceId] = claim.split(':');
          return { kind, resourceId, mode };
        });
      return {
        ...declaration,
        declarationDigest: digest('d').slice('sha256:'.length),
      };
    },
    now: new Date('2026-09-30T00:00:00.000Z'),
  };
  try {
    const options = {
      home,
      workspaceRoot,
      workItemId: 'WORK-1',
      sessionId: 'SESSION-1',
      resourcePlanFile: receiptFile,
      resourceRequest: request(),
    };
    const prepared = prepareDevelopmentResources(options, dependencies);
    assert.deepEqual(prepared.baseRuntimeClaims, [
      {
        kind: 'service',
        resourceId: 'station-four',
        mode: 'shared',
      },
    ]);
    assert.deepEqual(prepared.plannedRuntimeClaims, [
      {
        kind: 'resource.plan',
        resourceId: 'WORK-1',
        mode: 'shared',
      },
    ]);
    assert.equal(
      validatePreparedResourceClaim(
        {
          ...options,
          declaration,
          resourceKind: 'service',
          resourceId: 'station-four',
        },
        { inspectGitWorkspace: sourceIdentity },
      ).authority,
      'declaration',
    );

    const sourceOnly = prepareDevelopmentResources(
      {
        ...options,
        resourceRequest: request({
          moduleImpacts: [impact('agent', [], {
            changeKinds: ['DOCS_ONLY'],
            requirements: {
              focusedCheckSelectors: ['agent-docs-consistency'],
              targetSelectors: [],
              journeySelectors: [],
              gateSelectors: [],
              resourceRequirements: [],
            },
            proof: {
              action: 'REUSE_CANDIDATE',
            },
          })],
          targets: [],
          inventory: [],
        }),
      },
      dependencies,
    );
    assert.deepEqual(sourceOnly.declarationRuntimeClaims, [
      {
        kind: 'service',
        resourceId: 'station-four',
        mode: 'shared',
      },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('interrupted replacement retains prior planner provenance for retry', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pt-resource-recovery-'));
  const home = path.join(root, 'home');
  const workspaceRoot = path.join(root, 'workspace');
  const receiptFile = path.join(root, 'resource-plan.json');
  mkdirSync(home);
  mkdirSync(workspaceRoot);
  const declaration = activeDeclaration({
    runtimeClaims: [
      {
        kind: 'profile',
        resourceId: 'four',
        mode: 'shared',
      },
    ],
  });
  let failUpdate = false;
  const dependencies = {
    requireActiveDeclaration: () => declaration,
    inspectGitWorkspace: sourceIdentity,
    startOrUpdateDeclaration: (options) => {
      if (failUpdate) {
        throw new DevWorkError(
          'WORKTREE_IDENTITY_MISMATCH',
          'simulated interruption before declaration update',
        );
      }
      declaration.runtimeClaims = options.runtimeClaims
        .split(';')
        .filter(Boolean)
        .map((claim) => {
          const [mode, kind, resourceId] = claim.split(':');
          return { kind, resourceId, mode };
        });
      return {
        ...declaration,
        declarationDigest: digest('d').slice('sha256:'.length),
      };
    },
    now: new Date('2026-09-30T00:00:00.000Z'),
  };
  const options = {
    home,
    workspaceRoot,
    workItemId: 'WORK-1',
    sessionId: 'SESSION-1',
    resourcePlanFile: receiptFile,
    resourceRequest: request(),
  };
  const replacementRequest = request({
    inventory: [resource('station-five')],
  });
  try {
    const first = prepareDevelopmentResources(options, dependencies);
    assert.deepEqual(
      first.plannedRuntimeClaims.map((claim) => claim.resourceId),
      ['WORK-1', 'station-four'],
    );

    failUpdate = true;
    assert.throws(
      () =>
        prepareDevelopmentResources(
          { ...options, resourceRequest: replacementRequest },
          dependencies,
        ),
      (error) =>
        error instanceof DevWorkError
        && error.code === 'WORKTREE_IDENTITY_MISMATCH',
    );
    const reserving = readPlanResourceReceipt(options);
    assert.equal(reserving.preparationState, 'RESERVING');
    assert.deepEqual(
      reserving.plannedRuntimeClaims.map((claim) => claim.resourceId),
      ['WORK-1', 'station-five', 'station-four'],
    );

    failUpdate = false;
    const recovered = prepareDevelopmentResources(
      { ...options, resourceRequest: replacementRequest },
      dependencies,
    );
    assert.equal(recovered.preparationState, 'COMMITTED');
    assert.equal(recovered.fencingToken, 2);
    assert.deepEqual(
      recovered.baseRuntimeClaims.map((claim) => claim.resourceId),
      ['four'],
    );
    assert.deepEqual(
      recovered.plannedRuntimeClaims.map((claim) => claim.resourceId),
      ['WORK-1', 'station-five'],
    );
    assert.deepEqual(
      recovered.declarationRuntimeClaims.map((claim) => claim.resourceId),
      ['four', 'WORK-1', 'station-five'],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('prepare refuses to adopt planner claims when the prior receipt is missing', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pt-resource-missing-receipt-'));
  const home = path.join(root, 'home');
  const workspaceRoot = path.join(root, 'workspace');
  const receiptFile = path.join(root, 'resource-plan.json');
  mkdirSync(home);
  mkdirSync(workspaceRoot);
  const declaration = activeDeclaration({
    runtimeClaims: [
      {
        kind: 'resource.plan',
        resourceId: 'WORK-1',
        mode: 'shared',
      },
      {
        kind: 'service',
        resourceId: 'station-four',
        mode: 'shared',
      },
    ],
  });
  let updateCount = 0;
  try {
    expectCode('RESOURCE_PLAN_MISSING', () =>
      prepareDevelopmentResources(
        {
          home,
          workspaceRoot,
          workItemId: 'WORK-1',
          sessionId: 'SESSION-1',
          resourcePlanFile: receiptFile,
          resourceRequest: request(),
        },
        {
          requireActiveDeclaration: () => declaration,
          inspectGitWorkspace: sourceIdentity,
          startOrUpdateDeclaration: () => {
            updateCount += 1;
            return declaration;
          },
        },
      ),
    );
    assert.equal(updateCount, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('owner results match exact idempotency keys, not bare requirement IDs', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pt-resource-result-key-'));
  const home = path.join(root, 'home');
  const workspaceRoot = path.join(root, 'workspace');
  const receiptFile = path.join(root, 'resource-plan.json');
  mkdirSync(home);
  mkdirSync(workspaceRoot);
  const declaration = activeDeclaration();
  const firstRequirement = requirement({
    requirementId: 'shared-runtime',
    compatibilityKey: 'runtime-a',
    isolationKey: 'runtime-a',
    reusePolicy: 'RESTART_IF_COMPATIBLE',
  });
  const secondRequirement = requirement({
    requirementId: 'shared-runtime',
    compatibilityKey: 'runtime-b',
    isolationKey: 'runtime-b',
    reusePolicy: 'RESTART_IF_COMPATIBLE',
    expectedDigests: {
      source: digest('4'),
      artifact: digest('5'),
      runtime: digest('6'),
    },
  });
  const dependencies = {
    requireActiveDeclaration: () => declaration,
    inspectGitWorkspace: sourceIdentity,
    startOrUpdateDeclaration: (options) => {
      declaration.runtimeClaims = options.runtimeClaims
        .split(';')
        .filter(Boolean)
        .map((claim) => {
          const [mode, kind, resourceId] = claim.split(':');
          return { kind, resourceId, mode };
        });
      return {
        ...declaration,
        declarationDigest: digest('d').slice('sha256:'.length),
      };
    },
    now: new Date('2026-09-30T00:00:00.000Z'),
  };
  try {
    const options = {
      home,
      workspaceRoot,
      workItemId: 'WORK-1',
      sessionId: 'SESSION-1',
      resourcePlanFile: receiptFile,
      resourceRequest: request({
        moduleImpacts: [
          impact('agent', ['target-a']),
          impact('desktop', ['target-b']),
        ],
        targets: [
          target('target-a', [firstRequirement]),
          target('target-b', [secondRequirement]),
        ],
        inventory: [
          resource('runtime-a', {
            compatibilityKey: 'runtime-a',
            state: 'STALE',
          }),
          resource('runtime-b', {
            compatibilityKey: 'runtime-b',
            state: 'STALE',
            digests: secondRequirement.expectedDigests,
          }),
        ],
      }),
    };
    const prepared = prepareDevelopmentResources(options, dependencies);
    const first = prepared.resourceResults.find(
      (result) => result.resourceId === 'runtime-a',
    );
    assert.deepEqual(first.idempotencyKeys, [
      'PLAN-1:task:shared-runtime:runtime-a',
    ]);

    const recorded = recordDevelopmentResourceResult(
      {
        ...options,
        resourceResult: {
          kind: RESOURCE_RESULT_KIND,
          schemaVersion: 1,
          allocationDigest: prepared.allocationDigest,
          fencingToken: prepared.fencingToken,
          resourceKind: 'service',
          resourceId: 'runtime-a',
          owner: 'runtime-owner',
          status: 'READY',
          manifestRef: 'runtime://runtime-a/restarted',
          digests: firstRequirement.expectedDigests,
        },
      },
      {
        requireActiveDeclaration: () => declaration,
        inspectGitWorkspace: sourceIdentity,
      },
    );
    assert.equal(
      recorded.resourceResults.find(
        (result) => result.resourceId === 'runtime-a',
      ).status,
      'READY',
    );
    assert.equal(recorded.runtimeState, 'PENDING');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('owner results are fenced and quarantine the prepared plan', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pt-resource-record-'));
  const home = path.join(root, 'home');
  const workspaceRoot = path.join(root, 'workspace');
  const receiptFile = path.join(root, 'resource-plan.json');
  mkdirSync(home);
  mkdirSync(workspaceRoot);
  const declaration = {
    declarationId: 'WORK-1-0123456789abcdef',
    workItemId: 'WORK-1',
    sessionId: 'SESSION-1',
    workspaceId: '0123456789abcdef',
    branch: 'feat/test',
    sourceHead: 'a'.repeat(40),
    owner: 'owner@example.invalid',
    purpose: 'test resource result',
    journeyId: 'DEV-J04',
    state: 'ACTIVE',
    sourceClaims: [
      {
        mode: 'exclusive-write',
        pathPrefix: 'tooling/scripts/local-dev',
      },
    ],
    runtimeClaims: [],
    planPath: 'docs/plan.md',
    planId: 'PLAN-1',
    taskId: 'TASK-1',
  };
  const dependencies = {
    requireActiveDeclaration: () => declaration,
    inspectGitWorkspace: sourceIdentity,
    startOrUpdateDeclaration: () => ({
      ...declaration,
      declarationDigest: digest('d').slice('sha256:'.length),
    }),
    now: new Date('2026-09-30T00:00:00.000Z'),
  };
  try {
    const options = {
      home,
      workspaceRoot,
      workItemId: 'WORK-1',
      sessionId: 'SESSION-1',
      resourcePlanFile: receiptFile,
      resourceRequest: request({
        inventory: [
          resource('station-four', {
            state: 'STALE',
          }),
        ],
      }),
    };
    const prepared = prepareDevelopmentResources(options, dependencies);
    assert.equal(prepared.runtimeState, 'PENDING');
    declaration.runtimeClaims = prepared.declarationRuntimeClaims;

    expectCode('RESOURCE_RESULT_STALE', () =>
      recordDevelopmentResourceResult(
        {
          ...options,
          resourceResult: {
            kind: RESOURCE_RESULT_KIND,
            schemaVersion: 1,
            allocationDigest: prepared.allocationDigest,
            fencingToken: prepared.fencingToken + 1,
            resourceKind: 'service',
            resourceId: 'station-four',
            owner: 'runtime-owner',
            status: 'READY',
            manifestRef: 'runtime://station-four/new',
            digests: {
              source: digest('1'),
              artifact: digest('2'),
              runtime: digest('3'),
            },
          },
        },
        {
          requireActiveDeclaration: () => declaration,
          inspectGitWorkspace: sourceIdentity,
        },
      ),
    );

    expectCode('RESOURCE_RESULT_OWNER_MISMATCH', () =>
      recordDevelopmentResourceResult(
        {
          ...options,
          resourceResult: {
            kind: RESOURCE_RESULT_KIND,
            schemaVersion: 1,
            allocationDigest: prepared.allocationDigest,
            fencingToken: prepared.fencingToken,
            resourceKind: 'service',
            resourceId: 'station-four',
            owner: 'different-owner',
            status: 'READY',
            manifestRef: 'runtime://station-four/new',
            digests: {
              source: digest('1'),
              artifact: digest('2'),
              runtime: digest('3'),
            },
          },
        },
        {
          requireActiveDeclaration: () => declaration,
          inspectGitWorkspace: sourceIdentity,
        },
      ),
    );

    expectCode('RESOURCE_RESULT_IDENTITY_MISMATCH', () =>
      recordDevelopmentResourceResult(
        {
          ...options,
          resourceResult: {
            kind: RESOURCE_RESULT_KIND,
            schemaVersion: 1,
            allocationDigest: prepared.allocationDigest,
            fencingToken: prepared.fencingToken,
            resourceKind: 'service',
            resourceId: 'station-four',
            owner: 'runtime-owner',
            status: 'READY',
            manifestRef: 'runtime://station-four/new',
            digests: {
              source: digest('9'),
              artifact: digest('2'),
              runtime: digest('3'),
            },
          },
        },
        {
          requireActiveDeclaration: () => declaration,
          inspectGitWorkspace: sourceIdentity,
        },
      ),
    );

    const quarantined = recordDevelopmentResourceResult(
      {
        ...options,
        resourceResult: {
          kind: RESOURCE_RESULT_KIND,
          schemaVersion: 1,
          allocationDigest: prepared.allocationDigest,
          fencingToken: prepared.fencingToken,
          resourceKind: 'service',
          resourceId: 'station-four',
          owner: 'runtime-owner',
          status: 'QUARANTINED',
          manifestRef: 'runtime://station-four/quarantine',
          digests: {
            source: digest('1'),
            artifact: digest('2'),
            runtime: digest('3'),
          },
        },
      },
      {
        requireActiveDeclaration: () => declaration,
        inspectGitWorkspace: sourceIdentity,
      },
    );
    assert.equal(quarantined.runtimeState, 'QUARANTINED');
    assert.equal(
      readPlanResourceReceipt({
        ...options,
        resourcePlanFile: receiptFile,
      }).runtimeState,
      'QUARANTINED',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
