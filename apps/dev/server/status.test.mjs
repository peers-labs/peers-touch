import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { workspaceIdForRoot } from '../../../tooling/scripts/lib/machine-dev-paths.mjs';
import { reduceWorkflowActivity } from '../../../tooling/scripts/local-dev/workflow-action-store.mjs';
import {
  buildDevSnapshot,
  collectProfiles,
  resolveDeclarationPlan,
} from './status.mjs';

function git(directory, ...args) {
  return execFileSync('git', args, {
    cwd: directory,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function addProfile(
  envRepo,
  name,
  {
    stationUrl,
    deployEnvironment,
    relayUrl = '',
    relayDeployEnvironment = '',
    tracked = true,
  },
) {
  const directory = path.join(envRepo, 'peers-touch', name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, 'profile.env.example'),
    [
      `PT_DEV_PROFILE=${name}`,
      'PT_DEV_SLOT=2',
      'PT_STATION_MODE=remote',
      `PT_STATION_NAME=${name}`,
      `PT_STATION_URL=${stationUrl}`,
      `PT_STATION_DEPLOY_ENV=${deployEnvironment}`,
      `PT_RELAY_URL=${relayUrl}`,
      `PT_RELAY_DEPLOY_ENV=${relayDeployEnvironment}`,
      'PT_AGENT_PROVIDER_API_KEY=must-not-leak',
      '',
    ].join('\n'),
  );
  if (tracked) {
    git(envRepo, 'add', `peers-touch/${name}`);
    git(envRepo, 'commit', '-m', `test: add ${name}`);
  }
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'peers-dev-status-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: root });
  git(root, 'config', 'user.email', 'peers-dev-test@example.invalid');
  git(root, 'config', 'user.name', 'Peers Dev Test');
  writeFileSync(path.join(root, 'README.md'), 'fixture\n');
  git(root, 'add', 'README.md');
  git(root, 'commit', '-m', 'test: initialize environment fixture');
  return {
    root,
    close() {
      rmSync(root, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 20,
      });
    },
  };
}

function fakePlanPackage(workspaceId, head) {
  return {
    manifest: {
      planId: 'TEST-PLAN',
      status: 'active',
      binding: {
        workspaceId,
        branch: 'main',
        initialHead: head,
      },
      tasks: [
        {
          id: 'TEST-DONE',
          status: 'done',
          dependsOn: [],
        },
        {
          id: 'TEST-CURRENT',
          status: 'in_progress',
          dependsOn: ['TEST-DONE'],
        },
      ],
    },
    taskSlices: new Map([
      [
        'TEST-CURRENT',
        {
          taskId: 'TEST-CURRENT',
          title: 'Current test task',
          workstreamId: 'TEST-WORKSTREAM',
          completionClass: 'functional',
          runtimeClass: 'source-only',
          closureId: 'TEST-CLOSURE',
        },
      ],
    ]),
    currentTask: {
      taskId: 'TEST-CURRENT',
      title: 'Current test task',
      workstreamId: 'TEST-WORKSTREAM',
      completionClass: 'functional',
      runtimeClass: 'source-only',
      closureId: 'TEST-CLOSURE',
    },
    acceptance: {
      closures: {
        'TEST-CLOSURE': [],
      },
    },
  };
}

test('collectProfiles exposes only selected public fields', () => {
  const scope = fixture();
  try {
    addProfile(scope.root, 'managed-one', {
      stationUrl: 'http://192.0.2.1:18080',
      deployEnvironment: 'station-one',
      relayUrl:
        'http://fixture-user:fixture-value@192.0.2.1:18081/path?token=fixture-value',
      relayDeployEnvironment: 'relay-one',
    });
    addProfile(scope.root, 'untracked-disposable', {
      stationUrl: 'http://192.0.2.2:18132',
      deployEnvironment: 'station-disposable',
      tracked: false,
    });
    addProfile(scope.root, 'bad profile', {
      stationUrl: 'http://192.0.2.3:18132',
      deployEnvironment: 'station-bad',
    });

    const profiles = collectProfiles(scope.root);
    assert.deepEqual(
      profiles.map((profile) => [
        profile.name,
        profile.resetPolicy,
        profile.sourceState,
        profile.status,
      ]),
      [
        ['bad profile', null, 'tracked-clean', 'blocked'],
        ['managed-one', 'agent-resettable', 'tracked-clean', 'available'],
        [
          'untracked-disposable',
          'agent-resettable',
          'untracked',
          'blocked',
        ],
      ],
    );
    assert.equal(profiles[0].error.code, 'PROFILE_IDENTITY_INVALID');
    assert.equal(profiles[1].relayUrl, 'http://192.0.2.1:18081/path');
    assert.equal(JSON.stringify(profiles).includes('must-not-leak'), false);
  } finally {
    scope.close();
  }
});

test('resolveDeclarationPlan uses only declaration and immutable workspace binding', async () => {
  const scope = fixture();
  try {
    const workspaceId = workspaceIdForRoot(scope.root);
    const head = git(scope.root, 'rev-parse', 'HEAD');
    const planDirectory = path.join(
      scope.root,
      'docs',
      'architecture',
      'example',
      'execution-plans',
      'test-plan',
    );
    mkdirSync(planDirectory, { recursive: true });
    writeFileSync(
      path.join(planDirectory, 'plan.md'),
      '{"planId":"TEST-PLAN"}\n',
    );
    const declaration = {
      workItemId: 'TEST-WORK',
      sessionId: 'TEST-SESSION',
      workspaceId,
      branch: 'main',
      sourceHead: head,
      planPath:
        'docs/architecture/example/execution-plans/test-plan/plan.md',
      planId: 'TEST-PLAN',
      taskId: 'TEST-CURRENT',
    };
    const registration = {
      workspaceId,
      canonicalRoot: scope.root,
    };
    const loadPlanPackage = async () => fakePlanPackage(workspaceId, head);
    const resolveWorkspacePlanBinding = async () => ({
      planId: 'TEST-PLAN',
      planPath: declaration.planPath,
    });

    const direct = await resolveDeclarationPlan(declaration, registration, {
      home: scope.root,
      loadPlanPackage,
      resolveWorkspacePlanBinding,
      readSession: () => ({
        kind: 'peers-touch-development-session',
        eventDigest: 'a'.repeat(64),
        state: {
          sessionId: 'TEST-SESSION',
          workItemId: 'TEST-WORK',
          planId: 'TEST-PLAN',
          taskId: 'TEST-CURRENT',
          workspaceId,
          branch: 'main',
          state: 'DELIVERY_READY',
          updatedAt: '2026-09-26T00:00:00.000Z',
          lastVerification: {
            verificationClass: 'FUNCTIONAL_CHECK',
            result: 'PASS',
            durationMs: 12,
          },
          currentFailure: null,
        },
      }),
      readReview: () => ({
        state: 'PASS',
        reviewedAt: '2026-09-26T00:01:00.000Z',
        reviewId: 'review-test',
      }),
    });
    assert.equal(direct.status, 'available');
    assert.equal(direct.locatorSource, 'declaration');
    assert.equal(direct.stages[3].state, 'active');
    assert.equal(direct.task.id, 'TEST-CURRENT');
    assert.deepEqual(
      direct.task.segments.map((segment) => segment.state),
      ['done', 'done', 'not_required', 'done'],
    );
    assert.equal(direct.review.state, 'PASS');
    assert.deepEqual(
      {
        completed: direct.progress.completed,
        total: direct.progress.total,
        percentage: direct.progress.percentage,
        completedAfter:
          direct.progress.nextProgressBoundary.completedAfter,
        percentageAfter:
          direct.progress.nextProgressBoundary.percentageAfter,
      },
      {
        completed: 1,
        total: 2,
        percentage: 50,
        completedAfter: 2,
        percentageAfter: 100,
      },
    );

    const boundWithoutLocator = await resolveDeclarationPlan(
      {
        ...declaration,
        planPath: undefined,
        planId: undefined,
        taskId: undefined,
      },
      registration,
      {
        home: scope.root,
        loadPlanPackage,
        resolveWorkspacePlanBinding,
      },
    );
    assert.equal(boundWithoutLocator.status, 'mismatch');
    assert.equal(
      boundWithoutLocator.errorCode,
      'WORKSPACE_PLAN_DECLARATION_REQUIRED',
    );

    const untracked = await resolveDeclarationPlan(
      {
        workItemId: 'UNTRACKED-WORK',
        workspaceId,
        branch: 'main',
        sourceHead: head,
      },
      registration,
      {
        home: scope.root,
        async resolveWorkspacePlanBinding() {
          const error = new Error('binding absent');
          error.code = 'WORKSPACE_PLAN_BINDING_REQUIRED';
          throw error;
        },
      },
    );
    assert.equal(untracked.status, 'untracked');

    const mismatched = await resolveDeclarationPlan(
      { ...declaration, taskId: 'OTHER-TASK' },
      registration,
      { home: scope.root, loadPlanPackage, resolveWorkspacePlanBinding },
    );
    assert.equal(mismatched.status, 'mismatch');
    assert.equal(mismatched.errorCode, 'PLAN_LOCATOR_MISMATCH');

    const bindingMismatch = await resolveDeclarationPlan(
      declaration,
      registration,
      {
        home: scope.root,
        loadPlanPackage,
        async resolveWorkspacePlanBinding() {
          return {
            planId: 'FOREIGN-PLAN',
            planPath:
              'docs/architecture/example/execution-plans/foreign/plan.md',
          };
        },
      },
    );
    assert.equal(bindingMismatch.status, 'mismatch');
    assert.equal(bindingMismatch.errorCode, 'PLAN_LOCATOR_MISMATCH');
  } finally {
    scope.close();
  }
});

test('buildDevSnapshot joins worktree resources and redacts authority paths', async () => {
  const scope = fixture();
  try {
    addProfile(scope.root, 'managed-one', {
      stationUrl: 'http://192.0.2.1:18080',
      deployEnvironment: 'station-one',
      relayUrl: 'http://192.0.2.1:18081',
      relayDeployEnvironment: 'relay-one',
    });
    const workspaceId = '0123456789abcdef';
    const server = {
      kind: 'peers-touch-dev-server',
      endpoint: 'http://127.0.0.1:4177',
      startedAt: '2026-09-17T00:00:00.000Z',
      source: {
        workspaceId,
        branch: 'feat/dev',
        head: '1'.repeat(40),
      },
    };
    const snapshot = await buildDevSnapshot({
      envRepo: scope.root,
      activeWork: { records: [], errors: [] },
      server,
      machineStatus: {
        authority: 'machine-control-plane',
        registrations: [
          {
            workspaceId,
            name: 'feature-worktree',
            branch: 'feat/dev',
            profile: 'managed-one',
            slot: 2,
            allowedCapabilities: ['station.connect', 'station.deploy'],
            purpose: 'Peers Dev test',
            owner: 'peers-dev-test@example.invalid',
            activity: 'active',
            resetPolicy: 'agent-resettable',
            profileState: 'available',
            profileError: null,
            canonicalRoot: '/private/path/must-not-leak',
          },
        ],
        activeLeases: [
          {
            leaseId: 'lease-1',
            resourceKind: 'station.deploy',
            resourceId: 'station-one',
            workspaceId,
            acquiredAt: '2026-09-17T00:00:00.000Z',
            leaseFile: '/private/path/must-not-leak.lock',
          },
        ],
        staleLeaseMetadata: [],
        unregisteredObservations: null,
      },
      ledger: {
        declarations: {
          declaration: {
            declarationId: 'work-1',
            workItemId: 'work',
            workspaceId,
            branch: 'feat/dev',
            owner: 'peers-dev-test@example.invalid',
            purpose: 'Peers Dev test',
            journeyId: 'DEV-J01',
            state: 'ACTIVE',
            expiresAt: '2026-09-17T08:00:00.000Z',
            runtimeClaims: [
              {
                kind: 'profile',
                resourceId: 'managed-one',
                mode: 'shared',
              },
              {
                kind: 'station.connect',
                resourceId: 'station-one',
                mode: 'shared',
              },
              {
                kind: 'relay.deploy',
                resourceId: 'relay-one',
                mode: 'exclusive',
              },
              {
                kind: 'database',
                resourceId: 'chat-postgres',
                mode: 'exclusive',
              },
            ],
          },
        },
      },
      now: new Date('2026-09-17T00:30:00.000Z'),
    });

    assert.equal(snapshot.kind, 'peers-touch-dev-snapshot');
    assert.deepEqual(snapshot.server, server);
    assert.equal(snapshot.worktrees[0].workState, 'in-progress');
    assert.equal(snapshot.worktrees[0].environmentHealth.state, 'ready');
    assert.equal(
      snapshot.worktrees[0].resources.relay.claims[0].resourceId,
      'relay-one',
    );
    assert.equal(
      snapshot.worktrees[0].resources.databases[0].resourceId,
      'chat-postgres',
    );
    const serialized = JSON.stringify(snapshot);
    assert.equal(serialized.includes('/private/path'), false);
    assert.equal(serialized.includes('must-not-leak'), false);
  } finally {
    scope.close();
  }
});

test('buildDevSnapshot aggregates workspace-owned active work without cross-workspace writes', async () => {
  const scope = fixture();
  try {
    const workspaceId = '0123456789abcdef';
    const activeWork = {
      workspaceId,
      workItemId: 'DWF-ACTIVE-WORK',
      planId: 'DWF-PLAN',
      planPath: 'docs/architecture/dwf/execution-plans/test/plan.md',
      planStatus: 'active',
      currentTaskId: 'DWF-T1',
      currentTaskPath:
        'docs/architecture/dwf/execution-plans/test/tasks/DWF-T1.md',
      taskStatus: 'in_progress',
      sessionId: 'dwf-session',
      journeyId: 'DWF-J01',
      devState: 'IMPLEMENTING',
      branch: 'feature/dwf',
      initialHead: '1'.repeat(40),
      expectedHead: '2'.repeat(40),
      revision: 3,
      updatedAt: '2026-09-19T08:00:00.000Z',
    };
    const snapshot = await buildDevSnapshot({
      envRepo: scope.root,
      activeWork: {
        records: [activeWork],
        errors: [
          {
            workspaceId: 'fedcba9876543210',
            code: 'ACTIVE_WORK_INVALID',
            message: 'invalid record',
          },
        ],
      },
      machineStatus: {
        authority: 'machine-control-plane',
        registrations: [
          {
            workspaceId,
            name: 'dwf-consumer',
            branch: 'feature/dwf',
            profile: null,
            slot: null,
            allowedCapabilities: [],
            purpose: 'active-work aggregation test',
            owner: 'peers-dev-test@example.invalid',
            activity: 'active',
            resetPolicy: 'agent-resettable',
            profileState: 'available',
            profileError: null,
          },
        ],
        activeLeases: [],
        staleLeaseMetadata: [],
        unregisteredObservations: null,
      },
      ledger: { declarations: {} },
      now: new Date('2026-09-19T08:00:00.000Z'),
    });

    assert.equal(snapshot.activeWork.records.length, 1);
    assert.equal(snapshot.activeWork.errors.length, 1);
    assert.equal(snapshot.worktrees[0].workState, 'in-progress');
    assert.equal(snapshot.worktrees[0].activeWork.currentTaskId, 'DWF-T1');
    assert.equal(snapshot.worktrees[0].workflow.plan.id, 'DWF-PLAN');
    assert.equal(snapshot.worktrees[0].workflow.task.id, 'DWF-T1');
    assert.equal(snapshot.worktrees[0].workflow.stages[3].state, 'active');
    assert.equal(snapshot.worktrees[0].agentActivity.state, 'idle');
    assert.match(snapshot.digest, /^[0-9a-f]{64}$/);
    assert.equal(
      JSON.stringify(snapshot).includes('/Users/'),
      false,
    );
  } finally {
    scope.close();
  }
});

test('declaration-only worktrees remain visible as unregistered', async () => {
  const scope = fixture();
  try {
    const workspaceId = 'fedcba9876543210';
    const snapshot = await buildDevSnapshot({
      envRepo: scope.root,
      activeWork: { records: [], errors: [] },
      machineStatus: {
        authority: 'machine-control-plane',
        registrations: [],
        activeLeases: [],
        staleLeaseMetadata: [],
        unregisteredObservations: null,
      },
      ledger: {
        declarations: {
          declaration: {
            declarationId: `work-${workspaceId}`,
            workItemId: 'work',
            workspaceId,
            branch: 'feat/unregistered',
            owner: 'peers-dev-test@example.invalid',
            purpose: 'unregistered worktree test',
            journeyId: 'TEST-J01',
            state: 'ACTIVE',
            expiresAt: '2026-09-17T08:00:00.000Z',
            runtimeClaims: [],
          },
        },
      },
      now: new Date('2026-09-17T00:30:00.000Z'),
    });

    assert.equal(snapshot.worktrees.length, 1);
    assert.equal(snapshot.worktrees[0].workState, 'in-progress');
    assert.equal(
      snapshot.worktrees[0].environmentHealth.state,
      'unregistered',
    );
    assert.equal(snapshot.worktrees[0].name, null);
    assert.deepEqual(snapshot.worktrees[0].branches, ['feat/unregistered']);
  } finally {
    scope.close();
  }
});

test('work progress remains in progress while environment health is blocked and stale work stays visible', async () => {
  const scope = fixture();
  try {
    addProfile(scope.root, 'managed-one', {
      stationUrl: 'http://192.0.2.1:18080',
      deployEnvironment: 'station-one',
    });
    const profileFile = path.join(
      scope.root,
      'peers-touch',
      'managed-one',
      'profile.env.example',
    );
    writeFileSync(
      profileFile,
      `${readFileSync(profileFile, 'utf8')}# local change\n`,
    );
    const workspaceId = '0123456789abcdef';
    const baseDeclaration = {
      workspaceId,
      branch: 'feat/dev',
      owner: 'peers-dev-test@example.invalid',
      purpose: 'Peers Dev state separation',
      journeyId: 'DEV-J01',
      expiresAt: '2026-09-17T08:00:00.000Z',
      runtimeClaims: [],
    };
    const snapshot = await buildDevSnapshot({
      envRepo: scope.root,
      activeWork: { records: [], errors: [] },
      machineStatus: {
        authority: 'machine-control-plane',
        registrations: [
          {
            workspaceId,
            canonicalRoot: scope.root,
            name: 'feature-worktree',
            branch: 'feat/dev',
            profile: 'managed-one',
            slot: 2,
            allowedCapabilities: [],
            purpose: 'Peers Dev test',
            owner: 'peers-dev-test@example.invalid',
            activity: 'stale',
            resetPolicy: 'agent-resettable',
            profileState: 'blocked',
            profileError: {
              code: 'PROFILE_SOURCE_UNREVIEWED',
              message: 'Profile source is dirty',
            },
          },
        ],
        activeLeases: [],
        staleLeaseMetadata: [],
        unregisteredObservations: null,
      },
      ledger: {
        declarations: {
          active: {
            ...baseDeclaration,
            declarationId: `active-${workspaceId}`,
            workItemId: 'ACTIVE-WORK',
            state: 'ACTIVE',
          },
          blocked: {
            ...baseDeclaration,
            declarationId: `blocked-${workspaceId}`,
            workItemId: 'BLOCKED-WORK',
            state: 'ACTIVE',
          },
          stale: {
            ...baseDeclaration,
            declarationId: `stale-${workspaceId}`,
            workItemId: 'STALE-WORK',
            state: 'STALE',
            runtimeClaims: [
              {
                kind: 'database',
                resourceId: 'must-not-count',
                mode: 'exclusive',
              },
            ],
          },
        },
      },
      resolvePlan: async (declaration) =>
        declaration.workItemId === 'ACTIVE-WORK'
          ? {
              status: 'available',
              locatorSource: 'declaration',
              planId: 'TEST-PLAN',
              taskId: 'TEST-CURRENT',
              planStatus: 'active',
              currentTaskId: 'TEST-CURRENT',
              progress: {
                completed: 3,
                total: 8,
                percentage: 37.5,
              },
              errorCode: null,
            }
          : declaration.workItemId === 'BLOCKED-WORK'
            ? {
                status: 'available',
                locatorSource: 'declaration',
                planId: 'BLOCKED-PLAN',
                taskId: null,
                planStatus: 'blocked',
                currentTaskId: null,
                progress: {
                  completed: 2,
                  total: 4,
                  percentage: 50,
                },
                errorCode: null,
              }
          : {
              status: 'legacy',
              locatorSource: null,
              planId: null,
              taskId: null,
              planStatus: null,
              currentTaskId: null,
              progress: null,
              errorCode: 'LEGACY_PLAN_UNSUPPORTED',
            },
      now: new Date('2026-09-17T00:30:00.000Z'),
    });

    const [worktree] = snapshot.worktrees;
    assert.equal(worktree.workState, 'in-progress');
    assert.equal(worktree.environmentHealth.state, 'blocked');
    assert.deepEqual(
      worktree.requirements.map((requirement) => [
        requirement.workItemId,
        requirement.state,
      ]),
      [
        ['ACTIVE-WORK', 'ACTIVE'],
        ['BLOCKED-WORK', 'ACTIVE'],
        ['STALE-WORK', 'STALE'],
      ],
    );
    assert.equal(worktree.resources.databases.length, 0);
  } finally {
    scope.close();
  }
});

test('Git discovery owns current source identity and freshness keeps separate clocks', async () => {
  const scope = fixture();
  try {
    const workspaceId = '0123456789abcdef';
    const snapshot = await buildDevSnapshot({
      envRepo: scope.root,
      discovery: {
        checkedAt: '2026-09-23T01:00:20.000Z',
        available: true,
        error: null,
        records: [
          {
            workspaceId,
            canonicalRoot: '/private/path/must-not-leak',
            name: 'current-worktree',
            branch: 'feature/current',
            head: '3'.repeat(40),
            detached: false,
            checkedAt: '2026-09-23T01:00:20.000Z',
          },
          {
            workspaceId: 'fedcba9876543210',
            canonicalRoot: '/private/other/must-not-leak',
            name: 'discovered-only',
            branch: 'feature/discovered',
            head: '4'.repeat(40),
            detached: false,
            checkedAt: '2026-09-23T01:00:20.000Z',
          },
        ],
      },
      observations: {
        records: [
          {
            kind: 'peers-touch-worktree-observation',
            workspaceId,
            name: 'current-worktree',
            branch: 'feature/current',
            head: '3'.repeat(40),
            dirty: true,
            reporter: { host: 'trae', event: 'UserPromptSubmit' },
            reportedAt: '2026-09-23T01:00:10.000Z',
            recordDigest: '5'.repeat(64),
          },
        ],
        errors: [],
      },
      activeWork: {
        records: [
          {
            workspaceId,
            workItemId: 'STALE-WORK',
            planId: 'STALE-PLAN',
            planPath: 'docs/architecture/stale/plan.md',
            planStatus: 'active',
            currentTaskId: 'STALE-TASK',
            currentTaskPath: 'docs/architecture/stale/task.md',
            taskStatus: 'in_progress',
            sessionId: 'stale-session',
            journeyId: 'DUI-J01',
            devState: 'IMPLEMENTING',
            branch: 'feature/old',
            initialHead: '1'.repeat(40),
            expectedHead: '2'.repeat(40),
            revision: 2,
            updatedAt: '2026-09-23T00:59:00.000Z',
          },
        ],
        errors: [],
      },
      machineStatus: {
        authority: 'machine-control-plane',
        registrations: [
          {
            workspaceId,
            name: 'registered-name',
            branch: 'feature/old',
            profile: null,
            slot: null,
            allowedCapabilities: [],
            purpose: 'stale registration',
            owner: 'test@example.invalid',
            updatedAt: '2026-09-23T00:58:00.000Z',
            activity: 'stale',
            resetPolicy: null,
            profileState: 'available',
            profileError: null,
          },
        ],
        activeLeases: [],
        staleLeaseMetadata: [],
        unregisteredObservations: null,
      },
      ledger: { declarations: {} },
      now: new Date('2026-09-23T01:00:20.000Z'),
    });

    const current = snapshot.worktrees.find(
      (worktree) => worktree.workspaceId === workspaceId,
    );
    const discoveredOnly = snapshot.worktrees.find(
      (worktree) => worktree.workspaceId === 'fedcba9876543210',
    );
    assert.equal(current.name, 'current-worktree');
    assert.deepEqual(current.branches, ['feature/current']);
    assert.equal(current.git.head, '3'.repeat(40));
    assert.equal(current.git.dirty, true);
    assert.equal(current.workState, 'stale');
    assert.equal(current.freshness.state, 'stale');
    assert.deepEqual(current.freshness.issues, ['WORKFLOW_SOURCE_STALE']);
    assert.equal(current.freshness.lastReportedAt, '2026-09-23T01:00:10.000Z');
    assert.equal(current.freshness.stateUpdatedAt, '2026-09-23T00:59:00.000Z');
    assert.equal(current.freshness.checkedAt, '2026-09-23T01:00:20.000Z');
    assert.equal(discoveredOnly.workState, 'observed');
    assert.equal(discoveredOnly.freshness.state, 'unreported');
    assert.equal(JSON.stringify(snapshot).includes('/private/path'), false);
    assert.equal(JSON.stringify(snapshot).includes('/private/other'), false);
  } finally {
    scope.close();
  }
});

test('corrupt or orphan observations degrade one row without hiding others', async () => {
  const scope = fixture();
  try {
    const snapshot = await buildDevSnapshot({
      envRepo: scope.root,
      discovery: {
        checkedAt: '2026-09-23T01:10:00.000Z',
        available: true,
        error: null,
        records: [],
      },
      observations: {
        records: [],
        errors: [
          {
            workspaceId: '0123456789abcdef',
            code: 'WORKTREE_OBSERVATION_INVALID',
            message: 'invalid report',
          },
        ],
      },
      activeWork: { records: [], errors: [] },
      machineStatus: {
        authority: 'machine-control-plane',
        registrations: [],
        activeLeases: [],
        staleLeaseMetadata: [],
        unregisteredObservations: null,
      },
      ledger: { declarations: {} },
      now: new Date('2026-09-23T01:10:00.000Z'),
    });
    assert.equal(snapshot.worktrees.length, 1);
    assert.equal(snapshot.worktrees[0].freshness.state, 'invalid');
    assert.deepEqual(snapshot.worktrees[0].freshness.issues, [
      'WORKTREE_OBSERVATION_INVALID',
    ]);
  } finally {
    scope.close();
  }
});

test('action receipts reduce independently from Plan progress', () => {
  const repeated = Array.from({ length: 4 }, (_, index) => ({
    sequence: index + 1,
    actionId: `action-${index}`,
    event: 'FINISHED',
    result: 'PASS',
    operation: {
      family: 'WRITE',
      label: 'apply_patch',
      targetRef: 'apps/dev',
    },
    fingerprint: 'a'.repeat(64),
    progressStamp: 'b'.repeat(64),
    at: `2026-09-26T00:00:0${index}.000Z`,
    leaseUntil: null,
  }));
  assert.equal(
    reduceWorkflowActivity(repeated, {
      now: new Date('2026-09-26T00:01:00.000Z'),
    }).state,
    'looping',
  );
  assert.equal(
    reduceWorkflowActivity(repeated, {
      now: new Date('2026-09-26T00:01:00.000Z'),
      drift: true,
    }).state,
    'drift',
  );
});
