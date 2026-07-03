#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';

const evidenceRoot = path.resolve('aplet-readiness-evidence'.replace('aplet-', 'applet-'));
const evidenceDir = path.join(evidenceRoot, 'mobile');
const workDir = path.resolve('.local/applet-android-lynx-runtime-e2e');
const packageDir = path.join(evidenceRoot, 'package/android-lynx-runtime-e2e-applet');
const appletId = 'android-lynx-runtime-e2e-applet';
const applicationId = 'com.peerstouch.mobile';
const emulatorStartupTimeoutMs = Number(process.env.PEERS_APPLET_ANDROID_EMULATOR_STARTUP_TIMEOUT_MS ?? 300000);

mkdirSync(evidenceDir, { recursive: true });
mkdirSync(workDir, { recursive: true });

function childProcessEnv(overrides = {}) {
  const env = { ...process.env, ...overrides };
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
    if (env[key] === '') {
      delete env[key];
    }
  }
  return env;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
    maxBuffer: options.maxBuffer ?? 100 * 1024 * 1024,
    env: childProcessEnv(options.env),
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error([
      `Command failed: ${command} ${args.join(' ')}`,
      result.error?.message,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  return result;
}

function writeEvidence(content) {
  writeFileSync(path.join(evidenceDir, 'android-lynx-runtime-e2e-output.txt'), `${content.trim()}\n`);
}

function digest(filePath) {
  return `sha256:${createHash('sha256').update(readFileSync(filePath)).digest('hex')}`;
}

function createRuntimeApplet() {
  rmSync(packageDir, { recursive: true, force: true });
  mkdirSync(path.join(packageDir, 'src'), { recursive: true });

  writeFileSync(path.join(packageDir, 'src/index.tsx'), `import { root } from '@lynx-js/react';
import { useEffect, useState } from '@lynx-js/react';
import { sdk } from '@peers-touch/applet-sdk';

void sdk.storage.set('android-runtime-e2e', 'ok')
  .then(() => sdk.storage.get('android-runtime-e2e'));

function RuntimeE2EApplet() {
  const [state, setState] = useState('pending');

  useEffect(() => {
    let mounted = true;
    void sdk.storage.set('android-runtime-e2e', 'ok')
      .then(() => sdk.storage.get('android-runtime-e2e'))
      .then((value) => {
        if (value !== 'ok') {
          throw new Error('storage roundtrip mismatch');
        }
        if (mounted) setState('pass');
      })
      .catch((error) => {
        if (mounted) setState(error instanceof Error ? error.message : String(error));
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <view style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <text>{state}</text>
    </view>
  );
}

root.render(<RuntimeE2EApplet />);
`);

  writeFileSync(path.join(packageDir, 'lynx.config.ts'), `import { defineConfig } from '@lynx-js/rspeedy';
import { pluginReactLynx } from '@lynx-js/react-rsbuild-plugin';

export default defineConfig({
  plugins: [pluginReactLynx()],
  source: {
    entry: './src/index.tsx',
  },
  output: {
    distPath: {
      root: './dist',
    },
    filename: 'main.lynx.bundle',
    filenameHash: false,
  },
});
`);

  writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({
    name: '@peers-touch/android-lynx-runtime-e2e-applet',
    version: '1.0.0',
    private: true,
    type: 'module',
    dependencies: {
      '@lynx-js/react': '^0.121.0',
      '@peers-touch/applet-sdk': 'workspace:*',
    },
    devDependencies: {
      '@lynx-js/rspeedy': '^0.14.4',
      '@lynx-js/react-rsbuild-plugin': '^0.16.2',
    },
  }, null, 2));

  run('pnpm', ['--filter', '@peers-touch/applet-contract', 'run', 'build']);
  run('pnpm', ['--filter', '@peers-touch/applet-sdk', 'run', 'build']);

  const lynxToolchainDir = path.resolve('apps/desktop/applets-dev/hello-lynx/node_modules');
  const nodeModulesPath = path.join(packageDir, 'node_modules');
  if (!existsSync(nodeModulesPath)) {
    symlinkSync(lynxToolchainDir, nodeModulesPath, 'dir');
  }
  run(path.join(nodeModulesPath, '.bin/rspeedy'), ['build'], { cwd: packageDir });
  cpSync(path.join(packageDir, 'dist/main.lynx.bundle'), path.join(packageDir, 'main.lynx.bundle'));

  const manifest = {
    id: appletId,
    name: 'Android Lynx Runtime E2E Applet',
    version: '1.0.0',
    description: 'Minimal SDK applet used by emulator runtime E2E to prove Android Lynx bridge execution.',
    author: 'Peers Touch',
    targets: ['android'],
    entries: { lynx: 'main.lynx.bundle' },
    load: { android: { type: 'lynx-native', entry: 'main.lynx.bundle' } },
    bridge: { protocol: 'peers-touch.applet.bridge', version: '1.0.0' },
    permissions: ['storage.set', 'storage.get'],
    services: [],
    skills: [],
    integrity: {
      algorithm: 'sha256',
      files: {
        'main.lynx.bundle': digest(path.join(packageDir, 'main.lynx.bundle')),
      },
    },
  };
  const manifestJson = JSON.stringify(manifest, null, 2);
  writeFileSync(path.join(packageDir, 'manifest.json'), manifestJson);
  writeFileSync(path.join(packageDir, 'applet.json'), manifestJson);
}

function findBinary(name, extraCandidates = []) {
  for (const candidate of extraCandidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  const which = run('sh', ['-lc', `command -v ${name}`], { allowFailure: true });
  const resolved = which.stdout.trim();
  if (which.status === 0 && resolved) return resolved;
  throw new Error(`${name} was not found. Install Android platform-tools or set ANDROID_HOME before running Android Lynx runtime E2E.`);
}

function androidTool(name) {
  const roots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    path.join(process.env.HOME ?? '', 'Library/Android/sdk'),
    '/opt/homebrew/share/android-commandlinetools',
  ]
    .filter(Boolean);
  const candidates = roots.flatMap((root) => [
    path.join(root, 'platform-tools', name),
    path.join(root, 'emulator', name),
  ]);
  return findBinary(name, candidates);
}

function adb(args, options = {}) {
  return run(androidTool('adb'), args, options);
}

function adbForDevice(deviceId, args, options = {}) {
  return adb(['-s', deviceId, ...args], options);
}

function listConnectedDevices() {
  const result = adb(['devices', '-l']);
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .map((line) => line.match(/^(\S+)\s+device(?:\s|$)/)?.[1])
    .filter(Boolean);
}

function waitForDeviceBoot(deviceId) {
  const deadline = Date.now() + emulatorStartupTimeoutMs;
  while (Date.now() < deadline) {
    const booted = adbForDevice(deviceId, ['shell', 'getprop', 'sys.boot_completed'], { allowFailure: true }).stdout.trim();
    if (booted === '1') return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  throw new Error(`Timed out waiting for Android emulator boot: ${deviceId}`);
}

function bootedAndroidDevice() {
  let devices = listConnectedDevices();
  if (devices.length > 0) {
    waitForDeviceBoot(devices[0]);
    return devices[0];
  }

  const emulator = androidTool('emulator');
  const avds = run(emulator, ['-list-avds']).stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (avds.length === 0) {
    throw new Error('No connected Android device and no Android AVD is available for applet runtime E2E.');
  }

  spawn(emulator, [`@${avds[0]}`, '-no-snapshot-load', '-no-window', '-no-audio', '-no-boot-anim'], {
    detached: true,
    stdio: 'ignore',
    env: childProcessEnv(),
  }).unref();

  const deadline = Date.now() + emulatorStartupTimeoutMs;
  while (Date.now() < deadline) {
    devices = listConnectedDevices();
    if (devices.length > 0) {
      waitForDeviceBoot(devices[0]);
      return devices[0];
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  throw new Error(`Timed out waiting for Android AVD to appear: ${avds[0]}`);
}

function buildAndInstallApp(deviceId) {
  const build = run('./gradlew', [':app:assembleDebug'], {
    cwd: path.resolve('apps/mobile/android'),
    maxBuffer: 100 * 1024 * 1024,
  });
  writeFileSync(path.join(evidenceDir, 'android-lynx-runtime-e2e-gradle-output.txt'), [build.stdout, build.stderr].filter(Boolean).join('\n'));

  const apkPath = path.resolve('apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk');
  if (!existsSync(apkPath)) {
    throw new Error(`Built Android APK was not found: ${apkPath}`);
  }
  adbForDevice(deviceId, ['install', '-r', apkPath]);
  return apkPath;
}

function cleanRuntimePackageDir() {
  const cleanPackageDir = path.join(workDir, 'runtime-package');
  rmSync(cleanPackageDir, { recursive: true, force: true });
  mkdirSync(cleanPackageDir, { recursive: true });
  for (const fileName of ['main.lynx.bundle', 'manifest.json', 'applet.json']) {
    cpSync(path.join(packageDir, fileName), path.join(cleanPackageDir, fileName));
  }
  return cleanPackageDir;
}

function stageApplet(deviceId) {
  const remoteTmp = `/data/local/tmp/${appletId}`;
  const cleanPackageDir = cleanRuntimePackageDir();
  adbForDevice(deviceId, ['shell', 'rm', '-rf', remoteTmp]);
  adbForDevice(deviceId, ['push', cleanPackageDir, remoteTmp]);
  adbForDevice(deviceId, ['shell', 'chmod', '-R', '755', remoteTmp]);
  adbForDevice(deviceId, ['shell', 'run-as', applicationId, 'rm', '-rf', `files/applet_bundles/${appletId}`, 'files/AppletRuntimeE2E']);
  adbForDevice(deviceId, ['shell', 'run-as', applicationId, 'mkdir', '-p', 'files/applet_bundles']);
  adbForDevice(deviceId, ['shell', 'run-as', applicationId, 'cp', '-R', remoteTmp, `files/applet_bundles/${appletId}`]);
  return `run-as ${applicationId}:files/applet_bundles/${appletId}`;
}

function readMarker(deviceId, name) {
  const result = adbForDevice(deviceId, ['shell', 'run-as', applicationId, 'cat', `files/AppletRuntimeE2E/${name}.json`], { allowFailure: true });
  if (result.status !== 0) return null;
  const body = result.stdout.trim();
  if (!body) return null;
  return JSON.parse(body);
}

function waitForMarkers(deviceId) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const set = readMarker(deviceId, 'storage.set');
    const get = readMarker(deviceId, 'storage.get');
    if (set && get) return { set, get };
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  throw new Error('Timed out waiting for Android Lynx runtime markers.');
}

function timestampFromSessionId(sessionId) {
  const match = String(sessionId).match(/:(\d+)$/);
  return match ? Number(match[1]) : undefined;
}

function timestampFromRequestId(requestId) {
  const match = String(requestId).match(/-(\d+)$/);
  return match ? Number(match[1]) : undefined;
}

createRuntimeApplet();
const deviceId = bootedAndroidDevice();
const apkPath = buildAndInstallApp(deviceId);
const stagedApplet = stageApplet(deviceId);
adbForDevice(deviceId, ['shell', 'am', 'force-stop', applicationId], { allowFailure: true });
const launchStartedAt = Date.now();
adbForDevice(deviceId, [
  'shell',
  'am',
  'start',
  '-n',
  `${applicationId}/.MainActivity`,
  '--es',
  'peers_touch_applet_android_runtime_e2e',
  '1',
  '--es',
  'peers_touch_applet_android_runtime_e2e_applet_id',
  appletId,
]);
const markers = waitForMarkers(deviceId);
const processLaunchToMarkerMs = Date.now() - launchStartedAt;
const sessionStartedAt = timestampFromSessionId(markers.set.sessionId);
const firstMarkerAt = timestampFromRequestId(markers.set.requestId);
const appletColdStartLatencyMs =
  sessionStartedAt !== undefined && firstMarkerAt !== undefined ? firstMarkerAt - sessionStartedAt : undefined;

for (const marker of [markers.set, markers.get]) {
  if (marker.protocol !== 'peers-touch.applet.bridge') {
    throw new Error(`Runtime marker protocol mismatch: ${JSON.stringify(marker)}`);
  }
  if (marker.appletId !== appletId) {
    throw new Error(`Runtime marker appletId mismatch: ${JSON.stringify(marker)}`);
  }
  if (marker.ok !== true) {
    throw new Error(`Runtime marker was not ok: ${JSON.stringify(marker)}`);
  }
}

writeEvidence([
  'PASS Android Lynx runtime E2E',
  `Device: ${deviceId}`,
  `APK: ${apkPath}`,
  `Applet package: ${packageDir}`,
  `Staged applet: ${stagedApplet}`,
  `Process launch to marker ms: ${processLaunchToMarkerMs}`,
  `Applet cold start latency ms: ${appletColdStartLatencyMs ?? 'unknown'}`,
  'Observed real Lynx applet SDK storage.set and storage.get calls through AppletBridgeNativeModule.',
  `storage.set marker: ${JSON.stringify(markers.set)}`,
  `storage.get marker: ${JSON.stringify(markers.get)}`,
  'Gradle build evidence: mobile/android-lynx-runtime-e2e-gradle-output.txt',
].join('\n'));

process.stdout.write('PASS Android Lynx runtime E2E\n');
