import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  machineLeasePath,
  machineRegistryPath,
  workspaceIdForRoot,
} from '../lib/machine-dev-paths.mjs';
import {
  releaseDeclaration,
  startOrUpdateDeclaration,
} from './dev-work.mjs';
import {
  clearActiveWorkRecord,
  updateActiveWorkRecord,
} from './active-work-store.mjs';
import {
  buildLeaseCommand,
  MachineDevError,
  checkWorkspace,
  observeLeases,
  registerWorkspace,
  statusAll,
  unregisterWorkspace,
  updateWorkspace,
} from './machine-dev-registry.mjs';
import { acquireWorkspaceLifecycleLockSync } from './workspace-lifecycle-lock.mjs';

const cli = fileURLToPath(new URL('./machine-dev.mjs', import.meta.url));
const leaseCli = fileURLToPath(new URL('./machine-dev-lease.py', import.meta.url));

function git(directory, ...args) {
  return execFileSync('git', args, {
    cwd: directory,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function initializeGitRepository(directory, branch = 'feat/test') {
  mkdirSync(directory, { recursive: true });
  execFileSync('git', ['init', '-b', branch], { cwd: directory });
  git(directory, 'config', 'user.email', 'machine-dev-test@example.invalid');
  git(directory, 'config', 'user.name', 'Machine Dev Test');
  writeFileSync(path.join(directory, 'README.md'), 'fixture\n');
  git(directory, 'add', 'README.md');
  git(directory, 'commit', '-m', 'test: initialize fixture');
}

function profileText({
  name,
  agentControlMode = 'disposable',
  mode = 'remote',
  stationUrl = 'http://192.0.2.4:18080',
  deployEnvironment = 'station-four',
}) {
  return [
    `PT_DEV_PROFILE=${name}`,
    'PT_DEV_SLOT=1',
    `PT_AGENT_CONTROL_MODE=${agentControlMode}`,
    `PT_STATION_MODE=${mode}`,
    `PT_STATION_NAME=${name}`,
    `PT_STATION_URL=${stationUrl}`,
    'PT_STATION_PORT=18080',
    `PT_STATION_DEPLOY_ENV=${deployEnvironment}`,
    `PT_STATION_HEALTH_URL=${stationUrl}/sub-oss/healthz`,
    'PT_DESKTOP_APP_GATEWAY_PORT=3130',
    'PT_DESKTOP_APP_WEB_PORT=3310',
    'PT_DESKTOP_WEB_GATEWAY_PORT=3131',
    'PT_DESKTOP_WEB_WEB_PORT=3311',
    'PT_MOBILE_WEB_PORT=5273',
    '',
  ].join('\n');
}

function addProfile(
  scope,
  {
    name,
    agentControlMode,
    mode,
    stationUrl,
    deployEnvironment,
    deployHost,
    tracked = true,
  },
) {
  const profileDirectory = path.join(scope.envRepo, 'peers-touch', name);
  const deployDirectory = path.join(profileDirectory, 'deploy');
  mkdirSync(deployDirectory, { recursive: true });
  writeFileSync(
    path.join(profileDirectory, 'profile.env.example'),
    profileText({
      name,
      agentControlMode,
      mode,
      stationUrl,
      deployEnvironment,
    }),
  );
  if (deployEnvironment) {
    writeFileSync(
      path.join(deployDirectory, `${deployEnvironment}.env.example`),
      [
        `PT_DEPLOY_HOST=${deployHost}`,
        'PT_DEPLOY_USER=tester',
        'PT_DEPLOY_PATH=peers-touch/repo',
        'PT_DEPLOY_ROLE=station',
        '',
      ].join('\n'),
    );
  }
  if (tracked) {
    git(scope.envRepo, 'add', `peers-touch/${name}`);
    git(scope.envRepo, 'commit', '-m', `test: add ${name} profile`);
  }
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'pt-machine-dev-'));
  const home = path.join(root, 'home');
  const workspaceA = path.join(root, 'workspace-a');
  const workspaceB = path.join(root, 'workspace-b');
  const envRepo = path.join(root, 'env');
  mkdirSync(home, { recursive: true });
  initializeGitRepository(workspaceA);
  initializeGitRepository(workspaceB, 'feat/other');
  initializeGitRepository(envRepo, 'main');
  const scope = {
    root,
    home,
    workspaceA,
    workspaceB,
    envRepo,
    close() {
      rmSync(root, { recursive: true, force: true });
    },
  };
  addProfile(scope, {
    name: 'four',
    stationUrl: 'http://192.0.2.4:18080',
    deployEnvironment: 'station-four',
    deployHost: '192.0.2.4',
  });
  addProfile(scope, {
    name: 'fiveArm',
    agentControlMode: 'managed',
    stationUrl: 'http://192.0.2.5:18080',
    deployEnvironment: 'station-five',
    deployHost: '192.0.2.5',
  });
  return scope;
}

function registrationOptions(scope, overrides = {}) {
  return {
    home: scope.home,
    workspaceRoot: scope.workspaceA,
    envRepo: scope.envRepo,
    profile: 'four',
    slot: 5,
    capabilities: 'station.connect,station.deploy,station.reset',
    purpose: 'isolated machine control-plane test',
    owner: 'machine-dev-test@example.invalid',
    ...overrides,
  };
}

function expectCode(code, operation) {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof MachineDevError);
    assert.equal(error.code, code);
    return true;
  });
}

function declareLeaseIntent(scope) {
  return startOrUpdateDeclaration({
    home: scope.home,
    workspaceRoot: scope.workspaceA,
    workItemId: 'machine-dev-test',
    sessionId: 'machine-dev-session',
    owner: 'machine-dev-test@example.invalid',
    purpose: 'exercise OS-held machine leases',
    sourceClaims: 'exclusive-write:tooling/scripts/local-dev',
    runtimeClaims: [
      'shared:profile:four',
      'exclusive:local.slot:5',
      'exclusive:station.deploy:station-four',
      'exclusive:station.reset:station-four-fixture',
    ].join(';'),
  });
}

function leaseArguments(scope, resourceKind, resourceId, budgetSeconds, command) {
  const args = [
    cli,
    'lease',
    '--home',
    scope.home,
    '--workspace-root',
    scope.workspaceA,
    '--env-repo',
    scope.envRepo,
    '--resource-kind',
    resourceKind,
    '--resource-id',
    resourceId,
    '--budget-seconds',
    String(budgetSeconds),
  ];
  if (resourceKind === 'station.reset') {
    args.push('--reset-authorized-scope', resourceId);
  }
  return [...args, '--', ...command];
}

async function waitForFile(file, failureDetail, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(file) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(
    existsSync(file),
    `timed out waiting for ${file}: ${failureDetail()}`,
  );
}

function waitForChild(child) {
  return new Promise((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
}

test('concurrent lease observers do not impersonate live holders', async () => {
  const scope = fixture();
  try {
    const leaseFile = machineLeasePath('local.slot', '5', scope.home);
    const leaseRoot = path.dirname(leaseFile);
    mkdirSync(leaseRoot, { recursive: true });
    writeFileSync(
      leaseFile,
      `${JSON.stringify({
        schemaVersion: 1,
        leaseId: 'stale-observation',
        resourceKind: 'local.slot',
        resourceId: '5',
        workspaceId: 'f'.repeat(16),
        ownerPid: 999_999,
        ownerProcessStart: 'stale',
        acquiredAt: '2026-09-17T00:00:00.000Z',
        expiresAt: '2026-09-17T00:00:01.000Z',
      })}\n`,
    );

    const observations = Array.from({ length: 8 }, () => {
      const child = spawn(
        'python3',
        [leaseCli, 'status', '--lease-root', leaseRoot],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      return waitForChild(child).then(({ code, signal }) => ({
        code,
        signal,
        stdout,
        stderr,
      }));
    });

    for (const observation of await Promise.all(observations)) {
      assert.equal(observation.code, 0, observation.stderr);
      assert.equal(observation.signal, null);
      const status = JSON.parse(observation.stdout);
      assert.deepEqual(status.activeLeases, []);
      assert.equal(status.staleMetadata.length, 1);
    }
  } finally {
    scope.close();
  }
});

test('registers, updates, checks, and reports the authoritative slot-5 binding', () => {
  const scope = fixture();
  try {
    const registered = registerWorkspace(registrationOptions(scope));
    assert.equal(registered.slot, 5);
    assert.deepEqual(registered.allowedCapabilities, [
      'station.connect',
      'station.deploy',
      'station.reset',
    ]);
    const checked = checkWorkspace({
      home: scope.home,
      workspaceRoot: scope.workspaceA,
      envRepo: scope.envRepo,
      workspaceId: registered.workspaceId,
      profile: 'four',
      slot: 5,
      capabilities: 'station.connect,station.deploy',
      budgetSeconds: 1200,
    });
    assert.equal(checked.ports.desktopAppGateway, 3530);
    assert.equal(checked.ports.mobileWeb, 5673);
    assert.equal(checked.profile.stationDeployEnvironment, 'station-four');
    assert.equal(checked.profile.agentControlMode, 'disposable');

    const updated = updateWorkspace(
      registrationOptions(scope, {
        profile: 'fiveArm',
        capabilities: 'station.connect',
        purpose: 'switch fixture profile without changing the slot',
      }),
    );
    assert.equal(updated.profile, 'fiveArm');
    assert.equal(updated.slot, 5);
    assert.deepEqual(updated.allowedCapabilities, ['station.connect']);

    const status = statusAll({
      home: scope.home,
      envRepo: scope.envRepo,
    });
    assert.equal(status.authority, 'machine-control-plane');
    assert.equal(status.registrations[0].activity, 'idle');
    assert.equal(status.registrations[0].profileState, 'available');
    assert.equal(status.registrations[0].agentControlMode, 'managed');
  } finally {
    scope.close();
  }
});

test('unregisters an idle owned workspace and rejects owner mismatch', () => {
  const scope = fixture();
  try {
    const registered = registerWorkspace(registrationOptions(scope));
    expectCode('WORKSPACE_OWNER_MISMATCH', () =>
      unregisterWorkspace({
        home: scope.home,
        workspaceRoot: scope.workspaceA,
        owner: 'other@example.invalid',
      }),
    );
    expectCode('STATION_CAPABILITY_CONFLICT', () =>
      unregisterWorkspace({
        home: scope.home,
        workspaceRoot: scope.workspaceA,
        owner: registered.owner,
        observeLeases: () => ({
          activeLeases: [
            {
              leaseId: 'lease-1',
              workspaceId: registered.workspaceId,
            },
          ],
        }),
      }),
    );
    const declaration = declareLeaseIntent(scope);
    expectCode('WORKSPACE_LIFECYCLE_CONFLICT', () =>
      unregisterWorkspace({
        home: scope.home,
        workspaceRoot: scope.workspaceA,
        owner: registered.owner,
      }),
    );
    releaseDeclaration({
      home: scope.home,
      workspaceRoot: scope.workspaceA,
      workItemId: declaration.workItemId,
      sessionId: declaration.sessionId,
    });

    const activeWork = updateActiveWorkRecord(
      {
        workspaceId: registered.workspaceId,
        workItemId: 'machine-dev-test',
        planId: 'MACHINE-DEV-PLAN',
        planPath:
          'docs/architecture/local-dev-control-plane/execution-plans/test/plan.md',
        planStatus: 'completed',
        currentTaskId: 'MACHINE-DEV-T1',
        currentTaskPath:
          'docs/architecture/local-dev-control-plane/execution-plans/test/tasks/MACHINE-DEV-T1.md',
        taskStatus: 'done',
        sessionId: 'machine-dev-session',
        journeyId: 'MACHINE-DEV-J01',
        devState: null,
        branch: registered.branch,
        initialHead: registered.head,
        expectedHead: registered.head,
      },
      {
        home: scope.home,
        workspaceRoot: scope.workspaceA,
      },
    );
    expectCode('WORKSPACE_LIFECYCLE_CONFLICT', () =>
      unregisterWorkspace({
        home: scope.home,
        workspaceRoot: scope.workspaceA,
        owner: registered.owner,
      }),
    );
    clearActiveWorkRecord({
      home: scope.home,
      workspaceRoot: scope.workspaceA,
      expectedRevision: activeWork.revision,
      workItemId: activeWork.workItemId,
    });

    const removed = unregisterWorkspace({
      home: scope.home,
      workspaceRoot: scope.workspaceA,
      owner: registered.owner,
      now: new Date('2026-09-17T00:05:00.000Z'),
    });
    assert.equal(removed.workspaceId, registered.workspaceId);
    assert.equal(removed.name, registered.name);
    assert.equal(removed.unregisteredBy, registered.owner);
    assert.equal(
      statusAll({ home: scope.home, envRepo: scope.envRepo }).registrations.length,
      0,
    );
  } finally {
    scope.close();
  }
});

test('profile Agent control mode is explicit and bounds autonomous reset', () => {
  const invalidScope = fixture();
  try {
    addProfile(invalidScope, {
      name: 'invalid-agent-policy',
      agentControlMode: '',
      stationUrl: 'http://192.0.2.6:18080',
      deployEnvironment: 'station-invalid-agent-policy',
      deployHost: '192.0.2.6',
    });
    expectCode('PROFILE_AGENT_CONTROL_INVALID', () =>
      registerWorkspace(
        registrationOptions(invalidScope, {
          profile: 'invalid-agent-policy',
          capabilities: 'station.connect',
        }),
      ),
    );
  } finally {
    invalidScope.close();
  }

  const managedScope = fixture();
  try {
    addProfile(managedScope, {
      name: 'managed-profile',
      agentControlMode: 'managed',
      stationUrl: 'http://192.0.2.7:18080',
      deployEnvironment: 'station-managed',
      deployHost: '192.0.2.7',
    });
    expectCode('PROFILE_AGENT_CONTROL_DENIED', () =>
      registerWorkspace(
        registrationOptions(managedScope, {
          profile: 'managed-profile',
          capabilities: 'station.connect,station.deploy,station.reset',
        }),
      ),
    );
    const registered = registerWorkspace(
      registrationOptions(managedScope, {
        profile: 'managed-profile',
        capabilities: 'station.connect,station.deploy',
      }),
    );
    assert.equal(registered.profile, 'managed-profile');
  } finally {
    managedScope.close();
  }
});

test('promotes an observed snapshot only through explicit registration', () => {
  const scope = fixture();
  try {
    const registryFile = machineRegistryPath(scope.home);
    mkdirSync(path.dirname(registryFile), { recursive: true });
    writeFileSync(
      registryFile,
      `${JSON.stringify({
        schemaVersion: 1,
        kind: 'peers-touch-machine-dev-registry',
        authority: 'observed-snapshot',
        generatedAt: '2026-09-13T11:05:38Z',
        registrations: [
          {
            workspaceId: 'f'.repeat(16),
            canonicalRoot: '/tmp/observed-only',
            name: 'observed-only',
          },
        ],
        discovery: { note: 'diagnostic only' },
      })}\n`,
    );
    expectCode('WORKSPACE_UNREGISTERED', () =>
      checkWorkspace(registrationOptions(scope)),
    );
    const observed = statusAll({ home: scope.home, envRepo: scope.envRepo });
    assert.deepEqual(observed.registrations, []);
    assert.equal(
      observed.unregisteredObservations.observedRegistrations.length,
      1,
    );
    registerWorkspace(registrationOptions(scope));
    const registry = JSON.parse(readFileSync(registryFile, 'utf8'));
    assert.equal(registry.authority, 'machine-control-plane');
    assert.equal(registry.registrations.length, 1);
    assert.equal(registry.registrations[0].workspaceId.length, 16);
    assert.deepEqual(registry.discovery, {
      note: 'diagnostic only',
      observedRegistrations: [
        {
          workspaceId: 'f'.repeat(16),
          canonicalRoot: '/tmp/observed-only',
          name: 'observed-only',
        },
      ],
    });
  } finally {
    scope.close();
  }
});

test('fails closed for unregistered workspaces and durable slot conflicts', () => {
  const scope = fixture();
  try {
    expectCode('WORKSPACE_UNREGISTERED', () =>
      checkWorkspace(registrationOptions(scope)),
    );
    registerWorkspace(registrationOptions(scope));
    expectCode('LOCAL_SLOT_CONFLICT', () =>
      registerWorkspace(
        registrationOptions(scope, {
          workspaceRoot: scope.workspaceB,
          profile: 'fiveArm',
          capabilities: 'station.connect',
        }),
      ),
    );
  } finally {
    scope.close();
  }
});

test('fails closed for dirty and untracked selected profile definitions', () => {
  const dirtyScope = fixture();
  try {
    writeFileSync(
      path.join(
        dirtyScope.envRepo,
        'peers-touch',
        'four',
        'profile.env.example',
      ),
      `${profileText({
        name: 'four',
        stationUrl: 'http://192.0.2.4:18080',
        deployEnvironment: 'station-four',
      })}# dirty\n`,
    );
    expectCode('PROFILE_UNAVAILABLE', () =>
      registerWorkspace(registrationOptions(dirtyScope)),
    );
  } finally {
    dirtyScope.close();
  }

  const untrackedScope = fixture();
  try {
    addProfile(untrackedScope, {
      name: 'untracked',
      stationUrl: 'http://192.0.2.8:18080',
      deployEnvironment: 'station-untracked',
      deployHost: '192.0.2.8',
      tracked: false,
    });
    expectCode('PROFILE_UNAVAILABLE', () =>
      registerWorkspace(
        registrationOptions(untrackedScope, { profile: 'untracked' }),
      ),
    );
  } finally {
    untrackedScope.close();
  }
});

test('rejects local, compose, loopback, and mismatched deploy targets for Station mutation', () => {
  for (const candidate of [
    {
      name: 'local-profile',
      mode: 'local',
      stationUrl: 'http://127.0.0.1:18580',
      deployEnvironment: '',
      deployHost: '',
      code: 'PROFILE_UNAVAILABLE',
    },
    {
      name: 'compose-profile',
      mode: 'compose',
      stationUrl: 'http://127.0.0.1:18580',
      deployEnvironment: '',
      deployHost: '',
      code: 'PROFILE_UNAVAILABLE',
    },
    {
      name: 'loopback-profile',
      mode: 'remote',
      stationUrl: 'http://127.0.0.1:18080',
      deployEnvironment: 'station-loopback',
      deployHost: '127.0.0.1',
      code: 'PROFILE_UNAVAILABLE',
    },
    {
      name: 'mismatch-profile',
      mode: 'remote',
      stationUrl: 'http://192.0.2.9:18080',
      deployEnvironment: 'station-mismatch',
      deployHost: '192.0.2.10',
      code: 'DEPLOY_TARGET_MISMATCH',
    },
  ]) {
    const scope = fixture();
    try {
      addProfile(scope, candidate);
      expectCode(candidate.code, () =>
        registerWorkspace(
          registrationOptions(scope, {
            profile: candidate.name,
            capabilities: 'station.connect,station.deploy',
          }),
        ),
      );
    } finally {
      scope.close();
    }
  }
});

test('malformed authoritative registry fails closed without replacement', () => {
  const scope = fixture();
  try {
    const registryFile = machineRegistryPath(scope.home);
    mkdirSync(path.dirname(registryFile), { recursive: true });
    writeFileSync(
      registryFile,
      '{"schemaVersion":1,"kind":"peers-touch-machine-dev-registry","authority":"machine-control-plane","updatedAt":"invalid","registrations":[]}\n',
    );
    const before = readFileSync(registryFile, 'utf8');
    expectCode('MACHINE_REGISTRY_INVALID', () =>
      registerWorkspace(registrationOptions(scope)),
    );
    assert.equal(readFileSync(registryFile, 'utf8'), before);
  } finally {
    scope.close();
  }
});

for (const leaseCase of [
  {
    resourceKind: 'local.slot',
    resourceId: '5',
    conflictCode: 'LOCAL_SLOT_CONFLICT',
  },
  {
    resourceKind: 'station.deploy',
    resourceId: 'station-four',
    conflictCode: 'STATION_CAPABILITY_CONFLICT',
  },
  {
    resourceKind: 'station.reset',
    resourceId: 'station-four-fixture',
    conflictCode: 'STATION_CAPABILITY_CONFLICT',
  },
]) {
  test(`${leaseCase.resourceKind} is OS-held and releases on success, failure, signal, timeout, and stale metadata`, async () => {
    const scope = fixture();
    let holder;
    try {
      registerWorkspace(registrationOptions(scope));
      declareLeaseIntent(scope);
      const marker = path.join(scope.root, `${leaseCase.resourceKind}.ready`);
      holder = spawn(
        process.execPath,
        leaseArguments(
          scope,
          leaseCase.resourceKind,
          leaseCase.resourceId,
          30,
          [
            process.execPath,
            '-e',
            `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ready'); setInterval(() => {}, 1000);`,
          ],
        ),
        { stdio: ['ignore', 'ignore', 'pipe'] },
      );
      let holderError = '';
      holder.stderr.setEncoding('utf8');
      holder.stderr.on('data', (chunk) => {
        holderError += chunk;
      });
      const holderResult = waitForChild(holder);
      await waitForFile(
        marker,
        () => `exitCode=${holder.exitCode} stderr=${holderError}`,
      );

      const active = observeLeases({ home: scope.home });
      assert.equal(active.activeLeases.length, 1);
      assert.equal(active.activeLeases[0].resourceKind, leaseCase.resourceKind);
      assert.equal(active.activeLeases[0].resourceId, leaseCase.resourceId);
      assert.ok(Number.isInteger(active.activeLeases[0].ownerPid));
      assert.ok(active.activeLeases[0].ownerProcessStart);

      const competitor = spawnSync(
        process.execPath,
        leaseArguments(
          scope,
          leaseCase.resourceKind,
          leaseCase.resourceId,
          5,
          [process.execPath, '-e', 'process.exit(0)'],
        ),
        { encoding: 'utf8' },
      );
      assert.equal(competitor.status, 2);
      assert.match(competitor.stderr, new RegExp(leaseCase.conflictCode));

      holder.kill('SIGTERM');
      const signalled = await holderResult;
      assert.equal(
        signalled.code,
        143,
        `unexpected signal result: ${JSON.stringify(signalled)} ${holderError}`,
      );
      holder = null;
      assert.equal(observeLeases({ home: scope.home }).activeLeases.length, 0);

      const success = spawnSync(
        process.execPath,
        leaseArguments(
          scope,
          leaseCase.resourceKind,
          leaseCase.resourceId,
          5,
          [process.execPath, '-e', 'process.exit(0)'],
        ),
        { encoding: 'utf8' },
      );
      assert.equal(success.status, 0, success.stderr);

      const inheritedVerification = spawnSync(
        process.execPath,
        leaseArguments(
          scope,
          leaseCase.resourceKind,
          leaseCase.resourceId,
          5,
          [
            process.execPath,
            cli,
            'verify-held',
            '--home',
            scope.home,
            '--workspace-root',
            scope.workspaceA,
            '--resource-kind',
            leaseCase.resourceKind,
            '--resource-id',
            leaseCase.resourceId,
          ],
        ),
        { encoding: 'utf8' },
      );
      assert.equal(
        inheritedVerification.status,
        0,
        inheritedVerification.stderr,
      );

      const failure = spawnSync(
        process.execPath,
        leaseArguments(
          scope,
          leaseCase.resourceKind,
          leaseCase.resourceId,
          5,
          [process.execPath, '-e', 'process.exit(7)'],
        ),
        { encoding: 'utf8' },
      );
      assert.equal(failure.status, 7, failure.stderr);
      assert.equal(observeLeases({ home: scope.home }).activeLeases.length, 0);

      const timeout = spawnSync(
        process.execPath,
        leaseArguments(
          scope,
          leaseCase.resourceKind,
          leaseCase.resourceId,
          1,
          [process.execPath, '-e', 'setTimeout(() => {}, 10000)'],
        ),
        { encoding: 'utf8', timeout: 5_000 },
      );
      assert.equal(timeout.status, 124, timeout.stderr);
      assert.match(timeout.stderr, /LEASE_BUDGET_EXCEEDED/);
      assert.equal(observeLeases({ home: scope.home }).activeLeases.length, 0);

      const leaseFile = machineLeasePath(
        leaseCase.resourceKind,
        leaseCase.resourceId,
        scope.home,
      );
      writeFileSync(
        leaseFile,
        `${JSON.stringify({
          leaseId: 'stale',
          resourceKind: leaseCase.resourceKind,
          resourceId: leaseCase.resourceId,
          workspaceId: 'f'.repeat(16),
          ownerPid: 999_999,
          ownerProcessStart: 'stale',
          acquiredAt: '2026-09-13T00:00:00.000Z',
          expiresAt: '2026-09-13T00:00:01.000Z',
        })}\n`,
      );
      assert.equal(observeLeases({ home: scope.home }).staleMetadata.length, 1);
      const staleRecovery = spawnSync(
        process.execPath,
        leaseArguments(
          scope,
          leaseCase.resourceKind,
          leaseCase.resourceId,
          5,
          [process.execPath, '-e', 'process.exit(0)'],
        ),
        { encoding: 'utf8' },
      );
      assert.equal(staleRecovery.status, 0, staleRecovery.stderr);
      const finalObservation = observeLeases({ home: scope.home });
      assert.deepEqual(finalObservation.activeLeases, []);
      assert.deepEqual(finalObservation.staleMetadata, []);
    } finally {
      if (holder && holder.exitCode === null) holder.kill('SIGKILL');
      scope.close();
    }
  });
}

test('lease acquisition waits for the workspace lifecycle fence before validation', async () => {
  const scope = fixture();
  let child;
  let lifecycle;
  try {
    registerWorkspace(registrationOptions(scope));
    declareLeaseIntent(scope);
    lifecycle = acquireWorkspaceLifecycleLockSync({
      home: scope.home,
      workspaceRoot: scope.workspaceA,
    });
    const marker = path.join(scope.root, 'lease-command-ran');
    const runner = buildLeaseCommand({
      ...registrationOptions(scope),
      resourceKind: 'local.slot',
      resourceId: '5',
      budgetSeconds: 10,
      command: [
        process.execPath,
        '-e',
        `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`,
      ],
    });
    child = spawn(runner.executable, runner.arguments, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const childExit = new Promise((resolve) => {
      child.once('close', (code) => resolve({ code, stdout, stderr }));
    });

    const deadline = Date.now() + 5_000;
    let active = [];
    while (Date.now() < deadline) {
      active = observeLeases({ home: scope.home }).activeLeases;
      if (active.some((lease) => lease.workspaceId === workspaceIdForRoot(scope.workspaceA))) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(
      active.some((lease) => lease.workspaceId === workspaceIdForRoot(scope.workspaceA)),
      true,
    );
    assert.equal(existsSync(marker), false);
    assert.equal(child.exitCode, null);

    lifecycle.release();
    lifecycle = null;
    const result = await childExit;
    child = null;
    assert.equal(result.code, 0, result.stderr);
    assert.equal(existsSync(marker), true);
  } finally {
    if (lifecycle) lifecycle.release();
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
    scope.close();
  }
});

test('post-lock validation rejects a binding changed after lease preparation', () => {
  const scope = fixture();
  try {
    const registration = registerWorkspace(registrationOptions(scope));
    declareLeaseIntent(scope);
    const leaseFile = machineLeasePath('local.slot', '5', scope.home);
    mkdirSync(path.dirname(leaseFile), { recursive: true });
    const forged = spawnSync(process.execPath, ['-e', `
      const { execFileSync, spawnSync } = require('node:child_process');
      const { openSync, writeFileSync } = require('node:fs');
      const fd = openSync(${JSON.stringify(leaseFile)}, 'w+');
      const processStart = execFileSync(
        'ps',
        ['-o', 'lstart=', '-p', String(process.pid)],
        { encoding: 'utf8' },
      ).trim();
      writeFileSync(fd, JSON.stringify({
        leaseId: 'forged',
        resourceKind: 'local.slot',
        resourceId: '5',
        workspaceId: ${JSON.stringify(registration.workspaceId)},
        ownerPid: process.pid,
        ownerProcessStart: processStart,
        acquiredAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 5000).toISOString(),
      }));
      const result = spawnSync(
        process.execPath,
        [
          ${JSON.stringify(cli)},
          'verify-held',
          '--home',
          ${JSON.stringify(scope.home)},
          '--workspace-root',
          ${JSON.stringify(scope.workspaceA)},
          '--resource-kind',
          'local.slot',
          '--resource-id',
          '5',
        ],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            PT_MACHINE_LEASE_FD: '3',
            PT_MACHINE_LEASE_ID: 'forged',
          },
          stdio: ['ignore', 'pipe', 'pipe', fd],
        },
      );
      process.stdout.write(result.stdout || '');
      process.stderr.write(result.stderr || '');
      process.exit(result.status ?? 2);
    `], { encoding: 'utf8' });
    assert.equal(forged.status, 2);
    assert.match(
      forged.stderr,
      /inherited file descriptor does not hold the canonical lease/,
    );

    const runner = buildLeaseCommand({
      ...registrationOptions(scope),
      resourceKind: 'local.slot',
      resourceId: '5',
      budgetSeconds: 5,
      command: [
        process.execPath,
        '-e',
        `require('node:fs').writeFileSync(${JSON.stringify(path.join(scope.root, 'unexpected'))}, 'ran')`,
      ],
    });

    updateWorkspace(registrationOptions(scope, { slot: 6 }));
    const result = spawnSync(runner.executable, runner.arguments, {
      encoding: 'utf8',
    });

    assert.equal(result.status, 2);
    assert.match(result.stderr, /RUNTIME_IDENTITY_MISMATCH/);
    assert.equal(existsSync(path.join(scope.root, 'unexpected')), false);
  } finally {
    scope.close();
  }
});

test('lease remains held when the Python supervisor is killed', async () => {
  const scope = fixture();
  let holder;
  let mutationPid = null;
  try {
    registerWorkspace(registrationOptions(scope));
    declareLeaseIntent(scope);
    const marker = path.join(scope.root, 'sigkill-child.json');
    const runner = buildLeaseCommand({
      ...registrationOptions(scope),
      resourceKind: 'local.slot',
      resourceId: '5',
      budgetSeconds: 30,
      command: [
        process.execPath,
        '-e',
        `require('node:fs').writeFileSync(${JSON.stringify(marker)}, JSON.stringify({pid:process.pid})); setInterval(() => {}, 1000);`,
      ],
    });
    holder = spawn(runner.executable, runner.arguments, {
      stdio: 'ignore',
    });
    const holderExit = new Promise((resolve) => {
      holder.once('exit', (code, signal) => resolve({ code, signal }));
    });
    await waitForFile(
      marker,
      () => `exitCode=${holder.exitCode}`,
    );
    mutationPid = JSON.parse(readFileSync(marker, 'utf8')).pid;

    holder.kill('SIGKILL');
    await holderExit;
    holder = null;

    const competitor = spawnSync(
      process.execPath,
      leaseArguments(scope, 'local.slot', '5', 5, [
        process.execPath,
        '-e',
        'process.exit(0)',
      ]),
      { encoding: 'utf8' },
    );
    assert.equal(competitor.status, 2);
    assert.match(competitor.stderr, /LOCAL_SLOT_CONFLICT/);

    process.kill(mutationPid, 'SIGTERM');
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      try {
        process.kill(mutationPid, 0);
      } catch {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    mutationPid = null;
    const recovered = spawnSync(
      process.execPath,
      leaseArguments(scope, 'local.slot', '5', 5, [
        process.execPath,
        '-e',
        'process.exit(0)',
      ]),
      { encoding: 'utf8' },
    );
    assert.equal(recovered.status, 0, recovered.stderr);
  } finally {
    if (holder && holder.exitCode === null) holder.kill('SIGKILL');
    if (mutationPid !== null) {
      try {
        process.kill(mutationPid, 'SIGKILL');
      } catch {
        // The mutation process may have already exited.
      }
    }
    scope.close();
  }
});
