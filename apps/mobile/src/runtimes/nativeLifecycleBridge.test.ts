// @ts-nocheck -- Vitest is supplied by the repository test runner, not the Mobile production bundle.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bridgeMocks = vi.hoisted(() => ({
  addPluginListener: vi.fn(),
  invoke: vi.fn(),
  listen: vi.fn(),
  clearDeviceLocalFlag: vi.fn(),
  reportDeviceLocalFlag: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  addPluginListener: bridgeMocks.addPluginListener,
  invoke: bridgeMocks.invoke,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: bridgeMocks.listen,
}));

vi.mock('./recoveryProjection', () => ({
  getRecoveryProjection: () => ({
    clearDeviceLocalFlag: bridgeMocks.clearDeviceLocalFlag,
    reportDeviceLocalFlag: bridgeMocks.reportDeviceLocalFlag,
  }),
}));

import {
  checkAllPermissions,
  checkPermission,
  fetchLifecycleGeneration,
  fetchNetworkState,
  getLifecycleGeneration,
  installNativeLifecycleBridge,
  MOBILE_NATIVE_LIFECYCLE_BRIDGE_ERROR_EVENT,
  NativeLifecycleBridgeError,
  nativeLifecycleBridgeTestContract,
  requestPermission,
} from './nativeLifecycleBridge';

describe('nativeLifecycleBridge', () => {
  let handlers: Map<string, (event: { payload: unknown }) => void>;
  let unlisteners: Map<string, ReturnType<typeof vi.fn>>;
  let pluginHandlers: Map<string, (payload: unknown) => void>;
  let pluginUnregister: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    handlers = new Map();
    unlisteners = new Map();
    pluginHandlers = new Map();
    pluginUnregister = vi.fn().mockResolvedValue(undefined);
    bridgeMocks.addPluginListener.mockReset();
    bridgeMocks.invoke.mockReset();
    bridgeMocks.listen.mockReset();
    bridgeMocks.clearDeviceLocalFlag.mockReset();
    bridgeMocks.reportDeviceLocalFlag.mockReset();
    bridgeMocks.addPluginListener.mockImplementation(
      async (
        pluginName: string,
        eventName: string,
        handler: (payload: unknown) => void,
      ) => {
        pluginHandlers.set(`${pluginName}:${eventName}`, handler);
        return { unregister: pluginUnregister };
      },
    );
    bridgeMocks.listen.mockImplementation(
      async (eventName: string, handler: (event: { payload: unknown }) => void) => {
        const unlisten = vi.fn();
        handlers.set(eventName, handler);
        unlisteners.set(eventName, unlisten);
        return unlisten;
      },
    );
    nativeLifecycleBridgeTestContract.reset();
    vi.stubGlobal('window', new EventTarget());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps generation readback monotonic across out-of-order invoke responses', async () => {
    bridgeMocks.invoke
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(2);

    await expect(fetchLifecycleGeneration()).resolves.toBe(4);
    await expect(fetchLifecycleGeneration()).resolves.toBe(4);
    expect(getLifecycleGeneration()).toBe(4);
  });

  it('rejects stale and duplicate lifecycle events', () => {
    expect(nativeLifecycleBridgeTestContract.acceptLifecycleEvent({
      source: 'android_activity',
      state: 'foreground',
      generation: 3,
      eventId: 'event-3',
      timestampMs: 3,
    })).toBe(true);
    expect(nativeLifecycleBridgeTestContract.acceptLifecycleEvent({
      source: 'android_activity',
      state: 'foreground',
      generation: 3,
      eventId: 'event-3',
      timestampMs: 3,
    })).toBe(false);
    expect(nativeLifecycleBridgeTestContract.acceptLifecycleEvent({
      source: 'network_change',
      state: 'wakeup',
      generation: 2,
      eventId: 'event-2',
      timestampMs: 2,
    })).toBe(false);
    expect(getLifecycleGeneration()).toBe(3);
  });

  it('rejects lifecycle events with an unknown native source', () => {
    expect(() => nativeLifecycleBridgeTestContract.acceptLifecycleEvent({
      source: 'unknown-source',
      state: 'foreground',
      generation: 1,
      eventId: 'event-1',
      timestampMs: 1,
    })).toThrowError(NativeLifecycleBridgeError);
  });

  it('processes newer current-generation reconciliation and rejects replay', async () => {
    const readbacks: unknown[] = [];
    window.addEventListener('recovery:reconciliation-readback', (event) => {
      readbacks.push((event as CustomEvent).detail);
    });

    const teardown = installNativeLifecycleBridge();
    await flushPromises();

    handlers.get('mobile:lifecycle')?.({
      payload: {
        source: 'ios_application',
        state: 'foreground',
        generation: 5,
        eventId: 'resume-5',
        timestampMs: 5,
      },
    });
    const report = {
      generation: 5,
      ledgerPendingCount: 1,
      ledgerUnknownCount: 2,
      draftCount: 3,
      sessionValid: false,
      reconciledAtMs: 6,
    };
    handlers.get('mobile:reconciliation')?.({ payload: report });
    handlers.get('mobile:reconciliation')?.({ payload: report });
    handlers.get('mobile:reconciliation')?.({
      payload: {
        ...report,
        ledgerUnknownCount: 0,
        sessionValid: true,
        reconciledAtMs: 7,
      },
    });
    handlers.get('mobile:reconciliation')?.({
      payload: { ...report, generation: 4 },
    });

    expect(readbacks).toEqual([{
      ledgerUnknownCount: 2,
      draftCount: 3,
      generation: 5,
    }]);
    expect(bridgeMocks.reportDeviceLocalFlag)
      .toHaveBeenCalledExactlyOnceWith('session-expired');
    expect(bridgeMocks.clearDeviceLocalFlag)
      .toHaveBeenCalledExactlyOnceWith('session-expired');

    teardown();
  });

  it('tears down resolved and late listeners without skipping failures', async () => {
    const teardownErrors: unknown[] = [];
    window.addEventListener(MOBILE_NATIVE_LIFECYCLE_BRIDGE_ERROR_EVENT, (event) => {
      teardownErrors.push((event as CustomEvent).detail);
    });

    const lifecycleUnlisten = vi.fn(() => {
      throw new Error('teardown failed');
    });
    const reconciliationUnlisten = vi.fn();
    let resolveReconciliation:
      ((unlisten: () => void) => void)
      | undefined;

    bridgeMocks.listen
      .mockResolvedValueOnce(lifecycleUnlisten)
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveReconciliation = resolve;
      }));

    const teardown = installNativeLifecycleBridge();
    await flushPromises();
    teardown();
    resolveReconciliation?.(reconciliationUnlisten);
    await flushPromises();

    expect(lifecycleUnlisten).toHaveBeenCalledOnce();
    expect(reconciliationUnlisten).toHaveBeenCalledOnce();
    expect(teardownErrors).toContainEqual({
      code: 'MOBILE_NATIVE_LISTENER_TEARDOWN_FAILED',
      operation: 'listener-teardown',
      message: 'MOBILE_NATIVE_LISTENER_TEARDOWN_FAILED:listener-teardown',
    });
    expect(pluginUnregister).toHaveBeenCalledOnce();
  });

  it('routes typed native callbacks through Rust before canonical delivery', async () => {
    bridgeMocks.invoke.mockResolvedValue({
      accepted: true,
      generation: 7,
      reason: null,
    });
    const canonicalEvents: unknown[] = [];
    const onNativeListenerReady = vi.fn();
    installNativeLifecycleBridge({
      onLifecycleEvent: (payload) => {
        canonicalEvents.push(payload);
      },
      onNativeListenerReady,
    });
    await flushPromises();

    expect(onNativeListenerReady).toHaveBeenCalledOnce();
    const nativeHandler = pluginHandlers.get(
      'peers-platform-permissions:lifecycle',
    );
    nativeHandler?.({
      platform: 'android',
      state: 'background',
      sequence: 1,
      timestampMs: 10,
    });
    await flushPromises();

    expect(bridgeMocks.invoke).toHaveBeenCalledWith(
      'lifecycle_ingest_native_signal',
      {
        input: {
          platform: 'android',
          state: 'background',
          sequence: 1,
          timestampMs: 10,
        },
      },
    );

    const canonical = {
      source: 'android_activity',
      state: 'background',
      generation: 6,
      eventId: 'android:1:10',
      timestampMs: 10,
    };
    handlers.get('mobile:lifecycle')?.({ payload: canonical });
    await flushPromises();

    expect(canonicalEvents).toEqual([canonical]);
  });

  it('rejects malformed native callback payloads before invoking Rust', async () => {
    const errors: unknown[] = [];
    window.addEventListener(MOBILE_NATIVE_LIFECYCLE_BRIDGE_ERROR_EVENT, (event) => {
      errors.push((event as CustomEvent).detail);
    });
    installNativeLifecycleBridge();
    await flushPromises();

    pluginHandlers.get('peers-platform-permissions:lifecycle')?.({
      platform: 'android',
      state: 'background',
      sequence: 0,
      timestampMs: 10,
    });
    await flushPromises();

    expect(bridgeMocks.invoke).not.toHaveBeenCalled();
    expect(errors).toContainEqual({
      code: 'MOBILE_NATIVE_READBACK_INVALID',
      operation: 'native-lifecycle-sequence',
      message: 'MOBILE_NATIVE_READBACK_INVALID:native-lifecycle-sequence',
    });
  });

  it('preserves Harness-facing permission command names and result shapes', async () => {
    const checked = {
      kind: 'camera',
      status: 'not_determined',
      canRequest: true,
    };
    const requested = {
      kind: 'camera',
      status: 'granted',
      wasAlreadyGranted: false,
    };
    const all = [
      checked,
      {
        kind: 'notifications',
        status: 'denied',
        canRequest: false,
      },
    ];
    bridgeMocks.invoke
      .mockResolvedValueOnce(checked)
      .mockResolvedValueOnce(requested)
      .mockResolvedValueOnce(all);

    await expect(checkPermission('camera')).resolves.toEqual(checked);
    await expect(requestPermission('camera')).resolves.toEqual(requested);
    await expect(checkAllPermissions()).resolves.toEqual(all);
    expect(bridgeMocks.invoke.mock.calls).toEqual([
      ['permission_check', { kind: 'camera' }],
      ['permission_request', { kind: 'camera' }],
      ['permission_check_all', undefined],
    ]);
  });

  it('propagates invoke and invalid network readback as typed failures', async () => {
    bridgeMocks.invoke.mockRejectedValueOnce(new Error('ipc unavailable'));
    await expect(fetchLifecycleGeneration()).rejects.toMatchObject({
      code: 'MOBILE_NATIVE_INVOKE_FAILED',
      operation: 'lifecycle_generation',
    });

    bridgeMocks.invoke.mockResolvedValueOnce({
      connected: false,
      networkType: 'wifi',
      updatedAtMs: 10,
    });
    const invalidReadback = fetchNetworkState();
    await expect(invalidReadback).rejects.toBeInstanceOf(
      NativeLifecycleBridgeError,
    );
    await expect(invalidReadback).rejects.toMatchObject({
      code: 'MOBILE_NATIVE_READBACK_INVALID',
      operation: 'network-state-value',
    });
  });
});

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
