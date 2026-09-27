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
  readNativeLifecycleBridgeDiagnostic,
  reconcileNativeLifecycle,
  requestPermission,
} from './nativeLifecycleBridge';

function initialNetworkResult() {
  return {
    accepted: true,
    connectionRestored: true,
    generation: 0,
    state: {
      connected: true,
      networkType: 'wifi',
      updatedAtMs: 1,
    },
  };
}

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
    bridgeMocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'network_start_observation') return initialNetworkResult();
      if (command === 'network_ingest_native_signal') {
        return {
          accepted: true,
          connectionRestored: false,
          generation: 0,
          state: {
            connected: true,
            networkType: 'wifi',
            updatedAtMs: 1,
          },
        };
      }
      return undefined;
    });
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

    const installation = installNativeLifecycleBridge();
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

    installation.teardown();
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

    const installation = installNativeLifecycleBridge();
    await flushPromises();
    installation.teardown();
    resolveReconciliation?.(reconciliationUnlisten);
    await flushPromises();

    expect(lifecycleUnlisten).toHaveBeenCalledOnce();
    expect(reconciliationUnlisten).toHaveBeenCalledOnce();
    expect(teardownErrors).toContainEqual({
      code: 'MOBILE_NATIVE_LISTENER_TEARDOWN_FAILED',
      operation: 'listener-teardown',
      message: 'MOBILE_NATIVE_LISTENER_TEARDOWN_FAILED:listener-teardown',
    });
    expect(pluginUnregister).toHaveBeenCalledTimes(4);
  });

  it('rejects readiness when a canonical listener installation fails', async () => {
    bridgeMocks.listen.mockRejectedValueOnce(new Error('listener unavailable'));

    const installation = installNativeLifecycleBridge();
    const readiness = expect(installation.ready).rejects.toMatchObject({
      code: 'MOBILE_NATIVE_LISTENER_INSTALL_FAILED',
      operation: 'listen-lifecycle',
    });
    await flushPromises();
    emitInitialNetworkObservation(pluginHandlers);

    await readiness;
    expect(readNativeLifecycleBridgeDiagnostic()).toEqual({
      code: 'MOBILE_NATIVE_LISTENER_INSTALL_FAILED',
      operation: 'listen-lifecycle',
      message: 'MOBILE_NATIVE_LISTENER_INSTALL_FAILED:listen-lifecycle',
    });
    installation.teardown();
  });

  it('rejects readiness when a native plugin listener installation fails', async () => {
    bridgeMocks.addPluginListener.mockRejectedValueOnce(
      new Error('plugin listener unavailable'),
    );

    const installation = installNativeLifecycleBridge();
    const readiness = expect(installation.ready).rejects.toMatchObject({
      code: 'MOBILE_NATIVE_LISTENER_INSTALL_FAILED',
      operation: 'listen-native-lifecycle',
    });
    await flushPromises();
    emitInitialNetworkObservation(pluginHandlers);

    await readiness;
    installation.teardown();
  });

  it('rejects readiness when initial network observation does not start', async () => {
    bridgeMocks.invoke.mockImplementation(async (command: string) => (
      command === 'network_start_observation'
        ? {
            ...initialNetworkResult(),
            state: { ...initialNetworkResult().state, updatedAtMs: 0 },
          }
        : undefined
    ));

    const installation = installNativeLifecycleBridge();

    await expect(installation.ready).rejects.toMatchObject({
      code: 'MOBILE_NATIVE_READBACK_INVALID',
      operation: 'network-start-observation',
    });
    installation.teardown();
  });

  it('rejects readiness when initial network observation fails', async () => {
    bridgeMocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'network_start_observation') {
        throw new Error('observation unavailable');
      }
      return undefined;
    });

    const installation = installNativeLifecycleBridge();

    await expect(installation.ready).rejects.toMatchObject({
      code: 'MOBILE_NATIVE_INVOKE_FAILED',
      operation: 'network_start_observation',
    });
    installation.teardown();
  });

  it('routes typed native callbacks through Rust before canonical delivery', async () => {
    bridgeMocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'network_start_observation') return initialNetworkResult();
      return {
        accepted: true,
        generation: 7,
        reason: null,
      };
    });
    const canonicalEvents: unknown[] = [];
    const onNativeListenerReady = vi.fn();
    const installation = installNativeLifecycleBridge({
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
    installation.teardown();
  });

  it('rejects malformed native callback payloads before invoking Rust', async () => {
    const errors: unknown[] = [];
    window.addEventListener(MOBILE_NATIVE_LIFECYCLE_BRIDGE_ERROR_EVENT, (event) => {
      errors.push((event as CustomEvent).detail);
    });
    const installation = installNativeLifecycleBridge();
    await flushPromises();

    pluginHandlers.get('peers-platform-permissions:lifecycle')?.({
      platform: 'android',
      state: 'background',
      sequence: 0,
      timestampMs: 10,
    });
    await flushPromises();

    expect(bridgeMocks.invoke).not.toHaveBeenCalledWith(
      'lifecycle_ingest_native_signal',
      expect.anything(),
    );
    expect(errors).toContainEqual({
      code: 'MOBILE_NATIVE_READBACK_INVALID',
      operation: 'native-lifecycle-sequence',
      message: 'MOBILE_NATIVE_READBACK_INVALID:native-lifecycle-sequence',
    });
    installation.teardown();
  });

  it('routes typed native network observations through Rust', async () => {
    const onNetworkStateChange = vi.fn();
    const onNativeNetworkListenerReady = vi.fn();
    bridgeMocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'network_start_observation') return {
        ...initialNetworkResult(),
        accepted: false,
      };
      if (command === 'network_ingest_native_signal') {
        return {
          accepted: true,
          connectionRestored: true,
          generation: 0,
          state: {
            connected: true,
            networkType: 'wifi',
            updatedAtMs: 20,
          },
        };
      }
      return undefined;
    });

    const installation = installNativeLifecycleBridge({
      onNetworkStateChange,
      onNativeNetworkListenerReady,
    });
    await flushPromises();
    expect(onNativeNetworkListenerReady).toHaveBeenCalledOnce();

    pluginHandlers.get('peers-platform-permissions:network')?.({
      platform: 'ios',
      connected: true,
      networkType: 'wifi',
      sequence: 2,
      timestampMs: 20,
    });

    await vi.waitFor(() => {
      expect(bridgeMocks.invoke).toHaveBeenCalledWith(
        'network_ingest_native_signal',
        {
          input: {
            platform: 'ios',
            connected: true,
            networkType: 'wifi',
            sequence: 2,
            timestampMs: 20,
          },
        },
      );
      expect(onNetworkStateChange).toHaveBeenCalledExactlyOnceWith(
        {
          connected: true,
          networkType: 'wifi',
          updatedAtMs: 20,
        },
        true,
      );
    });
    await expect(installation.ready).resolves.toBeUndefined();
    expect(onNativeNetworkListenerReady).toHaveBeenCalledOnce();
    installation.teardown();
  });

  it('drops a network result from an older lifecycle generation', async () => {
    nativeLifecycleBridgeTestContract.acceptLifecycleEvent({
      source: 'ios_application',
      state: 'foreground',
      generation: 4,
      eventId: 'foreground-4',
      timestampMs: 10,
    });
    const onNetworkStateChange = vi.fn();
    bridgeMocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'network_start_observation') {
        return {
          ...initialNetworkResult(),
          accepted: false,
          generation: 4,
        };
      }
      if (command === 'network_ingest_native_signal') {
        return {
          accepted: true,
          connectionRestored: true,
          generation: 3,
          state: {
            connected: true,
            networkType: 'wifi',
            updatedAtMs: 20,
          },
        };
      }
      return undefined;
    });
    const installation = installNativeLifecycleBridge({ onNetworkStateChange });
    await flushPromises();

    pluginHandlers.get('peers-platform-permissions:network')?.({
      platform: 'ios',
      connected: true,
      networkType: 'wifi',
      sequence: 1,
      timestampMs: 20,
    });
    await flushPromises();

    expect(onNetworkStateChange).not.toHaveBeenCalled();
    installation.teardown();
    await installation.ready;
  });

  it('requests Rust-owned reconciliation without caller-supplied counts', async () => {
    const report = {
      generation: 3,
      ledgerPendingCount: 2,
      ledgerUnknownCount: 1,
      draftCount: 4,
      sessionValid: true,
      reconciledAtMs: 30,
    };
    bridgeMocks.invoke.mockResolvedValueOnce(report);

    await expect(reconcileNativeLifecycle(true)).resolves.toEqual(report);
    expect(bridgeMocks.invoke).toHaveBeenCalledExactlyOnceWith(
      'lifecycle_reconcile',
      { input: { sessionValid: true } },
    );
  });

  it('rejects malformed native network observations before invoking Rust', async () => {
    const installation = installNativeLifecycleBridge();
    await flushPromises();

    pluginHandlers.get('peers-platform-permissions:network')?.({
      platform: 'ios',
      connected: false,
      networkType: 'wifi',
      sequence: 1,
      timestampMs: 20,
    });
    await flushPromises();

    expect(bridgeMocks.invoke).not.toHaveBeenCalledWith(
      'network_ingest_native_signal',
      expect.anything(),
    );
    installation.teardown();
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

function emitInitialNetworkObservation(
  pluginHandlers: Map<string, (payload: unknown) => void>,
): void {
  pluginHandlers.get('peers-platform-permissions:network')?.({
    platform: 'ios',
    connected: true,
    networkType: 'wifi',
    sequence: 1,
    timestampMs: 1,
  });
}
