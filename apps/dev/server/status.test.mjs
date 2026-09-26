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
  buildDevSnapshot,
  collectProfiles,
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

test('collectProfiles exposes only selected public fields', () => {
  const scope = fixture();
  try {
    addProfile(scope.root, 'dev-one', {
      stationUrl: 'http://192.0.2.1:18080',
      deployEnvironment: 'station-one',
      relayUrl:
        'http://dashboard:must-not-leak@192.0.2.1:18081/path?token=secret',
      relayDeployEnvironment: 'relay-one',
    });
    addProfile(scope.root, 'untracked-lab', {
      stationUrl: 'http://192.0.2.2:18132',
      deployEnvironment: 'station-lab',
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
        ['dev-one', 'agent-resettable', 'tracked-clean', 'available'],
        [
          'untracked-lab',
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

test('buildDevSnapshot joins worktree resources and redacts authority paths', async () => {
  const scope = fixture();
  try {
    addProfile(scope.root, 'dev-one', {
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
            profile: 'dev-one',
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
                resourceId: 'dev-one',
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
    assert.equal(
      JSON.stringify(snapshot).includes('/Users/'),
      false,
    );
  } finally {
    scope.close();
  }
});

test('buildDevSnapshot projects the canonical workflow verdict without recomputing it', async () => {
  const scope = fixture();
  try {
    const workspaceId = '0123456789abcdef';
    const workflow = {
      kind: 'peers-touch-workflow-snapshot',
      observedAt: '2026-09-20T00:00:00.000Z',
      workspaceId,
      verdict: 'DRIFT',
      findings: [
        {
          severity: 'error',
          code: 'WORKFLOW_OWNER_MISMATCH',
          owner: 'active-work',
          field: 'currentTaskId',
          expected: 'TASK-2',
          actual: 'TASK-1',
        },
      ],
      owners: {
        plan: { status: 'active' },
      },
    };
    const snapshot = await buildDevSnapshot({
      envRepo: scope.root,
      activeWork: { records: [], errors: [] },
      workflowSnapshots: [workflow],
      machineStatus: {
        authority: 'machine-control-plane',
        registrations: [
          {
            workspaceId,
            name: 'workflow-consumer',
            branch: 'feature/workflow',
            profile: null,
            slot: null,
            allowedCapabilities: [],
            purpose: 'workflow snapshot projection',
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
      now: new Date('2026-09-20T00:00:00.000Z'),
    });

    assert.deepEqual(snapshot.workflowSnapshots, [workflow]);
    assert.equal(snapshot.worktrees[0].workflow, workflow);
    assert.equal(snapshot.worktrees[0].workState, 'drift');
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
    addProfile(scope.root, 'dev-one', {
      stationUrl: 'http://192.0.2.1:18080',
      deployEnvironment: 'station-one',
    });
    const profileFile = path.join(
      scope.root,
      'peers-touch',
      'dev-one',
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
            profile: 'dev-one',
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
