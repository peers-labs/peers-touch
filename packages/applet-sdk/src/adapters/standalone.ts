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
      case 'storage.keys':
        return this.storageKeys(params);
      case 'storage.getInfo':
        return this.storageGetInfo();
      case 'network.request':
        return this.networkRequest(params);
      case 'network.upload':
        return this.networkUpload(params);
      case 'network.download':
        return this.networkDownload(params);
      case 'config.get':
        return { value: null };
      case 'system.getInfo':
        return this.systemGetInfo();
      case 'system.getTheme':
        return 'system';
      case 'system.getNetworkType':
        return 'unknown';
      case 'device.getSafeArea':
        return { top: 0, right: 0, bottom: 0, left: 0 };
      case 'device.getWindowInfo':
        return {
          width: window.innerWidth,
          height: window.innerHeight,
          pixelRatio: window.devicePixelRatio || 1,
        };
      case 'device.vibrate':
        window.navigator?.vibrate?.((params?.durationMs as number | undefined) ?? 10);
        return { ok: true };
      case 'clipboard.getText':
        return window.navigator?.clipboard?.readText?.() ?? '';
      case 'clipboard.setText':
        return this.clipboardSetText(params);
      case 'file.read':
        return this.fileRead(params);
      case 'file.write':
        return this.fileWrite(params);
      case 'file.delete':
        return this.fileDelete(params);
      case 'file.list':
        return this.fileList(params);
      case 'file.getInfo':
        return this.fileGetInfo();
      case 'app.getContext':
        return this.getRuntimeContext();
      case 'app.getLaunchOptions':
        return {};
      case 'lifecycle.reportReady':
      case 'ui.showToast':
      case 'ui.showLoading':
      case 'ui.hideLoading':
      case 'ui.setNavigationBar':
      case 'telemetry.track':
      case 'telemetry.reportError':
      case 'telemetry.mark':
        return { ok: true };
      case 'skills.list':
        return [];
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

  private storageGet(params?: Record<string, unknown>): unknown {
    const key = params?.key as string | undefined;
    if (!key) {
      throw new AppletError(AppletErrorCode.StorageError, 'storage.get requires a key parameter');
    }
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return raw;
    }
  }

  private storageSet(params?: Record<string, unknown>): void {
    const key = params?.key as string | undefined;
    const value = params?.value;
    if (!key || value === undefined) {
      throw new AppletError(AppletErrorCode.StorageError, 'storage.set requires key and value parameters');
    }
    window.localStorage.setItem(key, JSON.stringify(value));
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

  private storageKeys(params?: Record<string, unknown>): string[] {
    const prefix = params?.prefix as string | undefined;
    const keys = Object.keys(window.localStorage);
    return prefix ? keys.filter((key) => key.startsWith(prefix)) : keys;
  }

  private storageGetInfo(): { quotaBytes: number; usedBytes: number; keys: string[] } {
    const keys = Object.keys(window.localStorage);
    const usedBytes = keys.reduce((total, key) => total + key.length + (window.localStorage.getItem(key)?.length ?? 0), 0);
    return { quotaBytes: 5 * 1024 * 1024, usedBytes, keys };
  }

  private async networkRequest(params?: Record<string, unknown>): Promise<unknown> {
    const service = params?.service as string | undefined;
    const path = params?.path as string | undefined;
    if (!service || !path) {
      throw new AppletError(AppletErrorCode.NetworkError, 'network.request requires service and path parameters');
    }
    const url = `${service.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;

    const method = (params?.method as string) ?? 'GET';
    const headers = (params?.headers as Record<string, string>) ?? {};
    const body = params?.body === undefined ? undefined : typeof params.body === 'string' ? params.body : JSON.stringify(params.body);
    const timeout = params?.timeoutMs as number | undefined;

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

  private async networkUpload(params?: Record<string, unknown>): Promise<unknown> {
    return this.networkRequest({ ...params, method: 'POST' });
  }

  private async networkDownload(params?: Record<string, unknown>): Promise<unknown> {
    const response = await this.networkRequest({ ...params, method: 'GET' }) as { status: number; headers: Record<string, string>; body: string };
    const filePath = params?.filePath as string | undefined;
    if (!filePath) return response;
    window.localStorage.setItem(this.fileStorageKey(filePath), response.body);
    return {
      status: response.status,
      headers: response.headers,
      file: { path: filePath, sizeBytes: response.body.length },
    };
  }

  private async clipboardSetText(params?: Record<string, unknown>): Promise<{ ok: boolean }> {
    const text = params?.text as string | undefined;
    if (text === undefined) {
      throw new AppletError(AppletErrorCode.InternalError, 'clipboard.setText requires text');
    }
    await window.navigator?.clipboard?.writeText?.(text);
    return { ok: true };
  }

  private fileRead(params?: Record<string, unknown>): { path: string; content: string; sizeBytes: number; encoding: 'utf8' } {
    const path = this.requireFilePath(params, 'file.read');
    const content = window.localStorage.getItem(this.fileStorageKey(path)) ?? '';
    return { path, content, sizeBytes: content.length, encoding: 'utf8' };
  }

  private fileWrite(params?: Record<string, unknown>): { path: string; sizeBytes: number } {
    const path = this.requireFilePath(params, 'file.write');
    const content = params?.content as string | undefined;
    if (content === undefined) {
      throw new AppletError(AppletErrorCode.InternalError, 'file.write requires content');
    }
    window.localStorage.setItem(this.fileStorageKey(path), content);
    return { path, sizeBytes: content.length };
  }

  private fileDelete(params?: Record<string, unknown>): { ok: boolean } {
    const path = this.requireFilePath(params, 'file.delete');
    window.localStorage.removeItem(this.fileStorageKey(path));
    return { ok: true };
  }

  private fileList(params?: Record<string, unknown>): Array<{ path: string; kind: 'file'; sizeBytes: number }> {
    const prefix = (params?.path as string | undefined)?.replace(/^\/+/, '') ?? '';
    return Object.keys(window.localStorage)
      .filter((key) => key.startsWith('pt-applet-file:'))
      .map((key) => key.slice('pt-applet-file:'.length))
      .filter((path) => path.startsWith(prefix))
      .map((path) => ({
        path,
        kind: 'file' as const,
        sizeBytes: window.localStorage.getItem(this.fileStorageKey(path))?.length ?? 0,
      }));
  }

  private fileGetInfo(): { quotaBytes: number; usedBytes: number; entries: Array<{ path: string; kind: 'file'; sizeBytes: number }> } {
    const entries = this.fileList();
    return {
      quotaBytes: 5 * 1024 * 1024,
      usedBytes: entries.reduce((total, entry) => total + entry.sizeBytes, 0),
      entries,
    };
  }

  private requireFilePath(params: Record<string, unknown> | undefined, operation: string): string {
    const path = params?.path as string | undefined;
    if (!path || path.includes('..') || path.startsWith('/')) {
      throw new AppletError(AppletErrorCode.InternalError, `${operation} requires a sandbox-relative path`);
    }
    return path;
  }

  private fileStorageKey(path: string): string {
    return `pt-applet-file:${path}`;
  }

  private systemGetInfo(): Record<string, unknown> {
    return {
      platform: 'standalone' as const,
      version: '0.0.0',
      appName: window.document?.title ?? 'standalone-applet',
    };
  }

  private getRuntimeContext(): Record<string, unknown> {
    return {
      appletId: 'standalone',
      sessionId: 'standalone',
      platform: 'standalone',
      runtime: 'standalone',
      sdkVersion: '1.0.0',
      bridgeProtocol: 'peers-touch.applet.bridge',
    };
  }
}
