import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
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

  const canonicalRoot = fs.realpathSync(root);
  const workspaceId = createHash('sha256')
    .update(canonicalRoot)
    .digest('hex')
    .slice(0, 16);
  const now = new Date().toISOString();
  fs.writeFileSync(
    path.join(home, '.peers-touch', 'dev', 'registry.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      kind: 'peers-touch-machine-dev-registry',
      authority: 'machine-control-plane',
      updatedAt: now,
      registrations: [{
        workspaceId,
        canonicalRoot,
        name: path.basename(canonicalRoot),
        branch: git(root, 'branch', '--show-current'),
        head: git(root, 'rev-parse', 'HEAD'),
        profile: name,
        slot,
        allowedCapabilities: ['station.connect'],
        purpose: 'devctl profile test',
        owner: 'test@example.com',
        registeredAt: now,
        updatedAt: now,
        updatedBy: 'test@example.com',
      }],
    }, null, 2)}\n`,
  );
  return {
    root,
    envRepo,
    home,
    environment: { HOME: home, PT_ENV_REPO: envRepo },
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
