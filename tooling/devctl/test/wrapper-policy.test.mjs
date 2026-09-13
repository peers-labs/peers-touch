import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);

test('migrated development wrappers delegate lifecycle to devctl', () => {
  const makefile = fs.readFileSync(path.join(root, 'Makefile'), 'utf8');
  const localDev = fs.readFileSync(
    path.join(root, 'tooling', 'make', 'local-dev.mk'),
    'utf8',
  );
  const powershell = fs.readFileSync(
    path.join(root, 'tooling', 'dev.ps1'),
    'utf8',
  );

  for (const [name, content] of [
    ['Makefile', makefile],
    ['tooling/dev.ps1', powershell],
  ]) {
    assert.doesNotMatch(content, /\/bin\/bash|\blsof\b|\bpkill\b|\bpgrep\b|\bmktemp\b/u, name);
  }
  assert.match(localDev, /DEVCTL := node tooling\/devctl\/index\.mjs/u);
  assert.match(localDev, /station:\n\t@\$\(DEVCTL\) station start/u);
  assert.match(localDev, /desktop:\n\t@\$\(DEVCTL\) desktop start --mode app/u);
  assert.match(localDev, /desktop-web:\n\t@\$\(DEVCTL\) desktop start --mode web/u);
  assert.match(localDev, /status:\n\t@\$\(DEVCTL\) status/u);
  assert.match(powershell, /devctl\\index\.mjs/u);
});

test('cross-platform package gates do not invoke shell scripts', () => {
  const rootPackage = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
  );
  const desktopPackage = JSON.parse(
    fs.readFileSync(path.join(root, 'apps', 'desktop', 'package.json'), 'utf8'),
  );
  const mobilePackage = JSON.parse(
    fs.readFileSync(path.join(root, 'apps', 'mobile', 'package.json'), 'utf8'),
  );
  const scripts = [
    rootPackage.scripts['frontend-runtime:registry-gate'],
    desktopPackage.scripts['check:social-wire'],
    desktopPackage.scripts['check:social-runtime-boundaries'],
    mobilePackage.scripts['check:social-wire'],
    mobilePackage.scripts['check:social-runtime-boundaries'],
  ];

  for (const script of scripts) {
    assert.equal(typeof script, 'string');
    assert.doesNotMatch(script, /\.sh(?:\s|$)/u);
  }
});

test('remote Station mode delegates to the reviewed compatibility adapter', () => {
  const station = fs.readFileSync(
    path.join(root, 'tooling', 'devctl', 'station.mjs'),
    'utf8',
  );
  const bridge = station.slice(
    station.indexOf('function runRemoteStationBridge('),
    station.indexOf('export async function stationStatus('),
  );
  const start = station.slice(
    station.indexOf('export async function startStation('),
    station.indexOf('export async function stopStation('),
  );

  assert.match(bridge, /tooling.*scripts.*local-dev.*station-dev\.sh/su);
  assert.match(bridge, /spawnSync\(bash, \[script\]/u);
  assert.match(start, /values\.mode === 'remote'/u);
  assert.match(start, /runRemoteStationBridge\(root, resolved, environment\)/u);
});
