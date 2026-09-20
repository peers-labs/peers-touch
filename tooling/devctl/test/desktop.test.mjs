import assert from 'node:assert/strict';
import test from 'node:test';

import {
  desktopRuntimeIdentity,
  desktopTauriArguments,
} from '../desktop.mjs';

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
