// StorageCapability — delegates storage operations to the bridge adapter.

import type { BridgeAdapter } from '../adapter.js';

export interface StorageAPI {
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
  keys(prefix?: string): Promise<string[]>;
  getInfo(): Promise<{ quotaBytes: number; usedBytes: number; keys: string[] }>;
}

export function createStorageAPI(adapter: BridgeAdapter): StorageAPI {
  return {
    async get<T = unknown>(key: string): Promise<T | null> {
      const result = await adapter.invoke('storage.get', { key });
      if (typeof result === 'object' && result !== null && 'value' in result) {
        return (result as { value: T | null }).value ?? null;
      }
      return (result as T | null) ?? null;
    },
    set<T = unknown>(key: string, value: T): Promise<void> {
      return adapter.invoke('storage.set', { key, value }) as Promise<void>;
    },
    remove(key: string): Promise<void> {
      return adapter.invoke('storage.remove', { key }) as Promise<void>;
    },
    clear(): Promise<void> {
      return adapter.invoke('storage.clear') as Promise<void>;
    },
    keys(prefix?: string): Promise<string[]> {
      return adapter.invoke('storage.keys', { prefix }) as Promise<string[]>;
    },
    getInfo(): Promise<{ quotaBytes: number; usedBytes: number; keys: string[] }> {
      return adapter.invoke('storage.getInfo') as Promise<{ quotaBytes: number; usedBytes: number; keys: string[] }>;
    },
  };
}
