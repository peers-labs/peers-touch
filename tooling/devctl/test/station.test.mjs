import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { machineRegistryPath } from '../../scripts/lib/machine-dev-paths.mjs';
import { registerWorkspace } from '../../scripts/local-dev/machine-dev-registry.mjs';
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
    'PT_AGENT_CONTROL_MODE=managed',
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

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function machineEnvironment(t, root, slot = 0) {
  const envRepo = `${root}-env`;
  const home = `${root}-home`;
  const profileDirectory = path.join(
    envRepo,
    'peers-touch',
    'machine-test',
  );
  fs.mkdirSync(profileDirectory, { recursive: true });
  fs.mkdirSync(path.join(home, '.peers-touch', 'dev'), { recursive: true });
  t.after(() => fs.rmSync(envRepo, { recursive: true, force: true }));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  fs.writeFileSync(path.join(root, 'README.md'), 'fixture\n');
  git(root, 'init');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'add', 'README.md');
  git(root, 'commit', '-m', 'fixture');

  fs.writeFileSync(
    path.join(profileDirectory, 'profile.env.example'),
    fixtureProfile({
      name: 'machine-test',
      mode: 'local',
      port: 18080,
    }).replace(
      'PT_STATION_DEPLOY_ENV=fixture-station',
      'PT_STATION_DEPLOY_ENV=',
    ),
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
    profile: 'machine-test',
    slot,
    capabilities: 'station.connect',
    purpose: 'devctl station test',
    owner: 'test@example.com',
  });
  return {
    ...process.env,
    HOME: home,
    PT_ENV_REPO: envRepo,
    PT_DEV_PROFILE_FILE_AUTHORITY: 'acceptance-runtime-manifest',
    PT_ACCEPTANCE_RUNTIME_PROFILE_ROOT: root,
  };
}

async function startHealthServer(t, port = 0) {
  const server = http.createServer((_request, response) => {
    response.writeHead(200);
    response.end('ok');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
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
    const environment = machineEnvironment(t, root);
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
      ...environment,
      PT_DEV_PROFILE_FILE: profilePath,
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
  'remote deployment bridge preserves the inherited lease descriptor',
  { skip: process.platform === 'win32' },
  async (t) => {
    const root = temporaryRoot(t);
    const port = await startHealthServer(t);
    const profilePath = writeProfile(root, 'remote-lease', 'remote', port);
    const environment = machineEnvironment(t, root);
    const leasePath = path.join(root, 'lease.lock');
    fs.writeFileSync(leasePath, 'lease\n');
    const leaseFd = fs.openSync(leasePath, 'r');
    t.after(() => fs.closeSync(leaseFd));
    writeRemoteBridge(
      root,
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'eval ": <&${PT_MACHINE_LEASE_FD}"',
        'printf "inherited\\n" > "$PWD/remote-lease-inherited"',
        '',
      ].join('\n'),
    );

    await startStation(root, {
      ...environment,
      PT_DEV_PROFILE_FILE: profilePath,
      PT_MACHINE_LEASE_FD: String(leaseFd),
    });

    assert.equal(
      fs.readFileSync(path.join(root, 'remote-lease-inherited'), 'utf8'),
      'inherited\n',
    );
  },
);

test(
  'remote deployment bridge failure returns a typed bounded error',
  { skip: process.platform === 'win32' },
  async (t) => {
    const root = temporaryRoot(t);
    const profilePath = writeProfile(root, 'remote-failure', 'remote', 18080);
    const environment = machineEnvironment(t, root);
    writeRemoteBridge(
      root,
      '#!/usr/bin/env bash\nexit 23\n',
    );

    await assert.rejects(
      startStation(root, {
        ...environment,
        PT_DEV_PROFILE_FILE: profilePath,
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
  const slot = 97;
  const port = 18080 + slot * 100;
  await startHealthServer(t, port);
  const profilePath = writeProfile(root, 'local-test', 'local', port);
  const environment = machineEnvironment(t, root, slot);

  await assert.rejects(
    startStation(root, {
      ...environment,
      PT_DEV_PROFILE_FILE: profilePath,
    }),
    (error) =>
      error instanceof DevctlError
      && error.code === ERROR_CODES.PORT_CONFLICT,
  );
});
