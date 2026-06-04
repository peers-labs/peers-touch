// ConfigCapability — delegates configuration lookups to the bridge adapter.

import type { BridgeAdapter } from '../adapter.js';

export interface ConfigAPI {
  get(key: string): Promise<string | null>;
}

export function createConfigAPI(adapter: BridgeAdapter): ConfigAPI {
  return {
    get(key: string): Promise<string | null> {
      return adapter.invoke('config.get', { key }) as Promise<string | null>;
    },
  };
}
