#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const evidenceRoot = path.resolve('applet-readiness-evidence');
const outputPath = path.join(evidenceRoot, 'mobile', 'lifecycle-hardening-gate-output.txt');
mkdirSync(path.dirname(outputPath), { recursive: true });

function read(filePath) {
  return readFileSync(filePath, 'utf8');
}

function latencyFromEvidence(evidence, label) {
  const match = evidence.match(new RegExp(`${label}: (\\d+)`));
  assert.ok(match, `Missing latency evidence: ${label}`);
  return Number(match[1]);
}

const androidE2E = read('applet-readiness-evidence/mobile/android-lynx-runtime-e2e-output.txt');
const iosE2E = read('applet-readiness-evidence/mobile/ios-lynx-runtime-e2e-output.txt');
const nativeManifestGate = read('applet-readiness-evidence/mobile/native-manifest-gate-output.txt');
const androidKernelTest = read('apps/mobile/android/app/src/test/java/com/peerstouch/mobile/core/applet/kernel/AppletKernelPolicyTest.kt');
const androidSurfaceCache = read('apps/mobile/android/app/src/main/java/com/peerstouch/mobile/core/applet/kernel/AppletSurfaceCache.kt');
const iosManager = read('apps/mobile/ios/PeersTouch/Core/Applet/AppletManager.swift');
const iosRepresentable = read('apps/mobile/ios/PeersTouch/Core/Applet/UI/AppletLynxViewRepresentable.swift');

assert.match(androidE2E, /PASS Android Lynx runtime E2E/);
assert.match(iosE2E, /PASS iOS Lynx runtime E2E/);
assert.match(nativeManifestGate, /PASS Android JVM AppletBridgeSessionContractTest executed/);
assert.match(nativeManifestGate, /PASS iOS AppletBridgeSession and BridgeDispatcher enforce/);

const androidColdStartMs = latencyFromEvidence(androidE2E, 'Applet cold start latency ms');
const iosColdStartMs = latencyFromEvidence(iosE2E, 'Applet cold start latency ms');
assert.ok(androidColdStartMs < 800, `Android applet cold start latency exceeded 800ms: ${androidColdStartMs}`);
assert.ok(iosColdStartMs < 800, `iOS applet cold start latency exceeded 800ms: ${iosColdStartMs}`);

assert.match(androidKernelTest, /lruSuspendsOldestHiddenWarmInstanceWhenMobileLimitIsExceeded/);
assert.match(androidKernelTest, /sweepAppliesHiddenWarmAndSuspendedTtlPolicies/);
assert.match(androidKernelTest, /memoryPressureDestroysOnlyPolicySelectedInstances/);
assert.match(androidKernelTest, /AppletResourcePolicy\.MOBILE\.hiddenWarmTtlMs/);
assert.match(androidKernelTest, /AppletResourcePolicy\.MOBILE\.suspendedTtlMs/);
assert.match(androidKernelTest, /MemoryPressureLevel\.MODERATE/);
assert.match(androidKernelTest, /MemoryPressureLevel\.CRITICAL/);

assert.match(androidSurfaceCache, /SurfaceCommand\.SHOW/);
assert.match(androidSurfaceCache, /SurfaceCommand\.HIDE/);
assert.match(androidSurfaceCache, /SurfaceCommand\.DETACH/);
assert.match(androidSurfaceCache, /SurfaceCommand\.DESTROY/);
assert.match(androidSurfaceCache, /surfaces\[appletId\]\?\.let/);

assert.match(iosManager, /hiddenWarmTtl: 30 \* 60/);
assert.match(iosManager, /suspendedTtl: 120 \* 60/);
assert.match(iosManager, /pausedTtl: 15 \* 60/);
assert.match(iosManager, /case \.moderate/);
assert.match(iosManager, /case \.critical/);
assert.match(iosManager, /sceneDidEnterBackground|pauseActiveInstances|resumePausedInstances/s);

assert.match(iosRepresentable, /AppletSurfaceCache/);
assert.match(iosRepresentable, /case \.show/);
assert.match(iosRepresentable, /case \.hide/);
assert.match(iosRepresentable, /case \.detach/);
assert.match(iosRepresentable, /case \.destroy/);

writeFileSync(
  outputPath,
  [
    'PASS applet lifecycle hardening source/runtime gate',
    `Android applet cold start latency ms: ${androidColdStartMs}`,
    `iOS applet cold start latency ms: ${iosColdStartMs}`,
    'PASS multi-instance LRU source test coverage: Android AppletKernelPolicyTest',
    'PASS long-background TTL source test coverage: Android AppletKernelPolicyTest + iOS scheduler constants',
    'PASS memory pressure coverage: Android source test + iOS scheduler implementation',
    'PASS runtime E2E evidence: Android/iOS real Lynx applet SDK bridge markers observed',
    'PASS surface cache evidence: Android View cache and iOS UIView cache implement show/hide/detach/destroy',
    'NOT_IMPLEMENTED hot restore latency runtime measurement (<80ms): requires dedicated A→B→A switch benchmark runner',
  ].join('\n') + '\n',
);

process.stdout.write('PASS applet lifecycle hardening gate\n');
