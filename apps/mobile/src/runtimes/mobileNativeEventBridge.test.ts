// @ts-nocheck -- Vitest is supplied by the repository test runner, not the Mobile production bundle.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridgeMocks = vi.hoisted(() => ({
  installNativeLifecycleBridge: vi.fn(),
  dispatchSocialRuntimeExternalEvent: vi.fn(),
  restoreAuthRuntimeProjection: vi.fn(),
  applyAuthRuntimeProjection: vi.fn(),
  readActiveSessionProjection: vi.fn(),
  reconcileNativeLifecycle: vi.fn(),
  activateNativePush: vi.fn(),
  drainNativePush: vi.fn(),
  drainScheduledReconcile: vi.fn(),
  deactivateNativePush: vi.fn(),
  getLifecycleGeneration: vi.fn(),
  wakeActiveMessagingSession: vi.fn(),
  getPhase: vi.fn(),
  getSnapshot: vi.fn(),
  suspend: vi.fn(),
  resume: vi.fn(),
  listen: vi.fn(),
  reportDeviceLocalFlag: vi.fn(),
  clearDeviceLocalFlag: vi.fn(),
  nativeEventHandlers: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: bridgeMocks.listen,
}));

vi.mock('@peers-touch/client-chat-core', () => ({
  buildSocialHostEvent: vi.fn((eventName, payload) => ({
    eventName,
    payload,
  })),
}));

vi.mock('../app/lifecycle/MobileLifecycleKernel', () => ({
  getMobileLifecycleKernel: () => ({
    getPhase: bridgeMocks.getPhase,
    getSnapshot: bridgeMocks.getSnapshot,
    suspend: bridgeMocks.suspend,
    resume: bridgeMocks.resume,
  }),
}));

vi.mock('../features/social/socialRuntime', () => ({
  dispatchSocialRuntimeExternalEvent:
    bridgeMocks.dispatchSocialRuntimeExternalEvent,
}));

vi.mock('./authRuntime', () => ({
  restoreAuthRuntimeProjection: bridgeMocks.restoreAuthRuntimeProjection,
  applyAuthRuntimeProjection: bridgeMocks.applyAuthRuntimeProjection,
}));

vi.mock('./sessionRuntime', () => ({
  readActiveSessionProjection: bridgeMocks.readActiveSessionProjection,
}));

vi.mock('./messagingRuntime', () => ({
  wakeActiveMessagingSession: bridgeMocks.wakeActiveMessagingSession,
}));

vi.mock('./nativeLifecycleBridge', () => ({
  installNativeLifecycleBridge: bridgeMocks.installNativeLifecycleBridge,
  reconcileNativeLifecycle: bridgeMocks.reconcileNativeLifecycle,
  activateNativePush: bridgeMocks.activateNativePush,
  drainNativePush: bridgeMocks.drainNativePush,
  drainScheduledReconcile: bridgeMocks.drainScheduledReconcile,
  deactivateNativePush: bridgeMocks.deactivateNativePush,
  getLifecycleGeneration: bridgeMocks.getLifecycleGeneration,
}));

vi.mock('./recoveryProjection', () => ({
  getRecoveryProjection: () => ({
    reportDeviceLocalFlag: bridgeMocks.reportDeviceLocalFlag,
    clearDeviceLocalFlag: bridgeMocks.clearDeviceLocalFlag,
  }),
}));

import { installMobileNativeEventBridge } from './mobileNativeEventBridge';

describe('mobileNativeEventBridge lifecycle ordering', () => {
  let lifecycleHandlers: {
    onLifecycleEvent(payload: {
      state: 'foreground' | 'background' | 'wakeup';
    }): Promise<void>;
    onNetworkStateChange(
      state: {
        connected: boolean;
        networkType: 'none' | 'wifi' | 'cellular' | 'ethernet' | 'unknown';
        updatedAtMs: number;
      },
      connectionRestored: boolean,
    ): Promise<void>;
    onNativeListenerReady(): void;
    onNativeNetworkListenerReady(): void;
    onPushCallbacksAvailable(payload: {
      lifecycleGeneration: number;
      pendingCount: number;
    }): Promise<void>;
    onScheduledCallbacksAvailable(payload: {
      lifecycleGeneration: number;
      pendingCount: number;
    }): Promise<void>;
  };

  beforeEach(() => {
    bridgeMocks.installNativeLifecycleBridge.mockReset();
    bridgeMocks.dispatchSocialRuntimeExternalEvent.mockReset();
    bridgeMocks.restoreAuthRuntimeProjection.mockReset();
    bridgeMocks.applyAuthRuntimeProjection.mockReset();
    bridgeMocks.readActiveSessionProjection.mockReset();
    bridgeMocks.reconcileNativeLifecycle.mockReset();
    bridgeMocks.activateNativePush.mockReset();
    bridgeMocks.drainNativePush.mockReset();
    bridgeMocks.drainScheduledReconcile.mockReset();
    bridgeMocks.deactivateNativePush.mockReset();
    bridgeMocks.getLifecycleGeneration.mockReset();
    bridgeMocks.wakeActiveMessagingSession.mockReset();
    bridgeMocks.getPhase.mockReset();
    bridgeMocks.getSnapshot.mockReset();
    bridgeMocks.suspend.mockReset();
    bridgeMocks.resume.mockReset();
    bridgeMocks.listen.mockReset();
    bridgeMocks.reportDeviceLocalFlag.mockReset();
    bridgeMocks.clearDeviceLocalFlag.mockReset();
    bridgeMocks.nativeEventHandlers.clear();

    bridgeMocks.installNativeLifecycleBridge.mockImplementation((handlers) => {
      lifecycleHandlers = handlers;
      return {
        ready: Promise.resolve(),
        teardown: vi.fn(),
      };
    });
    bridgeMocks.listen.mockImplementation(async (name, handler) => {
      bridgeMocks.nativeEventHandlers.set(name, handler);
      return vi.fn();
    });
    bridgeMocks.getSnapshot.mockReturnValue({});
    bridgeMocks.wakeActiveMessagingSession.mockResolvedValue(undefined);
    bridgeMocks.readActiveSessionProjection.mockReturnValue({ sessionId: 'session-1' });
    bridgeMocks.getLifecycleGeneration.mockReturnValue(1);
    bridgeMocks.activateNativePush.mockResolvedValue({
      armed: true,
      lifecycleGeneration: 1,
    });
    bridgeMocks.drainNativePush.mockResolvedValue({
      acceptedCallbacks: 0,
      discardedCallbacks: 0,
      registrationUpdates: 0,
      reconcileEvents: 0,
    });
    bridgeMocks.drainScheduledReconcile.mockResolvedValue({
      acceptedCallbacks: 0,
      discardedCallbacks: 0,
      failedCallbacks: 0,
    });
    bridgeMocks.deactivateNativePush.mockResolvedValue({
      locallyFenced: true,
      unregisterAttempted: 0,
      unregisterFailed: 0,
    });
    bridgeMocks.reconcileNativeLifecycle.mockResolvedValue({
      generation: 1,
      ledgerPendingCount: 0,
      ledgerUnknownCount: 0,
      draftCount: 0,
      sessionValid: false,
      reconciledAtMs: 1,
    });

    const documentTarget = new EventTarget();
    Object.defineProperty(documentTarget, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    vi.stubGlobal('document', documentTarget);
    vi.stubGlobal('window', new EventTarget());
  });

  it('serializes overlapping native background and foreground transitions', async () => {
    let resolveSuspend: (() => void) | undefined;
    const suspendPending = new Promise<void>((resolve) => {
      resolveSuspend = resolve;
    });
    let phase = 'ACTIVE';
    bridgeMocks.getPhase.mockImplementation(() => phase);
    bridgeMocks.suspend.mockImplementation(async () => {
      await suspendPending;
      phase = 'SUSPENDED';
      return {};
    });
    bridgeMocks.resume.mockImplementation(async () => {
      phase = 'ACTIVE';
      return {};
    });

    const installation = installMobileNativeEventBridge();
    await installation.ready;
    await lifecycleHandlers.onLifecycleEvent({ state: 'background' });
    const foreground = lifecycleHandlers.onLifecycleEvent({ state: 'foreground' });
    await flushPromises();

    expect(bridgeMocks.suspend).toHaveBeenCalledOnce();
    expect(bridgeMocks.resume).not.toHaveBeenCalled();

    resolveSuspend?.();
    await vi.waitFor(() => {
      expect(bridgeMocks.resume).toHaveBeenCalledExactlyOnceWith('native-resume');
    });
    await foreground;
    expect(bridgeMocks.reconcileNativeLifecycle).toHaveBeenCalledExactlyOnceWith(true);
    expect(bridgeMocks.resume.mock.invocationCallOrder[0])
      .toBeLessThan(bridgeMocks.reconcileNativeLifecycle.mock.invocationCallOrder[0]);
    expect(bridgeMocks.reconcileNativeLifecycle.mock.invocationCallOrder[0])
      .toBeLessThan(bridgeMocks.dispatchSocialRuntimeExternalEvent.mock.invocationCallOrder[0]);
    installation.teardown();
  });

  it('keeps lifecycle fallbacks inert while retaining browser network fallback', async () => {
    bridgeMocks.getPhase.mockReturnValue('ACTIVE');

    const installation = installMobileNativeEventBridge();
    await installation.ready;
    lifecycleHandlers.onNativeListenerReady();
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));
    await flushPromises();

    expect(bridgeMocks.suspend).not.toHaveBeenCalled();
    expect(bridgeMocks.resume).not.toHaveBeenCalled();
    expect(bridgeMocks.reportDeviceLocalFlag)
      .toHaveBeenCalledExactlyOnceWith('no-network');
    expect(bridgeMocks.clearDeviceLocalFlag)
      .toHaveBeenCalledExactlyOnceWith('no-network');
    expect(bridgeMocks.wakeActiveMessagingSession).toHaveBeenCalledOnce();
    expect(bridgeMocks.dispatchSocialRuntimeExternalEvent)
      .toHaveBeenCalledExactlyOnceWith({
        kind: 'network-online',
        reason: 'browser-online',
      });
    installation.teardown();
  });

  it('keeps browser network fallbacks inert after native network callbacks attach', async () => {
    const installation = installMobileNativeEventBridge();
    await installation.ready;
    lifecycleHandlers.onNativeNetworkListenerReady();
    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));
    await flushPromises();

    expect(bridgeMocks.wakeActiveMessagingSession).not.toHaveBeenCalled();
    expect(bridgeMocks.dispatchSocialRuntimeExternalEvent).not.toHaveBeenCalled();
    expect(bridgeMocks.reportDeviceLocalFlag).not.toHaveBeenCalled();
    expect(bridgeMocks.clearDeviceLocalFlag).not.toHaveBeenCalled();
    installation.teardown();
  });

  it('uses Rust-validated native network restoration as the reconnect authority', async () => {
    bridgeMocks.getPhase.mockReturnValue('ACTIVE');
    const installation = installMobileNativeEventBridge();
    await installation.ready;

    await lifecycleHandlers.onNetworkStateChange(
      {
        connected: false,
        networkType: 'none',
        updatedAtMs: 10,
      },
      false,
    );

    expect(bridgeMocks.reportDeviceLocalFlag)
      .toHaveBeenCalledExactlyOnceWith('no-network');
    expect(bridgeMocks.dispatchSocialRuntimeExternalEvent).not.toHaveBeenCalled();
    expect(bridgeMocks.wakeActiveMessagingSession).not.toHaveBeenCalled();

    await lifecycleHandlers.onNetworkStateChange(
      {
        connected: true,
        networkType: 'wifi',
        updatedAtMs: 20,
      },
      true,
    );

    expect(bridgeMocks.clearDeviceLocalFlag)
      .toHaveBeenCalledExactlyOnceWith('no-network');
    expect(bridgeMocks.dispatchSocialRuntimeExternalEvent)
      .toHaveBeenCalledExactlyOnceWith({
        kind: 'network-online',
        reason: 'native-network-restored',
      });
    expect(bridgeMocks.wakeActiveMessagingSession).toHaveBeenCalledOnce();
    installation.teardown();
  });

  it('retries native push registration after network restoration without blocking messaging', async () => {
    bridgeMocks.getPhase.mockReturnValue('ACTIVE');
    bridgeMocks.readActiveSessionProjection.mockReturnValue({
      stationPeerId: 'station-1',
      actorPtid: 'ptid:alice',
      sessionId: 'session-1',
    });
    const installation = installMobileNativeEventBridge();
    await installation.ready;
    bridgeMocks.activateNativePush.mockClear();
    bridgeMocks.drainNativePush.mockClear();
    bridgeMocks.wakeActiveMessagingSession.mockClear();
    bridgeMocks.drainNativePush.mockRejectedValueOnce(new Error('offline'));

    await lifecycleHandlers.onNetworkStateChange(
      {
        connected: true,
        networkType: 'wifi',
        updatedAtMs: 20,
      },
      true,
    );

    expect(bridgeMocks.activateNativePush).toHaveBeenCalledWith({
      stationPeerId: 'station-1',
      actorPtid: 'ptid:alice',
      sessionId: 'session-1',
      environment: 'development',
    });
    expect(bridgeMocks.drainNativePush).toHaveBeenCalledOnce();
    expect(bridgeMocks.wakeActiveMessagingSession).toHaveBeenCalledOnce();
    installation.teardown();
  });

  it('uses canonical native wakeups to await the Messaging worker cycle', async () => {
    bridgeMocks.getPhase.mockReturnValue('ACTIVE');
    const installation = installMobileNativeEventBridge();
    await installation.ready;

    await lifecycleHandlers.onLifecycleEvent({ state: 'wakeup' });

    expect(bridgeMocks.wakeActiveMessagingSession).toHaveBeenCalledOnce();
    installation.teardown();
  });

  it('defers background wake work to lifecycle resume while runtimes are suspended', async () => {
    bridgeMocks.getPhase.mockReturnValue('SUSPENDED');
    const installation = installMobileNativeEventBridge();
    await installation.ready;

    await lifecycleHandlers.onLifecycleEvent({ state: 'wakeup' });

    expect(bridgeMocks.wakeActiveMessagingSession).not.toHaveBeenCalled();
    installation.teardown();
  });

  it('drains native push callbacks through Rust without exposing provider data', async () => {
    bridgeMocks.readActiveSessionProjection.mockReturnValue({
      stationPeerId: 'station-1',
      actorPtid: 'ptid:alice',
      sessionId: 'session-1',
    });
    const installation = installMobileNativeEventBridge();
    await installation.ready;
    await lifecycleHandlers.onPushCallbacksAvailable({
      lifecycleGeneration: 1,
      pendingCount: 1,
    });

    expect(bridgeMocks.drainNativePush).toHaveBeenCalledWith({
      stationPeerId: 'station-1',
      actorPtid: 'ptid:alice',
      sessionId: 'session-1',
      environment: 'development',
    });
    installation.teardown();
  });

  it('routes scheduled work through the Rust completion owner', async () => {
    bridgeMocks.readActiveSessionProjection.mockReturnValue({
      stationPeerId: 'station-1',
      actorPtid: 'ptid:alice',
      sessionId: 'session-1',
    });
    const installation = installMobileNativeEventBridge();
    await installation.ready;
    await lifecycleHandlers.onScheduledCallbacksAvailable({
      lifecycleGeneration: 1,
      pendingCount: 1,
    });

    expect(bridgeMocks.drainScheduledReconcile).toHaveBeenCalledWith({
      stationPeerId: 'station-1',
      actorPtid: 'ptid:alice',
      sessionId: 'session-1',
      environment: 'development',
    });
    installation.teardown();
  });
});

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
