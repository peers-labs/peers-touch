import type { BridgeAdapter, RuntimeContextProvider } from '../adapter.js';
import { AppletError, AppletErrorCode } from '../errors.js';
import type { AppletErrorCode as ContractAppletErrorCode } from '@peers-touch/applet-contract';

interface WebHostBridge {
  invoke(method: string, params?: Record<string, unknown>): Promise<unknown> | unknown;
  onEvent?(handler: (topic: string, payload: unknown) => void): () => void;
  getContext?(): Record<string, unknown>;
}

declare global {
  var __PEERS_TOUCH_APPLET_HOST__: WebHostBridge | undefined;
}

export class WebHostBridgeAdapter implements BridgeAdapter, RuntimeContextProvider {
  readonly name = 'web-host';

  async invoke(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const host = getWebHostBridge();
    if (!host) {
      throw new AppletError(AppletErrorCode.BridgeUnavailable, 'Peers-Touch Web Host bridge is unavailable');
    }
    return unwrapBridgeResult(await host.invoke(method, params));
  }

  onEvent(handler: (topic: string, payload: unknown) => void): () => void {
    return getWebHostBridge()?.onEvent?.(handler) ?? (() => {});
  }

  getContext(): Record<string, unknown> | undefined {
    return getWebHostBridge()?.getContext?.();
  }
}

export function getWebHostBridge(): WebHostBridge | undefined {
  return globalThis.__PEERS_TOUCH_APPLET_HOST__;
}

export function isWebHostEnvironment(): boolean {
  return getWebHostBridge() !== undefined;
}

function unwrapBridgeResult(raw: unknown): unknown {
  const normalized = typeof raw === 'string' ? parseEnvelope(raw) : raw;
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

function parseEnvelope(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}
