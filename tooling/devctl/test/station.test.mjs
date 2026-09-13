import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DevctlError, ERROR_CODES } from '../errors.mjs';
import { startStation } from '../station.mjs';

function fixtureProfile({
  name,
  mode,
  port,
}) {
  return [
    `PT_DEV_PROFILE=${name}`,
    'PT_DEV_SLOT=0',
    `PT_STATION_MODE=${mode}`,
    `PT_STATION_NAME=${name}`,
    `PT_STATION_URL=http://127.0.0.1:${port}`,
    `PT_STATION_PORT=${port}`,
    'PT_STATION_DEPLOY_ENV=fixture-station',
    `PT_STATION_HEALTH_URL=http://127.0.0.1:${port}/healthz`,
    'PT_DESKTOP_APP_GATEWAY_PORT=3030',
    'PT_DESKTOP_APP_WEB_PORT=3210',
    'PT_DESKTOP_WEB_GATEWAY_PORT=3031',
    'PT_DESKTOP_WEB_WEB_PORT=3211',
    '',
  ].join('\n');
}

function temporaryRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devctl-station-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeProfile(root, name, mode, port) {
  const profilePath = path.join(root, `${name}.env`);
  fs.writeFileSync(profilePath, fixtureProfile({
    name,
    mode,
    port,
  }));
  return profilePath;
}

function writeRemoteBridge(root, source) {
  const script = path.join(
    root,
    'tooling',
    'scripts',
    'local-dev',
    'station-dev.sh',
  );
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, source, { mode: 0o755 });
}

async function startHealthServer(t) {
  const server = http.createServer((_request, response) => {
    response.writeHead(200);
    response.end('ok');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return address.port;
}

test(
  'remote start invokes the Unix deployment bridge even when Station is healthy',
  { skip: process.platform === 'win32' },
  async (t) => {
    const root = temporaryRoot(t);
    const port = await startHealthServer(t);
    const profilePath = writeProfile(root, 'remote-test', 'remote', port);
    writeRemoteBridge(
      root,
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'printf "remote\\n" > "$PWD/remote-bridge-ran"',
        '',
      ].join('\n'),
    );

    const result = await startStation(root, {
      ...process.env,
      PT_DEV_PROFILE_FILE: profilePath,
      PT_ENV_REPO: '',
    });

    assert.equal(result.deployed, true);
    assert.equal(result.mode, 'remote');
    assert.equal(
      fs.readFileSync(path.join(root, 'remote-bridge-ran'), 'utf8'),
      'remote\n',
    );
  },
);

test(
  'remote deployment bridge failure returns a typed bounded error',
  { skip: process.platform === 'win32' },
  async (t) => {
    const root = temporaryRoot(t);
    const profilePath = writeProfile(root, 'remote-failure', 'remote', 18080);
    writeRemoteBridge(
      root,
      '#!/usr/bin/env bash\nexit 23\n',
    );

    await assert.rejects(
      startStation(root, {
        ...process.env,
        PT_DEV_PROFILE_FILE: profilePath,
        PT_ENV_REPO: '',
      }),
      (error) =>
        error instanceof DevctlError
        && error.code === ERROR_CODES.START_TIMEOUT
        && error.details.status === 23,
    );
  },
);

test('local start still rejects a healthy unowned Station port', async (t) => {
  const root = temporaryRoot(t);
  const port = await startHealthServer(t);
  const profilePath = writeProfile(root, 'local-test', 'local', port);

  await assert.rejects(
    startStation(root, {
      ...process.env,
      PT_DEV_PROFILE_FILE: profilePath,
      PT_ENV_REPO: '',
    }),
    (error) =>
      error instanceof DevctlError
      && error.code === ERROR_CODES.PORT_CONFLICT,
  );
});
