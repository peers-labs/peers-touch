// @ts-nocheck -- Vitest is supplied by the repository test runner, not the Mobile production bundle.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridgeMocks = vi.hoisted(() => ({
  installNativeLifecycleBridge: vi.fn(),
  dispatchSocialRuntimeExternalEvent: vi.fn(),
  restoreAuthRuntimeProjection: vi.fn(),
  applyAuthRuntimeProjection: vi.fn(),
  wakeActiveMessagingSession: vi.fn(),
  getPhase: vi.fn(),
  getSnapshot: vi.fn(),
  suspend: vi.fn(),
  resume: vi.fn(),
  listen: vi.fn(),
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

vi.mock('./messagingRuntime', () => ({
  wakeActiveMessagingSession: bridgeMocks.wakeActiveMessagingSession,
}));

vi.mock('./nativeLifecycleBridge', () => ({
  installNativeLifecycleBridge: bridgeMocks.installNativeLifecycleBridge,
}));

import { installMobileNativeEventBridge } from './mobileNativeEventBridge';

describe('mobileNativeEventBridge lifecycle ordering', () => {
  let lifecycleHandlers: {
    onLifecycleEvent(payload: {
      state: 'foreground' | 'background' | 'wakeup';
    }): Promise<void>;
    onNativeListenerReady(): void;
  };

  beforeEach(() => {
    bridgeMocks.installNativeLifecycleBridge.mockReset();
    bridgeMocks.dispatchSocialRuntimeExternalEvent.mockReset();
    bridgeMocks.restoreAuthRuntimeProjection.mockReset();
    bridgeMocks.applyAuthRuntimeProjection.mockReset();
    bridgeMocks.wakeActiveMessagingSession.mockReset();
    bridgeMocks.getPhase.mockReset();
    bridgeMocks.getSnapshot.mockReset();
    bridgeMocks.suspend.mockReset();
    bridgeMocks.resume.mockReset();
    bridgeMocks.listen.mockReset();

    bridgeMocks.installNativeLifecycleBridge.mockImplementation((handlers) => {
      lifecycleHandlers = handlers;
      return vi.fn();
    });
    bridgeMocks.listen.mockResolvedValue(vi.fn());
    bridgeMocks.getSnapshot.mockReturnValue({});
    bridgeMocks.wakeActiveMessagingSession.mockResolvedValue(undefined);

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

    const teardown = installMobileNativeEventBridge();
    await lifecycleHandlers.onLifecycleEvent({ state: 'background' });
    await lifecycleHandlers.onLifecycleEvent({ state: 'foreground' });
    await flushPromises();

    expect(bridgeMocks.suspend).toHaveBeenCalledOnce();
    expect(bridgeMocks.resume).not.toHaveBeenCalled();

    resolveSuspend?.();
    await vi.waitFor(() => {
      expect(bridgeMocks.resume).toHaveBeenCalledExactlyOnceWith('native-resume');
    });
    teardown();
  });

  it('keeps browser fallback listeners inert after native callbacks attach', async () => {
    bridgeMocks.getPhase.mockReturnValue('ACTIVE');

    const teardown = installMobileNativeEventBridge();
    lifecycleHandlers.onNativeListenerReady();
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    await flushPromises();

    expect(bridgeMocks.suspend).not.toHaveBeenCalled();
    expect(bridgeMocks.resume).not.toHaveBeenCalled();
    expect(bridgeMocks.wakeActiveMessagingSession).not.toHaveBeenCalled();
    teardown();
  });
});

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
