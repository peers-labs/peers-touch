import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  desktopFrontendLogState,
  desktopInstallSettings,
  desktopInstallTauriArguments,
  desktopInstallTauriConfig,
  desktopRuntimeIdentity,
  desktopTauriArguments,
  desktopViteEntryUrl,
  desktopViteReadinessUrl,
  ensureDesktopDependencies,
  ensureDesktopGeneratedSources,
  reconcileDesktopRuntime,
  replaceDesktopApplication,
  signDesktopApplication,
  waitForDesktopFrontend,
  waitForDesktopVite,
  warmDesktopViteModuleGraph,
} from '../desktop.mjs';
import { ERROR_CODES } from '../errors.mjs';

function dependencyFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devctl-desktop-deps-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    root,
    values: {
      viteScript: path.join(root, 'apps', 'desktop', 'node_modules', 'vite.js'),
      tauriScript: path.join(root, 'apps', 'desktop', 'node_modules', 'tauri.js'),
      dependencyLog: path.join(root, 'runtime', 'desktop-dependencies-install.log'),
    },
  };
}

function generatedSourceFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devctl-desktop-proto-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const protoRoot = path.join(root, 'model');
  const protoOutput = path.join(root, 'apps', 'desktop', 'src', 'gen', 'proto');
  const modelBuildScript = path.join(protoRoot, 'build.sh');
  fs.mkdirSync(path.join(protoRoot, 'domain', 'chat'), { recursive: true });
  fs.writeFileSync(
    path.join(protoRoot, 'domain', 'chat', 'storage.proto'),
    'syntax = "proto3";\n',
  );
  fs.writeFileSync(modelBuildScript, '#!/bin/bash\n');
  fs.chmodSync(modelBuildScript, 0o755);
  return {
    root,
    output: path.join(protoOutput, 'domain', 'chat', 'storage_pb.ts'),
    values: {
      protoRoot,
      protoOutput,
      modelBuildScript,
      generatedSourceLog: path.join(root, 'runtime', 'desktop-proto.log'),
    },
  };
}

test('desktop development keeps the default Tauri feature set', () => {
  assert.deepEqual(
    desktopTauriArguments('/tmp/tauri.conf.json', {}),
    ['dev', '--no-watch', '--config', '/tmp/tauri.conf.json'],
  );
});

test('desktop install has one stable development identity', () => {
  assert.deepEqual(
    desktopInstallSettings({}, '/Users/example'),
    {
      appId: 'com.peers.touch.desktop.dev',
      productName: 'Peers Dev',
      deepLinkScheme: 'peers-touch-dev',
      installDirectory: '/Users/example/Applications',
      installPath: '/Users/example/Applications/Peers Dev.app',
    },
  );
});

test('desktop install accepts explicit identifier and destination overrides', () => {
  assert.deepEqual(
    desktopInstallSettings(
      {
        PT_DESKTOP_APP_ID: 'org.example.peers.dev',
        PT_DESKTOP_INSTALL_DIR: '/tmp/desktop-apps',
      },
      '/Users/example',
    ),
    {
      appId: 'org.example.peers.dev',
      productName: 'Peers Dev',
      deepLinkScheme: 'peers-touch-dev',
      installDirectory: '/tmp/desktop-apps',
      installPath: '/tmp/desktop-apps/Peers Dev.app',
    },
  );
});

test('desktop install rejects invalid application identifiers', () => {
  assert.throws(
    () =>
      desktopInstallSettings(
        { PT_DESKTOP_APP_ID: 'invalid_app_id' },
        '/Users/example',
      ),
    (error) => {
      assert.equal(error.code, ERROR_CODES.CHECK_FAILED);
      assert.equal(error.details.appId, 'invalid_app_id');
      return true;
    },
  );
});

test('desktop install builds only the macOS app bundle with dev overrides', () => {
  const settings = desktopInstallSettings({}, '/Users/example');
  assert.deepEqual(desktopInstallTauriConfig(settings), {
    productName: 'Peers Dev',
    identifier: 'com.peers.touch.desktop.dev',
    plugins: {
      'deep-link': {
        desktop: {
          schemes: ['peers-touch-dev'],
        },
      },
    },
  });
  assert.deepEqual(
    desktopInstallTauriArguments('/tmp/desktop-install.conf.json'),
    [
      'build',
      '--bundles',
      'app',
      '--config',
      '/tmp/desktop-install.conf.json',
    ],
  );
});

test('desktop install signs and verifies the staged macOS application', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-codesign-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const codesign = path.join(root, 'codesign');
  fs.writeFileSync(codesign, '');
  const calls = [];

  assert.deepEqual(
    signDesktopApplication(
      '/tmp/Peers Dev.app',
      (command, args, options) => {
        calls.push({ command, args, options });
        return { status: 0, stdout: '', stderr: '' };
      },
      codesign,
    ),
    { signed: true, appPath: '/tmp/Peers Dev.app' },
  );
  assert.deepEqual(calls, [
    {
      command: codesign,
      args: ['--force', '--deep', '--sign', '-', '/tmp/Peers Dev.app'],
      options: { encoding: 'utf8', windowsHide: true },
    },
    {
      command: codesign,
      args: ['--verify', '--deep', '--strict', '/tmp/Peers Dev.app'],
      options: { encoding: 'utf8', windowsHide: true },
    },
  ]);
});

test('desktop install atomically replaces the previous application', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-install-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'build', 'Peers Dev.app');
  const installPath = path.join(root, 'Applications', 'Peers Dev.app');
  fs.mkdirSync(sourcePath, { recursive: true });
  fs.mkdirSync(installPath, { recursive: true });
  fs.writeFileSync(path.join(sourcePath, 'version.txt'), 'new');
  fs.writeFileSync(path.join(installPath, 'version.txt'), 'old');

  assert.equal(
    replaceDesktopApplication(sourcePath, installPath, (stagingPath) => {
      fs.writeFileSync(path.join(stagingPath, 'signed.txt'), 'signed');
    }),
    installPath,
  );
  assert.equal(
    fs.readFileSync(path.join(installPath, 'version.txt'), 'utf8'),
    'new',
  );
  assert.equal(
    fs.readFileSync(path.join(installPath, 'signed.txt'), 'utf8'),
    'signed',
  );
  assert.equal(
    fs.readdirSync(path.dirname(installPath)).some(
      (entry) => entry.includes('.installing-') || entry.includes('.previous-'),
    ),
    false,
  );
});

test('desktop waits for the Vite dependency canary before launching Tauri', async () => {
  assert.equal(
    desktopViteReadinessUrl(3210),
    'http://127.0.0.1:3210/src/services/desktop_api.ts',
  );
  const processAlive = () => true;
  const calls = [];
  const warmups = [];
  const stabilizationDurations = [];
  const result = await waitForDesktopVite(
    3210,
    'app',
    processAlive,
    async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200 };
    },
    async (webPort) => {
      warmups.push(webPort);
      return { ok: true, modules: 2 };
    },
    async (durationMs) => {
      stabilizationDurations.push(durationMs);
    },
  );
  assert.deepEqual(result, { ok: true, status: 200 });
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.deepEqual(call, {
      url: 'http://127.0.0.1:3210/src/services/desktop_api.ts',
      options: {
        label: 'Desktop app Vite',
        processAlive,
      },
    });
  }
  assert.deepEqual(warmups, [3210]);
  assert.deepEqual(stabilizationDurations, [3_000]);
});

test('desktop warms the transformed Vite module graph', async () => {
  assert.equal(
    desktopViteEntryUrl(3210),
    'http://127.0.0.1:3210/src/main.tsx',
  );
  const modules = new Map([
    [
      'http://127.0.0.1:3210/src/main.tsx',
      "import App from \"/src/App.tsx\"; import \"/src/index.css\"; const note = 'import \":\"';",
    ],
    ['http://127.0.0.1:3210/src/App.tsx', 'export default {};'],
    ['http://127.0.0.1:3210/src/index.css', 'export default \"\";'],
  ]);
  const result = await warmDesktopViteModuleGraph(3210, async (url) => ({
    ok: modules.has(url),
    status: modules.has(url) ? 200 : 404,
    text: async () => modules.get(url) ?? '',
  }));
  assert.deepEqual(result, {
    ok: true,
    url: 'http://127.0.0.1:3210/src/main.tsx',
    modules: 3,
  });
});

test('desktop frontend readiness distinguishes mount from boot failure', async () => {
  assert.deepEqual(
    desktopFrontendLogState(
      '[frontend] [500ms] React app mounted — dismissing boot fallback',
    ),
    { ready: true },
  );
  assert.deepEqual(
    desktopFrontendLogState(
      '[frontend] [400ms] RESOURCE LOAD ERROR: http://127.0.0.1/main.tsx',
    ),
    {
      ready: false,
      failure:
        '[frontend] [400ms] RESOURCE LOAD ERROR: http://127.0.0.1/main.tsx',
    },
  );

  const result = await waitForDesktopFrontend('/tmp/desktop.log', {
    processAlive: () => true,
    readLog: () =>
      '[frontend] [500ms] React app mounted — dismissing boot fallback',
    wait: async () => {},
  });
  assert.deepEqual(result, { ready: true });
});

test('desktop acceptance enables the embedded WebDriver feature', () => {
  assert.deepEqual(
    desktopTauriArguments('/tmp/tauri.conf.json', {
      PT_DESKTOP_E2E: 'true',
    }),
    [
      'dev',
      '--no-watch',
      '--features',
      'e2e-testing',
      '--config',
      '/tmp/tauri.conf.json',
    ],
  );
});

test('desktop development uses profile-scoped runtime identity defaults', () => {
  assert.deepEqual(
    desktopRuntimeIdentity(
      {
        runtimeProfile: 'one-app',
        storageRoot: '/tmp/one/desktop-app',
      },
      {},
    ),
    {
      profile: 'one-app',
      storageRoot: '/tmp/one/desktop-app',
    },
  );
});

test('desktop acceptance preserves explicit client runtime identity', () => {
  assert.deepEqual(
    desktopRuntimeIdentity(
      {
        runtimeProfile: 'chat-native-disposable-app',
        storageRoot: '/tmp/chat-native-disposable/desktop-app',
      },
      {
        PT_PROFILE: 'foundation-native',
        PEERS_STORAGE_ROOT: '/tmp/pt-agent-v2-run/native/storage',
      },
    ),
    {
      profile: 'foundation-native',
      storageRoot: '/tmp/pt-agent-v2-run/native/storage',
    },
  );
});

test('desktop dependency preparation is a no-op when tool entrypoints exist', (t) => {
  const fixture = dependencyFixture(t);
  for (const toolScript of [
    fixture.values.viteScript,
    fixture.values.tauriScript,
  ]) {
    fs.mkdirSync(path.dirname(toolScript), { recursive: true });
    fs.writeFileSync(toolScript, '');
  }

  const result = ensureDesktopDependencies(
    fixture.root,
    { command: 'pnpm', prefix: [] },
    {},
    fixture.values,
    () => {
      assert.fail('dependency installation should not run');
    },
  );

  assert.deepEqual(result, { installed: false, missingBefore: [] });
});

test('desktop dependency preparation installs the frozen workspace lockfile', (t) => {
  const fixture = dependencyFixture(t);
  const environment = { TEST_MARKER: 'desktop-dependencies' };
  const calls = [];

  const result = ensureDesktopDependencies(
    fixture.root,
    { command: '/tools/pnpm', prefix: ['shim.cjs'] },
    environment,
    fixture.values,
    (command, args, options) => {
      calls.push({ command, args, options });
      for (const toolScript of [
        fixture.values.viteScript,
        fixture.values.tauriScript,
      ]) {
        fs.mkdirSync(path.dirname(toolScript), { recursive: true });
        fs.writeFileSync(toolScript, '');
      }
      return { status: 0, stdout: 'installed\n', stderr: '' };
    },
  );

  assert.equal(result.installed, true);
  assert.deepEqual(result.missingBefore, [
    fixture.values.viteScript,
    fixture.values.tauriScript,
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, '/tools/pnpm');
  assert.deepEqual(calls[0].args, [
    'shim.cjs',
    'install',
    '--frozen-lockfile',
  ]);
  assert.equal(calls[0].options.cwd, fixture.root);
  assert.equal(calls[0].options.env, environment);
  assert.equal(
    fs.readFileSync(fixture.values.dependencyLog, 'utf8'),
    'installed\n',
  );
});

test('desktop dependency preparation preserves a typed install failure', (t) => {
  const fixture = dependencyFixture(t);

  assert.throws(
    () =>
      ensureDesktopDependencies(
        fixture.root,
        { command: '/tools/pnpm', prefix: [] },
        {},
        fixture.values,
        () => ({
          status: 1,
          signal: null,
          stdout: '',
          stderr: 'lockfile mismatch\n',
        }),
      ),
    (error) =>
      error.code === ERROR_CODES.DEPENDENCY_MISSING
      && error.message.includes('dependency installation failed'),
  );
  assert.equal(
    fs.readFileSync(fixture.values.dependencyLog, 'utf8'),
    'lockfile mismatch\n',
  );
});

test('desktop generated-source preparation fills missing proto bindings once', (t) => {
  const fixture = generatedSourceFixture(t);
  const calls = [];
  const runCommand = (command, args, options) => {
    calls.push({ command, args, options });
    fs.mkdirSync(path.dirname(fixture.output), { recursive: true });
    fs.writeFileSync(fixture.output, 'export {};\n');
    return { status: 0, stdout: 'generated\n', stderr: '' };
  };

  const generated = ensureDesktopGeneratedSources(
    fixture.root,
    process.env,
    fixture.values,
    runCommand,
  );
  const reused = ensureDesktopGeneratedSources(
    fixture.root,
    process.env,
    fixture.values,
    runCommand,
  );

  assert.equal(generated.generated, true);
  assert.deepEqual(generated.missingBefore, [fixture.output]);
  assert.equal(reused.generated, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args[0], fixture.values.modelBuildScript);
  assert.equal(
    fs.readFileSync(fixture.values.generatedSourceLog, 'utf8'),
    'generated\n',
  );
});

test('desktop partial managed runtime is stopped before restart', () => {
  const stopped = [];
  const values = {
    mode: 'app',
    tauriService: 'desktop-app-tauri',
    viteService: 'desktop-app-vite',
  };
  const result = reconcileDesktopRuntime(
    '/runtime',
    values,
    {
      web: {
        health: { ok: true },
        process: {
          status: 'running',
          record: { sourceCommit: 'old' },
        },
      },
      gateway: {
        listening: false,
        process: { status: 'stale', record: {} },
      },
    },
    'current',
    (stateDirectory, service) => {
      stopped.push({ stateDirectory, service });
      return { status: 'stopped' };
    },
  );

  assert.equal(result.reused, false);
  assert.deepEqual(stopped, [
    { stateDirectory: '/runtime', service: 'desktop-app-tauri' },
    { stateDirectory: '/runtime', service: 'desktop-app-vite' },
  ]);
});

test('desktop reuses only a complete source-matched managed runtime', () => {
  const values = {
    mode: 'app',
    tauriService: 'desktop-app-tauri',
    viteService: 'desktop-app-vite',
  };
  const existing = {
    web: {
      health: { ok: true },
      process: {
        status: 'running',
        record: { sourceCommit: 'current' },
      },
    },
    gateway: {
      listening: true,
      process: {
        status: 'running',
        record: { sourceCommit: 'current' },
      },
    },
  };

  assert.deepEqual(
    reconcileDesktopRuntime(
      '/runtime',
      values,
      existing,
      'current',
      () => assert.fail('source-matched runtime must not be stopped'),
    ),
    { reused: true, stopped: [] },
  );
});

test('desktop recycles a complete managed runtime from another source commit', () => {
  const stopped = [];
  const values = {
    mode: 'app',
    tauriService: 'desktop-app-tauri',
    viteService: 'desktop-app-vite',
  };
  const result = reconcileDesktopRuntime(
    '/runtime',
    values,
    {
      web: {
        health: { ok: true },
        process: {
          status: 'running',
          record: { sourceCommit: 'old' },
        },
      },
      gateway: {
        listening: true,
        process: {
          status: 'running',
          record: { sourceCommit: 'old' },
        },
      },
    },
    'current',
    (_stateDirectory, service) => {
      stopped.push(service);
      return { status: 'stopped' };
    },
  );

  assert.equal(result.reused, false);
  assert.deepEqual(stopped, [
    'desktop-app-tauri',
    'desktop-app-vite',
  ]);
});

test('desktop never reconciles a foreign runtime-state record', () => {
  assert.throws(
    () =>
      reconcileDesktopRuntime(
        '/runtime',
        {
          mode: 'app',
          tauriService: 'desktop-app-tauri',
          viteService: 'desktop-app-vite',
        },
        {
          web: {
            health: { ok: true },
            process: { status: 'foreign', record: {} },
          },
          gateway: {
            listening: false,
            process: { status: 'absent' },
          },
        },
        'current',
        () => assert.fail('foreign runtime must not be stopped'),
      ),
    (error) =>
      error.code === ERROR_CODES.PROCESS_IDENTITY_MISMATCH,
  );
});
