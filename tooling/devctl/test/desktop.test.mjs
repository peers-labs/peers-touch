import assert from 'node:assert/strict';
import test from 'node:test';

import { desktopTauriArguments } from '../desktop.mjs';

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
