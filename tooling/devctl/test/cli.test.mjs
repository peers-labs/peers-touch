import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const entrypoint = path.resolve(testDirectory, '..', 'index.mjs');

function fixtureProfile(name = 'cli-test') {
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

function runCli(args, environment = {}) {
  return spawnSync(process.execPath, [entrypoint, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...environment },
  });
}

test('Acceptance profile override cannot bypass machine registration', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devctl-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const profilePath = path.join(root, 'cli-test.env');
  fs.writeFileSync(profilePath, fixtureProfile());

  const result = runCli(
    ['config', '--json', '--root', root],
    {
      PT_DEV_PROFILE_FILE: profilePath,
      PT_DEV_PROFILE_FILE_AUTHORITY: 'acceptance-runtime-manifest',
      PT_ACCEPTANCE_RUNTIME_PROFILE_ROOT: root,
      PT_ENV_REPO: '',
    },
  );

  assert.equal(result.status, 2);
  const parsed = JSON.parse(result.stderr);
  assert.equal(parsed.error.code, 'DEVCTL_CHECK_FAILED');
  assert.equal(parsed.error.details.machineCode, 'WORKTREE_IDENTITY_UNAVAILABLE');
});

test('unregistered workspace returns a stable typed error', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devctl-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = runCli(
    ['config', '--json', '--root', root],
    { PT_DEV_PROFILE_FILE: '', PT_ENV_REPO: '' },
  );

  assert.equal(result.status, 2);
  const parsed = JSON.parse(result.stderr);
  assert.equal(parsed.error.code, 'DEVCTL_CHECK_FAILED');
  assert.equal(parsed.error.details.machineCode, 'WORKTREE_IDENTITY_UNAVAILABLE');
});

test('unknown commands return DEVCTL_UNSUPPORTED_MODE', () => {
  const result = runCli(['unknown', '--json']);

  assert.equal(result.status, 2);
  const parsed = JSON.parse(result.stderr);
  assert.equal(parsed.error.code, 'DEVCTL_UNSUPPORTED_MODE');
});

test('desktop rejects an unconsumed positional mode', () => {
  const result = runCli(['desktop', 'start', 'web', '--json']);

  assert.equal(result.status, 2);
  const parsed = JSON.parse(result.stderr);
  assert.equal(parsed.error.code, 'DEVCTL_UNSUPPORTED_MODE');
  assert.deepEqual(parsed.error.details.arguments, ['web']);
});

test('desktop install is exposed without a runtime mode', () => {
  const help = runCli(['help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /devctl desktop install \[--json\]/u);

  const result = runCli([
    'desktop',
    'install',
    '--mode',
    'web',
    '--json',
  ]);
  assert.equal(result.status, 2);
  const parsed = JSON.parse(result.stderr);
  assert.equal(parsed.error.code, 'DEVCTL_UNSUPPORTED_MODE');
  assert.equal(
    parsed.error.message,
    'Desktop installation does not accept --mode',
  );
});
