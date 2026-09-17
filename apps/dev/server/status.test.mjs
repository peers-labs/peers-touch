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

import {
  workspaceIdForRoot,
  workspaceWorkflowPath,
} from '../../../tooling/scripts/lib/machine-dev-paths.mjs';
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
    agentControlMode,
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
      `PT_AGENT_CONTROL_MODE=${agentControlMode}`,
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
      rmSync(root, { recursive: true, force: true });
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
        expectedHead: head,
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
      ['TEST-CURRENT', { title: 'Current test task' }],
    ]),
  };
}

test('collectProfiles exposes only selected public fields', () => {
  const scope = fixture();
  try {
    addProfile(scope.root, 'managed-one', {
      agentControlMode: 'managed',
      stationUrl: 'http://10.10.0.1:18080',
      deployEnvironment: 'station-one',
      relayUrl:
        'http://dashboard:must-not-leak@10.10.0.1:18081/path?token=secret',
      relayDeployEnvironment: 'relay-one',
    });
    addProfile(scope.root, 'untracked-disposable', {
      agentControlMode: 'disposable',
      stationUrl: 'http://10.10.0.2:18132',
      deployEnvironment: 'station-disposable',
      tracked: false,
    });

    const profiles = collectProfiles(scope.root);
    assert.deepEqual(
      profiles.map((profile) => [
        profile.name,
        profile.agentControlMode,
        profile.sourceState,
        profile.status,
      ]),
      [
        ['managed-one', 'managed', 'tracked-clean', 'available'],
        [
          'untracked-disposable',
          'disposable',
          'untracked',
          'blocked',
        ],
      ],
    );
    assert.equal(profiles[0].relayUrl, 'http://10.10.0.1:18081/path');
    assert.equal(JSON.stringify(profiles).includes('must-not-leak'), false);
  } finally {
    scope.close();
  }
});

test('resolveDeclarationPlan supports explicit, session, mismatch, and legacy states', async () => {
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

    const direct = await resolveDeclarationPlan(declaration, registration, {
      home: scope.root,
      loadPlanPackage,
    });
    assert.equal(direct.status, 'available');
    assert.equal(direct.locatorSource, 'declaration');
    assert.deepEqual(
      {
        completed: direct.progress.completed,
        total: direct.progress.total,
        percentage: direct.progress.percentage,
      },
      { completed: 1, total: 2, percentage: 50 },
    );

    const sessionDirectory = workspaceWorkflowPath('TEST-WORK', {
      home: scope.root,
      workspaceId,
    });
    mkdirSync(sessionDirectory, { recursive: true });
    writeFileSync(
      path.join(sessionDirectory, 'session.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        kind: 'peers-touch-development-session',
        eventCount: 1,
        eventDigest: '0'.repeat(64),
        state: {
          sessionId: 'test-session',
          workItemId: 'TEST-WORK',
          planId: 'TEST-PLAN',
          taskId: 'TEST-CURRENT',
          workspaceId,
          branch: 'main',
          journeyId: 'TEST-J01',
          executionMode: 'build',
          state: 'IMPLEMENTING',
          source: null,
          runtimeBindingRef: null,
          currentFailure: null,
          lastVerification: null,
          startedAt: '2026-09-17T00:00:00.000Z',
          updatedAt: '2026-09-17T00:00:00.000Z',
        },
      })}\n`,
    );
    const sessionDerived = await resolveDeclarationPlan(
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
      },
    );
    assert.equal(sessionDerived.status, 'available');
    assert.equal(sessionDerived.locatorSource, 'session');

    const mismatched = await resolveDeclarationPlan(
      { ...declaration, taskId: 'OTHER-TASK' },
      registration,
      { home: scope.root, loadPlanPackage },
    );
    assert.equal(mismatched.status, 'mismatch');
    assert.equal(mismatched.errorCode, 'PLAN_LOCATOR_MISMATCH');

    const packageTasks = path.join(planDirectory, 'tasks');
    mkdirSync(packageTasks, { recursive: true });
    writeFileSync(
      path.join(packageTasks, 'UNTRACKED-WORK.md'),
      '# Package task\n\nUNTRACKED-WORK\n',
    );
    const untracked = await resolveDeclarationPlan(
      {
        workItemId: 'UNTRACKED-WORK',
        workspaceId,
        branch: 'main',
        sourceHead: head,
      },
      registration,
      { home: scope.root, loadPlanPackage },
    );
    assert.equal(untracked.status, 'untracked');

    writeFileSync(
      path.join(
        scope.root,
        'docs',
        'architecture',
        'example',
        'execution-plans',
        'legacy.md',
      ),
      '# Legacy\n\nLEGACY-W8 remains in progress.\n',
    );
    const legacy = await resolveDeclarationPlan(
      {
        workItemId: 'LEGACY-W8',
        workspaceId,
        branch: 'main',
        sourceHead: head,
      },
      registration,
      { home: scope.root, loadPlanPackage },
    );
    assert.equal(legacy.status, 'legacy');
    assert.equal(legacy.errorCode, 'LEGACY_PLAN_UNSUPPORTED');
  } finally {
    scope.close();
  }
});

test('buildDevSnapshot joins worktree resources and redacts authority paths', async () => {
  const scope = fixture();
  try {
    addProfile(scope.root, 'managed-one', {
      agentControlMode: 'managed',
      stationUrl: 'http://10.10.0.1:18080',
      deployEnvironment: 'station-one',
      relayUrl: 'http://10.10.0.1:18081',
      relayDeployEnvironment: 'relay-one',
    });
    const workspaceId = '0123456789abcdef';
    const server = {
      schemaVersion: 1,
      kind: 'peers-touch-dev-server',
      protocolVersion: 2,
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
            agentControlMode: 'managed',
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

test('declaration-only worktrees remain visible as unregistered', async () => {
  const scope = fixture();
  try {
    const workspaceId = 'fedcba9876543210';
    const snapshot = await buildDevSnapshot({
      envRepo: scope.root,
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
      agentControlMode: 'managed',
      stationUrl: 'http://10.10.0.1:18080',
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
            agentControlMode: 'managed',
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
