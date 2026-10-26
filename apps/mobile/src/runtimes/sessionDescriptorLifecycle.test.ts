import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../features/auth/authStore';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  registry: vi.fn(),
  auth: vi.fn(),
  observe: null as null | (() => void),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('./stationRuntime', () => ({ readStationRegistryProjection: mocks.registry }));
vi.mock('./authRuntime', () => ({
  readAuthRuntimeSnapshot: mocks.auth,
  subscribeAuthRuntimeSnapshot: (listener: () => void) => {
    mocks.observe = listener;
    return () => { mocks.observe = null; };
  },
}));

import {
  createSessionRuntimeDescriptor,
  readSessionRuntimeSnapshot,
} from './sessionRuntime';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

const registry = {
  activeStationPeerId: 'station-a',
  entries: [{
    stationPeerId: 'station-a', url: 'https://station.example',
    label: 'Station', createdAt: 1, lastUsedAt: 1,
  }],
};

describe('Session descriptor invalidates awaited registry observations', () => {
  let runtime: ReturnType<typeof createSessionRuntimeDescriptor>;
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    const session = {
      stationPeerId: 'station-a', sessionId: 'session-a', actorPtid: 'actor-a',
      deviceId: 'installation-a', lifecycleGeneration: 1,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    };
    mocks.invoke.mockResolvedValue(session);
    mocks.registry.mockResolvedValue(registry);
    mocks.auth.mockReturnValue({ phase: 'active_session', stationPeerId: 'station-a', session });
    useAuthStore.setState({
      accessDecision: { state: 'ACCESS_DECISION_STATE_GRANTED', attemptId: 'access-a', gates: [] },
    });
    runtime = createSessionRuntimeDescriptor();
    await runtime.bootstrap({} as never);
  });
  afterEach(async () => {
    await runtime.teardown({ reason: 'app-unmount' });
    vi.useRealTimers();
  });

  it.each(['suspend', 'teardown'] as const)(
    'does not publish or re-arm refresh when registry resolves after %s',
    async (action) => {
      const pending = deferred<typeof registry>();
      mocks.registry.mockReturnValueOnce(pending.promise);
      mocks.observe!();
      if (action === 'teardown') await runtime.teardown({ reason: 'app-unmount' });
      else await runtime.suspend();
      expect(vi.getTimerCount()).toBe(0);
      const snapshot = readSessionRuntimeSnapshot();
      pending.resolve(registry);
      await Promise.resolve();
      await Promise.resolve();
      expect(readSessionRuntimeSnapshot()).toEqual(snapshot);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('ignores a registry failure that arrives after suspension', async () => {
    const pending = deferred<typeof registry>();
    mocks.registry.mockReturnValueOnce(pending.promise);
    mocks.observe!();
    await runtime.suspend();
    const snapshot = readSessionRuntimeSnapshot();
    pending.reject(new Error('late registry failure'));
    await Promise.resolve();
    await Promise.resolve();
    expect(readSessionRuntimeSnapshot()).toEqual(snapshot);
    expect(vi.getTimerCount()).toBe(0);
  });
});
