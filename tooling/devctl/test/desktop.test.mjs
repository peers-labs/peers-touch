import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  desktopRuntimeIdentity,
  desktopTauriArguments,
  ensureDesktopDependencies,
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

test('desktop development keeps the default Tauri feature set', () => {
  assert.deepEqual(
    desktopTauriArguments('/tmp/tauri.conf.json', {}),
    ['dev', '--no-watch', '--config', '/tmp/tauri.conf.json'],
  );
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
