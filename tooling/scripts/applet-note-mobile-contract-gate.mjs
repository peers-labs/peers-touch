#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const evidenceDir = path.join(repoRoot, 'applet-readiness-evidence', 'official-applet');
const evidencePath = path.join(evidenceDir, 'note-mobile-contract-gate.json');
const manifestPath = path.join(repoRoot, 'apps/applets/note/applet.manifest.json');
const androidManifestParserPath = path.join(
  repoRoot,
  'apps/mobile/android/app/src/main/java/com/peerstouch/mobile/core/applet/AppletManifestParser.kt',
);
const androidSessionPath = path.join(
  repoRoot,
  'apps/mobile/android/app/src/main/java/com/peerstouch/mobile/core/applet/AppletBridgeSession.kt',
);
const androidNetworkBridgePath = path.join(
  repoRoot,
  'apps/mobile/android/app/src/main/java/com/peerstouch/mobile/core/lynx/bridge/NetworkBridgeModule.kt',
);
const androidContractTestPath = path.join(
  repoRoot,
  'apps/mobile/android/app/src/test/java/com/peerstouch/mobile/core/applet/AppletBridgeSessionContractTest.kt',
);

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function readText(filePath) {
  return readFileSync(filePath, 'utf8');
}

function writeReport(report) {
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`);
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (report.status === 'PASS') {
    process.stdout.write(output);
    return;
  }
  process.stderr.write(output);
  process.exit(1);
}

try {
  const manifest = readJson(manifestPath);
  const noteService = manifest.services?.find((service) => service?.id === 'note');
  const androidParserSource = readText(androidManifestParserPath);
  const androidSessionSource = readText(androidSessionPath);
  const androidNetworkBridgeSource = readText(androidNetworkBridgePath);
  const androidContractTestSource = readText(androidContractTestPath);

  assert.equal(manifest.id, 'peers.note');
  assert.ok(manifest.targets.includes('android'));
  assert.ok(manifest.targets.includes('ios'));
  assert.equal(manifest.load?.android?.type, 'lynx-native');
  assert.equal(manifest.load?.ios?.type, 'lynx-native');
  assert.equal(manifest.load?.android?.entry, 'main.lynx.bundle');
  assert.equal(manifest.load?.ios?.entry, 'main.lynx.bundle');
  assert.ok(manifest.permissions.includes('network.request'));
  assert.ok(noteService, 'Note manifest must declare note service');
  assert.equal(noteService.binding, 'station-resolved');
  assert.equal(noteService.publicPathPrefix, '/v1');
  assert.equal(noteService.stationPathPrefix, '/applets/note/v1');

  assert.match(androidParserSource, /publicPathPrefix/);
  assert.match(androidParserSource, /stationPathPrefix/);
  assert.match(androidParserSource, /station-resolved/);
  assert.match(androidSessionSource, /MANIFEST_SERVICES_PARAM/);
  assert.match(androidSessionSource, /withManifestContext/);
  assert.match(androidNetworkBridgeSource, /AppletServiceRequestResolver/);
  assert.match(androidNetworkBridgeSource, /stationPathPrefix/);
  assert.match(androidNetworkBridgeSource, /publicPathPrefix/);
  assert.match(androidNetworkBridgeSource, /Path is not allowed/);
  assert.match(androidContractTestSource, /stationResolvedNetworkRequestRewritesPublicPathToStationPath/);
  assert.match(androidContractTestSource, /stationResolvedNetworkRequestRejectsUndeclaredPath/);
  assert.match(androidContractTestSource, /MANIFEST_SERVICES_PARAM/);
  assert.match(androidContractTestSource, /\/applets\/note\/v1/);

  writeReport({
    status: 'PASS',
    evidenceClass: 'REAL_PRODUCT_PATH',
    appletId: 'peers.note',
    mobileReadiness: 'CONTRACT_PREPARED_NOT_RUNTIME_E2E',
    manifest: path.relative(repoRoot, manifestPath),
    targets: manifest.targets,
    androidLoad: manifest.load.android,
    iosLoad: manifest.load.ios,
    noteService,
    checkedFiles: [
      path.relative(repoRoot, androidManifestParserPath),
      path.relative(repoRoot, androidSessionPath),
      path.relative(repoRoot, androidNetworkBridgePath),
      path.relative(repoRoot, androidContractTestPath),
    ],
    runtimeEvidence: 'NOT_IMPLEMENTED: requires applet-ios-lynx-runtime-e2e / applet-android-lynx-runtime-e2e on simulator or device',
    errors: [],
  });
} catch (error) {
  writeReport({
    status: 'FAIL',
    evidenceClass: 'REAL_PRODUCT_PATH',
    appletId: 'peers.note',
    mobileReadiness: 'CONTRACT_PREPARED_NOT_RUNTIME_E2E',
    errors: [error instanceof Error ? error.message : String(error)],
  });
}
