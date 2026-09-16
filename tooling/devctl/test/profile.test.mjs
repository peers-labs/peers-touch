import assert from 'node:assert/strict';
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
  const root = temporaryRoot(t);
  const name = 'local-test';
  const profileDir = path.join(root, '.local', 'dev', 'profiles');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, `${name}.env`), fixtureProfile(name));

  const activated = activateProfile(root, name, { PT_ENV_REPO: '' });
  const resolved = resolveProfile(root, { PT_ENV_REPO: '' });

  assert.equal(activated.reference.profileName, name);
  assert.equal(resolved.profile.PT_DEV_PROFILE, name);
  assert.equal(resolved.reference.worktreeId, path.basename(root));
});

test('rejects a profile identity mismatch', (t) => {
  const root = temporaryRoot(t);
  const profilePath = path.join(root, 'wrong.env');
  fs.writeFileSync(profilePath, fixtureProfile('declared'));

  assert.throws(
    () => resolveProfile(root, { PT_DEV_PROFILE_FILE: profilePath }),
    (error) =>
      error instanceof DevctlError
      && error.code === ERROR_CODES.PROFILE_INVALID,
  );
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
