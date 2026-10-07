// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { afterEach, describe, expect, it, vi } from 'vitest';

const runtimeMocks = vi.hoisted(() => {
  const projectionRuntime = {
    ingress: {
      state: vi.fn(() => ({
        lifecycle: 'active',
        streamCursor: 'cursor-1',
        writeAdmission: { open: true },
        staleness: {},
        dataQueueDepth: 0,
        controlQueueDepth: 0,
      })),
      ingestControlEvent: vi.fn(),
    },
    bootstrap: vi.fn(async () => undefined),
    requestCurrentUserProfile: vi.fn(async () => undefined),
    requestPeerProfiles: vi.fn(async () => undefined),
    requestFriendshipStatus: vi.fn(async () => undefined),
    suspend: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    reconcile: vi.fn(async () => undefined),
    ingestRealtimeEvent: vi.fn(),
    dispatchExternalEvent: vi.fn(),
    drain: vi.fn(async () => undefined),
    teardown: vi.fn(async () => undefined),
  };
  return {
    projectionRuntime,
    createSocialProjectionRuntime: vi.fn(() => projectionRuntime),
    startRealtimeStream: vi.fn(
      async (_session, signal, handlers) => new Promise<void>((resolve) => {
        handlers.onConnected?.('cursor-1');
        signal.addEventListener('abort', () => resolve(), { once: true });
      }),
    ),
  };
});

const callMocks = vi.hoisted(() => ({
  activate: vi.fn(async () => undefined),
  ingestRealtimeSignal: vi.fn(async () => undefined),
  suspend: vi.fn(),
  resume: vi.fn(async () => undefined),
  reset: vi.fn(),
}));

vi.mock('../../runtimes/socialProjectionRuntime', () => ({
  createSocialProjectionRuntime: runtimeMocks.createSocialProjectionRuntime,
  readActiveSocialIngressState: vi.fn(
    () => runtimeMocks.projectionRuntime.ingress.state(),
  ),
}));

vi.mock('./socialRealtime', () => ({
  startRealtimeStream: runtimeMocks.startRealtimeStream,
}));

vi.mock('../../runtimes/accessRuntime', () => ({
  restoreAndRevalidateAccessRuntime: vi.fn(async () => undefined),
}));

vi.mock('../../runtimes/messagingRuntime', () => ({
  MOBILE_MESSAGING_RUNTIME_ERROR_EVENT: 'mobile:messaging-runtime-error',
  wakeActiveMessagingSession: vi.fn(async () => undefined),
}));

vi.mock('../call/callState', () => ({
  mobileCallManager: callMocks,
}));

import {
  reconcileSocialRuntime,
  requestSocialBlockedUsers,
  requestSocialCurrentUserProfile,
  requestSocialFriendshipStatus,
  requestSocialPeerProfiles,
  startSocialRuntime,
  unblockSocialUser,
} from './socialRuntime';

const session = {
  stationPeerId: 'station-primary',
  stationUrl: 'https://station.example',
  sessionId: 'session-1',
  actorRef: { ptid: 'ptid:alice' },
  authenticatedAt: 1,
};

describe('social runtime supervisor', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('owns one shared projection runtime across suspend and resume', async () => {
    let timerId = 0;
    vi.stubGlobal('window', {
      setInterval: vi.fn(() => {
        timerId += 1;
        return timerId;
      }),
      clearInterval: vi.fn(),
      setTimeout: vi.fn(() => {
        timerId += 1;
        return timerId;
      }),
      clearTimeout: vi.fn(),
      dispatchEvent: vi.fn(),
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));

    const socialStore = {
      sessionKey: 'station-primary|ptid:alice',
      refreshBlockedUsers: vi.fn(async () => undefined),
      sweepTypingPeers: vi.fn(),
      unblockUser: vi.fn(async () => undefined),
    };
    const controller = await startSocialRuntime(
      session,
      () => socialStore,
    );

    expect(runtimeMocks.projectionRuntime.bootstrap).toHaveBeenCalledOnce();
    expect(runtimeMocks.startRealtimeStream).toHaveBeenCalledOnce();

    await requestSocialCurrentUserProfile(true);
    await requestSocialPeerProfiles(['ptid:bob', 'ptid:carol']);
    await requestSocialFriendshipStatus('ptid:bob');
    await requestSocialBlockedUsers();
    await unblockSocialUser('ptid:bob');
    expect(runtimeMocks.projectionRuntime.requestCurrentUserProfile)
      .toHaveBeenCalledWith(true);
    expect(runtimeMocks.projectionRuntime.requestPeerProfiles)
      .toHaveBeenCalledWith(['ptid:bob', 'ptid:carol'], false);
    expect(runtimeMocks.projectionRuntime.requestFriendshipStatus)
      .toHaveBeenCalledWith('ptid:bob');
    expect(socialStore.unblockUser).toHaveBeenCalledWith('ptid:bob');
    expect(socialStore.refreshBlockedUsers).toHaveBeenCalledTimes(2);

    runtimeMocks.projectionRuntime.suspend.mockClear();
    callMocks.suspend.mockClear();
    await controller.suspend();

    expect(runtimeMocks.projectionRuntime.suspend).toHaveBeenCalledOnce();
    expect(runtimeMocks.projectionRuntime.suspend.mock.invocationCallOrder[0])
      .toBeLessThan(callMocks.suspend.mock.invocationCallOrder[0]);

    runtimeMocks.projectionRuntime.ingress.state.mockReturnValue({
      lifecycle: 'suspended',
      streamCursor: 'cursor-1',
      writeAdmission: { open: false, reason: 'runtime_suspended' },
      staleness: {},
      dataQueueDepth: 0,
      controlQueueDepth: 0,
    });
    await reconcileSocialRuntime();
    expect(runtimeMocks.projectionRuntime.resume).toHaveBeenCalledOnce();
    expect(runtimeMocks.startRealtimeStream).toHaveBeenCalledTimes(2);

    await controller.resume();

    expect(runtimeMocks.projectionRuntime.resume).toHaveBeenCalledTimes(2);
    expect(runtimeMocks.startRealtimeStream).toHaveBeenCalledTimes(2);

    await controller.teardown();

    expect(runtimeMocks.projectionRuntime.teardown).toHaveBeenCalledOnce();
  });

  it('reasserts foreground resources after an outlived suspend completes', async () => {
    let timerId = 0;
    vi.stubGlobal('window', {
      setInterval: vi.fn(() => {
        timerId += 1;
        return timerId;
      }),
      clearInterval: vi.fn(),
      setTimeout: vi.fn(() => {
        timerId += 1;
        return timerId;
      }),
      clearTimeout: vi.fn(),
      dispatchEvent: vi.fn(),
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));

    let ingressLifecycle: 'active' | 'suspended' = 'active';
    runtimeMocks.projectionRuntime.ingress.state.mockImplementation(() => ({
      lifecycle: ingressLifecycle,
      streamCursor: 'cursor-1',
      writeAdmission: {
        open: ingressLifecycle === 'active',
        reason: ingressLifecycle === 'suspended'
          ? 'runtime_suspended'
          : undefined,
      },
      staleness: {},
      dataQueueDepth: 0,
      controlQueueDepth: 0,
    }));
    const suspendCompletion = Promise.withResolvers<void>();
    runtimeMocks.projectionRuntime.suspend.mockImplementationOnce(async () => {
      ingressLifecycle = 'suspended';
      await suspendCompletion.promise;
    });
    runtimeMocks.projectionRuntime.resume.mockImplementation(async () => {
      ingressLifecycle = 'active';
    });

    const controller = await startSocialRuntime(
      session,
      () => ({
        sessionKey: 'station-primary|ptid:alice',
        refreshBlockedUsers: vi.fn(async () => undefined),
        sweepTypingPeers: vi.fn(),
        unblockUser: vi.fn(async () => undefined),
      }),
    );
    const suspend = controller.suspend();
    await vi.waitFor(() => {
      expect(runtimeMocks.projectionRuntime.suspend).toHaveBeenCalledOnce();
    });

    await controller.resume();
    suspendCompletion.resolve();
    await suspend;
    await controller.resume();

    expect(runtimeMocks.projectionRuntime.resume).toHaveBeenCalledTimes(2);
    expect(runtimeMocks.startRealtimeStream).toHaveBeenCalledTimes(2);
    await controller.teardown();
  });
});
