// LynxBridgeAdapter — for Lynx for Web environment inside <lynx-view>.
// Applet code runs in a Lynx background thread (no DOM). Communicates via NativeModules.

import type { BridgeAdapter } from '../adapter.js';
import { AppletError, AppletErrorCode } from '../errors.js';
import type { AppletErrorCode as ContractAppletErrorCode } from '@peers-touch/applet-contract';

// Lynx runtime global type declarations (available in Lynx background thread)
type LynxNativeModules = {
  bridge: {
    invoke?: (payload: { method: string; params?: Record<string, unknown> }) => unknown | Promise<unknown>;
    call?: (name: string, data: { method: string; params?: Record<string, unknown> }, callback: (result: unknown) => void) => void;
  };
};

type LynxRuntime = {
  requireModule?(name: string): LynxNativeModules['bridge'] | undefined;
  getJSModule(name: string): {
    addListener(topic: string, handler: (payload: unknown) => void): void;
    removeListener(topic: string, handler: (payload: unknown) => void): void;
  };
};

type LynxGlobalScope = typeof globalThis & {
  NativeModules?: LynxNativeModules;
  lynx?: LynxRuntime;
};

declare const NativeModules: LynxNativeModules | undefined;
declare const lynx: LynxRuntime | undefined;

const BRIDGE_READY_TIMEOUT_MS = 1000;
const BRIDGE_READY_POLL_MS = 10;

export class LynxBridgeAdapter implements BridgeAdapter {
  readonly name = 'lynx';

  async invoke(method: string, params?: Record<string, unknown>): Promise<unknown> {
    try {
      const result = await this.callBridge({ method, params });
      return this.unwrapResult(result);
    } catch (err: unknown) {
      if (err instanceof AppletError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : 'Lynx bridge invoke failed';
      throw new AppletError(AppletErrorCode.InternalError, message);
    }
  }

  private async callBridge(payload: { method: string; params?: Record<string, unknown> }): Promise<unknown> {
    const bridge = await this.waitForBridge();
    if (typeof bridge.invoke === 'function') {
      return Promise.resolve(bridge.invoke(payload));
    }
    if (typeof bridge.call === 'function') {
      return new Promise((resolve) => {
        bridge.call?.('invoke', payload, resolve);
      });
    }
    throw new AppletError(AppletErrorCode.MethodNotFound, 'Lynx bridge module does not expose invoke or call');
  }

  onEvent(handler: (topic: string, payload: unknown) => void): () => void {
    const runtime = lynxRuntime();
    if (!runtime) return () => {};
    const globalEmitter = runtime.getJSModule('GlobalEventEmitter');
    const bridgeEventTopic = 'applet.event';

    const listener = (payload: unknown): void => {
      const envelope = Array.isArray(payload) ? payload[0] : payload;
      if (typeof envelope === 'object' && envelope !== null) {
        const evt = envelope as { topic?: unknown; event?: unknown; payload?: unknown };
        const topic = typeof evt.topic === 'string' ? evt.topic : evt.event;
        if (typeof topic === 'string') {
          handler(topic, evt.payload);
        }
      }
    };

    globalEmitter.addListener(bridgeEventTopic, listener);

    return () => {
      globalEmitter.removeListener(bridgeEventTopic, listener);
    };
  }

  private unwrapResult(raw: unknown): unknown {
    const normalized = typeof raw === 'string' ? this.parseEnvelope(raw) : raw;
    if (typeof normalized === 'object' && normalized !== null && 'ok' in normalized) {
      const response = normalized as { ok?: boolean; result?: unknown; error?: { code?: ContractAppletErrorCode; message?: string; details?: Record<string, unknown>; requestId?: string } };
      if (response.ok === false) {
        const code = response.error?.code ?? AppletErrorCode.InternalError;
        const message = response.error?.message ?? 'Bridge call failed';
        throw new AppletError(code, message, response.error?.details, response.error?.requestId);
      }
      if ('result' in response) {
        return response.result;
      }
    }
    return normalized;
  }

  private parseEnvelope(raw: string): unknown {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return raw;
    }
  }

  private async waitForBridge(): Promise<LynxNativeModules['bridge']> {
    const deadline = Date.now() + BRIDGE_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const bridge = nativeBridge();
      if (bridge) return bridge;
      await new Promise((resolve) => setTimeout(resolve, BRIDGE_READY_POLL_MS));
    }
    throw new AppletError(AppletErrorCode.MethodNotFound, 'Lynx bridge module is not available');
  }
}

export function isLynxEnvironment(): boolean {
  return Boolean(lynxRuntime() || nativeBridge());
}

function nativeBridge(): LynxNativeModules['bridge'] | undefined {
  const scope = globalThis as LynxGlobalScope;
  const injectedNativeModules = typeof NativeModules !== 'undefined' ? NativeModules : undefined;
  const injectedLynx = typeof lynx !== 'undefined' ? lynx : undefined;
  return injectedNativeModules?.bridge
    ?? scope.NativeModules?.bridge
    ?? injectedLynx?.requireModule?.('bridge')
    ?? scope.lynx?.requireModule?.('bridge');
}

function lynxRuntime(): LynxRuntime | undefined {
  return typeof lynx !== 'undefined' ? lynx : (globalThis as LynxGlobalScope).lynx;
}
