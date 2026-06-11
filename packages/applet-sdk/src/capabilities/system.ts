// SystemCapability — delegates system info queries to the bridge adapter.

import type { BridgeAdapter } from '../adapter.js';

export interface SystemInfo {
  platform: 'desktop' | 'android' | 'ios' | 'harmony' | 'web' | 'standalone';
  version: string;
  appName: string;
}

export interface SystemAPI {
  getInfo(): Promise<SystemInfo>;
  getTheme(): Promise<'light' | 'dark' | 'system'>;
  getNetworkType(): Promise<'wifi' | 'cellular' | 'ethernet' | 'offline' | 'unknown'>;
}

export function createSystemAPI(adapter: BridgeAdapter): SystemAPI {
  return {
    getInfo(): Promise<SystemInfo> {
      return adapter.invoke('system.getInfo') as Promise<SystemInfo>;
    },
    getTheme(): Promise<'light' | 'dark' | 'system'> {
      return adapter.invoke('system.getTheme') as Promise<'light' | 'dark' | 'system'>;
    },
    getNetworkType(): Promise<'wifi' | 'cellular' | 'ethernet' | 'offline' | 'unknown'> {
      return adapter.invoke('system.getNetworkType') as Promise<'wifi' | 'cellular' | 'ethernet' | 'offline' | 'unknown'>;
    },
  };
}
