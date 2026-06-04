// LynxBridgeAdapter — for Lynx for Web environment inside <lynx-view>.
// Applet code runs in a Lynx background thread (no DOM). Communicates via NativeModules.

import type { BridgeAdapter } from '../adapter.js';
import { AppletError, AppletErrorCode } from '../errors.js';

// Lynx runtime global type declarations (available in Lynx background thread)
declare const NativeModules: {
  bridge: {
    invoke(payload: { method: string; params?: Record<string, unknown> }): unknown | Promise<unknown>;
  };
};

declare const lynx: {
  getJSModule(name: string): {
    addListener(topic: string, handler: (payload: unknown) => void): void;
    removeListener(topic: string, handler: (payload: unknown) => void): void;
  };
};

export class LynxBridgeAdapter implements BridgeAdapter {
  readonly name = 'lynx';

  async invoke(method: string, params?: Record<string, unknown>): Promise<unknown> {
    try {
      const result = await NativeModules.bridge.invoke({ method, params });
      return this.unwrapResult(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Lynx bridge invoke failed';
      throw new AppletError(AppletErrorCode.InternalError, message);
    }
  }

  onEvent(handler: (topic: string, payload: unknown) => void): () => void {
    const globalEmitter = lynx.getJSModule('GlobalEventEmitter');
    const bridgeEventTopic = 'applet.event';

    const listener = (payload: unknown): void => {
      if (typeof payload === 'object' && payload !== null && 'topic' in payload) {
        const evt = payload as { topic: string; payload: unknown };
        handler(evt.topic, evt.payload);
      }
    };

    globalEmitter.addListener(bridgeEventTopic, listener);

    return () => {
      globalEmitter.removeListener(bridgeEventTopic, listener);
    };
  }

  private unwrapResult(raw: unknown): unknown {
    if (typeof raw === 'object' && raw !== null && 'ok' in raw) {
      const response = raw as { ok?: boolean; result?: unknown; error?: { code?: number; message?: string } };
      if (response.ok === false) {
        const code = response.error?.code ?? AppletErrorCode.InternalError;
        const message = response.error?.message ?? 'Bridge call failed';
        throw new AppletError(code as AppletErrorCode, message);
      }
      if ('result' in response) {
        return response.result;
      }
    }
    return raw;
  }
}

// Detection: check if Lynx NativeModules bridge is available
export function isLynxEnvironment(): boolean {
  return typeof NativeModules !== 'undefined' && NativeModules.bridge !== undefined;
}
