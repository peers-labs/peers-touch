import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  readRegistry,
  registerWorkspace,
} from '../../scripts/local-dev/machine-dev-registry.mjs';
import { machineRegistryPath } from '../../scripts/lib/machine-dev-paths.mjs';
import { DevctlError, ERROR_CODES } from '../errors.mjs';
import {
  activateProfile,
  initializeProfile,
  normalizeConfiguredPath,
  parseEnvText,
  redactProfile,
  resolveProfile,
} from '../profile.mjs';

function fixtureProfile(name = 'local-test') {
  return [
    `PT_DEV_PROFILE=${name}`,
    'PT_DEV_SLOT=0',
    'PT_AGENT_CONTROL_MODE=managed',
    'PT_STATION_MODE=local',
    `PT_STATION_NAME=${name}`,
    'PT_STATION_URL=http://127.0.0.1:18080',
    'PT_STATION_PORT=18080',
    'PT_DESKTOP_APP_GATEWAY_PORT=3030',
    'PT_DESKTOP_APP_WEB_PORT=3210',
    'PT_DESKTOP_WEB_GATEWAY_PORT=3031',
    'PT_DESKTOP_WEB_WEB_PORT=3211',
    'API_TOKEN=private',
    '',
  ].join('\n');
}

function temporaryRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devctl-profile-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function machineWorkspace(t, { name = 'local-test', slot = 5 } = {}) {
  const fixtureRoot = temporaryRoot(t);
  const root = path.join(fixtureRoot, 'workspace');
  const envRepo = path.join(fixtureRoot, 'env');
  const home = path.join(fixtureRoot, 'home');
  const profileDirectory = path.join(envRepo, 'peers-touch', name);
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(profileDirectory, { recursive: true });
  fs.mkdirSync(path.join(home, '.peers-touch', 'dev'), { recursive: true });

  fs.writeFileSync(path.join(root, 'README.md'), 'fixture\n');
  git(root, 'init');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'add', 'README.md');
  git(root, 'commit', '-m', 'fixture');

  fs.writeFileSync(
    path.join(profileDirectory, 'profile.env.example'),
    fixtureProfile(name),
  );
  git(envRepo, 'init');
  git(envRepo, 'config', 'user.email', 'test@example.com');
  git(envRepo, 'config', 'user.name', 'Test');
  git(envRepo, 'add', '.');
  git(envRepo, 'commit', '-m', 'fixture');

  registerWorkspace({
    workspaceRoot: root,
    envRepo,
    registryPath: machineRegistryPath(home),
    profile: name,
    slot,
    capabilities: 'station.connect',
    purpose: 'devctl profile test',
    owner: 'test@example.com',
  });
  return {
    root,
    envRepo,
    home,
    environment: { HOME: home, PT_ENV_REPO: envRepo },
  };
}

function initializeRepository(root) {
  fs.mkdirSync(root, { recursive: true });
  execFileSync('git', ['init', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Devctl Test'], { cwd: root });
}

function commitRepository(root) {
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'test fixture'], { cwd: root });
}

function registeredFixture(t) {
  const sandbox = temporaryRoot(t);
  const root = path.join(sandbox, 'peers-ai-agent');
  const envRepo = path.join(sandbox, 'env');
  const home = path.join(sandbox, 'home');
  initializeRepository(root);
  initializeRepository(envRepo);
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(root, 'README.md'), 'fixture\n');

  for (const name of ['two', 'three', 'chat-native-disposable']) {
    const profileRoot = path.join(envRepo, 'peers-touch', name);
    fs.mkdirSync(profileRoot, { recursive: true });
    fs.writeFileSync(
      path.join(profileRoot, 'profile.env.example'),
      fixtureProfile(name)
        .replace('PT_STATION_MODE=local', 'PT_STATION_MODE=remote')
        .replace('http://127.0.0.1:18080', `http://10.0.0.${name === 'two' ? 2 : 3}:18080`),
    );
  }
  commitRepository(root);
  commitRepository(envRepo);

  const legacyProfile = path.join(
    root,
    '.local',
    'dev',
    'profiles',
    'chat-native-disposable.env',
  );
  const legacyActive = path.join(
    root,
    '.local',
    'dev',
    'active',
    'peers-ai-agent.env',
  );
  fs.mkdirSync(path.dirname(legacyProfile), { recursive: true });
  fs.mkdirSync(path.dirname(legacyActive), { recursive: true });
  fs.writeFileSync(
    legacyProfile,
    fixtureProfile('chat-native-disposable'),
  );
  fs.symlinkSync(path.relative(path.dirname(legacyActive), legacyProfile), legacyActive);

  const registryPath = machineRegistryPath(home);
  registerWorkspace({
    workspaceRoot: root,
    envRepo,
    registryPath,
    profile: 'two',
    slot: 1,
    capabilities: 'station.connect',
    purpose: 'devctl test',
    owner: 'test@example.com',
  });
  return {
    envRepo,
    environment: { HOME: home, PT_ENV_REPO: envRepo },
    home,
    registryPath,
    root,
    sandbox,
  };
}

test('parses declarative env values without evaluating shell', () => {
  assert.deepEqual(
    parseEnvText('NAME=value\nQUOTED="value with spaces"\n# comment\n'),
    { NAME: 'value', QUOTED: 'value with spaces' },
  );
  assert.throws(
    () => parseEnvText('VALUE=$(whoami)\n', 'fixture.env'),
    (error) =>
      error instanceof DevctlError
      && error.code === ERROR_CODES.PROFILE_INVALID
      && error.details.line === 1,
  );
});

test('activates and resolves a profile by worktree identity', (t) => {
  const { root, environment } = machineWorkspace(t);
  const name = 'local-test';

  const activated = activateProfile(root, name, environment);
  const resolved = resolveProfile(root, environment);

  assert.equal(activated.reference.profileName, name);
  assert.equal(resolved.profile.PT_DEV_PROFILE, name);
  assert.equal(resolved.profile.PT_DEV_SLOT, '5');
  assert.equal(resolved.profile.PT_DESKTOP_APP_GATEWAY_PORT, '3530');
  assert.equal(resolved.reference.worktreeId, path.basename(root));
  assert.equal(resolved.reference.authority, 'machine-control-plane');
  assert.match(resolved.paths.profileData, /workspaces\/[0-9a-f]{16}\/runtime\/local-test\/data$/u);
});

test('resolves the machine binding instead of a stale legacy pointer', (t) => {
  const fixture = registeredFixture(t);
  const resolved = resolveProfile(fixture.root, fixture.environment);

  assert.equal(resolved.reference.authority, 'machine-control-plane');
  assert.equal(resolved.reference.profileName, 'two');
  assert.equal(resolved.profile.PT_DEV_PROFILE, 'two');
  assert.equal(resolved.profile.PT_DEV_SLOT, '1');
  assert.equal(resolved.profile.PT_DESKTOP_APP_GATEWAY_PORT, '3130');
});

test('activates a profile by updating the machine binding', (t) => {
  const fixture = registeredFixture(t);
  const activated = activateProfile(
    fixture.root,
    'three',
    fixture.environment,
  );
  const registry = readRegistry(fixture.registryPath);

  assert.equal(activated.reference.profileName, 'three');
  assert.equal(registry.registrations[0].profile, 'three');
});

test('rejects an unregistered worktree without a legacy fallback', (t) => {
  const fixture = registeredFixture(t);
  const unregisteredRoot = path.join(fixture.sandbox, 'unregistered');
  initializeRepository(unregisteredRoot);
  fs.writeFileSync(path.join(unregisteredRoot, 'README.md'), 'unregistered\n');
  commitRepository(unregisteredRoot);

  assert.throws(
    () => resolveProfile(unregisteredRoot, fixture.environment),
    (error) =>
      error instanceof DevctlError
      && error.code === ERROR_CODES.CHECK_FAILED
      && error.details.machineCode === 'WORKSPACE_UNREGISTERED',
  );
});

test('normal resolution uses the machine binding instead of the active symlink', (t) => {
  const root = temporaryRoot(t);
  const paths = path.join(root, '.local', 'dev');
  const activeDir = path.join(paths, 'active');
  const profileDir = path.join(paths, 'profiles');
  fs.mkdirSync(activeDir, { recursive: true });
  fs.mkdirSync(profileDir, { recursive: true });
  const staleProfile = path.join(profileDir, 'stale.env');
  fs.writeFileSync(staleProfile, fixtureProfile('stale'));
  fs.symlinkSync(
    path.relative(activeDir, staleProfile),
    path.join(activeDir, `${path.basename(root)}.env`),
  );

  const machineProfile = path.join(root, 'machine.env');
  fs.writeFileSync(machineProfile, fixtureProfile('machine'));
  const machineState = path.join(root, 'machine-state');
  const resolved = resolveProfile(
    root,
    { PT_ENV_REPO: '' },
    () => ({
      authority: 'machine-control-plane',
      binding: {
        canonicalRoot: root,
        profile: 'machine',
        slot: 5,
        workspaceId: '0000000000000000',
      },
      ports: {
        station: 18580,
        desktopAppGateway: 3530,
        desktopAppWeb: 3710,
        desktopWebGateway: 3531,
        desktopWebWeb: 3711,
        mobileWeb: 5673,
      },
      profile: {
        profileFile: machineProfile,
        sourceState: 'tracked-clean',
      },
      workspaceStateRoot: machineState,
    }),
  );

  assert.equal(resolved.reference.profileName, 'machine');
  assert.equal(resolved.reference.resolvedPath, machineProfile);
  assert.equal(resolved.profile.PT_DEV_SLOT, '5');
  assert.equal(resolved.profile.PT_STATION_PORT, '18580');
  assert.equal(resolved.profile.PT_DESKTOP_APP_GATEWAY_PORT, '3530');
  assert.equal(
    resolved.paths.profileData,
    path.join(machineState, 'runtime', 'machine', 'data'),
  );
});

test('rejects a profile identity mismatch', (t) => {
  const { root, envRepo, environment } = machineWorkspace(t);
  const profilePath = path.join(
    envRepo,
    'peers-touch',
    'local-test',
    'profile.env.example',
  );
  fs.writeFileSync(profilePath, fixtureProfile('declared'));

  assert.throws(
    () => resolveProfile(root, environment),
    (error) =>
      error instanceof DevctlError
      && error.code === ERROR_CODES.CHECK_FAILED
      && error.details.machineCode === 'PROFILE_UNAVAILABLE',
  );
});

test('keeps Acceptance profile overrides while retaining machine allocation', (t) => {
  const { root, environment, home } = machineWorkspace(t);
  const profileRoot = path.join(home, 'acceptance-profiles');
  const profilePath = path.join(profileRoot, 'runtime.env');
  fs.mkdirSync(profileRoot, { recursive: true });
  fs.writeFileSync(profilePath, fixtureProfile('runtime'));

  const resolved = resolveProfile(root, {
    ...environment,
    PT_DEV_PROFILE_FILE: profilePath,
    PT_DEV_PROFILE_FILE_AUTHORITY: 'acceptance-runtime-manifest',
    PT_ACCEPTANCE_RUNTIME_PROFILE_ROOT: profileRoot,
  });

  assert.equal(resolved.profile.PT_DEV_PROFILE, 'runtime');
  assert.equal(resolved.profile.PT_DEV_SLOT, '5');
  assert.equal(resolved.profile.PT_DESKTOP_APP_WEB_PORT, '3710');
  assert.equal(resolved.reference.machineProfileName, 'local-test');
  assert.equal(resolved.reference.canonical, false);
});

test('initializes deterministic profile ports and refuses overwrite', (t) => {
  const root = temporaryRoot(t);
  const profilePath = initializeProfile(root, 'slot-two', 2);
  const content = fs.readFileSync(profilePath, 'utf8');

  assert.match(content, /PT_STATION_PORT=18280/u);
  assert.match(content, /PT_DESKTOP_APP_GATEWAY_PORT=3230/u);
  assert.throws(() => initializeProfile(root, 'slot-two', 2), DevctlError);
});

test('redacts secrets and normalizes configured Windows paths', () => {
  assert.deepEqual(redactProfile({
    PT_DEV_PROFILE: 'sixwin',
    API_TOKEN: 'secret-value',
  }), {
    PT_DEV_PROFILE: 'sixwin',
    API_TOKEN: '<redacted>',
  });
  assert.equal(
    normalizeConfiguredPath('/c/Program Files/nodejs', 'win32'),
    'C:\\Program Files\\nodejs',
  );
});
