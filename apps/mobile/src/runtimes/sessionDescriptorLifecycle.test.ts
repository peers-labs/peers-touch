import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../features/auth/authStore';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  registry: vi.fn(),
  auth: vi.fn(),
  observe: null as null | (() => void),
  kernelReconcile: vi.fn(),
  kernelPhase: 'ACTIVE' as string,
  kernelListeners: [] as Array<(event: unknown) => void>,
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('./stationRuntime', () => ({ readStationRegistryProjection: mocks.registry }));
vi.mock('../app/lifecycle/MobileLifecycleKernel', () => ({
  getMobileLifecycleKernel: () => ({
    getState: () => ({ phase: mocks.kernelPhase }),
    reconcileLaunchState: mocks.kernelReconcile,
    onEvent: (listener: (event: unknown) => void) => {
      mocks.kernelListeners.push(listener);
      return () => {};
    },
  }),
}));
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
import { destroyRecoveryProjection } from './recoveryProjection';

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
    mocks.auth.mockReturnValue({
      phase: 'active_session',
      stationPeerId: 'station-a',
      session,
    });
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

const activeSession = () => ({
  stationPeerId: 'station-a',
  sessionId: 'session-a',
  actorPtid: 'actor-a',
  deviceId: 'installation-a',
  lifecycleGeneration: 1,
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
});

const completePurge = () => ({
  stationRevocation: 'confirmed',
  secureStorage: {
    activeAttemptIndexAbsent: true,
    attemptSecretRecordAbsent: true,
    currentSessionIndexAbsent: true,
    credentialRecordAbsent: true,
    publicProjectionAbsent: true,
  },
});

describe('Session descriptor revalidates the restored session on resume', () => {
  let descriptor: ReturnType<typeof createSessionRuntimeDescriptor>;

  beforeEach(async () => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mocks.kernelListeners.length = 0;
    mocks.kernelPhase = 'ACTIVE';
    mocks.kernelReconcile.mockResolvedValue(undefined);
    mocks.registry.mockResolvedValue(registry);
    mocks.auth.mockReturnValue({
      phase: 'active_session',
      stationPeerId: 'station-a',
      session: activeSession(),
    });
    useAuthStore.setState({
      accessDecision: { state: 'ACCESS_DECISION_STATE_GRANTED', attemptId: 'access-a', gates: [] },
    });
  });

  afterEach(async () => {
    await descriptor?.teardown({ reason: 'app-unmount' });
    destroyRecoveryProjection();
  });

  async function bootWithInvoke(routes: (command: string) => Promise<unknown>) {
    mocks.invoke.mockImplementation((command: string) => routes(command));
    descriptor = createSessionRuntimeDescriptor();
    await descriptor.bootstrap({} as never);
    return descriptor;
  }

  it('rotates the active session through the Station after resume while staying in shell', async () => {
    const commands: string[] = [];
    await bootWithInvoke(async (command) => {
      commands.push(command);
      if (command === 'oauth_session_projection') return activeSession();
      if (command === 'oauth_session_refresh') {
        return { ...activeSession(), sessionId: 'session-rotated' };
      }
      throw new Error(`unexpected command ${command}`);
    });

    await descriptor.resume({} as never);
    await vi.waitFor(() => expect(commands).toContain('oauth_session_refresh'));
    expect(readSessionRuntimeSnapshot()).toMatchObject({
      phase: 'active',
      session: { sessionId: 'session-rotated' },
    });
    expect(mocks.kernelReconcile).not.toHaveBeenCalled();
  });

  it('revokes a server-replaced session on resume and reconciles the launch state', async () => {
    const commands: string[] = [];
    await bootWithInvoke(async (command) => {
      commands.push(command);
      if (command === 'oauth_session_projection') return activeSession();
      if (command === 'oauth_session_refresh') {
        throw new Error('mobile.auth.sessionCredentialRejected:401');
      }
      if (command === 'oauth_logout_purge') return completePurge();
      throw new Error(`unexpected command ${command}`);
    });

    await descriptor.resume({} as never);
    await vi.waitFor(() => expect(commands).toContain('oauth_logout_purge'));
    await vi.waitFor(() =>
      expect(mocks.kernelReconcile).toHaveBeenCalledWith('reliability-recovery'),
    );
    expect(readSessionRuntimeSnapshot().session).toBeNull();
  });

  it('classifies a plain-object Tauri 401 rejection as terminal', async () => {
    const commands: string[] = [];
    await bootWithInvoke(async (command) => {
      commands.push(command);
      if (command === 'oauth_session_projection') return activeSession();
      if (command === 'oauth_session_refresh') {
        // Tauri v2 can reject with a serialized object rather than an Error.
        throw {
          code: 'MOBILE_OAUTH',
          message: 'mobile.auth.sessionCredentialRejected:401',
        };
      }
      if (command === 'oauth_logout_purge') return completePurge();
      throw new Error(`unexpected command ${command}`);
    });

    await descriptor.resume({} as never);
    await vi.waitFor(() => expect(commands).toContain('oauth_logout_purge'));
    expect(readSessionRuntimeSnapshot().session).toBeNull();
  });

  it('retains the cached session and stays in shell when the Station is unreachable', async () => {
    const commands: string[] = [];
    await bootWithInvoke(async (command) => {
      commands.push(command);
      if (command === 'oauth_session_projection') return activeSession();
      if (command === 'oauth_session_refresh') {
        throw new Error('mobile.auth.oauthTransportUnavailable:offline');
      }
      throw new Error(`unexpected command ${command}`);
    });

    await descriptor.resume({} as never);
    await vi.waitFor(() => expect(commands).toContain('oauth_session_refresh'));
    await Promise.resolve();
    expect(commands).not.toContain('oauth_logout_purge');
    expect(readSessionRuntimeSnapshot()).toMatchObject({
      phase: 'active',
      session: { sessionId: 'session-a' },
    });
    expect(mocks.kernelReconcile).not.toHaveBeenCalled();
  });

  it('does not reconcile when suspension fences the resume revalidation', async () => {
    const refresh = deferred<never>();
    const commands: string[] = [];
    await bootWithInvoke(async (command) => {
      commands.push(command);
      if (command === 'oauth_session_projection') return activeSession();
      if (command === 'oauth_session_refresh') return refresh.promise;
      if (command === 'oauth_logout_purge') return completePurge();
      throw new Error(`unexpected command ${command}`);
    });

    await descriptor.resume({} as never);
    await vi.waitFor(() => expect(commands).toContain('oauth_session_refresh'));
    await descriptor.suspend();
    refresh.reject(new Error('mobile.auth.sessionCredentialRejected:401'));
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.kernelReconcile).not.toHaveBeenCalled();
  });

  it('cancels the pending probe when suspension precedes the ACTIVE event', async () => {
    mocks.kernelPhase = 'RESUMING';
    const commands: string[] = [];
    await bootWithInvoke(async (command) => {
      commands.push(command);
      if (command === 'oauth_session_projection') return activeSession();
      if (command === 'oauth_session_refresh') {
        throw new Error('mobile.auth.sessionCredentialRejected:401');
      }
      if (command === 'oauth_logout_purge') return completePurge();
      throw new Error(`unexpected command ${command}`);
    });

    await descriptor.resume({} as never);
    await descriptor.suspend();
    mocks.kernelPhase = 'ACTIVE';
    mocks.kernelListeners.forEach((listener) => {
      listener({ kind: 'phase-changed', phase: 'ACTIVE' });
    });
    await Promise.resolve();

    expect(commands).not.toContain('oauth_session_refresh');
    expect(commands).not.toContain('oauth_logout_purge');
    expect(mocks.kernelReconcile).not.toHaveBeenCalled();
  });

  it('defers the probe until the kernel emits phase-changed ACTIVE', async () => {
    mocks.kernelPhase = 'RESUMING';
    const commands: string[] = [];
    await bootWithInvoke(async (command) => {
      commands.push(command);
      if (command === 'oauth_session_projection') return activeSession();
      if (command === 'oauth_session_refresh') {
        return { ...activeSession(), sessionId: 'session-rotated' };
      }
      throw new Error(`unexpected command ${command}`);
    });

    await descriptor.resume({} as never);
    await Promise.resolve();
    expect(commands).not.toContain('oauth_session_refresh');

    mocks.kernelPhase = 'ACTIVE';
    mocks.kernelListeners.forEach((listener) => {
      listener({ kind: 'phase-changed', phase: 'ACTIVE' });
    });
    await vi.waitFor(() => expect(commands).toContain('oauth_session_refresh'));
    expect(mocks.kernelReconcile).not.toHaveBeenCalled();
  });
});
