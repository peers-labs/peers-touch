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
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const evidenceRoot = path.resolve('aplet-readiness-evidence'.replace('aplet-', 'applet-'));
const evidenceDir = path.join(evidenceRoot, 'mobile');
const workDir = path.resolve('.local/applet-ios-lynx-runtime-e2e');
const packageDir = path.join(evidenceRoot, 'package/ios-lynx-runtime-e2e-applet');
const appletId = 'ios-lynx-runtime-e2e-applet';
const bundleId = 'com.peerstouch.mobile';

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
  writeFileSync(path.join(evidenceDir, 'ios-lynx-runtime-e2e-output.txt'), `${content.trim()}\n`);
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

void sdk.storage.set('ios-runtime-e2e', 'ok')
  .then(() => sdk.storage.get('ios-runtime-e2e'));

function RuntimeE2EApplet() {
  const [state, setState] = useState('pending');

  useEffect(() => {
    let mounted = true;
    void sdk.storage.set('ios-runtime-e2e', 'ok')
      .then(() => sdk.storage.get('ios-runtime-e2e'))
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
    name: '@peers-touch/ios-lynx-runtime-e2e-applet',
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
    name: 'iOS Lynx Runtime E2E Applet',
    version: '1.0.0',
    description: 'Minimal SDK applet used by simulator runtime E2E to prove iOS Lynx bridge execution.',
    author: 'Peers Touch',
    targets: ['ios'],
    entries: { lynx: 'main.lynx.bundle' },
    load: { ios: { type: 'lynx-native', entry: 'main.lynx.bundle' } },
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
  writeFileSync(path.join(packageDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

function bootedSimulator() {
  const result = run('xcrun', ['simctl', 'list', 'devices', 'booted', '-j']);
  const parsed = JSON.parse(result.stdout);
  for (const devices of Object.values(parsed.devices ?? {})) {
    const booted = devices.find((device) => device.isAvailable && device.state === 'Booted');
    if (booted) return booted;
  }
  const available = JSON.parse(run('xcrun', ['simctl', 'list', 'devices', 'available', '-j']).stdout);
  for (const devices of Object.values(available.devices ?? {})) {
    const candidate = devices.find((device) => device.isAvailable);
    if (candidate) {
      run('xcrun', ['simctl', 'boot', candidate.udid]);
      run('xcrun', ['simctl', 'bootstatus', candidate.udid, '-b']);
      return candidate;
    }
  }
  throw new Error('No available iOS simulator found for applet runtime E2E.');
}

function buildAndInstallApp(simulator) {
  const derivedDataPath = path.join(workDir, 'DerivedData');
  rmSync(derivedDataPath, { recursive: true, force: true });
  const build = run('xcodebuild', [
    '-workspace',
    path.resolve('apps/mobile/ios/PeersTouch.xcworkspace'),
    '-scheme',
    'PeersTouch',
    '-configuration',
    'Debug',
    '-sdk',
    'iphonesimulator',
    '-destination',
    `id=${simulator.udid}`,
    '-derivedDataPath',
    derivedDataPath,
    'build',
  ]);

  const rawBuildOutput = [build.stdout, build.stderr].filter(Boolean).join('\n');
  writeFileSync(path.join(evidenceDir, 'ios-lynx-runtime-e2e-xcodebuild-output.txt'), rawBuildOutput);

  const appPath = path.join(derivedDataPath, 'Build/Products/Debug-iphonesimulator/PeersTouch.app');
  if (!existsSync(appPath)) {
    throw new Error(`Built iOS app was not found: ${appPath}`);
  }
run('xcrun', ['simctl', 'install', simulator.udid, appPath]);
  return appPath;
}

function stageApplet(simulator) {
  const container = run('xcrun', ['simctl', 'get_app_container', simulator.udid, bundleId, 'data']).stdout.trim();
  const appletRoot = path.join(container, 'Library/Application Support/PeersTouch/Applets', appletId);
  const runtimeRoot = path.join(container, 'Library/Application Support/PeersTouch/AppletRuntimeE2E');
  rmSync(appletRoot, { recursive: true, force: true });
  rmSync(runtimeRoot, { recursive: true, force: true });
  mkdirSync(path.dirname(appletRoot), { recursive: true });
  cpSync(packageDir, appletRoot, { recursive: true });
  return { container, appletRoot, runtimeRoot };
}

function waitForMarker(runtimeRoot) {
  const setMarker = path.join(runtimeRoot, 'storage.set.json');
  const getMarker = path.join(runtimeRoot, 'storage.get.json');
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (existsSync(setMarker) && existsSync(getMarker)) {
      return {
        set: JSON.parse(readFileSync(setMarker, 'utf8')),
        get: JSON.parse(readFileSync(getMarker, 'utf8')),
      };
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  throw new Error(`Timed out waiting for iOS Lynx runtime markers in ${runtimeRoot}`);
}

createRuntimeApplet();
const simulator = bootedSimulator();
const appPath = buildAndInstallApp(simulator);
const staged = stageApplet(simulator);
run('xcrun', ['simctl', 'terminate', simulator.udid, bundleId], { stdio: 'pipe', allowFailure: true });
run('xcrun', [
  'simctl',
  'launch',
  '--terminate-running-process',
  simulator.udid,
  bundleId,
], {
  env: {
    SIMCTL_CHILD_PEERS_APPLET_IOS_RUNTIME_E2E: '1',
    SIMCTL_CHILD_PEERS_APPLET_IOS_RUNTIME_E2E_APPLET_ID: appletId,
  },
});
const markers = waitForMarker(staged.runtimeRoot);

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
  'PASS iOS Lynx runtime E2E',
  `Simulator: ${simulator.name} (${simulator.udid})`,
  `App: ${appPath}`,
  `Applet package: ${packageDir}`,
  `Staged applet: ${staged.appletRoot}`,
  'Observed real Lynx applet SDK storage.set and storage.get calls through AppletBridgeNativeModule.',
  `storage.set marker: ${JSON.stringify(markers.set)}`,
  `storage.get marker: ${JSON.stringify(markers.get)}`,
  'Xcode build evidence: mobile/ios-lynx-runtime-e2e-xcodebuild-output.txt',
].join('\n'));

process.stdout.write('PASS iOS Lynx runtime E2E\n');
