// SystemCapability — delegates system info queries to the bridge adapter.

import type { BridgeAdapter } from '../adapter.js';

export interface SystemInfo {
  platform: 'desktop' | 'android' | 'ios' | 'standalone';
  version: string;
  appName: string;
}

export interface SystemAPI {
  getInfo(): Promise<SystemInfo>;
}

export function createSystemAPI(adapter: BridgeAdapter): SystemAPI {
  return {
    getInfo(): Promise<SystemInfo> {
      return adapter.invoke('system.getInfo') as Promise<SystemInfo>;
    },
  };
}
