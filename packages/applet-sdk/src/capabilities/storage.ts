// StorageCapability — delegates storage operations to the bridge adapter.

import type { BridgeAdapter } from '../adapter.js';

export interface StorageAPI {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

export function createStorageAPI(adapter: BridgeAdapter): StorageAPI {
  return {
    get(key: string): Promise<string | null> {
      return adapter.invoke('storage.get', { key }) as Promise<string | null>;
    },
    set(key: string, value: string): Promise<void> {
      return adapter.invoke('storage.set', { key, value }) as Promise<void>;
    },
    remove(key: string): Promise<void> {
      return adapter.invoke('storage.remove', { key }) as Promise<void>;
    },
    clear(): Promise<void> {
      return adapter.invoke('storage.clear') as Promise<void>;
    },
  };
}
