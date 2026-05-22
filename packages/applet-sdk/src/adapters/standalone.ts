// StandaloneBridgeAdapter — for standalone SPA mode (direct browser, no host).
// Uses localStorage for storage, fetch for network, and provides defaults for other capabilities.

import type { BridgeAdapter } from '../adapter.js';
import { AppletError, AppletErrorCode } from '../errors.js';

export class StandaloneBridgeAdapter implements BridgeAdapter {
  readonly name = 'standalone';

  async invoke(method: string, params?: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'storage.get':
        return this.storageGet(params);
      case 'storage.set':
        return this.storageSet(params);
      case 'storage.remove':
        return this.storageRemove(params);
      case 'storage.clear':
        return this.storageClear();
      case 'network.request':
        return this.networkRequest(params);
      case 'config.get':
        return null;
      case 'system.getInfo':
        return this.systemGetInfo();
      default:
        throw new AppletError(
          AppletErrorCode.MethodNotFound,
          `Method "${method}" is not supported in standalone mode`,
        );
    }
  }

  onEvent(_handler: (topic: string, payload: unknown) => void): () => void {
    // Standalone mode has no host to receive events from
    return () => {};
  }

  private storageGet(params?: Record<string, unknown>): string | null {
    const key = params?.key as string | undefined;
    if (!key) {
      throw new AppletError(AppletErrorCode.StorageError, 'storage.get requires a key parameter');
    }
    return window.localStorage.getItem(key);
  }

  private storageSet(params?: Record<string, unknown>): void {
    const key = params?.key as string | undefined;
    const value = params?.value as string | undefined;
    if (!key || value === undefined) {
      throw new AppletError(AppletErrorCode.StorageError, 'storage.set requires key and value parameters');
    }
    window.localStorage.setItem(key, value);
  }

  private storageRemove(params?: Record<string, unknown>): void {
    const key = params?.key as string | undefined;
    if (!key) {
      throw new AppletError(AppletErrorCode.StorageError, 'storage.remove requires a key parameter');
    }
    window.localStorage.removeItem(key);
  }

  private storageClear(): void {
    window.localStorage.clear();
  }

  private async networkRequest(params?: Record<string, unknown>): Promise<unknown> {
    const url = params?.url as string | undefined;
    if (!url) {
      throw new AppletError(AppletErrorCode.NetworkError, 'network.request requires a url parameter');
    }

    const method = (params?.method as string) ?? 'GET';
    const headers = (params?.headers as Record<string, string>) ?? {};
    const body = params?.body as string | undefined;
    const timeout = params?.timeout as number | undefined;

    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    if (timeout && timeout > 0) {
      timeoutId = setTimeout(() => controller.abort(), timeout);
    }

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ?? undefined,
        signal: controller.signal,
      });

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      const responseBody = await response.text();

      return {
        status: response.status,
        headers: responseHeaders,
        body: responseBody,
      };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new AppletError(AppletErrorCode.Timeout, 'Network request timed out');
      }
      const message = err instanceof Error ? err.message : 'Network request failed';
      throw new AppletError(AppletErrorCode.NetworkError, message);
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }

  private systemGetInfo(): Record<string, unknown> {
    return {
      platform: 'standalone' as const,
      version: '0.0.0',
      appName: window.document?.title ?? 'standalone-applet',
    };
  }
}
