import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BridgeAdapter } from '../adapter.js';
import { AppletError, AppletErrorCode } from '../errors.js';
import { AppletSDK } from '../index.js';
import { isLynxEnvironment, LynxBridgeAdapter } from './lynx.js';

type TestBridge = {
  invoke?: (payload: { method: string; params?: Record<string, unknown> }) => unknown | Promise<unknown>;
  call?: (
    name: string,
    data: { method: string; params?: Record<string, unknown> },
    callback: (result: unknown) => void,
  ) => void;
};

function installBridge(bridge: TestBridge): void {
  (globalThis as typeof globalThis & { NativeModules?: { bridge: TestBridge } }).NativeModules = { bridge };
}

function installLynxRuntimeBridge(bridge: TestBridge): ReturnType<typeof vi.fn> {
  const requireModule = vi.fn((name: string) => (name === 'bridge' ? bridge : undefined));
  (globalThis as typeof globalThis & { lynx?: { requireModule: (name: string) => TestBridge | undefined } }).lynx = { requireModule };
  return requireModule;
}

function removeBridge(): void {
  delete (globalThis as typeof globalThis & { NativeModules?: { bridge?: TestBridge } }).NativeModules;
  delete (globalThis as typeof globalThis & { lynx?: unknown }).lynx;
}

describe('LynxBridgeAdapter', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    removeBridge();
  });

  it('unwraps canonical object and string envelopes from bridge.invoke', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ ok: true, result: { value: 42 } })
      .mockResolvedValueOnce(JSON.stringify({ ok: true, result: { value: 'from-string' } }));
    installBridge({ invoke });

    const adapter = new LynxBridgeAdapter();

    await expect(adapter.invoke('atelier.workspace.load', { taskId: 'task-1' })).resolves.toEqual({ value: 42 });
    await expect(adapter.invoke('atelier.workspace.load')).resolves.toEqual({ value: 'from-string' });
    expect(invoke).toHaveBeenNthCalledWith(1, {
      method: 'atelier.workspace.load',
      params: { taskId: 'task-1' },
    });
  });

  it('preserves Host canonical errors as AppletError instances', async () => {
    installBridge({
      invoke: vi.fn().mockResolvedValue({
        ok: false,
        error: {
          code: AppletErrorCode.PermissionDenied,
          message: 'subscription denied',
          details: { reason: 'forbidden' },
          requestId: 'req-1',
        },
      }),
    });

    const adapter = new LynxBridgeAdapter();

    await expect(adapter.invoke('events.subscribe')).rejects.toMatchObject({
      name: 'AppletError',
      code: AppletErrorCode.PermissionDenied,
      message: 'subscription denied',
      details: { reason: 'forbidden' },
      requestId: 'req-1',
    });
  });

  it('falls back to legacy bridge.call when bridge.invoke is absent', async () => {
    const call = vi.fn((
      _name: string,
      _payload: { method: string; params?: Record<string, unknown> },
      callback: (result: unknown) => void,
    ) => {
      callback({ ok: true, result: { legacy: true } });
    });
    installBridge({ call });

    const adapter = new LynxBridgeAdapter();

    await expect(adapter.invoke('atelier.workspace.load', { selectedTaskId: 'task-1' })).resolves.toEqual({ legacy: true });
    expect(call).toHaveBeenCalledWith(
      'invoke',
      { method: 'atelier.workspace.load', params: { selectedTaskId: 'task-1' } },
      expect.any(Function),
    );
  });

  it('normalizes synchronous errors thrown by legacy bridge.call', async () => {
    const call = vi.fn(() => {
      throw new Error('legacy bridge exploded');
    });
    installBridge({ call });

    const adapter = new LynxBridgeAdapter();

    await expect(adapter.invoke('atelier.workspace.load')).rejects.toMatchObject({
      name: 'AppletError',
      code: AppletErrorCode.InternalError,
      message: 'legacy bridge exploded',
    });
  });

  it('unwraps string envelopes returned by legacy bridge.call', async () => {
    const call = vi.fn((
      _name: string,
      _payload: { method: string; params?: Record<string, unknown> },
      callback: (result: unknown) => void,
    ) => {
      callback(JSON.stringify({ ok: true, result: { legacyString: true } }));
    });
    installBridge({ call });

    const adapter = new LynxBridgeAdapter();

    await expect(adapter.invoke('atelier.workspace.load')).resolves.toEqual({ legacyString: true });
    expect(call).toHaveBeenCalledWith(
      'invoke',
      { method: 'atelier.workspace.load' },
      expect.any(Function),
    );
  });

  it('preserves string error envelopes returned by legacy bridge.call', async () => {
    const call = vi.fn((
      _name: string,
      _payload: { method: string; params?: Record<string, unknown> },
      callback: (result: unknown) => void,
    ) => {
      callback(JSON.stringify({
        ok: false,
        error: {
          code: AppletErrorCode.InternalError,
          message: 'legacy callback failed',
          details: { transport: 'legacy-call' },
          requestId: 'legacy-req-1',
        },
      }));
    });
    installBridge({ call });

    const adapter = new LynxBridgeAdapter();

    await expect(adapter.invoke('atelier.workspace.load')).rejects.toMatchObject({
      name: 'AppletError',
      code: AppletErrorCode.InternalError,
      message: 'legacy callback failed',
      details: { transport: 'legacy-call' },
      requestId: 'legacy-req-1',
    });
  });

  it('falls back to lynx.requireModule bridge injection when NativeModules is absent', async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true, result: { via: 'requireModule' } });
    const requireModule = installLynxRuntimeBridge({ invoke });

    expect(isLynxEnvironment()).toBe(true);

    const adapter = new LynxBridgeAdapter();

    await expect(adapter.invoke('atelier.workspace.load')).resolves.toEqual({ via: 'requireModule' });
    expect(requireModule).toHaveBeenCalledWith('bridge');
    expect(invoke).toHaveBeenCalledWith({ method: 'atelier.workspace.load' });
  });

  it('waits for delayed Host bridge injection before readiness timeout', async () => {
    vi.useFakeTimers();
    const invoke = vi.fn().mockResolvedValue({ ok: true, result: { delayed: true } });
    const adapter = new LynxBridgeAdapter();

    const result = adapter.invoke('atelier.workspace.load');
    const assertion = expect(result).resolves.toEqual({ delayed: true });

    await vi.advanceTimersByTimeAsync(40);
    expect(invoke).not.toHaveBeenCalled();

    installBridge({ invoke });
    await vi.advanceTimersByTimeAsync(20);

    await assertion;
    expect(invoke).toHaveBeenCalledWith({ method: 'atelier.workspace.load' });
  });

  it('fails closed when no Lynx bridge becomes available', async () => {
    vi.useFakeTimers();
    const adapter = new LynxBridgeAdapter();

    const result = adapter.invoke('atelier.workspace.load');
    const assertion = expect(result).rejects.toMatchObject({
      name: 'AppletError',
      code: AppletErrorCode.MethodNotFound,
      message: 'Lynx bridge module is not available',
    });
    await vi.advanceTimersByTimeAsync(5010);

    await assertion;
  });

  it('long-polls host events through events.subscribe without params', async () => {
    let releasePendingPoll: ((value: unknown) => void) | undefined;
    const pendingPoll = new Promise((resolve) => {
      releasePendingPoll = resolve;
    });
    const invoke = vi.fn()
      .mockResolvedValueOnce({ ok: true, result: { topic: 'atelier.projection.event', payload: { seq: 7 } } })
      .mockReturnValueOnce(pendingPoll);
    installBridge({ invoke });

    const adapter = new LynxBridgeAdapter();
    const received = new Promise<unknown>((resolve) => {
      const unsubscribe = adapter.onEvent((topic, payload) => {
        unsubscribe();
        resolve({ topic, payload });
      });
    });

    await expect(received).resolves.toEqual({
      topic: 'atelier.projection.event',
      payload: { seq: 7 },
    });
    expect(invoke).toHaveBeenNthCalledWith(1, { method: 'events.subscribe' });

    releasePendingPoll?.({ ok: true, result: null });
  });

  it('backs off instead of dispatching malformed long-poll event envelopes', async () => {
    vi.useFakeTimers();
    const invoke = vi.fn()
      .mockResolvedValueOnce({ ok: true, result: null })
      .mockResolvedValueOnce({ ok: true, result: { event: 'atelier.projection.event', payload: { seq: 8 } } });
    installBridge({ invoke });

    const adapter = new LynxBridgeAdapter();
    const received = new Promise<unknown>((resolve) => {
      const unsubscribe = adapter.onEvent((topic, payload) => {
        unsubscribe();
        resolve({ topic, payload });
      });
    });

    await vi.advanceTimersByTimeAsync(200);

    await expect(received).resolves.toEqual({
      topic: 'atelier.projection.event',
      payload: { seq: 8 },
    });
    expect(invoke).toHaveBeenNthCalledWith(1, { method: 'events.subscribe' });
    expect(invoke).toHaveBeenNthCalledWith(2, { method: 'events.subscribe' });
  });

  it('retries event long-poll after canonical Host error envelopes', async () => {
    vi.useFakeTimers();
    const invoke = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: AppletErrorCode.InternalError,
          message: 'temporary event poll failure',
        },
      })
      .mockResolvedValueOnce({ ok: true, result: { topic: 'atelier.projection.event', payload: { seq: 9 } } });
    installBridge({ invoke });

    const adapter = new LynxBridgeAdapter();
    const received = new Promise<unknown>((resolve) => {
      const unsubscribe = adapter.onEvent((topic, payload) => {
        unsubscribe();
        resolve({ topic, payload });
      });
    });

    await vi.advanceTimersByTimeAsync(200);

    await expect(received).resolves.toEqual({
      topic: 'atelier.projection.event',
      payload: { seq: 9 },
    });
    expect(invoke).toHaveBeenNthCalledWith(1, { method: 'events.subscribe' });
    expect(invoke).toHaveBeenNthCalledWith(2, { method: 'events.subscribe' });
  });

  it('retries event long-poll after string canonical Host error envelopes', async () => {
    vi.useFakeTimers();
    const invoke = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({
        ok: false,
        error: {
          code: AppletErrorCode.InternalError,
          message: 'temporary string event poll failure',
        },
      }))
      .mockResolvedValueOnce({ ok: true, result: { topic: 'atelier.projection.event', payload: { seq: 10 } } });
    installBridge({ invoke });

    const adapter = new LynxBridgeAdapter();
    const received = new Promise<unknown>((resolve) => {
      const unsubscribe = adapter.onEvent((topic, payload) => {
        unsubscribe();
        resolve({ topic, payload });
      });
    });

    await vi.advanceTimersByTimeAsync(200);

    await expect(received).resolves.toEqual({
      topic: 'atelier.projection.event',
      payload: { seq: 10 },
    });
    expect(invoke).toHaveBeenNthCalledWith(1, { method: 'events.subscribe' });
    expect(invoke).toHaveBeenNthCalledWith(2, { method: 'events.subscribe' });
  });
});

describe('AppletSDK pending event replay', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('buffers unmatched bridge events and replays them when a topic handler registers', () => {
    let bridgeHandler: ((topic: string, payload: unknown) => void) | undefined;
    const adapter: BridgeAdapter = {
      name: 'test',
      invoke: vi.fn(),
      onEvent: vi.fn((handler: (topic: string, payload: unknown) => void) => {
        bridgeHandler = handler;
        return vi.fn();
      }),
    };

    const sdk = new AppletSDK(adapter);
    bridgeHandler?.('atelier.projection.event', { seq: 1 });

    const received: unknown[] = [];
    sdk.onEvent('atelier.projection.event', (payload) => {
      received.push(payload);
    });

    expect(received).toEqual([{ seq: 1 }]);
    sdk.destroy();
  });

  it('bounds pending bridge events before replaying the retained tail', () => {
    let bridgeHandler: ((topic: string, payload: unknown) => void) | undefined;
    const adapter: BridgeAdapter = {
      name: 'test',
      invoke: vi.fn(),
      onEvent: vi.fn((handler: (topic: string, payload: unknown) => void) => {
        bridgeHandler = handler;
        return vi.fn();
      }),
    };

    const sdk = new AppletSDK(adapter);
    for (let seq = 1; seq <= 105; seq += 1) {
      bridgeHandler?.('atelier.projection.event', { seq });
    }

    const received: unknown[] = [];
    sdk.onEvent('atelier.projection.event', (payload) => {
      received.push(payload);
    });

    expect(received).toHaveLength(100);
    expect(received[0]).toEqual({ seq: 6 });
    expect(received[99]).toEqual({ seq: 105 });
    sdk.destroy();
  });

  it('tears down bridge event subscription and clears handlers on destroy', () => {
    let bridgeHandler: ((topic: string, payload: unknown) => void) | undefined;
    const unsubscribeBridge = vi.fn(() => {
      bridgeHandler = undefined;
    });
    const adapter: BridgeAdapter = {
      name: 'test',
      invoke: vi.fn(),
      onEvent: vi.fn((handler: (topic: string, payload: unknown) => void) => {
        bridgeHandler = handler;
        return unsubscribeBridge;
      }),
    };

    const sdk = new AppletSDK(adapter);
    const received: unknown[] = [];
    sdk.onEvent('atelier.projection.event', (payload) => {
      received.push(payload);
    });

    sdk.destroy();
    bridgeHandler?.('atelier.projection.event', { seq: 1 });

    expect(unsubscribeBridge).toHaveBeenCalledTimes(1);
    expect(received).toEqual([]);
  });

  it('removes local event handlers when onEvent unsubscribe is called', () => {
    let bridgeHandler: ((topic: string, payload: unknown) => void) | undefined;
    const adapter: BridgeAdapter = {
      name: 'test',
      invoke: vi.fn(),
      onEvent: vi.fn((handler: (topic: string, payload: unknown) => void) => {
        bridgeHandler = handler;
        return vi.fn();
      }),
    };

    const sdk = new AppletSDK(adapter);
    const received: unknown[] = [];
    const unsubscribe = sdk.onEvent('atelier.projection.event', (payload) => {
      received.push(payload);
    });

    unsubscribe();
    bridgeHandler?.('atelier.projection.event', { seq: 1 });

    expect(received).toEqual([]);
    sdk.destroy();
  });

  it('keeps sibling same-topic handlers after one onEvent unsubscribe', () => {
    let bridgeHandler: ((topic: string, payload: unknown) => void) | undefined;
    const adapter: BridgeAdapter = {
      name: 'test',
      invoke: vi.fn(),
      onEvent: vi.fn((handler: (topic: string, payload: unknown) => void) => {
        bridgeHandler = handler;
        return vi.fn();
      }),
    };

    const sdk = new AppletSDK(adapter);
    const first: unknown[] = [];
    const second: unknown[] = [];
    const unsubscribeFirst = sdk.onEvent('atelier.projection.event', (payload) => {
      first.push(payload);
    });
    sdk.onEvent('atelier.projection.event', (payload) => {
      second.push(payload);
    });

    unsubscribeFirst();
    bridgeHandler?.('atelier.projection.event', { seq: 2 });

    expect(first).toEqual([]);
    expect(second).toEqual([{ seq: 2 }]);
    sdk.destroy();
  });

  it('keeps sibling same-topic handlers when one handler unsubscribes during dispatch', () => {
    let bridgeHandler: ((topic: string, payload: unknown) => void) | undefined;
    const adapter: BridgeAdapter = {
      name: 'test',
      invoke: vi.fn(),
      onEvent: vi.fn((handler: (topic: string, payload: unknown) => void) => {
        bridgeHandler = handler;
        return vi.fn();
      }),
    };

    const sdk = new AppletSDK(adapter);
    const first: unknown[] = [];
    const second: unknown[] = [];
    const unsubscribeFirst = sdk.onEvent('atelier.projection.event', (payload) => {
      first.push(payload);
      unsubscribeFirst();
    });
    sdk.onEvent('atelier.projection.event', (payload) => {
      second.push(payload);
    });

    bridgeHandler?.('atelier.projection.event', { seq: 3 });
    bridgeHandler?.('atelier.projection.event', { seq: 4 });

    expect(first).toEqual([{ seq: 3 }]);
    expect(second).toEqual([{ seq: 3 }, { seq: 4 }]);
    sdk.destroy();
  });

  it('defers same-topic handlers added during dispatch until the next Host event', () => {
    let bridgeHandler: ((topic: string, payload: unknown) => void) | undefined;
    const adapter: BridgeAdapter = {
      name: 'test',
      invoke: vi.fn(),
      onEvent: vi.fn((handler: (topic: string, payload: unknown) => void) => {
        bridgeHandler = handler;
        return vi.fn();
      }),
    };

    const sdk = new AppletSDK(adapter);
    const first: unknown[] = [];
    const second: unknown[] = [];
    const third: unknown[] = [];
    let registeredThird = false;
    sdk.onEvent('atelier.projection.event', (payload) => {
      first.push(payload);
      if (!registeredThird) {
        registeredThird = true;
        sdk.onEvent('atelier.projection.event', (nextPayload) => {
          third.push(nextPayload);
        });
      }
    });
    sdk.onEvent('atelier.projection.event', (payload) => {
      second.push(payload);
    });

    bridgeHandler?.('atelier.projection.event', { seq: 5 });
    bridgeHandler?.('atelier.projection.event', { seq: 6 });

    expect(first).toEqual([{ seq: 5 }, { seq: 6 }]);
    expect(second).toEqual([{ seq: 5 }, { seq: 6 }]);
    expect(third).toEqual([{ seq: 6 }]);
    sdk.destroy();
  });

  it('preserves pending Host events that arrive during pending replay', () => {
    let bridgeHandler: ((topic: string, payload: unknown) => void) | undefined;
    const adapter: BridgeAdapter = {
      name: 'test',
      invoke: vi.fn(),
      onEvent: vi.fn((handler: (topic: string, payload: unknown) => void) => {
        bridgeHandler = handler;
        return vi.fn();
      }),
    };

    const sdk = new AppletSDK(adapter);
    const replayed: unknown[] = [];
    const retained: unknown[] = [];
    bridgeHandler?.('atelier.projection.event', { seq: 7 });

    sdk.onEvent('atelier.projection.event', (payload) => {
      replayed.push(payload);
      bridgeHandler?.('atelier.retained.event', { seq: 8 });
    });
    sdk.onEvent('atelier.retained.event', (payload) => {
      retained.push(payload);
    });

    expect(replayed).toEqual([{ seq: 7 }]);
    expect(retained).toEqual([{ seq: 8 }]);
    sdk.destroy();
  });
});
