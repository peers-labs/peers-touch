// AppletSDK — public API surface with BridgeAdapter architecture.
// Auto-detects the runtime environment and selects the appropriate adapter.

import type { BridgeAdapter } from './adapter.js';
import { detectAdapter } from './detect.js';
import { createStorageAPI } from './capabilities/storage.js';
import { createNetworkAPI } from './capabilities/network.js';
import { createConfigAPI } from './capabilities/config.js';
import { createSystemAPI } from './capabilities/system.js';

import type { StorageAPI } from './capabilities/storage.js';
import type { NetworkAPI, NetworkRequestOptions, NetworkResponse } from './capabilities/network.js';
import type { ConfigAPI } from './capabilities/config.js';
import type { SystemAPI, SystemInfo } from './capabilities/system.js';

export class AppletSDK {
  private adapter: BridgeAdapter;
  private eventHandlers: Array<{ topic: string; handler: (payload: unknown) => void }> = [];
  private unsubscribeBridge: (() => void) | null = null;

  readonly storage: StorageAPI;
  readonly network: NetworkAPI;
  readonly config: ConfigAPI;
  readonly system: SystemAPI;

  constructor(adapter?: BridgeAdapter) {
    this.adapter = adapter ?? detectAdapter();
    this.storage = createStorageAPI(this.adapter);
    this.network = createNetworkAPI(this.adapter);
    this.config = createConfigAPI(this.adapter);
    this.system = createSystemAPI(this.adapter);

    // Subscribe to bridge events and dispatch to registered handlers
    this.unsubscribeBridge = this.adapter.onEvent((topic, payload) => {
      for (const entry of this.eventHandlers) {
        if (entry.topic === topic) {
          entry.handler(payload);
        }
      }
    });
  }

  // Generic invoke for extensions beyond built-in capabilities
  invoke<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    return this.adapter.invoke(method, params) as Promise<T>;
  }

  // Event subscription — returns an unsubscribe function
  onEvent(topic: string, handler: (payload: unknown) => void): () => void {
    const entry = { topic, handler };
    this.eventHandlers.push(entry);

    return () => {
      const idx = this.eventHandlers.indexOf(entry);
      if (idx !== -1) {
        this.eventHandlers.splice(idx, 1);
      }
    };
  }

  // Current adapter runtime name
  get runtime(): string {
    return this.adapter.name;
  }

  // Teardown: remove all event listeners
  destroy(): void {
    this.eventHandlers = [];
    if (this.unsubscribeBridge) {
      this.unsubscribeBridge();
      this.unsubscribeBridge = null;
    }
  }
}

// Singleton instance with auto-detected adapter
export const sdk = new AppletSDK();

// Re-export types and constructs
export type { BridgeAdapter } from './adapter.js';
export type { StorageAPI } from './capabilities/storage.js';
export type { NetworkAPI, NetworkRequestOptions, NetworkResponse } from './capabilities/network.js';
export type { ConfigAPI } from './capabilities/config.js';
export type { SystemAPI, SystemInfo } from './capabilities/system.js';
export type { AppletEvent, EventCallback } from './types.js';
export { AppletErrorCode, AppletError } from './errors.js';
export { LynxBridgeAdapter } from './adapters/lynx.js';
export { StandaloneBridgeAdapter } from './adapters/standalone.js';
