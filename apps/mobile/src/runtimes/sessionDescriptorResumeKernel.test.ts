import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../features/auth/authStore';
import {
  destroyMobileLifecycleKernel,
  getMobileLifecycleKernel,
} from '../app/lifecycle/MobileLifecycleKernel';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  registry: vi.fn(),
  auth: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('./stationRuntime', () => ({ readStationRegistryProjection: mocks.registry }));
vi.mock('./authRuntime', () => ({
  readAuthRuntimeSnapshot: mocks.auth,
  subscribeAuthRuntimeSnapshot: () => () => undefined,
}));

import {
  createSessionRuntimeDescriptor,
  readSessionRuntimeSnapshot,
} from './sessionRuntime';
import { destroyRecoveryProjection } from './recoveryProjection';

const registry = {
  activeStationPeerId: 'station-a',
  entries: [{
    stationPeerId: 'station-a', url: 'https://station.example',
    label: 'Station', createdAt: 1, lastUsedAt: 1,
  }],
};

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

describe('Session resume revalidation against the real lifecycle kernel', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.registry.mockResolvedValue(registry);
    mocks.auth.mockReturnValue({
      phase: 'active_session',
      stationPeerId: 'station-a',
      session: activeSession(),
    });
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'oauth_session_projection') return activeSession();
      if (command === 'oauth_session_refresh') {
        throw new Error('mobile.auth.sessionCredentialRejected:401');
      }
      if (command === 'oauth_logout_purge') return completePurge();
      throw new Error(`unexpected command ${command}`);
    });
    useAuthStore.setState({
      accessDecision: {
        state: 'ACCESS_DECISION_STATE_GRANTED',
        attemptId: 'access-a',
        gates: [],
      },
    });
    destroyRecoveryProjection();
    destroyMobileLifecycleKernel();

    const kernel = getMobileLifecycleKernel();
    let bootReconcile = true;
    const generation = { current: 0 };
    const stub = (id: string, dependsOn: readonly string[] = []) => ({
      id,
      title: id,
      responsibility: id,
      dependsOn,
      async bootstrap() {},
      async suspend() {},
      async resume() {},
      async teardown() {
        return { runtimeId: id, success: true as const, durationMs: 0 };
      },
    });
    kernel.configureRuntimeGraph({
      createDescriptors: () => [
        stub('station'),
        stub('auth', ['station']),
        stub('access', ['station', 'auth']),
        createSessionRuntimeDescriptor(),
      ],
      readGeneration: async () => generation.current,
      advanceGeneration: async () => {
        generation.current += 1;
        return generation.current;
      },
      fenceProjections: () => undefined,
      resolveLaunchState: async () => {
        if (bootReconcile) return 'station-selection';
        return readSessionRuntimeSnapshot().session
          ? 'shell'
          : 'access-gate-chain';
      },
    });
    await kernel.startRuntimeGraph();
    bootReconcile = false;
    kernel.transitionLaunchState('station-handshake');
    kernel.transitionLaunchState('access-gate-chain');
    kernel.transitionLaunchState('runtime-critical');
    kernel.transitionLaunchState('shell');
  });

  afterEach(async () => {
    const kernel = getMobileLifecycleKernel();
    await kernel.stopRuntimeGraph().catch(() => undefined);
    destroyMobileLifecycleKernel();
    destroyRecoveryProjection();
  });

  it('clears the revoked session and leaves shell after a takeover resume', async () => {
    const kernel = getMobileLifecycleKernel();
    expect(kernel.getState().launchState).toBe('shell');
    expect(readSessionRuntimeSnapshot().session).not.toBeNull();

    await kernel.suspend('app-background');
    await kernel.resume('app-resume');
    expect(kernel.getState().phase).toBe('ACTIVE');

    await vi.waitFor(() => {
      expect(readSessionRuntimeSnapshot().session).toBeNull();
    });
    await vi.waitFor(() => {
      expect(kernel.getState().launchState).toBe('access-gate-chain');
    });
    expect(mocks.invoke).toHaveBeenCalledWith(
      'oauth_session_refresh',
      expect.anything(),
    );
  });
});
