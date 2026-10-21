import assert from 'node:assert/strict';

import {
  createClientStorageKernel,
  safeStorageKey,
} from '../dist/index.js';

const values = new Map();
const kernel = createClientStorageKernel({
  adapter: {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
    removeItem: async (key) => {
      values.delete(key);
    },
    keys: async (prefix) => (
      [...values.keys()].filter((key) => key.startsWith(prefix))
    ),
  },
  scope: {
    app: 'test',
    station: 'station-one',
    actor: 'ptid:alice',
    device: 'device-one',
    session: 'session-one',
  },
  clock: () => 1_000,
});

const repository = kernel.repository('runtime.projection');
await repository.write('chat', { ready: true }, { ttlMs: 500 });
assert.deepEqual(await repository.readValue('chat'), { ready: true });
assert.equal(
  kernel.cache.storageKey('runtime.projection', 'chat')
    .includes('station-one:ptid_alice:device-one:session-one'),
  true,
);
assert.equal(safeStorageKey(['actor:alice', 'chat/thread']), 'actor_alice.chat_thread');

await repository.invalidate();
assert.equal(await repository.readValue('chat'), null);
