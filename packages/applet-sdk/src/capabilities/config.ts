// ConfigCapability — delegates configuration lookups to the bridge adapter.

import type { BridgeAdapter } from '../adapter.js';

export interface ConfigAPI {
  get<T = unknown>(key: string): Promise<T | null>;
}

export function createConfigAPI(adapter: BridgeAdapter): ConfigAPI {
  return {
    async get<T = unknown>(key: string): Promise<T | null> {
      const result = await adapter.invoke('config.get', { key });
      if (typeof result === 'object' && result !== null && 'value' in result) {
        return (result as { value: T | null }).value ?? null;
      }
      return (result as T | null) ?? null;
    },
  };
}
